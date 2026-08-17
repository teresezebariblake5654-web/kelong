/**
 * HTTP client for deterministic Excel/payroll tasks against workstation-backend.
 * Chat must NOT use this — use lobsterChatBridge / coworkService instead.
 *
 * In Electron, prefer main-process IPC proxy to avoid renderer fetch/CORS failures.
 */

const DEV_FALLBACK_API_BASE = 'http://127.0.0.1:3001';
const PROD_DEFAULT_API_BASE = 'https://api.bx-aigc.com';

function isPackagedRenderer(): boolean {
  try {
    const vite = (import.meta as ImportMeta & {
      env?: { PROD?: boolean; DEV?: boolean; MODE?: string };
    }).env;
    if (vite?.PROD === true) return true;
    if (vite?.DEV === true) return false;
    if (vite?.MODE === 'production') return true;
  } catch {
    // ignore
  }
  return false;
}

function readEnvBaseUrl(): string | undefined {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    if (vite?.VITE_WORKSTATION_API_BASE_URL) return vite.VITE_WORKSTATION_API_BASE_URL;
  } catch {
    // ignore
  }
  if (typeof process !== 'undefined' && process.env?.WORKSTATION_API_BASE_URL) {
    return process.env.WORKSTATION_API_BASE_URL;
  }
  if (typeof window !== 'undefined') {
    const fromWindow = (window as Window & { WORKSTATION_API_BASE_URL?: string }).WORKSTATION_API_BASE_URL;
    if (fromWindow) return fromWindow;
  }
  return undefined;
}

function assertProdApiBase(url: string): void {
  const normalized = url.replace(/\/$/, '');
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(normalized)) {
    throw new Error(
      '[workstationApi] Production build must not use localhost API. ' +
        'Set VITE_WORKSTATION_API_BASE_URL=https://api.bx-aigc.com before building.',
    );
  }
  if (!normalized.startsWith('https://')) {
    throw new Error(
      `[workstationApi] Production API must be HTTPS. Got: ${normalized}`,
    );
  }
}

export function getWorkstationApiBaseUrl(): string {
  const fromEnv = readEnvBaseUrl()?.replace(/\/$/, '');
  if (fromEnv) {
    if (isPackagedRenderer()) assertProdApiBase(fromEnv);
    return fromEnv;
  }
  if (isPackagedRenderer()) {
    return PROD_DEFAULT_API_BASE;
  }
  return DEV_FALLBACK_API_BASE;
}

export type HealthCheckResult = {
  ok: boolean;
  status?: number;
  message: string;
  baseUrl: string;
};

function authHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (extra) {
    const h = new Headers(extra);
    h.forEach((value, key) => {
      headers[key] = value;
    });
  }
  try {
    const token = window.localStorage.getItem('lobsterai.workstation.userAccessToken');
    const orgId = window.localStorage.getItem('lobsterai.workstation.activeOrganizationId');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (orgId) headers['X-Organization-Id'] = orgId;
  } catch {
    // ignore
  }
  return headers;
}

async function proxyOrFetch(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const electronHttp = window.electron?.workstation?.http;
  if (electronHttp) {
    const headers = authHeaders(init?.headers);
    if (init?.body && !(init.body instanceof FormData) && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    const result = await electronHttp({
      method: init?.method || 'GET',
      path: normalizedPath,
      headers,
      body: typeof init?.body === 'string' ? init.body : init?.body == null ? null : String(init.body),
      timeoutMs: init?.timeoutMs,
    });
    return {
      ok: result.ok,
      status: result.status,
      body: result.body || '',
      error: result.error,
    };
  }

  const baseUrl = getWorkstationApiBaseUrl();
  const headers = new Headers(authHeaders(init?.headers));
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  try {
    const response = await fetch(`${baseUrl}${normalizedPath}`, {
      ...init,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function healthCheck(timeoutMs = 4000): Promise<HealthCheckResult> {
  const baseUrl = getWorkstationApiBaseUrl();
  const paths = ['/api/v1/health', '/api/health', '/health'];
  let lastMessage = `无法连接工作站后端（${baseUrl}）`;

  for (const path of paths) {
    try {
      const result = await proxyOrFetch(path, { method: 'GET', timeoutMs });
      if (result.ok) {
        return { ok: true, status: result.status, message: 'ok', baseUrl };
      }
      lastMessage = `工作站后端不可用（HTTP ${result.status}）`;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      lastMessage = aborted
        ? `工作站后端健康检查超时：${baseUrl}`
        : `无法连接工作站后端（${baseUrl}）。请确认后端已启动。`;
    }
  }

  return { ok: false, message: lastMessage, baseUrl };
}

export async function workstationFetch<T = unknown>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const result = await proxyOrFetch(path, init);
  let payload: unknown = null;
  if (result.body) {
    try {
      payload = JSON.parse(result.body);
    } catch {
      payload = result.body;
    }
  }
  if (!result.ok) {
    const message =
      payload && typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : result.error || `请求失败：${result.status}`;
    throw new Error(message);
  }
  if (payload && typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export async function uploadWorkstationFile(
  path: string,
  file: File,
  fields?: Record<string, string>,
): Promise<unknown> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const electronHttp = window.electron?.workstation?.http;

  if (electronHttp) {
    const headers = authHeaders();
    delete headers['Content-Type'];
    delete headers['content-type'];
    const bodyBase64 = await fileToBase64(file);
    const result = await electronHttp({
      method: 'POST',
      path: normalizedPath,
      headers,
      multipartField: 'file',
      multipartFileName: file.name,
      bodyBase64,
      multipartExtraFields: fields,
      timeoutMs: 120_000,
    });
    let payload: unknown = null;
    if (result.body) {
      try {
        payload = JSON.parse(result.body);
      } catch {
        payload = result.body;
      }
    }
    if (!result.ok) {
      const message =
        payload && typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : result.error || `上传失败：${result.status}`;
      throw new Error(message);
    }
    if (payload && typeof payload === 'object' && payload !== null && 'data' in payload) {
      return (payload as { data: unknown }).data;
    }
    return payload;
  }

  const form = new FormData();
  form.append('file', file, file.name);
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
  }
  return workstationFetch(normalizedPath, { method: 'POST', body: form, timeoutMs: 120_000 });
}
