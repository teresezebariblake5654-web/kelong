import fs from 'fs';
import { randomUUID } from 'crypto';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { agentService } from './agent.service';
import { parserService, ParsedPreview } from './parser.service';
import { modelProviderService } from './modelProvider.service';
import { getActiveLlmModel } from '../providers/llm';
import { reportService } from './report.service';
import { AppError } from '../utils/errors';
import {
  assertBalanceForBillingMode,
  consumeAiCreditsByMode,
} from './aiCreditConsume.service';
import {
  BillingMode,
  assertAgentRunCanContinue,
  beginOrGetAgentRun,
  recordAgentRunCharge,
} from './aiBillingMode';
import { orgCreditService } from './orgCredit.service';

const HR_SYSTEM_PROMPT = `你是一名资深 HR 数据分析专家，擅长从 Excel 表格中提取人事洞察并生成专业报告。
请基于用户提供的数据摘要和任务需求，输出结构化、可执行的 HR 分析结论。
使用中文，结论要有依据，若数据不足请明确说明。`;

export interface RunAgentResult {
  reportId: string;
  content: string;
  chargedCredits: number;
  creditsLeft: number;
  agentRunId: string;
  stepsUsed: number;
}

function buildUserPrompt(task: string, originalName: string, parsedPreview: ParsedPreview): string {
  return `# 用户任务
${task}

# 文件信息
- 文件名: ${originalName}

# Excel 数据摘要
${JSON.stringify(parsedPreview, null, 2)}

请基于以上信息生成完整的 HR 数据分析报告。`;
}

function extractSummary(content: string): string {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const paragraph = lines.find((line) => !line.startsWith('#') && !line.startsWith('>'));
  return (paragraph ?? lines[0] ?? '').slice(0, 200);
}

export const runnerService = {
  async runAgent(
    userId: string,
    organizationId: string,
    agentId: string,
    fileId: string,
    task: string,
    options: { agentRunId?: string } = {},
  ): Promise<RunAgentResult> {
    const agent = agentService.get(agentId);

    if (agent.status !== 'active') {
      throw new AppError(400, `智能体「${agent.name}」暂未开放`, 'AGENT_INACTIVE');
    }

    if (agentId !== 'hr') {
      throw new AppError(400, '第一版仅支持 HR 智能体', 'AGENT_NOT_SUPPORTED');
    }

    if (!task.trim()) {
      throw new AppError(400, '请填写分析任务', 'BAD_REQUEST');
    }

    const agentRunId = options.agentRunId?.trim() || randomUUID();
    beginOrGetAgentRun({ agentRunId, organizationId, userId });
    assertAgentRunCanContinue(agentRunId);

    if (env.licenseEnforcementEnabled) {
      await orgCreditService.ensureAccount(organizationId, { userId });
      await assertBalanceForBillingMode(organizationId, BillingMode.Agent);
    }

    const file = await prisma.file.findFirst({
      where: { id: fileId, organizationId },
    });

    if (!file) {
      throw new AppError(404, '文件不存在', 'NOT_FOUND');
    }

    if (!fs.existsSync(file.storagePath)) {
      throw new AppError(404, '文件不存在于存储路径', 'FILE_NOT_FOUND');
    }

    if (!agent.supportedFiles.includes(file.extension.toLowerCase())) {
      throw new AppError(400, '当前智能体不支持该文件类型', 'UNSUPPORTED_FILE_TYPE');
    }

    const parsedPreview = parserService.parseExcelFile(file.storagePath, file.extension);
    const userPrompt = buildUserPrompt(task, file.originalName, parsedPreview);
    const billingRequestId = randomUUID();

    const modelResult = await modelProviderService.generateReport({
      systemPrompt: HR_SYSTEM_PROMPT,
      userPrompt,
      model: getActiveLlmModel(),
    });

    let chargedCredits = 0;
    let creditsLeft = 0;
    if (env.licenseEnforcementEnabled) {
      const debit = await consumeAiCreditsByMode({
        organizationId,
        userId,
        requestId: billingRequestId,
        billingMode: BillingMode.Agent,
        inputTokens: modelResult.usage.inputTokens,
        outputTokens: modelResult.usage.outputTokens,
        descriptionExtra: `agentId=${agentId} agentRunId=${agentRunId}`,
      });
      chargedCredits = debit.finalCost;
      creditsLeft = debit.balanceAfter;
      recordAgentRunCharge(agentRunId, debit.finalCost);
    } else {
      recordAgentRunCharge(agentRunId, 0);
    }

    const summary = extractSummary(modelResult.content);
    const title = `${agent.name} - ${task.slice(0, 40)}`;

    const report = await reportService.createReport({
      userId,
      organizationId,
      agentId,
      fileId,
      title,
      task,
      content: modelResult.content,
      summary,
      status: 'completed',
      creditCost: chargedCredits,
    });

    await prisma.usageLog.create({
      data: {
        userId,
        organizationId,
        reportId: report.reportId,
        agentId,
        modelProvider: modelResult.provider,
        modelName: modelResult.model,
        inputTokens: modelResult.usage.inputTokens,
        outputTokens: modelResult.usage.outputTokens,
        providerCost: 0,
        chargedCredits,
        status: 'completed',
      },
    });

    const run = beginOrGetAgentRun({ agentRunId, organizationId, userId });

    return {
      reportId: report.reportId,
      content: modelResult.content,
      chargedCredits,
      creditsLeft,
      agentRunId,
      stepsUsed: run.steps,
    };
  },
};
