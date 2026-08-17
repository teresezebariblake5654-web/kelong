import { prisma } from '../config/database';
import { deliverFeedbackMail } from './feedbackMail.service';
import { logger } from '../utils/logger';

export type SubmitFeedbackInput = {
  category: string;
  content: string;
  contact?: string;
  emailConsent: true;
  userId?: string | null;
  userLabel?: string | null;
};

export async function submitFeedbackRecord(input: SubmitFeedbackInput) {
  const subject = `[工作站反馈] ${input.category}`;
  const text = [
    `分类：${input.category}`,
    `联系方式：${input.contact?.trim() || '未填写'}`,
    `账号：${input.userLabel || 'anonymous'}`,
    '邮件同意：是',
    '',
    input.content,
  ].join('\n');

  const row = await prisma.feedbackSubmission.create({
    data: {
      category: input.category,
      content: input.content,
      contact: input.contact?.trim() || null,
      userId: input.userId ?? null,
      userLabel: input.userLabel ?? null,
      emailConsent: true,
      deliveryStatus: 'pending',
    },
  });

  const delivery = await deliverFeedbackMail({ subject, text });

  const updated = await prisma.feedbackSubmission.update({
    where: { id: row.id },
    data: {
      deliveryStatus: delivery.delivered ? 'sent' : 'failed',
      deliveryError: delivery.delivered ? null : delivery.error?.slice(0, 500) || 'delivery_failed',
    },
  });

  logger.info('feedback_submitted', {
    id: updated.id,
    category: input.category,
    provider: delivery.provider,
    delivered: delivery.delivered,
    userId: input.userId ?? null,
  });

  if (!delivery.delivered) {
    // Still accept the submission in-app; ops can read DB / logs.
    // Surface a soft failure only when nothing was persisted — persistence already succeeded.
    logger.warn('feedback_delivery_soft_fail', {
      id: updated.id,
      error: delivery.error,
      provider: delivery.provider,
    });
  }

  return {
    id: updated.id,
    delivered: delivery.delivered,
  };
}
