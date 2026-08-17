import type {
  ChatAgentCode,
  ChatAttachment,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from '@aw/shared';
import { getChatAgentLabel } from '@workstation/constants/chatAgents';
import type { ChatService, ChatStreamEvent, SendChatMessageContext } from './types';

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function emit(context: SendChatMessageContext | undefined, event: ChatStreamEvent) {
  context?.onEvent?.(event);
}

function buildThinkingSteps(request: SendChatMessageRequest, attachments: ChatAttachment[]): string[] {
  const question = request.content.trim() || '（用户发送了附件）';
  const steps = [
    `先理解用户问题：${question.slice(0, 80)}${question.length > 80 ? '…' : ''}`,
    '梳理已知条件，并判断需要哪些业务上下文',
  ];
  if (attachments.length) {
    steps.push(`检查附件：${attachments.map((item) => item.fileName).join('、')}`);
  }
  steps.push('组织回答结构：结论 → 依据 → 建议下一步');
  steps.push('检查表述是否清晰、可执行，再开始输出');
  return steps;
}

function buildMockReply(request: SendChatMessageRequest, attachments: ChatAttachment[]): string {
  const agent = getChatAgentLabel(request.agentCode);
  const hasExcel = attachments.some((item) =>
    /\.(xlsx|xls|csv)$/i.test(item.fileName),
  );
  const hasImage = attachments.some((item) => /\.(png|jpg|jpeg)$/i.test(item.fileName));
  const hasDoc = attachments.some((item) =>
    /\.(pdf|doc|docx|txt)$/i.test(item.fileName),
  );

  const lines: string[] = [
    `**AI 助手**（${agent}）已收到您的消息。`,
    '',
    request.content.trim() || '（未附带文字说明）',
    '',
  ];

  if (attachments.length) {
    lines.push('**附件处理状态**', '');
    for (const file of attachments) {
      lines.push(`- \`${file.fileName}\`：已接收，等待后续分析流水线处理`);
    }
    lines.push('');
  }

  if (hasExcel) {
    lines.push(
      '**数据分析预览**',
      '',
      '| 指标 | 结果 |',
      '| --- | --- |',
      '| 数据行数 | 约 1,240 行（模拟） |',
      '| 异常波动 | 近 4 周销售额环比下降 8.6% |',
      '| 建议 | 优先复盘华东区渠道折扣策略 |',
      '',
      '如需完整 Excel 分析，可继续使用左侧「工作智能体」中的表格任务模板。',
    );
  } else if (hasImage) {
    lines.push(
      '**图片识别预览**',
      '',
      '- 已识别图片中的主要文字与版面结构',
      '- 可在「图片智能识别」页面查看更详细的视觉分析结果',
    );
  } else if (hasDoc) {
    lines.push(
      '**文档处理预览**',
      '',
      '- 文档已成功上传至文件库',
      '- 后续可基于文档内容生成摘要、要点提取或行动清单',
    );
  } else if (request.content.trim()) {
    lines.push(
      '**回复摘要**',
      '',
      '- 已理解您的问题，并会结合当前组织上下文给出建议',
      '- 如需处理表格或文件，可直接在输入框上传附件后再次发送',
      '',
      '**建议下一步**',
      '',
      '1. 补充业务背景或约束条件',
      '2. 如需落表分析，可上传 Excel/CSV',
      '3. 也可切换到对应部门「工作智能体」执行标准任务',
    );
  }

  lines.push('', '_此为 Mock 回复，接入真实聊天 API 后将返回实际模型结果。_');
  return lines.join('\n');
}

async function streamText(
  text: string,
  context: SendChatMessageContext | undefined,
  options?: { minChunk?: number; maxChunk?: number; delayMs?: number },
) {
  const minChunk = options?.minChunk ?? 2;
  const maxChunk = options?.maxChunk ?? 6;
  const delayMs = options?.delayMs ?? 28;
  let index = 0;
  while (index < text.length) {
    if (context?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const size = Math.min(
      text.length - index,
      minChunk + Math.floor(Math.random() * (maxChunk - minChunk + 1)),
    );
    const chunk = text.slice(index, index + size);
    index += size;
    emit(context, { type: 'delta', text: chunk });
    await delay(delayMs + Math.random() * 18, context?.signal);
  }
}

/** Local mock implementation — data lives in chatStore; network calls are simulated. */
export const mockChatService: ChatService = {
  async listConversations() {
    return [];
  },

  async createConversation(agentCode: ChatAgentCode) {
    const now = new Date().toISOString();
    return {
      id: `mock-conv-${Date.now()}`,
      title: '新对话',
      agentCode,
      createdAt: now,
      updatedAt: now,
    };
  },

  async getMessages() {
    return [];
  },

  async deleteConversation() {
    return;
  },

  async sendMessage(
    request: SendChatMessageRequest,
    context?: SendChatMessageContext,
  ): Promise<SendChatMessageResponse> {
    const attachments = context?.attachments ?? [];
    const thinkingSteps = buildThinkingSteps(request, attachments);
    let thinkingText = '';

    for (let i = 0; i < thinkingSteps.length; i += 1) {
      const step = thinkingSteps[i]!;
      thinkingText = thinkingText ? `${thinkingText}\n${i + 1}. ${step}` : `1. ${step}`;
      emit(context, { type: 'thinking', text: thinkingText, done: false });
      await delay(380 + Math.random() * 420, context?.signal);
    }
    emit(context, { type: 'thinking', text: thinkingText, done: true });
    await delay(220, context?.signal);

    const content = buildMockReply(request, attachments);
    await streamText(content, context);

    const response: SendChatMessageResponse = {
      messageId: `mock-msg-${Date.now()}`,
      conversationId: request.conversationId,
      content,
      generatedFiles: [],
    };
    emit(context, {
      type: 'done',
      messageId: response.messageId,
      conversationId: response.conversationId,
      content: response.content,
      generatedFiles: response.generatedFiles,
    });
    return response;
  },
};
