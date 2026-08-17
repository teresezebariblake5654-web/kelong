import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { AlipayPaymentProvider } from './alipay.provider';
import { MockPaymentProvider } from './mock.provider';
import { PaymentProvider } from './types';
import { WechatPaymentProvider } from './wechat.provider';

export type PaymentProviderName = 'mock' | 'manual' | 'wechat' | 'alipay';

export function assertPaymentProviderEnabled(name: PaymentProviderName): void {
  if (name === 'manual') {
    throw new AppError(
      501,
      '请使用扫码充值（/api/v1/recharge），不支持自动支付下单',
      'PAYMENT_MANUAL_ONLY',
    );
  }
  if (name === 'wechat' && !env.wechatPayEnabled) {
    throw new AppError(501, '微信支付尚未启用', 'WECHAT_PAY_DISABLED');
  }
  if (name === 'alipay' && !env.alipayEnabled) {
    throw new AppError(501, '支付宝尚未启用', 'ALIPAY_DISABLED');
  }
}

export function getPaymentProvider(name?: string): PaymentProvider {
  const provider = (name || env.defaultPaymentProvider) as PaymentProviderName;
  if (provider === 'manual') {
    throw new AppError(
      501,
      '请使用扫码充值（/api/v1/recharge），不支持自动支付下单',
      'PAYMENT_MANUAL_ONLY',
    );
  }
  if (provider === 'mock') return new MockPaymentProvider();
  if (provider === 'wechat') return new WechatPaymentProvider();
  if (provider === 'alipay') return new AlipayPaymentProvider();
  throw new AppError(400, `不支持的支付渠道: ${provider}`, 'UNSUPPORTED_PAYMENT_PROVIDER');
}

export type {
  PaymentProvider,
  PaymentResult,
  PaymentStatus,
  RefundResult,
  WebhookResult,
} from './types';
export { createMockPaymentSignature } from './mock.provider';
