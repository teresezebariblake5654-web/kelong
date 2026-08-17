import { Download, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import type { ChatMessage, GeneratedFile } from '@aw/shared';
import { AttachmentCard } from '@workstation/components/chat/AttachmentCard';
import { MessageCopyButton } from '@workstation/components/chat/MessageCopyButton';
import { MessageEditButton } from '@workstation/components/chat/MessageEditButton';
import { MessageRegenerateButton } from '@workstation/components/chat/MessageRegenerateButton';
import { ReplyGeneratingIndicator } from '@workstation/components/chat/ReplyGeneratingIndicator';
import { renderChatMarkdown } from '@workstation/lib/chatMarkdown';
import { cn } from '@workstation/lib/utils';

type ChatMessageItemProps = {
  message: ChatMessage;
  isLastMessage?: boolean;
  /** 与 AgentWorkspace 一致：整轮 AI 回复进行中（含重新生成） */
  replyInProgress?: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onExportTable?: () => void;
  onDownloadFile?: (file: GeneratedFile) => void;
  editing?: boolean;
  regenerating?: boolean;
  exportingTable?: boolean;
  disableActions?: boolean;
};

export function ChatMessageItem({
  message,
  isLastMessage = false,
  replyInProgress = false,
  onEdit,
  onRegenerate,
  onExportTable,
  onDownloadFile,
  editing,
  regenerating,
  exportingTable,
  disableActions,
}: ChatMessageItemProps) {
  const isUser = message.role === 'user';
  /** 含历史数据里 role 缺失的 AI 回复，与复制按钮判定一致 */
  const isAssistantLike = !isUser && message.role !== 'system';
  const waiting = message.status === 'sending';
  const streaming = message.status === 'streaming';
  const failed = message.status === 'failed';
  const contentText = message.content.trim();

  /** 与岗位智能体 AgentWorkspace 相同的「生成中」判定，避免 status 未更新时操作栏不显示 */
  const isPendingAssistant =
    isAssistantLike && !contentText && replyInProgress && isLastMessage && !regenerating;
  const isStreamingAssistant =
    isAssistantLike && Boolean(contentText) && replyInProgress && isLastMessage && !regenerating;

  const showContent =
    Boolean(message.content) &&
    (streaming ||
      message.status === 'completed' ||
      failed ||
      (isAssistantLike && Boolean(contentText) && !isPendingAssistant && !isStreamingAssistant));

  const showCopy =
    Boolean(contentText) &&
    !failed &&
    (isUser
      ? !waiting && !streaming && !disableActions
      : isAssistantLike && !isPendingAssistant && !isStreamingAssistant);

  const showEdit = Boolean(onEdit) && isUser && !waiting && !streaming && !disableActions;

  const showRegenerate =
    isAssistantLike && !isPendingAssistant && !isStreamingAssistant && Boolean(onRegenerate);

  return (
    <div className={cn('group flex w-full flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'relative w-full max-w-[min(100%,42rem)] text-sm leading-7',
          isUser
            ? 'rounded-[20px] bg-[#DCEBFA] px-4 py-2.5 text-[#1E3A5F] shadow-none'
            : 'rounded-2xl px-1 py-1 text-slate-800',
          failed && 'rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3',
        )}
      >
        {message.attachments.length ? (
          <div className={cn('mb-2 flex flex-col gap-2', isUser && 'opacity-90')}>
            {message.attachments.map((item, index) => (
              <AttachmentCard key={`${item.fileId ?? item.fileName}-${index}`} attachment={item} compact />
            ))}
          </div>
        ) : null}

        {waiting && !message.content ? (
          <ReplyGeneratingIndicator active={waiting} phase="waiting" />
        ) : null}

        {showContent && !failed ? (
          <div className={cn(isUser && 'whitespace-pre-wrap')}>
            {isAssistantLike ? (
              <div className="relative">
                {renderChatMarkdown(message.content)}
                {streaming ? (
                  <div className="mt-2">
                    <ReplyGeneratingIndicator active={streaming} phase="streaming" />
                  </div>
                ) : null}
              </div>
            ) : (
              message.content
            )}
          </div>
        ) : null}

        {failed ? (
          <div className="relative z-10">
            {message.content ? (
              <p className="text-sm leading-relaxed text-destructive">{message.content}</p>
            ) : (
              <p className="text-sm text-destructive">AI 无法生成回复</p>
            )}
          </div>
        ) : null}

        {message.generatedFiles?.length ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-slate-200/80 pt-3">
            <div className="text-xs text-slate-400">生成文件</div>
            {message.generatedFiles.map((file) => (
              <button
                type="button"
                key={file.fileId}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                disabled={!onDownloadFile && !file.downloadUrl}
                onClick={() => {
                  if (onDownloadFile) onDownloadFile(file);
                  else if (file.downloadUrl) window.open(file.downloadUrl, '_blank', 'noopener');
                }}
              >
                <Download className="size-4" />
                {file.fileName}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {showCopy || showEdit || showRegenerate || onExportTable ? (
        <div
          className={cn(
            'mt-1 flex max-w-[min(100%,42rem)] items-center gap-0.5',
            isUser ? 'justify-end' : 'justify-start',
            'opacity-70 transition-opacity group-hover:opacity-100',
            (editing || regenerating) && 'opacity-100',
          )}
        >
          {showCopy ? (
            <MessageCopyButton
              text={message.content}
              className="size-7 text-slate-400 hover:bg-[#EAF2FB] hover:text-[#3A6EA5]"
            />
          ) : null}
          {showEdit ? (
            <MessageEditButton
              onClick={onEdit!}
              disabled={editing || disableActions}
              className="size-7 text-slate-400 hover:bg-[#EAF2FB] hover:text-[#3A6EA5]"
            />
          ) : null}
          {showRegenerate ? (
            <MessageRegenerateButton
              onClick={onRegenerate!}
              spinning={regenerating}
              disabled={Boolean(regenerating) || Boolean(disableActions)}
              className="size-7 text-slate-400 hover:bg-[#EAF2FB] hover:text-[#3A6EA5]"
            />
          ) : null}
          {onExportTable ? (
            <button
              type="button"
              title="将当前回复整理为 Excel"
              aria-label="将当前回复整理为 Excel"
              onClick={onExportTable}
              disabled={exportingTable || disableActions}
              className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#EAF2FB] hover:text-[#3A6EA5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportingTable ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
