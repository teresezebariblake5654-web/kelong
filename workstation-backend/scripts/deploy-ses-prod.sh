#!/usr/bin/env bash
set -euo pipefail
cd /opt/lobsterai/workstation-backend

echo "== mail env =="
grep -E '^(MAIL_PROVIDER|MAIL_FROM|TENCENT_SES_OTP_TEMPLATE_ID|TENCENT_SES_REGION)=' .env || true

cp /tmp/ses-deploy/mail.service.js dist/services/mail.service.js
cp /tmp/ses-deploy/emailOtp.service.js dist/services/emailOtp.service.js
cp /tmp/ses-deploy/env.js dist/config/env.js
cp /tmp/ses-deploy/package.json package.json
cp /tmp/ses-deploy/package-lock.json package-lock.json

npm install --omit=dev
test -d node_modules/tencentcloud-sdk-nodejs-ses
echo SES_SDK_OK

grep -c SendEmail dist/services/mail.service.js

pm2 restart workstation-api --update-env
sleep 4
curl -sS -m 15 http://127.0.0.1:3001/api/v1/ready || true
echo
pm2 logs workstation-api --lines 30 --nostream || true
