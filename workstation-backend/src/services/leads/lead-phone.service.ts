/**
 * Conservative phone / placeholder-email extraction.
 * Prefers fewer real numbers over noisy IDs, dates, and version strings.
 */
import type { ContactWithSource } from './lead-normalizer.service';

const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 15;

const PHONE_CANDIDATE_RE =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g;

const PLACEHOLDER_EMAILS = new Set([
  'example@example.com',
  'email@example.com',
  'name@example.com',
  'test@example.com',
  'user@example.com',
  'yourname@example.com',
  'you@example.com',
  'test@test.com',
  'user@domain.com',
  'email@email.com',
  'name@email.com',
  'foo@bar.com',
  'foo@localhost',
]);

function stripNoisyContext(text: string): string {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/[^\s<>"'`)\]]+/gi, ' ')
    .replace(/\b(?:rgb|rgba|hsl|hsla)\([^)]+\)/gi, ' ')
    .replace(/#[0-9a-f]{3,8}\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|pt|%)\b/gi, ' ')
    .replace(/\b(?:width|height|padding|margin|font-size|z-index)\s*[:=]\s*[^;}\n]+/gi, ' ')
    .replace(/\bv?\d+\.\d+(?:\.\d+)+\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/g, ' ')
    .replace(/\b(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:19|20)\d{12,}\b/g, ' ');
}

export function normalizePhoneDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

export function normalizePhoneDisplay(raw: string): string | null {
  const trimmed = raw.trim().replace(/[^\d+()\s.-]/g, '');
  const digits = normalizePhoneDigits(trimmed);
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;
  if (/^(19|20)\d{2}$/.test(digits)) return null;
  if (/^0+$/.test(digits) || /^(\d)\1{6,}$/.test(digits)) return null;
  const plus = trimmed.trim().startsWith('+');
  if (plus) return `+${digits}`;
  return digits;
}

export function isLikelyGarbagePhone(raw: string, digits: string): boolean {
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return true;
  if (/^(19|20)\d{6,}$/.test(digits) && digits.length <= 12) return true;
  if (/\b(?:unix|epoch|timestamp|version|build|sku|id)\b/i.test(raw)) return true;
  if (/\bv?\d+\.\d+(?:\.\d+)+\b/i.test(raw)) return true;
  if (/(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(raw)) return true;
  // Long unbroken digit strings without separators are usually IDs, not phones.
  if (!/[+\s().-]/.test(raw) && digits.length >= 12) return true;
  return false;
}

export function extractPhonesFromText(text: string, sourceUrl?: string): ContactWithSource[] {
  const cleaned = stripNoisyContext(text);
  const seen = new Set<string>();
  const out: ContactWithSource[] = [];
  const matches = cleaned.match(PHONE_CANDIDATE_RE) || [];
  for (const raw of matches) {
    const display = normalizePhoneDisplay(raw);
    if (!display) continue;
    const digits = normalizePhoneDigits(display);
    if (isLikelyGarbagePhone(raw, digits)) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(sourceUrl ? { value: display, sourceUrl } : { value: display });
  }
  return out;
}

export function isPlaceholderEmail(email: string): boolean {
  const n = email.trim().toLowerCase();
  if (PLACEHOLDER_EMAILS.has(n)) return true;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(n)) return true;
  if (/\.(png|jpe?g|gif|webp|svg|css|js)@/i.test(n)) return true;
  if (/@(localhost|local|invalid)$/i.test(n)) return true;
  if (/^(noreply|no-reply|donotreply)@/i.test(n)) return false;
  return /@example\.(com|org|net)$/i.test(n) || /@test\.(com|org|net)$/i.test(n);
}

export const leadPhoneService = {
  extractPhonesFromText,
  normalizePhoneDisplay,
  normalizePhoneDigits,
  isPlaceholderEmail,
};
