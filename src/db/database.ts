import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import path from 'path';
import fs from 'fs';

let db: Database | null = null;
let SQL: SqlJsStatic | null = null;
let dbFilePath: string = '';
let saveInterval: NodeJS.Timeout | null = null;

export async function initDb(): Promise<void> {
  if (db) return;

  if (!SQL) {
    SQL = await initSqlJs();
  }

  const dbDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbFilePath = path.join(dbDir, 'scriptkill.db');

  if (fs.existsSync(dbFilePath)) {
    const fileBuffer = fs.readFileSync(dbFilePath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      difficulty TEXT DEFAULT 'medium',
      duration_minutes INTEGER DEFAULT 240,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      age INTEGER,
      is_lead INTEGER DEFAULT 0,
      courage_required INTEGER DEFAULT 3,
      reasoning_required INTEGER DEFAULT 3,
      emotional_depth INTEGER DEFAULT 3,
      description TEXT,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id INTEGER NOT NULL,
      character_a_id INTEGER NOT NULL,
      character_b_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      importance INTEGER DEFAULT 3,
      FOREIGN KEY (script_id) REFERENCES scripts(id) ON DELETE CASCADE,
      FOREIGN KEY (character_a_id) REFERENCES characters(id) ON DELETE CASCADE,
      FOREIGN KEY (character_b_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'published',
      parent_version_id INTEGER,
      description TEXT,
      priority INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      config_json TEXT DEFAULT '{}',
      scope_json TEXT DEFAULT '{}',
      gray_store_ids_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(code, version)
    );

    CREATE TABLE IF NOT EXISTS allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      script_id INTEGER NOT NULL,
      players_json TEXT NOT NULL,
      suggestion_json TEXT NOT NULL,
      rule_versions_json TEXT DEFAULT '[]',
      cross_gender_count INTEGER DEFAULT 0,
      cross_gender_refused INTEGER DEFAULT 0,
      on_site_changes INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      started_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (store_id) REFERENCES stores(id),
      FOREIGN KEY (script_id) REFERENCES scripts(id)
    );

    CREATE TABLE IF NOT EXISTS allocation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allocation_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      character_name TEXT NOT NULL,
      is_cross_gender INTEGER DEFAULT 0,
      score REAL DEFAULT 0,
      reasons_json TEXT DEFAULT '[]',
      FOREIGN KEY (allocation_id) REFERENCES allocations(id) ON DELETE CASCADE
    );
  `);

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_characters_script ON characters(script_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_allocations_store ON allocations(store_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_allocations_script ON allocations(script_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_allocation_results_alloc ON allocation_results(allocation_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_allocations_started ON allocations(started_at)');
  } catch (e) {
    // ignore index errors
  }

  runMigrations();

  startAutoSave();
}

function runMigrations(): void {
  if (!db) return;

  const hasScopeJson = columnExists('rules', 'scope_json');
  if (!hasScopeJson) {
    try {
      db.exec("ALTER TABLE rules ADD COLUMN scope_json TEXT DEFAULT '{}'");
    } catch (e) {
      // column may already exist
    }
  }

  const hasStartedAt = columnExists('allocations', 'started_at');
  if (!hasStartedAt) {
    try {
      db.exec('ALTER TABLE allocations ADD COLUMN started_at DATETIME');
    } catch (e) {
      // column may already exist
    }
  }

  try {
    db.exec('UPDATE allocations SET started_at = created_at WHERE started_at IS NULL');
  } catch (e) {
    // ignore
  }

  const hasVersion = columnExists('rules', 'version');
  const hasStatus = columnExists('rules', 'status');
  const hasRuleVersionsJson = columnExists('allocations', 'rule_versions_json');

  if (!hasVersion || !hasStatus) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS rules_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          code TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'published',
          parent_version_id INTEGER,
          description TEXT,
          priority INTEGER DEFAULT 50,
          enabled INTEGER DEFAULT 1,
          config_json TEXT DEFAULT '{}',
          scope_json TEXT DEFAULT '{}',
          gray_store_ids_json TEXT DEFAULT '[]',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(code, version)
        );

        INSERT INTO rules_new (id, name, code, version, status, description, priority, enabled, config_json, scope_json, created_at, updated_at)
        SELECT id, name, code, 1, 'published', description, priority, enabled, config_json,
               COALESCE(scope_json, '{}'), created_at, updated_at FROM rules;

        DROP TABLE rules;
        ALTER TABLE rules_new RENAME TO rules;
      `);
    } catch (e) {
      console.log('Migration warning: rules table upgrade skipped:', e);
    }
  }

  if (!hasRuleVersionsJson) {
    try {
      db.exec("ALTER TABLE allocations ADD COLUMN rule_versions_json TEXT DEFAULT '[]'");
    } catch (e) {
      // column may already exist
    }
  }

  const hasGrayStoreIds = columnExists('rules', 'gray_store_ids_json');
  if (!hasGrayStoreIds) {
    try {
      db.exec("ALTER TABLE rules ADD COLUMN gray_store_ids_json TEXT DEFAULT '[]'");
    } catch (e) {
      // column may already exist
    }
  }

  const hasParentVersionId = columnExists('rules', 'parent_version_id');
  if (!hasParentVersionId) {
    try {
      db.exec('ALTER TABLE rules ADD COLUMN parent_version_id INTEGER');
    } catch (e) {
      // column may already exist
    }
  }

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_rules_code_status ON rules(code, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_allocations_store_script ON allocations(store_id, script_id)');
  } catch (e) {
    // ignore index errors
  }
}

function columnExists(table: string, column: string): boolean {
  if (!db) return false;
  try {
    const result = db.exec(`PRAGMA table_info(${table})`);
    if (result.length > 0) {
      const colIdx = result[0].columns.indexOf('name');
      if (colIdx >= 0) {
        for (const row of result[0].values) {
          if (row[colIdx] === column) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function startAutoSave(): void {
  if (saveInterval) return;
  saveInterval = setInterval(() => {
    saveToDisk();
  }, 5000);
}

export function saveToDisk(): void {
  if (!db || !dbFilePath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbFilePath, buffer);
  } catch (e) {
    console.error('Failed to save database:', e);
  }
}

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function closeDb(): void {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  if (db) {
    saveToDisk();
    db.close();
    db = null;
  }
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export function runQuery(sql: string, params: any[] = []): RunResult {
  const database = getDb();
  const stmt = database.prepare(sql);
  stmt.bind(params);
  stmt.step();
  stmt.free();
  return {
    changes: database.getRowsModified() || 0,
    lastInsertRowid: Number(database.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] || 0)
  };
}

export function getOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const database = getDb();
  const stmt = database.prepare(sql);
  stmt.bind(params);

  if (stmt.step()) {
    const result = stmt.getAsObject() as T;
    stmt.free();
    return result;
  }
  stmt.free();
  return undefined;
}

export function getAll<T = any>(sql: string, params: any[] = []): T[] {
  const database = getDb();
  const stmt = database.prepare(sql);
  stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
