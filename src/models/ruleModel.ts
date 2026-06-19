import { getOne, getAll, runQuery } from '../db/database';
import { Rule, RuleConfig, RuleScope, RuleStatus, RuleAuditLog, RuleAuditAction, ReleasePlan, ReleasePlanStatus, ReleaseType } from '../types';

export function getRuleById(id: number): Rule | undefined {
  return getOne<Rule>('SELECT * FROM rules WHERE id = ?', [id]);
}

export function getRuleByCode(code: string): Rule | undefined {
  return getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published' ORDER BY version DESC LIMIT 1",
    [code]
  );
}

export function getRuleByCodeAndVersion(code: string, version: number): Rule | undefined {
  return getOne<Rule>('SELECT * FROM rules WHERE code = ? AND version = ?', [code, version]);
}

export function getLatestVersion(code: string): number {
  const row = getOne<{ max_version: number }>(
    'SELECT COALESCE(MAX(version), 0) as max_version FROM rules WHERE code = ?',
    [code]
  );
  return row?.max_version || 0;
}

export function getAllRules(includeArchived: boolean = false): Rule[] {
  const statusFilter = includeArchived ? '' : "AND status != 'archived'";
  return getAll<Rule>(
    `SELECT * FROM rules WHERE 1=1 ${statusFilter} ORDER BY code, version DESC`,
    []
  );
}

export function getVersionsByCode(code: string): Rule[] {
  return getAll<Rule>(
    'SELECT * FROM rules WHERE code = ? ORDER BY version DESC',
    [code]
  );
}

export function getEnabledRules(): Rule[] {
  return getAll<Rule>(
    `SELECT * FROM rules 
     WHERE enabled = 1 
     AND status IN ('published', 'gray')
     ORDER BY priority DESC, id`,
    []
  );
}

export function getActiveRulesForStore(storeId: number): Rule[] {
  const rules = getEnabledRules();
  const publishedRules = new Map<string, Rule>();
  const grayRules = new Map<string, Rule>();

  for (const rule of rules) {
    if (rule.status === 'published') {
      publishedRules.set(rule.code, rule);
    } else if (rule.status === 'gray') {
      const grayStoreIds = parseGrayStoreIds(rule);
      if (grayStoreIds.includes(storeId)) {
        grayRules.set(rule.code, rule);
      }
    }
  }

  const result: Rule[] = [];
  for (const code of publishedRules.keys()) {
    result.push(grayRules.get(code) || publishedRules.get(code)!);
  }

  result.sort((a, b) => b.priority - a.priority);
  return result;
}

export function getDraftRules(): Rule[] {
  return getAll<Rule>(
    "SELECT * FROM rules WHERE status = 'draft' ORDER BY code, version DESC",
    []
  );
}

export function getPublishedRules(): Rule[] {
  return getAll<Rule>(
    "SELECT * FROM rules WHERE status = 'published' ORDER BY priority DESC, id",
    []
  );
}

