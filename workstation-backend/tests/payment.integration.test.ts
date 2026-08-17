import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { createMockPaymentSignature } from '../src/providers/payment';
import { signLicenseAccessToken } from '../src/services/licenseToken.service';

const app = createApp();

describe('payment system', () => {
  const creditPlanCode = `credit-pack-${randomUUID()}`;
  const proPlanCode = `pro-monthly-${randomUUID()}`;
  let licenseId = '';
  let accessToken = '';
  let creditOrderNo = '';

  beforeAll(async () => {
    await connectDatabase();
    const license = await prisma.license.create({
      data: {
        licenseCodeHash: `pay-test-${randomUUID()}`,
        productType: 'HR_AGENT',
        status: 'ACTIVE',
        wallet: { create: { balance: 10 } },
        deviceBindings: {
          create: {
            usbFingerprintHash: randomUUID(),
            deviceFingerprintHash: randomUUID(),
          },
        },
      },
      include: { deviceBindings: true },
    });
    licenseId = license.id;
    accessToken = signLicenseAccessToken({
      licenseId,
      productType: 'HR_AGENT',
      deviceBindingId: license.deviceBindings[0].id,
    }).accessToken;

    await prisma.plan.createMany({
      data: [
        {
          code: creditPlanCode,
          name: 'Credit Pack 100',
          type: 'CREDIT_PACK',
          priceCents: 990,
          billingCycle: 'ONE_TIME',
          includedCredits: 100,
          allowedProductTypes: ['HR_AGENT', 'UNIVERSAL_AGENT'],
          status: 'ACTIVE',
        },
        {
          code: proPlanCode,
          name: 'Pro Monthly',
          type: 'PRO_MONTHLY',
          priceCents: 2990,
          billingCycle: 'MONTHLY',
          includedCredits: 500,
          allowedProductTypes: ['HR_AGENT', 'UNIVERSAL_AGENT'],
          status: 'ACTIVE',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.paymentTransaction.deleteMany({
      where: { order: { licenseId } },
    });
    await prisma.creditTransaction.deleteMany({ where: { licenseId } });
    await prisma.subscription.deleteMany({ where: { licenseId } });
    await prisma.order.deleteMany({ where: { licenseId } });
    await prisma.license.update({
      where: { id: licenseId },
      data: { planId: null },
    });
    await prisma.plan.deleteMany({
      where: { code: { in: [creditPlanCode, proPlanCode] } },
    });
    await prisma.deviceBinding.deleteMany({ where: { licenseId } });
    await prisma.creditWallet.deleteMany({ where: { licenseId } });
    await prisma.license.deleteMany({ where: { id: licenseId } });
    await disconnectDatabase();
  });

  it('lists active plans without authentication', async () => {
    const response = await request(app).get('/api/v1/plans').expect(200);
    expect(response.body.data.some((item: { code: string }) => item.code === creditPlanCode)).toBe(
      true,
    );
  });

  it('creates a mock order for the authenticated License', async () => {
    const response = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ planCode: creditPlanCode, paymentProvider: 'mock' })
      .expect(201);

    creditOrderNo = response.body.data.order.orderNo;
    expect(response.body.data.order.status).toBe('PENDING');
    expect(response.body.data.payment.provider).toBe('mock');
  });

  it('fulfills mock payment once and remains idempotent on replay', async () => {
    const providerTransactionId = `mock_txn_${creditOrderNo}`;
    const webhookEventId = `mock_evt_${creditOrderNo}`;
    const signature = createMockPaymentSignature({
      orderNo: creditOrderNo,
      amountCents: 990,
      providerTransactionId,
      webhookEventId,
    });

    const first = await request(app)
      .post('/api/v1/payments/mock/complete')
      .send({
        orderNo: creditOrderNo,
        signature,
        providerTransactionId,
        webhookEventId,
      })
      .expect(200);
    expect(first.body.data.status).toBe('PAID');
    expect(first.body.data.idempotent).toBe(false);

    const second = await request(app)
      .post('/api/v1/payments/mock/complete')
      .send({
        orderNo: creditOrderNo,
        signature,
        providerTransactionId,
        webhookEventId,
      })
      .expect(200);
    expect(second.body.data.idempotent).toBe(true);

    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { licenseId } });
    expect(wallet.balance).toBe(110);
    expect(wallet.totalPurchased).toBe(100);
    expect(
      await prisma.creditTransaction.count({
        where: { licenseId, type: 'PURCHASE', order: { orderNo: creditOrderNo } },
      }),
    ).toBe(1);
    expect(
      await prisma.paymentTransaction.count({
        where: { webhookEventId },
      }),
    ).toBe(1);
  });

  it('creates a subscription and grants credits for Pro plans', async () => {
    const created = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ planCode: proPlanCode, paymentProvider: 'mock' })
      .expect(201);
    const orderNo = created.body.data.order.orderNo;
    const providerTransactionId = `mock_txn_${orderNo}`;
    const webhookEventId = `mock_evt_${orderNo}`;
    const signature = createMockPaymentSignature({
      orderNo,
      amountCents: 2990,
      providerTransactionId,
      webhookEventId,
    });

    await request(app)
      .post('/api/v1/payments/mock/complete')
      .send({ orderNo, signature, providerTransactionId, webhookEventId })
      .expect(200);

    const wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { licenseId } });
    const subscription = await prisma.subscription.findFirst({
      where: { licenseId, status: 'ACTIVE' },
    });
    expect(wallet.balance).toBe(610);
    expect(wallet.totalGranted).toBe(500);
    expect(subscription).toBeTruthy();
  });

  it('returns order details for the owning License only', async () => {
    const response = await request(app)
      .get(`/api/v1/orders/${creditOrderNo}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.data.status).toBe('PAID');
    expect(response.body.data.payments.length).toBeGreaterThan(0);
  });

  it('keeps WeChat and Alipay as placeholders', async () => {
    const wechatOrder = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ planCode: creditPlanCode, paymentProvider: 'wechat' })
      .expect(501);
    expect(wechatOrder.body.code).toBe('WECHAT_PAY_DISABLED');

    const wechatNotify = await request(app)
      .post('/api/v1/payments/wechat/notify')
      .send({})
      .expect(501);
    expect(wechatNotify.body.code).toBe('WECHAT_PAY_NOT_IMPLEMENTED');

    const alipayNotify = await request(app)
      .post('/api/v1/payments/alipay/notify')
      .send({})
      .expect(501);
    expect(alipayNotify.body.code).toBe('ALIPAY_NOT_IMPLEMENTED');
  });
});
