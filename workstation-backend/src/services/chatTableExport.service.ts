import * as XLSX from 'xlsx';
import { z } from 'zod';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const workbookSchema = z.object({
  fileName: z.string().trim().min(1).max(80),
  sheets: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(31),
        headers: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
        rows: z.array(z.array(cellSchema).max(50)).max(5_000),
      }),
    )
    .min(1)
    .max(10),
});

export type ExportedChatTable = {
  fileName: string;
  buffer: Buffer;
};

type ParsedMarkdownTable = {
  headers: string[];
  rows: Array<Array<string | number | boolean | null>>;
};

function safeFileName(value: string): string {
  const base = value
    .replace(/\.xlsx$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 70);
  return `${base || 'AI整理表格'}.xlsx`;
}

function uniqueSheetName(rawName: string, used: Set<string>): string {
  const base = rawName.replace(/[:\\/?*\[\]]/g, '_').trim().slice(0, 31) || '表格';
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    const tail = `_${suffix}`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function coerceCell(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (!value || value === '-' || value === '—' || value === '–') return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  const normalized = value.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const num = Number(normalized);
    if (Number.isFinite(num)) return num;
  }
  return value;
}

/**
 * Extract only GitHub-style Markdown tables from content.
 * Prose / lists / code outside `|...|` blocks are ignored.
 */
export function extractMarkdownTables(content: string): ParsedMarkdownTable[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const tables: ParsedMarkdownTable[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!(trimmed.startsWith('|') && trimmed.includes('|'))) {
      i += 1;
      continue;
    }

    const block: string[] = [];
    while (i < lines.length) {
      const current = (lines[i] ?? '').trim();
      if (!(current.startsWith('|') && current.includes('|'))) break;
      block.push(current);
      i += 1;
    }

    if (block.length < 2) continue;

    const headerCells = splitMarkdownRow(block[0]!);
    const separatorCells = splitMarkdownRow(block[1]!);
    if (!headerCells.length || !isSeparatorRow(separatorCells)) continue;

    const colCount = headerCells.length;
    const headers = headerCells.map((cell, index) => cell || `列${index + 1}`);
    const rows: ParsedMarkdownTable['rows'] = [];

    for (const rowLine of block.slice(2)) {
      const cells = splitMarkdownRow(rowLine);
      if (!cells.length || isSeparatorRow(cells)) continue;
      const padded = Array.from({ length: colCount }, (_, index) => coerceCell(cells[index] ?? ''));
      // Skip fully empty rows
      if (padded.every((cell) => cell === null || cell === '')) continue;
      rows.push(padded);
    }

    if (!rows.length) continue;
    tables.push({ headers, rows });
  }

  return tables;
}

function buildWorkbookFromMarkdownTables(tables: ParsedMarkdownTable[]): z.infer<typeof workbookSchema> {
  const sheets = tables.slice(0, 10).map((table, index) => ({
    name: tables.length === 1 ? '表格' : `表格${index + 1}`,
    headers: table.headers,
    rows: table.rows,
  }));

  const firstHeader = sheets[0]?.headers[0] || '表格';
  return {
    fileName: safeFileName(`${firstHeader}导出`),
    sheets,
  };
}

export function createWorkbookBuffer(input: z.infer<typeof workbookSchema>): Buffer {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const sheet of input.sheets) {
    const rows = sheet.rows.map((row) =>
      Array.from({ length: sheet.headers.length }, (_, index) => row[index] ?? null),
    );
    const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...rows]);
    worksheet['!cols'] = sheet.headers.map((header, columnIndex) => {
      const contentWidth = rows.reduce(
        (width, row) => Math.max(width, String(row[columnIndex] ?? '').length),
        header.length,
      );
      return { wch: Math.min(Math.max(contentWidth + 2, 10), 40) };
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, uniqueSheetName(sheet.name, usedNames));
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function ensureOwnedConversation(
  conversationId: string,
  organizationId: string,
  userId: string,
) {
  const conversation = await prisma.chatConversation.upsert({
    where: { id: conversationId },
    create: {
      id: conversationId,
      organizationId,
      ownerId: userId,
      agentCode: 'general',
      title: '表格导出',
    },
    update: {},
  });
  if (conversation.organizationId !== organizationId || conversation.ownerId !== userId) {
    throw new AppError(404, '会话不存在或无权访问', 'NOT_FOUND');
  }
}

export const chatTableExportService = {
  async exportMessage(input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    content: string;
  }): Promise<ExportedChatTable> {
    await ensureOwnedConversation(input.conversationId, input.organizationId, input.userId);

    // Only Markdown pipe-tables are exported — ignore prose / bullets outside tables.
    const tables = extractMarkdownTables(input.content);
    if (!tables.length) {
      throw new AppError(
        400,
        '未找到可导出的 Markdown 表格（以 | 开头的表格）。表格外的文字不会整理进 Excel。',
        'NO_MARKDOWN_TABLE',
      );
    }

    const workbook = buildWorkbookFromMarkdownTables(tables);
    const parsed = workbookSchema.safeParse(workbook);
    if (!parsed.success) {
      throw new AppError(502, '表格结构无效，请重试', 'INVALID_TABLE_STRUCTURE');
    }

    const fileName = safeFileName(parsed.data.fileName);
    const buffer = createWorkbookBuffer(parsed.data);
    return { fileName, buffer };
  },
};
