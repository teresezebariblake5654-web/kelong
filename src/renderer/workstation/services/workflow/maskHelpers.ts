/** Tiny local helper to avoid importing data-engine field utils into mask module cycles. */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}
