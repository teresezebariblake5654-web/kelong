import { useCallback, useEffect, useState } from 'react';
import { Send, Square, X } from 'lucide-react';import type { ChatAgentCode, ChatAttachment } from '@aw/shared';
import { AgentSelector } from '@workstation/components/chat/AgentSelector';
import { AttachmentCard } from '@workstation/components/chat/AttachmentCard';
import { AttachmentPicker } from '@workstation/components/chat/AttachmentPicker';
import { Button } from '@workstation/components/ui/button';
import { handleComposerPaste } from '@workstation/lib/chatAttachmentPaste';
import { cn } from '@workstation/lib/utils';

type ChatComposerProps = {
  agentCode: ChatAgentCode;
  onAgentChange: (code: ChatAgentCode) => void;
  attachments: ChatAttachment[];
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
  onUploadFiles: (files: File[]) => void;
  onOpenLibrary: () => void;
  onSend: (content: string) => void;
  onStop?: () => void;
  editingMessageId?: string | null;
  editDraft?: string;
  onEditDraftChange?: (draft: string) => void;
  onCancelEdit?: () => void;
  disabled?: boolean;
  sending?: boolean;
};

export function ChatComposer({
  agentCode,
  onAgentChange,
  attachments,
  onAttachmentsChange,
  onUploadFiles,
  onOpenLibrary,
  onSend,
  onStop,
  editingMessageId,
  editDraft,
  onEditDraftChange,
  onCancelEdit,
  disabled,
  sending,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');
  const isEditing = Boolean(editingMessageId);
  const value = isEditing ? (editDraft ?? '') : draft;
  const setValue = isEditing ? onEditDraftChange ?? (() => {}) : setDraft;

  useEffect(() => {
    if (!isEditing) setDraft('');
  }, [isEditing]);

  const removeAttachment = useCallback(
    (index: number) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== index));
    },
    [attachments, onAttachmentsChange],
  );

  const handleSend = useCallback(() => {
    const content = value.trim();
    const hasReadyAttachment = attachments.some((item) => item.status === 'ready');
    const hasUploading = attachments.some((item) => item.status === 'uploading');
    if ((!content && !hasReadyAttachment) || hasUploading || sending || disabled) return;
    onSend(content);
    if (!isEditing) setDraft('');
  }, [attachments, disabled, isEditing, onSend, sending, value]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (sending) return;
      handleSend();
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    handleComposerPaste(event, onUploadFiles);
  };

  return (
    <div className="bg-transparent px-4 pb-6 pt-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <AgentSelector value={agentCode} onChange={onAgentChange} compact />

        {attachments.length ? (
          <div className="flex flex-col gap-2">
            {attachments.map((item, index) => (
              <AttachmentCard
                key={`${item.fileName}-${index}`}
                attachment={item}
                onRemove={item.status !== 'uploading' ? () => removeAttachment(index) : undefined}
                compact
              />
            ))}
          </div>
        ) : null}

        <p className="text-center text-[11px] leading-relaxed text-slate-400">
          AI 智能体也可能会犯错，请核查重要信息。
        </p>

        {isEditing ? (
          <div className="flex items-center justify-between rounded-xl border border-[#D7E4F2] bg-[#EEF4FA] px-3 py-2 text-xs text-[#3A6EA5]">
            <span>正在编辑消息</span>
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-white/80 hover:text-slate-700"
            >
              <X className="size-3.5" />
              取消
            </button>
          </div>
        ) : null}

        <div
          className={cn(
            'flex items-end gap-2 rounded-[26px] border bg-white px-3 py-2 shadow-[0_10px_30px_-18px_rgba(59,130,246,0.35)] focus-within:border-[#A8C7E8] focus-within:shadow-[0_12px_28px_-16px_rgba(59,130,246,0.45)]',
            isEditing ? 'border-[#A8C7E8] bg-[#FAFCFF]' : 'border-[#D7E4F2]',
          )}
        >
          <AttachmentPicker
            onPickFiles={onUploadFiles}
            onOpenLibrary={onOpenLibrary}
            disabled={disabled}
          />
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={
              sending
                ? '生成中，可继续输入下一条…'
                : isEditing
                  ? '编辑消息后发送，将从此处重新对话'
                  : '有问题，尽管问…'
            }
            disabled={disabled}
            className={cn(
              'max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm text-slate-700',
              'outline-none ring-0 ring-offset-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
              'placeholder:text-slate-400',
            )}
          />
          {sending ? (
            <Button
              type="button"
              size="icon"
              className="shrink-0 rounded-full bg-slate-800 text-white hover:bg-slate-700"
              disabled={disabled}
              onClick={() => onStop?.()}
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="shrink-0 rounded-full bg-[#7BA4D4] text-white hover:bg-[#6B94C4]"
              disabled={disabled}
              onClick={handleSend}
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
