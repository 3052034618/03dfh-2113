import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody, handleAsync } from '../middleware/validation';
import { generateAllocationSuggestion, getTopCandidates, simulateAllocation, batchSimulateAllocation } from '../services/allocationService';
import { getActiveRulesForStore, getPublishedRules, getDraftRules, getRuleByCodeAndVersion } from '../models/ruleModel';
import { getScriptById, getCharactersByScriptId, getRelationshipsByScriptId } from '../models/scriptModel';
import { getStoreById } from '../models/storeModel';
import { filterApplicableRules } from '../rules/ruleEngine';
import {
  createAllocation,
  getAllocationById,
  getAllocationsByStoreId,
  getAllocationsByFilters,
  updateAllocationFeedback,
  getAllAllocations,
  parseRuleVersions
} from '../models/allocationModel';
import { StatsFilters } from '../models/statsModel';

const router = Router();

const playerSchema = z.object({
  name: z.string().min(1).max(50),
  gender: z.enum(['male', 'female', 'other']),
  age: z.number().int().positive().optional(),
  is_regular: z.boolean().optional().default(false),
  courage_level: z.number().int().min(1).max(5).optional(),
  reasoning_level: z.number().int().min(1).max(5).optional(),
  emotional_tolerance: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string()).optional(),
  cross_gender_willing: z.boolean().optional()
});

const allocateSchema = z.object({
  store_id: z.number().int().positive(),
  script_id: z.number().int().positive(),
  players: z.array(playerSchema).min(1).max(20)
});

const simulateSchema = z.object({
  store_id: z.number().int().positive(),
  script_id: z.number().int().positive(),
  players: z.array(playerSchema).min(1).max(20),
  compare_draft: z.boolean().optional().default(false),
  specified_versions: z.array(z.object({
    code: z.string(),
    version: z.number().int().positive()
  })).optional()
});

const batchSimulateGroupSchema = z.object({
  group_id: z.string().min(1),
  group_name: z.string().min(1),
  store_id: z.number().int().positive().optional(),
  script_id: z.number().int().positive(),
  players: z.array(playerSchema).min(1).max(20)
});

const batchSimulateSchema = z.object({
  baseline_store_id: z.number().int().positive(),
  compare_mode: z.enum(['draft', 'gray', 'specified']),
  groups: z.array(batchSimulateGroupSchema).min(1).max(20),
  specified_versions: z.array(z.object({
    code: z.string(),
    version: z.number().int().positive()
  })).optional()
}).refine(data => {
  if (data.compare_mode === 'gray') {
    return data.groups.every(g => g.store_id !== undefined);
  }
  return true;
}, {
  message: 'gray 模式下每个 group 必须有 store_id',
  path: ['groups']
}).refine(data => {
  if (data.compare_mode === 'specified') {
    return data.specified_versions !== undefined && data.specified_versions.length > 0;
  }
  return true;
}, {
  message: 'specified 模式下 specified_versions 不能为空',
  path: ['specified_versions']
});

const feedbackSchema = z.object({
  cross_gender_refused: z.number().int().min(0).default(0),
  on_site_changes: z.number().int().min(0).default(0),
  status: z.enum(['pending', 'completed', 'cancelled']).optional().default('completed')
});

