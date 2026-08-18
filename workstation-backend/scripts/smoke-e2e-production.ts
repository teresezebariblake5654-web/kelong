/**
 * Phase 4 production E2E smoke (backend only).
 *   npm run smoke:e2e
 *
 * Does not fake Email/WhatsApp SENT or LLM success.
 */
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { Prisma } from '@prisma/client';
import { env } from '../src/config/env';
import { isSalesEmailTransportConfigured } from '../src/services/mail.service';
import { isWhatsAppChannelConfigured } from '../src/providers/sales-channels/whatsapp.gateway';
import { createSalesProspect } from '../src/services/sales/sales-prospect.service';
import { createSalesAgentProfile } from '../src/services/sales/sales-agent-profile.service';
import { runSalesAgent } from '../src/services/sales/sales-agent.service';
import { ingestInboundMessage } from '../src/services/sales/sales-inbound.service';
import { salesAgentDecisionSchema } from '../src/services/sales/sales-agent.types';
import { getSystemProviderHealth } from '../src/services/system/provider-health.service';
import {
  extractJsonObject,
  getActiveLlmModel,
  getOpenAICompatibleChatClient,
} from '../src/providers/llm';

function line(label: string, status: 'PASS' | 'BLOCKED', detail: string) {
  console.log(`[smoke-e2e] ${label}: ${status} — ${detail}`);
}

