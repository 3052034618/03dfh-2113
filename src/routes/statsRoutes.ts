import { Router, Request, Response } from 'express';
import { handleAsync } from '../middleware/validation';
import {
  getStoreStats,
  getAllStoresStats,
  getScriptTroubleStats,
  getRefusalRateTrend,
  getOnSiteChangesTrend,
  getGenderTroubleScripts,
  getStatsSummary,
  compareStatsByPeriod,
  compareStatsByStore,
  StatsFilters
} from '../models/statsModel';

const router = Router();

function parseFilters(req: Request): StatsFilters {
  const filters: StatsFilters = {};
  const storeId = req.query.store_id ? parseInt(req.query.store_id as string) : undefined;
  const scriptId = req.query.script_id ? parseInt(req.query.script_id as string) : undefined;
  const days = req.query.days ? parseInt(req.query.days as string) : undefined;

  if (storeId !== undefined && !isNaN(storeId)) filters.storeId = storeId;
  if (scriptId !== undefined && !isNaN(scriptId)) filters.scriptId = scriptId;
  if (days !== undefined && !isNaN(days)) filters.days = days;

  return filters;
}

router.get('/stores', handleAsync(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const { meta, stats } = getAllStoresStats(filters);

  res.json({
    success: true,
    meta,
    data: stats.map(s => ({
      store_id: s.storeId,
      store_name: s.storeName,
      total_allocations: s.totalAllocations,
      cross_gender_refusal_rate: Math.round(s.crossGenderRefusalRate * 10000) / 100,
      average_on_site_changes: Math.round(s.averageOnSiteChanges * 100) / 100,
      top_troubled_scripts: s.topTroubledScripts.map(t => ({
        script_id: t.scriptId,
        script_name: t.scriptName,
        trouble_count: t.troubleCount
      }))
    }))
  });
}));

router.get('/stores/:storeId', handleAsync(async (req: Request, res: Response) => {
  const storeId = parseInt(req.params.storeId);
  if (isNaN(storeId)) {
    res.status(400).json({ success: false, error: '无效的门店ID' });
    return;
  }

  const filters = parseFilters(req);
  filters.storeId = storeId;

  const stats = getStoreStats(storeId, filters.days);
  if (!stats) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  const { meta } = getAllStoresStats(filters);

  res.json({
    success: true,
    meta,
    data: {
      store_id: stats.storeId,
      store_name: stats.storeName,
      total_allocations: stats.totalAllocations,
      cross_gender_refusal_rate: Math.round(stats.crossGenderRefusalRate * 10000) / 100,
      average_on_site_changes: Math.round(stats.averageOnSiteChanges * 100) / 100,
      top_troubled_scripts: stats.topTroubledScripts.map(t => ({
        script_id: t.scriptId,
        script_name: t.scriptName,
        trouble_count: t.troubleCount
      }))
    }
  });
}));

router.get('/scripts/trouble', handleAsync(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const { meta, data } = getScriptTroubleStats(filters);

  res.json({
    success: true,
    meta,
    data: data.map(s => ({
      script_id: s.script_id,
      script_name: s.script_name,
      trouble_count: s.trouble_count,
      allocations: s.allocations,
      trouble_rate: s.allocations > 0 ? Math.round((s.trouble_count / s.allocations) * 100) / 100 : 0
    }))
  });
}));

router.get('/trends/refusal-rate', handleAsync(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  if (filters.days === undefined) filters.days = 30;

  const { meta, trend } = getRefusalRateTrend(filters);

  res.json({
    success: true,
    meta,
    data: {
      metric: 'cross_gender_refusal_rate',
      trend
    }
  });
}));

router.get('/trends/on-site-changes', handleAsync(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  if (filters.days === undefined) filters.days = 30;

  const { meta, trend } = getOnSiteChangesTrend(filters);

  res.json({
    success: true,
    meta,
    data: {
      metric: 'average_on_site_changes',
      trend
    }
  });
}));

router.get('/gender-trouble', handleAsync(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

  const { meta, scripts } = getGenderTroubleScripts(filters, isNaN(limit) ? 10 : limit);

  res.json({
    success: true,
    meta,
    data: scripts
  });
}));

router.get('/summary', handleAsync(async (req: Request, res: Response) => {
  const filters = parseFilters(req);
  const summary = getStatsSummary(filters);

  res.json({
    success: true,
    meta: summary.meta,
    data: {
      total_stores: summary.totalStores,
      total_allocations: summary.totalAllocations,
      average_cross_gender_refusal_rate: Math.round(summary.averageCrossGenderRefusalRate * 10000) / 100,
      average_on_site_changes: Math.round(summary.averageOnSiteChanges * 100) / 100,
      top_troubled_scripts: summary.topTroubledScripts,
      gender_trouble_scripts: summary.genderTroubleScripts,
      insights: summary.insights
    }
  });
}));

router.get('/compare/period', handleAsync(async (req: Request, res: Response) => {
  const aDays = req.query.a_days;
  const bDays = req.query.b_days;

  if (aDays === undefined || bDays === undefined) {
    res.status(400).json({ success: false, error: '缺少必要参数：a_days 和 b_days' });
    return;
  }

  const filtersA: StatsFilters = {};
  const filtersB: StatsFilters = {};

  const aStoreId = req.query.a_store_id ? Number(req.query.a_store_id) : undefined;
  const aScriptId = req.query.a_script_id ? Number(req.query.a_script_id) : undefined;
  const aDaysNum = Number(aDays);
  if (aStoreId !== undefined && !isNaN(aStoreId)) filtersA.storeId = aStoreId;
  if (aScriptId !== undefined && !isNaN(aScriptId)) filtersA.scriptId = aScriptId;
  if (!isNaN(aDaysNum)) filtersA.days = aDaysNum;

  const bStoreId = req.query.b_store_id ? Number(req.query.b_store_id) : undefined;
  const bScriptId = req.query.b_script_id ? Number(req.query.b_script_id) : undefined;
  const bDaysNum = Number(bDays);
  if (bStoreId !== undefined && !isNaN(bStoreId)) filtersB.storeId = bStoreId;
  if (bScriptId !== undefined && !isNaN(bScriptId)) filtersB.scriptId = bScriptId;
  if (!isNaN(bDaysNum)) filtersB.days = bDaysNum;

  const result = compareStatsByPeriod(filtersA, filtersB);
  res.json({ success: true, data: result });
}));

router.get('/compare/store', handleAsync(async (req: Request, res: Response) => {
  const storeIdA = req.query.store_id_a;
  const storeIdB = req.query.store_id_b;

  if (storeIdA === undefined || storeIdB === undefined) {
    res.status(400).json({ success: false, error: '缺少必要参数：store_id_a 和 store_id_b' });
    return;
  }

  const commonFilters: StatsFilters = {};
  const scriptId = req.query.script_id ? Number(req.query.script_id) : undefined;
  const days = req.query.days ? Number(req.query.days) : undefined;
  if (scriptId !== undefined && !isNaN(scriptId)) commonFilters.scriptId = scriptId;
  if (days !== undefined && !isNaN(days)) commonFilters.days = days;

  const result = compareStatsByStore(Number(storeIdA), Number(storeIdB), commonFilters);
  res.json({ success: true, data: result });
}));

export default router;
