import type {
  ChatMessage,
  Conversation,
  GeneratedFile,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from '@aw/shared';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import type {
  ChatService,
  ChatStreamEvent,
  ExportTableResult,
  SendChatMessageContext,
} from './types';
import { exportMessageAsTableViaBackend } from './exportTableViaBackend';

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

async function streamText(text: string, context: SendChatMessageContext | undefined) {
  let index = 0;
  while (index < text.length) {
    if (context?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const size = Math.min(text.length - index, 2 + Math.floor(Math.random() * 5));
    const chunk = text.slice(index, index + size);
    index += size;
    emit(context, { type: 'delta', text: chunk });
    await delay(24 + Math.random() * 16, context?.signal);
  }
}

async function chatRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const localStore = await import('@workstation/lib/localStore');
  const settings = localStore.loadSettings();
  const token = localStore.getUserAccessToken();
  const orgId = localStore.getActiveOrganizationId();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (orgId) headers.set('X-Organization-Id', orgId);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.message || `请求失败：${response.status}`) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return (payload.data ?? payload) as T;
}

async function downloadAuthenticatedFile(path: string, fileName: string) {
  const localStore = await import('@workstation/lib/localStore');
  const settings = localStore.loadSettings();
  const token = localStore.getUserAccessToken();
  const orgId = localStore.getActiveOrganizationId();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (orgId) headers.set('X-Organization-Id', orgId);

  const response = await fetch(`${settings.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `下载失败：${response.status}`);
  }

  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Real API adapter — endpoints are reserved; switch via VITE_CHAT_SERVICE=cloud. */
export const cloudChatService: ChatService = {
  async listConversations(): Promise<Conversation[]> {
    return chatRequest<Conversation[]>('/api/v1/conversations');
  },

  async createConversation(agentCode: Conversation['agentCode']): Promise<Conversation> {
    return chatRequest<Conversation>('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ agentCode }),
    });
  },

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    return chatRequest<ChatMessage[]>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
  },

  async deleteConversation(conversationId: string): Promise<void> {
    await chatRequest<void>(`/api/v1/conversations/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
    });
  },

  async exportMessageAsTable(
    conversationId: string,
    content: string,
  ): Promise<ExportTableResult> {
    return exportMessageAsTableViaBackend(conversationId, content);
  },

  async downloadGeneratedFile(file: GeneratedFile): Promise<void> {
    await downloadAuthenticatedFile(
      `/api/files/${encodeURIComponent(file.fileId)}/download`,
      file.fileName,
    );
  },

  async sendMessage(
    request: SendChatMessageRequest,
    context?: SendChatMessageContext,
  ): Promise<SendChatMessageResponse> {
    const question = request.content.trim() || '（附件消息）';
    let thinking = `1. 理解问题：${question.slice(0, 80)}${question.length > 80 ? '…' : ''}`;
    emit(context, { type: 'thinking', text: thinking, done: false });
    await delay(350, context?.signal);
    thinking += '\n2. 调用云端模型并整理回答结构';
    emit(context, { type: 'thinking', text: thinking, done: false });

    const response = await chatRequest<SendChatMessageResponse>('/api/v1/chat/messages', {
      method: 'POST',
      body: JSON.stringify(request),
      signal: context?.signal,
    });

    thinking += '\n3. 校验回复完整性后开始输出';
    emit(context, { type: 'thinking', text: thinking, done: true });
    await delay(180, context?.signal);

    await streamText(response.content, context);
    emit(context, {
      type: 'done',
      messageId: response.messageId,
      conversationId: response.conversationId,
      content: response.content,
      generatedFiles: response.generatedFiles ?? [],
    });
    return response;
  },
};

/** Upload helper reused by chat attachments (org-scoped). */
export async function uploadChatAttachment(file: File) {
  return getUserCloudClient().uploadFile(file, file.name);
}
