import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';

const app = createApp();

describe('organization context (/api/v1/organizations + org-scoped files)', () => {
  const suffix = Date.now();
  const emailA = `org_a_${suffix}@example.com`;
  const emailB = `org_b_${suffix}@example.com`;
  const usernameA = `org_a_${suffix}`;
  const usernameB = `org_b_${suffix}`;
  const password = 'StrongPass123!';

  let tokenA = '';
  let tokenB = '';
  let orgIdA = '';
  let orgIdB = '';
  let userIdA = '';
  let uploadedFileId = '';

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    const emails = [emailA, emailB];
    await prisma.file.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.organizationMember.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.organization.deleteMany({
      where: {
        OR: [{ slug: { contains: usernameA } }, { slug: { contains: usernameB } }],
      },
    });
    await prisma.refreshToken.deleteMany({ where: { user: { email: { in: emails } } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await disconnectDatabase();
  });

  it('registers and returns organizations (auto-created membership)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailA, username: usernameA, password })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(Array.isArray(res.body.data.organizations)).toBe(true);
    expect(res.body.data.organizations.length).toBe(1);
    tokenA = res.body.data.accessToken;
    orgIdA = res.body.data.organizations[0].id;
    userIdA = res.body.data.user.id;
    expect(orgIdA).toBeTruthy();
  });

  it('logs in successfully and returns organizations', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: emailA, password })
      .expect(200);

    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.organizations.length).toBe(1);
    expect(res.body.data.organizations[0].id).toBe(orgIdA);
    tokenA = res.body.data.accessToken;
  });

  it('lists organizations without X-Organization-Id (no dead loop)', async () => {
    const res = await request(app)
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(orgIdA);
  });

  it('accesses own organization by id', async () => {
    const res = await request(app)
      .get(`/api/v1/organizations/${orgIdA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.id).toBe(orgIdA);
    expect(res.body.data.role).toBe('owner');
  });

  it('rejects org-scoped file upload without X-Organization-Id', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('name,value\na,1\n'), 'sample.csv')
      .expect(400);

    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
  });

  it('allows file upload with membership-validated X-Organization-Id', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdA)
      .attach('file', Buffer.from('name,value\na,1\n'), 'sample.csv')
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.fileId).toBeTruthy();
    uploadedFileId = res.body.data.fileId;

    const stored = await prisma.file.findUnique({ where: { id: uploadedFileId } });
    expect(stored?.organizationId).toBe(orgIdA);
    expect(stored?.userId).toBe(userIdA);
  });

  it('reads uploaded file with organization middleware', async () => {
    const res = await request(app)
      .get(`/api/files/${uploadedFileId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdA)
      .expect(200);

    expect(res.body.data.fileId).toBe(uploadedFileId);
  });

  it('returns 403 when forging another organization id', async () => {
    const registerB = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: emailB, username: usernameB, password })
      .expect(201);

    tokenB = registerB.body.data.accessToken;
    orgIdB = registerB.body.data.organizations[0].id;
    expect(orgIdB).toBeTruthy();
    expect(orgIdB).not.toBe(orgIdA);

    const forgeUpload = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Organization-Id', orgIdB)
      .attach('file', Buffer.from('name,value\nb,2\n'), 'forged.csv')
      .expect(403);

    expect(forgeUpload.body.code).toBe('ORGANIZATION_FORBIDDEN');

    const forgeGet = await request(app)
      .get(`/api/v1/organizations/${orgIdB}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);

    expect(forgeGet.body.code).toBe('ORGANIZATION_FORBIDDEN');
  });
});
