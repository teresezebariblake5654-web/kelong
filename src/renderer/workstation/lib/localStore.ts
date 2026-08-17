import type { AuthUserSummary, LicenseAuthorization, OrganizationSummary } from '@aw/shared';
import type { AgentRole } from '@aw/task-templates';
import type { DepartmentCode } from '@workstation/data/departmentAgents';

const TOKEN_KEY = 'lobsterai.workstation.licenseToken';
const AUTH_KEY = 'lobsterai.workstation.authorization';
const USER_TOKEN_KEY = 'lobsterai.workstation.userAccessToken';
const USER_REFRESH_TOKEN_KEY = 'lobsterai.workstation.userRefreshToken';
const LAST_LOGIN_EMAIL_KEY = 'lobsterai.workstation.lastLoginEmail';
const ACTIVE_ORG_KEY = 'lobsterai.workstation.activeOrganizationId';
const ORGS_KEY = 'lobsterai.workstation.organizations';
const USER_KEY = 'lobsterai.workstation.user';
const HISTORY_KEY = 'lobsterai.workstation.history';
const SETTINGS_KEY = 'lobsterai.workstation.settings';
const FAVORITES_KEY = 'lobsterai.workstation.templateFavorites';
const USAGE_KEY = 'lobsterai.workstation.templateUsage';
const RECENT_TEMPLATES_KEY = 'lobsterai.workstation.recentTemplates';
const WORKSPACE_KEY = 'lobsterai.workstation.workspace';

export type AppSettings = {
  apiBaseUrl: string;
  deviceName: string;
};

export type TaskStatus = 'completed' | 'failed' | 'running' | 'cancelled';

export type HistoryItem = {
  id: string;
  createdAt: string;
  role: AgentRole;
  taskCode: string;
  taskName: string;
  fileName: string;
  summary?: string;
  /** 完整 AI 分析结果，用于恢复对话 */
  analysisText?: string;
  userInstruction?: string;
  status?: TaskStatus;
  progress?: number;
  creditsCharged?: number;
  /** 关联部门智能体会话，用于从历史恢复对话 */
  departmentCode?: DepartmentCode;
  sessionId?: string;
};

export type TemplateUsageStat = {
  count: number;
  lastUsedAt: string;
};

export type WorkspaceProfile = {
  organizationName: string;
  usbStatus: 'connected' | 'offline' | 'unknown';
};

function defaultApiBaseUrl(): string {
  try {
    const vite = (import.meta as ImportMeta & { env?: { PROD?: boolean; VITE_WORKSTATION_API_BASE_URL?: string } }).env;
    if (vite?.VITE_WORKSTATION_API_BASE_URL) return vite.VITE_WORKSTATION_API_BASE_URL.replace(/\/$/, '');
    if (vite?.PROD) return 'https://api.bx-aigc.com';
  } catch {
    // ignore
  }
  return 'http://127.0.0.1:3001';
}

function sanitizeApiBaseUrl(url: string): string {
  const normalized = String(url || '').trim().replace(/\/$/, '');
  try {
    const vite = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
    if (vite?.PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(normalized)) {
      return 'https://api.bx-aigc.com';
    }
  } catch {
    // ignore
  }
  return normalized || defaultApiBaseUrl();
}

export function loadSettings(): AppSettings {
  const envDefault = defaultApiBaseUrl();
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return {
      apiBaseUrl: envDefault,
      deviceName: 'Windows Workstation',
    };
  }
  const parsed = JSON.parse(raw) as AppSettings;
  let apiBaseUrl = sanitizeApiBaseUrl(parsed.apiBaseUrl || envDefault);
  // Explicit Vite env always wins — avoids stale localStorage stuck on 127.0.0.1:3001.
  try {
    const vite = (import.meta as ImportMeta & { env?: { VITE_WORKSTATION_API_BASE_URL?: string } }).env;
    if (vite?.VITE_WORKSTATION_API_BASE_URL?.trim()) {
      apiBaseUrl = vite.VITE_WORKSTATION_API_BASE_URL.trim().replace(/\/$/, '');
    }
  } catch {
    // ignore
  }
  return {
    ...parsed,
    apiBaseUrl,
  };
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadWorkspace(): WorkspaceProfile {
  const raw = localStorage.getItem(WORKSPACE_KEY);
  if (!raw) {
    return {
      organizationName: '演示企业',
      usbStatus: 'connected',
    };
  }
  return JSON.parse(raw) as WorkspaceProfile;
}

export function saveWorkspace(profile: WorkspaceProfile) {
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(profile));
}

