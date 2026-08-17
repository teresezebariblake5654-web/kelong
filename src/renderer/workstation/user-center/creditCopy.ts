/** User-facing product name for App credits (not Token / RMB / 1701). */
export const CREDIT_DISPLAY_NAME = 'AI积分';
export const CREDIT_DISPLAY_NAME_SPACED = 'AI 积分';

export const CREDIT_USAGE_EXPLAINER =
  'AI 积分用于使用智能对话、Agent 任务和文件处理等功能。不同功能会根据模型用量和任务复杂度消耗不同积分。';

export const CREDIT_LOW_BALANCE_HINT = 'AI 积分余额较低，建议及时补充。';
export const CREDIT_INSUFFICIENT_HINT = 'AI 积分不足，请购买积分后继续使用。';

export function formatCreditNumber(value: string | number): string {
  const raw = String(value ?? '0').trim() || '0';
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const [intPart, frac] = body.split('.');
  const grouped = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = frac != null && frac.length ? `${grouped}.${frac}` : grouped;
  return neg ? `-${out}` : out;
}

export function withCreditUnit(value: string | number): string {
  return `${formatCreditNumber(value)} ${CREDIT_DISPLAY_NAME_SPACED}`;
}

/** Append backend finalCost line once (idempotent for same content). */
export function appendAiPointsCostLine(
  content: string,
  finalCost: number | null | undefined,
): string {
  if (finalCost == null || !Number.isFinite(finalCost) || finalCost < 0) return content;
  if (/本次消耗：[\d,]+\s*AI\s*积分/.test(content)) return content;
  const line = `本次消耗：${finalCost} ${CREDIT_DISPLAY_NAME_SPACED}`;
  const base = content.trimEnd();
  return base ? `${base}\n\n${line}` : line;
}