function createAuditLog(
  ruleCode: string,
  action: RuleAuditAction,
  operator: string = 'system',
  options: {
    ruleId?: number;
    ruleVersion?: number;
    oldStatus?: RuleStatus;
    newStatus?: RuleStatus;
    affectedStoreIds?: number[];
    detail?: Record<string, any>;
  } = {}
): void {
  const detail = JSON.stringify(options.detail || {});
  const affectedStoreIdsJson = JSON.stringify(options.affectedStoreIds || []);
  runQuery(`
    INSERT INTO rule_audit_logs (rule_code, rule_id, rule_version, action, operator, old_status, new_status, affected_store_ids_json, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    ruleCode,
    options.ruleId ?? null,
    options.ruleVersion ?? null,
    action,
    operator,
    options.oldStatus ?? null,
    options.newStatus ?? null,
    affectedStoreIdsJson,
    detail
  ]);
}

export function getAuditLogs(options?: {
  ruleCode?: string;
  action?: RuleAuditAction;
  operator?: string;
  limit?: number;
}): RuleAuditLog[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.ruleCode) {
    conditions.push('rule_code = ?');
    params.push(options.ruleCode);
  }
  if (options?.action) {
    conditions.push('action = ?');
    params.push(options.action);
  }
  if (options?.operator) {
    conditions.push('operator = ?');
    params.push(options.operator);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : '';

  const rawRows = getAll<any>(`
    SELECT * FROM rule_audit_logs
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    ${limitClause}
  `, params);

  return rawRows.map(row => ({
    id: row.id,
    ruleCode: row.rule_code,
    ruleId: row.rule_id ?? undefined,
    ruleVersion: row.rule_version ?? undefined,
    action: row.action,
    operator: row.operator,
    oldStatus: row.old_status ?? undefined,
    newStatus: row.new_status ?? undefined,
    affectedStoreIds: (() => {
      try { return JSON.parse(row.affected_store_ids_json || '[]'); }
      catch { return []; }
    })(),
    detail: (() => {
      try { return JSON.parse(row.detail_json || '{}'); }
      catch { return {}; }
    })(),
    createdAt: row.created_at
  }));
}

export function getAffectedStoresForRule(ruleCode: string, status: RuleStatus = 'gray'): number[] {
  const rows = getAll<{ gray_store_ids_json: string }>(
    "SELECT gray_store_ids_json FROM rules WHERE code = ? AND status = ?",
    [ruleCode, status]
  );
  const stores = new Set<number>();
  for (const r of rows) {
    try {
      const ids = JSON.parse(r.gray_store_ids_json || '[]');
      for (const id of ids) stores.add(id);
    } catch { /* ignore */ }
  }
  return Array.from(stores);
}

export function createRule(
  name: string,
  code: string,
  description: string,
  priority: number = 50,
  enabled: number = 1,
  config: RuleConfig = {},
  scope: RuleScope = { scriptTypes: [], storeIds: [], allStores: true },
  status: RuleStatus = 'published',
  version?: number,
  parentVersionId?: number,
  operator: string = 'system'
): number {
  const nextVersion = version ?? getLatestVersion(code) + 1;
  const result = runQuery(`
    INSERT INTO rules (name, code, version, status, parent_version_id, description, priority, enabled, config_json, scope_json, gray_store_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
  `, [
    name, code, nextVersion, status, parentVersionId ?? null, description, priority, enabled,
    JSON.stringify(config), JSON.stringify(scope)
  ]);

  createAuditLog(code, 'create_version', operator, {
    ruleId: result.lastInsertRowid,
    ruleVersion: nextVersion,
    oldStatus: undefined,
    newStatus: status,
    affectedStoreIds: [],
    detail: { name, description, priority, parentVersionId: parentVersionId ?? null }
  });

  return result.lastInsertRowid;
}

export function createNewVersion(
  code: string,
  updates: {
    name?: string;
    description?: string;
    priority?: number;
    config?: RuleConfig;
    scope?: RuleScope;
  },
  status: RuleStatus = 'draft',
  operator: string = 'system'
): number {
  const latestPublished = getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published' ORDER BY version DESC LIMIT 1",
    [code]
  );

  const baseRule = latestPublished || getOne<Rule>(
    'SELECT * FROM rules WHERE code = ? ORDER BY version DESC LIMIT 1',
    [code]
  );

  if (!baseRule) {
    throw new Error(`Rule code ${code} not found`);
  }

  const newVersion = getLatestVersion(code) + 1;
  const name = updates.name ?? baseRule.name;
  const description = updates.description ?? baseRule.description ?? '';
  const priority = updates.priority ?? baseRule.priority;
  const config = updates.config ?? parseRuleConfig(baseRule);
  const scope = updates.scope ?? parseRuleScope(baseRule);

  const newId = createRule(
    name, code, description, priority, baseRule.enabled, config, scope, status, newVersion, baseRule.id, operator
  );

  return newId;
}

export function updateRule(
  id: number,
  options: {
    name?: string;
    description?: string;
    priority?: number;
    enabled?: number;
    config?: RuleConfig;
    scope?: RuleScope;
    status?: RuleStatus;
    grayStoreIds?: number[];
  },
  operator: string = 'system'
): boolean {
  const current = getRuleById(id);
  if (!current) return false;

  const name = options.name ?? current.name;
  const description = options.description ?? current.description;
  const priority = options.priority ?? current.priority;
  const enabled = options.enabled ?? current.enabled;
  const config = options.config ? JSON.stringify(options.config) : current.config_json;
  const scope = options.scope ? JSON.stringify(options.scope) : current.scope_json;
  const newStatus = options.status ?? current.status;
  const grayStoreIds = options.grayStoreIds ? JSON.stringify(options.grayStoreIds) : current.gray_store_ids_json;

  const statusChanged = newStatus !== current.status;

  const result = runQuery(`
    UPDATE rules SET name = ?, description = ?, priority = ?, enabled = ?, 
           config_json = ?, scope_json = ?, status = ?, gray_store_ids_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name, description, priority, enabled, config, scope, newStatus, grayStoreIds, id]);

  if (result.changes > 0) {
    const affectedStoreIds = options.grayStoreIds && statusChanged
      ? options.grayStoreIds
      : (newStatus === 'gray' ? parseGrayStoreIds({ ...current, gray_store_ids_json: grayStoreIds } as Rule) : []);

    createAuditLog(current.code, 'update', operator, {
      ruleId: id,
      ruleVersion: current.version,
      oldStatus: current.status,
      newStatus: newStatus,
      affectedStoreIds,
      detail: {
        fieldsChanged: {
          name: options.name !== undefined,
          description: options.description !== undefined,
          priority: options.priority !== undefined,
          enabled: options.enabled !== undefined,
          config: options.config !== undefined,
          scope: options.scope !== undefined,
          status: statusChanged,
          grayStoreIds: options.grayStoreIds !== undefined
        }
      }
    });
  }

  return result.changes > 0;
}

