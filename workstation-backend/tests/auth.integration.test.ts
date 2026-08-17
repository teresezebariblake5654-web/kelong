import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';

const app = createApp();

function extractRefreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'];
  if (!raw) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const hit = list.find((item) => item.startsWith(`${env.refreshCookieName}=`));
  if (!hit) return undefined;
  return hit.split(';')[0]?.split('=').slice(1).join('=');
}

describe('auth integration (/api/v1/auth)', () => {
  const suffix = Date.now();
  const email = `auth_${suffix}@example.com`;
  const username = `auth_${suffix}`;
  const password = 'StrongPass123!';

  let accessToken = '';
  let refreshToken = '';
  let oldRefreshToken = '';

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await prisma.organizationMember.deleteMany({ where: { user: { email } } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email } },
    });
    await prisma.user.deleteMany({ where: { email } });
    await disconnectDatabase();
  });

  it('registers successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username, password })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toBe(email);
    expect(Array.isArray(res.body.data.organizations)).toBe(true);
    expect(res.body.data.organizations.length).toBeGreaterThanOrEqual(1);
    accessToken = res.body.data.accessToken;
    refreshToken = extractRefreshCookie(res) ?? '';
    expect(refreshToken).toBeTruthy();
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username: `${username}_2`, password })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('USER_EXISTS');
  });

  it('rejects wrong password without revealing user existence', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPass999!' })
      .expect(401);

    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.message).toBe('邮箱或密码错误');
  });

  it('logs in successfully', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body.data.accessToken).toBeTruthy();
    accessToken = res.body.data.accessToken;
    refreshToken = extractRefreshCookie(res) ?? refreshToken;
    expect(refreshToken).toBeTruthy();
  });

  it('returns current user with access token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data.email).toBe(email);
  });

  it('refreshes successfully and rotates token', async () => {
    oldRefreshToken = refreshToken;
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${env.refreshCookieName}=${refreshToken}`)
      .expect(200);

    expect(res.body.data.accessToken).toBeTruthy();
    accessToken = res.body.data.accessToken;
    refreshToken = extractRefreshCookie(res) ?? '';
    expect(refreshToken).toBeTruthy();
    expect(refreshToken).not.toBe(oldRefreshToken);
  });

  it('fails when replaying old refresh token (family revoke)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${env.refreshCookieName}=${oldRefreshToken}`)
      .expect(401);

    expect(res.body.code).toBe('REFRESH_TOKEN_REUSE');
  });

  it('fails refresh after logout', async () => {
    // Login again to get a fresh family after reuse revoke.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const currentRefresh = extractRefreshCookie(login) ?? '';
    expect(currentRefresh).toBeTruthy();

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', `${env.refreshCookieName}=${currentRefresh}`)
      .expect(200);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${env.refreshCookieName}=${currentRefresh}`)
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('rejects revoked access context via me without bearer', async () => {
    const res = await request(app).get('/api/v1/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});
