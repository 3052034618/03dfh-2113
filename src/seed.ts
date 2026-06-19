import { initDb, saveToDisk } from './db/database';
import { createStore } from './models/storeModel';
import { createScript, createCharacter, createRelationship } from './models/scriptModel';
import { createRule, getRuleByCode } from './models/ruleModel';
import { createAllocation, updateAllocationFeedback } from './models/allocationModel';
import { generateAllocationSuggestion } from './services/allocationService';
import { getEnabledRules } from './models/ruleModel';
import { getCharactersByScriptId, getRelationshipsByScriptId } from './models/scriptModel';
import { Player, Gender } from './types';

function seedStores(): number[] {
  console.log('🏪 正在创建门店数据...');
  const stores = [
    { name: '迷雾剧场·总店', city: '北京', address: '北京市朝阳区三里屯路1号' },
    { name: '迷雾剧场·上海静安店', city: '上海', address: '上海市静安区南京西路100号' },
    { name: '迷雾剧场·深圳南山店', city: '深圳', address: '深圳市南山区科技园路50号' },
    { name: '迷雾剧场·成都春熙店', city: '成都', address: '成都市锦江区春熙路88号' }
  ];

  const ids: number[] = [];
  for (const s of stores) {
    const id = createStore(s.name, s.city, s.address);
    ids.push(id);
    console.log(`  ✓ ${s.name}`);
  }
  return ids;
}

function seedScriptsAndCharacters(): number[] {
  console.log('');
  console.log('📜 正在创建剧本和角色数据...');

  const scripts = [
    {
      name: '雾都孤儿',
      type: 'emotional',
      difficulty: 'medium' as const,
      duration: 240,
      description: '一部关于爱与救赎的情感沉浸本',
      characters: [
        { name: '林小雨', gender: 'female' as Gender, is_lead: 1, courage: 2, reasoning: 3, emotional: 5, age: 25 },
        { name: '陈默', gender: 'male' as Gender, is_lead: 1, courage: 3, reasoning: 4, emotional: 4, age: 28 },
        { name: '苏念', gender: 'female' as Gender, is_lead: 0, courage: 2, reasoning: 3, emotional: 5, age: 22 },
        { name: '王磊', gender: 'male' as Gender, is_lead: 0, courage: 4, reasoning: 3, emotional: 3, age: 30 },
        { name: '李芳', gender: 'female' as Gender, is_lead: 0, courage: 3, reasoning: 4, emotional: 3, age: 35 },
        { name: '张伟', gender: 'male' as Gender, is_lead: 0, courage: 5, reasoning: 3, emotional: 2, age: 40 }
      ],
      relationships: [
        { a: 0, b: 1, type: '情侣', importance: 5 },
        { a: 2, b: 0, type: '姐妹', importance: 4 },
        { a: 3, b: 5, type: '兄弟', importance: 3 },
        { a: 1, b: 4, type: '亲属', importance: 4 }
      ]
    },
    {
      name: '午夜凶铃',
      type: 'horror',
      difficulty: 'hard' as const,
      duration: 300,
      description: '经典恐怖推理本，胆小慎入',
      characters: [
        { name: '张医生', gender: 'male' as Gender, is_lead: 1, courage: 5, reasoning: 5, emotional: 3, age: 35 },
        { name: '林护士', gender: 'female' as Gender, is_lead: 0, courage: 3, reasoning: 4, emotional: 4, age: 28 },
        { name: '王大爷', gender: 'male' as Gender, is_lead: 0, courage: 4, reasoning: 3, emotional: 3, age: 55 },
        { name: '陈小姐', gender: 'female' as Gender, is_lead: 0, courage: 2, reasoning: 3, emotional: 5, age: 24 },
        { name: '刘保安', gender: 'male' as Gender, is_lead: 0, courage: 5, reasoning: 2, emotional: 2, age: 45 }
      ],
      relationships: [
        { a: 0, b: 1, type: '同事', importance: 4 },
        { a: 3, b: 4, type: '宿敌', importance: 5 },
        { a: 0, b: 2, type: '亲属', importance: 3 }
      ]
    },
    {
      name: '数学家的复仇',
      type: 'hardcore',
      difficulty: 'extreme' as const,
      duration: 360,
      description: '硬核推理本，高智商犯罪',
      characters: [
        { name: '陈教授', gender: 'male' as Gender, is_lead: 1, courage: 3, reasoning: 5, emotional: 2, age: 45 },
        { name: '李博士', gender: 'female' as Gender, is_lead: 1, courage: 3, reasoning: 5, emotional: 3, age: 38 },
        { name: '王助手', gender: 'male' as Gender, is_lead: 0, courage: 3, reasoning: 4, emotional: 3, age: 28 },
        { name: '赵记者', gender: 'female' as Gender, is_lead: 0, courage: 4, reasoning: 4, emotional: 3, age: 30 },
        { name: '孙侦探', gender: 'male' as Gender, is_lead: 0, courage: 4, reasoning: 5, emotional: 2, age: 40 },
        { name: '周秘书', gender: 'female' as Gender, is_lead: 0, courage: 2, reasoning: 3, emotional: 4, age: 26 }
      ],
      relationships: [
        { a: 0, b: 1, type: '宿敌', importance: 5 },
        { a: 0, b: 2, type: '师徒', importance: 4 },
        { a: 4, b: 5, type: '情侣', importance: 3 }
      ]
    }
  ];

  const scriptIds: number[] = [];

  for (const s of scripts) {
    const scriptId = createScript(s.name, s.type, s.difficulty, s.duration, s.description);
    scriptIds.push(scriptId);
    console.log(`  ✓ ${s.name}（${s.type}）`);

    const charIds: number[] = [];
    for (const c of s.characters) {
      const charId = createCharacter(scriptId, c.name, c.gender, {
        age: c.age,
        is_lead: c.is_lead,
        courage_required: c.courage,
        reasoning_required: c.reasoning,
        emotional_depth: c.emotional
      });
      charIds.push(charId);
    }

    for (const r of s.relationships) {
      createRelationship(scriptId, charIds[r.a], charIds[r.b], r.type, r.importance);
    }
  }

  return scriptIds;
}

