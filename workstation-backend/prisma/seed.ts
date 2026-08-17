import bcrypt from 'bcrypt';
import { PrismaClient, ProductType } from '@prisma/client';
import { LOCAL_TASK_TEMPLATES } from '@aw/task-templates';
import { hashLicenseCode } from '../src/services/licenseToken.service';

const prisma = new PrismaClient();

/** Demo activation codes (dev/seed only). Plaintext logged once for local QA. */
const DEMO_LICENSES: Array<{
  code: string;
  planCode: string;
  productType: ProductType;
  credits: number;
}> = [
  {
    code: 'DEMO-HR-0001',
    planCode: 'DEVICE_HR',
    productType: 'HR_AGENT',
    credits: 50,
  },
  {
    code: 'DEMO-PROD-0001',
    planCode: 'DEVICE_PRODUCTION',
    productType: 'PRODUCTION_AGENT',
    credits: 100,
  },
  {
    code: 'DEMO-ALL-0001',
    planCode: 'DEVICE_UNIVERSAL',
    productType: 'UNIVERSAL_AGENT',
    credits: 200,
  },
];

const DEFAULT_CREDITS = Number(process.env.DEFAULT_USER_CREDITS ?? 1000);
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'DemoPass123!';
/** Platform admin for recharge confirm / llm-provider status (change in production). */
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'admin@bx-aigc.com';
const ADMIN_USERNAME = process.env.ADMIN_SEED_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'AdminPass123!';
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);
const ALLOW_DEMO_USER = !['0', 'false', 'no', 'off'].includes(
  String(process.env.ALLOW_DEMO_USER ?? 'true').trim().toLowerCase(),
);
const IS_PRODUCTION = String(process.env.NODE_ENV ?? '').toLowerCase() === 'production';

const ALL_PRODUCTS: ProductType[] = [
  'HR_AGENT',
  'PRODUCTION_AGENT',
  'LOGISTICS_AGENT',
  'UNIVERSAL_AGENT',
];

function toDbProductType(role: string): ProductType {
  if (role === 'hr') return 'HR_AGENT';
  if (role === 'production') return 'PRODUCTION_AGENT';
  if (role === 'logistics') return 'LOGISTICS_AGENT';
  return 'UNIVERSAL_AGENT';
}

async function seedRechargePlans() {
  /** Manual purchase SKUs shown in 购买积分 (DB-driven; frontend must not hardcode). */
  const plans = [
    {
      name: 'AI 积分包 · ¥50',
      priceCents: 5_000,
      creditAmount: 55_000,
      description: '55,000 AI 积分',
      sortOrder: 1,
    },
    {
      name: 'AI 积分包 · ¥100',
      priceCents: 10_000,
      creditAmount: 115_000,
      description: '115,000 AI 积分',
      sortOrder: 2,
    },
    {
      name: 'AI 积分包 · ¥500',
      priceCents: 50_000,
      creditAmount: 600_000,
      description: '600,000 AI 积分',
      sortOrder: 3,
    },
  ];

  for (const plan of plans) {
    const existing = await prisma.rechargePlan.findFirst({
      where: { name: plan.name },
    });
    if (existing) {
      await prisma.rechargePlan.update({
        where: { id: existing.id },
        data: {
          priceCents: plan.priceCents,
          creditAmount: plan.creditAmount,
          description: plan.description,
          sortOrder: plan.sortOrder,
          enabled: true,
        },
      });
    } else {
      await prisma.rechargePlan.create({
        data: {
          name: plan.name,
          priceCents: plan.priceCents,
          creditAmount: plan.creditAmount,
          description: plan.description,
          sortOrder: plan.sortOrder,
          enabled: true,
        },
      });
    }
  }
  return plans.length;
}

