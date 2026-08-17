import type { LicenseAuthorization, PlanSummary, WalletSnapshot } from '@aw/shared';

export type LicenseActivateInput = {
  activationCode: string;
  usbFingerprint: string;
  deviceFingerprint: string;
  deviceName?: string;
};

export type LicenseSession = {
  accessToken: string;
  authorization: LicenseAuthorization;
};

export type LicenseVerifyResult = {
  valid: boolean;
  authorization: LicenseAuthorization;
};

export interface LicenseService {
  activate(input: LicenseActivateInput): Promise<LicenseSession>;
  verify(): Promise<LicenseVerifyResult>;
}

export interface WalletService {
  getWallet(): Promise<WalletSnapshot>;
  listPlans(): Promise<PlanSummary[]>;
  createOrder(input: {
    planCode: string;
    paymentProvider?: 'mock' | 'wechat' | 'alipay';
  }): Promise<{ order: Record<string, unknown> }>;
  getUsage(limit?: number): Promise<unknown[]>;
}

export type AppServices = {
  license: LicenseService;
  wallet: WalletService;
};
