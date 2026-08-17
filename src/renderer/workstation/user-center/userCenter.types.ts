export type UserCenterSection =
  | 'overview'
  | 'recharge'
  | 'credits'
  | 'usage'
  | 'help'
  | 'settings';

/** All credit amounts kept as strings to avoid JS number precision loss. */
export type CreditOverview = {
  balance: string;
  monthlyConsumed: string;
  totalRecharged: string;
  totalConsumed: string;
  /** From backend CREDIT_LOW_BALANCE_THRESHOLD. */
  lowBalance?: boolean;
  updatedAt?: string;
};

export type CreditLedgerFilter = 'all' | 'recharge' | 'ai_consume';

export type CreditLedgerRow = {
  id: string;
  type: string;
  sourceType: string | null;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  description: string;
  createdAt: string;
};

export type CreditLedgerView = {
  items: CreditLedgerRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type RechargePlanView = {
  id: string;
  name: string;
  priceCents: number;
  /** Display-only yuan string from priceCents / 100 */
  priceYuan: string;
  creditAmount: string;
  description: string;
};

export type RechargeSettingsView = {
  wechatQrUrl: string | null;
  alipayQrUrl: string | null;
  /** Fixed-amount WeChat QR by yuan: "50" | "100" | "500". */
  wechatQrByAmount: Record<string, string>;
  /** Fixed-amount Alipay QR by yuan: "50" | "100" | "500". */
  alipayQrByAmount: Record<string, string>;
  payeeName: string | null;
  supportText: string | null;
  notice: string | null;
};

export type RechargePaymentMethod = 'wechat' | 'alipay';

export type RechargeOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_REVIEW'
  | 'PAID'
  | 'REJECTED'
  | 'CANCELLED'
  | string;

export type RechargeOrderView = {
  id: string;
  orderNo: string;
  planName: string;
  amountCents: number;
  priceYuan: string;
  creditAmount: string;
  paymentMethod: string;
  status: RechargeOrderStatus;
  payerRemark: string | null;
  adminRemark: string | null;
  createdAt: string;
  reviewedAt: string | null;
  userSubmittedAt: string | null;
};

export type UsageRecord = {
  id: string;
  createdAt: string;
  agentName: string;
  departmentCode: string;
  workMode: string;
  credits: number;
  status: 'success' | 'failed' | 'pending';
};

export type UserCenterProfile = {
  displayName: string;
  organizationName: string;
  roleLabel: string;
  loggedIn: boolean;
  avatarUrl?: string | null;
  avatarInitials: string;
};

export type FeedbackRequestInput = {
  category: string;
  content: string;
  contact?: string;
  /** User must consent to send feedback by email. */
  emailConsent: boolean;
};

/** @deprecated Phase 7 uses createRechargeOrder */
export type RechargeRequestInput = {
  amount: number;
  channel: RechargePaymentMethod;
  note?: string;
};
