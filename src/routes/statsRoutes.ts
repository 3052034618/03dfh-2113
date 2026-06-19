import { Router, Request, Response } from 'express';
import { handleAsync } from '../middleware/validation';
import { getStoreStats, getAllStoresStats, getScriptTroubleStats } from '../models/statsModel';

const router = Router();

router.get('/stores', handleAsync(async (req: Request, res: Response) => {
  const stats = getAllStoresStats();
  res.json({
    success: true,
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

  const stats = getStoreStats(storeId);
  if (!stats) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  res.json({
    success: true,
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
  const stats = getScriptTroubleStats();
  res.json({
    success: true,
    data: stats.map(s => ({
      script_id: s.script_id,
      script_name: s.script_name,
      trouble_count: s.trouble_count,
      allocations: s.allocations,
      trouble_rate: s.allocations > 0 ? Math.round((s.trouble_count / s.allocations) * 100) / 100 : 0
    }))
  });
}));

router.get('/summary', handleAsync(async (req: Request, res: Response) => {
  const storeStats = getAllStoresStats();
  const scriptTrouble = getScriptTroubleStats();

  const totalAllocations = storeStats.reduce((sum, s) => sum + s.totalAllocations, 0);
  const avgRefusalRate = storeStats.length > 0
    ? storeStats.reduce((sum, s) => sum + s.crossGenderRefusalRate, 0) / storeStats.length
    : 0;
  const avgOnSiteChanges = storeStats.length > 0
    ? storeStats.reduce((sum, s) => sum + s.averageOnSiteChanges, 0) / storeStats.length
    : 0;

  res.json({
    success: true,
    data: {
      total_stores: storeStats.length,
      total_allocations: totalAllocations,
      average_cross_gender_refusal_rate: Math.round(avgRefusalRate * 10000) / 100,
      average_on_site_changes: Math.round(avgOnSiteChanges * 100) / 100,
      top_troubled_scripts: scriptTrouble.slice(0, 5).map(s => ({
        script_id: s.script_id,
        script_name: s.script_name,
        trouble_count: s.trouble_count,
        allocations: s.allocations
      })),
      insights: generateInsights(storeStats, scriptTrouble)
    }
  });
}));

function generateInsights(
  storeStats: ReturnType<typeof getAllStoresStats>,
  scriptTrouble: ReturnType<typeof getScriptTroubleStats>
): string[] {
  const insights: string[] = [];

  const highRefusalStores = storeStats.filter(s => s.crossGenderRefusalRate > 0.3);
  if (highRefusalStores.length > 0) {
    const names = highRefusalStores.map(s => s.storeName).join('、');
    insights.push(`以下门店反串拒绝率偏高（>30%）：${names}，建议优化约车时的性别配置提示`);
  }

  const highChangeStores = storeStats.filter(s => s.averageOnSiteChanges > 1);
  if (highChangeStores.length > 0) {
    const names = highChangeStores.map(s => s.storeName).join('、');
    insights.push(`以下门店临场换角次数偏多（>1次/场）：${names}，建议加强分角准确度培训`);
  }

  const topTroubled = scriptTrouble.filter(s => s.trouble_count > 0).slice(0, 3);
  if (topTroubled.length > 0) {
    const names = topTroubled.map(s => s.script_name).join('、');
    insights.push(`高频翻车剧本：${names}，建议调整上架提示或销售话术，提前告知玩家角色配置要求`);
  }

  if (insights.length === 0) {
    insights.push('整体运营状况良好，各门店反串拒绝率和临场换角次数均在正常范围内');
  }

  return insights;
}

export default router;
