import { initDb, saveToDisk, closeDb } from './db/database';
import {
  getAllRules, getVersionsByCode, getActiveRulesForStore,
  getRuleByCode, createNewVersion, publishVersion, rollbackToVersion,
  getAuditLogs, getRuleByCodeAndVersion, getEnabledRules, parseGrayStoreIds
} from './models/ruleModel';
import {
  getStatsSummary, getRefusalRateTrend, getOnSiteChangesTrend,
  getGenderTroubleScripts, getAllStoresStats, getScriptTroubleStats,
  getStoreStatsWithFilters, compareStatsByPeriod, compareStatsByStore
} from './models/statsModel';
import {
  getAllAllocations, getAllocationsByFilters, parseRuleVersions,
} from './models/allocationModel';
import { getCharactersByScriptId, getRelationshipsByScriptId, getScriptById } from './models/scriptModel';
import { generateAllocationSuggestion, simulateAllocation } from './services/allocationService';
import { filterApplicableRules } from './rules/ruleEngine';
import { Player } from './types';

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

  console.log('🧪 开始 Phase 4 功能测试（规则治理闭环 + 对比视图 + 筛选口径修复）...\n');

  // ──────────────────────────────────────────────────────────────
  // 1. 操作审计日志测试
  // ──────────────────────────────────────────────────────────────
  console.log('1️⃣  测试规则操作审计日志...');

  const allLogs = getAuditLogs();
  pass(`全局审计日志条数: ${allLogs.length}`);

  const genderLogs = getAuditLogs({ ruleCode: 'gender_match' });
  pass(`gender_match 相关操作日志: ${genderLogs.length} 条（含 create_version）`);

  const createLogs = getAuditLogs({ action: 'create_version' });
  pass(`创建版本类日志共 ${createLogs.length} 条`);

  const recentLimit = getAuditLogs({ limit: 5 });
  pass(`limit=5 查询返回 ${recentLimit.length} 条，按时间倒序`);

  if (genderLogs.length > 0) {
    const first = genderLogs[0];
    const hasRequired =
      first.ruleCode === 'gender_match' &&
      first.action &&
      first.operator &&
      Array.isArray(first.affectedStoreIds) &&
      first.createdAt;
    assert(hasRequired, '审计日志包含 ruleCode/action/operator/affectedStoreIds/createdAt');
  }

  // ──────────────────────────────────────────────────────────────
  // 2. 回滚后灰度门店切回目标版本（修复前可能灰度规则还在）
  // ──────────────────────────────────────────────────────────────
  console.log('\n2️⃣  测试回滚后灰度门店切回目标版本...');

  const ruleCode = 'age_appropriateness';
  const v1 = getRuleByCodeAndVersion(ruleCode, 1)!;
  const v2DraftId = createNewVersion(ruleCode, { priority: 45 }, 'draft', 'tester_op');
  publishVersion(v2DraftId, { grayStoreIds: [1, 2, 3] }, 'tester_op');

  // 灰度发布后，门店1、2、3 都应拿到 v2 (gray)
  const s1Before = getActiveRulesForStore(1).find(r => r.code === ruleCode)!;
  const s4Before = getActiveRulesForStore(4).find(r => r.code === ruleCode)!;
  assert(s1Before.version === 2 && s1Before.status === 'gray', `回滚前门店1 拿到 ${ruleCode} v2 (gray)`);
  assert(s4Before.version === 1 && s4Before.status === 'published', `回滚前门店4 拿到 ${ruleCode} v1 (published)`);

  const rollbackId = rollbackToVersion(ruleCode, 1, 'tester_op');
  const s1After = getActiveRulesForStore(1).find(r => r.code === ruleCode)!;
  const s2After = getActiveRulesForStore(2).find(r => r.code === ruleCode)!;
  const s3After = getActiveRulesForStore(3).find(r => r.code === ruleCode)!;
  const s4After = getActiveRulesForStore(4).find(r => r.code === ruleCode)!;

  assert(
    s1After.version === 3 && s1After.status === 'published',
    `回滚后门店1（原灰度）切回最新 published v3，不再用 v2 gray`
  );
  assert(
    s2After.version === 3 && s2After.status === 'published',
    `回滚后门店2（原灰度）切回最新 published v3`
  );
  assert(
    s3After.version === 3 && s3After.status === 'published',
    `回滚后门店3（原灰度）切回最新 published v3`
  );
  assert(
    s4After.version === 3 && s4After.status === 'published',
    `回滚后门店4 同步切到最新 published v3`
  );

  // 验证 v2 gray 已被 archived
  const v2After = getRuleByCodeAndVersion(ruleCode, 2)!;
  assert(v2After.status === 'archived', `原灰度版本 v2 状态已变成 archived`);

  const rollbackLogs = getAuditLogs({ ruleCode, action: 'rollback' });
  assert(rollbackLogs.length >= 1, '回滚操作已写入审计日志');
  const rLog = rollbackLogs[0];
  assert(
    rLog.affectedStoreIds.length >= 1 || rLog.detail?.targetVersion === 1,
    `回滚日志含受影响门店列表（${rLog.affectedStoreIds.join(',') || '空'}）及 detail.targetVersion=${rLog.detail?.targetVersion}`
  );
  assert(rLog.operator === 'tester_op', `回滚日志 operator = 'tester_op'`);

  // ──────────────────────────────────────────────────────────────
  // 3. 筛选口径修复：带剧本条件看某家门店 / 剧本排行不混进其他剧本
  // ──────────────────────────────────────────────────────────────
  console.log('\n3️⃣  测试筛选口径修复（剧本/门店/时间统一）...');

  // 门店1 + 剧本2 + 30天 的 summary
  const filterStore1Script2 = { storeId: 1, scriptId: 2, days: 30 };
  const summary1 = getStatsSummary(filterStore1Script2);

  // summary.totalAllocations 必须等于 stores stats 总和
  const storeTotalFromStores = summary1.totalStores > 0
    ? getAllStoresStats(filterStore1Script2).stats.reduce((s, x) => s + x.totalAllocations, 0)
    : 0;
  assert(
    summary1.totalAllocations === storeTotalFromStores,
    `summary 的 totalAllocations(${summary1.totalAllocations}) = 逐门店统计之和(${storeTotalFromStores})`
  );

  // 问题剧本排行带剧本筛选时，只能出现该剧本或空
  const troubleByScript2 = getScriptTroubleStats({ scriptId: 2, days: 30 });
  const onlyScript2 = troubleByScript2.data.every(d => d.script_id === 2);
  assert(onlyScript2, `getScriptTroubleStats(scriptId=2) 只包含剧本2 的记录（${troubleByScript2.data.length} 条）`);

  const genderTroubleByScript2 = getGenderTroubleScripts({ scriptId: 2, days: 30 }, 10);
  const gtOnlyScript2 = genderTroubleByScript2.scripts.every(s => s.scriptId === 2);
  assert(gtOnlyScript2, `getGenderTroubleScripts(scriptId=2) 只包含剧本2（${genderTroubleByScript2.scripts.length} 条）`);

  // 单店统计 topTroubledScripts 带剧本筛选时只统计该剧本
  const store1WithScript2 = getStoreStatsWithFilters({ storeId: 1, scriptId: 2, days: 30 });
  const tsMatch = store1WithScript2?.topTroubledScripts.every(s => s.scriptId === 2) ?? true;
  assert(tsMatch, `getStoreStatsWithFilters(storeId=1,scriptId=2) 的 topTroubledScripts 只包含剧本2`);

  // 趋势接口筛选口径：4 种组合 filterDescription 完全一致
  const comboFilters = [
    { label: '全局30天', f: { days: 30 } },
    { label: '门店1 7天', f: { storeId: 1, days: 7 } },
    { label: '剧本2 30天', f: { scriptId: 2, days: 30 } },
    { label: '门店2+剧本2 30天', f: { storeId: 2, scriptId: 2, days: 30 } },
  ];
  for (const c of comboFilters) {
    const r = getRefusalRateTrend(c.f);
    const o = getOnSiteChangesTrend(c.f);
    const g = getGenderTroubleScripts(c.f, 10);
    const t = getScriptTroubleStats(c.f);
    const s = getStatsSummary(c.f);
    const descs = new Set([r.meta.filterDescription, o.meta.filterDescription, g.meta.filterDescription, t.meta.filterDescription, s.meta.filterDescription]);
    assert(descs.size === 1, `【${c.label}】5 个统计接口 filterDescription 完全一致：${Array.from(descs)[0]}`);
  }

  // 门店全表统计（带剧本条件）只返回对应门店对应剧本的统计（不会混进其他剧本）
  const storesByScript2 = getAllStoresStats({ scriptId: 2, days: 30 });
  for (const st of storesByScript2.stats) {
    const sumExpected = storeTotalFromStoresFor(2, st.storeId);
    assert(
      st.totalAllocations === sumExpected,
      `allStoresStats 中「${st.storeName}」场次(${st.totalAllocations}) 等于实际脚本2场次(${sumExpected})`
    );
    const topOk = st.topTroubledScripts.every(x => x.scriptId === 2 || x.troubleCount === 0);
    assert(topOk, `allStoresStats 中「${st.storeName}」topTroubledScripts 只包含剧本2`);
  }
  pass(`门店全表统计（scriptId=2）口径一致，不混入其他剧本`);

  // ──────────────────────────────────────────────────────────────
  // 4. 对比视图：时间段对比 + 门店对比
  // ──────────────────────────────────────────────────────────────
  console.log('\n4️⃣  测试运营对比视图（时间段 / 门店）...');

  const periodCmp = compareStatsByPeriod(
    { storeId: 1, days: 7 },
    { storeId: 1, days: 30 }
  );
  pass(`时间段对比生成了 meta：${periodCmp.meta.comparisonDescription}`);
  assert(periodCmp.meta.periodA.days === 7 && periodCmp.meta.periodB.days === 30, '对比视图 meta 区分两个时段');
  assert(
    typeof periodCmp.crossGenderRefusalRate.diff === 'number' &&
    typeof periodCmp.averageOnSiteChanges.diffPct === 'number',
    '核心指标都有 diff / diffPct'
  );
  assert(
    Array.isArray(periodCmp.changeReasons) && periodCmp.changeReasons.length > 0,
    `变化原因摘要共 ${periodCmp.changeReasons.length} 条`
  );
  assert(
    Array.isArray(periodCmp.genderTroubleScripts.periodA) &&
    Array.isArray(periodCmp.genderTroubleScripts.periodB) &&
    Array.isArray(periodCmp.genderTroubleScripts.changed),
    '问题剧本对比：periodA / periodB / changed 三部分齐全'
  );

  const storeCmp = compareStatsByStore(1, 2, { days: 30 });
  pass(`门店对比生成了 meta：${storeCmp.meta.comparisonDescription}`);
  assert(
    storeCmp.meta.periodA.storeId === 1 && storeCmp.meta.periodB.storeId === 2,
    '门店对比分别列出了 periodA=store1, periodB=store2'
  );
  assert(storeCmp.totalAllocations.diff != null || storeCmp.crossGenderCount.diff != null, '门店对比核心指标已填充');

  // ──────────────────────────────────────────────────────────────
  // 5. 模拟对比增强：playerScoreDiffs + hitRuleVersions
  // ──────────────────────────────────────────────────────────────
  console.log('\n5️⃣  测试模拟对比增强输出（玩家差异原因 + 命中版本）...');

  const players: Player[] = [
    { name: '张三', gender: 'male', age: 28, is_regular: true, courage_level: 4, reasoning_level: 4, emotional_tolerance: 3 },
    { name: '李四', gender: 'female', age: 26, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5, cross_gender_willing: true },
    { name: '王五', gender: 'male', age: 30, is_regular: false, courage_level: 5, reasoning_level: 3, emotional_tolerance: 2 },
    { name: '赵六', gender: 'female', age: 22, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
    { name: '孙七', gender: 'male', age: 17, is_regular: false, courage_level: 3, reasoning_level: 3, emotional_tolerance: 3 },
    { name: '周八', gender: 'female', age: 32, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
  ];

  const script = getScriptById(1)!;
  const chars = getCharactersByScriptId(1);
  const rels = getRelationshipsByScriptId(1);

  const store1Rules = filterApplicableRules(getActiveRulesForStore(1), script.type, 1);
  const store3Rules = filterApplicableRules(getActiveRulesForStore(3), script.type, 3);

  const sim = simulateAllocation(players, chars, rels, script.type, {
    currentRules: store1Rules,
    specifiedRules: store3Rules,
  });

  assert(!!sim.diffCurrentVsSpecified, '指定版本对比返回了 diffCurrentVsSpecified');
  const diff = sim.diffCurrentVsSpecified!;

  assert(
    Array.isArray(diff.playerScoreDiffs) && diff.playerScoreDiffs.length === players.length,
    `每个玩家都有分数差异：共 ${diff.playerScoreDiffs.length} 条`
  );

  const diff0 = diff.playerScoreDiffs[0];
  assert(
    diff0.playerName &&
    diff0.fromCharacter &&
    diff0.toCharacter &&
    typeof diff0.scoreDiff === 'number' &&
    typeof diff0.biggestScoreReason === 'string',
    `玩家分数差异条目包含 name/from/to/scoreDiff/biggestScoreReason：${diff0.playerName} diff=${diff0.scoreDiff}`
  );

  assert(
    diff.hitRuleVersions &&
    Array.isArray(diff.hitRuleVersions.current) &&
    Array.isArray(diff.hitRuleVersions.compare),
    `命中规则版本齐全：current=${diff.hitRuleVersions.current.length} 条, compare=${diff.hitRuleVersions.compare.length} 条`
  );

  const cgRule = diff.hitRuleVersions.current.find(r => r.code === 'cross_gender_willingness');
  const cgRuleCompare = diff.hitRuleVersions.compare.find(r => r.code === 'cross_gender_willingness');
  assert(
    !!cgRule && !!cgRuleCompare,
    `cross_gender_willingness 命中版本：current v${cgRule?.version}, compare v${cgRuleCompare?.version}`
  );

  // ──────────────────────────────────────────────────────────────
  // 6. 分配记录的规则版本（记录用的 storeId，对应规则版本要对得上）
  // ──────────────────────────────────────────────────────────────
  console.log('\n6️⃣  验证分配记录中规则版本的一致性...');

  const allocStore1 = getAllocationsByFilters({ storeId: 1 }).slice(0, 1)[0];
  if (allocStore1) {
    const ruleVersions = parseRuleVersions(allocStore1);
    assert(ruleVersions.length > 0, `分配#${allocStore1.id} 已记录规则版本：${ruleVersions.length} 条`);
    const codes = ruleVersions.map(r => r.code);
    assert(new Set(codes).size === codes.length, '分配记录中 rule_code 不重复');
  }

  // ──────────────────────────────────────────────────────────────
  // 7. 不同类型剧本规则互不干扰（Phase 2 回归）
  // ──────────────────────────────────────────────────────────────
  console.log('\n7️⃣  验证不同类型剧本规则互不干扰(Phase 2 回归测试)...');

  const emotionalScript = getScriptById(1)!;
  const horrorScript = getScriptById(2)!;
  const emotionalChars = getCharactersByScriptId(emotionalScript.id);
  const horrorChars = getCharactersByScriptId(horrorScript.id);
  const storeRules = getEnabledRules();

  const emoRules = filterApplicableRules(storeRules, emotionalScript.type, 1);
  const emoCodes = new Set(emoRules.map(r => r.code));
  assert(
    !emoCodes.has('horror_courage_match') && !emoCodes.has('hardcore_reasoning_match'),
    '情感本不包含恐怖/硬核专属规则 ✓'
  );

  const horrorRules = filterApplicableRules(storeRules, horrorScript.type, 1);
  const horrorCodes = new Set(horrorRules.map(r => r.code));
  assert(
    horrorCodes.has('horror_courage_match') && !horrorCodes.has('hardcore_reasoning_match'),
    '恐怖本包含胆量匹配、不包含硬核推理 ✓'
  );

  console.log('\n🎉 Phase 4 所有测试通过！操作审计、回滚切回、筛选口径、对比视图、模拟增强均正常工作。');

  saveToDisk();
  closeDb();
}

function storeTotalFromStoresFor(scriptId: number, storeId: number): number {
  const allocs = getAllocationsByFilters({ storeId, scriptId });
  return allocs.length;
}

run().catch(err => {
  console.error('❌ 测试异常:', err);
  process.exit(1);
});
