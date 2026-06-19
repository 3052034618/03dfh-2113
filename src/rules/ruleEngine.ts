import { Player, Character, Rule, RuleConfig, RuleScope, ScriptType, PlayerScore } from '../types';
import { parseRuleConfig, parseRuleScope } from '../models/ruleModel';

export interface RuleEvaluationResult {
  score: number;
  reasons: string[];
}

export interface RuleEvaluator {
  evaluate(player: Player, character: Character, config: RuleConfig): RuleEvaluationResult;
  defaultApplicableTypes: ScriptType[];
}

const ruleEvaluators: Record<string, RuleEvaluator> = {};

function registerRule(code: string, defaultApplicableTypes: ScriptType[], evaluator: (player: Player, character: Character, config: RuleConfig) => RuleEvaluationResult): void {
  ruleEvaluators[code] = {
    evaluate: evaluator,
    defaultApplicableTypes
  };
}

registerRule('gender_match', ['emotional', 'horror', 'hardcore', '欢乐', '阵营', 'other'],
  (player: Player, character: Character): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;

    if (player.gender === character.gender) {
      score = 20;
      reasons.push(`性别匹配（${player.gender === 'male' ? '男' : player.gender === 'female' ? '女' : '其他'}）`);
    } else if (player.gender !== 'other' && character.gender !== 'other') {
      score = -15;
      reasons.push('需要反串');
    } else {
      score = 0;
    }

    return { score, reasons };
  }
);

registerRule('minor_no_emotional_cross', ['emotional', 'horror', 'hardcore', '欢乐', '阵营', 'other'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;
    const ageThreshold = config.ageThreshold || 18;
    const emotionalThreshold = config.emotionalThreshold || 4;

    const isCrossGender = player.gender !== character.gender && player.gender !== 'other' && character.gender !== 'other';
    const isMinor = player.age !== undefined && player.age < ageThreshold;
    const isHighEmotional = character.emotional_depth >= emotionalThreshold;

    if (isMinor && isCrossGender && isHighEmotional) {
      score = -30;
      reasons.push(`未成年人不推荐重情感反串角色（${character.name}情感深度${character.emotional_depth}）`);
    }

    return { score, reasons };
  }
);

registerRule('horror_courage_match', ['horror'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;
    const weight = config.weight || 1;

    const playerCourage = player.courage_level ?? 3;
    const charCourage = character.courage_required;
    const diff = Math.abs(playerCourage - charCourage);

    if (diff === 0) {
      score = 15 * weight;
      reasons.push(`胆量完美匹配（玩家${playerCourage}级 / 角色${charCourage}级）`);
    } else if (diff === 1) {
      score = 8 * weight;
      reasons.push(`胆量基本匹配（玩家${playerCourage}级 / 角色${charCourage}级）`);
    } else if (diff === 2) {
      score = -5 * weight;
      reasons.push(`胆量差距较大（玩家${playerCourage}级 / 角色${charCourage}级）`);
    } else {
      score = -15 * weight;
      reasons.push(`胆量差距悬殊（玩家${playerCourage}级 / 角色${charCourage}级）`);
    }

    return { score, reasons };
  }
);

registerRule('hardcore_reasoning_match', ['hardcore'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;
    const weight = config.weight || 1;

    const playerReasoning = player.reasoning_level ?? 3;
    const charReasoning = character.reasoning_required;
    const diff = playerReasoning - charReasoning;

    if (diff >= 0) {
      score = (12 + diff * 3) * weight;
      reasons.push(`推理能力胜任（玩家${playerReasoning}级 / 角色${charReasoning}级）`);
    } else if (diff === -1) {
      score = 3 * weight;
      reasons.push(`推理能力略低但可尝试（玩家${playerReasoning}级 / 角色${charReasoning}级）`);
    } else {
      score = (diff * 8) * weight;
      reasons.push(`推理能力不足（玩家${playerReasoning}级 / 角色${charReasoning}级）`);
    }

    return { score, reasons };
  }
);

registerRule('emotional_depth_match', ['emotional'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;
    const weight = config.weight || 1;

    const playerEmotional = player.emotional_tolerance ?? 3;
    const charEmotional = character.emotional_depth;

    if (playerEmotional >= charEmotional) {
      score = 10 * weight;
      reasons.push(`情感承受力匹配（玩家${playerEmotional}级 / 角色${charEmotional}级）`);
    } else {
      const diff = charEmotional - playerEmotional;
      score = -diff * 6 * weight;
      reasons.push(`情感承受力不足（玩家${playerEmotional}级 / 角色${charEmotional}级）`);
    }

    return { score, reasons };
  }
);

