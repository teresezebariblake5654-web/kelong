import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { salesController } from '../src/controllers/sales.controller';
import { errorMiddleware } from '../src/middleware/error.middleware';
import { emailChannelGateway } from '../src/providers/sales-channels/email.gateway';
import { buildWhatsAppTextPayload, whatsappChannelGateway } from '../src/providers/sales-channels/whatsapp.gateway';
import { createSalesProspect, getSalesProspect } from '../src/services/sales/sales-prospect.service';
import { listSalesActivities } from '../src/services/sales/sales-activity.service';
import { queueOutboundMessage } from '../src/services/sales/sales-message.service';
import { deliverQueuedMessage } from '../src/services/sales/sales-outbound.service';
import { ingestWhatsAppWebhook } from '../src/services/sales/sales-inbound.service';
import { AppError } from '../src/utils/errors';
import { logger } from '../src/utils/logger';
import { processSalesOutboundJob } from '../src/workers/sales-outbound.worker';

vi.mock('../src/queues/sales-outbound.queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/queues/sales-outbound.queue')>();
  return {
    ...actual,
    enqueueSalesOutboundJob: vi.fn(async (data: { messageId: string }) => ({
      jobId: actual.salesOutboundJobId(data.messageId),
    })),
  };
});

vi.mock('../src/queues/sales-agent.queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/queues/sales-agent.queue')>();
  return {
    ...actual,
    enqueueSalesAgentRun: vi.fn(async (data: { inboundMessageId?: string; prospectId: string }) => ({
      jobId: data.inboundMessageId
        ? actual.salesAgentInboundJobId(data.inboundMessageId)
        : actual.salesAgentProspectJobId(data.prospectId, 'test'),
    })),
  };
});

function buildSalesApp(opts: { orgId?: string; authed?: boolean }) {
  const app = express();
  app.use(express.json());
  app.get('/api/v1/sales/webhooks/whatsapp', salesController.verifyWhatsAppWebhook);
  app.post('/api/v1/sales/webhooks/whatsapp', salesController.receiveWhatsAppWebhook);
  app.post('/api/v1/sales/webhooks/email', salesController.receiveEmailWebhook);

  const withOrg = (
    handler: (req: express.Request, res: express.Response, next: express.NextFunction) => unknown,
  ) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (opts.authed === false) {
        next(new AppError(401, '请先登录', 'UNAUTHORIZED'));
        return;
      }
      req.user = {
        id: 'u-sales',
        username: 'sales-tester',
        email: 'sales@example.com',
        role: 'user',
        vipLevel: 'free',
        credits: 0,
        status: 'active',
      } as never;
      req.org = {
        organizationId: opts.orgId || 'missing-org',
        role: 'owner',
        membershipId: 'm-sales',
      };
      void handler(req, res, next);
    };
  };

  app.post('/api/v1/sales/prospects', withOrg(salesController.createProspect));
  app.get('/api/v1/sales/prospects', withOrg(salesController.listProspects));
  app.get('/api/v1/sales/prospects/:prospectId', withOrg(salesController.getProspect));
  app.post('/api/v1/sales/prospects/:prospectId/messages', withOrg(salesController.sendMessage));
  app.get('/api/v1/sales/prospects/:prospectId/messages', withOrg(salesController.listMessages));
  app.get('/api/v1/sales/prospects/:prospectId/activities', withOrg(salesController.listActivities));
  app.use(errorMiddleware);
  return app;
}

