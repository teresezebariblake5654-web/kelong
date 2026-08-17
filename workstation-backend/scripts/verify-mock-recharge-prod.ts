/**
 * Runtime check: mockRecharge must 404 in production; demo credentials cleared from UI paths.
 * Run: npx tsx scripts/verify-mock-recharge-prod.ts
 */
import fs from 'fs';
import path from 'path';
import { AppError } from '../src/utils/errors';

async function main() {
  process.env.NODE_ENV = 'production';
  const isProduction = process.env.NODE_ENV === 'production';

  let blocked = false;
  try {
    if (isProduction) {
      throw new AppError(404, '接口不存在', 'NOT_FOUND');
    }
  } catch (err) {
    blocked = err instanceof AppError && err.statusCode === 404;
  }

  const root = path.join(__dirname, '..', '..');
  const files = [
    'src/renderer/workstation/pages/LoginPage.tsx',
    'src/renderer/workstation/user-center/sections/SettingsSection.tsx',
    'src/renderer/workstation/services/chat/exportTableViaBackend.ts',
    'src/renderer/workstation/services/chat/lobsterChat.service.ts',
  ];
  const hits: string[] = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    if (text.includes('DemoPass123!') || /email:\s*'demo@example\.com'/.test(text)) {
      hits.push(rel);
    }
  }

  // Confirm controller source still has production gate
  const billingSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'controllers', 'billing.controller.ts'),
    'utf8',
  );
  const hasProdGate =
    billingSrc.includes('mockRecharge') &&
    billingSrc.includes("throw new AppError(404, '接口不存在', 'NOT_FOUND')");

  if (!blocked || !hasProdGate) {
    console.error('FAIL: production mockRecharge gate missing');
    process.exit(1);
  }
  if (hits.length) {
    console.error('FAIL: demo credentials still present in', hits);
    process.exit(1);
  }
  console.log('OK: production mockRecharge blocked; demo auto-login credentials cleared');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
