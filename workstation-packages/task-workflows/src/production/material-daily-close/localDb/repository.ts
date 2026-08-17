import { MATERIAL_CLOSE_SCHEMA_SQL } from './schema.js';
import type {
  CompanyWorkspaceRow,
  LocalFieldMappingRow,
  LocalWorkflowDeliverableRow,
  LocalWorkflowExceptionRow,
  LocalWorkflowRunRow,
  MaterialRuleProfileRow,
} from './schema.js';
import type { MaterialCloseRepository, SqlDatabase } from './types.js';

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

export function createMaterialCloseRepository(db: SqlDatabase): MaterialCloseRepository {
  db.exec(MATERIAL_CLOSE_SCHEMA_SQL);

  return {
    ensureWorkspace({ organizationId, name }) {
      const existing = db.get<Record<string, unknown>>(
        'SELECT * FROM CompanyWorkspace WHERE organization_id = ?',
        [organizationId],
      );
      if (existing) {
        return {
          id: String(existing.id),
          organizationId: String(existing.organization_id),
          name: String(existing.name),
          createdAt: String(existing.created_at),
          updatedAt: String(existing.updated_at),
        };
      }
      const row: CompanyWorkspaceRow = {
        id: id('ws'),
        organizationId,
        name,
        createdAt: now(),
        updatedAt: now(),
      };
      db.run(
        'INSERT INTO CompanyWorkspace (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [row.id, row.organizationId, row.name, row.createdAt, row.updatedAt],
      );
      return row;
    },

    saveFieldMapping({ workspaceId, headerFingerprint, mappings }) {
      db.run('DELETE FROM LocalFieldMapping WHERE workspace_id = ? AND header_fingerprint = ?', [
        workspaceId,
        headerFingerprint,
      ]);
      db.run(
        'INSERT INTO LocalFieldMapping (id, workspace_id, header_fingerprint, mappings_json, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id('map'), workspaceId, headerFingerprint, JSON.stringify(mappings), now()],
      );
    },

    listFieldMappings(workspaceId) {
      return db
        .all<Record<string, unknown>>(
          'SELECT * FROM LocalFieldMapping WHERE workspace_id = ? ORDER BY updated_at DESC',
          [workspaceId],
        )
        .map((row) => ({
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          headerFingerprint: String(row.header_fingerprint),
          mappingsJson: String(row.mappings_json),
          updatedAt: String(row.updated_at),
        })) as LocalFieldMappingRow[];
    },

    saveRuleProfile(input) {
      const existing = db.get<Record<string, unknown>>(
        'SELECT id FROM MaterialRuleProfile WHERE workspace_id = ?',
        [input.workspaceId],
      );
      const rowId = existing ? String(existing.id) : input.id ?? id('rule');
      if (existing) {
        db.run(
          'UPDATE MaterialRuleProfile SET safety_stock_json = ?, scrap_ratio_threshold = ?, quantity_tolerance = ?, unit_conversion_json = ?, warehouse_alias_json = ?, ai_confidence_threshold = ?, updated_at = ? WHERE workspace_id = ?',
          [
            input.safetyStockJson,
            input.scrapRatioThreshold,
            input.quantityTolerance,
            input.unitConversionJson,
            input.warehouseAliasJson,
            input.aiConfidenceThreshold,
            now(),
            input.workspaceId,
          ],
        );
        return;
      }
      db.run(
        'INSERT INTO MaterialRuleProfile (id, workspace_id, safety_stock_json, scrap_ratio_threshold, quantity_tolerance, unit_conversion_json, warehouse_alias_json, ai_confidence_threshold, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          rowId,
          input.workspaceId,
          input.safetyStockJson,
          input.scrapRatioThreshold,
          input.quantityTolerance,
          input.unitConversionJson,
          input.warehouseAliasJson,
          input.aiConfidenceThreshold,
          now(),
        ],
      );
    },

    getRuleProfile(workspaceId) {
      const row = db.get<Record<string, unknown>>(
        'SELECT * FROM MaterialRuleProfile WHERE workspace_id = ?',
        [workspaceId],
      );
      if (!row) return null;
      return {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        safetyStockJson: String(row.safety_stock_json),
        scrapRatioThreshold: Number(row.scrap_ratio_threshold),
        quantityTolerance: Number(row.quantity_tolerance),
        unitConversionJson: String(row.unit_conversion_json),
        warehouseAliasJson: String(row.warehouse_alias_json),
        aiConfidenceThreshold: Number(row.ai_confidence_threshold),
        updatedAt: String(row.updated_at),
      } satisfies MaterialRuleProfileRow;
    },

    saveMaterialAlias(input) {
      db.run(
        'INSERT INTO MaterialMasterAlias (id, workspace_id, material_code, material_name, alias, unit, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id('alias'),
          input.workspaceId,
          input.materialCode ?? null,
          input.materialName ?? null,
          input.alias,
          input.unit ?? null,
          now(),
        ],
      );
    },

    createRun(input) {
      const row: LocalWorkflowRunRow = {
        ...input,
        createdAt: now(),
        updatedAt: now(),
      };
      db.run(
        'INSERT INTO LocalWorkflowRun (id, workspace_id, workflow_code, status, summary_json, source_files_json, result_json, client_request_id, credits_charged, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          row.id,
          row.workspaceId,
          row.workflowCode,
          row.status,
          row.summaryJson,
          row.sourceFilesJson,
          row.resultJson,
          row.clientRequestId,
          row.creditsCharged,
          row.createdAt,
          row.updatedAt,
        ],
      );
      return row;
    },

    updateRun(input) {
      const current = this.getRun(input.id);
      if (!current) return;
      const next = { ...current, ...input, updatedAt: now() };
      db.run(
        'UPDATE LocalWorkflowRun SET status = ?, summary_json = ?, source_files_json = ?, result_json = ?, client_request_id = ?, credits_charged = ?, updated_at = ? WHERE id = ?',
        [
          next.status,
          next.summaryJson,
          next.sourceFilesJson,
          next.resultJson,
          next.clientRequestId,
          next.creditsCharged,
          next.updatedAt,
          next.id,
        ],
      );
    },

    getRun(runId) {
      const row = db.get<Record<string, unknown>>('SELECT * FROM LocalWorkflowRun WHERE id = ?', [runId]);
      if (!row) return null;
      return mapRun(row);
    },

    listRuns(workspaceId, limit = 50) {
      return db
        .all<Record<string, unknown>>(
          'SELECT * FROM LocalWorkflowRun WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?',
          [workspaceId, limit],
        )
        .map(mapRun);
    },

    findRunByClientRequestId(workspaceId, clientRequestId) {
      const row = db.get<Record<string, unknown>>(
        'SELECT * FROM LocalWorkflowRun WHERE workspace_id = ? AND client_request_id = ?',
        [workspaceId, clientRequestId],
      );
      return row ? mapRun(row) : null;
    },

    replaceExceptions(runId, workspaceId, rows) {
      db.run('DELETE FROM LocalWorkflowException WHERE run_id = ?', [runId]);
      for (const row of rows) {
        db.run(
          'INSERT INTO LocalWorkflowException (id, run_id, workspace_id, code, severity, message, material_code, material_name, warehouse, value, user_action, user_payload_json, resolved, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            id('exc'),
            runId,
            workspaceId,
            row.code,
            row.severity,
            row.message,
            row.materialCode,
            row.materialName,
            row.warehouse,
            row.value,
            row.userAction,
            row.userPayloadJson,
            row.resolved,
            now(),
          ],
        );
      }
    },

    listExceptions(runId) {
      return db
        .all<Record<string, unknown>>('SELECT * FROM LocalWorkflowException WHERE run_id = ?', [runId])
        .map(
          (row) =>
            ({
              id: String(row.id),
              runId: String(row.run_id),
              workspaceId: String(row.workspace_id),
              code: String(row.code),
              severity: String(row.severity),
              message: String(row.message),
              materialCode: row.material_code == null ? null : String(row.material_code),
              materialName: row.material_name == null ? null : String(row.material_name),
              warehouse: row.warehouse == null ? null : String(row.warehouse),
              value: row.value == null ? null : Number(row.value),
              userAction: row.user_action == null ? null : String(row.user_action),
              userPayloadJson: row.user_payload_json == null ? null : String(row.user_payload_json),
              resolved: Number(row.resolved),
              updatedAt: String(row.updated_at),
            }) satisfies LocalWorkflowExceptionRow,
        );
    },

    updateExceptionAction({ id: excId, userAction, userPayloadJson, resolved }) {
      db.run(
        'UPDATE LocalWorkflowException SET user_action = ?, user_payload_json = ?, resolved = ?, updated_at = ? WHERE id = ?',
        [userAction, userPayloadJson ?? null, resolved ? 1 : 0, now(), excId],
      );
    },

    saveDeliverable(row) {
      db.run(
        'INSERT INTO LocalWorkflowDeliverable (id, run_id, workspace_id, file_name, file_kind, local_path, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          row.id ?? id('file'),
          row.runId,
          row.workspaceId,
          row.fileName,
          row.fileKind,
          row.localPath,
          row.byteSize,
          now(),
        ],
      );
    },

    listDeliverables(runId) {
      return db
        .all<Record<string, unknown>>('SELECT * FROM LocalWorkflowDeliverable WHERE run_id = ?', [runId])
        .map(
          (row) =>
            ({
              id: String(row.id),
              runId: String(row.run_id),
              workspaceId: String(row.workspace_id),
              fileName: String(row.file_name),
              fileKind: String(row.file_kind),
              localPath: row.local_path == null ? null : String(row.local_path),
              byteSize: row.byte_size == null ? null : Number(row.byte_size),
              createdAt: String(row.created_at),
            }) satisfies LocalWorkflowDeliverableRow,
        );
    },
  };
}

function mapRun(row: Record<string, unknown>): LocalWorkflowRunRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    workflowCode: String(row.workflow_code),
    status: String(row.status) as LocalWorkflowRunRow['status'],
    summaryJson: String(row.summary_json),
    sourceFilesJson: String(row.source_files_json),
    resultJson: row.result_json == null ? null : String(row.result_json),
    clientRequestId: row.client_request_id == null ? null : String(row.client_request_id),
    creditsCharged: Number(row.credits_charged ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
