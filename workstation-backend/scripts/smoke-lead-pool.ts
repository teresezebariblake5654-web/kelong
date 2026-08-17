/**
 * Read-only smoke against existing medical-device SearchTask.
 * Usage: npm run smoke:leads:pool
 */

import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { leadPoolService } from '../src/services/leads/lead-pool.service';

const TASK_ID = 'cmswlnoo9000ycy7wdh1yrrh9';

async function main() {
  await connectDatabase();

  const task = await prisma.leadSearchTask.findUnique({ where: { id: TASK_ID } });
  if (!task) {
    throw new Error(`SearchTask not found: ${TASK_ID}`);
  }

  console.log('[smoke-pool] task', {
    id: task.id,
    org: task.organizationId,
    prompt: task.prompt,
    status: task.status,
  });

  const results = await leadPoolService.getSearchTaskResults({
    organizationId: task.organizationId,
    searchTaskId: task.id,
    query: { page: 1, pageSize: 20 },
  });

  console.log('[smoke-pool] summary', results.summary);
  console.log('[smoke-pool] pagination', results.pagination);
  console.log(
    '[smoke-pool] order',
    results.companies.map((c) => ({
      domain: c.domain,
      overallScore: c.score?.overallScore ?? null,
      grade: c.score?.grade ?? 'UNSCORED',
      businessTypeScore: c.score?.businessTypeScore ?? null,
    })),
  );

  const gradeA = await leadPoolService.getSearchTaskResults({
    organizationId: task.organizationId,
    searchTaskId: task.id,
    query: { page: 1, pageSize: 20, grade: 'A' },
  });
  console.log(
    '[smoke-pool] grade=A',
    gradeA.companies.map((c) => ({
      domain: c.domain,
      overallScore: c.score?.overallScore,
      grade: c.score?.grade,
    })),
  );
  console.log('[smoke-pool] grade=A summary.total (unfiltered)', gradeA.summary.total);
  console.log('[smoke-pool] grade=A pagination.total (filtered)', gradeA.pagination.total);

  const domains = results.companies.map((c) => c.domain);
  const mediservIdx = domains.findIndex((d) => d.includes('mediserv'));
  const skyIdx = domains.findIndex((d) => d.includes('skymedical'));
  const ensunIdx = domains.findIndex((d) => d.includes('ensun'));
  console.log('[smoke-pool] rank indexes', { mediservIdx, skyIdx, ensunIdx });

  if (mediservIdx >= 0 && skyIdx >= 0 && mediservIdx > skyIdx) {
    throw new Error('Expected mediserv ranked above skymedical');
  }
  if (skyIdx >= 0 && ensunIdx >= 0 && skyIdx > ensunIdx) {
    throw new Error('Expected skymedical ranked above ensun');
  }
  if (gradeA.companies.some((c) => c.score?.grade !== 'A')) {
    throw new Error('grade=A filter returned non-A companies');
  }

  console.log('[smoke-pool] OK');
}

main()
  .catch((err) => {
    console.error('[smoke-pool] FAILED', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
