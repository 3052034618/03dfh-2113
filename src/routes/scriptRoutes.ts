import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody, handleAsync } from '../middleware/validation';
import {
  getAllScripts,
  getScriptById,
  createScript,
  updateScript,
  deleteScript,
  getCharactersByScriptId,
  getRelationshipsByScriptId,
  createCharacter,
  createRelationship
} from '../models/scriptModel';

const router = Router();

const createScriptSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().min(1).max(50),
  difficulty: z.enum(['easy', 'medium', 'hard', 'extreme']).optional().default('medium'),
  duration_minutes: z.number().int().positive().optional().default(240),
  description: z.string().max(1000).optional()
});

const updateScriptSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.string().min(1).max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'extreme']).optional(),
  duration_minutes: z.number().int().positive().optional(),
  description: z.string().max(1000).optional()
});

const createCharacterSchema = z.object({
  name: z.string().min(1).max(50),
  gender: z.enum(['male', 'female', 'other']),
  age: z.number().int().positive().optional(),
  is_lead: z.number().int().min(0).max(1).optional().default(0),
  courage_required: z.number().int().min(1).max(5).optional().default(3),
  reasoning_required: z.number().int().min(1).max(5).optional().default(3),
  emotional_depth: z.number().int().min(1).max(5).optional().default(3),
  description: z.string().max(500).optional()
});

const createRelationshipSchema = z.object({
  character_a_id: z.number().int().positive(),
  character_b_id: z.number().int().positive(),
  relationship_type: z.string().min(1).max(50),
  importance: z.number().int().min(1).max(5).optional().default(3)
});

router.get('/', handleAsync(async (req: Request, res: Response) => {
  const scripts = getAllScripts();
  res.json({ success: true, data: scripts });
}));

router.get('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const script = getScriptById(id);
  if (!script) {
    res.status(404).json({ success: false, error: '剧本不存在' });
    return;
  }

  const characters = getCharactersByScriptId(id);
  const relationships = getRelationshipsByScriptId(id);

  res.json({
    success: true,
    data: {
      ...script,
      characters,
      relationships
    }
  });
}));

router.post('/', validateBody(createScriptSchema), handleAsync(async (req: Request, res: Response) => {
  const { name, type, difficulty, duration_minutes, description } = req.body;
  const id = createScript(name, type, difficulty, duration_minutes, description);
  const script = getScriptById(id)!;
  res.status(201).json({ success: true, data: script });
}));

router.put('/:id', validateBody(updateScriptSchema), handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const existing = getScriptById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: '剧本不存在' });
    return;
  }

  const name = req.body.name ?? existing.name;
  const type = req.body.type ?? existing.type;
  const difficulty = req.body.difficulty ?? existing.difficulty;
  const durationMinutes = req.body.duration_minutes ?? existing.duration_minutes;
  const description = req.body.description ?? existing.description;

  const success = updateScript(id, name, type, difficulty, durationMinutes, description);
  if (!success) {
    res.status(500).json({ success: false, error: '更新失败' });
    return;
  }

  const updated = getScriptById(id)!;
  res.json({ success: true, data: updated });
}));

router.delete('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const success = deleteScript(id);
  if (!success) {
    res.status(404).json({ success: false, error: '剧本不存在' });
    return;
  }

  res.json({ success: true, message: '剧本已删除' });
}));

router.get('/:id/characters', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const characters = getCharactersByScriptId(id);
  res.json({ success: true, data: characters });
}));

router.post('/:id/characters', validateBody(createCharacterSchema), handleAsync(async (req: Request, res: Response) => {
  const scriptId = parseInt(req.params.id);
  if (isNaN(scriptId)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const script = getScriptById(scriptId);
  if (!script) {
    res.status(404).json({ success: false, error: '剧本不存在' });
    return;
  }

  const { name, gender, age, is_lead, courage_required, reasoning_required, emotional_depth, description } = req.body;
  const charId = createCharacter(scriptId, name, gender, {
    age,
    is_lead,
    courage_required,
    reasoning_required,
    emotional_depth,
    description
  });

  const characters = getCharactersByScriptId(scriptId);
  const newChar = characters.find(c => c.id === charId)!;
  res.status(201).json({ success: true, data: newChar });
}));

router.get('/:id/relationships', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const relationships = getRelationshipsByScriptId(id);
  res.json({ success: true, data: relationships });
}));

router.post('/:id/relationships', validateBody(createRelationshipSchema), handleAsync(async (req: Request, res: Response) => {
  const scriptId = parseInt(req.params.id);
  if (isNaN(scriptId)) {
    res.status(400).json({ success: false, error: '无效的剧本ID' });
    return;
  }

  const { character_a_id, character_b_id, relationship_type, importance } = req.body;
  const relId = createRelationship(scriptId, character_a_id, character_b_id, relationship_type, importance);

  res.status(201).json({
    success: true,
    data: {
      id: relId,
      script_id: scriptId,
      character_a_id,
      character_b_id,
      relationship_type,
      importance
    }
  });
}));

export default router;
