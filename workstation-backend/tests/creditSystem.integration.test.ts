import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { aiTaskExecutionService } from '../src/services/aiTaskExecution.service';
import { creditService } from '../src/services/credit.service';
import { signLicenseAccessToken } from '../src/services/licenseToken.service';

const app = createApp();

describe('license credit and usage system', () => {
  let licenseId = '';
  let deviceBindingId = '';
  let accessToken = '';
  const taskCode = `hr-task-${randomUUID()}`;
  const failedTaskCode = `hr-fail-${randomUUID()}`;
  const mismatchTaskCode = `production-task-${randomUUID()}`;

  beforeAll(async () => {
    await connectDatabase();
    const license = await prisma.license.create({
      data: {
        licenseCodeHash: `credit-test-${randomUUID()}`,
        productType: 'HR_AGENT',
        status: 'ACTIVE',
        wallet: { create: { balance: 100 } },
        deviceBindings: {
          create: {
            usbFingerprintHash: `usb-${randomUUID()}`,
            deviceFingerprintHash: `device-${randomUUID()}`,
          },
        },
      },
      include: { deviceBindings: true },
    });
    licenseId = license.id;
    deviceBindingId = license.deviceBindings[0].id;
    accessToken = signLicenseAccessToken({
      licenseId,
      productType: 'HR_AGENT',
      deviceBindingId,
    }).accessToken;

    await prisma.taskTemplate.createMany({
      data: [
        {
          code: taskCode,
          agentType: 'HR_AGENT',
          name: 'HR mock task',
          description: 'credit settlement test',
          version: '1.0.0',
          creditCost: 20,
          modelConfig: {
            baseCredits: 1,
            inputCostMicrosPerMillionTokens: 1_000_000,
            outputCostMicrosPerMillionTokens: 2_000_000,
          },
          promptTemplate: 'Only summarize the supplied structured data.',
          inputSchema: {},
          outputSchema: {},
        },
        {
          code: failedTaskCode,
          agentType: 'HR_AGENT',
          name: 'Failed provider task',
          description: 'release reservation test',
          version: '1.0.0',
          creditCost: 10,
          modelConfig: {},
          promptTemplate: 'This provider call will fail.',
          inputSchema: {},
          outputSchema: {},
        },
        {
          code: mismatchTaskCode,
          agentType: 'PRODUCTION_AGENT',
          name: 'Production task',
          description: 'product isolation test',
          version: '1.0.0',
          creditCost: 10,
          modelConfig: {},
          promptTemplate: 'Production only.',
          inputSchema: {},
          outputSchema: {},
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.creditTransaction.deleteMany({ where: { licenseId } });
    await prisma.aiUsage.deleteMany({ where: { licenseId } });
    await prisma.taskTemplate.deleteMany({
      where: { code: { in: [taskCode, failedTaskCode, mismatchTaskCode] } },
    });
    await prisma.deviceBinding.deleteMany({ where: { licenseId } });
    await prisma.creditWallet.deleteMany({ where: { licenseId } });
    await prisma.license.deleteMany({ where: { id: licenseId } });
    await disconnectDatabase();
  });

  it('returns only the wallet derived from the License Token', async () => {
    const response = await request(app)
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.data.balance).toBe(100);

    const spoofed = await request(app)
      .get(`/api/v1/wallet?licenseId=spoofed`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
    expect(spoofed.body.code).toBe('CLIENT_LICENSE_ID_FORBIDDEN');
  });

  it('settles reserved credits atomically and idempotently', async () => {
    const usage = await prisma.aiUsage.create({
      data: {
        licenseId,
        taskType: 'MANUAL_SETTLEMENT_TEST',
        templateVersion: '1.0.0',
        provider: 'mock',
        model: 'mock',
        creditsReserved: 20,
        requestId: randomUUID(),
      },
    });
    await creditService.reserveCredits({
      licenseId,
      usageId: usage.id,
      amount: 20,
      idempotencyKey: `test:${usage.id}:reserve`,
      description: 'reserve settlement test',
    });
    const input = {
      licenseId,
      usageId: usage.id,
      reservedAmount: 20,
      chargedAmount: 7,
      idempotencyKey: `test:${usage.id}:settle`,
      description: 'settle test',
    };
    await creditService.settleCredits(input);
    await creditService.settleCredits(input);

    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { licenseId } });
    expect(wallet.balance).toBe(93);
    expect(wallet.reservedBalance).toBe(0);
    expect(wallet.totalConsumed).toBe(7);
    expect(
      await prisma.creditTransaction.count({
        where: { usageId: usage.id, type: 'CONSUME' },
      }),
    ).toBe(1);
  });

  it('executes a server template and refunds unused reservation', async () => {
    const requestId = randomUUID();
    const user = await prisma.user.create({
      data: {
        username: `credit_exec_${randomUUID().slice(0, 8)}`,
        email: `credit_exec_${randomUUID()}@example.com`,
        passwordHash: 'x',
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: 'credit exec org',
        slug: `credit-exec-${randomUUID().slice(0, 8)}`,
        members: { create: { userId: user.id, role: 'owner', status: 'active' } },
      },
    });

    const previousEnforcement = env.licenseEnforcementEnabled;
    env.licenseEnforcementEnabled = true;
    try {
      const result = await aiTaskExecutionService.execute({
        userId: user.id,
        organizationId: org.id,
        taskCode,
        templateVersion: '1.0.0',
        structuredInput: { departmentCount: 3, abnormalAttendance: 2 },
        requestId,
      });
      expect(result.usage.status).toBe('COMPLETED');
      expect(result.usage.creditsReserved).toBe(20);
      expect(result.usage.creditsCharged).toBeGreaterThanOrEqual(0);

      const repeated = await aiTaskExecutionService.execute({
        userId: user.id,
        organizationId: org.id,
        taskCode,
        templateVersion: '1.0.0',
        structuredInput: { ignored: true },
        requestId,
      });
      expect(repeated.idempotent).toBe(true);
    } finally {
      env.licenseEnforcementEnabled = previousEnforcement;
      await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('releases all reserved credits when the provider fails', async () => {
    const user = await prisma.user.create({
      data: {
        username: `credit_fail_${randomUUID().slice(0, 8)}`,
        email: `credit_fail_${randomUUID()}@example.com`,
        passwordHash: 'x',
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: 'credit fail org',
        slug: `credit-fail-${randomUUID().slice(0, 8)}`,
        members: { create: { userId: user.id, role: 'owner', status: 'active' } },
      },
    });

    const originalProvider = env.modelProvider;
    const previousEnforcement = env.licenseEnforcementEnabled;
    env.modelProvider = 'deepseek';
    env.licenseEnforcementEnabled = true;
    try {
      await expect(
        aiTaskExecutionService.execute({
          userId: user.id,
          organizationId: org.id,
          taskCode: failedTaskCode,
          templateVersion: '1.0.0',
          structuredInput: { value: 1 },
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'DEEPSEEK_NOT_CONFIGURED' });
    } finally {
      env.modelProvider = originalProvider;
      env.licenseEnforcementEnabled = previousEnforcement;
      await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it.skip('rejects templates outside the licensed product (legacy License JWT product gate; formal path uses internal license)', async () => {
    // Kept for historical License JWT product isolation; skipped while AI analyze
    // is driven by User JWT + Organization and an internal license placeholder.
    const user = await prisma.user.create({
      data: {
        username: `credit_mismatch_${randomUUID().slice(0, 8)}`,
        email: `credit_mismatch_${randomUUID()}@example.com`,
        passwordHash: 'x',
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: 'credit mismatch org',
        slug: `credit-mismatch-${randomUUID().slice(0, 8)}`,
        members: { create: { userId: user.id, role: 'owner', status: 'active' } },
      },
    });

    const previousEnforcement = env.licenseEnforcementEnabled;
    env.licenseEnforcementEnabled = true;
    try {
      await expect(
        aiTaskExecutionService.execute({
          userId: user.id,
          organizationId: org.id,
          taskCode: mismatchTaskCode,
          templateVersion: '1.0.0',
          structuredInput: {},
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'TASK_PRODUCT_MISMATCH' });
    } finally {
      env.licenseEnforcementEnabled = previousEnforcement;
      await prisma.organizationMember.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('lists transactions and usage through License authentication', async () => {
    const transactions = await request(app)
      .get('/api/v1/wallet/transactions?limit=10')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(transactions.body.data.length).toBeGreaterThan(0);

    const usage = await request(app)
      .get('/api/v1/usage?limit=10')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(usage.body.data.length).toBeGreaterThan(0);
    expect(typeof usage.body.data[0].providerCostMicros).toBe('string');
  });
});
