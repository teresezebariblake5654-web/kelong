import { useCallback, useState } from 'react';
import { Send } from 'lucide-react';
import type { ChatAttachment } from '@aw/shared';
import { AttachmentCard } from '@workstation/components/chat/AttachmentCard';
import { AttachmentPicker } from '@workstation/components/chat/AttachmentPicker';
import { WorkflowModeSelector } from '@workstation/components/departments/WorkflowModeSelector';
import { Button } from '@workstation/components/ui/button';
import type { WorkflowMode } from '@workstation/data/departmentAgents';
import { handleComposerPaste } from '@workstation/lib/chatAttachmentPaste';
import { cn } from '@workstation/lib/utils';

type DepartmentChatComposerProps = {
  modes: WorkflowMode[];
  modeCode: string;
  onModeChange: (templateCode: string) => void;
  attachments: ChatAttachment[];
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
  onUploadFiles: (files: File[]) => void;
  onOpenLibrary: () => void;
  onSend: (content: string) => void;
  disabled?: boolean;
  sending?: boolean;
};

/** 复用主聊天输入框视觉，右下角为工作模式选择器 */
export function DepartmentChatComposer({
  modes,
  modeCode,
  onModeChange,
  attachments,
  onAttachmentsChange,
  onUploadFiles,
  onOpenLibrary,
  onSend,
  disabled,
  sending,
}: DepartmentChatComposerProps) {
  const [draft, setDraft] = useState('');

  const removeAttachment = useCallback(
    (index: number) => {
      onAttachmentsChange(attachments.filter((_, i) => i !== index));
    },
    [attachments, onAttachmentsChange],
  );

  const handleSend = useCallback(() => {
    const content = draft.trim();
    const hasReadyAttachment = attachments.some((item) => item.status === 'ready');
    const hasUploading = attachments.some((item) => item.status === 'uploading');
    if ((!content && !hasReadyAttachment) || hasUploading || sending || disabled) return;
    onSend(content);
    setDraft('');
  }, [attachments, disabled, draft, onSend, sending]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || sending) return;
    handleComposerPaste(event, onUploadFiles);
  };

  return (
    <div className="bg-background px-4 pb-6 pt-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
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

        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          AI智能体也可能会犯错。请核查重要信息。
        </p>

        <div className="rounded-[22px] border border-border bg-card px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
          <div className="flex items-end gap-2">
            <AttachmentPicker
              onPickFiles={onUploadFiles}
              onOpenLibrary={onOpenLibrary}
              disabled={disabled || sending}
            />
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={1}
              placeholder=""
              disabled={disabled || sending}
              className={cn(
                'max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-sm',
                'outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
                'placeholder:text-muted-foreground',
              )}
            />
            <Button
              type="button"
              size="icon"
              className="shrink-0 rounded-full"
              disabled={disabled || sending}
              onClick={handleSend}
            >
              <Send className="size-4" />
            </Button>
          </div>
          <div className="mt-1 flex justify-end px-1 pb-0.5">
            <WorkflowModeSelector
              modes={modes}
              value={modeCode}
              onChange={onModeChange}
              disabled={disabled || sending}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