registerRule('lead_character_priority', ['emotional', 'horror', 'hardcore', '欢乐', '阵营', 'other'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;
    const minReasoning = config.minReasoning || 4;
    const minCourage = config.minCourage || 3;

    if (character.is_lead) {
      const playerReasoning = player.reasoning_level ?? 3;
      const playerCourage = player.courage_level ?? 3;

      if (playerReasoning >= minReasoning && playerCourage >= minCourage) {
        score = 12;
        reasons.push(`适合核心角色（推理${playerReasoning}级+胆量${playerCourage}级）`);
      } else if (player.is_regular) {
        score = 5;
        reasons.push('熟客可尝试核心角色');
      } else {
        score = -10;
        reasons.push('核心角色对新手有挑战');
      }
    }

    return { score, reasons };
  }
);

registerRule('regular_customer_care', ['emotional', 'horror', 'hardcore', '欢乐', '阵营', 'other'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;

    if (player.is_regular) {
      if (character.is_lead) {
        score = config.regularLeadBonus || 8;
        reasons.push('熟客优先安排核心角色');
      } else {
        score = config.regularBonus || 3;
        reasons.push('熟客体验优先');
      }
    }

    return { score, reasons };
  }
);

registerRule('cross_gender_willingness', ['emotional', 'horror', 'hardcore', '欢乐', '阵营', 'other'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;

    const isCrossGender = player.gender !== character.gender && player.gender !== 'other' && character.gender !== 'other';

    if (isCrossGender) {
      if (player.cross_gender_willing === true) {
        score = config.willingBonus || 10;
        reasons.push('玩家自愿反串');
      } else if (player.cross_gender_willing === false) {
        score = config.unwillingPenalty || -25;
        reasons.push('玩家明确不愿意反串');
      }
    }

    return { score, reasons };
  }
);

registerRule('age_appropriateness', ['emotional', 'horror', 'hardcore', '欢乐', '阵营', 'other'],
  (player: Player, character: Character, config: RuleConfig): RuleEvaluationResult => {
    const reasons: string[] = [];
    let score = 0;

    if (player.age !== undefined && character.age !== undefined) {
      const ageDiff = Math.abs(player.age - character.age);
      if (ageDiff <= 5) {
        score = 5;
        reasons.push(`年龄接近（玩家${player.age}岁 / 角色${character.age}岁）`);
      } else if (ageDiff <= 15) {
        score = 2;
      } else {
        score = -3;
        reasons.push(`年龄差距较大（玩家${player.age}岁 / 角色${character.age}岁）`);
      }
    }

    return { score, reasons };
  }
);

export function isRuleApplicableToType(rule: Rule, scriptType: ScriptType): boolean {
  const scope = parseRuleScope(rule);
  const evaluator = ruleEvaluators[rule.code];
  if (!evaluator) return true;

  if (scope.scriptTypes && scope.scriptTypes.length > 0) {
    return scope.scriptTypes.includes(scriptType);
  }

  return evaluator.defaultApplicableTypes.includes(scriptType);
}

export function isRuleApplicableToStore(rule: Rule, storeId: number): boolean {
  const scope = parseRuleScope(rule);
  if (scope.allStores) return true;
  if (!scope.storeIds || scope.storeIds.length === 0) return true;
  return scope.storeIds.includes(storeId);
}

export function filterApplicableRules(rules: Rule[], scriptType: ScriptType, storeId?: number): Rule[] {
  return rules.filter(rule => {
    if (!rule.enabled) return false;
    if (!isRuleApplicableToType(rule, scriptType)) return false;
    if (storeId !== undefined && !isRuleApplicableToStore(rule, storeId)) return false;
    return true;
  });
}

export function evaluatePlayerCharacterPair(
  player: Player,
  character: Character,
  rules: Rule[]
): PlayerScore {
  let totalScore = 0;
  const allReasons: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const evaluator = ruleEvaluators[rule.code];
    if (!evaluator) continue;

    const config = parseRuleConfig(rule);
    const result = evaluator.evaluate(player, character, config);

    const weightedScore = result.score * (rule.priority / 50);
    totalScore += weightedScore;

    if (result.reasons.length > 0) {
      allReasons.push(...result.reasons);
    }
  }

  const isCrossGender = player.gender !== character.gender && player.gender !== 'other' && character.gender !== 'other';

  return {
    playerName: player.name,
    characterId: character.id,
    characterName: character.name,
    score: Math.round(totalScore * 100) / 100,
    reasons: allReasons,
    isCrossGender,
    isLead: character.is_lead === 1
  };
}

export function getAvailableRuleCodes(): string[] {
  return Object.keys(ruleEvaluators);
}

export function getDefaultApplicableTypes(code: string): ScriptType[] {
  const evaluator = ruleEvaluators[code];
  return evaluator ? evaluator.defaultApplicableTypes : [];
}