function seedRules(): number {
  console.log('');
  console.log('📏 正在创建规则数据...');

  const defaultRules = [
    {
      name: '性别匹配优先',
      code: 'gender_match',
      description: '优先保证玩家与角色性别一致',
      priority: 80,
      config: {}
    },
    {
      name: '未成年人不推荐重情感反串',
      code: 'minor_no_emotional_cross',
      description: '18岁以下玩家不推荐承担高情感深度的反串角色',
      priority: 90,
      config: { ageThreshold: 18, emotionalThreshold: 4 }
    },
    {
      name: '恐怖本胆量匹配',
      code: 'horror_courage_match',
      description: '恐怖类型剧本优先保证玩家胆量与角色要求匹配',
      priority: 70,
      config: { weight: 1.5 }
    },
    {
      name: '硬核本推理能力匹配',
      code: 'hardcore_reasoning_match',
      description: '硬核类型剧本优先保证玩家推理能力',
      priority: 75,
      config: { weight: 1.5 }
    },
    {
      name: '情感深度匹配',
      code: 'emotional_depth_match',
      description: '情感类型剧本优先保证玩家情感承受力匹配',
      priority: 60,
      config: { weight: 1 }
    },
    {
      name: '核心角色优先分配给能力匹配者',
      code: 'lead_character_priority',
      description: '核心角色需要较高的综合能力',
      priority: 65,
      config: { minReasoning: 4, minCourage: 3 }
    },
    {
      name: '熟客体验优先',
      code: 'regular_customer_care',
      description: '熟客优先安排体验较好的角色',
      priority: 40,
      config: { regularBonus: 3, regularLeadBonus: 8 }
    },
    {
      name: '反串意愿',
      code: 'cross_gender_willingness',
      description: '考虑玩家的反串意愿',
      priority: 85,
      config: { willingBonus: 10, unwillingPenalty: -25 }
    },
    {
      name: '年龄适配度',
      code: 'age_appropriateness',
      description: '玩家与角色年龄接近度',
      priority: 30,
      config: {}
    }
  ];

  let count = 0;
  for (const r of defaultRules) {
    const existing = getRuleByCode(r.code);
    if (!existing) {
      createRule(r.name, r.code, r.description, r.priority, 1, r.config);
      count++;
      console.log(`  ✓ ${r.name}`);
    }
  }

  if (count === 0) {
    console.log('  （规则已存在，跳过）');
  }
  return count;
}

