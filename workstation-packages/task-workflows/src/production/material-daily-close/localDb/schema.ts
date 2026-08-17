/** 本地 SQLite 表结构（业务原始数据默认只存本地） */
export const MATERIAL_CLOSE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS CompanyWorkspace (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS LocalFieldMapping (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  header_fingerprint TEXT NOT NULL,
  mappings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, header_fingerprint)
);

CREATE TABLE IF NOT EXISTS MaterialRuleProfile (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  safety_stock_json TEXT NOT NULL,
  scrap_ratio_threshold REAL NOT NULL,
  quantity_tolerance REAL NOT NULL,
  unit_conversion_json TEXT NOT NULL,
  warehouse_alias_json TEXT NOT NULL,
  ai_confidence_threshold REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS MaterialMasterAlias (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  material_code TEXT,
  material_name TEXT,
  alias TEXT NOT NULL,
  unit TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS LocalWorkflowRun (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workflow_code TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  source_files_json TEXT NOT NULL,
  result_json TEXT,
  client_request_id TEXT,
  credits_charged INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS LocalWorkflowException (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  material_code TEXT,
  material_name TEXT,
  warehouse TEXT,
  value REAL,
  user_action TEXT,
  user_payload_json TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS LocalWorkflowDeliverable (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  local_path TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_workspace ON LocalWorkflowRun(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exc_run ON LocalWorkflowException(run_id);
CREATE INDEX IF NOT EXISTS idx_map_workspace ON LocalFieldMapping(workspace_id);
`;

export type CompanyWorkspaceRow = {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalFieldMappingRow = {
  id: string;
  workspaceId: string;
  headerFingerprint: string;
  mappingsJson: string;
  updatedAt: string;
};

export type MaterialRuleProfileRow = {
  id: string;
  workspaceId: string;
  safetyStockJson: string;
  scrapRatioThreshold: number;
  quantityTolerance: number;
  unitConversionJson: string;
  warehouseAliasJson: string;
  aiConfidenceThreshold: number;
  updatedAt: string;
};

export type LocalWorkflowRunRow = {
  id: string;
  workspaceId: string;
  workflowCode: string;
  status: 'running' | 'needs_confirm' | 'completed' | 'failed';
  summaryJson: string;
  sourceFilesJson: string;
  resultJson: string | null;
  clientRequestId: string | null;
  creditsCharged: number;
  createdAt: string;
  updatedAt: string;
};

export type LocalWorkflowExceptionRow = {
  id: string;
  runId: string;
  workspaceId: string;
  code: string;
  severity: string;
  message: string;
  materialCode: string | null;
  materialName: string | null;
  warehouse: string | null;
  value: number | null;
  userAction: string | null;
  userPayloadJson: string | null;
  resolved: number;
  updatedAt: string;
};

export type LocalWorkflowDeliverableRow = {
  id: string;
  runId: string;
  workspaceId: string;
  fileName: string;
  fileKind: string;
  localPath: string | null;
  byteSize: number | null;
  createdAt: string;
};
