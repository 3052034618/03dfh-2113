import { getOne, getAll, runQuery } from '../db/database';
import { Rule, RuleConfig, RuleScope, RuleStatus } from '../types';

export function getRuleById(id: number): Rule | undefined {
  return getOne<Rule>('SELECT * FROM rules WHERE id = ?', [id]);
}

export function getRuleByCode(code: string): Rule | undefined {
  return getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published' ORDER BY version DESC LIMIT 1",
    [code]
  );
}

export function getRuleByCodeAndVersion(code: string, version: number): Rule | undefined {
  return getOne<Rule>('SELECT * FROM rules WHERE code = ? AND version = ?', [code, version]);
}

export function getLatestVersion(code: string): number {
  const row = getOne<{ max_version: number }>(
    'SELECT COALESCE(MAX(version), 0) as max_version FROM rules WHERE code = ?',
    [code]
  );
  return row?.max_version || 0;
}

export function getAllRules(includeArchived: boolean = false): Rule[] {
  const statusFilter = includeArchived ? '' : "AND status != 'archived'";
  return getAll<Rule>(
    `SELECT * FROM rules WHERE 1=1 ${statusFilter} ORDER BY code, version DESC`,
    []
  );
}

export function getVersionsByCode(code: string): Rule[] {
  return getAll<Rule>(
    'SELECT * FROM rules WHERE code = ? ORDER BY version DESC',
    [code]
  );
}

export function getEnabledRules(): Rule[] {
  return getAll<Rule>(
    `SELECT * FROM rules 
     WHERE enabled = 1 
     AND status IN ('published', 'gray')
     ORDER BY priority DESC, id`,
    []
  );
}

export function getActiveRulesForStore(storeId: number): Rule[] {
  const rules = getEnabledRules();
  const publishedRules = new Map<string, Rule>();
  const grayRules = new Map<string, Rule>();

  for (const rule of rules) {
    if (rule.status === 'published') {
      publishedRules.set(rule.code, rule);
    } else if (rule.status === 'gray') {
      const grayStoreIds = parseGrayStoreIds(rule);
      if (grayStoreIds.includes(storeId)) {
        grayRules.set(rule.code, rule);
      }
    }
  }

  const result: Rule[] = [];
  for (const code of publishedRules.keys()) {
    result.push(grayRules.get(code) || publishedRules.get(code)!);
  }

  result.sort((a, b) => b.priority - a.priority);
  return result;
}

export function getDraftRules(): Rule[] {
  return getAll<Rule>(
    "SELECT * FROM rules WHERE status = 'draft' ORDER BY code, version DESC",
    []
  );
}

export function getPublishedRules(): Rule[] {
  return getAll<Rule>(
    "SELECT * FROM rules WHERE status = 'published' ORDER BY priority DESC, id",
    []
  );
}

export function createRule(
  name: string,
  code: string,
  description: string,
  priority: number = 50,
  enabled: number = 1,
  config: RuleConfig = {},
  scope: RuleScope = { scriptTypes: [], storeIds: [], allStores: true },
  status: RuleStatus = 'published',
  version?: number,
  parentVersionId?: number
): number {
  const nextVersion = version ?? getLatestVersion(code) + 1;
  const result = runQuery(`
    INSERT INTO rules (name, code, version, status, parent_version_id, description, priority, enabled, config_json, scope_json, gray_store_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
  `, [
    name, code, nextVersion, status, parentVersionId ?? null, description, priority, enabled,
    JSON.stringify(config), JSON.stringify(scope)
  ]);
  return result.lastInsertRowid;
}

export function createNewVersion(
  code: string,
  updates: {
    name?: string;
    description?: string;
    priority?: number;
    config?: RuleConfig;
    scope?: RuleScope;
  },
  status: RuleStatus = 'draft'
): number {
  const latestPublished = getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published' ORDER BY version DESC LIMIT 1",
    [code]
  );

  const baseRule = latestPublished || getOne<Rule>(
    'SELECT * FROM rules WHERE code = ? ORDER BY version DESC LIMIT 1',
    [code]
  );

  if (!baseRule) {
    throw new Error(`Rule code ${code} not found`);
  }

  const newVersion = getLatestVersion(code) + 1;
  const name = updates.name ?? baseRule.name;
  const description = updates.description ?? baseRule.description ?? '';
  const priority = updates.priority ?? baseRule.priority;
  const config = updates.config ?? parseRuleConfig(baseRule);
  const scope = updates.scope ?? parseRuleScope(baseRule);

  return createRule(
    name, code, description, priority, baseRule.enabled, config, scope, status, newVersion, baseRule.id
  );
}

