import nodemailer from 'nodemailer';
import * as tencentSes from 'tencentcloud-sdk-nodejs-ses';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const SesClient = tencentSes.ses.v20201002.Client;

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendOtpTemplateInput = {
  to: string;
  subject: string;
  /** Variables for SES email template, e.g. { username, verify_code } */
  templateData: Record<string, string | number>;
};

let sesClient: InstanceType<typeof SesClient> | null = null;

function getSesClient(): InstanceType<typeof SesClient> {
  if (sesClient) return sesClient;
  if (!env.tencentSecretId || !env.tencentSecretKey) {
    throw new Error('TENCENT_SECRET_ID / TENCENT_SECRET_KEY is not configured');
  }
  sesClient = new SesClient({
    credential: {
      secretId: env.tencentSecretId,
      secretKey: env.tencentSecretKey,
    },
    region: env.tencentSesRegion,
    profile: {
      httpProfile: {
        endpoint: 'ses.tencentcloudapi.com',
      },
    },
  });
  return sesClient;
}

/**
 * Send OTP via Tencent SES template API (SendEmail + Template).
 * Do NOT use BatchSendEmail for OTP — each recipient needs a unique code.
 */
export async function sendOtpViaSesTemplate(
  input: SendOtpTemplateInput,
): Promise<{ provider: string; messageId?: string }> {
  if (!env.mailFrom) {
    throw new Error('MAIL_FROM is required for SES template send');
  }
  if (!env.tencentSesOtpTemplateId || env.tencentSesOtpTemplateId <= 0) {
    throw new Error('TENCENT_SES_OTP_TEMPLATE_ID is required for SES template send');
  }

  const fromAddress = env.mailFromName
    ? `${env.mailFromName} <${env.mailFrom}>`
    : env.mailFrom;

  const client = getSesClient();
  const res = await client.SendEmail({
    FromEmailAddress: fromAddress,
    Destination: [input.to],
    Subject: input.subject,
    Template: {
      TemplateID: env.tencentSesOtpTemplateId,
      TemplateData: JSON.stringify(input.templateData),
    },
    TriggerType: 1, // 触发类：验证码
  });

  logger.info('mail_ses_template_sent', {
    to: input.to,
    templateId: env.tencentSesOtpTemplateId,
    messageId: res.MessageId,
  });

  return { provider: 'ses-api', messageId: res.MessageId };
}

/**
 * Mail sender: mock | smtp | ses-api (Tencent Cloud SES template API for OTP).
 */
export async function sendMail(input: SendMailInput): Promise<{ provider: string }> {
  if (env.mailProvider === 'mock') {
    logger.info('mail_mock_send', {
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { provider: 'mock' };
  }

  if (env.mailProvider === 'ses-api') {
    throw new Error(
      'MAIL_PROVIDER=ses-api requires sendOtpViaSesTemplate() (template SendEmail), not plain sendMail()',
    );
  }

  if (!env.smtpHost || !env.smtpUser || !env.smtpPass || !env.mailFrom) {
    throw new Error('SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM)');
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });

  await transporter.sendMail({
    from: env.mailFromName ? `"${env.mailFromName}" <${env.mailFrom}>` : env.mailFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? `<pre style="font-family:sans-serif">${input.text}</pre>`,
  });

  return { provider: 'smtp' };
}

function salesSmtpConfigured(): boolean {
  return Boolean(
    env.salesEmailHost && env.salesEmailUser && env.salesEmailPassword && env.salesEmailFrom,
  );
}

export function isSharedSmtpConfigured(): boolean {
  return Boolean(
    env.mailProvider === 'smtp' && env.smtpHost && env.smtpUser && env.smtpPass && env.mailFrom,
  );
}

export function isSalesEmailTransportConfigured(): boolean {
  return salesSmtpConfigured() || isSharedSmtpConfigured();
}

/**
 * Sales outbound mail. Reuses nodemailer / existing SMTP; optional SALES_EMAIL_* override.
 * Does not use MAIL_PROVIDER=ses-api (OTP-only).
 */
export async function sendSalesMail(
  input: SendMailInput,
): Promise<{ provider: string; messageId?: string }> {
  if (salesSmtpConfigured()) {
    const transporter = nodemailer.createTransport({
      host: env.salesEmailHost,
      port: env.salesEmailPort,
      secure: env.salesEmailSecure,
      auth: {
        user: env.salesEmailUser,
        pass: env.salesEmailPassword,
      },
    });
    const info = await transporter.sendMail({
      from: env.salesEmailFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? `<pre style="font-family:sans-serif">${input.text}</pre>`,
    });
    return {
      provider: 'sales-smtp',
      messageId: typeof info.messageId === 'string' ? info.messageId : undefined,
    };
  }

  if (env.mailProvider === 'mock') {
    logger.info('mail_mock_send', {
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { provider: 'mock', messageId: `mock-${Date.now()}` };
  }

  if (!isSharedSmtpConfigured()) {
    throw new Error('Sales SMTP is not configured');
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });
  const info = await transporter.sendMail({
    from: env.mailFromName ? `"${env.mailFromName}" <${env.mailFrom}>` : env.mailFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? `<pre style="font-family:sans-serif">${input.text}</pre>`,
  });
  return {
    provider: 'smtp',
    messageId: typeof info.messageId === 'string' ? info.messageId : undefined,
  };
}
