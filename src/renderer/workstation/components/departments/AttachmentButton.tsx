import { Paperclip } from 'lucide-react';
import { useRef } from 'react';
import { getChatAttachmentAcceptAttribute, isChatAttachmentExtension } from '@aw/shared';
import { Button } from '@workstation/components/ui/button';

type AttachmentButtonProps = {
  onPickFiles: (files: File[]) => void;
  disabled?: boolean;
  title?: string;
};

/** 轻量附件按钮，供部门工作流等场景复用 */
export function AttachmentButton({
  onPickFiles,
  disabled,
  title = '上传附件',
}: AttachmentButtonProps) {
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
        title={title}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" />
      </Button>
    </>
  );
}
