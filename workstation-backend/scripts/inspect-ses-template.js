#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const tencentSes = require('tencentcloud-sdk-nodejs-ses');

const appDir = process.argv[2] || '/opt/lobsterai/workstation-backend';
const envPath = path.join(appDir, '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const i = trimmed.indexOf('=');
  if (i <= 0) continue;
  process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1);
}

const Client = tencentSes.ses.v20201002.Client;
const templateId = Number(process.env.TENCENT_SES_OTP_TEMPLATE_ID || 0);
const client = new Client({
  credential: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
  },
  region: process.env.TENCENT_SES_REGION || 'ap-guangzhou',
  profile: { httpProfile: { endpoint: 'ses.tencentcloudapi.com' } },
});

function decodePart(value) {
  if (!value) return null;
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return value;
  }
}

(async () => {
  process.chdir(appDir);
  const detail = await client.GetEmailTemplate({ TemplateID: templateId });
  const html = decodePart(detail.TemplateContent && detail.TemplateContent.Html);
  const text = decodePart(detail.TemplateContent && detail.TemplateContent.Text);
  console.log(
    JSON.stringify(
      {
        TemplateID: templateId,
        TemplateName: detail.TemplateName,
        TemplateStatus: detail.TemplateStatus,
        html,
        text,
      },
      null,
      2,
    ),
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
