import * as XLSX from 'xlsx';
import { LocalDataEngine } from './engine.js';
import type { DataRow, SheetData } from './types.js';
import {
  matchCanonicalField,
  normalizeHeaderKey,
  remapRowHeaders,
  type FieldAliasMap,
} from './workflow-runtime/operators/fieldUtils.js';

export type UploadContextFile = {
  fileId: string;
  fileName: string;
  sheets: string[];
};

export type DetectedFieldSet = {
  fileId: string;
  fileName: string;
  sheetName: string;
  fields: string[];
  rowCount: number;
};

export type MatchedUploadTemplate = {
  role: string;
  description: string;
  required: boolean;
  fileId: string;
  fileName: string;
  sheetName: string;
  detectedFields: string[];
  missingFields: string[];
  confidence: number;
};

export type UploadClarification = {
  id: string;
  role: string;
  question: string;
  candidates: Array<{
    fileId: string;
    fileName: string;
    sheetName: string;
    confidence: number;
  }>;
};

export type UploadContext = {
  files: UploadContextFile[];
  detectedFields: DetectedFieldSet[];
  matchedTemplates: MatchedUploadTemplate[];
  confidence: number;
  clarifications: UploadClarification[];
};

export type UploadDetectionSource = {
  fileId: string;
  fileName: string;
  bytes: Uint8Array;
};

export type UploadRoleSpec = {
  role: string;
  description: string;
  required: boolean;
  requiredFields: string[];
  aliases: FieldAliasMap;
};

export type PreparedRoleInput = {
  role: string;
  fileId: string;
  sourceFileName: string;
  sheetName: string;
  confidence: number;
  bytes: Uint8Array;
};

type Candidate = MatchedUploadTemplate & { sheet: SheetData; aliases: FieldAliasMap };

function normalizedWorkbookBytes(sheet: SheetData, aliases: FieldAliasMap): Uint8Array {
  const rows = sheet.rows.map((row) => remapRowHeaders(row, aliases));
  const worksheet = rows.length
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([Object.keys(aliases)]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31) || 'Data');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as number[]);
}

function roleCandidate(
  source: UploadDetectionSource,
  sheet: SheetData,
  spec: UploadRoleSpec,
): Candidate {
  const detectedFields = [
    ...new Set(
      sheet.headers
        .map((header) => matchCanonicalField(header, spec.aliases))
        .filter((field): field is string => Boolean(field)),
    ),
  ];
  const missingFields = spec.requiredFields.filter((field) => !detectedFields.includes(field));
  const fieldRatio = spec.requiredFields.length
    ? (spec.requiredFields.length - missingFields.length) / spec.requiredFields.length
    : 0;
  const normalizedSheet = normalizeHeaderKey(sheet.name);
  const nameTokens = [spec.role, spec.description]
    .flatMap((value) => value.split(/[、/与和\s]+/))
    .map(normalizeHeaderKey)
    .filter((value) => value.length >= 2);
  const nameBonus = nameTokens.some((token) => normalizedSheet.includes(token)) ? 0.08 : 0;
  const confidence = Math.min(1, Number((fieldRatio * 0.92 + nameBonus).toFixed(2)));
  return {
    role: spec.role,
    description: spec.description,
    required: spec.required,
    fileId: source.fileId,
    fileName: source.fileName,
    sheetName: sheet.name,
    detectedFields,
    missingFields,
    confidence,
    sheet,
    aliases: spec.aliases,
  };
}

function candidateKey(candidate: Pick<Candidate, 'fileId' | 'sheetName'>): string {
  return `${candidate.fileId}::${candidate.sheetName}`;
}

/**
 * Parses every uploaded workbook locally, recognizes every sheet against workflow roles,
 * and produces normalized per-role virtual workbooks for the existing runtime contract.
 */
export function detectWorkflowUploadContext(input: {
  sources: UploadDetectionSource[];
  roles: UploadRoleSpec[];
  answers?: Record<string, string>;
}): { context: UploadContext; preparedInputs: PreparedRoleInput[] } {
  const engine = new LocalDataEngine();
  const parsed = input.sources.map((source) => ({
    source,
    workbook: engine.parseFile(source.bytes, source.fileName),
  }));
  const files = parsed.map(({ source, workbook }) => ({
    fileId: source.fileId,
    fileName: source.fileName,
    sheets: workbook.sheets.map((sheet) => sheet.name),
  }));
  const detectedFields: DetectedFieldSet[] = parsed.flatMap(({ source, workbook }) =>
    workbook.sheets.map((sheet) => ({
      fileId: source.fileId,
      fileName: source.fileName,
      sheetName: sheet.name,
      fields: sheet.headers,
      rowCount: sheet.rows.length,
    })),
  );

  const matchedTemplates: MatchedUploadTemplate[] = [];
  const preparedInputs: PreparedRoleInput[] = [];
  const clarifications: UploadClarification[] = [];

  for (const spec of input.roles) {
    const candidates = parsed
      .flatMap(({ source, workbook }) =>
        workbook.sheets.map((sheet) => roleCandidate(source, sheet, spec)),
      )
      .filter((candidate) => candidate.detectedFields.length > 0)
      .sort((a, b) => b.confidence - a.confidence || a.missingFields.length - b.missingFields.length);
    const answerKey = `role:${spec.role}`;
    const selected = input.answers?.[answerKey]
      ? candidates.find((candidate) => candidateKey(candidate) === input.answers?.[answerKey])
      : candidates[0];
    if (!selected) continue;

    const runnerUp = candidates[1];
    const ambiguous =
      !input.answers?.[answerKey] &&
      runnerUp &&
      selected.confidence >= 0.5 &&
      runnerUp.confidence >= 0.5 &&
      selected.confidence - runnerUp.confidence <= 0.08 &&
      candidateKey(selected) !== candidateKey(runnerUp);
    if (ambiguous && clarifications.length < 2) {
      clarifications.push({
        id: answerKey,
        role: spec.role,
        question: `“${selected.fileName} / ${selected.sheetName}”和“${runnerUp.fileName} / ${runnerUp.sheetName}”都可能是${spec.description}，应使用哪一份？`,
        candidates: [selected, runnerUp].map((candidate) => ({
          fileId: candidate.fileId,
          fileName: candidate.fileName,
          sheetName: candidate.sheetName,
          confidence: candidate.confidence,
        })),
      });
    }

    matchedTemplates.push(selected);
    preparedInputs.push({
      role: spec.role,
      fileId: selected.fileId,
      sourceFileName: selected.fileName,
      sheetName: selected.sheetName,
      confidence: selected.confidence,
      bytes: normalizedWorkbookBytes(selected.sheet, selected.aliases),
    });
  }

  const requiredMatches = input.roles
    .filter((role) => role.required)
    .map((role) => matchedTemplates.find((match) => match.role === role.role)?.confidence ?? 0);
  const confidence = requiredMatches.length
    ? Number((requiredMatches.reduce((sum, value) => sum + value, 0) / requiredMatches.length).toFixed(2))
    : 0;

  return {
    context: { files, detectedFields, matchedTemplates, confidence, clarifications },
    preparedInputs,
  };
}

export function uploadCandidateKey(candidate: { fileId: string; sheetName: string }): string {
  return candidateKey(candidate);
}

export type { DataRow };
