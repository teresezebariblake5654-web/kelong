/**
 * Score an existing SearchTask with the real LLM provider (no re-crawl).
 * Usage: npm run smoke:leads:score
 */

import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { initLlmRuntimeFromEnv } from '../src/providers/llm';
import { leadScoreService } from '../src/services/leads/lead-score.service';

async function main() {
  initLlmRuntimeFromEnv();
  console.log('[smoke-score] modelProvider=', env.modelProvider);
  console.log('[smoke-score] llmBaseUrl=', env.llmBaseUrl || '(empty)');
  console.log('[smoke-score] llmModel=', env.llmModel || '(empty)');
  console.log('[smoke-score] llmKey=', env.llmApiKey ? `SET(len=${env.llmApiKey.length})` : 'EMPTY');

  await connectDatabase();

  const task = await prisma.leadSearchTask.findFirst({
    where: {
      prompt: { contains: 'medical device distributors Saudi Arabia' },
      status: 'COMPLETED',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!task) {
    throw new Error('No completed SearchTask found for medical device distributors Saudi Arabia');
  }

  console.log('[smoke-score] task', {
    id: task.id,
    org: task.organizationId,
    prompt: task.prompt,
  });

  const started = Date.now();
  const result = await leadScoreService.scoreSearchTaskCompanies({
    organizationId: task.organizationId,
    searchTaskId: task.id,
    maxCompanies: 5,
  });

  console.log('[smoke-score] wallMs', Date.now() - started);
  console.log('[smoke-score] summary', {
    scored: result.scored,
    failed: result.failed,
    grades: result.grades,
    totals: result.totals,
  });
  console.log('[smoke-score] errors', result.errors);

  const rows = await prisma.leadScore.findMany({
    where: { searchTaskId: task.id },
    include: { company: { select: { domain: true, website: true, metadata: true } } },
    orderBy: { overallScore: 'desc' },
  });

  for (const row of rows) {
    const reasoning =
      row.reasoning && typeof row.reasoning === 'object'
        ? (row.reasoning as Record<string, unknown>)
        : {};
    console.log('[smoke-score] company', {
      domain: row.company.domain,
      industryScore: row.industryScore,
      locationScore: row.locationScore,
      businessTypeScore: row.businessTypeScore,
      productFitScore: row.productFitScore,
      companyFitScore: row.companyFitScore,
      contactabilityScore: row.contactabilityScore,
      overallScore: row.overallScore,
      grade: row.grade,
      modelProvider: row.modelProvider,
      modelName: row.modelName,
      scoringVersion: row.scoringVersion,
      reasoningSummary: {
        industry: reasoning.industry,
        location: reasoning.location,
        businessType: reasoning.businessType,
        productFit: reasoning.productFit,
        companyFit: reasoning.companyFit,
        insufficientEvidence: reasoning.insufficientEvidence,
      },
    });
  }

  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('[smoke-score] FAILED', err);
  try {
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
