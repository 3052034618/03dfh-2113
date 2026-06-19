import { getOne, getAll, runQuery } from '../db/database';
import { AllocationRecord, AllocationSuggestion, Player } from '../types';

export function createAllocation(
  storeId: number,
  scriptId: number,
  players: Player[],
  suggestion: AllocationSuggestion,
  crossGenderCount: number
): number {
  const result = runQuery(`
    INSERT INTO allocations (store_id, script_id, players_json, suggestion_json, cross_gender_count, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `, [storeId, scriptId, JSON.stringify(players), JSON.stringify(suggestion), crossGenderCount]);
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
