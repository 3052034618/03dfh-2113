import { getAll, getOne } from '../db/database';
import { StoreStats, TrendDataPoint, GenderTroubleScript, FilterMeta, ComparisonResult, MetricChange, ScriptTroubleChange } from '../types';

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

function parseRawMetrics(row: any) {
  return {
    totalAllocations: row?.total_allocations || 0,
    refusalRate: row?.refusal_rate || 0,
    avgOnSiteChanges: row?.avg_on_site_changes || 0,
    crossGenderCount: row?.cross_gender_count || 0,
  };
}

function getRawAggregateMetrics(filters: StatsFilters) {
  const { clause, params } = buildWhereClause(filters);
  const row = getOne<any>(`
    SELECT
      COUNT(*) as total_allocations,
      AVG(CASE WHEN cross_gender_count > 0 THEN CAST(cross_gender_refused AS FLOAT) / cross_gender_count ELSE 0 END) as refusal_rate,
      AVG(on_site_changes) as avg_on_site_changes,
      COALESCE(SUM(cross_gender_count), 0) as cross_gender_count
    FROM allocations a
    ${clause}
  `, params);
  return parseRawMetrics(row);
}

export function getStoreStats(storeId: number, days?: number): StoreStats | null {
  return getStoreStatsWithFilters({ storeId, days });
}

