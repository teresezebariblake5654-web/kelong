/** 办结工作流输入文件类型（第一版） */
export type MaterialInputType =
  | 'inventory'
  | 'materialIssue'
  | 'materialReturn'
  | 'scrap'
  | 'productionPlan';

export const MATERIAL_INPUT_TYPES: readonly MaterialInputType[] = [
  'inventory',
  'materialIssue',
  'materialReturn',
  'scrap',
  'productionPlan',
] as const;

export const MATERIAL_INPUT_TYPE_LABELS: Record<MaterialInputType, string> = {
  inventory: '当前库存表',
  materialIssue: '今日领料表',
  materialReturn: '今日退料表',
  scrap: '今日废料/报废表',
  productionPlan: '生产计划/完工记录',
};

export type RawSheetInput = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  forcedType?: MaterialInputType;
};

export type RawWorkbookInput = {
  fileName: string;
  sheets: Array<{
    sheetName: string;
    headers: string[];
    rows: Array<Record<string, unknown>>;
  }>;
};

export type FieldMatch = {
  standardField: string;
  sourceColumn: string;
  confidence: number;
  method?: string;
};

export type SheetDetectionResult = {
  fileName: string;
  sheetName: string;
  inputType: MaterialInputType | null;
  confidence: number;
  fieldMatches: FieldMatch[];
  unmatchedCritical: string[];
  reasons: string[];
  needsUserConfirm: boolean;
  confirmPrompt?: {
    kind: 'inputType' | 'criticalField' | 'enterpriseRule';
    message: string;
    options?: Array<{ value: string; label: string }>;
    fieldKey?: string;
    defaultValue?: number;
  };
  /** 压缩后的字段识别 AI 载荷（不含全表） */
  aiFieldPayload?: Record<string, unknown>;
};

export type ClarificationQuestion = {
  id: string;
  fileName: string;
  sheetName: string;
  kind: 'inputType' | 'criticalField' | 'enterpriseRule';
  message: string;
  options?: Array<{ value: string; label: string }>;
  fieldKey?: string;
  defaultValue?: number;
};

export type StandardMaterialRow = {
  materialCode: string;
  materialName: string;
  specification: string;
  warehouse: string;
  batchNo: string;
  unit: string;
  openingQuantity: number;
  inboundQuantity: number;
  issuedQuantity: number;
  returnedQuantity: number;
  scrapQuantity: number;
  countedQuantity: number | null;
  plannedQuantity: number;
  actualOutputQuantity: number;
  transactionDate: string;
  remark: string;
  sourceType: MaterialInputType;
  sourceFile: string;
  sourceSheet: string;
  sourceRowIndex: number;
};

export type SourceLineRef = {
  sourceFile: string;
  sourceSheet: string;
  sourceRowIndex: number;
  sourceType: MaterialInputType;
};

export type MaterialDailyBalanceLine = {
  materialCode: string;
  materialName: string;
  specification: string;
  warehouse: string;
  batchNo: string;
  unit: string;
  openingQuantity: number;
  inboundQuantity: number;
  issuedQuantity: number;
  returnedQuantity: number;
  scrapQuantity: number;
  /** 兼容旧字段名 = closingQuantity */
  theoreticalQuantity: number;
  closingQuantity?: number;
  countedQuantity: number | null;
  varianceQuantity: number | null;
  replenishQuantity: number;
  plannedQuantity: number;
  actualOutputQuantity: number;
  transactionDate: string;
  remark: string;
};

export type MaterialCalcDetail = {
  recordCode: string;
  mergeKey: string;
  mergeStrategy: string;
  materialCode: string;
  materialName: string;
  warehouse: string;
  batchNo: string;
  unit: string;
  openingQuantity: number;
  inboundQuantity: number;
  issuedQuantity: number;
  returnedQuantity: number;
  scrapQuantity: number;
  closingQuantity: number;
  countedQuantity: number | null;
  varianceQuantity: number | null;
  plannedQuantity: number;
  sourceRows: SourceLineRef[];
  duplicateSourceCount: number;
  unitCandidates: string[];
  materialCodeCandidates: string[];
  materialNameCandidates: string[];
};

export type MaterialTicketRow = Record<string, string | number>;

export type MaterialException = {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  materialCode?: string;
  materialName?: string;
  warehouse?: string;
  value?: number | null;
};

export type AiHintPayload = {
  meta: {
    workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE';
    generatedAt: string;
    sourceFiles: string[];
  };
  metrics: Record<string, number>;
  sampleReplenish: MaterialTicketRow[];
  sampleScrap: MaterialTicketRow[];
  sampleVariance: MaterialTicketRow[];
  exceptions: Array<{ code: string; severity: string; message: string }>;
  note: string;
};

export type MaterialDailyCloseWorkflowResult = {
  workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE';
  generatedAt: string;
  detections: SheetDetectionResult[];
  clarifications: ClarificationQuestion[];
  blocked: boolean;
  balances: MaterialDailyBalanceLine[];
  calcDetails: MaterialCalcDetail[];
  replenishTickets: MaterialTicketRow[];
  scrapTickets: MaterialTicketRow[];
  varianceTickets: MaterialTicketRow[];
  exceptions: MaterialException[];
  summary: {
    inventoryRows: number;
    issueRows: number;
    returnRows: number;
    scrapRows: number;
    planRows: number;
    balanceRows: number;
    replenishCount: number;
    scrapTicketCount: number;
    varianceCount: number;
    totalReplenishQty: number;
    totalScrapQty: number;
    totalShortageQty: number;
    totalOverageQty: number;
    /** 结果页指标 */
    processedRecordCount?: number;
    autoClosedCount?: number;
    manualConfirmCount?: number;
    negativeInventoryCount?: number;
    shortageCount?: number;
    excessiveScrapCount?: number;
    safetyStockHint?: number;
  };
  aiPayload: AiHintPayload;
  /** 首次企业规则引导 */
  needsEnterpriseRules?: boolean;
  /** 用户异常确认（本地记忆） */
  appliedActions?: Array<{
    exceptionKey: string;
    code: string;
    materialCode?: string;
    materialName?: string;
    warehouse?: string;
    action:
      | 'confirm_scrap'
      | 'ignore_once'
      | 'modify_quantity'
      | 'select_unit'
      | 'mark_manual';
    value?: string | number;
    resolvedAt: string;
  }>;
};

export type UserClarificationAnswer = {
  questionId: string;
  value: string;
};
