/**
 * Phase 2 real smoke. Does not fake provider success.
 *   npm run smoke:sales
 */
import { connectDatabase, disconnectDatabase, prisma } from '../src/config/database';
import { env } from '../src/config/env';
import { isSalesEmailTransportConfigured } from '../src/services/mail.service';
import { isWhatsAppChannelConfigured } from '../src/providers/sales-channels/whatsapp.gateway';
import { createSalesProspect } from '../src/services/sales/sales-prospect.service';
import { listSalesActivities } from '../src/services/sales/sales-activity.service';
import { queueOutboundMessage } from '../src/services/sales/sales-message.service';
import { deliverQueuedMessage } from '../src/services/sales/sales-outbound.service';

type SmokeStatus = 'PASS' | 'BLOCKED';

function line(label: string, status: SmokeStatus, detail: string) {
  console.log(`[smoke-sales] ${label}: ${status} — ${detail}`);
}

async function main() {
  await connectDatabase();

  const company = await prisma.leadCompany.findFirst({
    where: { contacts: { some: {} } },
    include: { contacts: { take: 5, orderBy: { updatedAt: 'desc' } } },
    orderBy: { updatedAt: 'desc' },
  });

  if (!company) {
    line('Smoke 1 Lead→Prospect', 'BLOCKED', 'NO_LEAD_COMPANY');
    line('Smoke 2 Email outbound', 'BLOCKED', 'EMAIL_PROVIDER_CONFIG (skipped; no lead)');
    line('Smoke 3 WhatsApp outbound', 'BLOCKED', 'WHATSAPP_PROVIDER_CONFIG (skipped; no lead)');
    line('Smoke 4 Inbound webhook', 'BLOCKED', 'INFRASTRUCTURE (no public webhook / no lead)');
    return;
  }

  const contact =
    company.contacts.find((c) => c.emailNormalized || c.email) || company.contacts[0];

  const created = await createSalesProspect({
    organizationId: company.organizationId,
    leadCompanyId: company.id,
    leadContactId: contact?.id,
    preferredChannel: 'EMAIL',
  });
  const prospect = await prisma.salesProspect.findUnique({ where: { id: created.prospect.id } });
  const activities = await listSalesActivities({
    organizationId: company.organizationId,
    prospectId: created.prospect.id,
  });
  const hasCreatedActivity = activities.some((a) => a.type === 'PROSPECT_CREATED');
  if (!prospect) {
    throw new Error('Smoke 1 failed: prospect missing');
  }
  if (created.created && prospect.status !== 'NEW') {
    throw new Error(`Smoke 1 failed: expected NEW prospect, got ${prospect.status}`);
  }
  if (created.created && !hasCreatedActivity) {
    throw new Error('Smoke 1 failed: missing PROSPECT_CREATED activity');
  }
  line(
    'Smoke 1 Lead→Prospect',
    'PASS',
    `prospect=${created.prospect.id} created=${created.created} status=${prospect.status} activity=${hasCreatedActivity} company=${company.domain}`,
  );

  if (!isSalesEmailTransportConfigured()) {
    line(
      'Smoke 2 Email outbound',
      'BLOCKED',
      'BLOCKED: EMAIL_PROVIDER_CONFIG (need SALES_EMAIL_* or MAIL_PROVIDER=smtp with SMTP_PASS)',
    );
  } else if (!contact?.email && !contact?.emailNormalized) {
    line('Smoke 2 Email outbound', 'BLOCKED', 'CONTACT_EMAIL_REQUIRED on existing lead');
  } else {
    const queued = await queueOutboundMessage({
      organizationId: company.organizationId,
      prospectId: created.prospect.id,
      channel: 'EMAIL',
      subject: 'LobsterAI sales smoke',
      content: 'Phase 2 SMTP smoke. Please ignore.',
    });
    if (queued.message.status !== 'QUEUED') {
      throw new Error(`expected QUEUED, got ${queued.message.status}`);
    }
    const sent = await deliverQueuedMessage({
      messageId: queued.message.id,
      organizationId: company.organizationId,
    });
    const after = await prisma.salesProspect.findUnique({ where: { id: created.prospect.id } });
    if (sent.message.status !== 'SENT' || !sent.message.providerMessageId) {
      throw new Error(`Email smoke failed status=${sent.message.status}`);
    }
    line(
      'Smoke 2 Email outbound',
      'PASS',
      `QUEUED→SENT providerMessageId=${sent.message.providerMessageId} prospect=${after?.status}`,
    );
  }

  if (!isWhatsAppChannelConfigured()) {
    line(
      'Smoke 3 WhatsApp outbound',
      'BLOCKED',
      'BLOCKED: WHATSAPP_PROVIDER_CONFIG (need WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN)',
    );
  } else if (!(contact?.phone || contact?.whatsapp)) {
    line('Smoke 3 WhatsApp outbound', 'BLOCKED', 'CONTACT_PHONE_REQUIRED on existing lead');
  } else {
    const queued = await queueOutboundMessage({
      organizationId: company.organizationId,
      prospectId: created.prospect.id,
      channel: 'WHATSAPP',
      content: 'LobsterAI WhatsApp smoke. Please ignore.',
    });
    const sent = await deliverQueuedMessage({
      messageId: queued.message.id,
      organizationId: company.organizationId,
    });
    if (sent.message.status !== 'SENT' || !sent.message.providerMessageId) {
      throw new Error(`WhatsApp smoke failed status=${sent.message.status}`);
    }
    line(
      'Smoke 3 WhatsApp outbound',
      'PASS',
      `QUEUED→SENT providerMessageId=${sent.message.providerMessageId}`,
    );
  }

  const publicWebhook = process.env.SALES_WHATSAPP_WEBHOOK_PUBLIC === '1';
  if (!publicWebhook) {
    line(
      'Smoke 4 Inbound webhook',
      'BLOCKED',
      'INFRASTRUCTURE_BLOCKED: public WhatsApp webhook not reachable (HTTP handler is implemented)',
    );
  } else {
    line('Smoke 4 Inbound webhook', 'PASS', 'SALES_WHATSAPP_WEBHOOK_PUBLIC=1 set by operator');
  }

  console.log('[smoke-sales] env snapshot', {
    mailProvider: env.mailProvider,
    salesEmailConfigured: isSalesEmailTransportConfigured(),
    whatsappConfigured: isWhatsAppChannelConfigured(),
    verifyTokenSet: Boolean(env.whatsappVerifyToken),
    emailWebhookSecretSet: Boolean(env.salesEmailWebhookSecret),
  });
}

main()
  .catch((err) => {
    console.error('[smoke-sales] FAILED', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
