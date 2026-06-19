import { Player, Character, Rule, AllocationSuggestion, CharacterRelationship, ScriptType, DmCommunicationPoint, LeadRecommendation, CrossGenderCandidate, SimulationResult, SimulationDiff, PlayerScoreDiff, BatchSimResult, BatchSimResultItem, Script } from '../types';
import { evaluatePlayerCharacterPair, filterApplicableRules } from '../rules/ruleEngine';
import { getActiveRulesForStore, getDraftRules, getRuleByCodeAndVersion, getPublishedRules } from '../models/ruleModel';
import { getCharactersByScriptId, getRelationshipsByScriptId, getScriptById } from '../models/scriptModel';

function permute(arr: number[]): number[][] {
  if (arr.length <= 1) return [arr];
  const result: number[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const perms = permute(rest);
    for (const p of perms) {
      result.push([arr[i], ...p]);
    }
  }
  return result;
}

export function generateAllocationSuggestion(
  players: Player[],
  characters: Character[],
  rules: Rule[],
  relationships: CharacterRelationship[],
  scriptType: ScriptType
): AllocationSuggestion {
  const n = Math.min(players.length, characters.length);

  if (n === 0) {
    return {
      assignments: [],
      totalScore: 0,
      crossGenderCount: 0,
      dmTips: [],
      relationshipHighlights: [],
      leadRecommendations: [],
      crossGenderCandidates: [],
      dmCommunicationPoints: [],
      appliedRules: rules.map(r => ({ id: r.id, name: r.name, code: r.code, version: r.version, priority: r.priority }))
    };
  }

  const scoreMatrix: number[][] = [];
  const reasonsMatrix: string[][][] = [];
  const isCrossMatrix: boolean[][] = [];

  for (let i = 0; i < players.length; i++) {
    scoreMatrix[i] = [];
    reasonsMatrix[i] = [];
    isCrossMatrix[i] = [];
    for (let j = 0; j < characters.length; j++) {
      const result = evaluatePlayerCharacterPair(players[i], characters[j], rules);
      scoreMatrix[i][j] = result.score;
      reasonsMatrix[i][j] = result.reasons;
      isCrossMatrix[i][j] = result.isCrossGender;
    }
  }

  let bestScore = -Infinity;
  let bestAssignment: number[] = [];

  if (players.length === characters.length) {
    const indices = Array.from({ length: n }, (_, i) => i);
    const permutations = permute(indices);

    for (const perm of permutations) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        total += scoreMatrix[i][perm[i]];
      }
      if (total > bestScore) {
        bestScore = total;
        bestAssignment = perm;
      }
    }
  } else if (players.length < characters.length) {
    const charIndices = Array.from({ length: characters.length }, (_, i) => i);
    const combinations = getCombinations(charIndices, players.length);

    for (const combo of combinations) {
      const perms = permute(combo);
      for (const perm of perms) {
        let total = 0;
        for (let i = 0; i < players.length; i++) {
          total += scoreMatrix[i][perm[i]];
        }
        if (total > bestScore) {
          bestScore = total;
          bestAssignment = perm;
        }
      }
    }
  } else {
    const playerIndices = Array.from({ length: players.length }, (_, i) => i);
    const combinations = getCombinations(playerIndices, characters.length);

    for (const combo of combinations) {
      const perms = permute(combo);
      for (const perm of perms) {
        let total = 0;
        for (let j = 0; j < characters.length; j++) {
          total += scoreMatrix[perm[j]][j];
        }
        if (total > bestScore) {
          bestScore = total;
          const fullAssignment: number[] = new Array(players.length).fill(-1);
          for (let j = 0; j < characters.length; j++) {
            fullAssignment[perm[j]] = j;
          }
          bestAssignment = fullAssignment;
        }
      }
    }
  }

  const assignments: AllocationSuggestion['assignments'] = [];
  let crossGenderCount = 0;

  for (let i = 0; i < players.length; i++) {
    const charIdx = bestAssignment[i];
    if (charIdx >= 0 && charIdx < characters.length) {
      const isCross = isCrossMatrix[i][charIdx];
      if (isCross) crossGenderCount++;
      assignments.push({
        player: players[i],
        character: characters[charIdx],
        score: scoreMatrix[i][charIdx],
        reasons: reasonsMatrix[i][charIdx],
        isCrossGender: isCross
      });
    }
  }

  const dmTips = generateDmTips(assignments, characters, rules);
  const relationshipHighlights = generateRelationshipHighlights(assignments, relationships, characters);
  const leadRecommendations = generateLeadRecommendations(assignments);
  const crossGenderCandidates = generateCrossGenderCandidates(players, characters, rules);
  const dmCommunicationPoints = generateDmCommunicationPoints(assignments, relationshipHighlights, scriptType);

  return {
    assignments,
    totalScore: Math.round(bestScore * 100) / 100,
    crossGenderCount,
    dmTips,
    relationshipHighlights,
    leadRecommendations,
    crossGenderCandidates,
    dmCommunicationPoints,
    appliedRules: rules.map(r => ({ id: r.id, name: r.name, code: r.code, version: r.version, priority: r.priority }))
  };
}

