import { getAll, getOne } from '../db/database';
import { StoreStats } from '../types';

export function getStoreStats(storeId: number): StoreStats | null {
  const storeRow = getOne<{ id: number; name: string }>('SELECT id, name FROM stores WHERE id = ?', [storeId]);
  if (!storeRow) return null;

  const statsRow = getOne<{
    total_allocations: number;
    refusal_rate: number;
    avg_on_site_changes: number;
  }>(`
    SELECT
      COUNT(*) as total_allocations,
      AVG(CASE WHEN cross_gender_count > 0 THEN CAST(cross_gender_refused AS FLOAT) / cross_gender_count ELSE 0 END) as refusal_rate,
      AVG(on_site_changes) as avg_on_site_changes
    FROM allocations
    WHERE store_id = ? AND status = 'completed'
  `, [storeId]);

  const troubledScripts = getAll<{ script_id: number; script_name: string; trouble_count: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      SUM(a.on_site_changes + a.cross_gender_refused) as trouble_count
    FROM allocations a
    JOIN scripts s ON a.script_id = s.id
    WHERE a.store_id = ? AND a.status = 'completed'
    GROUP BY a.script_id
    HAVING trouble_count > 0
    ORDER BY trouble_count DESC
    LIMIT 5
  `, [storeId]);

  return {
    storeId: storeRow.id,
    storeName: storeRow.name,
    totalAllocations: statsRow?.total_allocations || 0,
    crossGenderRefusalRate: statsRow?.refusal_rate || 0,
    averageOnSiteChanges: statsRow?.avg_on_site_changes || 0,
    topTroubledScripts: troubledScripts.map(s => ({
      scriptId: s.script_id,
      scriptName: s.script_name,
      troubleCount: s.trouble_count
    }))
  };
}

export function getAllStoresStats(): StoreStats[] {
  const stores = getAll<{ id: number }>('SELECT id FROM stores ORDER BY id');
  const stats: StoreStats[] = [];
  for (const s of stores) {
    const stat = getStoreStats(s.id);
    if (stat) stats.push(stat);
  }
  return stats;
}

export function getScriptTroubleStats(): { script_id: number; script_name: string; trouble_count: number; allocations: number }[] {
  return getAll<{ script_id: number; script_name: string; trouble_count: number; allocations: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      COALESCE(SUM(a.on_site_changes + a.cross_gender_refused), 0) as trouble_count,
      COUNT(a.id) as allocations
    FROM scripts s
    LEFT JOIN allocations a ON a.script_id = s.id AND a.status = 'completed'
    GROUP BY s.id
    ORDER BY trouble_count DESC
    LIMIT 10
  `);
}
