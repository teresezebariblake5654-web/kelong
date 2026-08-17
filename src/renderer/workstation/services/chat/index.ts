import { cloudChatService } from './cloudChat.service';
import { lobsterChatService } from './lobsterChat.service';
import { mockChatService } from './mockChat.service';
import type { ChatService } from './types';

export type ChatServiceMode = 'mock' | 'cloud' | 'lobster';

export function getChatServiceMode(): ChatServiceMode {
  const raw = import.meta.env.VITE_CHAT_SERVICE;
  if (raw === 'cloud') return 'cloud';
  if (raw === 'mock') return 'mock';
  // Default in 火星 AI Electron host: route chat through coworkService / OpenClaw.
  if (typeof window !== 'undefined' && window.electron?.cowork) return 'lobster';
  return raw === 'lobster' ? 'lobster' : 'mock';
}

export function getChatService(): ChatService {
  const mode = getChatServiceMode();
  if (mode === 'cloud') return cloudChatService;
  if (mode === 'lobster') return lobsterChatService;
  return mockChatService;
}

export { mockChatService } from './mockChat.service';
export { cloudChatService } from './cloudChat.service';
export { lobsterChatService, uploadChatAttachmentViaBackend } from './lobsterChat.service';
export type { ChatService, ChatStreamEvent, SendChatMessageContext } from './types';

/** Attachment upload: prefer workstation-backend when available, else cloud helper. */
export async function uploadChatAttachment(file: File): Promise<{
  fileId: string;
  originalName: string;
  fileName: string;
  size: number;
  sizeBytes: number;
  extension: string;
  createdAt: string;
}> {
  if (getChatServiceMode() === 'lobster') {
    const { uploadChatAttachmentViaBackend } = await import('./lobsterChat.service');
    const result = (await uploadChatAttachmentViaBackend(file)) as {
      fileId?: string;
      originalName?: string;
      size?: number;
    };
    const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    return {
      fileId: String(result.fileId ?? `local-${Date.now()}`),
      originalName: result.originalName ?? file.name,
      fileName: result.originalName ?? file.name,
      size: result.size ?? file.size,
      sizeBytes: result.size ?? file.size,
      extension,
      createdAt: new Date().toISOString(),
    };
  }
  const { uploadChatAttachment: cloudUpload } = await import('./cloudChat.service');
  const uploaded = await cloudUpload(file);
  return {
    fileId: uploaded.fileId,
    originalName: uploaded.originalName,
    fileName: uploaded.originalName,
    size: uploaded.size,
    sizeBytes: uploaded.size,
    extension: uploaded.extension,
    createdAt: uploaded.createdAt,
  };
}
