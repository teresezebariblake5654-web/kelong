import { cloudLicenseService, cloudWalletService } from './adapters/cloudAdapters';
import type { AppServices } from './types';

let services: AppServices | null = null;

export function getServices(): AppServices {
  if (!services) {
    services = {
      license: cloudLicenseService,
      wallet: cloudWalletService,
    };
  }
  return services;
}
