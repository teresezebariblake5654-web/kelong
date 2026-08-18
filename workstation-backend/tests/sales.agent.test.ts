import fs from 'fs';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { createSalesAgentProfile, getSalesAgentProfile } from '../src/services/sales/sales-agent-profile.service';
import {
  buildDeterministicSalesDecision,
  countOutboundMessages,
  loadSalesAgentContext,
  runSalesAgent,
} from '../src/services/sales/sales-agent.service';
import { createSalesProspect } from '../src/services/sales/sales-prospect.service';
import { ingestInboundMessage } from '../src/services/sales/sales-inbound.service';
import { queueOutboundMessage } from '../src/services/sales/sales-message.service';
import { salesAgentDecisionSchema } from '../src/services/sales/sales-agent.types';
import { emailChannelGateway } from '../src/providers/sales-channels/email.gateway';

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

describe('sales agent', () => {
  const suffix = Date.now();
  const originalLimits = {
    maxOutbound: env.salesAgentMaxOutboundPerProspect,
    minHours: env.salesAgentMinFollowupIntervalHours,
    msgLimit: env.salesAgentContextMessageLimit,
  };

  let orgA = '';
  let orgB = '';
  let companyA = '';
  let contactA = '';
  let prospectId = '';

  beforeAll(async () => {
    await connectDatabase();
    const a = await prisma.organization.create({
      data: { name: `Agent Org A ${suffix}`, slug: `agent-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: `Agent Org B ${suffix}`, slug: `agent-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;

    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `agent-${suffix}.example`,
        normalizedDomain: `agent-${suffix}.example`,
        name: 'Agent Co',
        industry: 'medical devices',
      },
    });
    companyA = company.id;
    const contact = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: companyA,
        fullName: 'Buyer',
        email: `agent-${suffix}@example.com`,
        emailNormalized: `agent-${suffix}@example.com`,
        phone: '+966501234567',
      },
    });
    contactA = contact.id;
    await prisma.leadScore.create({
      data: {
        organizationId: orgA,
        companyId: companyA,
        searchTaskId: (
          await prisma.leadSearchTask.create({
            data: {
              organizationId: orgA,
              prompt: `agent score ${suffix}`,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          })
        ).id,
        overallScore: 88,
        grade: 'A',
        industryScore: 80,
        locationScore: 80,
        businessTypeScore: 80,
        productFitScore: 80,
        companyFitScore: 80,
        contactabilityScore: 90,
      },
    });

    const created = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: companyA,
      leadContactId: contactA,
      preferredChannel: 'EMAIL',
    });
    prospectId = created.prospect.id;
  });

  afterEach(() => {
    env.salesAgentMaxOutboundPerProspect = originalLimits.maxOutbound;
    env.salesAgentMinFollowupIntervalHours = originalLimits.minHours;
    env.salesAgentContextMessageLimit = originalLimits.msgLimit;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('1. SalesAgentProfile org isolation', async () => {
    const created = await createSalesAgentProfile({
      organizationId: orgA,
      name: 'Rep A',
      companyDescription: 'We sell devices',
      productDescription: 'Ultrasound systems',
      targetCustomerDescription: 'Saudi distributors',
    });
    await expect(
      getSalesAgentProfile({ organizationId: orgB, profileId: created.profile.id }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
  });

  it('2. INITIAL_OUTREACH generates structured SEND decision', async () => {
    const llmCall = vi.fn(async () => ({
      action: 'SEND',
      channel: 'EMAIL',
      subject: 'Intro',
      message: 'Hello from AI sales',
      prospectStatus: 'CONTACTED',
      summary: 'First touch',
    }));
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);

    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId,
      trigger: 'INITIAL_OUTREACH',
      llmCall,
      executeActions: true,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.decision?.action).toBe('SEND');
    expect(result.decision?.message).toBeTruthy();
    expect(salesAgentDecisionSchema.safeParse(result.decision).success).toBe(true);
    expect(llmCall).toHaveBeenCalled();
  });

  it('3. SEND reuses outbound queue (queueOutboundMessage → QUEUED)', async () => {
    const { enqueueSalesOutboundJob } = await import('../src/queues/sales-outbound.queue');
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId,
      trigger: 'MANUAL',
      llmCall: async () => ({
        action: 'SEND',
        channel: 'EMAIL',
        subject: 'Follow',
        message: 'Second note',
        prospectStatus: 'CONTACTED',
        summary: 'send',
      }),
    });
    expect(result.outboundMessageId).toBeTruthy();
    expect(enqueueSalesOutboundJob).toHaveBeenCalled();
    const msg = await prisma.salesMessage.findUnique({ where: { id: result.outboundMessageId! } });
    expect(msg?.status).toBe('QUEUED');
  });

  it('4. malformed LLM JSON repair/fallback', async () => {
    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId,
      trigger: 'MANUAL',
      llmCall: async () => ({ action: 'SEND' }), // missing message/channel
      executeActions: false,
    });
    expect(result.decision).toBeTruthy();
    expect(salesAgentDecisionSchema.safeParse(result.decision).success).toBe(true);
  });

  it('5. does not persist chain-of-thought', async () => {
    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId,
      trigger: 'MANUAL',
      llmCall: async () => ({
        action: 'WAIT',
        prospectStatus: 'CONTACTED',
        summary: 'ok',
        reasoning: 'SECRET_COT',
        chainOfThought: 'do not store',
        thoughts: 'nope',
      }),
      executeActions: false,
    });
    const run = await prisma.salesAgentRun.findUnique({ where: { id: result.runId } });
    const raw = JSON.stringify(run?.decision ?? {});
    expect(raw).not.toContain('SECRET_COT');
    expect(raw).not.toContain('chainOfThought');
    expect(raw).not.toContain('do not store');
  });

  it('6. INBOUND reply can trigger Agent Run', async () => {
    const { enqueueSalesAgentRun } = await import('../src/queues/sales-agent.queue');
    const ingested = await ingestInboundMessage({
      organizationId: orgA,
      prospectId,
      channel: 'EMAIL',
      from: `agent-${suffix}@example.com`,
      content: 'Thanks for reaching out',
      providerMessageId: `in-agent-${suffix}-6`,
    });
    expect(ingested.duplicated).toBe(false);
    expect(enqueueSalesAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'INBOUND_REPLY',
        inboundMessageId: ingested.message.id,
        prospectId,
      }),
    );
  });

  it('7. POSITIVE_INTEREST → reasonable follow-on status', async () => {
    const decision = buildDeterministicSalesDecision({
      trigger: 'INBOUND_REPLY',
      preferredChannel: 'EMAIL',
      inboundText: 'We are interested, please tell me more',
      profileLanguage: 'en',
      companyName: 'Agent Co',
    });
    expect(['HANDOFF', 'INTERESTED', 'FOLLOW_UP', 'REPLIED']).toContain(decision.prospectStatus);
    expect(decision.replyIntent === 'POSITIVE_INTEREST' || decision.action === 'HANDOFF').toBe(true);
  });

  it('8. REQUEST_QUOTE → HANDOFF', async () => {
    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId,
      trigger: 'INBOUND_REPLY',
      inboundMessageId: undefined,
      llmCall: async () => ({
        action: 'SEND',
        channel: 'EMAIL',
        message: 'Here is pricing $1',
        prospectStatus: 'INTERESTED',
        replyIntent: 'REQUEST_QUOTE',
        summary: 'should handoff',
      }),
    });
    expect(result.decision?.action).toBe('HANDOFF');
    expect(result.decision?.prospectStatus).toBe('HANDOFF');
    const p = await prisma.salesProspect.findUnique({ where: { id: prospectId } });
    expect(p?.status).toBe('HANDOFF');
    expect(p?.handoff).toBeTruthy();
  });

  it('9. REQUEST_MEETING → HANDOFF', async () => {
    // reset prospect out of HANDOFF for this case via new prospect
    const company2 = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `agent-meet-${suffix}.example`,
        normalizedDomain: `agent-meet-${suffix}.example`,
        name: 'Meet Co',
      },
    });
    const contact2 = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: company2.id,
        email: `meet-${suffix}@example.com`,
        emailNormalized: `meet-${suffix}@example.com`,
      },
    });
    const p2 = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: company2.id,
      leadContactId: contact2.id,
      preferredChannel: 'EMAIL',
    });
    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId: p2.prospect.id,
      trigger: 'INBOUND_REPLY',
      llmCall: async () => ({
        action: 'WAIT',
        prospectStatus: 'REPLIED',
        replyIntent: 'REQUEST_MEETING',
        summary: 'meeting',
      }),
    });
    expect(result.decision?.action).toBe('HANDOFF');
    const row = await prisma.salesProspect.findUnique({ where: { id: p2.prospect.id } });
    expect(row?.status).toBe('HANDOFF');
  });

  it('10-13. NOT_INTERESTED / UNSUBSCRIBE / HANDOFF / CLOSED block auto send', async () => {
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);

    for (const status of ['NOT_INTERESTED', 'CLOSED', 'HANDOFF'] as const) {
      const company = await prisma.leadCompany.create({
        data: {
          organizationId: orgA,
          domain: `block-${status}-${suffix}.example`,
          normalizedDomain: `block-${status}-${suffix}.example`,
          name: status,
        },
      });
      const contact = await prisma.leadContact.create({
        data: {
          organizationId: orgA,
          companyId: company.id,
          email: `block-${status}-${suffix}@example.com`,
          emailNormalized: `block-${status}-${suffix}@example.com`,
        },
      });
      const p = await createSalesProspect({
        organizationId: orgA,
        leadCompanyId: company.id,
        leadContactId: contact.id,
        preferredChannel: 'EMAIL',
      });
      await prisma.salesProspect.update({ where: { id: p.prospect.id }, data: { status } });
      const result = await runSalesAgent({
        organizationId: orgA,
        prospectId: p.prospect.id,
        trigger: 'SCHEDULED_FOLLOWUP',
        llmCall: async () => ({
          action: 'SEND',
          channel: 'EMAIL',
          subject: 'x',
          message: 'should not send',
          prospectStatus: 'CONTACTED',
          summary: 'blocked',
        }),
      });
      expect(result.status).toBe('SKIPPED');
      expect(result.outboundMessageId).toBeUndefined();
    }

    const unsub = buildDeterministicSalesDecision({
      trigger: 'INBOUND_REPLY',
      preferredChannel: 'EMAIL',
      inboundText: 'Please unsubscribe and stop contacting me',
      profileLanguage: 'en',
    });
    expect(unsub.action).toBe('CLOSE');
    expect(unsub.prospectStatus).toBe('CLOSED');

    const notInt = buildDeterministicSalesDecision({
      trigger: 'INBOUND_REPLY',
      preferredChannel: 'EMAIL',
      inboundText: 'Not interested, thanks',
      profileLanguage: 'en',
    });
    expect(notInt.prospectStatus).toBe('NOT_INTERESTED');
  });

  it('14. Follow-up min interval is enforced', async () => {
    env.salesAgentMinFollowupIntervalHours = 24;
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `interval-${suffix}.example`,
        normalizedDomain: `interval-${suffix}.example`,
        name: 'Interval Co',
      },
    });
    const contact = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: company.id,
        email: `interval-${suffix}@example.com`,
        emailNormalized: `interval-${suffix}@example.com`,
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
      data: { lastOutboundAt: new Date(), status: 'CONTACTED' },
    });
    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId: p.prospect.id,
      trigger: 'SCHEDULED_FOLLOWUP',
      llmCall: async () => ({
        action: 'SEND',
        channel: 'EMAIL',
        subject: 'too soon',
        message: 'too soon',
        prospectStatus: 'FOLLOW_UP',
        summary: 'interval',
      }),
    });
    expect(result.decision?.action).toBe('WAIT');
    expect(result.outboundMessageId).toBeUndefined();
  });

  it('15. Max outbound count is enforced', async () => {
    env.salesAgentMaxOutboundPerProspect = 1;
    vi.spyOn(emailChannelGateway, 'isConfigured').mockReturnValue(true);
    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `maxout-${suffix}.example`,
        normalizedDomain: `maxout-${suffix}.example`,
        name: 'Max Co',
      },
    });
    const contact = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: company.id,
        email: `maxout-${suffix}@example.com`,
        emailNormalized: `maxout-${suffix}@example.com`,
      },
    });
    const p = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: company.id,
      leadContactId: contact.id,
      preferredChannel: 'EMAIL',
    });
    await queueOutboundMessage({
      organizationId: orgA,
      prospectId: p.prospect.id,
      channel: 'EMAIL',
      subject: 'first',
      content: 'first outbound',
    });
    expect(await countOutboundMessages({ organizationId: orgA, prospectId: p.prospect.id })).toBeGreaterThanOrEqual(1);

    const result = await runSalesAgent({
      organizationId: orgA,
      prospectId: p.prospect.id,
      trigger: 'MANUAL',
      llmCall: async () => ({
        action: 'SEND',
        channel: 'EMAIL',
        subject: 'second',
        message: 'should block',
        prospectStatus: 'CONTACTED',
        summary: 'max',
      }),
    });
    expect(result.decision?.action).toBe('WAIT');
    expect(result.outboundMessageId).toBeUndefined();
  });

  it('16. Duplicate inbound does not produce two agent replies', async () => {
    const company = await prisma.leadCompany.create({
      data: {
        organizationId: orgA,
        domain: `dup-${suffix}.example`,
        normalizedDomain: `dup-${suffix}.example`,
        name: 'Dup Co',
      },
    });
    const contact = await prisma.leadContact.create({
      data: {
        organizationId: orgA,
        companyId: company.id,
        email: `dup-${suffix}@example.com`,
        emailNormalized: `dup-${suffix}@example.com`,
      },
    });
    const p = await createSalesProspect({
      organizationId: orgA,
      leadCompanyId: company.id,
      leadContactId: contact.id,
      preferredChannel: 'EMAIL',
    });
    const inbound = await ingestInboundMessage({
      organizationId: orgA,
      prospectId: p.prospect.id,
      channel: 'EMAIL',
      from: `dup-${suffix}@example.com`,
      content: 'Please send pricing and arrange a call',
      providerMessageId: `dup-in-${suffix}`,
    });
    const first = await runSalesAgent({
      organizationId: orgA,
      prospectId: p.prospect.id,
      trigger: 'INBOUND_REPLY',
      inboundMessageId: inbound.message.id,
      llmCall: async () => ({
        action: 'HANDOFF',
        prospectStatus: 'HANDOFF',
        replyIntent: 'REQUEST_QUOTE',
        handoffReason: 'quote',
        summary: 'handoff',
      }),
    });
    const second = await runSalesAgent({
      organizationId: orgA,
      prospectId: p.prospect.id,
      trigger: 'INBOUND_REPLY',
      inboundMessageId: inbound.message.id,
      llmCall: async () => ({
        action: 'SEND',
        channel: 'EMAIL',
        subject: 'x',
        message: 'duplicate should not send',
        prospectStatus: 'CONTACTED',
        summary: 'dup',
      }),
    });
    expect(second.duplicated).toBe(true);
    expect(second.runId).toBe(first.runId);
    const runs = await prisma.salesAgentRun.count({
      where: {
        organizationId: orgA,
        triggerInboundMessageId: inbound.message.id,
      },
    });
    expect(runs).toBe(1);
  });

  it('17. conversation context has message limit', async () => {
    env.salesAgentContextMessageLimit = 5;
    const ctx = await loadSalesAgentContext({
      organizationId: orgA,
      prospectId,
      messageLimit: 5,
    });
    expect(ctx.messageLimit).toBe(5);
    expect(ctx.messages.length).toBeLessThanOrEqual(5);
  });

  it('18. organization isolation on agent run', async () => {
    await expect(
      runSalesAgent({
        organizationId: orgB,
        prospectId,
        trigger: 'MANUAL',
        executeActions: false,
        llmCall: async () => ({ action: 'WAIT', prospectStatus: 'NEW', summary: 'x' }),
      }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH' });
  });

  it('19. Email/WhatsApp gateways are not reimplemented in agent code', () => {
    const agentFiles = [
      path.resolve(__dirname, '../src/services/sales/sales-agent.service.ts'),
      path.resolve(__dirname, '../src/services/sales/sales-agent.types.ts'),
      path.resolve(__dirname, '../src/workers/sales-agent.worker.ts'),
    ];
    const joined = agentFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(joined).toMatch(/queueOutboundMessage/);
    expect(joined).not.toMatch(/nodemailer/);
    expect(joined).not.toMatch(/graph\.facebook\.com/);
    expect(joined).not.toMatch(/createTransport/);
  });

  it('GET prospects?status=HANDOFF lists handoff prospects', async () => {
    const { listSalesProspects } = await import('../src/services/sales/sales-prospect.service');
    const listed = await listSalesProspects({ organizationId: orgA, status: 'HANDOFF' });
    expect(listed.prospects.every((p) => p.status === 'HANDOFF')).toBe(true);
    expect(listed.prospects.length).toBeGreaterThan(0);
  });
});