async function seedPlans() {
  const plans = [
    {
      code: 'CREDIT_PACK_100',
      name: '智能额度包 100',
      type: 'CREDIT_PACK' as const,
      priceCents: 990,
      billingCycle: 'ONE_TIME',
      includedCredits: 100,
      allowedProductTypes: ALL_PRODUCTS,
      status: 'ACTIVE',
      config: { sku: 'credit_100' },
    },
    {
      code: 'CREDIT_PACK_500',
      name: '智能额度包 500',
      type: 'CREDIT_PACK' as const,
      priceCents: 3990,
      billingCycle: 'ONE_TIME',
      includedCredits: 500,
      allowedProductTypes: ALL_PRODUCTS,
      status: 'ACTIVE',
      config: { sku: 'credit_500' },
    },
    {
      code: 'PRO_MONTHLY',
      name: 'Pro 月度会员',
      type: 'PRO_MONTHLY' as const,
      priceCents: 2990,
      billingCycle: 'MONTHLY',
      includedCredits: 500,
      allowedProductTypes: ALL_PRODUCTS,
      status: 'ACTIVE',
      config: { sku: 'pro_monthly' },
    },
    {
      code: 'PRO_YEARLY',
      name: 'Pro 年度会员',
      type: 'PRO_YEARLY' as const,
      priceCents: 29900,
      billingCycle: 'YEARLY',
      includedCredits: 6000,
      allowedProductTypes: ALL_PRODUCTS,
      status: 'ACTIVE',
      config: { sku: 'pro_yearly' },
    },
    {
      code: 'DEVICE_HR',
      name: '人事岗位 U 盘产品',
      type: 'DEVICE_PRODUCT' as const,
      priceCents: 0,
      billingCycle: 'ONE_TIME',
      includedCredits: 50,
      allowedProductTypes: ['HR_AGENT', 'UNIVERSAL_AGENT'] as ProductType[],
      status: 'ACTIVE',
      config: { sku: 'device_hr' },
    },
    {
      code: 'DEVICE_PRODUCTION',
      name: '生产岗位 U 盘产品',
      type: 'DEVICE_PRODUCT' as const,
      priceCents: 0,
      billingCycle: 'ONE_TIME',
      includedCredits: 100,
      allowedProductTypes: ['PRODUCTION_AGENT', 'UNIVERSAL_AGENT'] as ProductType[],
      status: 'ACTIVE',
      config: { sku: 'device_production' },
    },
    {
      code: 'DEVICE_UNIVERSAL',
      name: '全能 U 盘产品',
      type: 'DEVICE_PRODUCT' as const,
      priceCents: 0,
      billingCycle: 'ONE_TIME',
      includedCredits: 200,
      allowedProductTypes: ALL_PRODUCTS,
      status: 'ACTIVE',
      config: { sku: 'device_universal' },
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        type: plan.type,
        priceCents: plan.priceCents,
        billingCycle: plan.billingCycle,
        includedCredits: plan.includedCredits,
        allowedProductTypes: plan.allowedProductTypes,
        status: plan.status,
        config: plan.config,
      },
      create: plan,
    });
  }

  return plans.length;
}

async function seedDemoLicenses() {
  const issued: string[] = [];
  for (const item of DEMO_LICENSES) {
    const plan = await prisma.plan.findUnique({ where: { code: item.planCode } });
    if (!plan) continue;
    const licenseCodeHash = hashLicenseCode(item.code);
    const existing = await prisma.license.findUnique({ where: { licenseCodeHash } });
    if (existing) {
      issued.push(`${item.code} (exists)`);
      continue;
    }
    await prisma.license.create({
      data: {
        licenseCodeHash,
        productType: item.productType,
        status: 'UNACTIVATED',
        planId: plan.id,
        metadata: {
          sku: (plan.config as { sku?: string } | null)?.sku ?? plan.code,
          seed: true,
        },
        wallet: {
          create: {
            balance: item.credits,
            totalGranted: item.credits,
          },
        },
      },
    });
    issued.push(item.code);
  }
  return issued;
}

async function seedTaskTemplates() {
  let count = 0;
  for (const template of LOCAL_TASK_TEMPLATES) {
    const data = {
      agentType: toDbProductType(template.role),
      name: template.name,
      description: template.description,
      creditCost: Math.max(1, template.estimatedCredits || 10),
      modelConfig: {
        model: 'mock-task-model',
        baseCredits: Math.max(1, Math.min(10, template.estimatedCredits || 2)),
        maxOutputTokens: 1024,
      },
      promptTemplate: `请基于结构化统计结果，为任务「${template.name}」生成简洁中文分析总结。`,
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        required: ['summary'],
        properties: {
          summary: { type: 'string' },
          highlights: { type: 'array', items: { type: 'string' } },
          anomalyCount: { type: 'number' },
          data: { type: 'object' },
        },
      },
      enabled: template.enabled !== false,
    };

    await prisma.taskTemplate.upsert({
      where: {
        code_version: {
          code: template.code,
          version: template.version,
        },
      },
      update: data,
      create: {
        code: template.code,
        version: template.version,
        ...data,
      },
    });
    count += 1;
  }
  return count;
}

