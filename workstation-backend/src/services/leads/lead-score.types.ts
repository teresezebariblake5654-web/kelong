import { z } from 'zod';
import type { LeadScoreGrade } from '@prisma/client';

export const SCORING_VERSION = 'icp-v1';
export const MAX_COMPANIES_PER_TASK_SCORE = 20;

export const SCORE_WEIGHTS = {
  industry: 0.2,
  location: 0.15,
  businessType: 0.2,
  productFit: 0.25,
  companyFit: 0.1,
  contactability: 0.1,
} as const;

/** LLM must not include overallScore / grade / contactabilityScore (.strict rejects extras). */
export const llmSemanticScoreSchema = z
  .object({
    industryScore: z.number().int().min(0).max(100),
    locationScore: z.number().int().min(0).max(100),
    businessTypeScore: z.number().int().min(0).max(100),
    productFitScore: z.number().int().min(0).max(100),
    companyFitScore: z.number().int().min(0).max(100),
    reasoning: z
      .object({
        industry: z.string().max(2000),
        location: z.string().max(2000),
        businessType: z.string().max(2000),
        productFit: z.string().max(2000),
        companyFit: z.string().max(2000),
      })
      .strict(),
    evidence: z
      .array(
        z
          .object({
            claim: z.string().max(2000),
            sourceUrl: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(20),
    insufficientEvidence: z.boolean(),
  })
  .strict();

export type LlmSemanticScore = z.infer<typeof llmSemanticScoreSchema>;

export type ContactabilityInput = {
  hasVerifiedEmail: boolean;
  hasUnverifiedEmail: boolean;
  hasPhone: boolean;
  hasSocial: boolean;
  hasWebsite: boolean;
};

export type ScoreCompanyResult = {
  companyId: string;
  domain: string;
  overallScore: number;
  grade: LeadScoreGrade;
  industryScore: number;
  locationScore: number;
  businessTypeScore: number;
  productFitScore: number;
  companyFitScore: number;
  contactabilityScore: number;
  insufficientEvidence: boolean;
  scoreId: string;
  inputTokens: number;
  outputTokens: number;
  modelProvider: string;
  modelName: string;
};

export type ScoreTaskResult = {
  taskId: string;
  scored: number;
  failed: number;
  grades: Record<LeadScoreGrade, number>;
  companies: Array<{
    companyId: string;
    domain: string;
    overallScore: number;
    grade: LeadScoreGrade;
  }>;
  errors: Array<{ companyId?: string; domain?: string; code: string; message: string }>;
  totals: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
};
