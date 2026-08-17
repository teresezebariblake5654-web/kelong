import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';
import type { DataRow } from '../../types.js';

export type ResultSheet = {
  name: string;
  rows: DataRow[];
};

export type ExportWorkbookInput = {
  outputDir: string;
  fileName: string;
  sheets: ResultSheet[];
  freezeHeader?: boolean;
  autoFilter?: boolean;
};

export type CapturedOutputArtifact = {
  fileName: string;
  path: string;
  bytes: Uint8Array;
};

type OutputCaptureSink = (artifact: CapturedOutputArtifact) => void;

let outputCaptureSink: OutputCaptureSink | null = null;

/** Used by browser / desktop bridges to collect XLSX bytes without relying on real disk writes. */
export function setOutputCaptureSink(sink: OutputCaptureSink | null): void {
  outputCaptureSink = sink;
}

export function renderFileNameTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

function buildWorkbookBuffer(input: ExportWorkbookInput): Uint8Array {
  const workbook = XLSX.utils.book_new();

  for (const sheet of input.sheets) {
    const safeName = sheet.name.slice(0, 31) || 'Sheet';
    const worksheet =
      sheet.rows.length > 0
        ? XLSX.utils.json_to_sheet(sheet.rows)
        : XLSX.utils.aoa_to_sheet([['（本日无记录）']]);

    if (input.freezeHeader !== false) {
      worksheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
    }
    if (input.autoFilter !== false && sheet.rows.length > 0) {
      const headers = Object.keys(sheet.rows[0] ?? {});
      if (headers.length > 0) {
        worksheet['!autofilter'] = {
          ref: XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: sheet.rows.length, c: headers.length - 1 },
          }),
        };
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

export function exportResultWorkbook(input: ExportWorkbookInput): string {
  const bytes = buildWorkbookBuffer(input);
  const fullPath = join(input.outputDir, input.fileName);

  if (outputCaptureSink) {
    const memoryPath = `memory://${input.fileName}`;
    outputCaptureSink({ fileName: input.fileName, path: memoryPath, bytes });
    try {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, bytes);
      return fullPath;
    } catch {
      return memoryPath;
    }
  }

  mkdirSync(input.outputDir, { recursive: true });
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, bytes);
  return fullPath;
}
