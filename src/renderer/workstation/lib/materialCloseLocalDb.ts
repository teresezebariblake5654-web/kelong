import {
  WorkspaceDatabaseManager,
  createHistoryStoreFromRepository,
  createMaterialCloseRepository,
  type MaterialCloseRepository,
  type LocalHistoryStore,
} from '@aw/task-workflows';
import { getActiveOrganizationId } from '@workstation/lib/localStore';

let repo: MaterialCloseRepository | null = null;

/**
 * 物料日清本地库：写入岗位隔离的 production.db（非 hr/finance 共库）
 * 复用既有 MaterialCloseRepository 表结构，落在同一 production 工作区文件。
 */
export function getMaterialCloseRepository(): MaterialCloseRepository {
  if (!repo) {
    WorkspaceDatabaseManager.initRoundDatabases();
    const db = WorkspaceDatabaseManager.openProduction();
    repo = createMaterialCloseRepository(db);
  }
  return repo;
}

export function ensureMaterialCloseWorkspace(name = '默认企业工作区'): {
  workspaceId: string;
  organizationId: string;
} {
  const organizationId = getActiveOrganizationId() || 'local-device';
  const r = getMaterialCloseRepository();
  const ws = r.ensureWorkspace({ organizationId, name });
  persistMaterialCloseDb();
  return { workspaceId: ws.id, organizationId };
}

export function getMaterialCloseHistoryStore(): LocalHistoryStore {
  const { workspaceId: wsId } = ensureMaterialCloseWorkspace();
  const r = getMaterialCloseRepository();
  const bridged = createHistoryStoreFromRepository(r, wsId);
  return {
    listMappings(scopeKey) {
      return bridged.listMappings(scopeKey);
    },
    saveMapping(record) {
      bridged.saveMapping(record);
      persistMaterialCloseDb();
    },
    getEnterpriseRules(scopeKey) {
      return bridged.getEnterpriseRules(scopeKey);
    },
    saveEnterpriseRules(scopeKey, rules) {
      bridged.saveEnterpriseRules(scopeKey, rules);
      persistMaterialCloseDb();
    },
  };
}

export function persistMaterialCloseDb() {
  WorkspaceDatabaseManager.openProduction().persist();
}

export function getActiveMaterialCloseWorkspaceId(): string {
  return ensureMaterialCloseWorkspace().workspaceId;
}
