import { getAll, getOne } from '../db/database';
import { StoreStats, TrendDataPoint, GenderTroubleScript, FilterMeta } from '../types';

export interface StatsFilters {
  storeId?: number;
  scriptId?: number;
  days?: number;
}

function buildWhereClause(filters: StatsFilters, tableAlias: string = 'a'): { clause: string; params: any[] } {
  const conditions: string[] = [`${tableAlias}.status = 'completed'`];
  const params: any[] = [];

  if (filters.storeId !== undefined) {
    conditions.push(`${tableAlias}.store_id = ?`);
    params.push(filters.storeId);
  }
  if (filters.scriptId !== undefined) {
    conditions.push(`${tableAlias}.script_id = ?`);
    params.push(filters.scriptId);
  }
  if (filters.days !== undefined) {
    conditions.push(`${tableAlias}.started_at >= datetime('now', '-${filters.days} days')`);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

function buildFilterMeta(filters: StatsFilters): FilterMeta {
  const parts: string[] = [];
  const meta: FilterMeta = { filterDescription: '全部数据' };

  if (filters.storeId !== undefined) {
    const store = getOne<{ name: string }>('SELECT name FROM stores WHERE id = ?', [filters.storeId]);
    meta.storeId = filters.storeId;
    meta.storeName = store?.name;
    parts.push(store ? `门店「${store.name}」` : `门店ID ${filters.storeId}`);
  }
  if (filters.scriptId !== undefined) {
    const script = getOne<{ name: string }>('SELECT name FROM scripts WHERE id = ?', [filters.scriptId]);
    meta.scriptId = filters.scriptId;
    meta.scriptName = script?.name;
    parts.push(script ? `剧本「${script.name}」` : `剧本ID ${filters.scriptId}`);
  }
  if (filters.days !== undefined) {
    meta.days = filters.days;
    parts.push(`最近${filters.days}天`);
  }

  meta.filterDescription = parts.length > 0 ? parts.join(' · ') : '全部门店·全部剧本·全部时间';
  return meta;
}

export function getStoreStats(storeId: number, days?: number): StoreStats | null {
  return getStoreStatsWithFilters({ storeId, days });
}

export function getStoreStatsWithFilters(filters: StatsFilters): StoreStats | null {
  if (filters.storeId === undefined) return null;

  const storeRow = getOne<{ id: number; name: string }>('SELECT id, name FROM stores WHERE id = ?', [filters.storeId]);
  if (!storeRow) return null;

  const { clause, params } = buildWhereClause(filters);

  const statsRow = getOne<{
    total_allocations: number;
    refusal_rate: number;
    avg_on_site_changes: number;
  }>(`
    SELECT
      COUNT(*) as total_allocations,
      AVG(CASE WHEN cross_gender_count > 0 THEN CAST(cross_gender_refused AS FLOAT) / cross_gender_count ELSE 0 END) as refusal_rate,
      AVG(on_site_changes) as avg_on_site_changes
    FROM allocations a
    ${clause}
  `, params);

  const scriptFilter = filters.scriptId !== undefined ? 'AND a.script_id = ?' : '';
  const scriptParams = filters.scriptId !== undefined ? [...params, filters.scriptId] : params;

  const troubledScripts = getAll<{ script_id: number; script_name: string; trouble_count: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      SUM(a.on_site_changes + a.cross_gender_refused) as trouble_count
    FROM allocations a
    JOIN scripts s ON a.script_id = s.id
    ${clause} ${scriptFilter}
    GROUP BY a.script_id
    HAVING trouble_count > 0
    ORDER BY trouble_count DESC
    LIMIT 5
  `, scriptParams);

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

export function getAllStoresStats(filters: StatsFilters = {}): { meta: FilterMeta; stats: StoreStats[] } {
  const storeQuery = filters.storeId !== undefined
    ? 'SELECT id FROM stores WHERE id = ? ORDER BY id'
    : 'SELECT id FROM stores ORDER BY id';
  const storeParams = filters.storeId !== undefined ? [filters.storeId] : [];

  const stores = getAll<{ id: number }>(storeQuery, storeParams);
  const stats: StoreStats[] = [];

  for (const s of stores) {
    const stat = getStoreStatsWithFilters({ ...filters, storeId: s.id });
    if (stat) stats.push(stat);
  }

  const meta = buildFilterMeta(filters);
  return { meta, stats };
}

export function getScriptTroubleStats(filters: StatsFilters = {}): {
  meta: FilterMeta;
  data: { script_id: number; script_name: string; trouble_count: number; allocations: number }[];
} {
  const { clause, params } = buildWhereClause(filters);

  const data = getAll<{ script_id: number; script_name: string; trouble_count: number; allocations: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      COALESCE(SUM(a.on_site_changes + a.cross_gender_refused), 0) as trouble_count,
      COUNT(a.id) as allocations
    FROM scripts s
    LEFT JOIN allocations a ON a.script_id = s.id ${clause.replace('WHERE', 'AND')}
    GROUP BY s.id
    ORDER BY trouble_count DESC
    LIMIT 10
  `, params);

  const meta = buildFilterMeta(filters);
  return { meta, data };
}

export function getRefusalRateTrend(filters: StatsFilters = {}): { meta: FilterMeta; trend: TrendDataPoint[] } {
  const days = filters.days ?? 30;
  const { clause, params } = buildWhereClause({ ...filters, days });

  const rows = getAll<{ date: string; refusal_rate: number }>(`
    SELECT
      DATE(started_at) as date,
      AVG(CASE WHEN cross_gender_count > 0 THEN CAST(cross_gender_refused AS FLOAT) / cross_gender_count ELSE 0 END) as refusal_rate
    FROM allocations a
    ${clause}
    GROUP BY DATE(started_at)
    ORDER BY date ASC
  `, params);

  const trend = rows.map(r => ({
    date: r.date,
    value: Math.round(r.refusal_rate * 10000) / 100
  }));

  const meta = buildFilterMeta({ ...filters, days });
  return { meta, trend };
}

export function getOnSiteChangesTrend(filters: StatsFilters = {}): { meta: FilterMeta; trend: TrendDataPoint[] } {
  const days = filters.days ?? 30;
  const { clause, params } = buildWhereClause({ ...filters, days });

  const rows = getAll<{ date: string; avg_changes: number }>(`
    SELECT
      DATE(started_at) as date,
      AVG(on_site_changes) as avg_changes
    FROM allocations a
    ${clause}
    GROUP BY DATE(started_at)
    ORDER BY date ASC
  `, params);

  const trend = rows.map(r => ({
    date: r.date,
    value: Math.round(r.avg_changes * 100) / 100
  }));

  const meta = buildFilterMeta({ ...filters, days });
  return { meta, trend };
}

export function getGenderTroubleScripts(filters: StatsFilters = {}, limit: number = 10): {
  meta: FilterMeta;
  scripts: GenderTroubleScript[];
} {
  const { clause, params } = buildWhereClause(filters);
  params.push(limit);

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
      COALESCE(SUM(a.cross_gender_count), 0) as cross_gender_count,
      COALESCE(SUM(a.cross_gender_refused), 0) as cross_gender_refused,
      COALESCE(SUM(a.on_site_changes), 0) as on_site_changes
    FROM scripts s
    INNER JOIN allocations a ON a.script_id = s.id ${clause.replace('WHERE', 'AND')}
    GROUP BY s.id
    HAVING cross_gender_count > 0 OR on_site_changes > 0
    ORDER BY (COALESCE(SUM(a.cross_gender_refused), 0) * 2 + COALESCE(SUM(a.on_site_changes), 0)) DESC
    LIMIT ?
  `, params);

  const scripts = rows.map(r => ({
    scriptId: r.script_id,
    scriptName: r.script_name,
    scriptType: r.script_type,
    allocations: r.allocations,
    crossGenderCount: r.cross_gender_count,
    crossGenderRefused: r.cross_gender_refused,
    onSiteChanges: r.on_site_changes,
    genderTroubleScore: Math.round((r.cross_gender_refused * 2 + r.on_site_changes) * 100) / 100
  }));

  const meta = buildFilterMeta(filters);
  return { meta, scripts };
}

export function getStatsSummary(filters: StatsFilters = {}): {
  meta: FilterMeta;
  totalStores: number;
  totalAllocations: number;
  averageCrossGenderRefusalRate: number;
  averageOnSiteChanges: number;
  topTroubledScripts: { script_id: number; script_name: string; trouble_count: number; allocations: number }[];
  genderTroubleScripts: GenderTroubleScript[];
  insights: string[];
} {
  const meta = buildFilterMeta(filters);
  const { stats: storeStats } = getAllStoresStats(filters);
  const { data: scriptTrouble } = getScriptTroubleStats(filters);
  const { scripts: genderTrouble } = getGenderTroubleScripts(filters, 5);

  const totalAllocations = storeStats.reduce((sum, s) => sum + s.totalAllocations, 0);
  const avgRefusalRate = storeStats.length > 0
    ? storeStats.reduce((sum, s) => sum + s.crossGenderRefusalRate, 0) / storeStats.length
    : 0;
  const avgOnSiteChanges = storeStats.length > 0
    ? storeStats.reduce((sum, s) => sum + s.averageOnSiteChanges, 0) / storeStats.length
    : 0;

  const insights = generateInsights(storeStats, scriptTrouble, genderTrouble, meta);

  return {
    meta,
    totalStores: storeStats.length,
    totalAllocations,
    averageCrossGenderRefusalRate: avgRefusalRate,
    averageOnSiteChanges: avgOnSiteChanges,
    topTroubledScripts: scriptTrouble.slice(0, 5).map(s => ({
      script_id: s.script_id,
      script_name: s.script_name,
      trouble_count: s.trouble_count,
      allocations: s.allocations
    })),
    genderTroubleScripts: genderTrouble,
    insights
  };
}

function generateInsights(
  storeStats: StoreStats[],
  scriptTrouble: { script_id: number; script_name: string; trouble_count: number; allocations: number }[],
  genderTrouble: GenderTroubleScript[],
  meta: FilterMeta
): string[] {
  const insights: string[] = [];
  const scope = meta.filterDescription;

  const highRefusalStores = storeStats.filter(s => s.crossGenderRefusalRate > 0.3);
  if (highRefusalStores.length > 0) {
    const names = highRefusalStores.map(s => s.storeName).join('、');
    insights.push(`【${scope}】以下门店反串拒绝率偏高（>30%）：${names}，建议优化约车时的性别配置提示`);
  }

  const highChangeStores = storeStats.filter(s => s.averageOnSiteChanges > 1);
  if (highChangeStores.length > 0) {
    const names = highChangeStores.map(s => s.storeName).join('、');
    insights.push(`【${scope}】以下门店临场换角次数偏多（>1次/场）：${names}，建议加强分角准确度培训`);
  }

  if (genderTrouble.length > 0) {
    const topScript = genderTrouble[0];
    insights.push(`【${scope}】「${topScript.scriptName}」（${topScript.scriptType}）因性别配置翻车最严重（反串拒绝${topScript.crossGenderRefused}次、临场换角${topScript.onSiteChanges}次），建议调整上架提示或销售话术，提前告知玩家角色配置要求`);
  }

  const topTroubled = scriptTrouble.filter(s => s.trouble_count > 0).slice(0, 3);
  if (topTroubled.length > 0 && genderTrouble.length === 0) {
    const names = topTroubled.map(s => s.script_name).join('、');
    insights.push(`【${scope}】高频翻车剧本：${names}，建议调整上架提示或销售话术`);
  }

  if (insights.length === 0) {
    insights.push(`【${scope}】整体运营状况良好，反串拒绝率和临场换角次数均在正常范围内`);
  }

  return insights;
}
