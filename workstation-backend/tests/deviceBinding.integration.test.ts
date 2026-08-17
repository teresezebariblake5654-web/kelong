import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { deviceBindingService } from '../src/services/deviceBinding.service';

describe('device binding limit', () => {
  let licenseId: string;

  beforeAll(async () => {
    await connectDatabase();
    const license = await prisma.license.create({
      data: {
        licenseCodeHash: `device-test-${randomUUID()}`,
        productType: 'HR_AGENT',
      },
    });
    licenseId = license.id;
  });

  afterAll(async () => {
    await prisma.deviceBinding.deleteMany({ where: { licenseId } });
    await prisma.license.delete({ where: { id: licenseId } });
    await disconnectDatabase();
  });

  it('allows the configured number of devices and rejects the next one', async () => {
    await deviceBindingService.bind({
      licenseId,
      usbFingerprintHash: 'usb-hash-1',
      deviceFingerprintHash: 'device-hash-1',
      deviceName: 'Device 1',
    });
    await deviceBindingService.bind({
      licenseId,
      usbFingerprintHash: 'usb-hash-2',
      deviceFingerprintHash: 'device-hash-2',
      deviceName: 'Device 2',
    });

    await expect(
      deviceBindingService.bind({
        licenseId,
        usbFingerprintHash: 'usb-hash-3',
        deviceFingerprintHash: 'device-hash-3',
        deviceName: 'Device 3',
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_BINDING_LIMIT_REACHED' });
  });
});
