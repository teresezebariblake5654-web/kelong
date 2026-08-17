import type {
  ChatMessage,
  Conversation,
  GeneratedFile,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from '@aw/shared';

export type SendChatMessageContext = {
  attachments?: import('@aw/shared').ChatAttachment[];
  signal?: AbortSignal;
  onEvent?: (event: ChatStreamEvent) => void;
};

export type ChatStreamEvent =
  | { type: 'thinking'; text: string; done?: boolean }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      messageId: string;
      conversationId: string;
      content: string;
      generatedFiles: GeneratedFile[];
    }
  | { type: 'error'; message: string; code?: string; status?: number };

export type ExportTableResult = {
  fileName: string;
  saved: boolean;
};

export interface ChatService {
  listConversations(): Promise<Conversation[]>;
  createConversation(agentCode: Conversation['agentCode']): Promise<Conversation>;
  getMessages(conversationId: string): Promise<ChatMessage[]>;
  deleteConversation(conversationId: string): Promise<void>;
  sendMessage(
    request: SendChatMessageRequest,
    context?: SendChatMessageContext,
  ): Promise<SendChatMessageResponse>;
  exportMessageAsTable?(
    conversationId: string,
    content: string,
  ): Promise<ExportTableResult>;
  downloadGeneratedFile?(file: GeneratedFile): Promise<void>;
}