function seedSampleAllocations(storeIds: number[], scriptIds: number[]): void {
  console.log('');
  console.log('📊 正在创建示例分配记录...');

  const playersSets: { storeIdx: number; scriptIdx: number; players: Player[]; refused: number; changes: number }[] = [
    {
      storeIdx: 0,
      scriptIdx: 0,
      players: [
        { name: '小明', gender: 'male', age: 25, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '小红', gender: 'female', age: 23, is_regular: true, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5 },
        { name: '小刚', gender: 'male', age: 27, is_regular: false, courage_level: 4, reasoning_level: 3, emotional_tolerance: 3 },
        { name: '小丽', gender: 'female', age: 22, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
        { name: '小华', gender: 'male', age: 17, is_regular: false, courage_level: 3, reasoning_level: 3, emotional_tolerance: 2 },
        { name: '小芳', gender: 'female', age: 28, is_regular: true, courage_level: 3, reasoning_level: 3, emotional_tolerance: 4 }
      ],
      refused: 0,
      changes: 0
    },
    {
      storeIdx: 0,
      scriptIdx: 1,
      players: [
        { name: '阿强', gender: 'male', age: 30, is_regular: true, courage_level: 5, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '小美', gender: 'female', age: 26, is_regular: false, courage_level: 2, reasoning_level: 4, emotional_tolerance: 4, cross_gender_willing: false },
        { name: '老王', gender: 'male', age: 50, is_regular: true, courage_level: 4, reasoning_level: 3, emotional_tolerance: 3 },
        { name: '小雪', gender: 'female', age: 22, is_regular: false, courage_level: 1, reasoning_level: 3, emotional_tolerance: 5 },
        { name: '大刘', gender: 'male', age: 35, is_regular: false, courage_level: 5, reasoning_level: 2, emotional_tolerance: 2, cross_gender_willing: true }
      ],
      refused: 1,
      changes: 2
    },
    {
      storeIdx: 1,
      scriptIdx: 2,
      players: [
        { name: '陈老师', gender: 'male', age: 42, is_regular: true, courage_level: 3, reasoning_level: 5, emotional_tolerance: 2 },
        { name: '李律师', gender: 'female', age: 35, is_regular: true, courage_level: 3, reasoning_level: 5, emotional_tolerance: 3 },
        { name: '王同学', gender: 'male', age: 26, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '赵编辑', gender: 'female', age: 29, is_regular: false, courage_level: 4, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '孙警官', gender: 'male', age: 38, is_regular: true, courage_level: 4, reasoning_level: 4, emotional_tolerance: 2 },
        { name: '周秘书', gender: 'female', age: 24, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 4 }
      ],
      refused: 0,
      changes: 1
    },
    {
      storeIdx: 1,
      scriptIdx: 0,
      players: [
        { name: '林小姐', gender: 'female', age: 24, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5 },
        { name: '张先生', gender: 'male', age: 27, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
        { name: '苏女士', gender: 'female', age: 21, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5 },
        { name: '王先生', gender: 'male', age: 29, is_regular: false, courage_level: 4, reasoning_level: 3, emotional_tolerance: 3 },
        { name: '李阿姨', gender: 'female', age: 33, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '张大叔', gender: 'male', age: 38, is_regular: false, courage_level: 5, reasoning_level: 3, emotional_tolerance: 2 }
      ],
      refused: 0,
      changes: 0
    },
    {
      storeIdx: 2,
      scriptIdx: 1,
      players: [
        { name: '阿杰', gender: 'male', age: 28, is_regular: true, courage_level: 5, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '小雯', gender: 'female', age: 25, is_regular: true, courage_level: 3, reasoning_level: 4, emotional_tolerance: 4 },
        { name: '老黄', gender: 'male', age: 52, is_regular: false, courage_level: 4, reasoning_level: 3, emotional_tolerance: 3 },
        { name: '小琳', gender: 'female', age: 23, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 5, cross_gender_willing: false },
        { name: '大兵', gender: 'male', age: 42, is_regular: true, courage_level: 5, reasoning_level: 2, emotional_tolerance: 2 }
      ],
      refused: 2,
      changes: 3
    },
    {
      storeIdx: 3,
      scriptIdx: 2,
      players: [
        { name: '陈哥', gender: 'male', age: 40, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 2 },
        { name: '李姐', gender: 'female', age: 36, is_regular: true, courage_level: 3, reasoning_level: 5, emotional_tolerance: 3 },
        { name: '小王', gender: 'male', age: 25, is_regular: false, courage_level: 3, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '小赵', gender: 'female', age: 28, is_regular: true, courage_level: 4, reasoning_level: 4, emotional_tolerance: 3 },
        { name: '老孙', gender: 'male', age: 37, is_regular: false, courage_level: 4, reasoning_level: 5, emotional_tolerance: 2 },
        { name: '小周', gender: 'female', age: 23, is_regular: false, courage_level: 2, reasoning_level: 3, emotional_tolerance: 4 }
      ],
      refused: 1,
      changes: 1
    }
  ];

  const rules = getEnabledRules();

  for (const set of playersSets) {
    const storeId = storeIds[set.storeIdx];
    const scriptId = scriptIds[set.scriptIdx];
    const characters = getCharactersByScriptId(scriptId);
    const relationships = getRelationshipsByScriptId(scriptId);

    const suggestion = generateAllocationSuggestion(set.players, characters, rules, relationships);
    const allocationId = createAllocation(storeId, scriptId, set.players, suggestion, suggestion.crossGenderCount);
    updateAllocationFeedback(allocationId, set.refused, set.changes, 'completed');
  }

  console.log(`  ✓ 创建了 ${playersSets.length} 条分配记录`);
}

export async function runSeed(): Promise<void> {
  console.log('🌱 开始播种数据...');
  console.log('');

  await initDb();

  const storeIds = seedStores();
  const scriptIds = seedScriptsAndCharacters();
  seedRules();
  seedSampleAllocations(storeIds, scriptIds);

  saveToDisk();

  console.log('');
  console.log('✅ 数据播种完成！');
  console.log('');
  console.log('📊 数据概览:');
  console.log(`   门店: ${storeIds.length} 家`);
  console.log(`   剧本: ${scriptIds.length} 部`);
  console.log(`   规则: 9 条`);
  console.log(`   分配记录: 6 条`);
}

if (require.main === module) {
  runSeed().catch(err => {
    console.error('❌ 播种失败:', err);
    process.exit(1);
  });
}
