export type ColumnType = 'string' | 'number' | 'date' | 'boolean' | 'empty' | 'mixed';

export type DataRow = Record<string, unknown>;

export type ColumnProfile = {
  name: string;
  normalizedName: string;
  type: ColumnType;
  nullCount: number;
  distinctCount: number;
};

export type SheetData = {
  name: string;
  headers: string[];
  rows: DataRow[];
  columnProfiles: ColumnProfile[];
};

export type WorkbookData = {
  fileName: string;
  extension: string;
  sheets: SheetData[];
};

export type CleanOptions = {
  dropEmptyRows?: boolean;
  dropDuplicateRows?: boolean;
  trimStrings?: boolean;
};

export type FilterRule = {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'empty' | 'notEmpty';
  value?: unknown;
};

export type SortRule = {
  column: string;
  direction: 'asc' | 'desc';
};

export type AggregateOp = 'sum' | 'avg' | 'min' | 'max' | 'count';

export type AggregateSpec = {
  column: string;
  op: AggregateOp;
  as?: string;
};

export type AnomalyMark = {
  rowIndex: number;
  column: string;
  reason: 'outlier' | 'null' | 'type_mismatch' | 'template_rule';
  value: unknown;
  ruleCode?: string;
  severity?: 'info' | 'warning' | 'critical';
  message?: string;
};

export type StructuredResult = {
  meta: {
    fileName: string;
    sheetName: string;
    rowCount: number;
    columnCount: number;
    generatedAt: string;
  };
  columns: ColumnProfile[];
  previewRows: DataRow[];
  aggregates: Record<string, number | null>;
  groups?: Array<Record<string, unknown>>;
  anomalies: AnomalyMark[];
  quality: {
    emptyRowRemoved: number;
    duplicateRowRemoved: number;
    nullCellCount: number;
  };
};

export type MatchedColumn = {
  fieldKey: string;
  fieldLabel: string;
  sourceColumn: string;
  expectedType: string;
  detectedType: ColumnType;
  confidence: number;
};

export type UnmatchedColumn = {
  fieldKey: string;
  fieldLabel: string;
  required: boolean;
  aliases: string[];
};

export type AmbiguousColumn = {
  fieldKey: string;
  fieldLabel: string;
  candidateColumns: string[];
};

export type TemplateAnomaly = {
  ruleCode: string;
  ruleName: string;
  rowIndex: number;
  field: string;
  sourceColumn?: string;
  value: unknown;
  severity: 'info' | 'warning' | 'critical';
  message: string;
};

export type ExecutionWarning = {
  code: 'REQUIRED_FIELD_MISSING' | 'AMBIGUOUS_FIELD' | 'TYPE_MISMATCH' | 'OPERATION_SKIPPED';
  message: string;
  fieldKey?: string;
  rowIndex?: number;
};

export type TemplateStatistics = {
  rowCountBeforeCleaning: number;
  rowCountAfterCleaning: number;
  duplicateRowsRemoved: number;
  aggregates: Record<string, number | null>;
  groups: Array<Record<string, unknown>>;
};

export type TemplateExecutionResult = {
  templateCode: string;
  templateVersion: string;
  matchedColumns: MatchedColumn[];
  unmatchedColumns: UnmatchedColumn[];
  ambiguousColumns: AmbiguousColumn[];
  cleanedRows: DataRow[];
  anomalies: TemplateAnomaly[];
  warnings: ExecutionWarning[];
  statistics: TemplateStatistics;
};

export interface DataEngine {
  parseFile(input: ArrayBuffer | Uint8Array | Buffer, fileName: string): WorkbookData;
  detectHeaders(matrix: unknown[][]): string[];
  inferColumnTypes(rows: DataRow[], headers: string[]): ColumnProfile[];
  cleanData(sheet: SheetData, options?: CleanOptions): { sheet: SheetData; emptyRemoved: number; duplicatesRemoved: number };
  filterData(rows: DataRow[], rules: FilterRule[]): DataRow[];
  sortData(rows: DataRow[], rules: SortRule[]): DataRow[];
  groupData(rows: DataRow[], groupBy: string[]): Array<Record<string, unknown>>;
  aggregateData(rows: DataRow[], specs: AggregateSpec[]): Record<string, number | null>;
  detectAnomalies(rows: DataRow[], profiles: ColumnProfile[]): AnomalyMark[];
  executeTemplate(input: {
    templateCode: string;
    sheet: SheetData;
    templateVersion?: string;
  }): TemplateExecutionResult;
  buildStructuredResult(input: {
    fileName: string;
    sheet: SheetData;
    aggregates?: AggregateSpec[];
    groupBy?: string[];
    previewLimit?: number;
    quality?: { emptyRowRemoved: number; duplicateRowRemoved: number };
  }): StructuredResult;
  exportResult(
    rows: DataRow[],
    format: 'csv' | 'xlsx',
    sheetName?: string,
  ): Uint8Array | string;
}
