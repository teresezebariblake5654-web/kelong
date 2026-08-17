import { prisma } from '../config/database';
import { AppError } from '../utils/errors';

export interface CreateReportInput {
  userId: string;
  organizationId: string;
  agentId: string;
  fileId?: string;
  title: string;
  task: string;
  content?: string;
  summary?: string;
  status?: string;
  creditCost?: number;
}

function toListItem(report: {
  id: string;
  agentId: string;
  title: string;
  summary: string | null;
  status: string;
  creditCost: number;
  createdAt: Date;
}) {
  return {
    reportId: report.id,
    agentId: report.agentId,
    title: report.title,
    summary: report.summary,
    status: report.status,
    creditCost: report.creditCost,
    createdAt: report.createdAt,
  };
}

function toDetail(report: {
  id: string;
  userId: string;
  organizationId: string;
  agentId: string;
  fileId: string | null;
  title: string;
  task: string;
  content: string;
  summary: string | null;
  status: string;
  creditCost: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    reportId: report.id,
    userId: report.userId,
    organizationId: report.organizationId,
    agentId: report.agentId,
    fileId: report.fileId,
    title: report.title,
    task: report.task,
    content: report.content,
    summary: report.summary,
    status: report.status,
    creditCost: report.creditCost,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

export const reportService = {
  async createReport(input: CreateReportInput) {
    const report = await prisma.report.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        agentId: input.agentId,
        fileId: input.fileId,
        title: input.title,
        task: input.task,
        content: input.content ?? '',
        summary: input.summary,
        status: input.status ?? 'pending',
        creditCost: input.creditCost ?? 0,
      },
    });

    return toDetail(report);
  },

  async getUserReports(organizationId: string) {
    const reports = await prisma.report.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return reports.map(toListItem);
  },

  async getReportById(organizationId: string, reportId: string) {
    const report = await prisma.report.findFirst({
      where: { id: reportId, organizationId },
    });

    if (!report) {
      throw new AppError(404, '报告不存在', 'NOT_FOUND');
    }

    return toDetail(report);
  },
};
