import { Order } from '@prisma/client';

export type PaymentStatus = 'PENDING' | 'PAID' | 'CLOSED' | 'REFUNDED' | 'FAILED';

export type PaymentResult = {
  provider: string;
  paymentSessionId: string;
  payUrl?: string;
  qrCode?: string;
  expiresAt?: Date;
  raw?: Record<string, unknown>;
};

export type WebhookResult = {
  orderNo: string;
  providerTransactionId: string;
  webhookEventId: string;
  amountCents: number;
  status: PaymentStatus;
  paidAt?: Date;
  rawPayloadHash: string;
};

export type RefundResult = {
  orderNo: string;
  refundId: string;
  amountCents: number;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
};

export interface PaymentProvider {
  createPayment(order: Order): Promise<PaymentResult>;
  verifyWebhook(payload: unknown, headers: unknown): Promise<WebhookResult>;
  queryPayment(orderNo: string): Promise<PaymentStatus>;
  refund(orderNo: string, amountCents: number): Promise<RefundResult>;
}
