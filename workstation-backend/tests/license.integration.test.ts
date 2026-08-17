import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { hashLicenseCode } from '../src/services/licenseToken.service';

const app = createApp();

describe('license authorization (/api/v1/licenses)', () => {
  const activationCode = `USB-${randomUUID()}`;
  const planCode = `plan-${randomUUID()}`;
  let licenseId = '';
  let accessToken = '';

  beforeAll(async () => {
    await connectDatabase();
    const plan = await prisma.plan.create({
      data: {
        code: planCode,
        name: 'License API Test Plan',
        type: 'DEVICE_PRODUCT',
        priceCents: 0,
        billingCycle: 'ONE_TIME',
        allowedProductTypes: ['HR_AGENT'],
      },
    });
    const license = await prisma.license.create({
      data: {
        licenseCodeHash: hashLicenseCode(activationCode),
        productType: 'HR_AGENT',
        planId: plan.id,
      },
    });
    licenseId = license.id;
  });

  afterAll(async () => {
    await prisma.deviceBinding.deleteMany({ where: { licenseId } });
    await prisma.creditWallet.deleteMany({ where: { licenseId } });
    await prisma.license.deleteMany({ where: { id: licenseId } });
    await prisma.plan.deleteMany({ where: { code: planCode } });
    await disconnectDatabase();
  });

  it('rejects an invalid activation code', async () => {
    const response = await request(app)
      .post('/api/v1/licenses/activate')
      .send({
        activationCode: 'invalid-code',
        usbFingerprint: 'usb-1',
        deviceFingerprint: 'device-1',
      })
      .expect(401);

    expect(response.body.code).toBe('INVALID_ACTIVATION_CODE');
  });

  it('activates without user JWT and returns a signed License Token', async () => {
    const response = await request(app)
      .post('/api/v1/licenses/activate')
      .send({
        activationCode,
        usbFingerprint: 'usb-1',
        deviceFingerprint: 'device-1',
        deviceName: 'Test workstation',
      })
      .expect(200);

    accessToken = response.body.data.accessToken;
    expect(accessToken).toBeTruthy();
    expect(response.body.data.authorization).toMatchObject({
      licenseId,
      productType: 'HR_AGENT',
      planCode,
    });

    const stored = await prisma.license.findUniqueOrThrow({ where: { id: licenseId } });
    const binding = await prisma.deviceBinding.findFirstOrThrow({ where: { licenseId } });
    expect(stored.licenseCodeHash).toBe(hashLicenseCode(activationCode));
    expect(stored.licenseCodeHash).not.toContain(activationCode);
    expect(binding.usbFingerprintHash).not.toBe('usb-1');
    expect(binding.deviceFingerprintHash).not.toBe('device-1');
  });

  it('verifies and returns current server-derived license context', async () => {
    const verify = await request(app)
      .post('/api/v1/licenses/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200);
    expect(verify.body.data.valid).toBe(true);
    expect(verify.body.data.authorization.licenseId).toBe(licenseId);

    const current = await request(app)
      .get('/api/v1/licenses/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(current.body.data.license.status).toBe('ACTIVE');
    expect(current.body.data.license.wallet.balance).toBe(0);
  });

  it('rejects client attempts to provide licenseId', async () => {
    const response = await request(app)
      .post('/api/v1/licenses/heartbeat')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ licenseId: 'spoofed-license' })
      .expect(400);
    expect(response.body.code).toBe('CLIENT_LICENSE_ID_FORBIDDEN');
  });

  it('updates heartbeat timestamps', async () => {
    const response = await request(app)
      .post('/api/v1/licenses/heartbeat')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200);
    expect(response.body.data.heartbeatAt).toBeTruthy();
  });

  it('enforces the configured device binding limit', async () => {
    await request(app)
      .post('/api/v1/licenses/activate')
      .send({
        activationCode,
        usbFingerprint: 'usb-2',
        deviceFingerprint: 'device-2',
      })
      .expect(200);

    const response = await request(app)
      .post('/api/v1/licenses/activate')
      .send({
        activationCode,
        usbFingerprint: 'usb-3',
        deviceFingerprint: 'device-3',
      })
      .expect(409);
    expect(response.body.code).toBe('DEVICE_BINDING_LIMIT_REACHED');
  });

  it('rejects an existing token after the License is suspended', async () => {
    await prisma.license.update({
      where: { id: licenseId },
      data: { status: 'SUSPENDED' },
    });
    const response = await request(app)
      .post('/api/v1/licenses/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(403);
    expect(response.body.code).toBe('LICENSE_SUSPENDED');
  });
});
