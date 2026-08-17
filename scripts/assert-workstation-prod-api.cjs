#!/usr/bin/env node
/**
 * Fail production packaging when workstation API still points at localhost.
 * Used by dist:win / release scripts before electron-builder.
 */
const required = 'https://api.bx-aigc.com';

function normalize(value) {
  return String(value || '')
    .trim()
    .replace(/\/$/, '');
}

function isLocalhost(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
}

const viteUrl = normalize(process.env.VITE_WORKSTATION_API_BASE_URL);
const mainUrl = normalize(process.env.WORKSTATION_API_BASE_URL);
const mode = String(process.env.NODE_ENV || process.env.ELECTRON_BUILD_MODE || '').toLowerCase();
const forceCheck =
  process.argv.includes('--production') ||
  mode === 'production' ||
  process.env.WORKSTATION_REQUIRE_PROD_API === '1';

if (!forceCheck) {
  console.log('[assert-workstation-prod-api] skip (dev/non-production). Pass --production to enforce.');
  process.exit(0);
}

if (!viteUrl || !mainUrl) {
  console.error(
    `[assert-workstation-prod-api] Missing API URL.\n` +
      `Set both:\n` +
      `  VITE_WORKSTATION_API_BASE_URL=${required}\n` +
      `  WORKSTATION_API_BASE_URL=${required}`,
  );
  process.exit(1);
}

for (const url of [viteUrl, mainUrl]) {
  if (isLocalhost(url)) {
    console.error(
      `[assert-workstation-prod-api] Refusing localhost API in production build: ${url}\n` +
        `Use ${required}`,
    );
    process.exit(1);
  }
  if (!url.startsWith('https://')) {
    console.error(`[assert-workstation-prod-api] Production API must be HTTPS: ${url}`);
    process.exit(1);
  }
}

if (viteUrl !== mainUrl) {
  console.error(
    `[assert-workstation-prod-api] VITE_ and WORKSTATION_ API URLs must match.\n` +
      `  VITE_WORKSTATION_API_BASE_URL=${viteUrl}\n` +
      `  WORKSTATION_API_BASE_URL=${mainUrl}`,
  );
  process.exit(1);
}

if (viteUrl !== required) {
  console.error(
    `[assert-workstation-prod-api] Production API must be exactly ${required}\n` +
      `  got: ${viteUrl}`,
  );
  process.exit(1);
}

console.log(`[assert-workstation-prod-api] OK → ${viteUrl}`);
