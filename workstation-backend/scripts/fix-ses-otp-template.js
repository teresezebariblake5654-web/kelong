#!/usr/bin/env node
/**
 * Fix SES OTP template 55917 to use dynamic {{username}} / {{verify_code}}.
 * Run on prod: node scripts/fix-ses-otp-template.js
 */
const fs = require('fs');
const path = require('path');
const tencentSes = require('tencentcloud-sdk-nodejs-ses');

const appDir = process.argv[2] || path.resolve(__dirname, '..');
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

const text = [
  '尊敬的{{username}}：',
  '',
  '您好！',
  '',
  '您正在进行 AI工作站 账号验证，验证码为：',
  '',
  '{{verify_code}}',
  '',
  '验证码 5 分钟内有效，请勿泄露给他人。',
  '如非本人操作，请忽略本邮件。',
  '',
  '平台客服：admin@bx-aigc.com',
  'AI工作站',
].join('\n');

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:8px;padding:32px 28px;color:#1f2937;line-height:1.7;">
    <p style="margin:0 0 16px;font-size:16px;">尊敬的{{username}}：</p>
    <p style="margin:0 0 12px;font-size:15px;">您好！</p>
    <p style="margin:0 0 12px;font-size:15px;">您正在进行 <strong>AI工作站</strong> 账号验证，验证码为：</p>
    <p style="margin:20px 0;font-size:32px;letter-spacing:6px;font-weight:700;color:#111827;text-align:center;">{{verify_code}}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;">验证码 5 分钟内有效，请勿泄露给他人。</p>
    <p style="margin:0 0 24px;font-size:14px;color:#4b5563;">如非本人操作，请忽略本邮件。</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
    <p style="margin:0;font-size:12px;color:#9ca3af;">平台客服：admin@bx-aigc.com<br/>AI工作站</p>
  </div>
</body>
</html>`;

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

(async () => {
  process.chdir(appDir);
  await client.UpdateEmailTemplate({
    TemplateID: templateId,
    TemplateName: '验证码通知',
    TemplateContent: {
      Text: b64(text),
      Html: b64(html),
    },
  });
  const detail = await client.GetEmailTemplate({ TemplateID: templateId });
  console.log(
    JSON.stringify(
      {
        TemplateID: templateId,
        TemplateName: detail.TemplateName,
        TemplateStatus: detail.TemplateStatus,
        statusMeaning: { 0: '审核通过', 1: '待审核', 2: '审核拒绝' }[
          detail.TemplateStatus
        ],
        textPreview: Buffer.from(detail.TemplateContent.Text || '', 'base64').toString('utf8'),
      },
      null,
      2,
    ),
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
