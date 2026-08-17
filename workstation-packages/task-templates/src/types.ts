import type { ProductType as LegacyProductType } from '@aw/shared';

export const AGENT_ROLES = [
  'hr',
  'marketing',
  'sales',
  'operations',
  'administration',
  'procurement',
  'production',
  'logistics',
  'customer-service',
  'universal',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type LocalJobRole = AgentRole;

export type AgentType =
  | 'HR'
  | 'MARKETING'
  | 'SALES'
  | 'OPERATIONS'
  | 'ADMINISTRATION'
  | 'PROCUREMENT'
  | 'PRODUCTION'
  | 'LOGISTICS'
  | 'CUSTOMER_SERVICE'
  | 'UNIVERSAL';

export type LicenseProductType =
  | LegacyProductType
  | 'SALES_AGENT'
  | 'BUSINESS_AGENT'
  | 'MANUFACTURING_AGENT'
  | 'FULL_AGENT';

export type FieldDataType = 'string' | 'number' | 'integer' | 'date' | 'datetime' | 'boolean';

export type FieldRule = {
  key: string;
  label: string;
  aliases: string[];
  dataType: FieldDataType;
  required: boolean;
  description?: string;
  unit?: string;
  enumValues?: string[];
  defaultValue?: string | number | boolean;
  normalizers?: Array<'trim' | 'lowercase' | 'uppercase' | 'parse-number' | 'parse-date' | 'empty-to-null'>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
};

export type AggregateOperation = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count-distinct';

export type LocalOperation =
  | { type: 'filter'; field: string; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not-empty'; value?: unknown }
  | { type: 'group'; fields: string[] }
  | { type: 'aggregate'; field: string; operation: AggregateOperation; as: string }
  | { type: 'derive'; as: string; expression: string; description: string }
  | { type: 'sort'; field: string; direction: 'asc' | 'desc' }
  | { type: 'deduplicate'; fields: string[]; keep: 'first' | 'last' }
  | { type: 'limit'; count: number };

export type AnomalyRule = {
  code: string;
  name: string;
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'outside' | 'missing' | 'duplicate' | 'deviation';
  value?: unknown;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  groupBy?: string[];
};

export type StructuredOutputSchema = {
  type: 'object';
  required: string[];
  properties: Record<string, {
    type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
    description: string;
    items?: { type: 'string' | 'number' | 'object' };
  }>;
};

export type ReportSection = {
  code: string;
  title: string;
  source: 'local' | 'ai' | 'combined';
  description?: string;
};

export type AiSummaryConfig = {
  enabled: boolean;
  systemPrompt: string;
  promptTemplate: string;
  temperature: number;
  maxOutputTokens: number;
};

export type ReportExportConfig = {
  enabled: boolean;
  formats: Array<'xlsx' | 'csv' | 'pdf' | 'json'>;
  defaultFormat: 'xlsx' | 'csv' | 'pdf' | 'json';
  fileNameTemplate: string;
};

export type TaskTemplateDefinition = {
  code: string;
  version: string;
  role: AgentRole;
  agentType: AgentType;
  productType: LicenseProductType;
  allowedProductTypes: LicenseProductType[];
  name: string;
  description: string;
  fields: FieldRule[];
  localOperations: LocalOperation[];
  anomalyRules: AnomalyRule[];
  structuredOutputSchema: StructuredOutputSchema;
  reportSections: ReportSection[];
  creditCost: number;
  enabled: boolean;
  aiSummary: AiSummaryConfig;
  reportExport: ReportExportConfig;

  /** Compatibility fields for existing desktop/data-engine callers. */
  estimatedCredits: number;
  requiredFields: string[];
  defaultGroupBy?: string[];
  aggregateHints?: Array<{ columnHint: string; op: 'sum' | 'avg' | 'min' | 'max' | 'count' }>;
};

/** Backward-compatible name used by the existing desktop client. */
export type LocalTaskTemplate = TaskTemplateDefinition;
