/**
 * Remove demo/dev seed artifacts from a database.
 *
 * Usage (from workstation-backend):
 *   npx tsx scripts/cleanup-demo-data.ts
 *   npx tsx scripts/cleanup-demo-data.ts --dry-run
 *
 * Deletes:
 * - demo@example.com / demo_user (+ memberships / owned orgs when empty)
 * - DEMO-HR-0001 / DEMO-PROD-0001 / DEMO-ALL-0001 licenses (+ wallet / bindings)
 *
 * Always backup production before a live run.
 */
import { PrismaClient } from '@prisma/client';
import { hashLicenseCode } from '../src/services/licenseToken.service';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

const DEMO_LICENSE_CODES = ['DEMO-HR-0001', 'DEMO-PROD-0001', 'DEMO-ALL-0001'];

async function deleteDemoLicenses() {
  for (const code of DEMO_LICENSE_CODES) {
    const licenseCodeHash = hashLicenseCode(code);
    const license = await prisma.license.findUnique({ where: { licenseCodeHash } });
    if (!license) {
      console.log(`  license ${code}: not found`);
      continue;
    }
    console.log(`  license ${code}: id=${license.id} status=${license.status}`);
    if (dryRun) continue;

    await prisma.deviceBinding.deleteMany({ where: { licenseId: license.id } });
    await prisma.creditWallet.deleteMany({ where: { licenseId: license.id } });
    // Subscriptions / orders / usages may Restrict — soft-disable if present
    const orderCount = await prisma.order.count({ where: { licenseId: license.id } });
    const usageCount = await prisma.aiUsage.count({ where: { licenseId: license.id } });
    const subCount = await prisma.subscription.count({ where: { licenseId: license.id } });
    if (orderCount || usageCount || subCount) {
      await prisma.license.update({
        where: { id: license.id },
        data: { status: 'REVOKED', metadata: { cleanup: 'demo', formerCode: code } },
      });
      console.log(`    revoked (has orders/usages/subs); not hard-deleted`);
      continue;
    }
    await prisma.license.delete({ where: { id: license.id } });
    console.log(`    deleted`);
  }
}

async function deleteDemoUser() {
  const demoUser = await prisma.user.findFirst({
    where: {
      OR: [{ id: 'demo_user' }, { email: 'demo@example.com' }, { username: 'demo' }],
    },
  });

  if (!demoUser) {
    console.log('  demo user: not found');
    return;
  }

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: demoUser.id },
    select: { organizationId: true },
  });
  const orgIds = [...new Set(memberships.map((m) => m.organizationId))];
  console.log(`  demo user: ${demoUser.email} (${demoUser.id}), orgs=${orgIds.length}`);

  if (dryRun) return;

  await prisma.refreshToken.deleteMany({ where: { userId: demoUser.id } });
  await prisma.emailOtp.deleteMany({ where: { OR: [{ userId: demoUser.id }, { email: demoUser.email }] } });

  // Cascade: memberships, files, reports, conversations when org/user deleted
  for (const organizationId of orgIds) {
    const others = await prisma.organizationMember.count({
      where: { organizationId, userId: { not: demoUser.id } },
    });
    if (others > 0) {
      await prisma.organizationMember.deleteMany({
        where: { organizationId, userId: demoUser.id },
      });
      console.log(`    left shared org ${organizationId} (other members remain)`);
      continue;
    }
    await prisma.creditLedger.deleteMany({ where: { organizationId } });
    await prisma.creditAccount.deleteMany({ where: { organizationId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } }).catch(async (err) => {
      console.warn(`    org delete failed ${organizationId}:`, err.message);
      // Fall back: remove demo membership only
      await prisma.organizationMember.deleteMany({
        where: { organizationId, userId: demoUser.id },
      });
    });
    console.log(`    deleted org ${organizationId}`);
  }

  await prisma.user.delete({ where: { id: demoUser.id } });
  console.log('  deleted demo user');
}

async function main() {
  console.log(dryRun ? '[dry-run] cleanup demo data' : '[live] cleanup demo data');
  await deleteDemoLicenses();
  await deleteDemoUser();
  console.log(dryRun ? '[dry-run] done (no changes written)' : '[live] done');
}

main()
  .catch((error) => {
    console.error('cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
