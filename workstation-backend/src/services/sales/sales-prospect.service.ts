import type { SalesChannel, SalesProspect, SalesProspectStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { recordSalesActivity } from './sales-activity.service';

export type CreateSalesProspectInput = {
  organizationId: string;
  leadCompanyId: string;
  leadContactId?: string;
  preferredChannel: SalesChannel;
};

function toProspectDto(row: SalesProspect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    leadCompanyId: row.leadCompanyId,
    leadContactId: row.leadContactId,
    status: row.status,
    preferredChannel: row.preferredChannel,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    handoff: row.handoff,
    lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createSalesProspect(input: CreateSalesProspectInput) {
  const company = await prisma.leadCompany.findUnique({
    where: { id: input.leadCompanyId },
  });
  if (!company) {
    throw new AppError(404, '获客公司不存在', 'LEAD_COMPANY_NOT_FOUND');
  }
  if (company.organizationId !== input.organizationId) {
    throw new AppError(403, '无权引用该公司', 'ORGANIZATION_MISMATCH');
  }

  if (input.leadContactId) {
    const contact = await prisma.leadContact.findUnique({
      where: { id: input.leadContactId },
    });
    if (!contact) {
      throw new AppError(404, '联系人不存在', 'LEAD_CONTACT_NOT_FOUND');
    }
    if (contact.organizationId !== input.organizationId) {
      throw new AppError(403, '无权引用该联系人', 'ORGANIZATION_MISMATCH');
    }
    if (contact.companyId !== company.id) {
      throw new AppError(400, '联系人不属于该公司', 'LEAD_CONTACT_COMPANY_MISMATCH');
    }
  }

  const existing = await prisma.salesProspect.findUnique({
    where: {
      organizationId_leadCompanyId: {
        organizationId: input.organizationId,
        leadCompanyId: company.id,
      },
    },
  });
  if (existing) {
    return { prospect: toProspectDto(existing), created: false };
  }

  const prospect = await prisma.salesProspect.create({
    data: {
      organizationId: input.organizationId,
      leadCompanyId: company.id,
      leadContactId: input.leadContactId || null,
      preferredChannel: input.preferredChannel,
      status: 'NEW',
    },
  });
  await recordSalesActivity({
    organizationId: input.organizationId,
    prospectId: prospect.id,
    type: 'PROSPECT_CREATED',
    payload: {
      leadCompanyId: company.id,
      leadContactId: prospect.leadContactId,
      preferredChannel: prospect.preferredChannel,
    },
  });
  return { prospect: toProspectDto(prospect), created: true };
}

export async function listSalesProspects(params: {
  organizationId: string;
  page?: number;
  pageSize?: number;
  status?: SalesProspectStatus;
}) {
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 20, 1), 100);
  const where = {
    organizationId: params.organizationId,
    ...(params.status ? { status: params.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.salesProspect.count({ where }),
    prisma.salesProspect.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
    prospects: rows.map(toProspectDto),
  };
}

export async function getSalesProspect(params: { organizationId: string; prospectId: string }) {
  const row = await prisma.salesProspect.findUnique({ where: { id: params.prospectId } });
  if (!row) {
    throw new AppError(404, '销售线索不存在', 'SALES_PROSPECT_NOT_FOUND');
  }
  if (row.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该销售线索', 'ORGANIZATION_MISMATCH');
  }
  return { prospect: toProspectDto(row) };
}

export async function requireProspect(params: { organizationId: string; prospectId: string }) {
  const row = await prisma.salesProspect.findUnique({ where: { id: params.prospectId } });
  if (!row) {
    throw new AppError(404, '销售线索不存在', 'SALES_PROSPECT_NOT_FOUND');
  }
  if (row.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该销售线索', 'ORGANIZATION_MISMATCH');
  }
  return row;
}

export async function transitionProspectStatus(params: {
  organizationId: string;
  prospectId: string;
  next: SalesProspectStatus;
}): Promise<SalesProspectStatus> {
  const prospect = await requireProspect(params);
  if (prospect.status === params.next) return prospect.status;

  // Terminal statuses — never reopen via auto transitions.
  const terminal = new Set<SalesProspectStatus>(['CLOSED', 'NOT_INTERESTED', 'HANDOFF']);
  if (terminal.has(prospect.status) && params.next !== prospect.status) {
    // Allow HANDOFF only if already HANDOFF (no-op above). Block CLOSED reopen / HANDOFF→FOLLOW_UP.
    return prospect.status;
  }
  if (prospect.status === 'REPLIED' && params.next === 'CONTACTED') {
    return prospect.status;
  }
  if (prospect.status === 'INTERESTED' && params.next === 'CONTACTED') {
    return prospect.status;
  }
  await prisma.salesProspect.update({
    where: { id: prospect.id },
    data: { status: params.next },
  });
  await recordSalesActivity({
    organizationId: params.organizationId,
    prospectId: prospect.id,
    type: 'STATUS_CHANGED',
    payload: { from: prospect.status, to: params.next },
  });
  return params.next;
}
