export type ChatAgentCode = 'general' | 'data-analysis' | 'finance' | 'sales' | 'admin' | 'hr' | 'production' | 'logistics' | 'ecommerce';
export type ChatMessageRole = 'user' | 'assistant' | 'system';
export type ChatMessageStatus = 'sending' | 'streaming' | 'completed' | 'failed';
export type ChatAttachmentStatus = 'pending' | 'uploading' | 'ready' | 'failed';
export type ConversationVisibility = 'private' | 'organization';
export type ChatAttachment = { fileId?: string; fileName: string; mimeType: string; sizeBytes: number; status: ChatAttachmentStatus; errorMessage?: string };
export type GeneratedFile = { fileId: string; fileName: string; downloadUrl?: string };
export type Conversation = { id: string; title: string; agentCode: ChatAgentCode; visibility?: ConversationVisibility; ownerId?: string; createdAt: string; updatedAt: string };
export type ChatMessage = { id: string; conversationId: string; sequence?: number; role: ChatMessageRole; content: string; attachments: ChatAttachment[]; status: ChatMessageStatus; thinking?: string; generatedFiles?: GeneratedFile[]; clientRequestId?: string; createdAt: string };
export type CreateConversationRequest = { agentCode: ChatAgentCode; title?: string; visibility?: ConversationVisibility };
export type UpdateConversationRequest = { title?: string; visibility?: ConversationVisibility };
export type ImportConversationRequest = { id?: string; title: string; agentCode: ChatAgentCode; visibility?: ConversationVisibility; messages: Array<Pick<ChatMessage, 'role' | 'content'> & Partial<Pick<ChatMessage, 'attachments' | 'status' | 'thinking' | 'generatedFiles' | 'createdAt'>>> };
export type SendChatMessageRequest = { conversationId: string; agentCode: ChatAgentCode; content: string; fileIds: string[]; imageIds: string[]; clientRequestId?: string; templateCode?: string; userInstruction?: string };
export type SendChatMessageResponse = {
  messageId: string;
  userMessageId?: string;
  conversationId: string;
  content: string;
  generatedFiles: GeneratedFile[];
  /** Backend AI debit finalCost (App credits). Omitted when billing disabled. */
  chargedCredits?: number;
  billingRequestId?: string;
};
export const CHAT_ATTACHMENT_EXTENSIONS = ['.xlsx','.xls','.csv','.png','.jpg','.jpeg','.pdf','.doc','.docx','.txt'] as const;
export function getChatAttachmentAcceptAttribute(): string { return CHAT_ATTACHMENT_EXTENSIONS.join(','); }
export function isChatAttachmentExtension(filename: string): boolean { const lower=filename.toLowerCase(); return CHAT_ATTACHMENT_EXTENSIONS.some((ext)=>lower.endsWith(ext)); }
