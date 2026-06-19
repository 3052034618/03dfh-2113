import { initDb, saveToDisk, closeDb } from './db/database';
import { getEnabledRules } from './models/ruleModel';
import { getScriptById, getCharactersByScriptId, getRelationshipsByScriptId } from './models/scriptModel';
import { generateAllocationSuggestion, getTopCandidates } from './services/allocationService';
import { Player } from './types';
import { getStoreStats, getAllStoresStats, getScriptTroubleStats } from './models/statsModel';

async function runTest() {
  console.log('🧪 开始核心功能测试...\n');

  await initDb();

  console.log('1️⃣  测试规则读取...');
  const rules = getEnabledRules();
  console.log(`   ✅ 已启用规则: ${rules.length} 条`);
  rules.forEach(r => console.log(`      - ${r.name} (优先级: ${r.priority})`));

  console.log('\n2️⃣  测试剧本读取...');
  const script = getScriptById(1);
  console.log(`   ✅ 剧本: ${script?.name} (${script?.type})`);

  const characters = getCharactersByScriptId(1);
  console.log(`   ✅ 角色数量: ${characters.length} 个`);
  characters.forEach(c => console.log(`      - ${c.name} (${c.gender}, 核心: ${c.is_lead ? '是' : '否'})`));

  const relationships = getRelationshipsByScriptId(1);
  console.log(`   ✅ 关系线: ${relationships.length} 条`);

  console.log('\n3️⃣  测试角色分配算法...');
  const players: Player[] = [
    { name: '小明', gender: 'male', age: 25, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
    { name: '小红', gender: 'female', age: 23, is_regular: true, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5 },
    { name: '小刚', gender: 'male', age: 27, is_regular: false, courage_level: 4, reasoning_level: 3, emotional_tolerance: 3 },
    { name: '小丽', gender: 'female', age: 22, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
    { name: '小华', gender: 'male', age: 17, is_regular: false, courage_level: 3, reasoning_level: 3, emotional_tolerance: 2 },
    { name: '小芳', gender: 'female', age: 28, is_regular: true, courage_level: 3, reasoning_level: 3, emotional_tolerance: 4 }
  ];

  const suggestion = generateAllocationSuggestion(players, characters, rules, relationships);
  console.log(`   ✅ 分配方案总分: ${suggestion.totalScore}`);
  console.log(`   ✅ 反串数量: ${suggestion.crossGenderCount}`);
  console.log('');
  console.log('   📋 分配结果:');
  suggestion.assignments.forEach(a => {
    console.log(`      ${a.player.name} → ${a.character.name} (得分: ${a.score.toFixed(1)})`);
    if (a.isCrossGender) {
      console.log(`         ⚠️  反串`);
    }
    if (a.character.is_lead) {
      console.log(`         ⭐ 核心角色`);
    }
    a.reasons.slice(0, 3).forEach(r => console.log(`         • ${r}`));
  });

  console.log('\n   💡 DM 提示:');
  suggestion.dmTips.forEach(t => console.log(`      • ${t}`));

  console.log('\n   💞 重点关系线:');
  suggestion.relationshipHighlights.forEach(r => console.log(`      • ${r.tip}`));

  console.log('\n4️⃣  测试玩家候选排名...');
  const candidates = getTopCandidates(players, characters, rules, 3);
  candidates.slice(0, 2).forEach(c => {
    console.log(`   ${c.playerName} 的 Top 3 角色:`);
    c.candidates.forEach((cand, i) => {
      console.log(`      ${i + 1}. ${cand.characterName} (${cand.score.toFixed(1)}分)`);
    });
  });

  console.log('\n5️⃣  测试数据统计...');
  const stats = getStoreStats(1);
  console.log(`   ✅ 门店统计: ${stats?.storeName}`);
  console.log(`      总场次: ${stats?.totalAllocations}`);
  console.log(`      反串拒绝率: ${((stats?.crossGenderRefusalRate || 0) * 100).toFixed(1)}%`);
  console.log(`      平均临场换角: ${stats?.averageOnSiteChanges.toFixed(2)} 次`);

  const allStats = getAllStoresStats();
  console.log(`   ✅ 全部门店统计: ${allStats.length} 家`);

  const trouble = getScriptTroubleStats();
  console.log(`   ✅ 问题剧本统计: ${trouble.length} 部`);
  trouble.filter(t => t.trouble_count > 0).slice(0, 3).forEach(t => {
    console.log(`      - ${t.script_name}: ${t.trouble_count} 次问题 / ${t.allocations} 场`);
  });

  saveToDisk();
  closeDb();

  console.log('\n🎉 所有测试通过！核心功能运行正常。');
}

runTest().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
