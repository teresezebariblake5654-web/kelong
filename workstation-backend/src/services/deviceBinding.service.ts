import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

export type BindDeviceInput = {
  licenseId: string;
  usbFingerprintHash: string;
  deviceFingerprintHash: string;
  deviceName?: string;
};

const MAX_SERIALIZATION_RETRIES = 3;

async function bindOnce(input: BindDeviceInput) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.deviceBinding.findUnique({
        where: {
          licenseId_usbFingerprintHash_deviceFingerprintHash: {
            licenseId: input.licenseId,
            usbFingerprintHash: input.usbFingerprintHash,
            deviceFingerprintHash: input.deviceFingerprintHash,
          },
        },
      });

      if (existing && !existing.revokedAt) {
        return tx.deviceBinding.update({
          where: { id: existing.id },
          data: {
            deviceName: input.deviceName,
            lastSeenAt: new Date(),
          },
        });
      }

      const activeBindings = await tx.deviceBinding.count({
        where: {
          licenseId: input.licenseId,
          revokedAt: null,
        },
      });
      if (activeBindings >= env.deviceBindingLimit) {
        throw new AppError(409, 'License 已达到设备绑定上限', 'DEVICE_BINDING_LIMIT_REACHED');
      }

      if (existing) {
        return tx.deviceBinding.update({
          where: { id: existing.id },
          data: {
            deviceName: input.deviceName,
            lastSeenAt: new Date(),
            revokedAt: null,
          },
        });
      }

      return tx.deviceBinding.create({
        data: input,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export const deviceBindingService = {
  async bind(input: BindDeviceInput) {
    if (!input.usbFingerprintHash.trim() || !input.deviceFingerprintHash.trim()) {
      throw new AppError(400, '设备指纹哈希不能为空', 'DEVICE_FINGERPRINT_REQUIRED');
    }

    for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
      try {
        return await bindOnce(input);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code) &&
          attempt < MAX_SERIALIZATION_RETRIES - 1
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new AppError(409, '设备绑定发生并发冲突，请重试', 'DEVICE_BINDING_CONFLICT');
  },
};
