import { randomUUID } from 'crypto';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { getActiveLlmModel } from '../providers/llm';
import { imageAnalysisService } from './imageAnalysis.service';
import { modelProviderService } from './modelProvider.service';
import { AppError } from '../utils/errors';
import {
  assertBalanceForBillingMode,
  consumeAiCreditsByMode,
} from './aiCreditConsume.service';
import { BillingMode } from './aiBillingMode';
import { orgCreditService } from './orgCredit.service';

const TABLE_FORMAT_RULE =
  '输出格式要求：涉及差异、清单、对比、汇总、异常明细时，必须使用 GitHub 风格 Markdown 表格（含表头行与 |---| 分隔行），不要用空格对齐伪表格；可用简短结论文字+表格+建议三部分。';

const AGENT_PROMPTS: Record<string, string> = {
  general: `你是火星 AI 的 AI 助手。用简洁、专业的中文回答用户问题。可使用 Markdown 格式，但不要透露模型名称、供应商或 API 信息。${TABLE_FORMAT_RULE}`,
  'data-analysis': `你是数据分析助手。擅长解读表格、指标趋势、异常波动，并给出可执行建议。用 Markdown 回答。${TABLE_FORMAT_RULE}`,
  finance: `你是财务智能体。擅长费用清理、银行对账、应收应付、发票核对与经营汇总。回答要准确、审慎，优先给结论、差异原因与下一步动作。若用户提供了表格摘要，请基于摘要作答，不要编造未给出的数字。${TABLE_FORMAT_RULE}`,
  sales: `你是销售助手。擅长销售漏斗、业绩、客户与线索分析，回答要有洞察力。${TABLE_FORMAT_RULE}`,
  admin: `你是行政综合智能体。擅长资产盘点、费用汇总、会议室利用率与合同到期提醒。回答清晰可执行，涉及审批与合规时提醒人工确认。${TABLE_FORMAT_RULE}`,
  hr: `你是人事智能体。擅长工资核算差异、考勤异常、员工档案、入离职办理、社保核对、招聘漏斗与绩效分布。回答用中文 Markdown：先结论，再依据（表格），再建议；若有表格摘要请严格基于数据，不要捏造明细。${TABLE_FORMAT_RULE}`,
  production: `你是生产制造智能体。擅长物料日清、消耗核对、计划清理、进度追踪、质量异常与停机结案。优先指出差异、风险与可执行动作；有表格摘要时基于数据回答。${TABLE_FORMAT_RULE}`,
  logistics: `你是物流智能体。擅长库存盘点、出入库核对、在途追踪、库存预警与调拨清理。回答简洁，突出缺货/积压/差异与建议动作。${TABLE_FORMAT_RULE}`,
  ecommerce: `你是电商智能体。擅长订单清洗、退款核对、商品数据、直播订单与销售汇总。回答突出异常订单、退款风险与经营要点。${TABLE_FORMAT_RULE}`,
};

type SendChatInput = {
  organizationId: string;
  userId: string;
  conversationId: string;
  agentCode: string;
  content: string;
  fileIds: string[];
  imageIds: string[];
  templateCode?: string;
  userInstruction?: string;
};

export type ConversationContextMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export const CHAT_CONTEXT_MAX_MESSAGES = 20;
export const CHAT_CONTEXT_MAX_CHARS = 30_000;

/**
 * 只保留当前会话最近一段上下文。优先保留最新消息，达到消息数或字符预算后
 * 丢弃更早内容，避免把整段历史无限传给模型。
 */
export function buildRecentConversationContext(
  messages: ConversationContextMessage[],
  maxMessages = CHAT_CONTEXT_MAX_MESSAGES,
  maxChars = CHAT_CONTEXT_MAX_CHARS,
): ConversationContextMessage[] {
  const recent = messages.slice(-maxMessages);
  const selected: ConversationContextMessage[] = [];
  let remainingChars = maxChars;

  for (let index = recent.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const message = recent[index]!;
    if (message.content.length > remainingChars) {
      // 最新一条本身过长时保留其末尾；更早消息则整条丢弃，避免注入残缺句子。
      if (selected.length === 0) {
        selected.push({
          role: message.role,
          content: message.content.slice(message.content.length - remainingChars),
        });
      }
      break;
    }
    selected.push(message);
    remainingChars -= message.content.length;
  }

  return selected.reverse();
}

