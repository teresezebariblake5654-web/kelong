/**
 * Shared “整理为 Excel” helper for cloud + lobster chat modes.
 * Uses workstation-backend POST /api/v1/chat/export-table.
 */

import type { ExportTableResult } from './types';
import { getWorkstationApiBaseUrl, healthCheck } from '@workstation/services/workstationApi';

const TOKEN_KEY = 'lobsterai.workstation.userAccessToken';
const ORG_KEY = 'lobsterai.workstation.activeOrganizationId';

function clearWorkstationSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ORG_KEY);
  } catch {
    // ignore
  }
}

function isJwtExpired(token: string, skewSeconds = 60): boolean {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return true;
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp) return false;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
}

async function ensureWorkstationSession(force = false): Promise<void> {
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    const orgId = window.localStorage.getItem(ORG_KEY);
    if (!force && existing && orgId && !isJwtExpired(existing)) return;
  } catch {
    // ignore
  }

  // Do not silently log in as demo@example.com in production builds.
  throw new Error('请先登录工作站账号后再导出表格');
}

function authHeaderRecord(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    const orgId = window.localStorage.getItem(ORG_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (orgId) headers['X-Organization-Id'] = orgId;
  } catch {
    // ignore
  }
  return headers;
}

async function saveTableBytes(bytes: Uint8Array, fileName: string): Promise<boolean> {
  const browserBytes = new Uint8Array(bytes.byteLength);
  browserBytes.set(bytes);
  const blob = new Blob([browserBytes.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return true;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64ToText(base64: string): string {
  try {
    return new TextDecoder().decode(decodeBase64ToBytes(base64));
  } catch {
    return '';
  }
}

function extractErrorMessage(
  status: number,
  body: string,
  bodyBase64?: string,
  fallbackError?: string,
): string {
  const candidates = [body];
  if (bodyBase64) candidates.push(decodeBase64ToText(bodyBase64));
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw) as { message?: string };
      if (payload?.message) return String(payload.message);
    } catch {
      // ignore
    }
  }
  if (status === 401) return '登录已过期，请重试导出（将自动重新登录）';
  return fallbackError || `整理 Excel 失败：${status}`;
}

async function postExportTable(
  conversationId: string,
  content: string,
): Promise<{ ok: boolean; status: number; fileName?: string; bytes?: Uint8Array; message?: string }> {
  const path = '/api/v1/chat/export-table';
  const body = JSON.stringify({ conversationId, content });
  const headers = authHeaderRecord();
  const electronHttp = window.electron?.workstation?.http;

  if (electronHttp) {
    const result = await electronHttp({
      method: 'POST',
      path,
      headers,
      body,
      timeoutMs: 120_000,
      responseType: 'base64',
    } as Parameters<typeof electronHttp>[0] & { responseType: 'base64' });

    if (!result.ok) {
      return {
        ok: false,
        status: result.status || 0,
        message: extractErrorMessage(
          result.status || 0,
          result.body || '',
          (result as { bodyBase64?: string }).bodyBase64,
          result.error,
        ),
      };
    }

    const fileName = result.headers?.['x-file-name']
      ? decodeURIComponent(result.headers['x-file-name'])
      : 'AI整理表格.xlsx';
    const base64 = (result as { bodyBase64?: string }).bodyBase64 || '';
    if (!base64) {
      return { ok: false, status: result.status || 0, message: '导出表格失败：未收到文件数据' };
    }
    return { ok: true, status: result.status, fileName, bytes: decodeBase64ToBytes(base64) };
  }

  const response = await fetch(`${getWorkstationApiBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      message: extractErrorMessage(response.status, text),
    };
  }
  const encodedName = response.headers.get('X-File-Name');
  const fileName = encodedName ? decodeURIComponent(encodedName) : 'AI整理表格.xlsx';
  return {
    ok: true,
    status: response.status,
    fileName,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

/**
 * Export assistant markdown/text into an .xlsx via backend LLM table organizer.
 */
export async function exportMessageAsTableViaBackend(
  conversationId: string,
  content: string,
): Promise<ExportTableResult> {
  const health = await healthCheck(2500);
  if (!health.ok) {
    throw new Error(health.message || '工作站后端不可用，无法导出表格');
  }

  await ensureWorkstationSession(false);

  let result = await postExportTable(conversationId, content);
  if (!result.ok && result.status === 401) {
    clearWorkstationSession();
    await ensureWorkstationSession(true);
    result = await postExportTable(conversationId, content);
  }

  if (!result.ok || !result.bytes || !result.fileName) {
    throw new Error(result.message || `整理 Excel 失败：${result.status || 'unknown'}`);
  }

  const saved = await saveTableBytes(result.bytes, result.fileName);
  return { fileName: result.fileName, saved };
}
