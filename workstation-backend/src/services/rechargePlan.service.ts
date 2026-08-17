import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

export type RechargePlanPublic = {
  id: string;
  name: string;
  priceCents: number;
  creditAmount: number;
  description: string | null;
};

function decimalToNumber(value: Prisma.Decimal | number): number {
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

export const rechargePlanService = {
  /** List enabled plans for the recharge UI (DB-backed, sortOrder asc). */
  async listEnabledPlans(): Promise<RechargePlanPublic[]> {
    const plans = await prisma.rechargePlan.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        priceCents: true,
        creditAmount: true,
        description: true,
      },
    });

    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceCents: plan.priceCents,
      creditAmount: decimalToNumber(plan.creditAmount),
      description: plan.description,
    }));
  },
};
