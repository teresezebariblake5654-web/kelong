import crypto from 'crypto';
import { Order } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { hashToken } from '../../services/token.service';
import {
  PaymentProvider,
  PaymentResult,
  PaymentStatus,
  RefundResult,
  WebhookResult,
} from './types';

function sign(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload);
  return crypto.createHmac('sha256', env.mockPaymentSecret).update(canonical).digest('hex');
}

export class MockPaymentProvider implements PaymentProvider {
  async createPayment(order: Order): Promise<PaymentResult> {
    const paymentSessionId = `mock_pay_${order.orderNo}`;
    return {
      provider: 'mock',
      paymentSessionId,
      payUrl: `${env.appBaseUrl}/api/v1/payments/mock/complete?orderNo=${order.orderNo}`,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      raw: {
        instruction: 'Call POST /api/v1/payments/mock/complete with orderNo and signature',
      },
    };
  }

  async verifyWebhook(payload: unknown, headers: unknown): Promise<WebhookResult> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppError(400, 'Mock 支付回调无效', 'INVALID_MOCK_WEBHOOK');
    }
    const body = payload as Record<string, unknown>;
    const orderNo = typeof body.orderNo === 'string' ? body.orderNo : '';
    const amountCents = Number(body.amountCents);
    const providerTransactionId =
      typeof body.providerTransactionId === 'string'
        ? body.providerTransactionId
        : `mock_txn_${orderNo}`;
    const webhookEventId =
      typeof body.webhookEventId === 'string' ? body.webhookEventId : `mock_evt_${orderNo}`;
    const signature =
      (typeof headers === 'object' &&
        headers &&
        !Array.isArray(headers) &&
        typeof (headers as Record<string, unknown>)['x-mock-signature'] === 'string' &&
        String((headers as Record<string, unknown>)['x-mock-signature'])) ||
      (typeof body.signature === 'string' ? body.signature : '');

    if (!orderNo || !Number.isInteger(amountCents) || amountCents <= 0 || !signature) {
      throw new AppError(400, 'Mock 支付回调参数不完整', 'INVALID_MOCK_WEBHOOK');
    }

    const expected = sign({
      orderNo,
      amountCents,
      providerTransactionId,
      webhookEventId,
    });
    if (signature !== expected) {
      throw new AppError(401, 'Mock 支付签名校验失败', 'INVALID_PAYMENT_SIGNATURE');
    }

    return {
      orderNo,
      providerTransactionId,
      webhookEventId,
      amountCents,
      status: 'PAID',
      paidAt: new Date(),
      rawPayloadHash: hashToken(JSON.stringify(body)),
    };
  }

  async queryPayment(orderNo: string): Promise<PaymentStatus> {
    const order = await prisma.order.findUnique({ where: { orderNo } });
    if (!order) {
      throw new AppError(404, '订单不存在', 'ORDER_NOT_FOUND');
    }
    return order.status as PaymentStatus;
  }

  async refund(orderNo: string, amountCents: number): Promise<RefundResult> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new AppError(400, '退款金额无效', 'INVALID_REFUND_AMOUNT');
    }
    return {
      orderNo,
      refundId: `mock_refund_${orderNo}_${Date.now()}`,
      amountCents,
      status: 'SUCCEEDED',
    };
  }
}

export function createMockPaymentSignature(input: {
  orderNo: string;
  amountCents: number;
  providerTransactionId: string;
  webhookEventId: string;
}): string {
  return sign(input);
}
