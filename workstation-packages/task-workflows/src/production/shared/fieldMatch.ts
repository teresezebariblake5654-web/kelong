/** 轻量表头匹配（各工作流字段字典复用） */
export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-　]/g, '')
    .replace(/（.*?）|\(.*?\)/g, '');
}

export function matchHeader(
  headers: string[],
  aliases: string[],
): string | null {
  const normalizedAliases = aliases.map(normalizeHeader);
  // 1) 精确匹配优先，避免「产量」误命中「计划产量」
  for (const header of headers) {
    const n = normalizeHeader(header);
    if (normalizedAliases.some((a) => a === n)) return header;
  }
  // 2) 再做包含匹配（别名较长者优先，减少短词误伤）
  const ordered = [...normalizedAliases].sort((a, b) => b.length - a.length);
  for (const alias of ordered) {
    if (alias.length < 2) continue;
    for (const header of headers) {
      const n = normalizeHeader(header);
      if (n === alias) return header;
      if (alias.length >= 3 && (n.includes(alias) || alias.includes(n))) return header;
    }
  }
  return null;
}

export function num(row: Record<string, unknown>, header: string | null): number {
  if (!header) return 0;
  const raw = row[header];
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function str(row: Record<string, unknown>, header: string | null): string {
  if (!header) return '';
  return String(row[header] ?? '').trim();
}

export function pickSheet(
  workbook: { fileName: string; sheets: Array<{ sheetName: string; headers: string[]; rows: Array<Record<string, unknown>> }> },
  preferKeywords: string[],
) {
  let best = workbook.sheets[0];
  let bestScore = -1;
  for (const sheet of workbook.sheets) {
    const text = `${workbook.fileName} ${sheet.sheetName} ${sheet.headers.join(' ')}`;
    let score = 0;
    for (const kw of preferKeywords) {
      if (text.includes(kw)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sheet;
    }
  }
  return best ?? { sheetName: 'Sheet1', headers: [] as string[], rows: [] as Array<Record<string, unknown>> };
}
