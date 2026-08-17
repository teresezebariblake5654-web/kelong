import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export type LicenseTokenClaims = {
  sub: string;
  typ: 'license_access';
  productType: string;
  planCode?: string;
  deviceBindingId: string;
  jti: string;
};

export type LicenseAuthorization = {
  licenseId: string;
  productType: string;
  planCode?: string;
  deviceBindingId: string;
};

export function hashLicenseCode(value: string): string {
  return crypto
    .createHmac('sha256', env.licenseHashPepper)
    .update(`license-code:${value.trim().toUpperCase()}`)
    .digest('hex');
}

export function hashUsbFingerprint(value: string): string {
  return crypto
    .createHmac('sha256', env.licenseHashPepper)
    .update(`usb-fingerprint:${value.trim()}`)
    .digest('hex');
}

export function hashDeviceFingerprint(value: string): string {
  return crypto
    .createHmac('sha256', env.licenseHashPepper)
    .update(`device-fingerprint:${value.trim()}`)
    .digest('hex');
}

export function signLicenseAccessToken(authorization: LicenseAuthorization) {
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign(
    {
      sub: authorization.licenseId,
      typ: 'license_access',
      productType: authorization.productType,
      planCode: authorization.planCode,
      deviceBindingId: authorization.deviceBindingId,
      jti,
    } satisfies LicenseTokenClaims,
    env.licenseTokenSecret,
    { expiresIn: env.licenseTokenTtl } as jwt.SignOptions,
  );

  return {
    accessToken,
    expiresIn: env.licenseTokenTtl,
    authorization,
  };
}

export function verifyLicenseAccessToken(token: string): LicenseTokenClaims {
  const decoded = jwt.verify(token, env.licenseTokenSecret);
  if (
    typeof decoded === 'string' ||
    decoded.typ !== 'license_access' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.deviceBindingId !== 'string'
  ) {
    throw new Error('Invalid license access token');
  }

  return {
    sub: decoded.sub,
    typ: 'license_access',
    productType: String(decoded.productType ?? ''),
    planCode: typeof decoded.planCode === 'string' ? decoded.planCode : undefined,
    deviceBindingId: decoded.deviceBindingId,
    jti: String(decoded.jti ?? ''),
  };
}
