import { getOne, getAll, runQuery } from '../db/database';
import { AllocationRecord, AllocationSuggestion, Player, RuleVersionSummary } from '../types';

export function createAllocation(
  storeId: number,
  scriptId: number,
  players: Player[],
  suggestion: AllocationSuggestion,
  crossGenderCount: number,
  ruleVersions: RuleVersionSummary[] = []
): number {
  const result = runQuery(`
    INSERT INTO allocations (store_id, script_id, players_json, suggestion_json, rule_versions_json, cross_gender_count, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
  `, [
    storeId, scriptId, JSON.stringify(players), JSON.stringify(suggestion),
    JSON.stringify(ruleVersions), crossGenderCount
  ]);
  return result.lastInsertRowid;
}

export function getAllocationById(id: number): AllocationRecord | undefined {
  return getOne<AllocationRecord>('SELECT * FROM allocations WHERE id = ?', [id]);
}

export function getAllocationsByStoreId(storeId: number, limit: number = 50): AllocationRecord[] {
  return getAll<AllocationRecord>(
    'SELECT * FROM allocations WHERE store_id = ? ORDER BY created_at DESC LIMIT ?',
    [storeId, limit]
  );
}

export function getAllocationsByFilters(
  filters: {
    storeId?: number;
    scriptId?: number;
    days?: number;
  },
  limit: number = 100
): AllocationRecord[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.storeId !== undefined) {
    conditions.push('store_id = ?');
    params.push(filters.storeId);
  }
  if (filters.scriptId !== undefined) {
    conditions.push('script_id = ?');
    params.push(filters.scriptId);
  }
  if (filters.days !== undefined) {
    conditions.push(`started_at >= datetime('now', '-${filters.days} days')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return getAll<AllocationRecord>(
    `SELECT * FROM allocations ${whereClause} ORDER BY started_at DESC LIMIT ?`,
    params
  );
}

export function updateAllocationFeedback(
  id: number,
  crossGenderRefused: number,
  onSiteChanges: number,
  status: string = 'completed'
): boolean {
  const result = runQuery(`
    UPDATE allocations SET cross_gender_refused = ?, on_site_changes = ?, status = ?
    WHERE id = ?
  `, [crossGenderRefused, onSiteChanges, status, id]);
  return result.changes > 0;
}

export function getAllAllocations(limit: number = 100): AllocationRecord[] {
  return getAll<AllocationRecord>('SELECT * FROM allocations ORDER BY created_at DESC LIMIT ?', [limit]);
}

export function parseRuleVersions(allocation: AllocationRecord): RuleVersionSummary[] {
  try {
    return JSON.parse(allocation.rule_versions_json || '[]');
  } catch {
    return [];
  }
}