export function getStoreStatsWithFilters(filters: StatsFilters): StoreStats | null {
  if (filters.storeId === undefined) return null;

  const storeRow = getOne<{ id: number; name: string }>('SELECT id, name FROM stores WHERE id = ?', [filters.storeId]);
  if (!storeRow) return null;

  const { clause, params } = buildWhereClause(filters);

  const statsRow = getOne<any>(`
    SELECT
      COUNT(*) as total_allocations,
      AVG(CASE WHEN cross_gender_count > 0 THEN CAST(cross_gender_refused AS FLOAT) / cross_gender_count ELSE 0 END) as refusal_rate,
      AVG(on_site_changes) as avg_on_site_changes,
      COALESCE(SUM(cross_gender_count), 0) as cross_gender_count
    FROM allocations a
    ${clause}
  `, params);

  const metrics = parseRawMetrics(statsRow);

  const troubledScripts = getAll<{ script_id: number; script_name: string; trouble_count: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      COALESCE(SUM(a.on_site_changes + a.cross_gender_refused), 0) as trouble_count
    FROM allocations a
    JOIN scripts s ON a.script_id = s.id
    ${clause}
    GROUP BY a.script_id
    HAVING trouble_count > 0
    ORDER BY trouble_count DESC
    LIMIT 5
  `, params);

  return {
    storeId: storeRow.id,
    storeName: storeRow.name,
    totalAllocations: metrics.totalAllocations,
    crossGenderRefusalRate: metrics.refusalRate,
    averageOnSiteChanges: metrics.avgOnSiteChanges,
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

  const scriptFilterInJoin = filters.scriptId !== undefined
    ? ` AND s.id = ${filters.scriptId}`
    : '';

  const data = getAll<{ script_id: number; script_name: string; trouble_count: number; allocations: number }>(`
    SELECT
      s.id as script_id,
      s.name as script_name,
      COALESCE(SUM(a.on_site_changes + a.cross_gender_refused), 0) as trouble_count,
      COUNT(a.id) as allocations
    FROM scripts s
    LEFT JOIN allocations a ON a.script_id = s.id ${clause ? clause.replace('WHERE', 'AND') : ''}
    WHERE 1=1 ${scriptFilterInJoin}
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

  const scriptFilter = filters.scriptId !== undefined
    ? ` AND s.id = ${filters.scriptId}`
    : '';

  const finalParams = [...params, limit];

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
    INNER JOIN allocations a ON a.script_id = s.id ${clause ? clause.replace('WHERE', 'AND') : ''}
    WHERE 1=1 ${scriptFilter}
    GROUP BY s.id
    HAVING cross_gender_count > 0 OR on_site_changes > 0
    ORDER BY (COALESCE(SUM(a.cross_gender_refused), 0) * 2 + COALESCE(SUM(a.on_site_changes), 0)) DESC
    LIMIT ?
  `, finalParams);

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

function makeMetricChange(from: number, to: number): MetricChange {
  const diff = Math.round((to - from) * 10000) / 10000;
  const diffPct = from > 0 ? Math.round((diff / from) * 10000) / 100 : 0;
  return { from, to, diff, diffPct };
}

function summarizeMetricChange(prefix: string, label: string, mc: MetricChange, thresholdPct: number = 10): string | null {
  if (Math.abs(mc.diffPct) < thresholdPct && Math.abs(mc.diff) < 0.01) return null;
  const dir = mc.diff > 0 ? '上升' : '下降';
  const arrow = mc.diff > 0 ? '↑' : '↓';
  const pctStr = Math.abs(mc.diffPct).toFixed(1);
  const absStr = Math.abs(mc.diff).toFixed(2);
  return `${prefix}${label}${dir} ${arrow} ${pctStr}%（绝对值 ${absStr}）`;
}

export function compareStatsByPeriod(
  filtersA: StatsFilters,
  filtersB: StatsFilters
): ComparisonResult {
  const metaA = buildFilterMeta(filtersA);
  const metaB = buildFilterMeta(filtersB);

  const metricsA = getRawAggregateMetrics(filtersA);
  const metricsB = getRawAggregateMetrics(filtersB);

  const refusalRate = makeMetricChange(metricsA.refusalRate, metricsB.refusalRate);
  const onSiteChanges = makeMetricChange(metricsA.avgOnSiteChanges, metricsB.avgOnSiteChanges);
  const totalAllocations = makeMetricChange(metricsA.totalAllocations, metricsB.totalAllocations);
  const crossGenderCount = makeMetricChange(metricsA.crossGenderCount, metricsB.crossGenderCount);

  const { scripts: scriptsA } = getGenderTroubleScripts(filtersA, 20);
  const { scripts: scriptsB } = getGenderTroubleScripts(filtersB, 20);

  const scriptMapA = new Map(scriptsA.map(s => [s.scriptId, s]));
  const scriptMapB = new Map(scriptsB.map(s => [s.scriptId, s]));
  const allScriptIds = new Set([...scriptsA.map(s => s.scriptId), ...scriptsB.map(s => s.scriptId)]);

  const changed: ScriptTroubleChange[] = [];
  for (const sid of allScriptIds) {
    const a = scriptMapA.get(sid);
    const b = scriptMapB.get(sid);
    const name = a?.scriptName || b?.scriptName || `剧本#${sid}`;

    const metricPairs: { key: keyof GenderTroubleScript; label: string }[] = [
      { key: 'crossGenderRefused', label: '反串拒绝次数' },
      { key: 'onSiteChanges', label: '临场换角次数' },
      { key: 'genderTroubleScore', label: '性别问题总分' },
    ];

    for (const { key, label } of metricPairs) {
      const av = (a as any)?.[key] || 0;
      const bv = (b as any)?.[key] || 0;
      const diff = bv - av;
      const diffPct = av > 0 ? Math.round((diff / av) * 10000) / 100 : (bv > 0 ? 100 : 0);
      if (Math.abs(diff) >= 1 || Math.abs(diffPct) >= 20) {
        changed.push({
          scriptId: sid,
          scriptName: name,
          metric: label,
          from: av,
          to: bv,
          diff: Math.round(diff * 100) / 100,
          diffPct: Math.round(diffPct * 100) / 100,
        });
      }
    }
  }

  changed.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  const changeReasons: string[] = [];
  const prefix = `【${metaA.filterDescription} → ${metaB.filterDescription}】`;

  const refusalLine = summarizeMetricChange(prefix, '反串拒绝率', refusalRate);
  if (refusalLine) changeReasons.push(refusalLine);

  const changeLine = summarizeMetricChange(prefix, '平均临场换角', onSiteChanges);
  if (changeLine) changeReasons.push(changeLine);

  const allocLine = summarizeMetricChange(prefix, '场次数', totalAllocations, 5);
  if (allocLine) changeReasons.push(allocLine);

  const cgLine = summarizeMetricChange(prefix, '反串总次数', crossGenderCount);
  if (cgLine) changeReasons.push(cgLine);

  if (changed.length > 0) {
    const top = changed.slice(0, 3).map(c => {
      const dir = c.diff > 0 ? '恶化' : '改善';
      return `${c.scriptName}的${c.metric}${dir}（${c.from}→${c.to}，${c.diffPct}%）`;
    }).join('；');
    changeReasons.push(`${prefix}剧本级变化 Top3：${top}`);
  }

  if (refusalRate.diff < 0 && refusalRate.diffPct <= -10) {
    changeReasons.push(`${prefix}反串拒绝率显著下降，可能与规则优化/约车前置沟通有关`);
  } else if (refusalRate.diff > 0 && refusalRate.diffPct >= 10) {
    changeReasons.push(`${prefix}反串拒绝率上升，建议检查门店约车时的性别配置话术`);
  }

  if (onSiteChanges.diff < 0 && onSiteChanges.diffPct <= -10) {
    changeReasons.push(`${prefix}临场换角减少，说明分角准确性提升`);
  } else if (onSiteChanges.diff > 0 && onSiteChanges.diffPct >= 10) {
    changeReasons.push(`${prefix}临场换角增多，可能与玩家临时调整或约车信息不准有关`);
  }

  if (changeReasons.length === 0) {
    changeReasons.push(`${prefix}两个时段各项核心指标基本持平，无显著波动`);
  }

  return {
    meta: {
      periodA: metaA,
      periodB: metaB,
      comparisonDescription: `${metaA.filterDescription}  vs  ${metaB.filterDescription}`,
    },
    crossGenderRefusalRate: refusalRate,
    averageOnSiteChanges: onSiteChanges,
    totalAllocations,
    crossGenderCount,
    genderTroubleScripts: {
      periodA: scriptsA,
      periodB: scriptsB,
      changed,
    },
    changeReasons,
  };
}

export function compareStatsByStore(
  storeIdA: number,
  storeIdB: number,
  commonFilters: StatsFilters = {}
): ComparisonResult {
  const filtersA: StatsFilters = { ...commonFilters, storeId: storeIdA };
  const filtersB: StatsFilters = { ...commonFilters, storeId: storeIdB };
  return compareStatsByPeriod(filtersA, filtersB);
}
