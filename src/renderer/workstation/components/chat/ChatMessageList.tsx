import type { RefObject } from 'react';
import type { ChatMessage, GeneratedFile } from '@aw/shared';
import { ChatMessageItem } from '@workstation/components/chat/ChatMessageItem';
import { WelcomePanel } from '@workstation/components/chat/WelcomePanel';
import { pickRegenerateAssistantId } from '@workstation/lib/pickRegenerateAssistantId';

type ChatMessageListProps = {
  messages: ChatMessage[];
  onQuickPrompt: (text: string) => void;
  bottomRef?: RefObject<HTMLDivElement> | RefObject<HTMLDivElement | null>;
  editingMessageId?: string | null;
  regeneratingMessageId?: string | null;
  onEditMessage?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onExportTable?: (messageId: string) => void;
  onDownloadFile?: (file: GeneratedFile) => void;
  exportingMessageId?: string | null;
  disableActions?: boolean;
};

/** 仅渲染对话内容；滚动由外层消息区容器负责，输入框与侧栏不跟着滚 */
export function ChatMessageList({
  messages,
  onQuickPrompt,
  bottomRef,
  editingMessageId,
  regeneratingMessageId,
  onEditMessage,
  onRegenerate,
  onExportTable,
  onDownloadFile,
  exportingMessageId,
  disableActions,
}: ChatMessageListProps) {
  const regenerateAssistantId = pickRegenerateAssistantId(messages);

  if (!messages.length) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <WelcomePanel onQuickPrompt={onQuickPrompt} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8">
      {messages.map((message, index) => (
        <ChatMessageItem
          key={message.id}
          message={message}
          isLastMessage={index === messages.length - 1}
          replyInProgress={Boolean(disableActions)}
          onEdit={
            onEditMessage && message.role === 'user'
              ? () => onEditMessage(message.id)
              : undefined
          }
          onRegenerate={
            onRegenerate &&
            message.role !== 'user' &&
            message.role !== 'system' &&
            message.id === regenerateAssistantId
              ? () => onRegenerate(message.id)
              : undefined
          }
          editing={editingMessageId === message.id}
          regenerating={regeneratingMessageId === message.id}
          onExportTable={
            onExportTable &&
            message.role !== 'user' &&
            message.role !== 'system' &&
            message.status === 'completed' &&
            Boolean(message.content.trim())
              ? () => onExportTable(message.id)
              : undefined
          }
          onDownloadFile={onDownloadFile}
          exportingTable={exportingMessageId === message.id}
          disableActions={disableActions}
        />
      ))}
      <div ref={bottomRef as RefObject<HTMLDivElement>} aria-hidden />
    </div>
  );
}