router.post('/allocate', validateBody(allocateSchema), handleAsync(async (req: Request, res: Response) => {
  const { store_id, script_id, players } = req.body;

  const store = getStoreById(store_id);
  if (!store) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  const script = getScriptById(script_id);
  if (!script) {
    res.status(404).json({ success: false, error: '剧本不存在' });
    return;
  }

  const characters = getCharactersByScriptId(script_id);
  if (characters.length === 0) {
    res.status(400).json({ success: false, error: '该剧本暂无角色配置' });
    return;
  }

  const relationships = getRelationshipsByScriptId(script_id);
  const activeRules = getActiveRulesForStore(store_id);
  const applicableRules = filterApplicableRules(activeRules, script.type, store_id);

  const suggestion = generateAllocationSuggestion(players, characters, applicableRules, relationships, script.type);

  const ruleVersions = suggestion.appliedRules.map(r => ({
    id: r.id,
    code: r.code,
    version: r.version,
    name: r.name,
    status: 'published' as const,
    priority: r.priority
  }));

  const allocationId = createAllocation(store_id, script_id, players, suggestion, suggestion.crossGenderCount, ruleVersions);

  const topCandidates = getTopCandidates(players, characters, applicableRules, 3);

  const grayRuleVersions = ruleVersions.filter(r =>
    activeRules.find(ar => ar.id === r.id)?.status === 'gray'
  );

  res.json({
    success: true,
    data: {
      allocation_id: allocationId,
      script: { id: script.id, name: script.name, type: script.type },
      store: { id: store.id, name: store.name },
      rule_versions: ruleVersions,
      gray_rule_versions: grayRuleVersions,
      suggestion: {
        assignments: suggestion.assignments.map(a => ({
          player: a.player,
          character: {
            id: a.character.id,
            name: a.character.name,
            gender: a.character.gender,
            is_lead: a.character.is_lead === 1
          },
          score: a.score,
          reasons: a.reasons,
          is_cross_gender: a.isCrossGender
        })),
        total_score: suggestion.totalScore,
        cross_gender_count: suggestion.crossGenderCount,
        dm_tips: suggestion.dmTips,
        relationship_highlights: suggestion.relationshipHighlights,
        lead_recommendations: suggestion.leadRecommendations,
        cross_gender_candidates: suggestion.crossGenderCandidates,
        dm_communication_points: suggestion.dmCommunicationPoints,
        applied_rules: suggestion.appliedRules
      },
      player_candidates: topCandidates
    }
  });
}));

router.post('/simulate', validateBody(simulateSchema), handleAsync(async (req: Request, res: Response) => {
  const { store_id, script_id, players, compare_draft, specified_versions } = req.body;

  const store = getStoreById(store_id);
  if (!store) {
    res.status(404).json({ success: false, error: '门店不存在' });
    return;
  }

  const script = getScriptById(script_id);
  if (!script) {
    res.status(404).json({ success: false, error: '剧本不存在' });
    return;
  }

  const characters = getCharactersByScriptId(script_id);
  if (characters.length === 0) {
    res.status(400).json({ success: false, error: '该剧本暂无角色配置' });
    return;
  }

  const relationships = getRelationshipsByScriptId(script_id);

  const currentRules = filterApplicableRules(getActiveRulesForStore(store_id), script.type, store_id);

  let draftRules;
  if (compare_draft) {
    const drafts = getDraftRules();
    const latestDrafts = new Map<string, typeof drafts[0]>();
    for (const d of drafts) {
      const existing = latestDrafts.get(d.code);
      if (!existing || d.version > existing.version) {
        latestDrafts.set(d.code, d);
      }
    }
    const merged = currentRules.map(r => latestDrafts.get(r.code) || r);
    for (const d of latestDrafts.values()) {
      if (!merged.find(r => r.code === d.code)) {
        merged.push(d);
      }
    }
    draftRules = filterApplicableRules(merged, script.type, store_id);
  }

  let specifiedRules;
  if (specified_versions && specified_versions.length > 0) {
    const specified = specified_versions.map((sv: { code: string; version: number }) => getRuleByCodeAndVersion(sv.code, sv.version)).filter(Boolean) as any[];
    if (specified.length === 0) {
      res.status(400).json({ success: false, error: '未找到指定版本的规则' });
      return;
    }
    const merged = currentRules.map(r => {
      const s = specified.find(sp => sp.code === r.code);
      return s || r;
    });
    for (const s of specified) {
      if (!merged.find(r => r.code === s.code)) {
        merged.push(s);
      }
    }
    specifiedRules = filterApplicableRules(merged, script.type, store_id);
  }

  const result = simulateAllocation(players, characters, relationships, script.type, {
    currentRules,
    draftRules,
    specifiedRules
  });

  res.json({
    success: true,
    data: {
      script: { id: script.id, name: script.name, type: script.type },
      store: { id: store.id, name: store.name },
      simulation: result
    }
  });
}));

