#!/usr/bin/env bash
# Run on the production box after uploading this migration:
#   scp -i ~/.ssh/id_ed25519_bx_aigc -r workstation-backend/prisma/migrations/20260805030000_add_feedback_submission \
#     ubuntu@43.161.217.147:/opt/lobsterai/workstation-backend/prisma/migrations/
set -euo pipefail
cd /opt/lobsterai/workstation-backend

if grep -q "^SIGNUP_BONUS_CREDITS=" .env; then
  sed -i "s/^SIGNUP_BONUS_CREDITS=.*/SIGNUP_BONUS_CREDITS=20000/" .env
else
  echo "SIGNUP_BONUS_CREDITS=20000" >> .env
fi

# Placeholder SMTP auth causes hard fail before FormSubmit fallback in some paths;
# clear pass so delivery falls through to FormSubmit / shared SMTP.
if grep -q "^FEEDBACK_SMTP_PASS=" .env; then
  sed -i "s/^FEEDBACK_SMTP_PASS=.*/FEEDBACK_SMTP_PASS=/" .env
fi

npx prisma migrate deploy
pm2 restart workstation-api --update-env
pm2 save
echo "---"
grep -E "^(SIGNUP_BONUS_CREDITS|FEEDBACK_SMTP_PASS|FEEDBACK_INBOX)" .env || true
curl -s http://127.0.0.1:3001/api/v1/ready || true