function getCombinations(arr: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  if (k === arr.length) return [arr];

  const result: number[][] = [];
  const [first, ...rest] = arr;

  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);

  result.push(...withFirst, ...withoutFirst);
  return result;
}

function generateDmTips(
  assignments: AllocationSuggestion['assignments'],
  characters: Character[],
  rules: Rule[]
): string[] {
  const tips: string[] = [];

  const crossGenderAssignments = assignments.filter(a => a.isCrossGender);
  if (crossGenderAssignments.length > 0) {
    const names = crossGenderAssignments.map(a => `${a.player.name}（${a.character.name}）`).join('、');
    tips.push(`本场有 ${crossGenderAssignments.length} 位反串：${names}，DM 开场前需重点确认玩家接受度`);
  }

  const leadAssignments = assignments.filter(a => a.character.is_lead);
  for (const lead of leadAssignments) {
    if (lead.player.is_regular) {
      tips.push(`核心角色 ${lead.character.name} 由熟客 ${lead.player.name} 担任，可适当增加互动`);
    } else {
      tips.push(`核心角色 ${lead.character.name} 由新手 ${lead.player.name} 担任，DM 需注意引导`);
    }
  }

  const lowScoring = assignments.filter(a => a.score < 10);
  if (lowScoring.length > 0) {
    const names = lowScoring.map(a => `${a.player.name}-${a.character.name}`).join('、');
    tips.push(`以下配对匹配度较低：${names}，建议 DM 多关注体验`);
  }

  const hasNewPlayers = assignments.some(a => !a.player.is_regular);
  if (hasNewPlayers) {
    const regularCount = assignments.filter(a => a.player.is_regular).length;
    if (regularCount > 0) {
      tips.push(`本场有新手玩家，建议安排熟客带动氛围`);
    } else {
      tips.push(`本场全为新手，DM 需放慢节奏、加强引导`);
    }
  }

  return tips;
}

function generateRelationshipHighlights(
  assignments: AllocationSuggestion['assignments'],
  relationships: CharacterRelationship[],
  characters: Character[]
): AllocationSuggestion['relationshipHighlights'] {
  const highlights: AllocationSuggestion['relationshipHighlights'] = [];

  const charIdToPlayer = new Map<number, string>();
  for (const a of assignments) {
    charIdToPlayer.set(a.character.id, a.player.name);
  }

  const importantRelationships = relationships
    .filter(r => r.importance >= 4)
    .slice(0, 5);

  for (const rel of importantRelationships) {
    const playerA = charIdToPlayer.get(rel.character_a_id);
    const playerB = charIdToPlayer.get(rel.character_b_id);
    const charA = characters.find(c => c.id === rel.character_a_id);
    const charB = characters.find(c => c.id === rel.character_b_id);

    if (playerA && playerB && charA && charB) {
      let tip = '';
      switch (rel.relationship_type) {
        case '情侣':
        case '恋人':
          tip = `情侣线：${playerA}（${charA.name}）与 ${playerB}（${charB.name}），DM 开场前可暗示情感走向`;
          break;
        case '宿敌':
        case '仇人':
          tip = `对立线：${playerA}（${charA.name}）与 ${playerB}（${charB.name}），注意控制对抗强度`;
          break;
        case '挚友':
        case '兄弟':
        case '姐妹':
          tip = `友情线：${playerA}（${charA.name}）与 ${playerB}（${charB.name}），可作为信任基础`;
          break;
        case '亲属':
        case '家人':
          tip = `亲情线：${playerA}（${charA.name}）与 ${playerB}（${charB.name}），情感权重较高`;
          break;
        default:
          tip = `重要关系（${rel.relationship_type}）：${playerA}（${charA.name}）与 ${playerB}（${charB.name}）`;
      }
      highlights.push({
        characterA: charA.name,
        characterB: charB.name,
        relationship: rel.relationship_type,
        tip
      });
    }
  }

  return highlights;
}

