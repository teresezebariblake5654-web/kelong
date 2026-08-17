import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, FolderOpen, LayoutGrid, Paperclip, Sparkles, Square, X } from 'lucide-react';
import type { ChatAttachment } from '@aw/shared';
import { getChatAttachmentAcceptAttribute, isChatAttachmentExtension } from '@aw/shared';
import { AttachmentCard } from '@workstation/components/chat/AttachmentCard';
import { handleComposerDrop, handleComposerPaste } from '@workstation/lib/chatAttachmentPaste';
import { cn } from '@workstation/lib/utils';

export type PromptLaunchRequest = {
  text: string;
  /** Bump to re-trigger even with the same text */
  nonce: number;
};

type TaskInputProps = {
  placeholder: string;
  attachments: ChatAttachment[];
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
  onUploadFiles: (files: File[]) => void;
  onOpenLibrary?: () => void;
  onOpenApps?: () => void;
  onSend: (content: string) => void;
  onStop?: () => void;
  editingMessageId?: string | null;
  editDraft?: string;
  onEditDraftChange?: (draft: string) => void;
  onCancelEdit?: () => void;
  onFocus?: () => void;
  disabled?: boolean;
  sending?: boolean;
  accent?: string;
  className?: string;
  /**
   * Prompt click → fill editable draft + open file picker (does NOT auto-send).
   * Free typing + send never forces the file picker.
   */
  promptLaunch?: PromptLaunchRequest | null;
  fileHint?: string;
  onPromptLaunchHandled?: () => void;
  /** Bump to focus the composer (e.g. empty-state “直接提问”) */
  focusNonce?: number;
  /** Bump to open the file picker (e.g. empty-state “上传文件”) */
  openFilePickerNonce?: number;
};

