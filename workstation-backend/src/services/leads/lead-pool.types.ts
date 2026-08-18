import { z } from 'zod';
import type { LeadScoreGrade, LeadSearchTaskStatus } from '@prisma/client';

const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1')
  .optional();

export const searchTaskResultsQuerySchema = z
  .object({
    grade: z.enum(['A', 'B', 'C', 'D', 'UNSCORED']).optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    maxScore: z.coerce.number().int().min(0).max(100).optional(),
    hasEmail: boolQuery,
    hasPhone: boolQuery,
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.minScore !== undefined &&
      val.maxScore !== undefined &&
      val.minScore > val.maxScore
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minScore must be <= maxScore',
        path: ['minScore'],
      });
    }
  });

export type SearchTaskResultsQuery = z.infer<typeof searchTaskResultsQuerySchema>;

export const searchTaskListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type SearchTaskListQuery = z.infer<typeof searchTaskListQuerySchema>;

export type LeadPoolContactDto = {
  id: string;
  fullName: string | null;
  jobTitle: string | null;
  email: string | null;
  emailVerificationStatus: string | null;
  emailVerificationScore: number | null;
  phone: string | null;
  whatsapp: string | null;
  linkedinUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
};

export type LeadPoolScoreDto = {
  overallScore: number;
  grade: LeadScoreGrade;
  industryScore: number;
  locationScore: number;
  businessTypeScore: number;
  productFitScore: number;
  companyFitScore: number;
  contactabilityScore: number;
  reasoning: Record<string, unknown> | null;
  evidence: unknown[];
};

export type LeadPoolSourceSummaryDto = {
  providers: string[];
  searchSources: number;
  researchPages: number;
  emailVerifications: number;
};

export type LeadPoolCompanyResultDto = {
  id: string;
  name: string | null;
  domain: string;
  website: string | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  description: string | null;
  social: {
    linkedin: string | null;
    facebook: string | null;
    instagram: string | null;
  };
  score: LeadPoolScoreDto | null;
  contacts: LeadPoolContactDto[];
  sourceSummary: LeadPoolSourceSummaryDto;
};

export type LeadPoolTaskResultsDto = {
  task: {
    id: string;
    prompt: string;
    status: LeadSearchTaskStatus;
    createdAt: string;
    completedAt: string | null;
  };
  summary: {
    total: number;
    scored: number;
    grades: {
      A: number;
      B: number;
      C: number;
      D: number;
      UNSCORED: number;
    };
    withEmail: number;
    withPhone: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  companies: LeadPoolCompanyResultDto[];
};

export type LeadPoolSourceProvenanceDto = {
  id: string;
  provider: string;
  sourceType: string;
  sourceUrl: string | null;
  retrievedAt: string;
  createdAt: string;
  /** Safe structured excerpt — never full markdown / raw dumps. */
  excerpt: {
    title: string | null;
    description: string | null;
    pageTitle: string | null;
  };
};

export type LeadPoolCompanyDetailDto = {
  company: {
    id: string;
    name: string | null;
    domain: string;
    website: string | null;
    country: string | null;
    city: string | null;
    industry: string | null;
    description: string | null;
    social: {
      linkedin: string | null;
      facebook: string | null;
      instagram: string | null;
    };
    createdAt: string;
    updatedAt: string;
  };
  contacts: LeadPoolContactDto[];
  scores: Array<{
    id: string;
    searchTaskId: string;
    taskPrompt: string | null;
    overallScore: number;
    grade: LeadScoreGrade;
    industryScore: number;
    locationScore: number;
    businessTypeScore: number;
    productFitScore: number;
    companyFitScore: number;
    contactabilityScore: number;
    reasoning: Record<string, unknown> | null;
    evidence: unknown[];
    scoringVersion: string | null;
    modelProvider: string | null;
    modelName: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  sources: LeadPoolSourceProvenanceDto[];
};

export type LeadPoolSearchTaskListItemDto = {
  id: string;
  prompt: string;
  status: LeadSearchTaskStatus;
  targetCount: number;
  searchResultsCount: number;
  uniqueDomainsCount: number;
  researchedCount: number;
  successfulCount: number;
  createdAt: string;
  completedAt: string | null;
  companyCount: number;
  scoredCount: number;
  gradeCounts: {
    A: number;
    B: number;
    C: number;
    D: number;
  };
};

export type LeadPoolSearchTaskListDto = {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  tasks: LeadPoolSearchTaskListItemDto[];
};

export type LeadPoolSearchTaskDetailDto = LeadPoolSearchTaskListItemDto & {
  startedAt: string | null;
  errorMessage: string | null;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  progress: {
    phase: string;
    updatedAt: string;
    counters: {
      queriesExecuted: number;
      uniqueCandidates: number;
      candidatesResearched: number;
      emailsFound: number;
      companiesPersisted: number;
      companiesScored: number;
    };
  } | null;
  outcome: {
    requestedTarget: number;
    acquiredCompanies: number;
    targetReached: boolean;
    stopReason: string;
  } | null;
};
