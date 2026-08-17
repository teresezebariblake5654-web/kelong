import { PRODUCTION_DB_SCHEMA_SQL } from './productionSchema.js';
import { WorkspaceDatabaseManager } from './workspaceDbManager.js';
import type { SqlDatabase } from '../material-daily-close/localDb/types.js';

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function now() {
  return new Date().toISOString();
}

export type ProductionRepository = {
  ensureWorkspace(organizationId: string, name?: string): { id: string; organizationId: string };
  saveFieldMapping(input: {
    workspaceId: string;
    taskCode: string;
    headerFingerprint: string;
    mappings: Record<string, string>;
  }): void;
  listFieldMappings(workspaceId: string, taskCode: string): Array<{ headerFingerprint: string; mappingsJson: string }>;
  saveRuleProfile(workspaceId: string, taskCode: string, rules: Record<string, unknown>): void;
  getRuleProfile(workspaceId: string, taskCode: string): Record<string, unknown> | null;
  createRun(input: {
    id: string;
    workspaceId: string;
    taskCode: string;
    status: string;
    summaryJson: string;
    sourceFilesJson: string;
    resultJson: string | null;
    clientRequestId: string | null;
    creditsCharged: number;
  }): void;
  updateRun(input: Partial<{ status: string; summaryJson: string; resultJson: string; creditsCharged: number }> & { id: string }): void;
  findRunByClientRequestId(workspaceId: string, clientRequestId: string): { id: string; creditsCharged: number; resultJson: string | null; status: string } | null;
  saveDecision(input: {
    runId: string;
    workspaceId: string;
    taskCode: string;
    exceptionKey: string;
    action: string;
    valueJson?: string;
  }): void;
  saveDeliverable(input: {
    runId: string;
    workspaceId: string;
    taskCode: string;
    fileName: string;
    fileKind: string;
    localPath?: string;
    byteSize?: number;
  }): void;
  persist(): void;
};

export function createProductionRepository(db?: SqlDatabase & { persist?: () => void }): ProductionRepository {
  const database = db ?? WorkspaceDatabaseManager.openProduction();
  database.exec(PRODUCTION_DB_SCHEMA_SQL);

  return {
    ensureWorkspace(organizationId, name = '生产工作区') {
      const existing = database.get<Record<string, unknown>>(
        'SELECT * FROM ProductionWorkspace WHERE organization_id = ?',
        [organizationId],
      );
      if (existing) {
        return { id: String(existing.id), organizationId };
      }
      const rowId = id('pws');
      const ts = now();
      database.run(
        'INSERT INTO ProductionWorkspace (id, organization_id, name, task_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [rowId, organizationId, name, '', ts, ts],
      );
      return { id: rowId, organizationId };
    },

    saveFieldMapping({ workspaceId, taskCode, headerFingerprint, mappings }) {
      database.run(
        'DELETE FROM ProductionFieldMapping WHERE workspace_id = ? AND task_code = ? AND header_fingerprint = ?',
        [workspaceId, taskCode, headerFingerprint],
      );
      const ts = now();
      database.run(
        'INSERT INTO ProductionFieldMapping (id, workspace_id, task_code, header_fingerprint, mappings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id('pmap'), workspaceId, taskCode, headerFingerprint, JSON.stringify(mappings), ts, ts],
      );
    },

    listFieldMappings(workspaceId, taskCode) {
      return database
        .all<Record<string, unknown>>(
          'SELECT * FROM ProductionFieldMapping WHERE workspace_id = ? AND task_code = ? ORDER BY updated_at DESC',
          [workspaceId, taskCode],
        )
        .map((row) => ({
          headerFingerprint: String(row.header_fingerprint),
          mappingsJson: String(row.mappings_json),
        }));
    },

    saveRuleProfile(workspaceId, taskCode, rules) {
      database.run('DELETE FROM ProductionRuleProfile WHERE workspace_id = ? AND task_code = ?', [
        workspaceId,
        taskCode,
      ]);
      const ts = now();
      database.run(
        'INSERT INTO ProductionRuleProfile (id, workspace_id, task_code, rules_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id('prule'), workspaceId, taskCode, JSON.stringify(rules), ts, ts],
      );
    },

    getRuleProfile(workspaceId, taskCode) {
      const row = database.get<Record<string, unknown>>(
        'SELECT * FROM ProductionRuleProfile WHERE workspace_id = ? AND task_code = ?',
        [workspaceId, taskCode],
      );
      if (!row) return null;
      try {
        return JSON.parse(String(row.rules_json)) as Record<string, unknown>;
      } catch {
        return null;
      }
    },

    createRun(input) {
      const ts = now();
      database.run(
        'INSERT INTO ProductionWorkflowRun (id, workspace_id, task_code, status, summary_json, source_files_json, result_json, client_request_id, credits_charged, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          input.id,
          input.workspaceId,
          input.taskCode,
          input.status,
          input.summaryJson,
          input.sourceFilesJson,
          input.resultJson,
          input.clientRequestId,
          input.creditsCharged,
          ts,
          ts,
        ],
      );
    },

    updateRun(input) {
      const current = database.get<Record<string, unknown>>('SELECT * FROM ProductionWorkflowRun WHERE id = ?', [
        input.id,
      ]);
      if (!current) return;
      database.run(
        'UPDATE ProductionWorkflowRun SET status = ?, summary_json = ?, result_json = ?, credits_charged = ?, updated_at = ? WHERE id = ?',
        [
          input.status ?? current.status,
          input.summaryJson ?? current.summary_json,
          input.resultJson ?? current.result_json,
          input.creditsCharged ?? current.credits_charged,
          now(),
          input.id,
        ],
      );
    },

    findRunByClientRequestId(workspaceId, clientRequestId) {
      const row = database.get<Record<string, unknown>>(
        'SELECT * FROM ProductionWorkflowRun WHERE workspace_id = ? AND client_request_id = ?',
        [workspaceId, clientRequestId],
      );
      if (!row) return null;
      return {
        id: String(row.id),
        creditsCharged: Number(row.credits_charged ?? 0),
        resultJson: row.result_json == null ? null : String(row.result_json),
        status: String(row.status),
      };
    },

    saveDecision(input) {
      const ts = now();
      database.run(
        'INSERT INTO ProductionWorkflowDecision (id, run_id, workspace_id, task_code, exception_key, action, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id('pdec'),
          input.runId,
          input.workspaceId,
          input.taskCode,
          input.exceptionKey,
          input.action,
          input.valueJson ?? null,
          ts,
          ts,
        ],
      );
    },

    saveDeliverable(input) {
      const ts = now();
      database.run(
        'INSERT INTO ProductionWorkflowDeliverable (id, run_id, workspace_id, task_code, file_name, file_kind, local_path, byte_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id('pfile'),
          input.runId,
          input.workspaceId,
          input.taskCode,
          input.fileName,
          input.fileKind,
          input.localPath ?? null,
          input.byteSize ?? null,
          ts,
          ts,
        ],
      );
    },

    persist() {
      database.persist?.();
    },
  };
}
