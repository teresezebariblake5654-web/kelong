/**
 * Issue a License activation code (plaintext printed once).
 *
 * Usage (from backend/):
 *   npx tsx scripts/issue-license.ts --plan DEVICE_PRODUCTION --product PRODUCTION_AGENT
 *   npx tsx scripts/issue-license.ts --plan DEVICE_HR --product HR_AGENT --credits 100
 *   npx tsx scripts/issue-license.ts --code DEMO-PROD-001 --plan DEVICE_PRODUCTION --product PRODUCTION_AGENT
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient, ProductType } from '@prisma/client';
import { hashLicenseCode } from '../src/services/licenseToken.service';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function generateCode(prefix = 'AW'): string {
  const body = randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

async function main() {
  const planCode = arg('plan') ?? 'DEVICE_PRODUCTION';
  const productRaw = (arg('product') ?? 'PRODUCTION_AGENT').toUpperCase();
  const code = (arg('code') ?? generateCode()).trim().toUpperCase();
  const credits = Number(arg('credits') ?? '');
  const expiresDays = Number(arg('expires-days') ?? '');

  const allowed: ProductType[] = [
    'HR_AGENT',
    'PRODUCTION_AGENT',
    'LOGISTICS_AGENT',
    'UNIVERSAL_AGENT',
  ];
  if (!allowed.includes(productRaw as ProductType)) {
    throw new Error(`--product must be one of ${allowed.join(', ')}`);
  }
  const productType = productRaw as ProductType;

  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) {
    throw new Error(`Plan not found: ${planCode}. Run npm run db:seed first.`);
  }

  const licenseCodeHash = hashLicenseCode(code);
  const existing = await prisma.license.findUnique({ where: { licenseCodeHash } });
  if (existing) {
    throw new Error(`License code already exists (hash collision / reuse): ${code}`);
  }

  const granted = Number.isFinite(credits) && credits > 0 ? credits : plan.includedCredits;
  const expiresAt =
    Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + expiresDays * 86_400_000)
      : null;

  const license = await prisma.license.create({
    data: {
      licenseCodeHash,
      productType,
      status: 'UNACTIVATED',
      planId: plan.id,
      expiresAt,
      metadata: {
        sku: (plan.config as { sku?: string } | null)?.sku ?? plan.code,
        issuedAt: new Date().toISOString(),
        issuedBy: 'issue-license-cli',
      },
      wallet: {
        create: {
          balance: granted,
          totalGranted: granted,
        },
      },
    },
  });

  console.log('License issued successfully.');
  console.log(`  licenseId:   ${license.id}`);
  console.log(`  plan:        ${plan.code} (${plan.name})`);
  console.log(`  productType: ${productType}`);
  console.log(`  credits:     ${granted}`);
  console.log(`  expiresAt:   ${expiresAt?.toISOString() ?? 'none'}`);
  console.log(`  ACTIVATION_CODE (store securely, shown once): ${code}`);
}

main()
  .catch((error) => {
    console.error('issue-license failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
