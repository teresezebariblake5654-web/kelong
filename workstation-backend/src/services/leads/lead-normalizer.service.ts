/**
 * Deterministic contact extraction from Firecrawl markdown/text.
 * No LLM. No invented values. Optional page provenance via sourceUrl.
 */

const EMAIL_RE =
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/g;

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

export type ContactWithSource = {
  value: string;
  sourceUrl?: string;
};

export type ExtractedContacts = {
  emails: ContactWithSource[];
  phones: ContactWithSource[];
  linkedin: ContactWithSource[];
  facebook: ContactWithSource[];
  instagram: ContactWithSource[];
};

function uniqueByValue(items: ContactWithSource[]): ContactWithSource[] {
  const seen = new Set<string>();
  const out: ContactWithSource[] = [];
  for (const item of items) {
    const key = item.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isLikelyPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^(19|20)\d{2}$/.test(digits)) return false;
  return true;
}

function cleanUrl(raw: string): string | null {
  try {
    const trimmed = raw.replace(/[.,;:!?)]+$/, '');
    const u = new URL(trimmed);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function withSource(value: string, sourceUrl?: string): ContactWithSource {
  return sourceUrl ? { value, sourceUrl } : { value };
}

export function extractContactsFromText(
  text: string,
  sourceUrl?: string,
): ExtractedContacts {
  const source = text || '';

  const emails = uniqueByValue(
    (source.match(EMAIL_RE) || [])
      .map((e) => e.trim())
      .filter((e) => !e.toLowerCase().endsWith('.png') && !e.toLowerCase().endsWith('.jpg'))
      .map((e) => withSource(e, sourceUrl)),
  );

  const phones = uniqueByValue(
    (source.match(PHONE_RE) || [])
      .map((p) => p.trim())
      .filter(isLikelyPhone)
      .map((p) => withSource(p, sourceUrl)),
  );

  const urls = (source.match(URL_RE) || [])
    .map(cleanUrl)
    .filter((u): u is string => !!u);

  const linkedin: ContactWithSource[] = [];
  const facebook: ContactWithSource[] = [];
  const instagram: ContactWithSource[] = [];

  for (const url of urls) {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (host.includes('linkedin.com')) linkedin.push(withSource(url, sourceUrl));
    else if (host.includes('facebook.com') || host === 'fb.com' || host.endsWith('.fb.com')) {
      facebook.push(withSource(url, sourceUrl));
    } else if (host.includes('instagram.com')) {
      instagram.push(withSource(url, sourceUrl));
    }
  }

  return {
    emails,
    phones: uniqueByValue(phones),
    linkedin: uniqueByValue(linkedin),
    facebook: uniqueByValue(facebook),
    instagram: uniqueByValue(instagram),
  };
}

/** Merge page extractions; first provenance wins on duplicate values. */
export function mergeExtractedContacts(parts: ExtractedContacts[]): ExtractedContacts {
  return {
    emails: uniqueByValue(parts.flatMap((p) => p.emails)),
    phones: uniqueByValue(parts.flatMap((p) => p.phones)),
    linkedin: uniqueByValue(parts.flatMap((p) => p.linkedin)),
    facebook: uniqueByValue(parts.flatMap((p) => p.facebook)),
    instagram: uniqueByValue(parts.flatMap((p) => p.instagram)),
  };
}

export const leadNormalizerService = {
  extractContactsFromText,
  mergeExtractedContacts,
};
