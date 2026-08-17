/** 确定性数量解析：空值 / 数字字符串 / 千分位 / 正负号；禁止 AI 参与 */

export function parseQuantity(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

  let text = String(value)
    .trim()
    .replace(/,/g, '')
    .replace(/，/g, '')
    .replace(/\s+/g, '')
    .replace(/[￥¥$€]/g, '');

  // 全角数字与符号
  text = text.replace(/[０-９＋－．]/g, (ch) => {
    const map: Record<string, string> = {
      '０': '0',
      '１': '1',
      '２': '2',
      '３': '3',
      '４': '4',
      '５': '5',
      '６': '6',
      '７': '7',
      '８': '8',
      '９': '9',
      '＋': '+',
      '－': '-',
      '．': '.',
    };
    return map[ch] ?? ch;
  });

  if (!text) return fallback;
  if (text === '-' || text === '+' || text === '.') return fallback;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseNullableQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseQuantity(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundQty(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function nearlyEqual(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}
