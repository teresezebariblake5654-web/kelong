export type ProductType =
  | 'HR_AGENT'
  | 'PRODUCTION_AGENT'
  | 'LOGISTICS_AGENT'
  | 'UNIVERSAL_AGENT';

export type LicenseStatus =
  | 'UNACTIVATED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REVOKED';

export type LicenseAuthorization = {
  licenseId: string;
  productType: ProductType;
  planCode?: string;
  deviceBindingId: string;
};

export type WalletSnapshot = {
  balance: number;
  reservedBalance: number;
  totalPurchased: number;
  totalGranted: number;
  totalConsumed: number;
  updatedAt?: string;
};

export type StructuredDataPayload = Record<string, unknown>;

export type AnalyzeRequest = {
  taskCode: string;
  templateVersion: string;
  structuredData: StructuredDataPayload;
  clientRequestId: string;
  /** 兼容别名：与 taskCode 相同 */
  templateCode?: string;
  /** 用户附加指令；为空时使用模板默认分析 */
  userInstruction?: string;
};

export type AnalyzeResponse = {
  taskId: string;
  taskCode: string;
  templateVersion: string;
  status: string;
  creditsCharged: number;
  creditsReserved?: number;
  result: unknown;
  clientRequestId?: string;
  errorCode?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  idempotent?: boolean;
};

export type ImageAnalyzeRequest = {
  fileId: string;
  instruction?: string;
};

export type ImageAnalysisResult = {
  summary: string;
  extractedText: string;
  details: string[];
};

export type ImageAnalyzeResponse = {
  status: 'COMPLETED';
  result: ImageAnalysisResult;
};

export type AccountProfile = {
  user: {
    id: string;
    displayName: string | null;
    email: string | null;
  };
  organization: {
    id: string;
    name: string;
    role: string;
  };
};

export type CreditBalance = {
  balance: number;
  frozenBalance: number;
  availableBalance: number;
  unit: 'credits';
  updatedAt: string;
};

export type CreditSummary = {
  organizationId: string;
  balance: number;
  frozenBalance: number;
  availableBalance: number;
  monthlyConsumed: number;
  totalRecharged: number;
  totalConsumed: number;
  /** True when availableBalance < CREDIT_LOW_BALANCE_THRESHOLD (App credits). */
  lowBalance?: boolean;
  unit: 'credits';
  updatedAt: string;
};

export type CreditLedgerType =
  | 'INITIAL'
  | 'CONSUME'
  | 'REFUND'
  | 'ADMIN_ADJUST'
  | 'RECHARGE';

export type CreditLedgerItem = {
  id: string;
  type: CreditLedgerType | string;
  sourceType?: string | null;
  amount: number;
  balanceBefore?: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
};

export type CreditLedgerPage = {
  items: CreditLedgerItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type RechargePlan = {
  id: string;
  name: string;
  priceCents: number;
  creditAmount: number;
  description: string | null;
};

export type RechargeSettings = {
  wechatQrUrl: string | null;
  alipayQrUrl: string | null;
  wechatQrByAmount?: Record<string, string>;
  alipayQrByAmount?: Record<string, string>;
  payeeName: string | null;
  supportText: string | null;
  notice: string | null;
};

export type RechargeOrder = {
  id: string;
  orderNo: string;
  userId: string;
  planId: string | null;
  planNameSnapshot: string;
  amountCents: number;
  creditAmount: number;
  paymentMethod: string;
  status: string;
  payerRemark: string | null;
  adminRemark: string | null;
  userSubmittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanSummary = {
  id: string;
  code: string;
  name: string;
  type: string;
  priceCents: number;
  billingCycle: string;
  includedCredits: number;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  plan?: string;
  role: string;
  membershipId?: string;
};

export type AuthUserSummary = {
  id: string;
  username: string;
  email: string;
  phone?: string | null;
  role: string;
  vipLevel: string;
  credits: number;
  status: string;
  /** Relative path like `/static/avatars/...` or absolute URL. */
  avatarUrl?: string | null;
  organizations?: OrganizationSummary[];
};

export type AuthSessionPayload = {
  accessToken: string;
  /** Present for SPA / Electron clients that cannot rely on httpOnly cookies alone. */
  refreshToken?: string;
  expiresIn: string;
  user: AuthUserSummary;
  organizations: OrganizationSummary[];
};

export type LocalJobRole = 'hr' | 'production' | 'logistics';

export const PRODUCT_BY_ROLE: Record<LocalJobRole, ProductType> = {
  hr: 'HR_AGENT',
  production: 'PRODUCTION_AGENT',
  logistics: 'LOGISTICS_AGENT',
};

/** Pick active organization: single org auto-select; else keep previous if still valid. */
export function resolveActiveOrganizationId(
  organizations: OrganizationSummary[],
  previousActiveId?: string | null,
): string | null {
  if (organizations.length === 1) {
    return organizations[0]!.id;
  }
  if (
    previousActiveId &&
    organizations.some((org) => org.id === previousActiveId)
  ) {
    return previousActiveId;
  }
  return null;
}