async function ensureDemoOrganization(userId: string, username: string) {
  const existing = await prisma.organizationMember.findFirst({
    where: { userId, status: 'active' },
    include: { organization: true },
  });
  if (existing) return existing.organization;

  return prisma.organization.create({
    data: {
      name: `${username} Org`,
      slug: `demo-${userId.slice(-8)}`,
      status: 'active',
      plan: 'free',
      members: {
        create: {
          userId,
          role: 'owner',
          status: 'active',
        },
      },
    },
  });
}

async function main() {
  if (IS_PRODUCTION) {
    if (!process.env.ADMIN_SEED_EMAIL?.trim() || !process.env.ADMIN_SEED_PASSWORD?.trim()) {
      throw new Error(
        'Production seed requires ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD to be set explicitly in the environment.',
      );
    }
    if (ADMIN_PASSWORD === 'AdminPass123!' || ADMIN_PASSWORD.length < 12) {
      throw new Error(
        'Refusing to seed production with weak/default ADMIN_SEED_PASSWORD. Use a strong password (min 12 chars, not AdminPass123!).',
      );
    }
    if (ALLOW_DEMO_USER) {
      throw new Error('Refusing to seed production with ALLOW_DEMO_USER=true. Set ALLOW_DEMO_USER=false.');
    }
  }

  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      username: ADMIN_USERNAME,
      passwordHash: adminPasswordHash,
      role: 'admin',
      status: 'active',
    },
    create: {
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      passwordHash: adminPasswordHash,
      role: 'admin',
      vipLevel: 'free',
      credits: 0,
      status: 'active',
    },
  });

  const planCount = await seedPlans();
  const rechargePlanCount = await seedRechargePlans();
  const templateCount = await seedTaskTemplates();

  let demoSummary = 'skipped (ALLOW_DEMO_USER=false)';
  let demoLicenseCodes: string[] = [];
  let orgSummary = 'n/a';
  let demoOrgCredits = 0;

  if (ALLOW_DEMO_USER) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

    const demo = await prisma.user.upsert({
      where: { id: 'demo_user' },
      update: {
        username: 'demo',
        email: 'demo@example.com',
        phone: null,
        passwordHash,
        role: 'user',
        vipLevel: 'free',
        credits: DEFAULT_CREDITS,
        status: 'active',
      },
      create: {
        id: 'demo_user',
        username: 'demo',
        email: 'demo@example.com',
        phone: null,
        passwordHash,
        role: 'user',
        vipLevel: 'free',
        credits: DEFAULT_CREDITS,
        status: 'active',
      },
    });

    const org = await ensureDemoOrganization(demo.id, demo.username);

    // Local seed only: give demo org a generous analysis quota for tonight demos.
    demoOrgCredits = Number(process.env.DEMO_ORG_CREDITS ?? 10_000);
    await prisma.creditAccount.upsert({
      where: { organizationId: org.id },
      update: {
        balance: demoOrgCredits,
        frozenBalance: 0,
      },
      create: {
        organizationId: org.id,
        balance: demoOrgCredits,
        frozenBalance: 0,
      },
    });
    await prisma.creditLedger.upsert({
      where: { idempotencyKey: `org:${org.id}:seed-initial` },
      update: {},
      create: {
        organizationId: org.id,
        userId: demo.id,
        type: 'INITIAL',
        amount: demoOrgCredits,
        balanceBefore: 0,
        balanceAfter: demoOrgCredits,
        description: '演示环境初始 AI 积分',
        idempotencyKey: `org:${org.id}:seed-initial`,
      },
    });

    demoLicenseCodes = await seedDemoLicenses();
    demoSummary = `${demo.username} (${demo.email}), credits=${demo.credits}`;
    orgSummary = `${org.name} (${org.id})`;
  }

  console.log('Seed completed (PostgreSQL):');
  console.log(`  demo_user: ${demoSummary}`);
  console.log(`  admin_user: ${admin.username} (${admin.email}) role=${admin.role}`);
  console.log(`  organization: ${orgSummary}`);
  console.log(`  org analysis credits: ${ALLOW_DEMO_USER ? demoOrgCredits : 0}`);
  console.log(`  commercial plans: ${planCount}`);
  console.log(`  recharge plans: ${rechargePlanCount}`);
  console.log(`  demo license codes: ${demoLicenseCodes.join(', ') || '(none)'}`);
  console.log(`  task templates: ${templateCount}`);
  if (ALLOW_DEMO_USER) {
    console.log('  Login: POST /api/v1/auth/login with email=demo@example.com');
  }
  console.log(`  Admin login: ${ADMIN_EMAIL} / (ADMIN_SEED_PASSWORD)`);
  console.log('  Issue more licenses: npx tsx scripts/issue-license.ts --plan DEVICE_PRODUCTION --product PRODUCTION_AGENT');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
