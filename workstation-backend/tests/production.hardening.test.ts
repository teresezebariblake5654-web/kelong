import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { userOrIpKey } from '../src/middleware/rateLimit.middleware';
import { assertOrgOutboundRateAllowed } from '../src/services/sales/sales-outbound-rate.service';
import { createSalesProspect } from '../src/services/sales/sales-prospect.service';
import { queueOutboundMessage } from '../src/services/sales/sales-message.service';
import { deliverQueuedMessage, markOutboundMessageFailed } from '../src/services/sales/sales-outbound.service';
import { runSalesAgent } from '../src/services/sales/sales-agent.service';
import { ingestInboundEmail, ingestInboundMessage } from '../src/services/sales/sales-inbound.service';
import { recoverStaleSalesAgentRuns } from '../src/services/sales/sales-stale-recovery.service';
import { getSystemProviderHealth, timingSafeEqualString, verifyWhatsAppSignature } from '../src/services/system/provider-health.service';
import { emailChannelGateway } from '../src/providers/sales-channels/email.gateway';
import { AppError } from '../src/utils/errors';
import { logger } from '../src/utils/logger';

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
    enqueueSalesAgentRun: vi.fn(async () => ({ jobId: 'mock-agent-job' })),
  };
});

describe('production hardening', () => {
  const suffix = Date.now();
  const originalMax = env.salesMaxOutboundPerOrgPerHour;
  let orgA = '';
  let orgB = '';
  let companyA = '';
  let contactA = '';
  let prospectId = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Prod Org A ${suffix}`, slug: `prod-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Prod Org B ${suffix}`, slug: `prod-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;
    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `prod-${suffix}.example`,
        normalizedDomain: `prod-${suffix}.example`,
        name: 'Prod Co',
      },
    });
    companyA = company.id;
    const contact = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: companyA,
        email: `prod-${suffix}@example.com`,
        emailNormalized: `prod-${suffix}@example.com`,
        phone: `+96650${String(suffix).slice(-8)}`,
      },
    });
    contactA = contact.id;
    const p = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    prospectId = p.prospect.id;
  });

  afterAll(async () => {
    env.salesMaxOutboundPerOrgPerHour = originalMax;
    await disconnectDatabase();
  });

  it('1. org hourly outbound limit', async () => {
    env.salesMaxOutboundPerOrgPerHour = 1;
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    await queueOutboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      subject: 'one',
      content: 'first',
    });
    await expect(
      queueOutboundMessage({
        organizationId: orgA,
        prospectId,
        channel: 'EMAIL',
        subject: 'two',
        content: 'second',
      }),
    ).rejects.toMatchObject({ code: 'ORG_OUTBOUND_RATE_LIMITED' });
    await expect(assertOrgOutboundRateAllowed(orgA)).rejects.toMatchObject({
      code: 'ORG_OUTBOUND_RATE_LIMITED',
    });
    env.salesMaxOutboundPerOrgPerHour = originalMax;
  });

  it('2. BullMQ retry does not duplicate outbound via idempotencyKey', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    const key = `agent-run-retry-${suffix}`;
    const first = await queueOutboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      subject: 'idem',
      content: 'once',
      idempotencyKey: key,
    });
    const second = await queueOutboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      subject: 'idem',
      content: 'once again',
      idempotencyKey: key,
    });
    expect(second.duplicated).toBe(true);
    expect(second.message.id).toBe(first.message.id);
  });

  it('3-4. HANDOFF and CLOSED no longer follow-up / auto send', async () => {
    for (const status of ['HANDOFF', 'CLOSED'] as const) {
      const company = await prisma.leadCompany.create({
        data: {
          organizationId: orgA,
          domain: `term-${status}-${suffix}.example`,
          normalizedDomain: `term-${status}-${suffix}.example`,
          name: status,
        },
      });
      const contact = await prisma.leadContact.create({
        data: {
          organizationId: orgA,
          companyId: company.id,
          email: `term-${status}-${suffix}@example.com`,
          emailNormalized: `term-${status}-${suffix}@example.com`,
        },
      });
      const p = await createSalesProspect({
        organizationId: orgA,
        leadCompanyId: company.id,
        leadContactId: contact.id,
        preferredChannel: 'EMAIL',
      });
      await prisma.salesProspect.update({
        where: { id: p.prospect.id },
        data: { status, nextFollowUpAt: new Date(Date.now() - 60_000) },
      });
      const result = await runSalesAgent({
        organizationId: orgA,
        prospectId: p.prospect.id,
        trigger: 'SCHEDULED_FOLLOWUP',
        executeActions: false,
        llmCall: async () => ({
          action: 'SEND',
          channel: 'EMAIL',
          subject: 'nope',
          message: 'should skip',
          prospectStatus: 'CONTACTED',
          summary: 'blocked',
        }),
      });
      expect(result.status).toBe('SKIPPED');
    }
  });

  it('5. final worker failure marks SalesMessage FAILED without downgrading SENT', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    const queued = await queueOutboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      subject: 'fail-final',
      content: 'will fail',
      idempotencyKey: `fail-final-${suffix}`,
    });
    await markOutboundMessageFailed({
      messageId: queued.message.id,
      organizationId: orgA,
      error: new Error('smtp down'),
    });
    const failed = await prisma.salesMessage.findUnique({ where: { id: queued.message.id } });
    expect(failed?.status).toBe('FAILED');

    // Simulate SENT then failed mark — must stay SENT
    await prisma.salesMessage.update({
      where: { id: queued.message.id },
      data: { status: 'SENT', providerMessageId: `sent-${suffix}` },
    });
    await markOutboundMessageFailed({
      messageId: queued.message.id,
      organizationId: orgA,
      error: new Error('should not overwrite'),
    });
    const still = await prisma.salesMessage.findUnique({ where: { id: queued.message.id } });
    expect(still?.status).toBe('SENT');
  });

  it('6. duplicate webhook idempotent', async () => {
    const providerId = `dup-wh-${suffix}`;
    const first = await ingestInboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      from: `prod-${suffix}@example.com`,
      content: 'hello',
      providerMessageId: providerId,
    });
    const second = await ingestInboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      from: `prod-${suffix}@example.com`,
      content: 'hello',
      providerMessageId: providerId,
    });
    expect(first.duplicated).toBe(false);
    expect(second.duplicated).toBe(true);
    expect(second.message.id).toBe(first.message.id);
  });

  it('7. invalid webhook secret rejected', async () => {
    const prev = env.salesEmailWebhookSecret;
    env.salesEmailWebhookSecret = 'correct-secret-value';
    await expect(
      ingestInboundEmail(
        {
          from: `prod-${suffix}@example.com`,
          content: 'x',
          providerMessageId: `bad-secret-${suffix}`,
        },
        'wrong-secret-value',
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_UNAUTHORIZED' });
    env.salesEmailWebhookSecret = prev;
  });

  it('8. provider-health returns independent statuses without side effects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }) as Response),
    );
    const health = await getSystemProviderHealth();
    expect(['UP', 'DOWN', 'NOT_CONFIGURED']).toContain(health.email.status);
    expect(['UP', 'DOWN', 'NOT_CONFIGURED']).toContain(health.whatsapp.status);
    expect(['UP', 'DOWN']).toContain(health.postgres.status);
    expect(['UP', 'DOWN', 'NOT_CONFIGURED']).toContain(health.llm.status);
    expect(JSON.stringify(health)).not.toMatch(/Bearer |smtpPass|access_token|api[_-]?key/i);
    vi.unstubAllGlobals();
  });

  it('9. secrets do not appear in normal logger meta paths', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.info('probe', {
      authorization: 'Bearer SECRET',
      whatsappAccessToken: 'wa-secret',
      smtpPassword: 'smtp-secret',
      prospectId: 'p1',
    });
    const line = String(spy.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('Bearer SECRET');
    expect(line).not.toContain('wa-secret');
    spy.mockRestore();
  });

  it('10. rate-limit IPv6 key uses ipKeyGenerator-compatible form', () => {
    const key = userOrIpKey({
      user: undefined,
      ip: '2001:db8::1',
      socket: { remoteAddress: '2001:db8::1' },
    } as never);
    expect(key.startsWith('ip:')).toBe(true);
    expect(key).not.toBe('ip:2001:db8::1'); // subnet-normalized, not raw
  });

  it('11. organization isolation regression', async () => {
    await expect(
      runSalesAgent({
        organizationId: orgB,
        prospectId,
        trigger: 'MANUAL',
        executeActions: false,
        llmCall: async () => ({ action: 'WAIT', prospectStatus: 'NEW', summary: 'x' }),
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });

    await expect(
      queueOutboundMessage({
        organizationId: orgB,
        prospectId,
        channel: 'EMAIL',
        subject: 'x',
        content: 'y',
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
  });

  it('12. restart/retry state safety recovers stale RUNNING agent runs', async () => {
    const run = await prisma.salesAgentRun.create({
      data: {
        organizationId: orgA,
        prospectId,
        trigger: 'MANUAL',
        status: 'RUNNING',
        createdAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });
    // force old createdAt
    await prisma.salesAgentRun.update({
      where: { id: run.id },
      data: { createdAt: new Date(Date.now() - 30 * 60 * 1000) },
    });
    const result = await recoverStaleSalesAgentRuns();
    expect(result.markedFailed).toBeGreaterThanOrEqual(1);
    const updated = await prisma.salesAgentRun.findUnique({ where: { id: run.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.errorCode).toBe('STALE_RUNNING_RECOVERED');
  });

  it('WhatsApp signature verification rejects tampered body', () => {
    const prev = env.whatsappAppSecret;
    env.whatsappAppSecret = 'app-secret-for-test';
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const good = crypto.createHmac('sha256', env.whatsappAppSecret).update(body).digest('hex');
    expect(verifyWhatsAppSignature(body, `sha256=${good}`)).toBe(true);
    expect(verifyWhatsAppSignature(body, 'sha256=deadbeef')).toBe(false);
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    env.whatsappAppSecret = prev;
  });

  it('channel gateways were not reimplemented in production hardening', () => {
    const files = [
      path.resolve(__dirname, '../src/services/sales/sales-outbound-rate.service.ts'),
      path.resolve(__dirname, '../src/services/sales/sales-stale-recovery.service.ts'),
      path.resolve(__dirname, '../src/services/system/provider-health.service.ts'),
    ];
    const joined = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(joined).not.toMatch(/nodemailer|createTransport|graph\.facebook\.com/);
  });
});
