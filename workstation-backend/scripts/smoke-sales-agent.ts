/**
 * Phase 3 sales-agent smoke (AI decision + inbound→handoff).
 * Does not fake Email/WhatsApp SENT without credentials.
 *   npm run smoke:sales-agent
 */
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { isSalesEmailTransportConfigured } from '../src/services/mail.service';
import { isWhatsAppChannelConfigured } from '../src/providers/sales-channels/whatsapp.gateway';
import { createSalesAgentProfile } from '../src/services/sales/sales-agent-profile.service';
import { runSalesAgent } from '../src/services/sales/sales-agent.service';
import { ingestInboundMessage } from '../src/services/sales/sales-inbound.service';
import { salesAgentDecisionSchema } from '../src/services/sales/sales-agent.types';

function line(label: string, status: 'PASS' | 'BLOCKED', detail: string) {
  console.log(`[smoke-sales-agent] ${label}: ${status} — ${detail}`);
}

async function main() {
  await connectDatabase();

  const prospect = await prisma.salesProspect.findFirst({
    where: {
      status: { notIn: ['CLOSED', 'NOT_INTERESTED'] },
      leadContactId: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!prospect) {
    line('Smoke A AI Decision', 'BLOCKED', 'NO_PROSPECT');
    line('Smoke B Inbound→Handoff', 'BLOCKED', 'NO_PROSPECT');
    line('Smoke C Real Channel', 'BLOCKED', 'BLOCKED_BY_PROVIDER_CONFIG');
    return;
  }

  await createSalesAgentProfile({
    organizationId: prospect.organizationId,
    name: 'Smoke Sales Agent',
    companyDescription: 'LobsterAI B2B outreach smoke company',
    productDescription: 'AI workstation for sales teams',
    targetCustomerDescription: 'Distributors and procurement managers',
    tone: 'professional',
    language: 'en',
    salesInstructions: 'Be concise. Escalate quotes and meetings.',
    handoffInstructions: 'Handoff on quote or meeting requests.',
    isActive: true,
  });

  // Reset blocking statuses for smoke A if needed
  if (prospect.status === 'HANDOFF') {
    await prisma.salesProspect.update({
      where: { id: prospect.id },
      data: { status: 'NEW', handoff: undefined as never, nextFollowUpAt: null },
    });
  }

  const decisionResult = await runSalesAgent({
    organizationId: prospect.organizationId,
    prospectId: prospect.id,
    trigger: 'INITIAL_OUTREACH',
    executeActions: false,
  });
  const run = await prisma.salesAgentRun.findUnique({ where: { id: decisionResult.runId } });
  const parsed = salesAgentDecisionSchema.safeParse(decisionResult.decision);
  if (!run || !parsed.success) {
    throw new Error('Smoke A failed: invalid SalesAgentRun / decision');
  }
  line(
    'Smoke A AI Decision',
    'PASS',
    `run=${run.id} action=${parsed.data.action} status=${parsed.data.prospectStatus} model=${run.model}`,
  );

  const inbound = await ingestInboundMessage({
    organizationId: prospect.organizationId,
    prospectId: prospect.id,
    channel: prospect.preferredChannel,
    from: 'smoke-buyer@example.com',
    content: 'We are interested. Please send pricing and arrange a call.',
    providerMessageId: `smoke-agent-inbound-${Date.now()}`,
  });

  const handoffResult = await runSalesAgent({
    organizationId: prospect.organizationId,
    prospectId: prospect.id,
    trigger: 'INBOUND_REPLY',
    inboundMessageId: inbound.message.id,
    executeActions: true,
  });
  const after = await prisma.salesProspect.findUnique({ where: { id: prospect.id } });
  if (
    handoffResult.decision?.action !== 'HANDOFF' ||
    after?.status !== 'HANDOFF' ||
    !after.handoff
  ) {
    throw new Error(
      `Smoke B failed: expected HANDOFF, got action=${handoffResult.decision?.action} status=${after?.status}`,
    );
  }
  line(
    'Smoke B Inbound→Handoff',
    'PASS',
    `inbound=${inbound.message.id} run=${handoffResult.runId} intent=${handoffResult.decision?.replyIntent}`,
  );

  if (!isSalesEmailTransportConfigured() && !isWhatsAppChannelConfigured()) {
    line(
      'Smoke C Real Channel',
      'BLOCKED',
      'BLOCKED_BY_PROVIDER_CONFIG (AI decision path OK; no SMTP/WhatsApp credentials)',
    );
  } else {
    const send = await runSalesAgent({
      organizationId: prospect.organizationId,
      prospectId: prospect.id,
      trigger: 'MANUAL',
      executeActions: true,
      llmCall: async () => ({
        action: 'WAIT',
        prospectStatus: 'HANDOFF',
        summary: 'Already handoff — skip real send in smoke C without clearing handoff',
      }),
    });
    line(
      'Smoke C Real Channel',
      'BLOCKED',
      `Provider may be configured but prospect is HANDOFF after Smoke B (skipped send). lastRun=${send.runId}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[smoke-sales-agent] FAILED', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
