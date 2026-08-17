import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import {
  assertPaymentProviderEnabled,
  getPaymentProvider,
  PaymentProviderName,
} from '../providers/payment';
import { paymentFulfillmentService } from './paymentFulfillment.service';
import { WebhookResult } from '../providers/payment';

function publicOrder(order: {
  id: string;
  orderNo: string;
  orderType: string;
  productId: string;
  amountCents: number;
  paymentProvider: string;
  status: string;
  paidAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    orderType: order.orderType,
    productId: order.productId,
    amountCents: order.amountCents,
    paymentProvider: order.paymentProvider,
    status: order.status,
    paidAt: order.paidAt,
    closedAt: order.closedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export const orderService = {
  async listActivePlans() {
    const plans = await prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ type: 'asc' }, { priceCents: 'asc' }],
    });
    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      type: plan.type,
      priceCents: plan.priceCents,
      billingCycle: plan.billingCycle,
      includedCredits: plan.includedCredits,
      allowedProductTypes: plan.allowedProductTypes,
      config: plan.config,
    }));
  },

  async createOrder(input: {
    licenseId: string;
    productType: string;
    planCode: string;
    paymentProvider?: string;
  }) {
    const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || plan.status !== 'ACTIVE') {
      throw new AppError(404, '套餐不存在或已下架', 'PLAN_NOT_FOUND');
    }
    if (
      plan.allowedProductTypes.length > 0 &&
      !plan.allowedProductTypes.includes(input.productType as never) &&
      input.productType !== 'UNIVERSAL_AGENT'
    ) {
      throw new AppError(403, '当前 License 产品类型不能购买该套餐', 'PLAN_PRODUCT_MISMATCH');
    }

    await prisma.creditWallet.upsert({
      where: { licenseId: input.licenseId },
      create: { licenseId: input.licenseId },
      update: {},
    });

    const providerName = (input.paymentProvider ||
      env.defaultPaymentProvider) as PaymentProviderName;
    assertPaymentProviderEnabled(providerName);
    const provider = getPaymentProvider(providerName);
    const orderNo = `ORD${Date.now()}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    const order = await prisma.order.create({
      data: {
        licenseId: input.licenseId,
        orderNo,
        orderType: plan.type,
        productId: plan.id,
        amountCents: plan.priceCents,
        paymentProvider: providerName,
        status: 'PENDING',
      },
    });

    const payment = await provider.createPayment(order);
    return {
      order: publicOrder(order),
      payment,
    };
  },

  async getOrder(licenseId: string, orderNo: string) {
    const order = await prisma.order.findFirst({
      where: { orderNo, licenseId },
      include: {
        paymentTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!order) {
      throw new AppError(404, '订单不存在', 'ORDER_NOT_FOUND');
    }
    return {
      ...publicOrder(order),
      payments: order.paymentTransactions.map((item) => ({
        id: item.id,
        provider: item.provider,
        providerTransactionId: item.providerTransactionId,
        webhookEventId: item.webhookEventId,
        amountCents: item.amountCents,
        status: item.status,
        createdAt: item.createdAt,
      })),
    };
  },

  async handleProviderWebhook(provider: string, payload: unknown, headers: unknown) {
    const paymentProvider = getPaymentProvider(provider);
    const webhook = await paymentProvider.verifyWebhook(payload, headers);
    return paymentFulfillmentService.fulfillPaidWebhook(provider, webhook);
  },

  async completeMockPayment(input: {
    orderNo: string;
    signature?: string;
    providerTransactionId?: string;
    webhookEventId?: string;
  }) {
    const order = await prisma.order.findUnique({ where: { orderNo: input.orderNo } });
    if (!order) {
      throw new AppError(404, '订单不存在', 'ORDER_NOT_FOUND');
    }
    if (order.paymentProvider !== 'mock') {
      throw new AppError(400, '该订单不是 Mock 支付订单', 'NOT_MOCK_ORDER');
    }

    const providerTransactionId =
      input.providerTransactionId || `mock_txn_${order.orderNo}`;
    const webhookEventId = input.webhookEventId || `mock_evt_${order.orderNo}`;
    const payload = {
      orderNo: order.orderNo,
      amountCents: order.amountCents,
      providerTransactionId,
      webhookEventId,
      signature: input.signature,
    };
    const headers = {
      'x-mock-signature': input.signature,
    };

    return this.handleProviderWebhook('mock', payload, headers);
  },
};

export type { WebhookResult };
