import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

/**
 * Business-level org outbound rate limit (not Express rate-limit).
 * Counts QUEUED/SENT/DELIVERED outbound messages created in the last hour.
 */
export async function assertOrgOutboundRateAllowed(organizationId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.salesMessage.count({
    where: {
      organizationId,
      direction: 'OUTBOUND',
      status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
      createdAt: { gte: since },
    },
  });
  if (count >= env.salesMaxOutboundPerOrgPerHour) {
    throw new AppError(
      429,
      `组织每小时发送上限已达 ${env.salesMaxOutboundPerOrgPerHour}`,
      'ORG_OUTBOUND_RATE_LIMITED',
    );
  }
}

export async function countOrgOutboundLastHour(organizationId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.salesMessage.count({
    where: {
      organizationId,
      direction: 'OUTBOUND',
      status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
      createdAt: { gte: since },
    },
  });
}
