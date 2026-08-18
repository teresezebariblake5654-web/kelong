/**
 * ICP scoring for LeadCompany within a LeadSearchTask.
 * Reuses OpenAICompatible chat client from src/providers/llm (no ad-hoc SDK / keys).
 * overallScore / grade / contactabilityScore are computed locally — never trusted from LLM.
 */

import type { LeadCompany, LeadContact, LeadScoreGrade, LeadSourceRecord } from '@prisma/client';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import {
  extractJsonObject,
  getActiveLlmModel,
  getOpenAICompatibleChatClient,
} from '../../providers/llm';
import { withProviderRetry } from '../../providers/lead-engines/provider-retry';
import { AppError } from '../../utils/errors';
import {
  MAX_COMPANIES_PER_TASK_SCORE,
  SCORE_WEIGHTS,
  SCORING_VERSION,
  llmSemanticScoreSchema,
  type ContactabilityInput,
  type LlmSemanticScore,
  type ScoreCompanyResult,
  type ScoreTaskResult,
} from './lead-score.types';

export type LeadScoreLlmCall = (input: {
  systemPrompt: string;
  structuredData: Record<string, unknown>;
  model: string;
  maxOutputTokens: number;
}) => Promise<{
  output: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}>;

const ICP_SYSTEM_PROMPT = `You are a B2B ICP qualification engine.

Your job is NOT to recommend companies.
Your job is to score how well an already-discovered company matches the user's search goal,
using ONLY the evidence provided.

Rules:
- Use only provided evidence. Do not invent business facts.
- If evidence is weak or missing, set insufficientEvidence=true and keep scores conservative/low.
- Directory / listing / media / association / research-database sites must NOT be scored as target distributors/buyers just because they mention keywords or list many companies.
- Distinguish carefully among: distributor, importer, manufacturer, directory, marketplace, media, association, unrelated company.
- Location mismatches (e.g. Japan company for Saudi Arabia search) must lower locationScore substantially.
- Business-type mismatches (manufacturer vs distributor; directory vs dealer) must lower businessTypeScore substantially.
- Return ONLY a JSON object with these keys:
  industryScore, locationScore, businessTypeScore, productFitScore, companyFitScore (integers 0-100),
  reasoning { industry, location, businessType, productFit, companyFit },
  evidence [ { claim, sourceUrl? } ],
  insufficientEvidence (boolean).
- Do NOT return overallScore, grade, or contactabilityScore.`;

export function computeContactabilityScore(input: ContactabilityInput): number {
  const scores: number[] = [];
  if (input.hasVerifiedEmail) scores.push(100);
  if (input.hasUnverifiedEmail) scores.push(80);
  if (input.hasPhone) scores.push(60);
  if (input.hasSocial) scores.push(40);
  if (input.hasWebsite) scores.push(20);
  if (scores.length === 0) return 0;
  return Math.max(...scores);
}

export function computeOverallScore(parts: {
  industryScore: number;
  locationScore: number;
  businessTypeScore: number;
  productFitScore: number;
  companyFitScore: number;
  contactabilityScore: number;
}): number {
  const raw =
    parts.industryScore * SCORE_WEIGHTS.industry +
    parts.locationScore * SCORE_WEIGHTS.location +
    parts.businessTypeScore * SCORE_WEIGHTS.businessType +
    parts.productFitScore * SCORE_WEIGHTS.productFit +
    parts.companyFitScore * SCORE_WEIGHTS.companyFit +
    parts.contactabilityScore * SCORE_WEIGHTS.contactability;
  return Math.round(raw);
}

export function gradeFromOverallScore(overallScore: number): LeadScoreGrade {
  if (overallScore >= 90) return 'A';
  if (overallScore >= 75) return 'B';
  if (overallScore >= 60) return 'C';
  return 'D';
}

export function parseLlmSemanticScore(output: unknown): LlmSemanticScore {
  const parsed = llmSemanticScoreSchema.safeParse(output);
  if (!parsed.success) {
    throw new AppError(
      502,
      `ICP LLM output failed schema validation: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.message)
        .join('; ')}`,
      'ICP_LLM_INVALID_OUTPUT',
    );
  }
  return parsed.data;
}

function isVerifiedEmail(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'valid' || s === 'verified' || s.includes('valid');
}

