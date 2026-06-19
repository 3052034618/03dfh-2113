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
  parseGrayStoreIds,
  getAuditLogs,
  getReleasePlans,
  getReleasePlanById,
  getReleasePlansByCode,
  createReleasePlan,
  submitReleasePlan,
  approveReleasePlan,
  rejectReleasePlan,
  scheduleReleasePlan,
  pauseReleasePlan,
  resumeReleasePlan,
  cancelReleasePlan,
  executeReleasePlan
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

function getOperator(req: Request): string {
  return (req.header('X-Operator-Name') as string) || (req.body as any)?.operator || 'admin';
}

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

router.get('/audit-logs', handleAsync(async (req: Request, res: Response) => {
  const ruleCode = req.query.rule_code as string | undefined;
  const action = req.query.action as any;
  const operator = req.query.operator as string | undefined;
  const limitParam = req.query.limit as string | undefined;
  const limit = limitParam ? parseInt(limitParam) : 50;

  const logs = getAuditLogs({ ruleCode, action, operator, limit });
  res.json({ success: true, data: logs });
}));

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

router.get('/:code/audit-logs', handleAsync(async (req: Request, res: Response) => {
  const code = req.params.code;
  const logs = getAuditLogs({ ruleCode: code, limit: 50 });
  res.json({ success: true, data: logs });
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
    const operator = getOperator(req);
    const id = createRule(name, code, description || '', priority, enabled, config, scope, status, undefined, undefined, operator);
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
    const operator = getOperator(req);
    const newId = createNewVersion(code, {
      name, description, priority, config, scope
    }, status, operator);
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
  const operator = getOperator(req);
  const success = publishVersion(id, grayStoreIds.length > 0 ? { grayStoreIds } : undefined, operator);
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

  const operator = getOperator(req);
  try {
    const newId = rollbackToVersion(code, version, operator);
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

  const operator = getOperator(req);
  const success = updateRule(id, req.body, operator);
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

router.get('/release-plans', handleAsync(async (req: Request, res: Response) => {
  const ruleCode = req.query.rule_code as string | undefined;
  const status = req.query.status as string | undefined;
  const limitParam = req.query.limit as string | undefined;
  const limit = limitParam ? parseInt(limitParam) : undefined;

  const plans = getReleasePlans({ ruleCode, status: status as any, limit });
  res.json({ success: true, data: plans });
}));

router.get('/release-plans/:id', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  res.json({ success: true, data: plan });
}));

router.get('/:code/release-plans', handleAsync(async (req: Request, res: Response) => {
  const code = req.params.code;
  const plans = getReleasePlansByCode(code);
  res.json({ success: true, data: plans });
}));

router.post('/release-plans', handleAsync(async (req: Request, res: Response) => {
  const { rule_id, release_type, gray_store_ids, scheduled_at } = req.body;

  if (!rule_id || !release_type) {
    res.status(400).json({ success: false, error: 'rule_id 和 release_type 必填' });
    return;
  }

  const ruleId = Number(rule_id);
  const releaseType = release_type as 'full' | 'gray';
  const grayStoreIds = gray_store_ids as number[] | undefined;
  const scheduledAt = scheduled_at as string | undefined;

  try {
    const operator = getOperator(req);
    const planId = createReleasePlan(ruleId, { releaseType, grayStoreIds, scheduledAt }, operator);
    res.status(201).json({ success: true, data: { id: planId } });
  } catch (err: any) {
    if (err.message?.includes('not found')) {
      res.status(404).json({ success: false, error: err.message });
    } else {
      res.status(400).json({ success: false, error: err.message });
    }
  }
}));

router.post('/release-plans/:id/submit', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const operator = getOperator(req);
    submitReleasePlan(id, operator);
    res.json({ success: true, message: '已提交审核' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/approve', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const { review_comment } = req.body;
    const operator = getOperator(req);
    approveReleasePlan(id, operator, review_comment);
    res.json({ success: true, message: '审批通过' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/reject', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const { review_comment } = req.body;
    const operator = getOperator(req);
    rejectReleasePlan(id, operator, review_comment);
    res.json({ success: true, message: '已拒绝' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/schedule', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  const { scheduled_at } = req.body;
  if (!scheduled_at) {
    res.status(400).json({ success: false, error: 'scheduled_at 必填' });
    return;
  }

  try {
    const operator = getOperator(req);
    scheduleReleasePlan(id, scheduled_at, operator);
    res.json({ success: true, message: '已设置定时发布' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/pause', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const operator = getOperator(req);
    pauseReleasePlan(id, operator);
    res.json({ success: true, message: '已暂停' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/resume', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const operator = getOperator(req);
    resumeReleasePlan(id, operator);
    res.json({ success: true, message: '已恢复定时发布' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/cancel', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const { cancel_reason } = req.body;
    const operator = getOperator(req);
    cancelReleasePlan(id, operator, cancel_reason);
    res.json({ success: true, message: '已取消' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

router.post('/release-plans/:id/execute', handleAsync(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ success: false, error: '无效的发布计划ID' });
    return;
  }

  const plan = getReleasePlanById(id);
  if (!plan) {
    res.status(404).json({ success: false, error: '发布计划不存在' });
    return;
  }

  try {
    const operator = getOperator(req);
    executeReleasePlan(id, operator);
    res.json({ success: true, message: '发布成功' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
}));

export default router;
