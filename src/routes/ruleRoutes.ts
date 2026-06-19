import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody, handleAsync } from '../middleware/validation';
import {
  getAllRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  getEnabledRules,
  getVersionsByCode,
  getRuleByCodeAndVersion,
  createNewVersion,
  publishVersion,
  rollbackToVersion,
  getActiveRulesForStore,
  parseGrayStoreIds
} from '../models/ruleModel';
import { getAvailableRuleCodes, getDefaultApplicableTypes } from '../rules/ruleEngine';
import { parseRuleScope } from '../models/ruleModel';

const router = Router();

const scopeSchema = z.object({
  scriptTypes: z.array(z.string()).optional().default([]),
  storeIds: z.array(z.number()).optional().default([]),
  allStores: z.boolean().optional().default(true)
});

const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional().default(50),
  enabled: z.number().int().min(0).max(1).optional().default(1),
  config: z.record(z.any()).optional().default({}),
  scope: scopeSchema.optional().default({ scriptTypes: [], storeIds: [], allStores: true }),
  status: z.enum(['draft', 'published', 'gray', 'archived']).optional().default('published')
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
  config: z.record(z.any()).optional(),
  scope: scopeSchema.optional(),
  status: z.enum(['draft', 'published', 'gray', 'archived']).optional(),
  grayStoreIds: z.array(z.number()).optional()
});

const createVersionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  config: z.record(z.any()).optional(),
  scope: scopeSchema.optional(),
  status: z.enum(['draft', 'published', 'gray']).optional().default('draft')
});

const publishSchema = z.object({
  grayStoreIds: z.array(z.number()).optional().default([])
});

function formatRuleResponse(rule: any) {
  const scope = parseRuleScope(rule);
  const defaultTypes = getDefaultApplicableTypes(rule.code);
  const grayStoreIds = parseGrayStoreIds(rule);
  return {
    id: rule.id,
    name: rule.name,
    code: rule.code,
    version: rule.version,
    status: rule.status,
    parent_version_id: rule.parent_version_id,
    description: rule.description,
    priority: rule.priority,
    enabled: rule.enabled === 1,
    config: JSON.parse(rule.config_json || '{}'),
    scope: {
      scriptTypes: scope.scriptTypes.length > 0 ? scope.scriptTypes : defaultTypes,
      storeIds: scope.storeIds,
      allStores: scope.allStores
    },
    gray_store_ids: grayStoreIds,
    created_at: rule.created_at,
    updated_at: rule.updated_at
  };
}

router.get('/', handleAsync(async (req: Request, res: Response) => {
  const enabledOnly = req.query.enabled === 'true';
  const includeArchived = req.query.include_archived === 'true';
  const rules = enabledOnly ? getEnabledRules() : getAllRules(includeArchived);
  res.json({
    success: true,
    data: rules.map(formatRuleResponse)
  });
}));

router.get('/available-codes', (req: Request, res: Response) => {
  const codes = getAvailableRuleCodes();
  res.json({
    success: true,
    data: codes.map(code => ({
      code,
      defaultApplicableTypes: getDefaultApplicableTypes(code)
    }))
  });
});

router.get('/versions/:code', handleAsync(async (req: Request, res: Response) => {
  const code = req.params.code;
  const versions = getVersionsByCode(code);
  res.json({
    success: true,
    data: versions.map(formatRuleResponse)
  });
}));

router.get('/active-for-store/:storeId', handleAsync(async (req: Request, res: Response) => {
  const storeId = parseInt(req.params.storeId);
  if (isNaN(storeId)) {
    res.status(400).json({ success: false, error: '无效的门店ID' });
    return;
  }

  const rules = getActiveRulesForStore(storeId);
  res.json({
    success: true,
    data: {
      store_id: storeId,
      rules: rules.map(formatRuleResponse),
      gray_rules: rules.filter(r => r.status === 'gray').map(r => ({
        code: r.code,
        version: r.version,
        name: r.name
      }))
    }
  });
}));

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

  res.json({ success: true, data: formatRuleResponse(rule) });
}));

router.post('/', validateBody(createRuleSchema), handleAsync(async (req: Request, res: Response) => {
  const { name, code, description, priority, enabled, config, scope, status } = req.body;

  const availableCodes = getAvailableRuleCodes();
  if (!availableCodes.includes(code)) {
    res.status(400).json({
      success: false,
      error: `规则代码 "${code}" 不存在，可用代码: ${availableCodes.join(', ')}`
    });
    return;
  }

  try {
    const id = createRule(name, code, description || '', priority, enabled, config, scope, status);
    const rule = getRuleById(id)!;
    res.status(201).json({ success: true, data: formatRuleResponse(rule) });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      res.status(409).json({ success: false, error: '规则代码已存在' });
    } else {
      throw err;
    }
  }
}));

router.post('/:code/versions', validateBody(createVersionSchema), handleAsync(async (req: Request, res: Response) => {
  const code = req.params.code;
  const { name, description, priority, config, scope, status } = req.body;

  try {
    const newId = createNewVersion(code, {
      name, description, priority, config, scope
    }, status);
    const rule = getRuleById(newId)!;
    res.status(201).json({ success: true, data: formatRuleResponse(rule) });
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      res.status(404).json({ success: false, error: err.message });
    } else {
      throw err;
    }
  }
}));

router.post('/:id/publish', validateBody(publishSchema), handleAsync(async (req: Request, res: Response) => {
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

  const { grayStoreIds } = req.body;
  const success = publishVersion(id, grayStoreIds.length > 0 ? { grayStoreIds } : undefined);
  if (!success) {
    res.status(500).json({ success: false, error: '发布失败' });
    return;
  }

  const updated = getRuleById(id)!;
  res.json({
    success: true,
    message: grayStoreIds.length > 0 ? `已灰度发布到 ${grayStoreIds.length} 家门店` : '已全量发布',
    data: formatRuleResponse(updated)
  });
}));

router.post('/:code/rollback/:version', handleAsync(async (req: Request, res: Response) => {
  const code = req.params.code;
  const version = parseInt(req.params.version);
  if (isNaN(version)) {
    res.status(400).json({ success: false, error: '无效的版本号' });
    return;
  }

  try {
    const newId = rollbackToVersion(code, version);
    const rule = getRuleById(newId)!;
    res.json({
      success: true,
      message: `已回滚到 v${version}，新版本号 v${rule.version}`,
      data: formatRuleResponse(rule)
    });
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      res.status(404).json({ success: false, error: err.message });
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

  if (existing.status === 'published' && req.body.status === undefined) {
    res.status(400).json({
      success: false,
      error: '已发布的规则无法直接修改，请创建新版本后发布'
    });
    return;
  }

  const success = updateRule(id, req.body);
  if (!success) {
    res.status(500).json({ success: false, error: '更新失败' });
    return;
  }

  const updated = getRuleById(id)!;
  res.json({ success: true, data: formatRuleResponse(updated) });
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
