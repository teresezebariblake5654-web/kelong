import type { CreditOverview, UserCenterProfile } from './userCenter.types';

export const MOCK_FAQ = [
  {
    q: 'AI 积分如何扣费？',
    a: '每次 AI 分析成功后按实际消耗扣除积分。',
  },
  {
    q: '购买多久到账？',
    a: '选套餐后直接扫码付款，付完点「我已付款」，积分立刻到账。',
  },
];

/** Fallback profile when local session is empty — UI still renders. */
export const MOCK_FALLBACK_PROFILE: UserCenterProfile = {
  displayName: '张明',
  organizationName: '未来科技有限公司',
  roleLabel: '企业管理员',
  loggedIn: true,
  avatarUrl: null,
  avatarInitials: '张',
};

/** Empty overview placeholder (strings only; never used as mock billed balance). */
export const EMPTY_CREDIT_OVERVIEW: CreditOverview = {
  balance: '0',
  monthlyConsumed: '0',
  totalRecharged: '0',
  totalConsumed: '0',
  lowBalance: false,
};
