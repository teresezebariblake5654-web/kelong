#!/usr/bin/env node
/**
 * Lightweight go-live smoke probes against a live API base URL.
 *
 * Usage:
 *   node scripts/smoke-go-live.cjs
 *   node scripts/smoke-go-live.cjs https://api.bx-aigc.com
 *
 * Exit 0 only if health (and optional static QR HEAD) succeed.
 * Full matrix (OTP/mail/recharge/chat) remains manual — see docs/go-live-product-readiness.md
 */
const base = String(process.argv[2] || process.env.APP_BASE_URL || 'https://api.bx-aigc.com')
  .trim()
  .replace(/\/$/, '');

const qrPaths = [
  '/static/payment/alipay-qr-50.png',
  '/static/payment/alipay-qr-100.png',
  '/static/payment/alipay-qr-500.png',
  '/static/payment/wechat-qr-50.png',
  '/static/payment/wechat-qr-100.png',
  '/static/payment/wechat-qr-500.png',
];

async function probe(method, path) {
  const url = `${base}${path}`;
  const res = await fetch(url, { method, redirect: 'follow' });
  return { url, status: res.status, ok: res.ok };
}

async function main() {
  const results = [];
  let failed = 0;

  console.log(`[smoke-go-live] base=${base}`);

  for (const path of ['/api/v1/health', '/api/health', '/health']) {
    try {
      const r = await probe('GET', path);
      results.push(r);
      console.log(`  ${r.status} ${r.url}`);
      if (r.ok) break;
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${base}${path}: ${err.message}`);
    }
  }

  const healthOk = results.some((r) => r.ok);
  if (!healthOk) {
    console.error('[smoke-go-live] health check failed');
    process.exit(1);
  }

  for (const path of qrPaths) {
    try {
      const r = await probe('HEAD', path);
      const alt = r.status === 405 ? await probe('GET', path) : r;
      console.log(`  ${alt.status} ${alt.url}`);
      if (!alt.ok) failed += 1;
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${base}${path}: ${err.message}`);
    }
  }

  if (failed) {
    console.error(`[smoke-go-live] ${failed} probe(s) failed`);
    process.exit(1);
  }
  console.log('[smoke-go-live] OK (health + QR assets). Complete remaining matrix manually.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
