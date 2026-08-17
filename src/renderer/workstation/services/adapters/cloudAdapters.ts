import { createCloudClient } from '@aw/shared';
import type { LicenseAuthorization } from '@aw/shared';
import { getLicenseToken, loadSettings } from '../../lib/localStore';
import type { LicenseService, WalletService } from '../types';

function createClient() {
  const settings = loadSettings();
  return createCloudClient({
    baseUrl: settings.apiBaseUrl.replace(/\/$/, ''),
    getAccessToken: getLicenseToken,
  });
}

export const cloudLicenseService: LicenseService = {
  async activate(input) {
    const data = (await createClient().activateLicense(input)) as {
      accessToken: string;
      authorization: LicenseAuthorization;
    };
    return {
      accessToken: data.accessToken,
      authorization: data.authorization,
    };
  },
  async verify() {
    const data = (await createClient().verifyLicense()) as {
      valid?: boolean;
      authorization: LicenseAuthorization;
    };
    return {
      valid: data.valid ?? true,
      authorization: data.authorization,
    };
  },
};

export const cloudWalletService: WalletService = {
  async getWallet() {
    return createClient().wallet();
  },
  async listPlans() {
    return createClient().plans();
  },
  async createOrder(input) {
    return createClient().createOrder(input) as Promise<{ order: Record<string, unknown> }>;
  },
  async getUsage(limit = 50) {
    return createClient().usage(limit);
  },
};
