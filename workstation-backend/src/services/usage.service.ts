import { prisma } from '../config/database';

const usageLogSelect = {
  agentId: true,
  modelProvider: true,
  modelName: true,
  inputTokens: true,
  outputTokens: true,
  chargedCredits: true,
  status: true,
  createdAt: true,
} as const;

export const usageService = {
  async getUserLogs(userId: string, organizationId?: string, limit = 50) {
    return prisma.usageLog.findMany({
      where: {
        userId,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: usageLogSelect,
    });
  },

  async listByOrganization(organizationId: string, limit = 50) {
    return prisma.usageLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: usageLogSelect,
    });
  },

  async listAll(limit = 100) {
    return prisma.usageLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        ...usageLogSelect,
        userId: true,
        reportId: true,
        organizationId: true,
      },
    });
  },
};
