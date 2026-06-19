import { getOne, getAll, runQuery } from '../db/database';
import { Rule, RuleConfig, RuleScope } from '../types';

export function getRuleById(id: number): Rule | undefined {
  return getOne<Rule>('SELECT * FROM rules WHERE id = ?', [id]);
}

export function getRuleByCode(code: string): Rule | undefined {
  return getOne<Rule>('SELECT * FROM rules WHERE code = ?', [code]);
}

export function getAllRules(): Rule[] {
  return getAll<Rule>('SELECT * FROM rules ORDER BY priority DESC, id');
}

export function getEnabledRules(): Rule[] {
  return getAll<Rule>('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC, id');
}

export function createRule(
  name: string,
  code: string,
  description: string,
  priority: number = 50,
  enabled: number = 1,
  config: RuleConfig = {},
  scope: RuleScope = { scriptTypes: [], storeIds: [], allStores: true }
): number {
  const result = runQuery(`
    INSERT INTO rules (name, code, description, priority, enabled, config_json, scope_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [name, code, description, priority, enabled, JSON.stringify(config), JSON.stringify(scope)]);
  return result.lastInsertRowid;
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
  }
): boolean {
  const current = getRuleById(id);
  if (!current) return false;

  const name = options.name ?? current.name;
  const description = options.description ?? current.description;
  const priority = options.priority ?? current.priority;
  const enabled = options.enabled ?? current.enabled;
  const config = options.config ? JSON.stringify(options.config) : current.config_json;
  const scope = options.scope ? JSON.stringify(options.scope) : current.scope_json;

  const result = runQuery(`
    UPDATE rules SET name = ?, description = ?, priority = ?, enabled = ?, config_json = ?, scope_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name, description, priority, enabled, config, scope, id]);
  return result.changes > 0;
}

export function deleteRule(id: number): boolean {
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
