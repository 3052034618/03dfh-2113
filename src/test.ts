import { initDb, saveToDisk, closeDb } from './db/database';
import {
  getAllRules, getVersionsByCode, getActiveRulesForStore,
  getRuleByCode, createNewVersion, publishVersion, rollbackToVersion,
  getAuditLogs, getRuleByCodeAndVersion, getEnabledRules, parseGrayStoreIds,
  getReleasePlans, getReleasePlanById, createReleasePlan, submitReleasePlan,
  approveReleasePlan, rejectReleasePlan, scheduleReleasePlan, pauseReleasePlan,
  resumeReleasePlan, cancelReleasePlan, executeReleasePlan,
} from './models/ruleModel';
import {
  getStatsSummary, getRefusalRateTrend, getOnSiteChangesTrend,
  getGenderTroubleScripts, getAllStoresStats, getScriptTroubleStats,
  getStoreStatsWithFilters, compareStatsByPeriod, compareStatsByStore,
  getGrayEffectBoard,
} from './models/statsModel';
import {
  getAllocationsByFilters, parseRuleVersions,
} from './models/allocationModel';
import { getCharactersByScriptId, getRelationshipsByScriptId, getScriptById } from './models/scriptModel';
import { generateAllocationSuggestion, simulateAllocation, batchSimulateAllocation } from './services/allocationService';
import { filterApplicableRules } from './rules/ruleEngine';
import { Player, BatchSimGroup } from './types';

