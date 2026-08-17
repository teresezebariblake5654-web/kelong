/**
 * ChatService implementation routed through Lobster coworkService (OpenClaw).
 * Replaces direct cloud/model HTTP for department workspace chat.
 */

import type {
  ChatMessage,
  Conversation,
  GeneratedFile,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from '@aw/shared';
import {
  clearWorkstationSessionBinding,
  continueWorkstationChat,
  parseDepartmentIdFromAgentId,
  stopWorkstationChat,
} from '@workstation/services/lobsterChatBridge';
import { healthCheck, uploadWorkstationFile, workstationFetch } from '@workstation/services/workstationApi';
import { getUserAccessToken, getActiveOrganizationId } from '@workstation/lib/localStore';
import { exportMessageAsTableViaBackend } from './exportTableViaBackend';
import type { ChatService, ExportTableResult, SendChatMessageContext } from './types';

const conversations = new Map<string, Conversation>();

function departmentFromRequest(request: SendChatMessageRequest): string {
  const fromAgent = parseDepartmentIdFromAgentId(`workstation-${request.agentCode}`);
  // agentCode is ChatAgentCode (hr/finance/...), which maps 1:1 for published depts
  // except administration → admin. Prefer template hint then agentCode.
  if (request.agentCode === 'admin') return 'administration';
  return fromAgent || request.agentCode || 'administration';
}

function emit(
  context: SendChatMessageContext | undefined,
  event: Parameters<NonNullable<SendChatMessageContext['onEvent']>>[0],
) {
  context?.onEvent?.(event);
}

/** Rough token estimate when OpenClaw usage is unavailable (≈4 chars / token). */
function estimateTokens(text: string): number {
  const len = text.trim().length;
  if (!len) return 0;
  return Math.max(1, Math.ceil(len / 4));
}

async function chargeLobsterChatTurn(input: {
  conversationId: string;
  agentCode: string;
  prompt: string;
  content: string;
  clientRequestId?: string;
}): Promise<{ chargedCredits?: number; billingRequestId?: string }> {
  if (!getUserAccessToken() || !getActiveOrganizationId()) {
    return {};
  }
  try {
    const data = await workstationFetch<{
      chargedCredits?: number;
      billingRequestId?: string;
      skipped?: boolean;
    }>('/api/v1/credits/consume-chat-turn', {
      method: 'POST',
      body: JSON.stringify({
        requestId:
          input.clientRequestId ||
          `lobster-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conversationId: input.conversationId,
        agentCode: input.agentCode,
        inputTokens: estimateTokens(input.prompt),
        outputTokens: estimateTokens(input.content),
      }),
      timeoutMs: 12_000,
    });
    if (data?.skipped) return { billingRequestId: data.billingRequestId };
    return {
      chargedCredits: data?.chargedCredits,
      billingRequestId: data?.billingRequestId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Soft-fail only for connectivity; surface insufficient credits to the user.
    if (/积分不足|INSUFFICIENT_CREDITS|402/i.test(message)) {
      throw error instanceof Error ? error : new Error(message);
    }
    console.warn('[lobsterChat] credit debit skipped:', message);
    return {};
  }
}

export const lobsterChatService: ChatService = {
  async listConversations(): Promise<Conversation[]> {
    return Array.from(conversations.values());
  },

  async createConversation(agentCode: Conversation['agentCode']): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: `lobster-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agentCode,
      title: `${agentCode} 对话`,
      createdAt: now,
      updatedAt: now,
    };
    conversations.set(conversation.id, conversation);
    return conversation;
  },

  async getMessages(_conversationId: string): Promise<ChatMessage[]> {
    return [];
  },

  async deleteConversation(conversationId: string): Promise<void> {
    conversations.delete(conversationId);
  },

  async exportMessageAsTable(
    conversationId: string,
    content: string,
  ): Promise<ExportTableResult> {
    return exportMessageAsTableViaBackend(conversationId, content);
  },

  async sendMessage(
    request: SendChatMessageRequest,
    context?: SendChatMessageContext,
  ): Promise<SendChatMessageResponse> {
    const departmentId = departmentFromRequest(request);
    const conversationId = request.conversationId || `dept-${departmentId}`;

    emit(context, {
      type: 'thinking',
      text: '正在通过 Lobster / OpenClaw 处理…',
      done: false,
    });

    let content = '';
    try {
      const result = await continueWorkstationChat({
        departmentId,
        conversationId,
        prompt: request.content,
        handlers: {
          signal: context?.signal,
          onDelta: (text) => {
            content += text;
            emit(context, { type: 'delta', text });
          },
          onDone: (finalContent) => {
            content = finalContent || content;
          },
          onError: (message) => {
            emit(context, { type: 'error', message });
          },
        },
      });
      content = result.content || content;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await stopWorkstationChat();
        throw error;
      }
      const message = error instanceof Error ? error.message : '对话失败';
      emit(context, { type: 'error', message });
      throw error;
    }

    const billing = await chargeLobsterChatTurn({
      conversationId,
      agentCode: request.agentCode,
      prompt: request.content,
      content,
      clientRequestId: request.clientRequestId,
    });

    const messageId = `msg-${Date.now()}`;
    emit(context, {
      type: 'thinking',
      text: '正在通过 Lobster / OpenClaw 处理…',
      done: true,
    });
    emit(context, {
      type: 'done',
      messageId,
      conversationId,
      content,
      generatedFiles: [],
    });

    return {
      messageId,
      conversationId,
      content,
      generatedFiles: [],
      chargedCredits: billing.chargedCredits,
      billingRequestId: billing.billingRequestId,
    };
  },

  async downloadGeneratedFile(file: GeneratedFile): Promise<void> {
    if (!file.fileId) return;
    const health = await healthCheck(2000);
    if (!health.ok) {
      throw new Error(health.message);
    }
    const anchor = document.createElement('a');
    anchor.href = `${health.baseUrl}/api/files/${encodeURIComponent(file.fileId)}/download`;
    anchor.download = file.fileName || file.fileId;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  },
};

/** Prefer Lobster bridge in Electron; keep upload path for deterministic backend tasks. */
export async function uploadChatAttachmentViaBackend(file: File) {
  const health = await healthCheck(2500);
  if (!health.ok) {
    throw new Error(health.message || '工作站后端不可用，无法上传文件');
  }

  try {
    const existing = window.localStorage.getItem('lobsterai.workstation.userAccessToken');
    if (!existing) {
      throw new Error('请先登录工作站账号后再上传文件');
    }
  } catch (error) {
    throw new Error(
      error instanceof Error ? `上传前登录失败：${error.message}` : '上传前登录失败',
    );
  }

  try {
    return await uploadWorkstationFile('/api/files/upload', file);
  } catch (error) {
    try {
      return await uploadWorkstationFile('/api/v1/files/upload', file);
    } catch {
      throw error instanceof Error ? error : new Error('文件上传失败');
    }
  }
}

export function resetLobsterChatDepartment(departmentId: string): void {
  clearWorkstationSessionBinding(departmentId);
}