export function TaskInput({
  placeholder,
  attachments,
  onAttachmentsChange,
  onUploadFiles,
  onOpenLibrary,
  onOpenApps,
  onSend,
  onStop,
  editingMessageId,
  editDraft,
  onEditDraftChange,
  onCancelEdit,
  onFocus,
  disabled,
  sending,
  accent = '#6366F1',
  className,
  promptLaunch = null,
  fileHint,
  onPromptLaunchHandled,
  focusNonce = 0,
  openFilePickerNonce = 0,
}: TaskInputProps) {
  const [draft, setDraft] = useState('');
  /** Prompt-guided flow: draft filled, waiting for optional file / send / dismiss */
  const [promptGuided, setPromptGuided] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const lastLaunchNonce = useRef(0);
  const lastFocusNonce = useRef(0);
  const lastPickerNonce = useRef(0);
  const isEditing = Boolean(editingMessageId);
  const value = isEditing ? (editDraft ?? '') : draft;
  const setValue = isEditing ? onEditDraftChange ?? (() => {}) : setDraft;

  useEffect(() => {
    if (!isEditing) setDraft('');
  }, [isEditing]);

  const openFilePicker = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Reset so choosing the same file again still fires change; cancel stays safe.
    el.value = '';
    el.click();
  }, []);

  /** Prompt click → fill editable text + open file picker; never auto-send */
  useEffect(() => {
    if (!promptLaunch || promptLaunch.nonce === lastLaunchNonce.current) return;
    lastLaunchNonce.current = promptLaunch.nonce;

    if (isEditing) {
      onEditDraftChange?.(promptLaunch.text);
    } else {
      setDraft(promptLaunch.text);
    }
    setPromptGuided(true);
    onPromptLaunchHandled?.();

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      // Slight delay so OS dialog opens after draft paints (avoids “stuck” feel).
      window.setTimeout(() => openFilePicker(), 60);
    });
  }, [promptLaunch, isEditing, onEditDraftChange, onPromptLaunchHandled, openFilePicker]);

  useEffect(() => {
    if (!focusNonce || focusNonce === lastFocusNonce.current) return;
    lastFocusNonce.current = focusNonce;
    textareaRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    if (!openFilePickerNonce || openFilePickerNonce === lastPickerNonce.current) return;
    lastPickerNonce.current = openFilePickerNonce;
    openFilePicker();
  }, [openFilePickerNonce, openFilePicker]);

  const dismissPromptGuide = useCallback(() => {
    setPromptGuided(false);
  }, []);

  const cancelPromptFlow = useCallback(() => {
    setPromptGuided(false);
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
    const hasReady = attachments.some((item) => item.status === 'ready');
    const uploading = attachments.some((item) => item.status === 'uploading');
    // Free ask: text alone is enough — never force a file.
    if ((!content && !hasReady) || uploading || sending || disabled) return;

    onSend(content);
    if (!isEditing) setDraft('');
    setPromptGuided(false);
  }, [attachments, disabled, isEditing, onSend, sending, value]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (sending) return;
      handleSend();
    }
  };

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) =>
      isChatAttachmentExtension(file.name),
    );
    // Cancel → files empty: keep editable draft + guided banner, do not trap the UI.
    if (files.length) {
      onUploadFiles(files);
      setPromptGuided(false);
    }
    event.target.value = '';
  };

  return (
    <div className={cn('bg-transparent px-5 pb-5 pt-2', className)}>
      {attachments.length ? (
        <div className="mb-2 flex flex-col gap-2">
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

      {isEditing ? (
        <div className="mb-2 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
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

      {promptGuided && !isEditing ? (
        <div
          className="mx-auto mb-2 flex max-w-[980px] flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs"
          style={{
            borderColor: `${accent}44`,
            background: `${accent}14`,
            color: '#334155',
          }}
        >
          <span className="min-w-0 flex-1 leading-relaxed">
            提示词已填入，可在下方自行修改。
            {fileHint ? ` ${fileHint}` : ' 建议上传文件后再发送；取消选文件也没关系。'}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openFilePicker}
              className="rounded-full px-2.5 py-1 font-medium text-white"
              style={{ background: accent }}
            >
              选择文件
            </button>
            <button
              type="button"
              onClick={dismissPromptGuide}
              className="rounded-full bg-white/80 px-2.5 py-1 font-medium text-slate-600 hover:bg-white"
            >
              不用文件
            </button>
            <button
              type="button"
              onClick={cancelPromptFlow}
              className="inline-flex size-7 items-center justify-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700"
              title="取消提示词"
              aria-label="取消提示词"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'apple-glass-input mx-auto max-w-[980px] rounded-[28px] px-4 py-3 transition-shadow',
          isEditing && 'ring-2 ring-indigo-300/60',
          promptGuided && !isEditing && 'ring-2',
          draggingFiles && 'ring-2 ring-indigo-400/70',
        )}
        style={
          promptGuided && !isEditing && !draggingFiles
            ? { boxShadow: `0 0 0 2px ${accent}33` }
            : draggingFiles
              ? { boxShadow: `0 0 0 2px ${accent}66` }
              : undefined
        }
        onDragEnter={(event) => {
          if (disabled) return;
          if (![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDraggingFiles(true);
        }}
        onDragOver={(event) => {
          if (disabled) return;
          if (![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDraggingFiles(false);
        }}
        onDrop={(event) => {
          if (disabled) return;
          dragDepthRef.current = 0;
          setDraggingFiles(false);
          handleComposerDrop(event, onUploadFiles);
        }}
      >
        <p className="mb-2 select-none text-center text-[12px] font-medium leading-snug text-slate-500 sm:text-[13px]">
          {draggingFiles
            ? '松开鼠标即可上传文件'
            : promptGuided
              ? '可修改上方提示词 · 拖文件到此处或点回形针'
              : '可拖文件到此处 · 截图可粘贴 · 资源管理器复制文件请用拖拽或回形针'}
        </p>
        <div className="flex items-end gap-1.5">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={getChatAttachmentAcceptAttribute()}
            onChange={onFileInputChange}
          />
          <IconBtn title="上传附件（可选）" disabled={disabled} onClick={openFilePicker}>
            <Paperclip className="size-4" />
          </IconBtn>
          {onOpenLibrary ? (
            <IconBtn title="文件库" disabled={disabled} onClick={onOpenLibrary}>
              <FolderOpen className="size-4" />
            </IconBtn>
          ) : null}
          {onOpenApps ? (
            <IconBtn title="应用菜单" disabled={disabled} onClick={onOpenApps}>
              <LayoutGrid className="size-4" />
            </IconBtn>
          ) : null}
          <span className="mb-2" style={{ color: accent }}>
            <Sparkles className="size-4" />
          </span>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            onPaste={(event) => {
              if (disabled) return;
              handleComposerPaste(event, onUploadFiles);
            }}
            rows={2}
            placeholder={
              sending
                ? '生成中，可继续输入下一条…'
                : isEditing
                  ? '编辑消息后发送，将从此处重新对话'
                  : promptGuided
                    ? '提示词可修改，改完再发送…'
                    : placeholder
            }
            disabled={disabled}
            className={cn(
              'max-h-36 min-h-[48px] flex-1 resize-none bg-transparent py-2.5 text-sm text-slate-700',
              'outline-none placeholder:text-slate-400',
            )}
          />

          {sending ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onStop?.()}
              className="mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white shadow-md transition-transform hover:scale-105 disabled:opacity-50"
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={handleSend}
              className="mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105 disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${accent}, #6366F1)` }}
              aria-label="发送"
              title="发送"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="mb-0.5 flex size-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
