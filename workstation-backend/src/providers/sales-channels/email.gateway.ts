import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import {
  isSalesEmailTransportConfigured,
  sendSalesMail,
} from '../../services/mail.service';
import type { SalesChannelGateway, SalesSendMessageInput, SalesSendResult } from './sales-channel.types';

export function isEmailChannelConfigured(): boolean {
  return isSalesEmailTransportConfigured();
}

export const emailChannelGateway: SalesChannelGateway = {
  isConfigured: isEmailChannelConfigured,

  async sendMessage(input: SalesSendMessageInput): Promise<SalesSendResult> {
    if (!isEmailChannelConfigured()) {
      throw new AppError(503, 'Email 通道未配置', 'CHANNEL_NOT_CONFIGURED');
    }
    const result = await sendSalesMail({
      to: input.to,
      subject: input.subject || '(no subject)',
      text: input.content,
    });
    const providerMessageId =
      result.messageId || `smtp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      providerMessageId,
      providerMetadata: { provider: result.provider },
    };
  },
};
