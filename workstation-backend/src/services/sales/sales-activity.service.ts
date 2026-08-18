import type { Prisma, SalesActivityType } from '@prisma/client';
import { prisma } from '../../config/database';

export async function recordSalesActivity(params: {
  organizationId: string;
  prospectId: string;
  type: SalesActivityType;
  payload?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.salesActivity.create({
    data: {
      organizationId: params.organizationId,
      prospectId: params.prospectId,
      type: params.type,
      payload: params.payload ?? undefined,
    },
  });
}

export async function listSalesActivities(params: {
  organizationId: string;
  prospectId: string;
}) {
  return prisma.salesActivity.findMany({
    where: { organizationId: params.organizationId, prospectId: params.prospectId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
