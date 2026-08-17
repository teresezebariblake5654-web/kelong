import { Order } from '@prisma/client';
import { AppError } from '../../utils/errors';
import {
  PaymentProvider,
  PaymentResult,
  PaymentStatus,
  RefundResult,
  WebhookResult,
} from './types';

/** Placeholder for future Alipay integration. */
export class AlipayPaymentProvider implements PaymentProvider {
  async createPayment(_order: Order): Promise<PaymentResult> {
    throw new AppError(501, '支付宝支付尚未接入', 'ALIPAY_NOT_IMPLEMENTED');
  }

  async verifyWebhook(_payload: unknown, _headers: unknown): Promise<WebhookResult> {
    throw new AppError(501, '支付宝回调尚未接入', 'ALIPAY_NOT_IMPLEMENTED');
  }

  async queryPayment(_orderNo: string): Promise<PaymentStatus> {
    throw new AppError(501, '支付宝查询尚未接入', 'ALIPAY_NOT_IMPLEMENTED');
  }

  async refund(_orderNo: string, _amountCents: number): Promise<RefundResult> {
    throw new AppError(501, '支付宝退款尚未接入', 'ALIPAY_NOT_IMPLEMENTED');
  }
}
