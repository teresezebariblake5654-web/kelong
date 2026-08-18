/**
 * Deterministic contact extraction from Firecrawl markdown/text.
 * No LLM. No invented values. Optional page provenance via sourceUrl.
 */

import {
  extractPhonesFromText,
  isPlaceholderEmail,
} from './lead-phone.service';

const EMAIL_RE =
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

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

function uniqueByDigitsOrValue(items: ContactWithSource[], kind: 'phone' | 'other'): ContactWithSource[] {
  const seen = new Set<string>();
  const out: ContactWithSource[] = [];
  for (const item of items) {
    const key =
      kind === 'phone' ? item.value.replace(/\D/g, '') : item.value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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

  const emails = uniqueByDigitsOrValue(
    (source.match(EMAIL_RE) || [])
      .map((e) => e.trim())
      .filter((e) => !isPlaceholderEmail(e))
      .map((e) => withSource(e, sourceUrl)),
    'other',
  );

  const phones = extractPhonesFromText(source, sourceUrl);

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
    phones,
    linkedin: uniqueByDigitsOrValue(linkedin, 'other'),
    facebook: uniqueByDigitsOrValue(facebook, 'other'),
    instagram: uniqueByDigitsOrValue(instagram, 'other'),
  };
}

/** Merge page extractions; first provenance wins on duplicate values. */
export function mergeExtractedContacts(parts: ExtractedContacts[]): ExtractedContacts {
  return {
    emails: uniqueByDigitsOrValue(parts.flatMap((p) => p.emails), 'other'),
    phones: uniqueByDigitsOrValue(parts.flatMap((p) => p.phones), 'phone'),
    linkedin: uniqueByDigitsOrValue(parts.flatMap((p) => p.linkedin), 'other'),
    facebook: uniqueByDigitsOrValue(parts.flatMap((p) => p.facebook), 'other'),
    instagram: uniqueByDigitsOrValue(parts.flatMap((p) => p.instagram), 'other'),
  };
}

export const leadNormalizerService = {
  extractContactsFromText,
  mergeExtractedContacts,
};