export function buildContactabilityInput(params: {
  contacts: LeadContact[];
  company: LeadCompany;
}): ContactabilityInput {
  const { contacts, company } = params;
  const hasVerifiedEmail = contacts.some(
    (c) => !!c.emailNormalized && isVerifiedEmail(c.emailVerificationStatus),
  );
  const hasUnverifiedEmail = contacts.some(
    (c) => !!c.emailNormalized && !isVerifiedEmail(c.emailVerificationStatus),
  );
  const meta =
    company.metadata && typeof company.metadata === 'object'
      ? (company.metadata as Record<string, unknown>)
      : {};
  const discoveredPhones = Array.isArray(meta.discoveredPhones) ? meta.discoveredPhones : [];
  const hasPhone = contacts.some((c) => !!c.phone?.trim()) || discoveredPhones.length > 0;
  const hasSocial = Boolean(
    company.linkedinUrl ||
      company.facebookUrl ||
      company.instagramUrl ||
      contacts.some((c) => c.linkedinUrl || c.facebookUrl || c.instagramUrl),
  );
  const hasWebsite = Boolean(company.website?.trim());
  return {
    hasVerifiedEmail,
    hasUnverifiedEmail,
    hasPhone,
    hasSocial,
    hasWebsite,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function buildEvidencePayload(params: {
  prompt: string;
  company: LeadCompany;
  contacts: LeadContact[];
  sources: LeadSourceRecord[];
}) {
  const { prompt, company, contacts, sources } = params;
  const meta = asObject(company.metadata);

  const searchEvidence = sources
    .filter((s) => s.provider === 'SEARXNG' && s.sourceType === 'WEB_SEARCH')
    .map((s) => {
      const raw = asObject(s.rawData);
      return {
        sourceUrl: s.sourceUrl,
        title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : null,
        description:
          typeof raw.description === 'string' ? raw.description.slice(0, 500) : null,
        engine: typeof raw.engine === 'string' ? raw.engine : null,
        candidateKind: typeof raw.candidateKind === 'string' ? raw.candidateKind : null,
      };
    });

  const websiteEvidence = sources
    .filter((s) => s.provider === 'FIRECRAWL' && s.sourceType === 'WEBSITE_RESEARCH')
    .map((s) => {
      const raw = asObject(s.rawData);
      return {
        sourceUrl: s.sourceUrl,
        title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : null,
        emailCount: typeof raw.emailCount === 'number' ? raw.emailCount : null,
        phoneCount: typeof raw.phoneCount === 'number' ? raw.phoneCount : null,
        socialCount: typeof raw.socialCount === 'number' ? raw.socialCount : null,
      };
    });

  return {
    searchGoal: prompt,
    company: {
      domain: company.domain,
      website: company.website,
      name: company.name,
      country: company.country,
      city: company.city,
      industry: company.industry,
      description: company.description,
      candidateKind: meta.candidateKind ?? null,
      leadStage: meta.leadStage ?? null,
      qualification: meta.qualification ?? null,
      linkedinUrl: company.linkedinUrl,
      facebookUrl: company.facebookUrl,
      instagramUrl: company.instagramUrl,
    },
    contactsSummary: {
      emailCount: contacts.filter((c) => c.emailNormalized).length,
      hasVerifiedEmail: contacts.some(
        (c) => c.emailNormalized && isVerifiedEmail(c.emailVerificationStatus),
      ),
      phoneCount:
        contacts.filter((c) => c.phone).length +
        (Array.isArray(meta.discoveredPhones) ? meta.discoveredPhones.length : 0),
      socialCount: [
        company.linkedinUrl,
        company.facebookUrl,
        company.instagramUrl,
      ].filter(Boolean).length,
    },
    searchEvidence,
    websiteEvidence,
    directoryHint:
      meta.candidateKind === 'directory_likely' ||
      /directory|listing|catalog|guide|ensun|pharmchoices|meddeviceguide/i.test(
        `${company.domain} ${String(meta.searchTitle ?? '')}`,
      ),
  };
}

async function defaultLlmCall(input: {
  systemPrompt: string;
  structuredData: Record<string, unknown>;
  model: string;
  maxOutputTokens: number;
}): Promise<{
  output: unknown;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  return withProviderRetry({
    provider: 'llm',
    op: 'icp_score',
    fn: async () => {
      const client = getOpenAICompatibleChatClient();
      const result = await client.chat({
        systemPrompt: input.systemPrompt,
        userPrompt: JSON.stringify(input.structuredData),
        model: input.model,
        maxOutputTokens: input.maxOutputTokens,
        temperature: 0.1,
        jsonMode: true,
      });
      let output: unknown;
      try {
        output = extractJsonObject(result.content);
      } catch (err) {
        throw new AppError(
          502,
          err instanceof Error ? err.message : 'Invalid LLM JSON',
          'ICP_LLM_INVALID_JSON',
        );
      }
      return {
        output,
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    },
  });
}

export type ScoreCompanyForTaskInput = {
  organizationId: string;
  searchTaskId: string;
  companyId: string;
  /** Optional injectable LLM for tests. */
  llmCall?: LeadScoreLlmCall;
};

/**
 * Score one company for a search task and upsert LeadScore.
 * Does not write a fake 0-score on LLM failure.
 */
export async function scoreCompanyForTask(
  input: ScoreCompanyForTaskInput,
): Promise<ScoreCompanyResult> {
  const task = await prisma.leadSearchTask.findUnique({
    where: { id: input.searchTaskId },
  });
  if (!task) {
    throw new AppError(404, 'SearchTask 不存在', 'SEARCH_TASK_NOT_FOUND');
  }
  if (task.organizationId !== input.organizationId) {
    throw new AppError(403, '无权访问该 SearchTask', 'ORGANIZATION_MISMATCH');
  }

  const company = await prisma.leadCompany.findUnique({
    where: { id: input.companyId },
  });
  if (!company) {
    throw new AppError(404, 'Company 不存在', 'COMPANY_NOT_FOUND');
  }
  if (company.organizationId !== input.organizationId) {
    throw new AppError(403, '无权访问该 Company', 'ORGANIZATION_MISMATCH');
  }

  const [contacts, sources] = await Promise.all([
    prisma.leadContact.findMany({
      where: { organizationId: input.organizationId, companyId: company.id },
    }),
    prisma.leadSourceRecord.findMany({
      where: {
        organizationId: input.organizationId,
        companyId: company.id,
        OR: [{ searchTaskId: input.searchTaskId }, { searchTaskId: null }],
      },
      orderBy: { retrievedAt: 'desc' },
      take: 30,
    }),
  ]);

  const structuredData = buildEvidencePayload({
    prompt: task.prompt,
    company,
    contacts,
    sources,
  });

  const model = getActiveLlmModel();
  const llmCall = input.llmCall ?? defaultLlmCall;
  const llmResult = await llmCall({
    systemPrompt: ICP_SYSTEM_PROMPT,
    structuredData,
    model,
    maxOutputTokens: Math.min(env.aiMaxOutputTokens || 2000, 2000),
  });

  const semantic = parseLlmSemanticScore(llmResult.output);
  const contactabilityScore = computeContactabilityScore(
    buildContactabilityInput({ contacts, company }),
  );
  const overallScore = computeOverallScore({
    industryScore: semantic.industryScore,
    locationScore: semantic.locationScore,
    businessTypeScore: semantic.businessTypeScore,
    productFitScore: semantic.productFitScore,
    companyFitScore: semantic.companyFitScore,
    contactabilityScore,
  });
  const grade = gradeFromOverallScore(overallScore);

  const row = await prisma.leadScore.upsert({
    where: {
      searchTaskId_companyId: {
        searchTaskId: input.searchTaskId,
        companyId: company.id,
      },
    },
    create: {
      organizationId: input.organizationId,
      searchTaskId: input.searchTaskId,
      companyId: company.id,
      overallScore,
      grade,
      industryScore: semantic.industryScore,
      locationScore: semantic.locationScore,
      businessTypeScore: semantic.businessTypeScore,
      productFitScore: semantic.productFitScore,
      companyFitScore: semantic.companyFitScore,
      contactabilityScore,
      reasoning: {
        ...semantic.reasoning,
        insufficientEvidence: semantic.insufficientEvidence,
      },
      evidence: {
        items: semantic.evidence,
        directoryHint: structuredData.directoryHint,
      },
      modelProvider: llmResult.provider,
      modelName: llmResult.model,
      scoringVersion: SCORING_VERSION,
    },
    update: {
      overallScore,
      grade,
      industryScore: semantic.industryScore,
      locationScore: semantic.locationScore,
      businessTypeScore: semantic.businessTypeScore,
      productFitScore: semantic.productFitScore,
      companyFitScore: semantic.companyFitScore,
      contactabilityScore,
      reasoning: {
        ...semantic.reasoning,
        insufficientEvidence: semantic.insufficientEvidence,
      },
      evidence: {
        items: semantic.evidence,
        directoryHint: structuredData.directoryHint,
      },
      modelProvider: llmResult.provider,
      modelName: llmResult.model,
      scoringVersion: SCORING_VERSION,
    },
  });

  return {
    companyId: company.id,
    domain: company.domain,
    overallScore,
    grade,
    industryScore: semantic.industryScore,
    locationScore: semantic.locationScore,
    businessTypeScore: semantic.businessTypeScore,
    productFitScore: semantic.productFitScore,
    companyFitScore: semantic.companyFitScore,
    contactabilityScore,
    insufficientEvidence: semantic.insufficientEvidence,
    scoreId: row.id,
    inputTokens: llmResult.inputTokens,
    outputTokens: llmResult.outputTokens,
    modelProvider: llmResult.provider,
    modelName: llmResult.model,
  };
}

export type ScoreSearchTaskCompaniesInput = {
  organizationId: string;
  searchTaskId: string;
  maxCompanies?: number;
  llmCall?: LeadScoreLlmCall;
  shouldAbort?: () => Promise<boolean>;
};

/**
 * Score companies discovered for this SearchTask (via LeadSourceRecord.searchTaskId).
 * Cap at MAX_COMPANIES_PER_TASK_SCORE. One company failure does not stop others.
 */
export async function scoreSearchTaskCompanies(
  input: ScoreSearchTaskCompaniesInput,
): Promise<ScoreTaskResult> {
  const started = Date.now();
  const task = await prisma.leadSearchTask.findUnique({
    where: { id: input.searchTaskId },
  });
  if (!task) {
    throw new AppError(404, 'SearchTask 不存在', 'SEARCH_TASK_NOT_FOUND');
  }
  if (task.organizationId !== input.organizationId) {
    throw new AppError(403, '无权访问该 SearchTask', 'ORGANIZATION_MISMATCH');
  }

  const limit = Math.min(
    Math.max(input.maxCompanies ?? MAX_COMPANIES_PER_TASK_SCORE, 1),
    MAX_COMPANIES_PER_TASK_SCORE,
  );

  const sourceRows = await prisma.leadSourceRecord.findMany({
    where: {
      organizationId: input.organizationId,
      searchTaskId: input.searchTaskId,
      companyId: { not: null },
    },
    select: { companyId: true },
    orderBy: { retrievedAt: 'asc' },
  });

  const companyIds: string[] = [];
  const seen = new Set<string>();
  for (const row of sourceRows) {
    if (!row.companyId || seen.has(row.companyId)) continue;
    seen.add(row.companyId);
    companyIds.push(row.companyId);
    if (companyIds.length >= limit) break;
  }

  const grades: Record<LeadScoreGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  const companies: ScoreTaskResult['companies'] = [];
  const errors: ScoreTaskResult['errors'] = [];
  let scored = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const companyId of companyIds) {
    if (await input.shouldAbort?.()) {
      break;
    }
    try {
      const result = await scoreCompanyForTask({
        organizationId: input.organizationId,
        searchTaskId: input.searchTaskId,
        companyId,
        llmCall: input.llmCall,
      });
      scored += 1;
      grades[result.grade] += 1;
      companies.push({
        companyId: result.companyId,
        domain: result.domain,
        overallScore: result.overallScore,
        grade: result.grade,
      });
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
    } catch (err) {
      failed += 1;
      const company = await prisma.leadCompany.findUnique({
        where: { id: companyId },
        select: { domain: true },
      });
      errors.push({
        companyId,
        domain: company?.domain,
        code: err instanceof AppError ? err.code : 'ICP_SCORE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    taskId: input.searchTaskId,
    scored,
    failed,
    grades,
    companies,
    errors,
    totals: {
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
    },
  };
}

export const leadScoreService = {
  scoreCompanyForTask,
  scoreSearchTaskCompanies,
  computeContactabilityScore,
  computeOverallScore,
  gradeFromOverallScore,
  parseLlmSemanticScore,
  buildContactabilityInput,
  SCORING_VERSION,
  SCORE_WEIGHTS,
  ICP_SYSTEM_PROMPT,
};
