import { useRef } from 'react';
import { FolderOpen, Paperclip } from 'lucide-react';
import { getChatAttachmentAcceptAttribute, isChatAttachmentExtension } from '@aw/shared';
import type { ChatAttachment } from '@aw/shared';
import { Button } from '@workstation/components/ui/button';

type AttachmentPickerProps = {
  onPickFiles: (files: File[]) => void;
  onOpenLibrary: () => void;
  disabled?: boolean;
};

export function AttachmentPicker({ onPickFiles, onOpenLibrary, disabled }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={getChatAttachmentAcceptAttribute()}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).filter((file) =>
            isChatAttachmentExtension(file.name),
          );
          if (files.length) onPickFiles(files);
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        title="上传附件"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        title="选择已有文件"
        onClick={onOpenLibrary}
      >
        <FolderOpen className="size-4" />
      </Button>
    </>
  );
}

export function fileToPendingAttachment(file: File): ChatAttachment {
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    status: 'pending',
  };
}
