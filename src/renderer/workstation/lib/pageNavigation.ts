import { WORKFLOW_STEPS } from '@workstation/constants/workflow';

/** 主导航页：不显示返回 */
const ROOT_PATHS = new Set([
  '/chat',
  '/templates',
  '/home',
  '/quota',
  '/files',
  '/wallet',
  '/history',
  '/file-upload',
  '/image-analysis',
  '/account',
  '/account/credits',
  '/account/help',
  '/launch',
  '/activate',
  '/login',
]);

export function getPageBackFallback(pathname: string): string | null {
  if (ROOT_PATHS.has(pathname)) return null;

  if (/^\/templates\/[^/]+$/.test(pathname)) return '/';

  const stepIndex = WORKFLOW_STEPS.findIndex((step) => step.path === pathname);
  if (stepIndex >= 0) {
    return stepIndex > 0 ? WORKFLOW_STEPS[stepIndex - 1]!.path : '/templates';
  }

  return null;
}

export function shouldShowPageBack(pathname: string): boolean {
  return getPageBackFallback(pathname) !== null;
}

const NEXT_BLOCKED_KEYS = new Set(['progress', 'report', 'history']);

export function getPageNextTarget(pathname: string): string | null {
  const stepIndex = WORKFLOW_STEPS.findIndex((step) => step.path === pathname);
  if (stepIndex < 0) return null;

  const currentKey = WORKFLOW_STEPS[stepIndex]?.key;
  if (!currentKey || NEXT_BLOCKED_KEYS.has(currentKey)) return null;
  if (stepIndex >= WORKFLOW_STEPS.length - 1) return null;

  return WORKFLOW_STEPS[stepIndex + 1]!.path;
}

export function shouldShowPageNext(pathname: string): boolean {
  return getPageNextTarget(pathname) !== null;
}

export function isImmersivePage(pathname: string): boolean {
  return pathname === '/chat' || /^\/templates\/[^/]+$/.test(pathname);
}
