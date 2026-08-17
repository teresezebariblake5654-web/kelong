/**
 * One-shot SES SendEmail probe (uses workstation-backend/.env).
 * Usage: npx tsx scripts/probe-ses-otp.ts [toEmail]
 */
import 'dotenv/config';
import * as tencentSes from 'tencentcloud-sdk-nodejs-ses';

const SesClient = tencentSes.ses.v20201002.Client;

async function main() {
  const to = process.argv[2] || process.env.PROBE_TO_EMAIL || '';
  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';
  const region = process.env.TENCENT_SES_REGION || 'ap-guangzhou';
  const from = process.env.MAIL_FROM || '';
  const fromName = process.env.MAIL_FROM_NAME || 'AI工作站';
  const templateId = Number(process.env.TENCENT_SES_OTP_TEMPLATE_ID || 0);

  console.log('probe_config', {
    region,
    from,
    fromName,
    templateId,
    secretIdPrefix: secretId.slice(0, 8),
    hasSecretKey: Boolean(secretKey),
    to: to || '(none — dry credential check only)',
  });

  if (!secretId || !secretKey || !from || !templateId) {
    throw new Error('Missing TENCENT_* / MAIL_FROM / TENCENT_SES_OTP_TEMPLATE_ID in .env');
  }

  const client = new SesClient({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: 'ses.tencentcloudapi.com' } },
  });

  if (!to) {
    console.log('No recipient given; listing templates to verify credentials...');
    const list = await client.ListEmailTemplates({ Limit: 10, Offset: 0 });
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  const res = await client.SendEmail({
    FromEmailAddress: `${fromName} <${from}>`,
    Destination: [to],
    Subject: '注册验证码 - AI工作站',
    Template: {
      TemplateID: templateId,
      TemplateData: JSON.stringify({
        username: 'probe',
        verify_code: '123456',
      }),
    },
    TriggerType: 1,
  });
  console.log('SendEmail OK', res);
}

main().catch((err) => {
  console.error('SendEmail FAILED');
  console.error(err);
  process.exit(1);
});