function buildUserPrompt(input: SendChatInput) {
  const instruction = input.userInstruction?.trim();
  const content = input.content.trim();
  if (instruction) {
    return [
      input.templateCode ? `模板编码：${input.templateCode}` : '',
      `用户附加指令：${instruction}`,
      content && content !== instruction ? `补充说明：${content}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (content) return content;
  if (input.templateCode) {
    return `请按模板「${input.templateCode}」的默认分析任务，对上传文件给出结构化洞察、关键发现与可执行建议。`;
  }
  return '（用户未输入文字，仅上传了附件）';
}

async function loadFileSummaries(organizationId: string, fileIds: string[]) {
  if (!fileIds.length) return [];
  const files = await prisma.file.findMany({
    where: { id: { in: fileIds }, organizationId },
  });
  if (files.length !== fileIds.length) {
    throw new AppError(404, '部分附件不存在或无权访问', 'NOT_FOUND');
  }
  return files.map(
    (file) =>
      `- ${file.originalName}（${file.extension}，${Math.round(file.size / 1024)}KB，fileId=${file.id}）`,
  );
}

async function buildImageContext(organizationId: string, imageIds: string[]) {
  if (!imageIds.length) return '';
  const blocks: string[] = [];
  for (const fileId of imageIds) {
    try {
      const result = await imageAnalysisService.analyzeImage({
        organizationId,
        fileId,
        instruction: '识别并分析图片内容，输出可供对话参考的摘要',
      });
      blocks.push(
        `图片 ${fileId}：${result.result.summary}\n识别文字：${result.result.extractedText || '无'}`,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'IMAGE_ANALYSIS_UNSUPPORTED') {
        throw error;
      }
      blocks.push(`图片 ${fileId}：识别失败，请稍后重试`);
    }
  }
  return blocks.join('\n');
}

async function ensureConversation(input: SendChatInput) {
  const conversation = await prisma.chatConversation.upsert({
    where: { id: input.conversationId },
    create: {
      id: input.conversationId,
      organizationId: input.organizationId,
      ownerId: input.userId,
      agentCode: input.agentCode,
      title: input.content.trim().replace(/\s+/g, ' ').slice(0, 20) || '附件对话',
    },
    update: {},
  });

  if (
    conversation.organizationId !== input.organizationId ||
    conversation.ownerId !== input.userId
  ) {
    throw new AppError(404, '会话不存在或无权访问', 'NOT_FOUND');
  }
  return conversation;
}

async function loadConversationContext(conversationId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      status: 'COMPLETED',
      role: { in: ['USER', 'ASSISTANT'] },
    },
    orderBy: { sequence: 'desc' },
    take: CHAT_CONTEXT_MAX_MESSAGES,
    select: { role: true, content: true, modelContext: true },
  });

  return buildRecentConversationContext(
    messages.reverse().map((message) => ({
      role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: message.modelContext || message.content,
    })),
  );
}

async function persistTurn(
  input: SendChatInput,
  modelContext: string,
  assistantContent: string,
) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.chatConversation.update({
      where: { id: input.conversationId },
      data: { nextSequence: { increment: 2 } },
      select: { nextSequence: true },
    });
    const userSequence = conversation.nextSequence - 2;

    const userMessage = await tx.chatMessage.create({
      data: {
        conversationId: input.conversationId,
        authorId: input.userId,
        sequence: userSequence,
        role: 'USER',
        content: input.content.trim() || '（附件消息）',
        modelContext,
        status: 'COMPLETED',
      },
    });
    const assistantMessage = await tx.chatMessage.create({
      data: {
        conversationId: input.conversationId,
        sequence: userSequence + 1,
        role: 'ASSISTANT',
        content: assistantContent,
        status: 'COMPLETED',
      },
    });

    return { userMessageId: userMessage.id, messageId: assistantMessage.id };
  });
}

export const chatService = {
  async sendMessage(input: SendChatInput) {
    if (env.modelProvider === 'mock') {
      throw new AppError(
        503,
        '当前智能分析服务未配置真实模型，请在 backend/.env 设置 MODEL_PROVIDER（openai/deepseek/qwen/moonshot/zhipu/siliconflow/custom）并填写 LLM_API_KEY',
        'CHAT_MODEL_NOT_CONFIGURED',
      );
    }

    const enforceCredits = env.licenseEnforcementEnabled;
    if (enforceCredits) {
      await orgCreditService.ensureAccount(input.organizationId);
      await assertBalanceForBillingMode(input.organizationId, BillingMode.Chat);
    }

    await ensureConversation(input);
    const history = await loadConversationContext(input.conversationId);
    const fileLines = await loadFileSummaries(input.organizationId, input.fileIds);
    const imageContext = await buildImageContext(input.organizationId, input.imageIds);

    const userParts = [
      buildUserPrompt(input),
      fileLines.length ? `附件：\n${fileLines.join('\n')}` : '',
      imageContext ? `图片识别参考：\n${imageContext}` : '',
    ].filter(Boolean);

    const systemPrompt = AGENT_PROMPTS[input.agentCode] ?? AGENT_PROMPTS.general;
    const currentModelContext = userParts.join('\n\n');
    const billingRequestId = randomUUID();

    const result = await modelProviderService.generateReport({
      systemPrompt,
      userPrompt: currentModelContext,
      history,
      model: getActiveLlmModel(),
    });

    let chargedCredits = 0;
    if (enforceCredits) {
      const debit = await consumeAiCreditsByMode({
        organizationId: input.organizationId,
        userId: input.userId,
        requestId: billingRequestId,
        billingMode: BillingMode.Chat,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        descriptionExtra: `conversationId=${input.conversationId}`,
      });
      chargedCredits = debit.finalCost;
    }

    const persisted = await persistTurn(input, currentModelContext, result.content);

    return {
      messageId: persisted.messageId,
      userMessageId: persisted.userMessageId,
      conversationId: input.conversationId,
      content: result.content,
      generatedFiles: [] as Array<{ fileId: string; fileName: string; downloadUrl?: string }>,
      billingRequestId,
      chargedCredits,
    };
  },
};
