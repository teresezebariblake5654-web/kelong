import { env } from '../config/env';
import { logger } from '../utils/logger';

export type FeedbackMailResult = {
  provider: 'feedback-smtp' | 'smtp' | 'formsubmit';
  delivered: boolean;
  error?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendWithNodemailer(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.user, pass: input.pass },
  });
  await transporter.sendMail({
    from: input.fromName ? `"${input.fromName}" <${input.from}>` : input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(input.text)}</pre>`,
  });
}

/**
 * Deliver feedback to the configured inbox without exposing the address to clients.
 * Never opens a mail client — delivery stays server-side.
 */
export async function deliverFeedbackMail(input: {
  subject: string;
  text: string;
}): Promise<FeedbackMailResult> {
  const to = env.feedbackInboxEmail;
  const errors: string[] = [];

  // 1) Dedicated feedback SMTP (recommended for 126/QQ etc.)
  if (env.feedbackSmtpHost && env.feedbackSmtpUser && env.feedbackSmtpPass && env.feedbackSmtpFrom) {
    try {
      await sendWithNodemailer({
        host: env.feedbackSmtpHost,
        port: env.feedbackSmtpPort,
        secure: env.feedbackSmtpSecure,
        user: env.feedbackSmtpUser,
        pass: env.feedbackSmtpPass,
        from: env.feedbackSmtpFrom,
        fromName: env.mailFromName || 'Workhorse AI',
        to,
        subject: input.subject,
        text: input.text,
      });
      return { provider: 'feedback-smtp', delivered: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`feedback-smtp: ${msg}`);
      logger.warn('feedback_smtp_dedicated_failed', { error: msg });
    }
  }

  // 2) Shared app SMTP when fully configured
  if (env.smtpHost && env.smtpUser && env.smtpPass && env.mailFrom) {
    try {
      await sendWithNodemailer({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        user: env.smtpUser,
        pass: env.smtpPass,
        from: env.mailFrom,
        fromName: env.mailFromName || 'Workhorse AI',
        to,
        subject: input.subject,
        text: input.text,
      });
      return { provider: 'smtp', delivered: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`smtp: ${msg}`);
      logger.warn('feedback_smtp_shared_failed', { error: msg });
    }
  }

  // 3) FormSubmit relay (no local SMTP). First use may require inbox activation email.
  try {
    const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://workhorse.ai',
        Referer: 'https://workhorse.ai/feedback',
      },
      body: JSON.stringify({
        name: 'Workhorse Feedback',
        email: 'noreply@workhorse.ai',
        _subject: input.subject,
        message: input.text,
        _template: 'box',
        _captcha: 'false',
        _honey: '',
      }),
    });
    const rawText = await response.text();
    let payload: { success?: string | boolean; message?: string } = {};
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = { message: rawText.slice(0, 300) };
    }
    const ok =
      response.ok &&
      (payload.success === true ||
        payload.success === 'true' ||
        String(payload.message || '').toLowerCase().includes('success'));
    if (ok) {
      return { provider: 'formsubmit', delivered: true };
    }
    const errMsg = payload.message || `FormSubmit HTTP ${response.status}`;
    errors.push(`formsubmit: ${errMsg}`);
    logger.warn('feedback_formsubmit_failed', { status: response.status, errMsg });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    errors.push(`formsubmit: ${errMsg}`);
    logger.warn('feedback_formsubmit_error', { error: errMsg });
  }

  return {
    provider: 'formsubmit',
    delivered: false,
    error: errors.join(' | ') || 'delivery_failed',
  };
}