export function publishVersion(
  id: number,
  options?: {
    grayStoreIds?: number[];
  },
  operator: string = 'system'
): boolean {
  const current = getRuleById(id);
  if (!current) return false;

  if (current.status === 'published') {
    const existingPublished = getOne<Rule>(
      "SELECT * FROM rules WHERE code = ? AND status = 'published' AND id != ?",
      [current.code, current.id]
    );
    if (existingPublished) {
      updateRule(existingPublished.id, { status: 'archived' }, operator);
    }
    return true;
  }

  const isGray = options?.grayStoreIds && options.grayStoreIds.length > 0;
  const action: RuleAuditAction = isGray ? 'publish_gray' : 'publish_full';

  if (isGray) {
    const updateOk = updateRule(id, { status: 'gray', grayStoreIds: options!.grayStoreIds }, operator);
    if (updateOk) {
      const rule = getRuleById(id)!;
      const allGray = getAll<Rule>(
        "SELECT * FROM rules WHERE code = ? AND status = 'gray' AND id != ?",
        [current.code, id]
      );
      for (const g of allGray) {
        updateRule(g.id, { status: 'archived' }, operator);
      }
      return true;
    }
    return false;
  }

  const existingPublished = getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published' AND id != ?",
    [current.code, current.id]
  );
  if (existingPublished) {
    updateRule(existingPublished.id, { status: 'archived' }, operator);
  }

  const allGraySameCode = getAll<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'gray'",
    [current.code]
  );
  for (const g of allGraySameCode) {
    updateRule(g.id, { status: 'archived' }, operator);
  }

  const ok = updateRule(id, { status: 'published', grayStoreIds: [] }, operator);
  return ok;
}

export function rollbackToVersion(
  code: string,
  version: number,
  operator: string = 'system'
): number {
  const targetRule = getRuleByCodeAndVersion(code, version);
  if (!targetRule) {
    throw new Error(`Rule ${code} v${version} not found`);
  }

  const currentPublished = getOne<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'published'",
    [code]
  );

  const currentGrayRules = getAll<Rule>(
    "SELECT * FROM rules WHERE code = ? AND status = 'gray'",
    [code]
  );

  const newVersion = getLatestVersion(code) + 1;
  const newId = createRule(
    targetRule.name, code, targetRule.description ?? '', targetRule.priority, targetRule.enabled,
    parseRuleConfig(targetRule), parseRuleScope(targetRule), 'published', newVersion, targetRule.id, operator
  );

  if (currentPublished) {
    updateRule(currentPublished.id, { status: 'archived' }, operator);
  }

  for (const g of currentGrayRules) {
    updateRule(g.id, { status: 'archived' }, operator);
  }

  createAuditLog(code, 'rollback', operator, {
    ruleId: newId,
    ruleVersion: newVersion,
    oldStatus: currentPublished?.status,
    newStatus: 'published',
    affectedStoreIds: getAffectedStoresForRule(code, 'gray'),
    detail: {
      targetVersion: version,
      targetVersionId: targetRule.id,
      archivedPublishedId: currentPublished?.id ?? null,
      archivedGrayCount: currentGrayRules.length
    }
  });

  return newId;
}

export function deleteRule(id: number): boolean {
  const rule = getRuleById(id);
  if (rule) {
    createAuditLog(rule.code, 'archive', 'system', {
      ruleId: id,
      ruleVersion: rule.version,
      oldStatus: rule.status,
      newStatus: 'archived',
      affectedStoreIds: [],
      detail: { action: 'delete' }
    });
  }
  const result = runQuery('DELETE FROM rules WHERE id = ?', [id]);
  return result.changes > 0;
}

