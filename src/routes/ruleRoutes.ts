import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody, handleAsync } from '../middleware/validation';
import {
  getAllRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  getEnabledRules
} from '../models/ruleModel';
import { getAvailableRuleCodes } from '../rules/ruleEngine';

const router = Router();

const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional().default(50),
  enabled: z.number().int().min(0).max(1).optional().default(1),
  config: z.record(z.any()).optional().default({})
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
  config: z.record(z.any()).optional()
});

router.get('/', handleAsync(async (req: Request, res: Response) => {
  const enabledOnly = req.query.enabled === 'true';
  const rules = enabledOnly ? getEnabledRules() : getAllRules();
  res.json({
    success: true,
    data: rules.map(r => ({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      priority: r.priority,
      enabled: r.enabled === 1,
      config: JSON.parse(r.config_json || '{}'),
      created_at: r.created_at,
      updated_at: r.updated_at
    }))
  });
}));

router.get('/available-codes', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: getAvailableRuleCodes()
  });
});

router.get('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的规则ID' });
    return;
  }

  const rule = getRuleById(id);
  if (!rule) {
    res.status(404).json({ success: false, error: '规则不存在' });
    return;
  }

  res.json({
    success: true,
    data: {
      id: rule.id,
      name: rule.name,
      code: rule.code,
      description: rule.description,
      priority: rule.priority,
      enabled: rule.enabled === 1,
      config: JSON.parse(rule.config_json || '{}'),
      created_at: rule.created_at,
      updated_at: rule.updated_at
    }
  });
}));

router.post('/', validateBody(createRuleSchema), handleAsync(async (req: Request, res: Response) => {
  const { name, code, description, priority, enabled, config } = req.body;

  const availableCodes = getAvailableRuleCodes();
  if (!availableCodes.includes(code)) {
    res.status(400).json({
      success: false,
      error: `规则代码 "${code}" 不存在，可用代码: ${availableCodes.join(', ')}`
    });
    return;
  }

  try {
    const id = createRule(name, code, description || '', priority, enabled, config);
    const rule = getRuleById(id)!;
    res.status(201).json({
      success: true,
      data: {
        id: rule.id,
        name: rule.name,
        code: rule.code,
        description: rule.description,
        priority: rule.priority,
        enabled: rule.enabled === 1,
        config: JSON.parse(rule.config_json || '{}')
      }
    });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ success: false, error: '规则代码已存在' });
    } else {
      throw err;
    }
  }
}));

router.put('/:id', validateBody(updateRuleSchema), handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的规则ID' });
    return;
  }

  const existing = getRuleById(id);
  if (!existing) {
    res.status(404).json({ success: false, error: '规则不存在' });
    return;
  }

  const success = updateRule(id, req.body);
  if (!success) {
    res.status(500).json({ success: false, error: '更新失败' });
    return;
  }

  const updated = getRuleById(id)!;
  res.json({
    success: true,
    data: {
      id: updated.id,
      name: updated.name,
      code: updated.code,
      description: updated.description,
      priority: updated.priority,
      enabled: updated.enabled === 1,
      config: JSON.parse(updated.config_json || '{}')
    }
  });
}));

router.delete('/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的规则ID' });
    return;
  }

  const success = deleteRule(id);
  if (!success) {
    res.status(404).json({ success: false, error: '规则不存在' });
    return;
  }

  res.json({ success: true, message: '规则已删除' });
}));

export default router;
