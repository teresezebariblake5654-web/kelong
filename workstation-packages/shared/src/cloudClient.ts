import type {
  AccountProfile,
  AnalyzeRequest,
  AnalyzeResponse,
  AuthSessionPayload,
  AuthUserSummary,
  CreditBalance,
  CreditLedgerPage,
  CreditSummary,
  ImageAnalyzeRequest,
  ImageAnalyzeResponse,
  OrganizationSummary,
  PlanSummary,
  RechargeOrder,
  RechargePlan,
  RechargeSettings,
  WalletSnapshot,
} from './types.js';
import type {
  ChatMessage,
  Conversation,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from './chat.js';

export type CloudClientOptions = {
  baseUrl: string;
  getAccessToken: () => string | null;
  /** When provided, org-scoped requests inject `X-Organization-Id`. */
  getOrganizationId?: () => string | null;
  getRefreshToken?: () => string | null;
  /** Persist rotated tokens after silent refresh. */
  onSessionTokens?: (tokens: { accessToken: string; refreshToken?: string }) => void;
  /** Called when refresh fails and session should be cleared. */
  onSessionExpired?: () => void;
};

type RequestOptions = {
  /** Attach `X-Organization-Id` from getOrganizationId (org-scoped APIs only). */
  withOrganization?: boolean;
};

export function createCloudClient(options: CloudClientOptions) {
  let refreshInFlight: Promise<boolean> | null = null;

  async function rawRequest(
    path: string,
    init: RequestInit = {},
    reqOptions: RequestOptions = {},
  ) {
    const headers = new Headers(init.headers || {});
    const token = options.getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    if (reqOptions.withOrganization) {
      const organizationId = options.getOrganizationId?.() ?? null;
      if (organizationId) {
        headers.set('X-Organization-Id', organizationId);
      }
    }

    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${options.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: init.credentials ?? 'include',
    });
    return { response, data: await parseJsonSafe(response) };
  }

  async function parseJsonSafe(response: Response) {
    try {
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      return { payload, ok: response.ok && payload.success !== false };
    } catch {
      return {
        payload: { message: `请求失败：${response.status}`, code: 'BAD_RESPONSE' },
        ok: false,
      };
    }
  }

  async function trySilentRefresh(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const refreshToken = options.getRefreshToken?.() ?? null;
        const headers = new Headers({ 'Content-Type': 'application/json' });
        const response = await fetch(`${options.baseUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};
        if (!response.ok || payload.success === false || !payload.data?.accessToken) {
          options.onSessionExpired?.();
          return false;
        }
        const data = payload.data as AuthSessionPayload;
        options.onSessionTokens?.({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
        return true;
      } catch {
        options.onSessionExpired?.();
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function request(path: string, init: RequestInit = {}, reqOptions: RequestOptions = {}) {
    const first = await rawRequest(path, init, reqOptions);
    if (first.data.ok) return first.data.payload.data;

    const status = first.response.status;
    const message = first.data.payload.message || `请求失败：${status}`;
    const code = first.data.payload.code || 'REQUEST_FAILED';
    const isAuthPath = path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/refresh') || path.includes('/email-otp/');

    if (status === 401 && !isAuthPath && options.getRefreshToken) {
      const refreshed = await trySilentRefresh();
      if (refreshed) {
        const second = await rawRequest(path, init, reqOptions);
        if (second.data.ok) return second.data.payload.data;
        const err2 = new Error(second.data.payload.message || `请求失败：${second.response.status}`) as Error & {
          status?: number;
          code?: string;
        };
        err2.status = second.response.status;
        err2.code = second.data.payload.code || 'REQUEST_FAILED';
        throw err2;
      }
    }

    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = status;
    error.code = code;
    throw error;
  }

  return {
    sendEmailOtp(body: {
      email: string;
      purpose: 'register' | 'login';
    }): Promise<{ retryAfterSec: number; expiresInSec: number; mockCode?: string }> {
      return request('/api/v1/auth/email-otp/send', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    login(body: {
      email: string;
      password?: string;
      code?: string;
    }): Promise<AuthSessionPayload> {
      return request('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    register(body: {
      email: string;
      username: string;
      password: string;
      code?: string;
      organizationName?: string;
    }): Promise<AuthSessionPayload> {
      return request('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    refresh(body?: { refreshToken?: string }): Promise<AuthSessionPayload> {
      return request('/api/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
    },
    me(): Promise<AuthUserSummary> {
      return request('/api/v1/auth/me');
    },
    uploadAvatar(file: Blob, filename = 'avatar.png'): Promise<AuthUserSummary> {
      const body = new FormData();
      body.append('avatar', file, filename);
      return request('/api/v1/auth/me/avatar', {
        method: 'POST',
        body,
      });
    },
    /** Must NOT send X-Organization-Id (listing orgs must not depend on active org). */
    listOrganizations(): Promise<OrganizationSummary[]> {
      return request('/api/v1/organizations');
    },
    getAccountProfile(): Promise<AccountProfile> {
      return request('/api/v1/account/profile', {}, { withOrganization: true });
    },
    getCreditBalance(): Promise<CreditBalance> {
      return request('/api/v1/credits/balance', {}, { withOrganization: true });
    },
    getCreditSummary(): Promise<CreditSummary> {
      return request('/api/v1/credits/summary', {}, { withOrganization: true });
    },
    getCreditLedger(
      params: { page?: number; pageSize?: number; type?: string } = {},
    ): Promise<CreditLedgerPage> {
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (params.type) query.set('type', params.type);
      return request(`/api/v1/credits/ledger?${query.toString()}`, {}, { withOrganization: true });
    },
    getRechargePlans(): Promise<RechargePlan[]> {
      return request('/api/v1/recharge/plans');
    },
    getRechargeSettings(): Promise<RechargeSettings> {
      return request('/api/v1/recharge/settings');
    },
    createRechargeOrder(body: {
      planId: string;
      paymentMethod?: string;
      payerRemark?: string;
    }): Promise<RechargeOrder> {
      return request('/api/v1/recharge/orders', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    getRechargeOrders(): Promise<RechargeOrder[]> {
      return request('/api/v1/recharge/orders');
    },
    getRechargeOrder(id: string): Promise<RechargeOrder> {
      return request(`/api/v1/recharge/orders/${encodeURIComponent(id)}`);
    },
    markRechargeOrderPaid(
      id: string,
      body: { payerRemark?: string } = {},
    ): Promise<RechargeOrder> {
      return request(`/api/v1/recharge/orders/${encodeURIComponent(id)}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    cancelRechargeOrder(id: string): Promise<RechargeOrder> {
      return request(`/api/v1/recharge/orders/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        body: '{}',
      });
    },
    submitFeedback(body: {
      category: string;
      content: string;
      contact?: string;
      emailConsent: true;
    }): Promise<{ id: string; delivered: boolean }> {
      return request('/api/v1/feedback', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    uploadFile(file: Blob, fileName?: string): Promise<{
      fileId: string;
      originalName: string;
      size: number;
      extension: string;
      createdAt: string;
    }> {
      const form = new FormData();
      form.append('file', file, fileName);
      return request(
        '/api/files/upload',
        {
          method: 'POST',
          body: form,
        },
        { withOrganization: true },
      );
    },
    getFile(fileId: string) {
      return request(`/api/files/${encodeURIComponent(fileId)}`, {}, { withOrganization: true });
    },
    activateLicense(body: {
      activationCode: string;
      usbFingerprint: string;
      deviceFingerprint: string;
      deviceName?: string;
    }) {
      return request('/api/v1/licenses/activate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    verifyLicense() {
      return request('/api/v1/licenses/verify', {
        method: 'POST',
        body: '{}',
      });
    },
    heartbeat() {
      return request('/api/v1/licenses/heartbeat', {
        method: 'POST',
        body: '{}',
      });
    },
    currentLicense() {
      return request('/api/v1/licenses/current');
    },
    wallet(): Promise<WalletSnapshot> {
      return request('/api/v1/wallet');
    },
    usage(limit = 50) {
      return request(`/api/v1/usage?limit=${limit}`);
    },
    plans(): Promise<PlanSummary[]> {
      return request('/api/v1/plans');
    },
    createOrder(body: { planCode: string; paymentProvider?: 'mock' | 'wechat' | 'alipay' }) {
      return request('/api/v1/orders', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    analyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
      return request(
        '/api/v1/ai/analyze',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        { withOrganization: true },
      );
    },
    analyzeImage(body: ImageAnalyzeRequest): Promise<ImageAnalyzeResponse> {
      return request(
        '/api/v1/ai/analyze-image',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        { withOrganization: true },
      );
    },
    aiTask(taskId: string) {
      return request(
        `/api/v1/ai/tasks/${encodeURIComponent(taskId)}`,
        {},
        { withOrganization: true },
      );
    },
    listConversations(): Promise<Conversation[]> {
      return request('/api/v1/conversations', {}, { withOrganization: true });
    },
    createConversation(body: { agentCode: Conversation['agentCode'] }): Promise<Conversation> {
      return request(
        '/api/v1/conversations',
        { method: 'POST', body: JSON.stringify(body) },
        { withOrganization: true },
      );
    },
    getConversationMessages(conversationId: string): Promise<ChatMessage[]> {
      return request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
        {},
        { withOrganization: true },
      );
    },
    deleteConversation(conversationId: string): Promise<void> {
      return request(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
        { method: 'DELETE' },
        { withOrganization: true },
      );
    },
    sendChatMessage(body: SendChatMessageRequest): Promise<SendChatMessageResponse> {
      return request(
        '/api/v1/chat/messages',
        { method: 'POST', body: JSON.stringify(body) },
        { withOrganization: true },
      );
    },
  };
}

export type CloudClient = ReturnType<typeof createCloudClient>;