export function parseRuleConfig(rule: Rule): RuleConfig {
  try {
    return JSON.parse(rule.config_json);
  } catch {
    return {};
  }
}

export function parseRuleScope(rule: Rule): RuleScope {
  try {
    const parsed = JSON.parse(rule.scope_json || '{}');
    return {
      scriptTypes: parsed.scriptTypes || [],
      storeIds: parsed.storeIds || [],
      allStores: parsed.allStores !== undefined ? parsed.allStores : true
    };
  } catch {
    return { scriptTypes: [], storeIds: [], allStores: true };
  }
}

export function parseGrayStoreIds(rule: Rule): number[] {
  try {
    const parsed = JSON.parse(rule.gray_store_ids_json || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseReleasePlan(row: any): ReleasePlan {
  return {
    id: row.id,
    ruleCode: row.rule_code,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    status: row.status as ReleasePlanStatus,
    releaseType: row.release_type as ReleaseType,
    grayStoreIds: (() => {
      try { return JSON.parse(row.gray_store_ids_json || '[]'); }
      catch { return []; }
    })(),
    scheduledAt: row.scheduled_at ?? undefined,
    submittedBy: row.submitted_by ?? undefined,
    submittedAt: row.submitted_at ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    publishedBy: row.published_by ?? undefined,
    publishedAt: row.published_at ?? undefined,
    cancelledBy: row.cancelled_by ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    pausedBy: row.paused_by ?? undefined,
    pausedAt: row.paused_at ?? undefined,
    reviewComment: row.review_comment ?? undefined,
    cancelReason: row.cancel_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getReleasePlanById(id: number): ReleasePlan | undefined {
  const row = getOne<any>('SELECT * FROM rule_release_plans WHERE id = ?', [id]);
  return row ? parseReleasePlan(row) : undefined;
}

export function getReleasePlans(options?: {
  ruleCode?: string;
  status?: ReleasePlanStatus;
  limit?: number;
}): ReleasePlan[] {
  const conditions: string[] = [];
  const params: any[] = [];
  if (options?.ruleCode) {
    conditions.push('rule_code = ?');
    params.push(options.ruleCode);
  }
  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ? `LIMIT ${options.limit}` : '';
  const rows = getAll<any>(`
    SELECT * FROM rule_release_plans
    ${where}
    ORDER BY id DESC
    ${limit}
  `, params);
  return rows.map(parseReleasePlan);
}

export function getReleasePlansByCode(code: string): ReleasePlan[] {
  return getReleasePlans({ ruleCode: code });
}

export function createReleasePlan(
  ruleId: number,
  options: {
    releaseType: ReleaseType;
    grayStoreIds?: number[];
    scheduledAt?: string;
  },
  operator: string = 'admin'
): number {
  const rule = getRuleById(ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  if (rule.status === 'published') throw new Error('已发布版本不能再创建发布计划');

  const grayStoreIds = options.grayStoreIds ?? [];
  const status: ReleasePlanStatus = options.scheduledAt ? 'scheduled' : 'draft';

  const result = runQuery(`
    INSERT INTO rule_release_plans (rule_code, rule_id, rule_version, status, release_type, gray_store_ids_json, scheduled_at, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    rule.code, ruleId, rule.version, status, options.releaseType,
    JSON.stringify(grayStoreIds),
    options.scheduledAt ?? null,
    status !== 'draft' ? operator : null,
    status !== 'draft' ? new Date().toISOString() : null,
  ]);

  const planId = result.lastInsertRowid;

  if (status === 'scheduled') {
    createAuditLog(rule.code, 'schedule_release', operator, {
      ruleId,
      ruleVersion: rule.version,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: options.releaseType === 'gray' ? grayStoreIds : [],
      detail: { planId, releaseType: options.releaseType, scheduledAt: options.scheduledAt }
    });
  }

  return planId;
}

export function submitReleasePlan(planId: number, operator: string = 'admin'): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (plan.status !== 'draft') throw new Error('只有草稿状态可以提交审核');

  const result = runQuery(`
    UPDATE rule_release_plans SET status = 'submitted', submitted_by = ?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [operator, planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'submit_review', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: plan.releaseType === 'gray' ? plan.grayStoreIds : [],
      detail: { planId, releaseType: plan.releaseType }
    });
  }
  return result.changes > 0;
}

export function approveReleasePlan(planId: number, operator: string = 'admin', reviewComment?: string): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (plan.status !== 'submitted') throw new Error('只有待审核状态可以审批');

  const newStatus: ReleasePlanStatus = plan.scheduledAt ? 'scheduled' : 'approved';

  const result = runQuery(`
    UPDATE rule_release_plans SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, review_comment = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [newStatus, operator, reviewComment ?? null, planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'approve_release', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: plan.releaseType === 'gray' ? plan.grayStoreIds : [],
      detail: { planId, releaseType: plan.releaseType, reviewComment, scheduledAt: plan.scheduledAt }
    });
  }
  return result.changes > 0;
}

export function rejectReleasePlan(planId: number, operator: string = 'admin', reviewComment?: string): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (plan.status !== 'submitted') throw new Error('只有待审核状态可以拒绝');

  const result = runQuery(`
    UPDATE rule_release_plans SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP, review_comment = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [operator, reviewComment ?? null, planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'reject_release', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: [],
      detail: { planId, releaseType: plan.releaseType, reviewComment }
    });
  }
  return result.changes > 0;
}

export function scheduleReleasePlan(planId: number, scheduledAt: string, operator: string = 'admin'): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (!['draft', 'approved', 'paused'].includes(plan.status)) {
    throw new Error('草稿/已审批/暂停状态才能设置定时发布');
  }

  const result = runQuery(`
    UPDATE rule_release_plans SET status = 'scheduled', scheduled_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [scheduledAt, planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'schedule_release', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: plan.releaseType === 'gray' ? plan.grayStoreIds : [],
      detail: { planId, scheduledAt }
    });
  }
  return result.changes > 0;
}

export function pauseReleasePlan(planId: number, operator: string = 'admin'): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (plan.status !== 'scheduled') throw new Error('只有定时发布中才能暂停');

  const result = runQuery(`
    UPDATE rule_release_plans SET status = 'paused', paused_by = ?, paused_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [operator, planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'pause_release', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: plan.releaseType === 'gray' ? plan.grayStoreIds : [],
      detail: { planId }
    });
  }
  return result.changes > 0;
}

export function resumeReleasePlan(planId: number, operator: string = 'admin'): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (plan.status !== 'paused') throw new Error('只有暂停状态才能恢复');

  const result = runQuery(`
    UPDATE rule_release_plans SET status = 'scheduled', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'resume_release', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: plan.releaseType === 'gray' ? plan.grayStoreIds : [],
      detail: { planId, scheduledAt: plan.scheduledAt }
    });
  }
  return result.changes > 0;
}

export function cancelReleasePlan(planId: number, operator: string = 'admin', cancelReason?: string): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (['published', 'cancelled'].includes(plan.status)) throw new Error('已发布或已取消的计划不能再取消');

  const result = runQuery(`
    UPDATE rule_release_plans SET status = 'cancelled', cancelled_by = ?, cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [operator, cancelReason ?? null, planId]);

  if (result.changes > 0) {
    createAuditLog(plan.ruleCode, 'cancel_release', operator, {
      ruleId: plan.ruleId,
      ruleVersion: plan.ruleVersion,
      oldStatus: undefined,
      newStatus: undefined,
      affectedStoreIds: plan.releaseType === 'gray' ? plan.grayStoreIds : [],
      detail: { planId, cancelReason }
    });
  }
  return result.changes > 0;
}

export function executeReleasePlan(planId: number, operator: string = 'admin'): boolean {
  const plan = getReleasePlanById(planId);
  if (!plan) return false;
  if (!['approved', 'scheduled', 'paused'].includes(plan.status)) {
    throw new Error(`状态 ${plan.status} 不能执行发布`);
  }

  const rule = getRuleById(plan.ruleId);
  if (!rule) return false;

  const publishOk = publishVersion(
    plan.ruleId,
    plan.releaseType === 'gray' ? { grayStoreIds: plan.grayStoreIds } : {},
    operator
  );

  if (publishOk) {
    runQuery(`
      UPDATE rule_release_plans SET status = 'published', published_by = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [operator, planId]);
  }

  return publishOk;
}

export function getScheduledPlansDue(now: string = new Date().toISOString()): ReleasePlan[] {
  const rows = getAll<any>(`
    SELECT * FROM rule_release_plans
    WHERE status = 'scheduled' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `, [now]);
  return rows.map(parseReleasePlan);
}
