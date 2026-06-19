import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody, handleAsync } from '../middleware/validation';
import { generateAllocationSuggestion, getTopCandidates } from '../services/allocationService';
import { getEnabledRules } from '../models/ruleModel';
import { getScriptById, getCharactersByScriptId, getRelationshipsByScriptId } from '../models/scriptModel';
import { getStoreById } from '../models/storeModel';
import { filterApplicableRules } from '../rules/ruleEngine';
import {
  createAllocation,
  getAllocationById,
  getAllocationsByStoreId,
  updateAllocationFeedback,
  getAllAllocations
} from '../models/allocationModel';

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
  const allRules = getEnabledRules();
  const applicableRules = filterApplicableRules(allRules, script.type, store_id);

  const suggestion = generateAllocationSuggestion(players, characters, applicableRules, relationships, script.type);

  const allocationId = createAllocation(store_id, script_id, players, suggestion, suggestion.crossGenderCount);

  const topCandidates = getTopCandidates(players, characters, applicableRules, 3);

  res.json({
    success: true,
    data: {
      allocation_id: allocationId,
      script: { id: script.id, name: script.name, type: script.type },
      store: { id: store.id, name: store.name },
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

router.get('/', handleAsync(async (req: Request, res: Response) => {
  const storeId = req.query.store_id ? parseInt(req.query.store_id as string) : null;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

  let allocations;
  if (storeId) {
    if (isNaN(storeId)) {
      res.status(400).json({ success: false, error: '无效的门店ID' });
      return;
    }
    allocations = getAllocationsByStoreId(storeId, limit);
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
      created_at: a.created_at
    }))
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
