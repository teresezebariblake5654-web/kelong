import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { signAccessToken } from '../src/services/token.service';
import { randomUUID } from 'crypto';

const app = createApp();

describe('admin llm-provider routes auth', () => {
  let adminToken = '';
  let userToken = '';
  const suffix = randomUUID().slice(0, 8);
  let adminId = '';
  let userId = '';

  beforeAll(async () => {
    await connectDatabase();
    const admin = await prisma.user.create({
      data: {
        username: `adm_llm_${suffix}`,
        email: `adm_llm_${suffix}@example.com`,
        passwordHash: 'x',
        role: 'admin',
      },
    });
    const user = await prisma.user.create({
      data: {
        username: `usr_llm_${suffix}`,
        email: `usr_llm_${suffix}@example.com`,
        passwordHash: 'x',
        role: 'user',
      },
    });
    adminId = admin.id;
    userId = user.id;
    adminToken = signAccessToken(admin.id, admin.role).accessToken;
    userToken = signAccessToken(user.id, user.role).accessToken;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/models')) {
          return new Response(JSON.stringify({ object: 'list', data: [{ id: 'm1' }] }), {
            status: 200,
          });
        }
        if (String(url).includes('/api/usage/token')) {
          return new Response(
            JSON.stringify({
              code: true,
              data: {
                total_granted: 10,
                total_used: 1,
                total_available: 9,
                unlimited_quota: false,
                expires_at: 0,
              },
            }),
            { status: 200 },
          );
        }
        return new Response('no', { status: 404 });
      }),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminId, userId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await disconnectDatabase();
  });

  it('rejects non-admin users', async () => {
    const res = await request(app)
      .get('/api/v1/admin/llm-provider/status')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(JSON.stringify(res.body)).not.toMatch(/sk-/i);
  });

  it('allows admin to read status without leaking secrets', async () => {
    const res = await request(app)
      .get('/api/v1/admin/llm-provider/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.provider).toBe('1701');
    expect(res.body.data).not.toHaveProperty('apiKey');
    expect(JSON.stringify(res.body)).not.toMatch(/Bearer /);
  });

  it('allows admin to read platform quota (strings)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/llm-provider/quota')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.totalGranted).toBe('10');
    expect(res.body.data.totalAvailable).toBe('9');
    expect(typeof res.body.data.totalUsed).toBe('string');
  });
});