router.post('/batch-simulate', validateBody(batchSimulateSchema), handleAsync(async (req: Request, res: Response) => {
  const { baseline_store_id, compare_mode, groups, specified_versions } = req.body;

  const baselineStore = getStoreById(baseline_store_id);
  if (!baselineStore) {
    res.status(404).json({ success: false, error: '基准门店不存在' });
    return;
  }

  const result = batchSimulateAllocation({
    baselineStoreId: Number(baseline_store_id),
    compareMode: compare_mode,
    groups: groups.map((g: { group_id: string; group_name: string; store_id?: number; script_id: number; players: any[] }) => ({
      groupId: g.group_id,
      groupName: g.group_name,
      storeId: g.store_id ? Number(g.store_id) : undefined,
      scriptId: Number(g.script_id),
      players: g.players,
    })),
    specifiedRuleVersions: specified_versions,
  });

  res.json({
    success: true,
    data: result
  });
}));

router.get('/', handleAsync(async (req: Request, res: Response) => {
  const storeId = req.query.store_id ? parseInt(req.query.store_id as string) : undefined;
  const scriptId = req.query.script_id ? parseInt(req.query.script_id as string) : undefined;
  const days = req.query.days ? parseInt(req.query.days as string) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

  const filters: StatsFilters = {};
  if (storeId !== undefined && !isNaN(storeId)) filters.storeId = storeId;
  if (scriptId !== undefined && !isNaN(scriptId)) filters.scriptId = scriptId;
  if (days !== undefined && !isNaN(days)) filters.days = days;

  let allocations;
  if (filters.storeId !== undefined || filters.scriptId !== undefined || filters.days !== undefined) {
    allocations = getAllocationsByFilters(filters, limit);
  } else {
    allocations = getAllAllocations(limit);
  }

  res.json({
    success: true,
    data: allocations.map(a => ({
      id: a.id,
      store_id: a.store_id,
      script_id: a.script_id,
      cross_gender_count: a.cross_gender_count,
      cross_gender_refused: a.cross_gender_refused,
      on_site_changes: a.on_site_changes,
      status: a.status,
      started_at: a.started_at,
      created_at: a.created_at,
      rule_versions: parseRuleVersions(a)
    })),
    filters_applied: filters
  });
}));

router.get('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的分配记录ID' });
    return;
  }

  const allocation = getAllocationById(id);
  if (!allocation) {
    res.status(404).json({ success: false, error: '分配记录不存在' });
    return;
  }

  let suggestionData = null;
  let playersData = null;
  try {
    suggestionData = JSON.parse(allocation.suggestion_json);
    playersData = JSON.parse(allocation.players_json);
  } catch {
    // ignore parse errors
  }

  res.json({
    success: true,
    data: {
      id: allocation.id,
      store_id: allocation.store_id,
      script_id: allocation.script_id,
      players: playersData,
      suggestion: suggestionData,
      rule_versions: parseRuleVersions(allocation),
      cross_gender_count: allocation.cross_gender_count,
      cross_gender_refused: allocation.cross_gender_refused,
      on_site_changes: allocation.on_site_changes,
      status: allocation.status,
      started_at: allocation.started_at,
      created_at: allocation.created_at
    }
  });
}));

router.post('/:id/feedback', validateBody(feedbackSchema), handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的分配记录ID' });
    return;
  }

  const existing = getAllocationById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: '分配记录不存在' });
    return;
  }

  const { cross_gender_refused, on_site_changes, status } = req.body;
  const success = updateAllocationFeedback(id, cross_gender_refused, on_site_changes, status);

  if (!success) {
    res.status(500).json({ success: false, error: '更新失败' });
    return;
  }

  const updated = getAllocationById(id)!;
  res.json({
    success: true,
    data: {
      id: updated.id,
      cross_gender_refused: updated.cross_gender_refused,
      on_site_changes: updated.on_site_changes,
      status: updated.status
    }
  });
}));

export default router;
