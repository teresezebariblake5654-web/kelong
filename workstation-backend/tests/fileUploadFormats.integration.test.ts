import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';

const app = createApp();

describe('file upload formats', () => {
  const suffix = Date.now();
  const email = `upload_fmt_${suffix}@example.com`;
  const username = `upload_fmt_${suffix}`;
  const password = 'StrongPass123!';

  let token = '';
  let orgId = '';

  const cases: Array<{ name: string; filename: string; content: Buffer }> = [
    { name: 'pdf', filename: 'sample.pdf', content: Buffer.from('%PDF-1.4 test') },
    { name: 'docx', filename: 'sample.docx', content: Buffer.from('PK docx') },
    { name: 'doc', filename: 'sample.doc', content: Buffer.from('doc content') },
    { name: 'xlsx', filename: 'sample.xlsx', content: Buffer.from('PK xlsx') },
    { name: 'txt', filename: 'sample.txt', content: Buffer.from('hello txt') },
    { name: 'ppt', filename: 'sample.ppt', content: Buffer.from('ppt content') },
    { name: 'pptx', filename: 'sample.pptx', content: Buffer.from('PK pptx') },
    { name: 'rtf', filename: 'sample.rtf', content: Buffer.from('{\\rtf1 test}') },
    { name: 'png', filename: 'sample.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  ];

  beforeAll(async () => {
    await connectDatabase();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, username, password })
      .expect(201);
    token = res.body.data.accessToken;
    orgId = res.body.data.organizations[0].id;
  });

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { user: { email } } });
    await prisma.organizationMember.deleteMany({ where: { user: { email } } });
    await prisma.organization.deleteMany({ where: { slug: { contains: username } } });
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });
    await disconnectDatabase();
  });

  for (const item of cases) {
    it(`accepts ${item.name} upload`, async () => {
      const res = await request(app)
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', orgId)
        .attach('file', item.content, item.filename)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.fileId).toBeTruthy();
      expect(res.body.data.extension).toBe(item.filename.split('.').pop());
    });
  }

  it('rejects unsupported file type', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId)
      .attach('file', Buffer.from('malware'), 'virus.exe')
      .expect(400);

    expect(res.body.code).toBe('INVALID_FILE_TYPE');
  });
});