const assert = (cond: any, msg: string) => {
  if (!cond) {
    console.error(`  ❌ 失败: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✅ ${msg}`);
};

const pass = (msg: string) => console.log(`  ✅ ${msg}`);

async function run() {
  await initDb();

  console.log('🧪 开始 Phase 5 功能测试（发布审批流 + 灰度看板 + 批量模拟 + 口径对齐）...\n');

  // ──────────────────────────────────────────────────────────────
  // 1. 发布计划完整流程
  // ──────────────────────────────────────────────────────────────
  console.log('1️⃣  测试发布审批流程（草稿→提交→审批→定时→暂停→执行）...');

  // 先创建一个草稿版本
  const code = 'lead_character_priority';
  const draftId = createNewVersion(code, { priority: 60 }, 'draft', 'product_manager');
  pass(`创建草稿版本 v${getRuleByCodeAndVersion(code, getVersionsByCode(code)[0].version)?.version}，id=${draftId}`);

  // 创建发布计划（全量发布，草稿状态）
  const planId = createReleasePlan(draftId, { releaseType: 'full' }, 'product_manager');
  const plan = getReleasePlanById(planId)!;
  assert(plan && plan.status === 'draft', `创建发布计划成功，状态=draft，id=${planId}`);

  // 提交审核
  const submitOk = submitReleasePlan(planId, 'product_manager');
  const planSubmitted = getReleasePlanById(planId)!;
  assert(submitOk && planSubmitted.status === 'submitted', '提交审核成功，状态=submitted');
  assert(planSubmitted.submittedBy === 'product_manager', '记录了提交人');

  // 审批通过
  const approveOk = approveReleasePlan(planId, 'ops_director', '优先级调整合理，同意发布');
  const planApproved = getReleasePlanById(planId)!;
  assert(approveOk && planApproved.status === 'approved', '审批通过，状态=approved');
  assert(planApproved.approvedBy === 'ops_director', '记录了审批人');
  assert(planApproved.reviewComment === '优先级调整合理，同意发布', '记录了审批意见');

  // 设置定时发布
  const futureTime = new Date(Date.now() + 86400000).toISOString();
  const schedOk = scheduleReleasePlan(planId, futureTime, 'ops_director');
  const planScheduled = getReleasePlanById(planId)!;
  assert(schedOk && planScheduled.status === 'scheduled', '设置定时发布成功，状态=scheduled');
  assert(planScheduled.scheduledAt !== undefined, '记录了 scheduledAt');

  // 暂停
  const pauseOk = pauseReleasePlan(planId, 'ops_director');
  const planPaused = getReleasePlanById(planId)!;
  assert(pauseOk && planPaused.status === 'paused', '暂停成功，状态=paused');

  // 恢复
  const resumeOk = resumeReleasePlan(planId, 'ops_director');
  const planResumed = getReleasePlanById(planId)!;
  assert(resumeOk && planResumed.status === 'scheduled', '恢复成功，状态=scheduled');

  // 立即执行发布
  const execOk = executeReleasePlan(planId, 'ops_director');
  const planExecuted = getReleasePlanById(planId)!;
  assert(execOk && planExecuted.status === 'published', '执行发布成功，状态=published');
  assert(planExecuted.publishedBy === 'ops_director', '记录了发布人');

  const publishedRule = getRuleByCode(code)!;
  assert(publishedRule.status === 'published' && publishedRule.id === draftId, '对应的规则版本已切换为 published');

  // 再测一条灰度发布计划 + 取消
  const code2 = 'hardcore_reasoning_match';
  const draftId2 = createNewVersion(code2, { priority: 70 }, 'draft', 'product_manager');
  const planId2 = createReleasePlan(draftId2, {
    releaseType: 'gray',
    grayStoreIds: [1, 2],
  }, 'product_manager');
  const plan2 = getReleasePlanById(planId2)!;
  assert(plan2.releaseType === 'gray' && plan2.grayStoreIds.length === 2, `灰度发布计划创建成功，影响 ${plan2.grayStoreIds.length} 家门店`);

  submitReleasePlan(planId2, 'product_manager');
  rejectReleasePlan(planId2, 'ops_director', '先做小范围验证再提交');
  const planRejected = getReleasePlanById(planId2)!;
  assert(planRejected.status === 'rejected', '审批拒绝成功，状态=rejected');

  // 取消一条
  const planId3 = createReleasePlan(draftId2, { releaseType: 'gray', grayStoreIds: [3] }, 'product_manager');
  const cancelOk = cancelReleasePlan(planId3, 'product_manager', '优先级冲突，暂缓');
  const planCancelled = getReleasePlanById(planId3)!;
  assert(cancelOk && planCancelled.status === 'cancelled', '取消发布计划成功，状态=cancelled');

  // 列表查询
  const allPlans = getReleasePlans();
  const submittedPlans = getReleasePlans({ status: 'published' });
  pass(`发布计划列表共 ${allPlans.length} 条，其中 published 状态 ${submittedPlans.length} 条`);
  assert(allPlans.length >= 3, '发布计划列表至少 3 条');

  // ──────────────────────────────────────────────────────────────
  // 2. 操作日志按动作筛选 + 回滚记录显示灰度门店
  // ──────────────────────────────────────────────────────────────
  console.log('\n2️⃣  测试操作日志按动作筛选 & 回滚记录带灰度门店...');

  const actionList: string[] = ['create_version', 'submit_review', 'approve_release', 'publish_full', 'cancel_release'];
  for (const act of actionList) {
    const logs = getAuditLogs({ action: act as any });
    assert(Array.isArray(logs), `按 action=${act} 筛选返回数组（${logs.length} 条）`);
  }

  // 发布/回滚记录含操作人、时间、影响门店
  const publishLogs = getAuditLogs({ action: 'publish_full' });
  if (publishLogs.length > 0) {
    const log = publishLogs[0];
    assert(log.operator && log.createdAt, '发布记录含操作人、时间');
    assert(Array.isArray(log.affectedStoreIds), '发布记录含 affectedStoreIds 数组');
  }
  pass(`发布类日志共 ${publishLogs.length} 条，字段完整`);

  // 回滚记录 - 先触发一次回滚（age_appropriateness 之前回滚过，但再确认一次）
  const rollbackLogs = getAuditLogs({ action: 'rollback' });
  if (rollbackLogs.length > 0) {
    const rb = rollbackLogs[0];
    assert(Array.isArray(rb.affectedStoreIds), `回滚记录含 affectedStoreIds（${rb.affectedStoreIds.length} 家门店）`);
    assert(rb.detail?.targetVersion !== undefined, `回滚记录 detail.targetVersion = ${rb.detail.targetVersion}`);
    pass(`回滚日志：操作人=${rb.operator}, 受影响门店=${rb.affectedStoreIds.join(',') || '无'}`);
  }

  const submitLogs = getAuditLogs({ action: 'submit_review' });
  pass(`提交审核类日志共 ${submitLogs.length} 条`);

  // 按操作人筛选
  const pmLogs = getAuditLogs({ operator: 'product_manager' });
  pass(`product_manager 操作日志共 ${pmLogs.length} 条`);

  // ──────────────────────────────────────────────────────────────
  // 3. 灰度效果看板
  // ──────────────────────────────────────────────────────────────
  console.log('\n3️⃣  测试灰度效果看板（灰度组 vs 对照组）...');

  const board = getGrayEffectBoard('cross_gender_willingness', 30);
  assert(board !== null, '获取灰度效果看板成功');

  assert(board!.meta.ruleCode === 'cross_gender_willingness', '看板 meta 含 ruleCode');
  assert(board!.meta.grayStoreCount > 0 && board!.meta.controlStoreCount > 0,
    `灰度组 ${board!.meta.grayStoreCount} 家 / 对照组 ${board!.meta.controlStoreCount} 家`);
  assert(board!.meta.filterDescription && board!.meta.filterDescription.includes('灰度效果对比'),
    `filterDescription 描述清晰：${board!.meta.filterDescription}`);

  assert(board!.grayGroup.totalAllocations >= 0, '灰度组总场次已计算');
  assert(board!.controlGroup.totalAllocations >= 0, '对照组总场次已计算');
  assert(board!.grayGroup.troubledScripts.length <= 5, '灰度组问题剧本最多 5 条');
  assert(board!.controlGroup.troubledScripts.length <= 5, '对照组问题剧本最多 5 条');

  assert(typeof board!.diff.crossGenderRefusalRate.diff === 'number', 'diff.refusalRate.diff 是数字');
  assert(typeof board!.diff.averageOnSiteChanges.diffPct === 'number', 'diff.onSiteChanges.diffPct 是数字');
  assert(typeof board!.diff.totalAllocations.diff === 'number', 'diff.totalAllocations.diff 是数字');

  assert(Array.isArray(board!.hitRuleVersions.gray), '灰度组命中规则版本是数组');
  assert(Array.isArray(board!.hitRuleVersions.control), '对照组命中规则版本是数组');
  assert(board!.hitRuleVersions.gray.length > 0 && board!.hitRuleVersions.control.length > 0,
    `两组都有命中规则：gray=${board!.hitRuleVersions.gray.length} 条, control=${board!.hitRuleVersions.control.length} 条`);

  const grayCgRule = board!.hitRuleVersions.gray.find(r => r.code === 'cross_gender_willingness');
  const ctrlCgRule = board!.hitRuleVersions.control.find(r => r.code === 'cross_gender_willingness');
  assert(grayCgRule && ctrlCgRule && grayCgRule.version !== ctrlCgRule.version,
    `灰度组 cross_gender_willingness v${grayCgRule?.version} vs 对照组 v${ctrlCgRule?.version}，版本不同`);

  assert(Array.isArray(board!.insights) && board!.insights.length >= 2,
    `自动生成 ${board!.insights.length} 条业务洞察`);

  // 非灰度规则返回 null
  const boardNull = getGrayEffectBoard('lead_character_priority', 30);
  assert(boardNull === null, '非灰度规则返回 null（404 场景）');

  // ──────────────────────────────────────────────────────────────
  // 4. 单店+剧本筛选口径彻底对齐
  // ──────────────────────────────────────────────────────────────
  console.log('\n4️⃣  测试单店+剧本筛选口径彻底对齐...');

  const storeId = 1;
  const scriptId = 2;
  const days = 30;

  // 单店统计
  const s1 = getStoreStatsWithFilters({ storeId, scriptId, days });
  assert(s1 !== null, '单店统计查询成功');

  // 门店全表统计的同一家门店同剧本，结果一致
  const allStores = getAllStoresStats({ storeId, scriptId, days });
  const fromAllStores = allStores.stats.find(s => s.storeId === storeId);
  assert(fromAllStores !== undefined, 'getAllStoresStats 也返回了该门店');
  assert(s1!.totalAllocations === fromAllStores!.totalAllocations,
    `totalAllocations 一致：${s1!.totalAllocations} === ${fromAllStores!.totalAllocations}`);
  assert(Math.abs(s1!.crossGenderRefusalRate - fromAllStores!.crossGenderRefusalRate) < 0.001,
    `crossGenderRefusalRate 一致`);
  assert(Math.abs(s1!.averageOnSiteChanges - fromAllStores!.averageOnSiteChanges) < 0.001,
    `averageOnSiteChanges 一致`);

  // summary 也对得上
  const summary = getStatsSummary({ storeId, scriptId, days });
  assert(summary.totalAllocations === s1!.totalAllocations,
    `summary.totalAllocations(${summary.totalAllocations}) === 单店统计(${s1!.totalAllocations})`);

  // 趋势接口与 summary 的时间范围一致（都 30 天）
  const trendR = getRefusalRateTrend({ storeId, scriptId, days });
  const trendO = getOnSiteChangesTrend({ storeId, scriptId, days });
  assert(trendR.meta.days === days && trendO.meta.days === days, '趋势接口天数一致');
  assert(trendR.meta.filterDescription === trendO.meta.filterDescription,
    `趋势接口 filterDescription 一致：${trendR.meta.filterDescription}`);

  // 问题剧本排行带剧本筛选只返回这一个剧本
  const gt = getGenderTroubleScripts({ storeId, scriptId, days }, 10);
  const allSameScript = gt.scripts.every(s => s.scriptId === scriptId);
  assert(allSameScript || gt.scripts.length === 0, `性别问题排行只含剧本 ${scriptId}（${gt.scripts.length} 条）`);

  const st = getScriptTroubleStats({ storeId, scriptId, days });
  const allSameScript2 = st.data.every(d => d.script_id === scriptId);
  assert(allSameScript2 || st.data.length === 0, `剧本问题统计只含剧本 ${scriptId}（${st.data.length} 条）`);

  // 单店统计的 topTroubledScripts 也只包含该剧本
  const allTopSame = s1!.topTroubledScripts.every(t => t.scriptId === scriptId);
  assert(allTopSame || s1!.topTroubledScripts.length === 0,
    `单店统计 topTroubledScripts 只含剧本 ${scriptId}`);

  pass('单店+剧本筛选下：summary / 单店统计 / 全表门店统计 / 趋势 / 问题排行 全部口径一致 ✓');

  // ──────────────────────────────────────────────────────────────
  // 5. 批量模拟试算
  // ──────────────────────────────────────────────────────────────
  console.log('\n5️⃣  测试批量模拟试算（多组玩家，多门店）...');

  const playerGroups: BatchSimGroup[] = [
    {
      groupId: 'g1',
      groupName: '周末情感本-门店1',
      storeId: 1,
      scriptId: 1,
      players: [
        { name: '张三', gender: 'male', age: 28, is_regular: true, courage_level: 4, reasoning_level: 3, emotional_tolerance: 5 },
        { name: '李四', gender: 'female', age: 26, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 4 },
        { name: '王五', gender: 'male', age: 30, is_regular: false, courage_level: 5, reasoning_level: 2, emotional_tolerance: 3 },
        { name: '赵六', gender: 'female', age: 22, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 5 },
        { name: '孙七', gender: 'male', age: 17, is_regular: false, courage_level: 3, reasoning_level: 3, emotional_tolerance: 2 },
        { name: '周八', gender: 'female', age: 32, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 5 },
      ],
    },
    {
      groupId: 'g2',
      groupName: '周末恐怖本-门店2',
      storeId: 2,
      scriptId: 2,
      players: [
        { name: '陈一', gender: 'female', age: 25, is_regular: false, courage_level: 5, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '林二', gender: 'male', age: 27, is_regular: true, courage_level: 4, reasoning_level: 5, emotional_tolerance: 2 },
        { name: '黄三', gender: 'female', age: 23, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 4 },
        { name: '徐四', gender: 'male', age: 29, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
      ],
    },
    {
      groupId: 'g3',
      groupName: '硬核内测-门店3',
      storeId: 3,
      scriptId: 3,
      players: [
        { name: '钱甲', gender: 'male', age: 31, is_regular: true, courage_level: 3, reasoning_level: 5, emotional_tolerance: 2 },
        { name: '吴乙', gender: 'female', age: 28, is_regular: true, courage_level: 2, reasoning_level: 5, emotional_tolerance: 3 },
        { name: '郑丙', gender: 'male', age: 35, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 2 },
        { name: '冯丁', gender: 'female', age: 26, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '陈戊', gender: 'male', age: 24, is_regular: true, courage_level: 4, reasoning_level: 5, emotional_tolerance: 3 },
        { name: '褚己', gender: 'female', age: 30, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 4 },
      ],
    },
  ];

  const batchResult = batchSimulateAllocation({
    baselineStoreId: 3,  // 基准：门店3（非灰度，旧版规则）
    compareMode: 'gray',
    groups: playerGroups,
  });

  assert(batchResult.groups.length === 3, `批量模拟返回 ${batchResult.groups.length} 组，与输入一致`);
  assert(batchResult.baselineStoreId === 3, 'baselineStoreId 正确');
  assert(batchResult.compareMode === 'gray', 'compareMode 正确');

  // 每组都有完整字段
  for (const g of batchResult.groups) {
    assert(g.groupId && g.groupName, `组 ${g.groupId} 有 id 和 name`);
    assert(typeof g.totalScore === 'number' && g.totalScore > 0, `组 ${g.groupId} 总分=${g.totalScore}`);
    assert(typeof g.crossGenderCount === 'number', `组 ${g.groupId} 反串数=${g.crossGenderCount}`);
    assert(typeof g.scoreDiffVsBaseline === 'number', `组 ${g.groupId} scoreDiffVsBaseline=${g.scoreDiffVsBaseline}`);
    assert(Array.isArray(g.hitRuleVersions) && g.hitRuleVersions.length > 0,
      `组 ${g.groupId} 命中 ${g.hitRuleVersions.length} 条规则版本`);
    assert(Array.isArray(g.riskTips), `组 ${g.groupId} 有 ${g.riskTips.length} 条风险提示`);
    assert(typeof g.roleChangesCount === 'number', `组 ${g.groupId} roleChangesCount=${g.roleChangesCount}`);
    assert(Array.isArray(g.playerScoreDiffs) && g.playerScoreDiffs.length > 0,
      `组 ${g.groupId} 有 ${g.playerScoreDiffs.length} 个玩家分数差异`);
  }

  // overallSummary
  const s = batchResult.overallSummary;
  assert(s.totalGroups === 3, `overallSummary.totalGroups = ${s.totalGroups}`);
  assert(s.improvedCount + s.declinedCount <= 3, 'improved + declined <= total');
  assert(typeof s.avgScoreDiff === 'number', 'avgScoreDiff 是数字');
  assert(typeof s.avgCrossGenderDiff === 'number', 'avgCrossGenderDiff 是数字');
  assert(typeof s.highRiskCount === 'number', 'highRiskCount 是数字');

  assert(Array.isArray(batchResult.overallInsights) && batchResult.overallInsights.length >= 1,
    `overallInsights 有 ${batchResult.overallInsights.length} 条`);

  pass(`批量模拟汇总：改善 ${s.improvedCount} 组 / 下降 ${s.declinedCount} 组 / 高风险 ${s.highRiskCount} 组`);

  // 再验证一下 gray 模式下，灰度门店的 cross_gender_willingness 版本和基准不同
  const g1 = batchResult.groups.find(g => g.groupId === 'g1')!; // 门店1，灰度
  const g1Cg = g1.hitRuleVersions.find(r => r.code === 'cross_gender_willingness');
  const g3 = batchResult.groups.find(g => g.groupId === 'g3')!; // 门店3，非灰度
  const g3Cg = g3.hitRuleVersions.find(r => r.code === 'cross_gender_willingness');
  assert(g1Cg && g3Cg && g1Cg.version !== g3Cg.version,
    `灰度门店1 cross_gender_willingness v${g1Cg?.version} vs 基准门店3 v${g3Cg?.version}，版本不同 ✓`);

  // ──────────────────────────────────────────────────────────────
  // 6. Phase 2/3/4 回归
  // ──────────────────────────────────────────────────────────────
  console.log('\n6️⃣  回归测试（类型规则、版本管理、对比视图）...');

  const emoRules = filterApplicableRules(getEnabledRules(), 'emotional', 1);
  const emoCodes = new Set(emoRules.map(r => r.code));
  assert(!emoCodes.has('horror_courage_match'), '情感本不含恐怖专属规则');

  const hb = getGrayEffectBoard('cross_gender_willingness', 7);
  assert(hb !== null, '7天看板也能返回');

  const cmp = compareStatsByStore(1, 2, { days: 30 });
  assert(cmp.meta.periodA.storeId === 1 && cmp.meta.periodB.storeId === 2, '门店对比仍正常');

  const versions = getVersionsByCode('gender_match');
  assert(versions.length >= 2, `gender_match 仍有 ${versions.length} 个版本`);

  pass('Phase 2/3/4 核心功能回归正常 ✓');

  console.log('\n🎉 Phase 5 所有测试通过！发布审批流、操作日志、灰度看板、批量模拟、筛选口径全部正常。');

  saveToDisk();
  closeDb();
}

run().catch(err => {
  console.error('❌ 测试异常:', err);
  process.exit(1);
});
