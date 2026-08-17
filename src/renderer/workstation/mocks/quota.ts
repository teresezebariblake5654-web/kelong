import type { UsageQuota } from '@workstation/types';

export const mockUsageQuota: UsageQuota = {
  balance: 860,
  reserved: 0,
  monthlyConsumed: 140,
  monthlyGranted: 1000,
  lowBalanceThreshold: 50,
};
