/**
 * Deterministic research-priority ranking. Not an ICP score.
 */
import { isDirectoryLikely } from '../lead-discovery.service';
import { normalizeLeadDomain } from '../lead-persistence.service';
import type { AgentCandidate, PlanInterpretation } from './acquisition-agent.types';

const DIRECTORY_HOST_RE =
  /\b(ensun\.io|europages|kompass|thomasnet|yellowpages|yelp\.com|zoominfo|dnb\.com|owler|crunchbase)\b/i;
const NEWS_RE =
  /\b(news|article|blog|press[- ]?release|medium\.com|reuters|bloomberg)\b/i;
const SOCIAL_RE =
  /\b(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com)\b/i;
const MARKETPLACE_RE =
  /\b(alibaba|amazon\.|indiamart|made-in-china|globalsources|ebay\.|shopify)\b/i;
const JOB_RE = /\b(indeed\.|glassdoor|lever\.co|greenhouse\.io|linkedin\.com\/jobs|job[- ]?board)\b/i;
const BUSINESS_TERM_RE =
  /\b(distributor|distributors|supplier|suppliers|importer|importers|dealer|dealers|wholesaler|wholesale)\b/i;

function blob(candidate: AgentCandidate): string {
  return `${candidate.title}\n${candidate.snippet}\n${candidate.normalizedDomain}\n${candidate.website}`.toLowerCase();
}

export function isDeprioritizedDiscoveryHost(domain: string): boolean {
  const d = normalizeLeadDomain(domain);
  return (
    DIRECTORY_HOST_RE.test(d) ||
    SOCIAL_RE.test(d) ||
    MARKETPLACE_RE.test(d) ||
    JOB_RE.test(d)
  );
}

export function scoreAcquisitionCandidate(
  candidate: AgentCandidate,
  interpretation?: PlanInterpretation,
): number {
  const text = blob(candidate);
  let score = 0;

  if (BUSINESS_TERM_RE.test(text)) score += 8;

  const keywords = [
    ...(interpretation?.industries ?? []),
    ...(interpretation?.productKeywords ?? []),
    ...(interpretation?.businessTypes ?? []),
  ];
  for (const kw of keywords) {
    const needle = kw.trim().toLowerCase();
    if (needle && text.includes(needle)) score += 4;
  }
  for (const kw of interpretation?.locationKeywords ?? []) {
    const needle = kw.trim().toLowerCase();
    if (needle && text.includes(needle)) score += 5;
  }

  const primaryUrl = candidate.provenances[0]?.url || candidate.website;
  try {
    const path = new URL(primaryUrl).pathname.replace(/\/+$/, '') || '/';
    if (path === '/') score += 4;
  } catch {
    // ignore
  }

  const hit = {
    title: candidate.title,
    url: primaryUrl,
    domain: candidate.normalizedDomain,
    description: candidate.snippet,
    engine: candidate.provenances[0]?.engine || 'searxng',
  };
  if (candidate.candidateKind === 'directory_likely' || isDirectoryLikely(hit)) {
    score -= 25;
  }
  if (DIRECTORY_HOST_RE.test(text) || DIRECTORY_HOST_RE.test(candidate.normalizedDomain)) {
    score -= 20;
  }
  if (NEWS_RE.test(text)) score -= 15;
  if (SOCIAL_RE.test(text)) score -= 12;
  if (MARKETPLACE_RE.test(text)) score -= 12;
  if (JOB_RE.test(text)) score -= 15;

  return score;
}

export function rankAcquisitionCandidates(
  candidates: AgentCandidate[],
  interpretation?: PlanInterpretation,
): AgentCandidate[] {
  return [...candidates].sort((a, b) => {
    const delta = scoreAcquisitionCandidate(b, interpretation) - scoreAcquisitionCandidate(a, interpretation);
    if (delta !== 0) return delta;
    const aDir = a.candidateKind === 'directory_likely' ? 1 : 0;
    const bDir = b.candidateKind === 'directory_likely' ? 1 : 0;
    return aDir - bDir;
  });
}
