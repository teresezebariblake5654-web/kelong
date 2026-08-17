import { License, Plan } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';
import { deviceBindingService } from './deviceBinding.service';
import {
  hashDeviceFingerprint,
  hashLicenseCode,
  hashUsbFingerprint,
  LicenseAuthorization,
  signLicenseAccessToken,
} from './licenseToken.service';

export type ActivateLicenseInput = {
  activationCode: string;
  usbFingerprint: string;
  deviceFingerprint: string;
  deviceName?: string;
};

type LicenseWithPlan = License & { plan: Plan | null };

function assertLicenseUsable(license: License): void {
  if (license.status === 'SUSPENDED') {
    throw new AppError(403, 'License 已暂停', 'LICENSE_SUSPENDED');
  }
  if (license.status === 'REVOKED') {
    throw new AppError(403, 'License 已撤销', 'LICENSE_REVOKED');
  }
  if (license.status === 'EXPIRED' || (license.expiresAt && license.expiresAt <= new Date())) {
    throw new AppError(403, 'License 已过期', 'LICENSE_EXPIRED');
  }
}

function authorizationFrom(
  license: LicenseWithPlan,
  deviceBindingId: string,
): LicenseAuthorization {
  return {
    licenseId: license.id,
    productType: license.productType,
    planCode: license.plan?.code,
    deviceBindingId,
  };
}

function publicLicense(
  license: LicenseWithPlan & {
    wallet?: { balance: number; reservedBalance: number } | null;
  },
) {
  return {
    id: license.id,
    productType: license.productType,
    status: license.status,
    planCode: license.plan?.code,
    activatedAt: license.activatedAt,
    expiresAt: license.expiresAt,
    lastSeenAt: license.lastSeenAt,
    wallet: license.wallet
      ? {
          balance: license.wallet.balance,
          reservedBalance: license.wallet.reservedBalance,
        }
      : undefined,
  };
}

export const licenseService = {
  async activate(input: ActivateLicenseInput) {
    const license = await prisma.license.findUnique({
      where: { licenseCodeHash: hashLicenseCode(input.activationCode) },
      include: { plan: true, wallet: true },
    });
    if (!license) {
      throw new AppError(401, '激活码无效', 'INVALID_ACTIVATION_CODE');
    }
    assertLicenseUsable(license);

    const now = new Date();
    const activated = await prisma.license.updateMany({
      where: {
        id: license.id,
        status: { in: ['UNACTIVATED', 'ACTIVE'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        status: 'ACTIVE',
        activatedAt: license.activatedAt ?? now,
        lastSeenAt: now,
      },
    });
    if (activated.count !== 1) {
      const current = await prisma.license.findUniqueOrThrow({ where: { id: license.id } });
      assertLicenseUsable(current);
      throw new AppError(409, 'License 状态已变化，请重试', 'LICENSE_STATE_CHANGED');
    }

    const binding = await deviceBindingService.bind({
      licenseId: license.id,
      usbFingerprintHash: hashUsbFingerprint(input.usbFingerprint),
      deviceFingerprintHash: hashDeviceFingerprint(input.deviceFingerprint),
      deviceName: input.deviceName,
    });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.creditWallet.upsert({
        where: { licenseId: license.id },
        create: { licenseId: license.id },
        update: {},
      });
      return tx.license.update({
        where: { id: license.id },
        data: {
          lastSeenAt: now,
        },
        include: { plan: true, wallet: true },
      });
    });

    const authorization = authorizationFrom(updated, binding.id);
    return {
      ...signLicenseAccessToken(authorization),
      license: publicLicense(updated),
    };
  },

  async getCurrent(authorization: LicenseAuthorization) {
    const license = await prisma.license.findUnique({
      where: { id: authorization.licenseId },
      include: { plan: true, wallet: true },
    });
    if (!license) {
      throw new AppError(401, 'License 不存在', 'LICENSE_NOT_FOUND');
    }
    assertLicenseUsable(license);
    return {
      authorization: authorizationFrom(license, authorization.deviceBindingId),
      license: publicLicense(license),
    };
  },

  async heartbeat(authorization: LicenseAuthorization) {
    const now = new Date();
    const [, binding] = await prisma.$transaction([
      prisma.license.update({
        where: { id: authorization.licenseId },
        data: { lastSeenAt: now },
      }),
      prisma.deviceBinding.update({
        where: { id: authorization.deviceBindingId },
        data: { lastSeenAt: now },
      }),
    ]);
    const current = await this.getCurrent(authorization);
    return {
      ...current,
      heartbeatAt: binding.lastSeenAt,
    };
  },
};
