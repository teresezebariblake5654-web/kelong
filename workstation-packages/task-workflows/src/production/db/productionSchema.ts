/** production.db 表结构：生产岗位业务数据专用，禁止与 hr/finance 等共库 */
export const PRODUCTION_DB_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ProductionWorkspace (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  task_code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionFieldMapping (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL,
  header_fingerprint TEXT NOT NULL,
  mappings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, task_code, header_fingerprint)
);

CREATE TABLE IF NOT EXISTS ProductionRuleProfile (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, task_code)
);

CREATE TABLE IF NOT EXISTS ProductionMaterialAlias (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL,
  material_code TEXT,
  material_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionEquipmentAlias (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL,
  equipment_code TEXT,
  equipment_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionLineAlias (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL DEFAULT '',
  alias TEXT NOT NULL,
  line_code TEXT,
  line_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionWorkflowRun (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  source_files_json TEXT NOT NULL,
  result_json TEXT,
  client_request_id TEXT,
  credits_charged INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionWorkflowException (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  user_action TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionWorkflowDecision (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL,
  exception_key TEXT NOT NULL,
  action TEXT NOT NULL,
  value_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ProductionWorkflowDeliverable (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  task_code TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_kind TEXT NOT NULL,
  local_path TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prod_run_task ON ProductionWorkflowRun(workspace_id, task_code, created_at);
CREATE INDEX IF NOT EXISTS idx_prod_map_task ON ProductionFieldMapping(workspace_id, task_code);
`;
