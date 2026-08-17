import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { orgCreditService } from '../src/services/orgCredit.service';

const app = createApp();

describe('account + org credits (/api/v1/account, /api/v1/credits)', () => {
  const suffix = Date.now();
  const emailA = `acct_a_${suffix}@example.com`;
  const emailB = `acct_b_${suffix}@example.com`;
  const password = 'StrongPass123!';

  let tokenA = '';
  let tokenB = '';
  let orgIdA = '';
  let orgIdB = '';

  beforeAll(async () => {
    await connectDatabase();

    const regA = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailA, username: `acct_a_${suffix}`, password })
      .expect(201);
    tokenA = regA.body.data.accessToken;
    orgIdA = regA.body.data.organizations[0].id;

    const regB = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailB, username: `acct_b_${suffix}`, password })
      .expect(201);
    tokenB = regB.body.data.accessToken;
    orgIdB = regB.body.data.organizations[0].id;

    // Seed a readable balance/ledger for org A (local test only).
    await prisma.creditAccount.update({
      where: { organizationId: orgIdA },
      data: { balance: 10000, frozenBalance: 100 },
    });
    await prisma.creditLedger.create({
      data: {
        organizationId: orgIdA,
        type: 'INITIAL',
        amount: 10000,
        balanceBefore: 0,
        balanceAfter: 10000,
        description: '测试初始分析额度',
        idempotencyKey: `test:${orgIdA}:initial`,
      },
    });
    await prisma.creditLedger.create({
      data: {
        organizationId: orgIdA,
        type: 'CONSUME',
        amount: -20,
        balanceBefore: 10000,
        balanceAfter: 9980,
        description: '智能分析任务消耗',
        idempotencyKey: `test:${orgIdA}:consume-1`,
      },
    });
  });

  afterAll(async () => {
    const emails = [emailA, emailB];
    await prisma.creditLedger.deleteMany({
      where: { organization: { members: { some: { user: { email: { in: emails } } } } } },
    });
    await prisma.creditAccount.deleteMany({
      where: { organization: { members: { some: { user: { email: { in: emails } } } } } },
    });
    await prisma.organizationMember.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.organization.deleteMany({
      where: { members: { some: { user: { email: { in: emails } } } } },
    });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await disconnectDatabase();
  });

  it('rejects unauthenticated profile access with 401', async () => {
    const res = await request(app).get('/api/v1/account/profile').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects credits balance without X-Organization-Id', async () => {
    const res = await request(app)
      .get('/api/v1/credits/balance')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(400);
    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
  });

  it('rejects forging another organization id with 403', async () => {
    const res = await request(app)
      .get('/api/v1/credits/balance')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdB)
      .expect(403);
    expect(res.body.code).toBe('ORGANIZATION_FORBIDDEN');
  });

  it('returns profile for current organization member', async () => {
    const res = await request(app)
      .get('/api/v1/account/profile')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdA)
      .expect(200);

    expect(res.body.data.user.email).toBe(emailA);
    expect(res.body.data.organization.id).toBe(orgIdA);
    expect(res.body.data.user.phone).toBeUndefined();
    expect(res.body.data.provider).toBeUndefined();
    expect(res.body.data.model).toBeUndefined();
  });

  it('returns organization credit balance for member', async () => {
    const res = await request(app)
      .get('/api/v1/credits/balance')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdA)
      .expect(200);

    expect(res.body.data.balance).toBe(10000);
    expect(res.body.data.frozenBalance).toBe(100);
    expect(res.body.data.availableBalance).toBe(9900);
    expect(res.body.data.unit).toBe('credits');
    expect(res.body.data.provider).toBeUndefined();
    expect(res.body.data.model).toBeUndefined();
    expect(res.body.data.apiKey).toBeUndefined();
  });

  it('cannot view another organization balance', async () => {
    const res = await request(app)
      .get('/api/v1/credits/balance')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('X-Organization-Id', orgIdA)
      .expect(403);
    expect(res.body.code).toBe('ORGANIZATION_FORBIDDEN');
  });

  it('paginates credit ledger without leaking provider fields', async () => {
    const res = await request(app)
      .get('/api/v1/credits/ledger?page=1&pageSize=20')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdA)
      .expect(200);

    expect(res.body.data.pagination.page).toBe(1);
    expect(res.body.data.pagination.pageSize).toBe(20);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.items[0].description).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/deepseek|apiKey|provider|baseUrl/i);
  });

  it('auto-creates CreditAccount for new organizations and is idempotent', async () => {
    const account1 = await orgCreditService.ensureAccount(orgIdB);
    const account2 = await orgCreditService.ensureAccount(orgIdB);
    expect(account1.id).toBe(account2.id);

    const count = await prisma.creditAccount.count({ where: { organizationId: orgIdB } });
    expect(count).toBe(1);
  });
});
