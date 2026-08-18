import type { SalesAgentProfile } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';

export type UpsertSalesAgentProfileInput = {
  organizationId: string;
  name: string;
  role?: string;
  companyDescription: string;
  productDescription: string;
  targetCustomerDescription: string;
  tone?: string;
  language?: string;
  salesInstructions?: string;
  handoffInstructions?: string;
  isActive?: boolean;
};

function toProfileDto(row: SalesAgentProfile) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    role: row.role,
    companyDescription: row.companyDescription,
    productDescription: row.productDescription,
    targetCustomerDescription: row.targetCustomerDescription,
    tone: row.tone,
    language: row.language,
    salesInstructions: row.salesInstructions,
    handoffInstructions: row.handoffInstructions,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createSalesAgentProfile(input: UpsertSalesAgentProfileInput) {
  const row = await prisma.salesAgentProfile.create({
    data: {
      organizationId: input.organizationId,
      name: input.name.trim(),
      role: input.role?.trim() || 'Sales Representative',
      companyDescription: input.companyDescription.trim(),
      productDescription: input.productDescription.trim(),
      targetCustomerDescription: input.targetCustomerDescription.trim(),
      tone: input.tone?.trim() || 'professional',
      language: input.language?.trim() || 'en',
      salesInstructions: input.salesInstructions?.trim() || null,
      handoffInstructions: input.handoffInstructions?.trim() || null,
      isActive: input.isActive ?? true,
    },
  });
  return { profile: toProfileDto(row) };
}

export async function listSalesAgentProfiles(organizationId: string) {
  const rows = await prisma.salesAgentProfile.findMany({
    where: { organizationId },
    orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    take: 50,
  });
  return { profiles: rows.map(toProfileDto) };
}

export async function getSalesAgentProfile(params: { organizationId: string; profileId: string }) {
  const row = await prisma.salesAgentProfile.findUnique({ where: { id: params.profileId } });
  if (!row) throw new AppError(404, '销售员工配置不存在', 'SALES_AGENT_PROFILE_NOT_FOUND');
  if (row.organizationId !== params.organizationId) {
    throw new AppError(403, '无权访问该配置', 'ORGANIZATION_MISMATCH');
  }
  return { profile: toProfileDto(row) };
}

export async function getActiveSalesAgentProfile(organizationId: string): Promise<SalesAgentProfile | null> {
  return prisma.salesAgentProfile.findFirst({
    where: { organizationId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
}

export function ensureDefaultProfileShape(organizationId: string): UpsertSalesAgentProfileInput {
  return {
    organizationId,
    name: 'Default Sales Agent',
    role: 'Sales Representative',
    companyDescription: 'Our company helps B2B buyers source quality products.',
    productDescription: 'We offer products and services matched to the buyer ICP.',
    targetCustomerDescription: 'Distributors and procurement managers in target markets.',
    tone: 'professional',
    language: 'en',
    salesInstructions: 'Be concise. Do not invent pricing. Escalate quotes and meetings to humans.',
    handoffInstructions: 'Handoff for quote requests, meeting requests, or unclear high-intent deals.',
    isActive: true,
  };
}

export async function requireActiveSalesAgentProfile(organizationId: string): Promise<SalesAgentProfile> {
  const existing = await getActiveSalesAgentProfile(organizationId);
  if (existing) return existing;
  const created = await createSalesAgentProfile(ensureDefaultProfileShape(organizationId));
  const row = await prisma.salesAgentProfile.findUnique({ where: { id: created.profile.id } });
  if (!row) throw new AppError(500, '无法创建销售员工配置', 'SALES_AGENT_PROFILE_CREATE_FAILED');
  return row;
}
