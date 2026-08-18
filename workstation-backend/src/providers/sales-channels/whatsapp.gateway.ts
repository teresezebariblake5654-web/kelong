import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { SalesChannelGateway, SalesSendMessageInput, SalesSendResult } from './sales-channel.types';

export function isWhatsAppChannelConfigured(): boolean {
  return Boolean(env.whatsappPhoneNumberId && env.whatsappAccessToken);
}

function graphUrl(path: string): string {
  const base = env.whatsappGraphBaseUrl.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}

export function buildWhatsAppTextPayload(to: string, content: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: content },
  };
}

export const whatsappChannelGateway: SalesChannelGateway = {
  isConfigured: isWhatsAppChannelConfigured,

  async sendMessage(input: SalesSendMessageInput): Promise<SalesSendResult> {
    if (!isWhatsAppChannelConfigured()) {
      throw new AppError(503, 'WhatsApp 通道未配置', 'CHANNEL_NOT_CONFIGURED');
    }

    const url = graphUrl(`${env.whatsappPhoneNumberId}/messages`);
    const payload = buildWhatsAppTextPayload(input.to, input.content);
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      logger.warn('[SalesWhatsApp]', {
        op: 'send',
        status: 'network_error',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const raw = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      body = { raw: raw.slice(0, 200) };
    }

    logger.info('[SalesWhatsApp]', {
      op: 'send',
      httpStatus: res.status,
      durationMs: Date.now() - started,
    });

    if (!res.ok) {
      const err = (body.error as { message?: string; code?: number } | undefined) ?? {};
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new AppError(
          res.status === 401 || res.status === 403 ? 503 : 400,
          err.message || 'WhatsApp 发送失败',
          res.status === 401 || res.status === 403 ? 'CHANNEL_NOT_CONFIGURED' : 'WHATSAPP_SEND_FAILED',
        );
      }
      throw new AppError(502, err.message || 'WhatsApp 发送失败', 'WHATSAPP_SEND_FAILED');
    }

    const messages = Array.isArray(body.messages) ? (body.messages as Array<{ id?: string }>) : [];
    const providerMessageId = messages[0]?.id;
    if (!providerMessageId) {
      throw new AppError(502, 'WhatsApp 未返回 message id', 'WHATSAPP_SEND_FAILED');
    }

    return {
      providerMessageId,
      providerMetadata: {
        provider: 'whatsapp-cloud',
        waId: typeof body.contacts === 'object' ? undefined : undefined,
      },
    };
  },
};
