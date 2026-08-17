#!/usr/bin/env bash
# Server cutover helper — run ON the CVM after secrets are in .env
# See docs/go-live-product-readiness.md and docs/tencent-cvm-deploy-beginner.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.production.example and fill secrets first."
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ "${NODE_ENV:-}" != "production" ]]; then
  echo "Refuse: NODE_ENV must be production (got: ${NODE_ENV:-empty})"
  exit 1
fi

if [[ "${ALLOW_DEMO_USER:-}" != "false" && "${ALLOW_DEMO_USER:-}" != "0" ]]; then
  echo "Refuse: set ALLOW_DEMO_USER=false before cutover seed"
  exit 1
fi

echo "==> prisma generate + migrate deploy"
npx prisma generate
npx prisma migrate deploy

echo "==> seed (admin + plans; no demo when ALLOW_DEMO_USER=false)"
npx prisma db seed

echo "==> optional demo cleanup (idempotent)"
npx tsx scripts/cleanup-demo-data.ts || true

echo "==> build"
npm run build

echo "==> pm2 reload (expects ecosystem or name workstation-backend)"
if command -v pm2 >/dev/null 2>&1; then
  pm2 describe workstation-backend >/dev/null 2>&1 \
    && pm2 reload workstation-backend \
    || pm2 start dist/server.js --name workstation-backend
  pm2 save || true
else
  echo "pm2 not installed — start manually: node dist/server.js"
fi

echo "==> smoke"
node scripts/smoke-go-live.cjs "${APP_BASE_URL:-https://api.bx-aigc.com}" || {
  echo "Smoke failed — check Nginx / static payment assets / process logs"
  exit 1
}

echo "Cutover script finished. Complete OTP/mail/recharge/chat matrix in go-live-product-readiness.md"