function generateLeadRecommendations(
  assignments: AllocationSuggestion['assignments']
): LeadRecommendation[] {
  return assignments
    .filter(a => a.character.is_lead === 1)
    .map(a => ({
      characterId: a.character.id,
      characterName: a.character.name,
      playerName: a.player.name,
      score: a.score,
      reasons: a.reasons.filter(r =>
        r.includes('核心角色') || r.includes('推理') || r.includes('胆量') || r.includes('熟客')
      ),
      isRegular: a.player.is_regular || false
    }));
}

function generateCrossGenderCandidates(
  players: Player[],
  characters: Character[],
  rules: Rule[]
): CrossGenderCandidate[] {
  const candidates: CrossGenderCandidate[] = [];

  for (const player of players) {
    for (const character of characters) {
      if (player.gender !== character.gender && player.gender !== 'other' && character.gender !== 'other') {
        const evalResult = evaluatePlayerCharacterPair(player, character, rules);
        candidates.push({
          playerId: player.name,
          playerName: player.name,
          originalGender: player.gender,
          targetCharacterId: character.id,
          targetCharacterName: character.name,
          targetGender: character.gender,
          score: evalResult.score,
          willing: player.cross_gender_willing,
          reasons: evalResult.reasons.filter(r =>
            r.includes('反串') || r.includes('胆量') || r.includes('推理') || r.includes('情感') || r.includes('性别')
          )
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 10);
}

function generateDmCommunicationPoints(
  assignments: AllocationSuggestion['assignments'],
  relationshipHighlights: AllocationSuggestion['relationshipHighlights'],
  scriptType: ScriptType
): DmCommunicationPoint[] {
  const points: DmCommunicationPoint[] = [];

  const crossGender = assignments.filter(a => a.isCrossGender);
  for (const a of crossGender) {
    const priority: 'high' | 'medium' | 'low' = a.player.cross_gender_willing === false ? 'high'
      : a.player.cross_gender_willing === true ? 'low' : 'medium';
    points.push({
      type: 'cross_gender',
      priority,
      title: `反串确认：${a.player.name} → ${a.character.name}`,
      detail: `${a.player.name}（${a.player.gender === 'male' ? '男' : '女'}）被分配到${a.character.gender === 'male' ? '男' : '女'}角色${a.character.name}${a.player.cross_gender_willing === false ? '，玩家已表示不愿意反串' : a.player.cross_gender_willing === true ? '，玩家自愿反串' : '，需确认反串意愿'}`,
      involvedPlayers: [a.player.name]
    });
  }

  for (const a of assignments) {
    if (a.character.is_lead && !a.player.is_regular) {
      const minorWarning = a.player.age !== undefined && a.player.age < 18;
      if (minorWarning) {
        points.push({
          type: 'minor_warning',
          priority: 'high',
          title: `未成年人核心角色：${a.player.name} → ${a.character.name}`,
          detail: `${a.player.name}（${a.player.age}岁）被分配到核心角色${a.character.name}，需确认是否适合`,
          involvedPlayers: [a.player.name]
        });
      } else {
        points.push({
          type: 'lead_newbie',
          priority: 'medium',
          title: `新手核心角色：${a.player.name} → ${a.character.name}`,
          detail: `${a.player.name}是新手，被分配到核心角色${a.character.name}，DM需注意引导`,
          involvedPlayers: [a.player.name]
        });
      }
    }
  }

  for (const a of assignments) {
    if (a.score < 10 && !a.isCrossGender) {
      points.push({
        type: 'low_match',
        priority: 'low',
        title: `匹配度偏低：${a.player.name} → ${a.character.name}`,
        detail: `该配对得分${a.score.toFixed(1)}，可能影响体验，DM需多关注`,
        involvedPlayers: [a.player.name]
      });
    }
  }

  for (const rel of relationshipHighlights) {
    const typeLabel = scriptType === 'emotional' ? '情感本' : scriptType === 'horror' ? '恐怖本' : scriptType === 'hardcore' ? '硬核本' : '剧本';
    const isEmotionalRel = ['情侣', '恋人', '亲属', '家人', '姐妹', '兄弟'].includes(rel.relationship);
    const priority: 'high' | 'medium' | 'low' = isEmotionalRel && scriptType === 'emotional' ? 'high' : 'medium';

    points.push({
      type: 'relationship',
      priority,
      title: `${typeLabel}关系线：${rel.characterA} ↔ ${rel.characterB}（${rel.relationship}）`,
      detail: rel.tip,
      involvedPlayers: []
    });
  }

  points.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return points;
}

export function getTopCandidates(
  players: Player[],
  characters: Character[],
  rules: Rule[],
  topN: number = 3
): { playerName: string; candidates: { characterName: string; score: number; reasons: string[] }[] }[] {
  const result: { playerName: string; candidates: { characterName: string; score: number; reasons: string[] }[] }[] = [];

  for (const player of players) {
    const scores: { characterName: string; score: number; reasons: string[] }[] = [];
    for (const character of characters) {
      const evalResult = evaluatePlayerCharacterPair(player, character, rules);
      scores.push({
        characterName: character.name,
        score: evalResult.score,
        reasons: evalResult.reasons
      });
    }
    scores.sort((a, b) => b.score - a.score);
    result.push({
      playerName: player.name,
      candidates: scores.slice(0, topN)
    });
  }

  return result;
}

export function simulateAllocation(
  players: Player[],
  characters: Character[],
  relationships: CharacterRelationship[],
  scriptType: ScriptType,
  options: {
    currentRules: Rule[];
    draftRules?: Rule[];
    specifiedRules?: Rule[];
  }
): SimulationResult {
  const current = generateAllocationSuggestion(
    players, characters, options.currentRules, relationships, scriptType
  );

  const result: SimulationResult = { current };

  if (options.draftRules && options.draftRules.length > 0) {
    result.draft = generateAllocationSuggestion(
      players, characters, options.draftRules, relationships, scriptType
    );
    result.diffCurrentVsDraft = computeAllocationDiff(current, result.draft);
  }

  if (options.specifiedRules && options.specifiedRules.length > 0) {
    result.specified = generateAllocationSuggestion(
      players, characters, options.specifiedRules, relationships, scriptType
    );
    result.diffCurrentVsSpecified = computeAllocationDiff(current, result.specified);
  }

  return result;
}

function computeAllocationDiff(
  base: AllocationSuggestion,
  target: AllocationSuggestion
): SimulationDiff {
  const roleChanges: { playerName: string; fromCharacter: string; toCharacter: string }[] = [];
  const playerScoreDiffs: PlayerScoreDiff[] = [];

  const baseAssignments = new Map<string, { character: string; score: number; reasons: string[] }>();
  for (const a of base.assignments) {
    baseAssignments.set(a.player.name, {
      character: a.character.name,
      score: a.score,
      reasons: a.reasons,
    });
  }

  const targetAssignments = new Map<string, { character: string; score: number; reasons: string[] }>();
  for (const a of target.assignments) {
    targetAssignments.set(a.player.name, {
      character: a.character.name,
      score: a.score,
      reasons: a.reasons,
    });
  }

  const allPlayers = new Set([...baseAssignments.keys(), ...targetAssignments.keys()]);

  for (const pName of allPlayers) {
    const b = baseAssignments.get(pName);
    const t = targetAssignments.get(pName);
    const fromChar = b?.character ?? '未分配';
    const toChar = t?.character ?? '未分配';
    const scoreDiff = Math.round(((t?.score ?? 0) - (b?.score ?? 0)) * 100) / 100;

    if (b && t && b.character !== t.character) {
      roleChanges.push({ playerName: pName, fromCharacter: fromChar, toCharacter: toChar });
    }

    const diffReasons: string[] = [];
    if (t && b) {
      const tSet = new Set(t.reasons);
      const bSet = new Set(b.reasons);
      for (const r of t.reasons) if (!bSet.has(r)) diffReasons.push(`新增：${r}`);
      for (const r of b.reasons) if (!tSet.has(r)) diffReasons.push(`移除：${r}`);
    } else if (t && !b) {
      for (const r of t.reasons) diffReasons.push(`新分配：${r}`);
    } else if (!t && b) {
      for (const r of b.reasons) diffReasons.push(`不再分配：${r}`);
    }
    const biggestScoreReason = diffReasons.length > 0
      ? diffReasons.join('；')
      : (scoreDiff > 0 ? '命中规则权重提升' : scoreDiff < 0 ? '命中规则权重降低' : '规则命中及得分基本持平');

    playerScoreDiffs.push({
      playerName: pName,
      fromCharacter: fromChar,
      toCharacter: toChar,
      scoreDiff,
      biggestScoreReason,
    });
  }

  playerScoreDiffs.sort((x, y) => Math.abs(y.scoreDiff) - Math.abs(x.scoreDiff));

  const baseRuleMap = new Map<string, { version: number; name: string }>();
  const targetRuleMap = new Map<string, { version: number; name: string }>();
  for (const r of base.appliedRules) baseRuleMap.set(r.code, { version: r.version, name: r.name });
  for (const r of target.appliedRules) targetRuleMap.set(r.code, { version: r.version, name: r.name });

  const added: { code: string; version: number }[] = [];
  const removed: { code: string; version: number }[] = [];
  const changed: { code: string; fromVersion: number; toVersion: number }[] = [];

  for (const [code, info] of targetRuleMap) {
    if (!baseRuleMap.has(code)) {
      added.push({ code, version: info.version });
    } else if (baseRuleMap.get(code)!.version !== info.version) {
      changed.push({ code, fromVersion: baseRuleMap.get(code)!.version, toVersion: info.version });
    }
  }

  for (const [code, info] of baseRuleMap) {
    if (!targetRuleMap.has(code)) {
      removed.push({ code, version: info.version });
    }
  }

  const hitRuleVersions = {
    current: Array.from(baseRuleMap.entries()).map(([code, info]) => ({
      code,
      version: info.version,
      name: info.name,
    })),
    compare: Array.from(targetRuleMap.entries()).map(([code, info]) => ({
      code,
      version: info.version,
      name: info.name,
    })),
  };

  return {
    roleChanges,
    crossGenderCountDiff: target.crossGenderCount - base.crossGenderCount,
    totalScoreDiff: Math.round((target.totalScore - base.totalScore) * 100) / 100,
    ruleVersionDiff: { added, removed, changed },
    playerScoreDiffs,
    hitRuleVersions,
  };
}

function buildCompareRules(
  mode: 'draft' | 'gray' | 'specified',
  baselineRules: Rule[],
  options: {
    grayStoreId?: number;
    specifiedRuleVersions?: Array<{ code: string; version: number }>;
  }
): Rule[] {
  if (mode === 'draft') {
    const draftRules = getDraftRules();
    const draftMap = new Map<string, Rule>();
    for (const r of draftRules) {
      if (!draftMap.has(r.code) || r.version > draftMap.get(r.code)!.version) {
        draftMap.set(r.code, r);
      }
    }
    const result: Rule[] = [];
    const usedCodes = new Set<string>();
    for (const r of baselineRules) {
      if (draftMap.has(r.code)) {
        result.push(draftMap.get(r.code)!);
        usedCodes.add(r.code);
      } else {
        result.push(r);
      }
    }
    for (const [code, draftRule] of draftMap) {
      if (!usedCodes.has(code)) {
        result.push(draftRule);
      }
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  if (mode === 'gray' && options.grayStoreId !== undefined) {
    return getActiveRulesForStore(options.grayStoreId);
  }

  if (mode === 'specified' && options.specifiedRuleVersions) {
    const specifiedMap = new Map<string, Rule>();
    for (const sv of options.specifiedRuleVersions) {
      const rule = getRuleByCodeAndVersion(sv.code, sv.version);
      if (rule) {
        specifiedMap.set(sv.code, rule);
      }
    }
    const result: Rule[] = [];
    const usedCodes = new Set<string>();
    for (const r of baselineRules) {
      if (specifiedMap.has(r.code)) {
        result.push(specifiedMap.get(r.code)!);
        usedCodes.add(r.code);
      } else {
        result.push(r);
      }
    }
    for (const [code, specRule] of specifiedMap) {
      if (!usedCodes.has(code)) {
        result.push(specRule);
      }
    }
    return result.sort((a, b) => b.priority - a.priority);
  }

  return baselineRules;
}

function generateRiskTips(
  baseline: AllocationSuggestion,
  compare: AllocationSuggestion,
  diff: SimulationDiff
): string[] {
  const tips: string[] = [];

  const scoreDiffPct = baseline.totalScore !== 0
    ? (diff.totalScoreDiff / baseline.totalScore) * 100
    : 0;

  if (scoreDiffPct <= -10) {
    tips.push(`总分下降 ${Math.abs(scoreDiffPct).toFixed(1)}%，超过 10% 警戒线，需重点关注`);
  } else if (diff.totalScoreDiff < 0) {
    tips.push(`总分下降 ${Math.abs(diff.totalScoreDiff).toFixed(1)} 分，建议核对规则权重调整是否合理`);
  }

  if (diff.crossGenderCountDiff > 0) {
    tips.push(`反串人数增加 ${diff.crossGenderCountDiff} 人，可能提升现场协调成本`);
  }

  if (diff.roleChanges.length > 0) {
    const leadChanges = diff.roleChanges.filter(rc => {
      const toChar = compare.assignments.find(a => a.character.name === rc.toCharacter);
      const fromChar = baseline.assignments.find(a => a.character.name === rc.fromCharacter);
      return (toChar?.character.is_lead === 1) || (fromChar?.character.is_lead === 1);
    });
    if (leadChanges.length > 0) {
      tips.push(`核心角色分配发生变化，涉及 ${leadChanges.length} 位玩家，可能影响剧情体验`);
    }
  }

  const crossGenderIncrease = diff.crossGenderCountDiff >= 2;
  const bigScoreDrop = scoreDiffPct <= -10;
  if (crossGenderIncrease && bigScoreDrop) {
    tips.push('高风险：反串显著增加且总分大幅下降，建议暂缓规则发布');
  } else if (crossGenderIncrease) {
    tips.push('中风险：反串人数增加较多，建议确认玩家接受度');
  }

  if (tips.length === 0) {
    tips.push('整体表现平稳，未见明显风险');
  }

  return tips.slice(0, 5);
}

function isHighRisk(scoreDiffPct: number, crossGenderDiff: number): boolean {
  return crossGenderDiff >= 2 || scoreDiffPct <= -10;
}

function generateOverallInsights(
  groups: BatchSimResultItem[],
  compareMode: string
): string[] {
  const insights: string[] = [];
  const total = groups.length;

  if (total === 0) {
    return ['暂无数据'];
  }

  const improvedCount = groups.filter(g => g.scoreDiffVsBaseline > 0).length;
  const declinedCount = groups.filter(g => g.scoreDiffVsBaseline < 0).length;
  const crossGenderDecreasedCount = groups.filter(g => g.crossGenderDiffVsBaseline < 0).length;
  const highRiskCount = groups.filter(g => {
    const scoreDiffPct = g.totalScore !== 0
      ? (g.scoreDiffVsBaseline / g.totalScore) * 100
      : 0;
    return isHighRisk(scoreDiffPct, g.crossGenderDiffVsBaseline);
  }).length;

  const improvedPct = Math.round((improvedCount / total) * 100);
  const declinedPct = Math.round((declinedCount / total) * 100);
  const crossDecPct = Math.round((crossGenderDecreasedCount / total) * 100);

  if (improvedPct >= 60) {
    insights.push(`${improvedPct}% 的分组匹配度提升，整体效果积极，建议${compareMode === 'gray' ? '扩大灰度范围' : '推进规则发布'}`);
  } else if (declinedPct >= 50) {
    insights.push(`${declinedPct}% 的分组匹配度下降，规则调整效果不及预期，建议重新评估`);
  } else {
    insights.push('匹配度变化较为分化，建议针对下降分组深入分析');
  }

  if (crossDecPct >= 50) {
    insights.push(`${crossDecPct}% 的分组反串人数下降，有助于降低现场协调难度`);
  }

  if (highRiskCount > 0) {
    insights.push(`存在 ${highRiskCount} 个高风险分组，建议逐一排查原因后再决定发布节奏`);
  }

  if (insights.length === 0) {
    insights.push('整体变化平稳，未见显著趋势');
  }

  return insights;
}

export function batchSimulateAllocation(options: {
  baselineStoreId: number;
  compareMode: 'draft' | 'gray' | 'specified';
  groups: Array<{
    groupId: string;
    groupName: string;
    storeId?: number;
    scriptId: number;
    players: Player[];
  }>;
  specifiedRuleVersions?: Array<{ code: string; version: number }>;
}): BatchSimResult {
  const { baselineStoreId, compareMode, groups, specifiedRuleVersions } = options;

  const baselineRulesAll = getActiveRulesForStore(baselineStoreId);

  const resultItems: BatchSimResultItem[] = [];

  for (const group of groups) {
    const script = getScriptById(group.scriptId);
    if (!script) continue;

    const characters = getCharactersByScriptId(group.scriptId);
    const relationships = getRelationshipsByScriptId(group.scriptId);

    const baselineRules = filterApplicableRules(baselineRulesAll, script.type, baselineStoreId);
    const baselineResult = generateAllocationSuggestion(
      group.players, characters, baselineRules, relationships, script.type
    );

    let compareRules: Rule[];
    if (compareMode === 'gray' && group.storeId !== undefined) {
      const grayRulesAll = getActiveRulesForStore(group.storeId);
      compareRules = filterApplicableRules(grayRulesAll, script.type, group.storeId);
    } else {
      const compareRulesAll = buildCompareRules(compareMode, baselineRulesAll, {
        grayStoreId: group.storeId,
        specifiedRuleVersions,
      });
      compareRules = filterApplicableRules(compareRulesAll, script.type, baselineStoreId);
    }

    const compareResult = generateAllocationSuggestion(
      group.players, characters, compareRules, relationships, script.type
    );

    const diff = computeAllocationDiff(baselineResult, compareResult);

    const scoreDiffPct = baselineResult.totalScore !== 0
      ? (diff.totalScoreDiff / baselineResult.totalScore) * 100
      : 0;

    const riskTips = generateRiskTips(baselineResult, compareResult, diff);

    resultItems.push({
      groupId: group.groupId,
      groupName: group.groupName,
      storeId: group.storeId,
      scriptId: group.scriptId,
      scriptName: script.name,
      totalScore: compareResult.totalScore,
      crossGenderCount: compareResult.crossGenderCount,
      scoreDiffVsBaseline: diff.totalScoreDiff,
      crossGenderDiffVsBaseline: diff.crossGenderCountDiff,
      hitRuleVersions: diff.hitRuleVersions.compare,
      riskTips,
      roleChangesCount: diff.roleChanges.length,
      playerScoreDiffs: diff.playerScoreDiffs,
    });
  }

  const improvedCount = resultItems.filter(g => g.scoreDiffVsBaseline > 0).length;
  const declinedCount = resultItems.filter(g => g.scoreDiffVsBaseline < 0).length;
  const avgScoreDiff = resultItems.length > 0
    ? Math.round((resultItems.reduce((sum, g) => sum + g.scoreDiffVsBaseline, 0) / resultItems.length) * 100) / 100
    : 0;
  const avgCrossGenderDiff = resultItems.length > 0
    ? Math.round((resultItems.reduce((sum, g) => sum + g.crossGenderDiffVsBaseline, 0) / resultItems.length) * 100) / 100
    : 0;

  const highRiskCount = resultItems.filter(g => {
    const scoreDiffPct = g.totalScore !== 0
      ? (g.scoreDiffVsBaseline / g.totalScore) * 100
      : 0;
    return isHighRisk(scoreDiffPct, g.crossGenderDiffVsBaseline);
  }).length;

  const overallInsights = generateOverallInsights(resultItems, compareMode);

  return {
    baselineStoreId,
    compareMode,
    groups: resultItems,
    overallSummary: {
      totalGroups: resultItems.length,
      improvedCount,
      declinedCount,
      avgScoreDiff,
      avgCrossGenderDiff,
      highRiskCount,
    },
    overallInsights,
  };
}
