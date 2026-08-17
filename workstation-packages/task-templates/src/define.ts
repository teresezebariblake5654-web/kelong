import type {
  AgentRole,
  AgentType,
  AnomalyRule,
  FieldDataType,
  FieldRule,
  LicenseProductType,
  LocalOperation,
  TaskTemplateDefinition,
} from './types.js';

export const PRODUCT_ROLE_ACCESS: Readonly<Record<LicenseProductType, readonly AgentRole[]>> = {
  HR_AGENT: ['hr', 'universal'],
  SALES_AGENT: ['sales', 'universal'],
  BUSINESS_AGENT: ['marketing', 'sales', 'operations', 'universal'],
  MANUFACTURING_AGENT: ['procurement', 'production', 'logistics', 'universal'],
  FULL_AGENT: ['hr', 'marketing', 'sales', 'operations', 'administration', 'procurement', 'production', 'logistics', 'customer-service', 'universal'],
  PRODUCTION_AGENT: ['production', 'universal'],
  LOGISTICS_AGENT: ['logistics', 'universal'],
  UNIVERSAL_AGENT: ['universal'],
};

const AGENT_TYPE_BY_ROLE: Record<AgentRole, AgentType> = {
  hr: 'HR',
  marketing: 'MARKETING',
  sales: 'SALES',
  operations: 'OPERATIONS',
  administration: 'ADMINISTRATION',
  procurement: 'PROCUREMENT',
  production: 'PRODUCTION',
  logistics: 'LOGISTICS',
  'customer-service': 'CUSTOMER_SERVICE',
  universal: 'UNIVERSAL',
};

const PRIMARY_PRODUCT_BY_ROLE: Record<AgentRole, LicenseProductType> = {
  hr: 'HR_AGENT',
  marketing: 'BUSINESS_AGENT',
  sales: 'SALES_AGENT',
  operations: 'BUSINESS_AGENT',
  administration: 'FULL_AGENT',
  procurement: 'MANUFACTURING_AGENT',
  production: 'PRODUCTION_AGENT',
  logistics: 'LOGISTICS_AGENT',
  'customer-service': 'FULL_AGENT',
  universal: 'UNIVERSAL_AGENT',
};

export function productsForRole(role: AgentRole): LicenseProductType[] {
  return (Object.entries(PRODUCT_ROLE_ACCESS) as Array<[LicenseProductType, readonly AgentRole[]]>)
    .filter(([, roles]) => roles.includes(role))
    .map(([product]) => product);
}

export function field(
  key: string,
  label: string,
  aliases: string[],
  dataType: FieldDataType = 'string',
  required = true,
  options: Partial<Omit<FieldRule, 'key' | 'label' | 'aliases' | 'dataType' | 'required'>> = {},
): FieldRule {
  return { key, label, aliases: Array.from(new Set([label, key, ...aliases])), dataType, required, ...options };
}

type TemplateInput = {
  code: string;
  role: AgentRole;
  name: string;
  description: string;
  fields: FieldRule[];
  localOperations: LocalOperation[];
  anomalyRules: AnomalyRule[];
  outputMetrics: Record<string, string>;
  reportSections?: string[];
  creditCost?: number;
  defaultGroupBy?: string[];
};

export function defineTemplate(input: TemplateInput): TaskTemplateDefinition {
  const requiredFields = input.fields.filter((item) => item.required).map((item) => item.label);
  const aggregateHints = input.localOperations
    .filter((operation): operation is Extract<LocalOperation, { type: 'aggregate' }> => operation.type === 'aggregate')
    .filter((operation) => operation.operation !== 'count-distinct')
    .map((operation) => ({
      columnHint: input.fields.find((item) => item.key === operation.field)?.label ?? operation.field,
      op: operation.operation as 'sum' | 'avg' | 'min' | 'max' | 'count',
    }));
  const creditCost = input.creditCost ?? 20;

  return {
    code: input.code,
    version: '1.0.0',
    role: input.role,
    agentType: AGENT_TYPE_BY_ROLE[input.role],
    productType: PRIMARY_PRODUCT_BY_ROLE[input.role],
    allowedProductTypes: productsForRole(input.role),
    name: input.name,
    description: input.description,
    fields: input.fields,
    localOperations: input.localOperations,
    anomalyRules: input.anomalyRules,
    structuredOutputSchema: {
      type: 'object',
      required: ['summary', 'metrics', 'anomalies'],
      properties: {
        summary: { type: 'string', description: '任务执行摘要' },
        metrics: { type: 'object', description: Object.values(input.outputMetrics).join('；') },
        anomalies: { type: 'array', description: '按规则识别的异常记录', items: { type: 'object' } },
        recommendations: { type: 'array', description: '可执行改进建议', items: { type: 'string' } },
      },
    },
    reportSections: (input.reportSections ?? ['数据概览', '关键指标', '异常明细', '行动建议']).map((title, index) => ({
      code: `section_${index + 1}`,
      title,
      source: index === 3 ? 'ai' : 'combined',
    })),
    creditCost,
    enabled: true,
    aiSummary: {
      enabled: true,
      systemPrompt: '你是企业数据分析助手。仅依据服务端收到的结构化统计与异常结果总结，不臆测原始数据，不输出敏感个人信息。',
      promptTemplate: `请总结“${input.name}”结果。重点解释${Object.values(input.outputMetrics).join('、')}，逐项说明高优先级异常，并给出按优先级排序、可验证的行动建议。输入：{{structuredOutput}}`,
      temperature: 0.2,
      maxOutputTokens: 1200,
    },
    reportExport: {
      enabled: true,
      formats: ['xlsx', 'csv', 'pdf', 'json'],
      defaultFormat: 'xlsx',
      fileNameTemplate: `${input.code}_{{date}}`,
    },
    estimatedCredits: creditCost,
    requiredFields,
    defaultGroupBy: input.defaultGroupBy,
    aggregateHints: aggregateHints.length > 0 ? aggregateHints : undefined,
  };
}

export const anomaly = (
  code: string,
  name: string,
  fieldName: string,
  operator: AnomalyRule['operator'],
  value: unknown,
  severity: AnomalyRule['severity'],
  message: string,
): AnomalyRule => ({ code, name, field: fieldName, operator, value, severity, message });
