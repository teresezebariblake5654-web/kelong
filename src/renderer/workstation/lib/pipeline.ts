import type { SheetData, StructuredResult, TemplateExecutionResult } from '@aw/data-engine';
import { dataEngine } from '@aw/data-engine';
import type { ImageAnalysisResult, StructuredDataPayload } from '@aw/shared';

export function buildInitialMappings(
  templateResult: TemplateExecutionResult,
): Record<string, string> {
  const mappings: Record<string, string> = {};
  for (const item of templateResult.matchedColumns) {
    mappings[item.fieldKey] = item.sourceColumn;
  }
  return mappings;
}

export function applyFieldMappings(sheet: SheetData, mappings: Record<string, string>): SheetData {
  const mappedSources = new Set(Object.values(mappings));
  const rows = sheet.rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [fieldKey, sourceColumn] of Object.entries(mappings)) {
      next[fieldKey] = row[sourceColumn];
    }
    for (const header of sheet.headers) {
      if (!mappedSources.has(header)) {
        next[header] = row[header];
      }
    }
    return next;
  });
  const headers = [
    ...Object.keys(mappings),
    ...sheet.headers.filter((header) => !mappedSources.has(header)),
  ];
  const columnProfiles = dataEngine.inferColumnTypes(rows, headers);
  return {
    name: sheet.name,
    headers,
    rows,
    columnProfiles,
  };
}

export function buildStructuredFromTemplate(
  fileName: string,
  sheet: SheetData,
  templateResult: TemplateExecutionResult,
): StructuredResult {
  const cleanedSheet: SheetData = {
    name: sheet.name,
    headers: Object.keys(templateResult.cleanedRows[0] ?? {}),
    rows: templateResult.cleanedRows,
    columnProfiles: dataEngine.inferColumnTypes(
      templateResult.cleanedRows,
      Object.keys(templateResult.cleanedRows[0] ?? {}),
    ),
  };

  return dataEngine.buildStructuredResult({
    fileName,
    sheet: cleanedSheet,
    previewLimit: 30,
    quality: {
      emptyRowRemoved:
        templateResult.statistics.rowCountBeforeCleaning -
        templateResult.statistics.rowCountAfterCleaning -
        templateResult.statistics.duplicateRowsRemoved,
      duplicateRowRemoved: templateResult.statistics.duplicateRowsRemoved,
    },
  });
}

export function buildAnalyzePayload(
  structured: StructuredResult,
  templateResult: TemplateExecutionResult,
): StructuredDataPayload {
  return {
    meta: structured.meta,
    aggregates: {
      ...structured.aggregates,
      ...templateResult.statistics.aggregates,
    },
    groups: templateResult.statistics.groups.length
      ? templateResult.statistics.groups
      : (structured.groups ?? []),
    quality: structured.quality,
    anomalyCount: templateResult.anomalies.length,
    anomalies: templateResult.anomalies.slice(0, 80).map((item) => ({
      ruleCode: item.ruleCode,
      field: item.field,
      severity: item.severity,
      message: item.message,
      rowIndex: item.rowIndex,
    })),
    matchedFields: templateResult.matchedColumns.map((item) => item.fieldKey),
    warnings: templateResult.warnings,
  };
}

export function formatAnalysisResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    if (typeof record.summary === 'string') return record.summary;
    return JSON.stringify(result, null, 2);
  }
  return String(result ?? '');
}

export function formatDocumentImageResult(result: ImageAnalysisResult): string {
  const lines = [result.summary];
  if (result.extractedText?.trim()) {
    lines.push('', '识别文字：', result.extractedText.trim());
  }
  if (result.details?.length) {
    lines.push('', '详细要点：', ...result.details.map((item) => `• ${item}`));
  }
  return lines.join('\n');
}
