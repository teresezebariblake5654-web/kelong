import {
  DEFAULT_ENTERPRISE_RULES,
  type EnterpriseRules,
  type LocalHistoryStore,
} from '@aw/task-workflows';
import { getActiveOrganizationId } from '@workstation/lib/localStore';
import { getMaterialCloseHistoryStore } from '@workstation/lib/materialCloseLocalDb';

/**
 * 桌面端历史存储：优先本地 SQLite 兼容层（memory SQL + localStorage dump），
 * 保存字段映射、安全库存、损耗阈值、单位换算、仓库别名。
 */
export function createBrowserHistoryStore(): LocalHistoryStore {
  return getMaterialCloseHistoryStore();
}

export function materialCloseScopeKey(): string {
  return getActiveOrganizationId() || 'local-device';
}

export function ensureDefaultEnterpriseRules(store: LocalHistoryStore, scopeKey: string): EnterpriseRules {
  const existing = store.getEnterpriseRules(scopeKey);
  if (existing) return existing;
  const next = { ...DEFAULT_ENTERPRISE_RULES, updatedAt: new Date().toISOString() };
  store.saveEnterpriseRules(scopeKey, next);
  return next;
}
