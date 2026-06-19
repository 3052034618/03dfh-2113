import { getAll, getOne } from '../db/database';
import { StoreStats, TrendDataPoint, GenderTroubleScript } from '../types';

export function getStoreStats(storeId: number, days?: number): StoreStats | null {
  const storeRow = getOne<{ id: number; name: string }>('SELECT id, name FROM stores WHERE id = ?', [storeId]);
  if (!storeRow) return null;

  const timeFilter = days ? `AND started_at >= datetime('now', '-${days} days')` : '';

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
    WHERE store_id = ? AND status = 'completed' ${timeFilter}
  `, [storeId]);

  const troubledScripts = getAll<{ script_id: number; script_name: string; trouble_count: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      SUM(a.on_site_changes + a.cross_gender_refused) as trouble_count
    FROM allocations a
    JOIN scripts s ON a.script_id = s.id
    WHERE a.store_id = ? AND a.status = 'completed' ${timeFilter}
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

export function getAllStoresStats(days?: number): StoreStats[] {
  const stores = getAll<{ id: number }>('SELECT id FROM stores ORDER BY id');
  const stats: StoreStats[] = [];
  for (const s of stores) {
    const stat = getStoreStats(s.id, days);
    if (stat) stats.push(stat);
  }
  return stats;
}

export function getScriptTroubleStats(days?: number): { script_id: number; script_name: string; trouble_count: number; allocations: number }[] {
  const timeFilter = days ? `AND a.started_at >= datetime('now', '-${days} days')` : '';
  return getAll<{ script_id: number; script_name: string; trouble_count: number; allocations: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      COALESCE(SUM(a.on_site_changes + a.cross_gender_refused), 0) as trouble_count,
      COUNT(a.id) as allocations
    FROM scripts s
    LEFT JOIN allocations a ON a.script_id = s.id AND a.status = 'completed' ${timeFilter}
    GROUP BY s.id
    ORDER BY trouble_count DESC
    LIMIT 10
  `);
}

export function getRefusalRateTrend(storeId?: number, days: number = 30): TrendDataPoint[] {
  const storeFilter = storeId ? 'AND store_id = ?' : '';
  const params: any[] = [];
  if (storeId) params.push(storeId);

  const rows = getAll<{ date: string; refusal_rate: number }>(`
    SELECT
      DATE(started_at) as date,
      AVG(CASE WHEN cross_gender_count > 0 THEN CAST(cross_gender_refused AS FLOAT) / cross_gender_count ELSE 0 END) as refusal_rate
    FROM allocations
    WHERE status = 'completed' AND started_at >= datetime('now', '-${days} days') ${storeFilter}
    GROUP BY DATE(started_at)
    ORDER BY date ASC
  `, params);

  return rows.map(r => ({
    date: r.date,
    value: Math.round(r.refusal_rate * 10000) / 100
  }));
}

export function getOnSiteChangesTrend(storeId?: number, days: number = 30): TrendDataPoint[] {
  const storeFilter = storeId ? 'AND store_id = ?' : '';
  const params: any[] = [];
  if (storeId) params.push(storeId);

  const rows = getAll<{ date: string; avg_changes: number }>(`
    SELECT
      DATE(started_at) as date,
      AVG(on_site_changes) as avg_changes
    FROM allocations
    WHERE status = 'completed' AND started_at >= datetime('now', '-${days} days') ${storeFilter}
    GROUP BY DATE(started_at)
    ORDER BY date ASC
  `, params);

  return rows.map(r => ({
    date: r.date,
    value: Math.round(r.avg_changes * 100) / 100
  }));
}

export function getGenderTroubleScripts(days?: number, limit: number = 10): GenderTroubleScript[] {
  const timeFilter = days ? `AND a.started_at >= datetime('now', '-${days} days')` : '';
  const rows = getAll<{
    script_id: number;
    script_name: string;
    script_type: string;
    allocations: number;
    cross_gender_count: number;
    cross_gender_refused: number;
    on_site_changes: number;
  }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      s.type as script_type,
      COUNT(a.id) as allocations,
      SUM(a.cross_gender_count) as cross_gender_count,
      SUM(a.cross_gender_refused) as cross_gender_refused,
      SUM(a.on_site_changes) as on_site_changes
    FROM scripts s
    INNER JOIN allocations a ON a.script_id = s.id AND a.status = 'completed' ${timeFilter}
    GROUP BY s.id
    HAVING cross_gender_count > 0 OR on_site_changes > 0
    ORDER BY (COALESCE(SUM(a.cross_gender_refused), 0) * 2 + COALESCE(SUM(a.on_site_changes), 0)) DESC
    LIMIT ?
  `, [limit]);

  return rows.map(r => ({
    scriptId: r.script_id,
    scriptName: r.script_name,
    scriptType: r.script_type,
    allocations: r.allocations,
    crossGenderCount: r.cross_gender_count,
    crossGenderRefused: r.cross_gender_refused,
    onSiteChanges: r.on_site_changes,
    genderTroubleScore: Math.round((r.cross_gender_refused * 2 + r.on_site_changes) * 100) / 100
  }));
}
