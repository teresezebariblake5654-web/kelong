import type {
  CompanyWorkspaceRow,
  LocalFieldMappingRow,
  LocalWorkflowDeliverableRow,
  LocalWorkflowExceptionRow,
  LocalWorkflowRunRow,
  MaterialRuleProfileRow,
} from './schema.js';

/** 最小 SQL 执行面：浏览器 sql.js / 测试内存 / 未来 Tauri plugin-sql */
export type SqlDatabase = {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  export?: () => Uint8Array;
};

export type MaterialCloseRepository = {
  ensureWorkspace(input: { organizationId: string; name: string }): CompanyWorkspaceRow;
  saveFieldMapping(input: {
    workspaceId: string;
    headerFingerprint: string;
    mappings: Record<string, string>;
  }): void;
  listFieldMappings(workspaceId: string): LocalFieldMappingRow[];
  saveRuleProfile(input: Omit<MaterialRuleProfileRow, 'id' | 'updatedAt'> & { id?: string }): void;
  getRuleProfile(workspaceId: string): MaterialRuleProfileRow | null;
  saveMaterialAlias(input: {
    workspaceId: string;
    materialCode?: string;
    materialName?: string;
    alias: string;
    unit?: string;
  }): void;
  createRun(input: Omit<LocalWorkflowRunRow, 'createdAt' | 'updatedAt'>): LocalWorkflowRunRow;
  updateRun(input: Partial<LocalWorkflowRunRow> & { id: string }): void;
  getRun(runId: string): LocalWorkflowRunRow | null;
  listRuns(workspaceId: string, limit?: number): LocalWorkflowRunRow[];
  findRunByClientRequestId(workspaceId: string, clientRequestId: string): LocalWorkflowRunRow | null;
  replaceExceptions(runId: string, workspaceId: string, rows: Omit<LocalWorkflowExceptionRow, 'id' | 'updatedAt'>[]): void;
  listExceptions(runId: string): LocalWorkflowExceptionRow[];
  updateExceptionAction(input: {
    id: string;
    userAction: string;
    userPayloadJson?: string;
    resolved: boolean;
  }): void;
  saveDeliverable(row: Omit<LocalWorkflowDeliverableRow, 'id' | 'createdAt'> & { id?: string }): void;
  listDeliverables(runId: string): LocalWorkflowDeliverableRow[];
};
