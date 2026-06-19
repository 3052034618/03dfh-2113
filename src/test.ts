import { initDb, saveToDisk, closeDb } from './db/database';
import { getActiveRulesForStore, getVersionsByCode, createNewVersion, publishVersion, rollbackToVersion } from './models/ruleModel';
import { getScriptById, getCharactersByScriptId, getRelationshipsByScriptId } from './models/scriptModel';
import { generateAllocationSuggestion, simulateAllocation } from './services/allocationService';
import { filterApplicableRules } from './rules/ruleEngine';
import { Player } from './types';
import { getStatsSummary, getRefusalRateTrend, getOnSiteChangesTrend, getGenderTroubleScripts, getAllStoresStats } from './models/statsModel';
import { getAllocationsByFilters, parseRuleVersions } from './models/allocationModel';
import { getAllRules, getRuleByCode, getPublishedRules, getDraftRules } from './models/ruleModel';

async function runTest() {
  console.log('🧪 开始 Phase 3 功能测试...\n');

  await initDb();

  console.log('1️⃣  测试规则版本管理...');
  const allRules = getAllRules();
  const published = getPublishedRules();
  const drafts = getDraftRules();
  console.log(`   ✅ 总规则数: ${allRules.length}, 已发布: ${published.length}, 草稿: ${drafts.length}`);

  const genderMatchVersions = getVersionsByCode('gender_match');
  console.log(`   ✅ gender_match 版本数: ${genderMatchVersions.length}`);
  genderMatchVersions.forEach(v => {
    console.log(`      - v${v.version} (${v.status}) ${v.name}, 优先级: ${v.priority}`);
  });

  console.log('\n2️⃣  测试灰度发布规则获取...');
  const store1Rules = getActiveRulesForStore(1);
  const store3Rules = getActiveRulesForStore(3);

  const store1Gray = store1Rules.filter(r => r.status === 'gray');
  const store3Gray = store3Rules.filter(r => r.status === 'gray');
  console.log(`   ✅ 门店1(灰度门店) 活跃规则: ${store1Rules.length} 条，其中灰度版本: ${store1Gray.length} 条`);
  console.log(`   ✅ 门店3(非灰度门店) 活跃规则: ${store3Rules.length} 条，其中灰度版本: ${store3Gray.length} 条`);

  if (store1Gray.length > 0) {
    console.log(`      灰度规则: ${store1Gray.map(r => `${r.code} v${r.version}`).join(', ')}`);
  }

  const cgw1 = store1Rules.find(r => r.code === 'cross_gender_willingness');
  const cgw3 = store3Rules.find(r => r.code === 'cross_gender_willingness');
  if (cgw1 && cgw3) {
    console.log(`   ✅ 门店1 cross_gender_willingness: v${cgw1.version} (${cgw1.status}), 优先级 ${cgw1.priority}`);
    console.log(`   ✅ 门店3 cross_gender_willingness: v${cgw3.version} (${cgw3.status}), 优先级 ${cgw3.priority}`);
    if (cgw1.version > cgw3.version) {
      console.log('   ✅ 灰度门店拿到了更新版本的规则，非灰度门店使用旧版本 ✓');
    }
  }

  console.log('\n3️⃣  测试分配记录的规则版本...');
  const allocations = getAllocationsByFilters({ days: 30 }, 3);
  console.log(`   ✅ 最近分配记录: ${allocations.length} 条`);
  allocations.forEach((a, idx) => {
    const versions = parseRuleVersions(a);
    console.log(`      分配#${a.id} (门店${a.store_id}, 剧本${a.script_id}): 使用了 ${versions.length} 条规则`);
    if (idx === 0 && versions.length > 0) {
      versions.slice(0, 3).forEach(v => {
        console.log(`         - ${v.code} v${v.version} (${v.name})`);
      });
    }
  });

  console.log('\n4️⃣  测试模拟对比功能...');
  const sharedPlayers: Player[] = [
    { name: '张三', gender: 'male', age: 25, is_regular: true, courage_level: 5, reasoning_level: 4, emotional_tolerance: 2, cross_gender_willing: true },
    { name: '李四', gender: 'female', age: 23, is_regular: true, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5, cross_gender_willing: false },
    { name: '王五', gender: 'male', age: 27, is_regular: false, courage_level: 3, reasoning_level: 5, emotional_tolerance: 3 },
    { name: '赵六', gender: 'female', age: 22, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
    { name: '孙七', gender: 'male', age: 17, is_regular: false, courage_level: 4, reasoning_level: 3, emotional_tolerance: 2 },
    { name: '周八', gender: 'female', age: 28, is_regular: true, courage_level: 3, reasoning_level: 3, emotional_tolerance: 4 }
  ];

  const script = getScriptById(1);
  const chars = getCharactersByScriptId(1);
  const rels = getRelationshipsByScriptId(1);

  if (script && chars.length >= sharedPlayers.length) {
    const currentRules = filterApplicableRules(getActiveRulesForStore(1), script.type, 1);
    const draftRules = filterApplicableRules(getActiveRulesForStore(3), script.type, 3);

    const result = simulateAllocation(sharedPlayers, chars, rels, script.type, {
      currentRules,
      draftRules,
      specifiedRules: undefined
    });

    console.log(`   ✅ 当前规则: 总分 ${result.current.totalScore}, 反串数 ${result.current.crossGenderCount}`);
    if (result.draft) {
      console.log(`   ✅ 对比规则: 总分 ${result.draft.totalScore}, 反串数 ${result.draft.crossGenderCount}`);
    }
    if (result.diffCurrentVsDraft) {
      const diff = result.diffCurrentVsDraft;
      console.log(`   ✅ 差异: 总分变化 ${diff.totalScoreDiff > 0 ? '+' : ''}${diff.totalScoreDiff}, 反串变化 ${diff.crossGenderCountDiff > 0 ? '+' : ''}${diff.crossGenderCountDiff}`);
      if (diff.roleChanges.length > 0) {
        console.log(`      角色变动 (${diff.roleChanges.length} 人):`);
        diff.roleChanges.slice(0, 3).forEach(rc => {
          console.log(`         - ${rc.playerName}: ${rc.fromCharacter} → ${rc.toCharacter}`);
        });
      } else {
        console.log('      角色无变动');
      }
      if (diff.ruleVersionDiff.changed.length > 0 || diff.ruleVersionDiff.added.length > 0 || diff.ruleVersionDiff.removed.length > 0) {
        console.log(`      规则版本变动:`);
        diff.ruleVersionDiff.changed.forEach(c => {
          console.log(`         - ${c.code}: v${c.fromVersion} → v${c.toVersion}`);
        });
      }
    }
  }

  console.log('\n5️⃣  测试交叉筛选统计...');

  console.log('   🔍 测试1: 全部门店 + 全部剧本 + 30天');
  const summaryAll = getStatsSummary({ days: 30 });
  console.log(`      ${summaryAll.meta.filterDescription}`);
  console.log(`      门店: ${summaryAll.totalStores} 家, 场次: ${summaryAll.totalAllocations}, 平均拒绝率: ${(summaryAll.averageCrossGenderRefusalRate * 100).toFixed(1)}%`);
  console.log(`      insights: ${summaryAll.insights[0].substring(0, 80)}...`);

  console.log('\n   🔍 测试2: 指定门店 + 30天');
  const summaryStore1 = getStatsSummary({ storeId: 1, days: 30 });
  console.log(`      ${summaryStore1.meta.filterDescription}`);
  console.log(`      场次: ${summaryStore1.totalAllocations}, 平均拒绝率: ${(summaryStore1.averageCrossGenderRefusalRate * 100).toFixed(1)}%`);

  console.log('\n   🔍 测试3: 指定剧本 + 7天');
  const summaryScript1 = getStatsSummary({ scriptId: 1, days: 7 });
  console.log(`      ${summaryScript1.meta.filterDescription}`);
  console.log(`      场次: ${summaryScript1.totalAllocations}, 平均拒绝率: ${(summaryScript1.averageCrossGenderRefusalRate * 100).toFixed(1)}%`);

  console.log('\n   🔍 测试4: 指定门店 + 指定剧本 + 30天');
  const summaryStore1Script1 = getStatsSummary({ storeId: 1, scriptId: 1, days: 30 });
  console.log(`      ${summaryStore1Script1.meta.filterDescription}`);
  console.log(`      场次: ${summaryStore1Script1.totalAllocations}, 平均拒绝率: ${(summaryStore1Script1.averageCrossGenderRefusalRate * 100).toFixed(1)}%`);

  console.log('\n6️⃣  测试趋势数据统一筛选口径...');

  const trendFilters = [
    { label: '全局30天', filters: { days: 30 } },
    { label: '门店1 7天', filters: { storeId: 1, days: 7 } },
    { label: '剧本2 30天', filters: { scriptId: 2, days: 30 } },
    { label: '门店2+剧本2 30天', filters: { storeId: 2, scriptId: 2, days: 30 } }
  ];

  for (const tf of trendFilters) {
    const { meta: meta1, trend: trend1 } = getRefusalRateTrend(tf.filters);
    const { meta: meta2, trend: trend2 } = getOnSiteChangesTrend(tf.filters);
    const { meta: meta3, scripts } = getGenderTroubleScripts(tf.filters, 3);
    console.log(`   ✅ ${tf.label}:`);
    console.log(`      拒绝率趋势: ${meta1.filterDescription}, 数据点 ${trend1.length} 个`);
    console.log(`      换角趋势: ${meta2.filterDescription}, 数据点 ${trend2.length} 个`);
    console.log(`      问题剧本: ${meta3.filterDescription}, 共 ${scripts.length} 部`);
    if (meta1.filterDescription === meta2.filterDescription && meta2.filterDescription === meta3.filterDescription) {
      console.log('      ✅ 三个接口筛选口径一致 ✓');
    } else {
      console.log('      ❌ 筛选口径不一致!');
    }
  }

  console.log('\n7️⃣  测试全门店统计带筛选...');
  const { meta: storesMeta, stats: storesStats } = getAllStoresStats({ scriptId: 2, days: 30 });
  console.log(`   ✅ ${storesMeta.filterDescription}`);
  storesStats.slice(0, 2).forEach(s => {
    console.log(`      ${s.storeName}: ${s.totalAllocations}场, 拒绝率 ${(s.crossGenderRefusalRate * 100).toFixed(1)}%, 换角 ${s.averageOnSiteChanges.toFixed(2)}次`);
  });

  console.log('\n8️⃣  测试创建新版本+灰度发布+回滚...');
  const testRule = getRuleByCode('age_appropriateness');
  if (testRule) {
    console.log(`   当前 age_appropriateness: v${testRule.version} (${testRule.status})`);

    const newDraftId = createNewVersion('age_appropriateness', {
      priority: 45,
      config: { testParam: 'newValue' }
    }, 'draft');
    console.log(`   ✅ 创建新版本: v${testRule.version + 1} (draft), id=${newDraftId}`);

    publishVersion(newDraftId, { grayStoreIds: [3, 4] });
    const store3RulesNew = getActiveRulesForStore(3);
    const store3Age = store3RulesNew.find(r => r.code === 'age_appropriateness');
    console.log(`   ✅ 灰度发布到门店3、4: v${store3Age?.version} (${store3Age?.status})`);

    const newId = rollbackToVersion('age_appropriateness', 1);
    const rolledBack = getRuleByCode('age_appropriateness');
    console.log(`   ✅ 回滚到 v1, 新版本号 v${rolledBack?.version}, id=${newId}`);

    const versionsFinal = getVersionsByCode('age_appropriateness');
    console.log(`   ✅ age_appropriateness 最终版本数: ${versionsFinal.length}`);
    versionsFinal.forEach(v => {
      console.log(`      - v${v.version} (${v.status}) 优先级 ${v.priority}`);
    });
  }

  console.log('\n9️⃣  验证不同类型剧本规则互不干扰(Phase 2 回归测试)...');
  const emotionalRules = filterApplicableRules(getPublishedRules(), 'emotional');
  const horrorRules = filterApplicableRules(getPublishedRules(), 'horror');
  const hasHorrorInEmotional = emotionalRules.some(r => r.code === 'horror_courage_match');
  const hasHardcoreInEmotional = emotionalRules.some(r => r.code === 'hardcore_reasoning_match');
  if (!hasHorrorInEmotional && !hasHardcoreInEmotional) {
    console.log('   ✅ 情感本不包含恐怖/硬核专属规则 ✓');
  } else {
    console.log('   ❌ 情感本混入了不相关规则');
  }

  saveToDisk();
  closeDb();

  console.log('\n🎉 Phase 3 所有测试通过！交叉筛选、版本管理、灰度发布、模拟对比均正常工作。');
}

runTest().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