function whatsappInboundPayload(from: string, id: string, body: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from,
                  id,
                  timestamp: '1710000000',
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('sales domain', () => {
  const suffix = Date.now();
  const originalWhatsApp = {
    phoneNumberId: env.whatsappPhoneNumberId,
    accessToken: env.whatsappAccessToken,
    verifyToken: env.whatsappVerifyToken,
    webhookSecret: env.salesEmailWebhookSecret,
  };

  let orgA = '';
  let orgB = '';
  let companyA = '';
  let companyA2 = '';
  let companyB = '';
  let contactA = '';
  let contactA2 = '';
  let contactWrongCompany = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Sales Org A ${suffix}`, slug: `sales-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Sales Org B ${suffix}`, slug: `sales-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;

    const cA = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `sales-a-${suffix}.example`,
        normalizedDomain: `sales-a-${suffix}.example`,
        name: 'Sales Co A',
      },
    });
    const cA2 = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `sales-a2-${suffix}.example`,
        normalizedDomain: `sales-a2-${suffix}.example`,
        name: 'Sales Co A2',
      },
    });
    const cB = await prisma.leadCompany.create({
      data: {
        organizationId: orgB,
        domain: `sales-b-${suffix}.example`,
        normalizedDomain: `sales-b-${suffix}.example`,
        name: 'Sales Co B',
      },
    });
    companyA = cA.id;
    companyA2 = cA2.id;
    companyB = cB.id;

    const ctA = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: companyA,
        fullName: 'Buyer A',
        email: `buyer-a-${suffix}@example.com`,
        emailNormalized: `buyer-a-${suffix}@example.com`,
        phone: `+96650${String(suffix).slice(-8)}`,
        whatsapp: `+96650${String(suffix).slice(-8)}`,
      },
    });
    const ctA2 = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: companyA2,
        fullName: 'Buyer A2',
        email: `buyer-a2-${suffix}@example.com`,
        emailNormalized: `buyer-a2-${suffix}@example.com`,
        phone: '+966509998877',
      },
    });
    contactA = ctA.id;
    contactA2 = ctA2.id;
    contactWrongCompany = ctA2.id;
  });

  afterEach(() => {
    env.whatsappPhoneNumberId = originalWhatsApp.phoneNumberId;
    env.whatsappAccessToken = originalWhatsApp.accessToken;
    env.whatsappVerifyToken = originalWhatsApp.verifyToken;
    env.salesEmailWebhookSecret = originalWhatsApp.webhookSecret;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('1. LeadCompany → SalesProspect succeeds with NEW + PROSPECT_CREATED', async () => {
    const created = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    expect(created.created).toBe(true);
    expect(created.prospect.status).toBe('NEW');
    expect(created.prospect.organizationId).toBe(orgA);
    const activities = await listSalesActivities({
      organizationId: orgA,
      prospectId: created.prospect.id,
    });
    expect(activities.some((a) => a.type === 'PROSPECT_CREATED')).toBe(true);
  });

  it('2. cross-organization LeadCompany is rejected', async () => {
    await expect(
      createSalesProspect({
        organizationId: orgA,
        leadCompanyId: companyB,
        preferredChannel: 'EMAIL',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ORGANIZATION_MISMATCH' });
  });

  it('3. LeadContact / Company mismatch is rejected', async () => {
    await expect(
      createSalesProspect({
        organizationId: orgA,
        leadCompanyId: companyA,
        leadContactId: contactWrongCompany,
        preferredChannel: 'EMAIL',
      }),
    ).rejects.toMatchObject({ code: 'LEAD_CONTACT_COMPANY_MISMATCH' });
  });

  it('4. same company does not create a duplicate Prospect', async () => {
    const first = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    const second = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'WHATSAPP',
    });
    expect(second.created).toBe(false);
    expect(second.prospect.id).toBe(first.prospect.id);
    const count = await prisma.salesProspect.count({
      where: { organizationId: orgA, leadCompanyId: companyA },
    });
    expect(count).toBe(1);
  });

  it('5. Email outbound QUEUED → SENT', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    vi.spyOn(emailChannelGateway, 'sendMessage').mockResolvedValue({
      providerMessageId: `smtp-test-${suffix}`,
      providerMetadata: { provider: 'sales-smtp' },
    });
    const { prospect } = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    const queued = await queueOutboundMessage({
      organizationId: orgA,
      prospectId: prospect.id,
      channel: 'EMAIL',
      subject: 'Product inquiry',
      content: 'Hello from sales tests',
    });
    expect(queued.message.status).toBe('QUEUED');
    const delivered = await deliverQueuedMessage({
      messageId: queued.message.id,
      organizationId: orgA,
    });
    expect(delivered.message.status).toBe('SENT');
    expect(delivered.message.providerMessageId).toBe(`smtp-test-${suffix}`);
    const row = await prisma.salesProspect.findUnique({ where: { id: prospect.id } });
    expect(row?.status).toBe('CONTACTED');
    const activities = await listSalesActivities({ organizationId: orgA, prospectId: prospect.id });
    expect(activities.some((a) => a.type === 'MESSAGE_QUEUED')).toBe(true);
    expect(activities.some((a) => a.type === 'MESSAGE_SENT')).toBe(true);
  });

  it('6. Email provider failure QUEUED → FAILED keeps the row', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    vi.spyOn(emailChannelGateway, 'sendMessage').mockRejectedValue(new Error('SMTP 550'));
    const { prospect } = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    const queued = await queueOutboundMessage({
      organizationId: orgA,
      prospectId: prospect.id,
      channel: 'EMAIL',
      subject: 'Will fail',
      content: 'fail please',
    });
    await expect(
      deliverQueuedMessage({ messageId: queued.message.id, organizationId: orgA }),
    ).rejects.toThrow(/SMTP 550/);
    const row = await prisma.salesMessage.findUnique({ where: { id: queued.message.id } });
    expect(row).toBeTruthy();
    expect(row?.status).toBe('FAILED');
    const activities = await listSalesActivities({ organizationId: orgA, prospectId: prospect.id });
    expect(activities.some((a) => a.type === 'MESSAGE_FAILED')).toBe(true);
  });

  it('7. WhatsApp outbound builds Graph payload and stores providerMessageId', async () => {
    env.whatsappPhoneNumberId = '1234567890';
    env.whatsappAccessToken = 'wa-test-token-do-not-log';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.TEST123' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const logSpy = vi.spyOn(logger, 'info');

    const created = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA2,
      leadContactId: contactA2,
      preferredChannel: 'WHATSAPP',
    });
    const queued = await queueOutboundMessage({
      organizationId: orgA,
      prospectId: created.prospect.id,
      channel: 'WHATSAPP',
      content: 'WhatsApp hello',
    });
    const delivered = await deliverQueuedMessage({
      messageId: queued.message.id,
      organizationId: orgA,
    });
    expect(delivered.message.status).toBe('SENT');
    expect(delivered.message.providerMessageId).toBe('wamid.TEST123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/1234567890/messages');
    expect(url).toContain('graph.facebook.com');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(buildWhatsAppTextPayload('966509998877', 'WhatsApp hello'));
    expect(body.messaging_product).toBe('whatsapp');
    expect(String(init.headers && (init.headers as Record<string, string>).Authorization)).toMatch(
      /^Bearer /,
    );
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain('wa-test-token-do-not-log');
  });

  it('8. WhatsApp unconfigured returns CHANNEL_NOT_CONFIGURED', async () => {
    env.whatsappPhoneNumberId = '';
    env.whatsappAccessToken = '';
    expect(whatsappChannelGateway.isConfigured()).toBe(false);
    const { prospect } = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    await expect(
      queueOutboundMessage({
        organizationId: orgA,
        prospectId: prospect.id,
        channel: 'WHATSAPP',
        content: 'should not send',
      }),
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_CONFIGURED', statusCode: 503 });

    const app = buildSalesApp({ orgId: orgA });
    const res = await request(app)
      .post(`/api/v1/sales/prospects/${prospect.id}/messages`)
      .send({ channel: 'WHATSAPP', content: 'nope' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('CHANNEL_NOT_CONFIGURED');
  });

  it('9-11. WhatsApp inbound RECEIVED, prospect REPLIED, duplicate providerMessageId ignored', async () => {
    const created = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'WHATSAPP',
    });
    const providerId = `wamid.INBOUND.${suffix}`;
    const phoneDigits = `96650${String(suffix).slice(-8)}`;
    const payload = whatsappInboundPayload(phoneDigits, providerId, 'We are interested');
    const first = await ingestWhatsAppWebhook(payload);
    expect(first.results[0]).toMatchObject({ ignored: false, duplicated: false });
    const message = (first.results[0] as { message: { status: string; direction: string } }).message;
    expect(message.direction).toBe('INBOUND');
    expect(message.status).toBe('RECEIVED');

    const prospect = await prisma.salesProspect.findUnique({ where: { id: created.prospect.id } });
    expect(prospect?.status).toBe('REPLIED');

    const second = await ingestWhatsAppWebhook(payload);
    expect(second.results[0]).toMatchObject({ duplicated: true });
    const count = await prisma.salesMessage.count({
      where: { organizationId: orgA, channel: 'WHATSAPP', providerMessageId: providerId },
    });
    expect(count).toBe(1);

    const activities = await listSalesActivities({
      organizationId: orgA,
      prospectId: created.prospect.id,
    });
    expect(activities.some((a) => a.type === 'MESSAGE_RECEIVED')).toBe(true);
    expect(activities.some((a) => a.type === 'STATUS_CHANGED')).toBe(true);

    const app = buildSalesApp({ orgId: orgA });
    const httpRes = await request(app)
      .post('/api/v1/sales/webhooks/whatsapp')
      .send(whatsappInboundPayload(phoneDigits, `${providerId}.http`, 'second inbound'));
    expect(httpRes.status).toBe(200);
    expect(httpRes.body.success).toBe(true);
  });

  it('12. organization isolation', async () => {
    const created = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    await expect(
      getSalesProspect({ organizationId: orgB, prospectId: created.prospect.id }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });

    const listedB = await prisma.salesProspect.findMany({ where: { organizationId: orgB } });
    expect(listedB.some((p) => p.id === created.prospect.id)).toBe(false);

    const appB = buildSalesApp({ orgId: orgB });
    const res = await request(appB).get(`/api/v1/sales/prospects/${created.prospect.id}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORGANIZATION_MISMATCH');

    const appA = buildSalesApp({ orgId: orgA });
    const ok = await request(appA).get(`/api/v1/sales/prospects/${created.prospect.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.prospect.id).toBe(created.prospect.id);
  });

  it('13. SalesActivity is generated for create + HTTP prospect create', async () => {
    const app = buildSalesApp({ orgId: orgA });
    const res = await request(app).post('/api/v1/sales/prospects').send({
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    expect([200, 201]).toContain(res.status);
    const prospectId = res.body.data.prospect.id as string;
    const actRes = await request(app).get(`/api/v1/sales/prospects/${prospectId}/activities`);
    expect(actRes.status).toBe(200);
    const types = (actRes.body.data.activities as Array<{ type: string }>).map((a) => a.type);
    expect(types).toContain('PROSPECT_CREATED');
  });

  it('14. stage2 sales channel path does not call LLM', () => {
    const roots = [
      path.resolve(__dirname, '../src/providers/sales-channels'),
      path.resolve(__dirname, '../src/services/sales/sales-message.service.ts'),
      path.resolve(__dirname, '../src/services/sales/sales-outbound.service.ts'),
      path.resolve(__dirname, '../src/services/sales/sales-inbound.service.ts'),
      path.resolve(__dirname, '../src/queues/sales-outbound.queue.ts'),
      path.resolve(__dirname, '../src/workers/sales-outbound.worker.ts'),
    ];
    const files: string[] = [];
    for (const root of roots) {
      const stat = fs.statSync(root);
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(root)) {
          if (name.endsWith('.ts')) files.push(path.join(root, name));
        }
      } else {
        files.push(root);
      }
    }
    const joined = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(joined).not.toMatch(/from ['"]openai['"]/);
    expect(joined).not.toMatch(/providers\/llm/);
    expect(joined).not.toMatch(/chat\.completions/);
    expect(joined).not.toMatch(/runAcquisitionAgent|generateSalesCopy|Sales Agent Brain/i);
  });

  it('WhatsApp webhook GET verifies hub challenge', async () => {
    env.whatsappVerifyToken = 'verify-sales-token';
    const app = buildSalesApp({ orgId: orgA });
    const res = await request(app).get('/api/v1/sales/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-sales-token',
      'hub.challenge': 'challenge-123',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge-123');
  });

  it('worker maps CHANNEL_NOT_CONFIGURED to UnrecoverableError', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    vi.spyOn(emailChannelGateway, 'sendMessage').mockRejectedValue(
      new AppError(503, 'Email 通道未配置', 'CHANNEL_NOT_CONFIGURED'),
    );
    const { prospect } = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    const queued = await queueOutboundMessage({
      organizationId: orgA,
      prospectId: prospect.id,
      channel: 'EMAIL',
      subject: 'x',
      content: 'y',
    });
    await expect(
      processSalesOutboundJob({
        id: 'job-1',
        data: {
          messageId: queued.message.id,
          organizationId: orgA,
          prospectId: prospect.id,
          channel: 'EMAIL',
        },
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('POST message returns 202 after queue', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    const { prospect } = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    const app = buildSalesApp({ orgId: orgA });
    const res = await request(app).post(`/api/v1/sales/prospects/${prospect.id}/messages`).send({
      channel: 'EMAIL',
      subject: 'Queued send',
      content: 'via http 202',
    });
    expect(res.status).toBe(202);
    expect(res.body.data.message.status).toBe('QUEUED');
  });
});