export function getLicenseToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setLicenseSession(token: string, authorization: LicenseAuthorization) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(AUTH_KEY, JSON.stringify(authorization));
}

export function clearLicenseSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthorization(): LicenseAuthorization | null {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? (JSON.parse(raw) as LicenseAuthorization) : null;
}

export function getUserAccessToken(): string | null {
  return localStorage.getItem(USER_TOKEN_KEY);
}

export function setUserAccessToken(token: string) {
  localStorage.setItem(USER_TOKEN_KEY, token);
}

export function clearUserAccessToken() {
  localStorage.removeItem(USER_TOKEN_KEY);
}

export function getUserRefreshToken(): string | null {
  return localStorage.getItem(USER_REFRESH_TOKEN_KEY);
}

export function setUserRefreshToken(token: string) {
  localStorage.setItem(USER_REFRESH_TOKEN_KEY, token);
}

export function clearUserRefreshToken() {
  localStorage.removeItem(USER_REFRESH_TOKEN_KEY);
}

export function getLastLoginEmail(): string | null {
  return localStorage.getItem(LAST_LOGIN_EMAIL_KEY);
}

export function setLastLoginEmail(email: string) {
  const trimmed = email.trim();
  if (trimmed) localStorage.setItem(LAST_LOGIN_EMAIL_KEY, trimmed);
}

export function clearLastLoginEmail() {
  localStorage.removeItem(LAST_LOGIN_EMAIL_KEY);
}

export function getActiveOrganizationId(): string | null {
  return localStorage.getItem(ACTIVE_ORG_KEY);
}

export function setActiveOrganizationId(organizationId: string) {
  localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
}

export function clearActiveOrganizationId() {
  localStorage.removeItem(ACTIVE_ORG_KEY);
}

export function loadOrganizations(): OrganizationSummary[] {
  const raw = localStorage.getItem(ORGS_KEY);
  return raw ? (JSON.parse(raw) as OrganizationSummary[]) : [];
}

export function saveOrganizations(organizations: OrganizationSummary[]) {
  localStorage.setItem(ORGS_KEY, JSON.stringify(organizations));
}

export function loadUserProfile(): AuthUserSummary | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUserSummary) : null;
}

export function saveUserProfile(user: AuthUserSummary) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUserSession() {
  clearUserAccessToken();
  clearUserRefreshToken();
  clearActiveOrganizationId();
  localStorage.removeItem(ORGS_KEY);
  localStorage.removeItem(USER_KEY);
}

export function loadHistory(): HistoryItem[] {
  const raw = localStorage.getItem(HISTORY_KEY);
  return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
}

export function pushHistory(item: HistoryItem) {
  const next = [item, ...loadHistory()].slice(0, 100);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export function updateHistoryItem(id: string, patch: Partial<HistoryItem>) {
  const next = loadHistory().map((item) => (item.id === id ? { ...item, ...patch } : item));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export function loadFavorites(): string[] {
  const raw = localStorage.getItem(FAVORITES_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export function toggleFavorite(templateCode: string): string[] {
  const current = new Set(loadFavorites());
  if (current.has(templateCode)) current.delete(templateCode);
  else current.add(templateCode);
  const next = Array.from(current);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  return next;
}

export function loadTemplateUsage(): Record<string, TemplateUsageStat> {
  const raw = localStorage.getItem(USAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, TemplateUsageStat>) : {};
}

export function recordTemplateUse(templateCode: string) {
  const usage = loadTemplateUsage();
  const prev = usage[templateCode];
  usage[templateCode] = {
    count: (prev?.count ?? 0) + 1,
    lastUsedAt: new Date().toISOString(),
  };
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));

  const recent = loadRecentTemplateCodes().filter((code) => code !== templateCode);
  recent.unshift(templateCode);
  localStorage.setItem(RECENT_TEMPLATES_KEY, JSON.stringify(recent.slice(0, 20)));
}

export function loadRecentTemplateCodes(): string[] {
  const raw = localStorage.getItem(RECENT_TEMPLATES_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export function monthOverview(history: HistoryItem[]) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthItems = history.filter((item) => new Date(item.createdAt).getTime() >= monthStart);
  const files = new Set(monthItems.map((item) => item.fileName).filter(Boolean)).size;
  const completed = monthItems.filter((item) => (item.status ?? 'completed') === 'completed').length;
  const credits = monthItems.reduce((sum, item) => sum + (item.creditsCharged ?? 0), 0);
  // Heuristic: each completed task ~12 minutes saved vs manual
  const minutesSaved = completed * 12;
  return { files, completed, credits, minutesSaved };
}