async function main() {
  await connectDatabase();

  const health = await getSystemProviderHealth();
  console.log('[smoke-e2e] provider-health', {
    postgres: health.postgres.status,
    redis: health.redis.status,
    llm: health.llm.status,
    email: health.email.status,
    whatsapp: health.whatsapp.status,
  });

  // --- Real LLM smoke ---
  let llmSource: 'llm' | 'fallback' | 'blocked' = 'blocked';
  try {
    const client = getOpenAICompatibleChatClient();
    const model = getActiveLlmModel();
    const result = await client.chat({
      systemPrompt: 'Return ONLY JSON: {"ok":true}',
      userPrompt: '{"ping":1}',
      model,
      maxOutputTokens: 50,
      temperature: 0,
      jsonMode: true,
    });
    const parsed = extractJsonObject(result.content) as { ok?: boolean };
    if (parsed?.ok === true) {
      llmSource = 'llm';
      line('Real LLM Smoke', 'PASS', `model=${model}`);
    } else {
      line('Real LLM Smoke', 'BLOCKED', 'BLOCKED: LLM_PROVIDER (unexpected JSON)');
    }
  } catch (err) {
    line(
      'Real LLM Smoke',
      'BLOCKED',
      `BLOCKED: LLM_PROVIDER (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  let company = await prisma.leadCompany.findFirst({
    where: { contacts: { some: {} } },
    include: { contacts: { take: 1, orderBy: { updatedAt: 'desc' } } },
    orderBy: { updatedAt: 'desc' },
  });
  if (!company || !company.contacts[0]) {
    const org = await prisma.organization.create({
      data: { name: `E2E Org ${Date.now()}`, slug: `e2e-${Date.now()}` },
    });
    const seeded = await prisma.leadCompany.create({
      data: {
        organizationId: org.id,
        domain: `e2e-${Date.now()}.example`,
        normalizedDomain: `e2e-${Date.now()}.example`,
        name: 'E2E Fixture Co',
        contacts: {
          create: {
            organizationId: org.id,
            email: `e2e-${Date.now()}@example.com`,
            emailNormalized: `e2e-${Date.now()}@example.com`,
          },
        },
      },
      include: { contacts: true },
    });
    company = seeded;
    line('Lead→Sales E2E (live discovery)', 'BLOCKED', 'NO_EXISTING_LEAD; seeded fixture company (SearXNG/Redis not required for sales half)');
  }

  await createSalesAgentProfile({
    organizationId: company.organizationId,
    name: 'E2E Sales Agent',
    companyDescription: 'E2E smoke company',
    productDescription: 'AI workstation',
    targetCustomerDescription: 'Distributors',
    isActive: true,
  });

  const created = await createSalesProspect({
    organizationId: company.organizationId,
    leadCompanyId: company.id,
    leadContactId: company.contacts[0].id,
    preferredChannel: 'EMAIL',
  });

  // Reset terminal if needed for outreach decision
  if (['HANDOFF', 'CLOSED', 'NOT_INTERESTED'].includes(created.prospect.status)) {
    await prisma.salesProspect.update({
      where: { id: created.prospect.id },
      data: { status: 'NEW', nextFollowUpAt: null, handoff: Prisma.DbNull },
    });
  }

  const outreach = await runSalesAgent({
    organizationId: company.organizationId,
    prospectId: created.prospect.id,
    trigger: 'INITIAL_OUTREACH',
    executeActions: false,
  });
  const run = await prisma.salesAgentRun.findUnique({ where: { id: outreach.runId } });
  const decisionOk = salesAgentDecisionSchema.safeParse(outreach.decision).success;
  if (!run || !decisionOk) {
    throw new Error('Lead→Sales agent decision invalid');
  }
  const usedFallback =
    outreach.decision?.summary?.includes('Deterministic') ||
    outreach.decision?.summary?.includes('fallback') ||
    llmSource !== 'llm';
  line(
    'Lead→Sales E2E (Prospect→Agent Decision)',
    'PASS',
    `prospect=${created.prospect.id} action=${outreach.decision?.action} model=${run.model} llmLive=${llmSource === 'llm'}`,
  );
  if (llmSource !== 'llm') {
    line('Agent decision LLM path', 'BLOCKED', 'BLOCKED: LLM_PROVIDER (decision may be fallback)');
  } else if (usedFallback) {
    line('Agent decision LLM path', 'BLOCKED', 'LLM up but agent used fallback/deterministic');
  } else {
    line('Agent decision LLM path', 'PASS', 'structured decision from live LLM path or valid schema');
  }

  // Inbound → Handoff
  const inbound = await ingestInboundMessage({
    organizationId: company.organizationId,
    prospectId: created.prospect.id,
    channel: 'EMAIL',
    from: company.contacts[0].emailNormalized || company.contacts[0].email || 'e2e@example.com',
    content: 'We are interested. Please send pricing and arrange a call.',
    providerMessageId: `e2e-inbound-${Date.now()}`,
  });
  const handoff = await runSalesAgent({
    organizationId: company.organizationId,
    prospectId: created.prospect.id,
    trigger: 'INBOUND_REPLY',
    inboundMessageId: inbound.message.id,
    executeActions: true,
  });
  const after = await prisma.salesProspect.findUnique({ where: { id: created.prospect.id } });
  if (handoff.decision?.action !== 'HANDOFF' || after?.status !== 'HANDOFF') {
    throw new Error(`Inbound→Handoff failed action=${handoff.decision?.action} status=${after?.status}`);
  }
  const blockedFollowup = await runSalesAgent({
    organizationId: company.organizationId,
    prospectId: created.prospect.id,
    trigger: 'SCHEDULED_FOLLOWUP',
    executeActions: true,
    llmCall: async () => ({
      action: 'SEND',
      channel: 'EMAIL',
      subject: 'no',
      message: 'should not send',
      prospectStatus: 'CONTACTED',
      summary: 'blocked',
    }),
  });
  if (blockedFollowup.status !== 'SKIPPED' && blockedFollowup.outboundMessageId) {
    throw new Error('HANDOFF still sent outbound');
  }
  line(
    'Inbound→Handoff E2E',
    'PASS',
    `inbound=${inbound.message.id} run=${handoff.runId} followup=${blockedFollowup.status}`,
  );

  if (!isSalesEmailTransportConfigured()) {
    line('Email Smoke', 'BLOCKED', 'BLOCKED_BY_PROVIDER_CONFIG');
  } else {
    line('Email Smoke', 'BLOCKED', 'Configured but skipped auto-send to real inbox in e2e harness (use smoke:sales)');
  }
  if (!isWhatsAppChannelConfigured()) {
    line('WhatsApp Smoke', 'BLOCKED', 'BLOCKED_BY_PROVIDER_CONFIG');
  } else {
    line('WhatsApp Smoke', 'BLOCKED', 'Configured but skipped auto-send in e2e harness (use smoke:sales)');
  }

  console.log('[smoke-e2e] env', {
    mailProvider: env.mailProvider,
    salesMaxOutboundPerOrgPerHour: env.salesMaxOutboundPerOrgPerHour,
  });
}

main()
  .catch((err) => {
    console.error('[smoke-e2e] FAILED', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