export function updateRule(
  id: number,
  options: {
    name?: string;
    description?: string;
    priority?: number;
    enabled?: number;
    config?: RuleConfig;
    scope?: RuleScope;
    status?: RuleStatus;
    grayStoreIds?: number[];
  }
): boolean {
  const current = getRuleById(id);
  if (!current) return false;

  const name = options.name ?? current.name;
  const description = options.description ?? current.description;
  const priority = options.priority ?? current.priority;
  const enabled = options.enabled ?? current.enabled;
  const config = options.config ? JSON.stringify(options.config) : current.config_json;
  const scope = options.scope ? JSON.stringify(options.scope) : current.scope_json;
  const status = options.status ?? current.status;
  const grayStoreIds = options.grayStoreIds ? JSON.stringify(options.grayStoreIds) : current.gray_store_ids_json;

  const result = runQuery(`
    UPDATE rules SET name = ?, description = ?, priority = ?, enabled = ?, 
           config_json = ?, scope_json = ?, status = ?, gray_store_ids_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name, description, priority, enabled, config, scope, status, grayStoreIds, id]);
  return result.changes > 0;
}

export function publishVersion(
  id: number,
  options?: {
    grayStoreIds?: number[];
  }
): boolean {
  const current = getRuleById(id);
  if (!current) return false;

  if (current.status === 'published') {
    const existingPublished = getOne<Rule>(
      "SELECT * FROM rules WHERE code = ? AND status = 'published' AND id != ?",
      [current.code, current.id]
    );
    if (existingPublished) {
      updateRule(existingPublished.id, { status: 'archived' });
    }
    return true;
  }

  if (options?.grayStoreIds && options.grayStoreIds.length > 0) {
    return updateRule(id, { status: 'gray', grayStoreIds: options.grayStoreIds });
  }

  const existingPublished = getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published' AND id != ?",
    [current.code, current.id]
  );
  if (existingPublished) {
    updateRule(existingPublished.id, { status: 'archived' });
  }

  return updateRule(id, { status: 'published', grayStoreIds: [] });
}

export function rollbackToVersion(
  code: string,
  version: number
): number {
  const targetRule = getRuleByCodeAndVersion(code, version);
  if (!targetRule) {
    throw new Error(`Rule ${code} v${version} not found`);
  }

  const currentPublished = getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published'",
    [code]
  );

  const newVersion = getLatestVersion(code) + 1;
  const newId = createRule(
    targetRule.name, code, targetRule.description ?? '', targetRule.priority, targetRule.enabled,
    parseRuleConfig(targetRule), parseRuleScope(targetRule), 'published', newVersion, targetRule.id
  );

  if (currentPublished) {
    updateRule(currentPublished.id, { status: 'archived' });
  }

  return newId;
}

export function deleteRule(id: number): boolean {
  const result = runQuery('DELETE FROM rules WHERE id = ?', [id]);
  return result.changes > 0;
}

export function parseRuleConfig(rule: Rule): RuleConfig {
  try {
    return JSON.parse(rule.config_json);
  } catch {
    return {};
  }
}

export function parseRuleScope(rule: Rule): RuleScope {
  try {
    const parsed = JSON.parse(rule.scope_json || '{}');
    return {
      scriptTypes: parsed.scriptTypes || [],
      storeIds: parsed.storeIds || [],
      allStores: parsed.allStores !== undefined ? parsed.allStores : true
    };
  } catch {
    return { scriptTypes: [], storeIds: [], allStores: true };
  }
}

export function parseGrayStoreIds(rule: Rule): number[] {
  try {
    const parsed = JSON.parse(rule.gray_store_ids_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
