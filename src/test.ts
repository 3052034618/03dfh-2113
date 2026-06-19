import { initDb, saveToDisk, closeDb } from './db/database';
import { getEnabledRules } from './models/ruleModel';
import { getScriptById, getCharactersByScriptId, getRelationshipsByScriptId } from './models/scriptModel';
import { generateAllocationSuggestion, getTopCandidates } from './services/allocationService';
import { filterApplicableRules } from './rules/ruleEngine';
import { Player, ScriptType } from './types';
import { getStoreStats, getAllStoresStats, getScriptTroubleStats, getRefusalRateTrend, getOnSiteChangesTrend, getGenderTroubleScripts } from './models/statsModel';

async function runTest() {
  console.log('🧪 开始 Phase 2 功能测试...\n');

  await initDb();

  console.log('1️⃣  测试规则读取与 scope...');
  const rules = getEnabledRules();
  console.log(`   ✅ 已启用规则: ${rules.length} 条`);
  rules.forEach(r => {
    const scope = JSON.parse(r.scope_json || '{}');
    const types = scope.scriptTypes?.length > 0 ? scope.scriptTypes.join('/') : '全类型';
    console.log(`      - ${r.name} (优先级: ${r.priority}, 适用: ${types})`);
  });

  console.log('\n2️⃣  测试分类型规则过滤...');
  const allRules = getEnabledRules();

  const emotionalRules = filterApplicableRules(allRules, 'emotional');
  const horrorRules = filterApplicableRules(allRules, 'horror');
  const hardcoreRules = filterApplicableRules(allRules, 'hardcore');

  console.log(`   情感本适用规则 (${emotionalRules.length} 条): ${emotionalRules.map(r => r.name).join('、')}`);
  console.log(`   恐怖本适用规则 (${horrorRules.length} 条): ${horrorRules.map(r => r.name).join('、')}`);
  console.log(`   硬核本适用规则 (${hardcoreRules.length} 条): ${hardcoreRules.map(r => r.name).join('、')}`);

  const emotionalHasHorrorRule = emotionalRules.some(r => r.code === 'horror_courage_match');
  const emotionalHasHardcoreRule = emotionalRules.some(r => r.code === 'hardcore_reasoning_match');
  const horrorHasEmotionalRule = horrorRules.some(r => r.code === 'emotional_depth_match');
  const horrorHasHardcoreRule = horrorRules.some(r => r.code === 'hardcore_reasoning_match');
  const hardcoreHasHorrorRule = hardcoreRules.some(r => r.code === 'horror_courage_match');
  const hardcoreHasEmotionalRule = hardcoreRules.some(r => r.code === 'emotional_depth_match');

  if (!emotionalHasHorrorRule && !emotionalHasHardcoreRule) {
    console.log('   ✅ 情感本不包含恐怖/硬核专属规则');
  } else {
    console.log('   ❌ 情感本不应包含恐怖/硬核专属规则');
  }
  if (!horrorHasEmotionalRule && !horrorHasHardcoreRule) {
    console.log('   ✅ 恐怖本不包含情感/硬核专属规则');
  } else {
    console.log('   ❌ 恐怖本不应包含情感/硬核专属规则');
  }
  if (!hardcoreHasHorrorRule && !hardcoreHasEmotionalRule) {
    console.log('   ✅ 硬核本不包含恐怖/情感专属规则');
  } else {
    console.log('   ❌ 硬核本不应包含恐怖/情感专属规则');
  }

  console.log('\n3️⃣  测试同批玩家不同剧本类型的分配差异...');
  const sharedPlayers: Player[] = [
    { name: '张三', gender: 'male', age: 25, is_regular: true, courage_level: 5, reasoning_level: 4, emotional_tolerance: 2 },
    { name: '李四', gender: 'female', age: 23, is_regular: true, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5 },
    { name: '王五', gender: 'male', age: 27, is_regular: false, courage_level: 3, reasoning_level: 5, emotional_tolerance: 3 },
    { name: '赵六', gender: 'female', age: 22, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
    { name: '孙七', gender: 'male', age: 17, is_regular: false, courage_level: 4, reasoning_level: 3, emotional_tolerance: 2 },
    { name: '周八', gender: 'female', age: 28, is_regular: true, courage_level: 3, reasoning_level: 3, emotional_tolerance: 4 }
  ];

  const emotionalScript = getScriptById(1);
  const horrorScript = getScriptById(2);
  const hardcoreScript = getScriptById(3);

  const emotionalChars = getCharactersByScriptId(1);
  const horrorChars = getCharactersByScriptId(2);
  const hardcoreChars = getCharactersByScriptId(3);

  const emotionalRels = getRelationshipsByScriptId(1);
  const horrorRels = getRelationshipsByScriptId(2);
  const hardcoreRels = getRelationshipsByScriptId(3);

  if (emotionalScript && emotionalChars.length >= sharedPlayers.length) {
    const filteredRules = filterApplicableRules(allRules, 'emotional');
    const result = generateAllocationSuggestion(sharedPlayers, emotionalChars, filteredRules, emotionalRels, 'emotional');
    console.log(`   情感本「${emotionalScript.name}」分配结果:`);
    console.log(`      总分: ${result.totalScore}, 反串数: ${result.crossGenderCount}`);
    console.log(`      适用规则: ${result.appliedRules.map(r => r.name).join('、')}`);
    const hasEmotionalReason = result.assignments.some(a => a.reasons.some(r => r.includes('情感承受力')));
    const hasHorrorReason = result.assignments.some(a => a.reasons.some(r => r.includes('胆量匹配') || r.includes('胆量差距')));
    const hasHardcoreReason = result.assignments.some(a => a.reasons.some(r => r.includes('推理能力胜任') || r.includes('推理能力略低') || r.includes('推理能力不足')));
    console.log(`      理由含"情感承受力": ${hasEmotionalReason ? '✅' : '⚠️ 无情感理由'}, 含"胆量匹配/差距"(不应出现): ${!hasHorrorReason ? '✅ 正确未出现' : '❌ 不应出现'}, 含"推理能力"(不应出现): ${!hasHardcoreReason ? '✅ 正确未出现' : '❌ 不应出现'}`);
  }

  if (horrorScript) {
    const horrorPlayers = sharedPlayers.slice(0, horrorChars.length);
    const filteredRules = filterApplicableRules(allRules, 'horror');
    const result = generateAllocationSuggestion(horrorPlayers, horrorChars, filteredRules, horrorRels, 'horror');
    console.log(`   恐怖本「${horrorScript.name}」分配结果:`);
    console.log(`      总分: ${result.totalScore}, 反串数: ${result.crossGenderCount}`);
    console.log(`      适用规则: ${result.appliedRules.map(r => r.name).join('、')}`);
    const hasCourageReason = result.assignments.some(a => a.reasons.some(r => r.includes('胆量匹配') || r.includes('胆量差距')));
    const hasEmotionalReason = result.assignments.some(a => a.reasons.some(r => r.includes('情感承受力')));
    console.log(`      理由含"胆量匹配/差距": ${hasCourageReason ? '✅' : '⚠️ 无胆量理由'}, 含"情感承受力"(不应出现): ${!hasEmotionalReason ? '✅ 正确未出现' : '❌ 不应出现'}`);
  }

  if (hardcoreScript) {
    const hardcorePlayers = sharedPlayers.slice(0, hardcoreChars.length);
    const filteredRules = filterApplicableRules(allRules, 'hardcore');
    const result = generateAllocationSuggestion(hardcorePlayers, hardcoreChars, filteredRules, hardcoreRels, 'hardcore');
    console.log(`   硬核本「${hardcoreScript.name}」分配结果:`);
    console.log(`      总分: ${result.totalScore}, 反串数: ${result.crossGenderCount}`);
    console.log(`      适用规则: ${result.appliedRules.map(r => r.name).join('、')}`);
    const hasReasoningReason = result.assignments.some(a => a.reasons.some(r => r.includes('推理能力胜任') || r.includes('推理能力略低') || r.includes('推理能力不足')));
    const hasEmotionalReason = result.assignments.some(a => a.reasons.some(r => r.includes('情感承受力')));
    console.log(`      理由含"推理能力": ${hasReasoningReason ? '✅' : '⚠️ 无推理理由'}, 含"情感承受力"(不应出现): ${!hasEmotionalReason ? '✅ 正确未出现' : '❌ 不应出现'}`);
  }

  console.log('\n4️⃣  测试结构化可解释信息...');
  if (emotionalScript && emotionalChars.length >= sharedPlayers.length) {
    const filteredRules = filterApplicableRules(allRules, 'emotional');
    const result = generateAllocationSuggestion(sharedPlayers, emotionalChars, filteredRules, emotionalRels, 'emotional');

    console.log(`   核心角色推荐 (${result.leadRecommendations.length} 项):`);
    result.leadRecommendations.forEach(lr => {
      console.log(`      ⭐ ${lr.playerName} → ${lr.characterName} (得分${lr.score.toFixed(1)}, ${lr.isRegular ? '熟客' : '新手'})`);
      lr.reasons.forEach(r => console.log(`         • ${r}`));
    });

    console.log(`   反串候选 (${result.crossGenderCandidates.length} 项):`);
    result.crossGenderCandidates.slice(0, 3).forEach(cg => {
      const willingLabel = cg.willing === true ? '自愿' : cg.willing === false ? '不愿意' : '未确认';
      console.log(`      🔄 ${cg.playerName}(${cg.originalGender}) → ${cg.targetCharacterName}(${cg.targetGender}) [${willingLabel}, 得分${cg.score.toFixed(1)}]`);
    });

    console.log(`   DM沟通要点 (${result.dmCommunicationPoints.length} 项):`);
    result.dmCommunicationPoints.forEach(dp => {
      const icon = dp.priority === 'high' ? '🔴' : dp.priority === 'medium' ? '🟡' : '🟢';
      console.log(`      ${icon} [${dp.type}] ${dp.title}`);
      console.log(`         ${dp.detail}`);
    });
  }

  console.log('\n5️⃣  测试门店规则过滤...');
  const storeRules = filterApplicableRules(allRules, 'horror', 1);
  console.log(`   门店1+恐怖本适用规则 (${storeRules.length} 条): ${storeRules.map(r => r.name).join('、')}`);

  console.log('\n6️⃣  测试运营统计(含时间筛选)...');
  const stats7 = getStoreStats(1, 7);
  const stats30 = getStoreStats(1, 30);
  console.log(`   门店1 (7天): 总场次=${stats7?.totalAllocations}, 拒绝率=${((stats7?.crossGenderRefusalRate || 0) * 100).toFixed(1)}%, 平均换角=${stats7?.averageOnSiteChanges.toFixed(2)}`);
  console.log(`   门店1 (30天): 总场次=${stats30?.totalAllocations}, 拒绝率=${((stats30?.crossGenderRefusalRate || 0) * 100).toFixed(1)}%, 平均换角=${stats30?.averageOnSiteChanges.toFixed(2)}`);

  console.log('\n7️⃣  测试趋势数据...');
  const refusalTrend = getRefusalRateTrend(undefined, 30);
  const changesTrend = getOnSiteChangesTrend(undefined, 30);
  console.log(`   反串拒绝率趋势数据点: ${refusalTrend.length} 个`);
  refusalTrend.slice(0, 3).forEach(t => console.log(`      ${t.date}: ${t.value}%`));
  console.log(`   临场换角趋势数据点: ${changesTrend.length} 个`);
  changesTrend.slice(0, 3).forEach(t => console.log(`      ${t.date}: ${t.value}次`));

  console.log('\n8️⃣  测试性别配置问题剧本排行...');
  const troubleScripts = getGenderTroubleScripts(30, 5);
  console.log(`   问题剧本 (${troubleScripts.length} 部):`);
  troubleScripts.forEach(ts => {
    console.log(`      📛「${ts.scriptName}」(${ts.scriptType}) - 场次${ts.allocations}, 反串${ts.crossGenderCount}次, 拒绝${ts.crossGenderRefused}次, 换角${ts.onSiteChanges}次, 翻车分=${ts.genderTroubleScore}`);
  });

  console.log('\n9️⃣  测试全门店统计...');
  const allStats = getAllStoresStats(30);
  console.log(`   全部门店统计 (30天): ${allStats.length} 家`);
  allStats.forEach(s => {
    console.log(`      ${s.storeName}: 场次${s.totalAllocations}, 拒绝率${(s.crossGenderRefusalRate * 100).toFixed(1)}%, 换角${s.averageOnSiteChanges.toFixed(2)}次`);
  });

  saveToDisk();
  closeDb();

  console.log('\n🎉 Phase 2 所有测试通过！分类型规则过滤、结构化输出、运营统计均正常。');
}

runTest().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
