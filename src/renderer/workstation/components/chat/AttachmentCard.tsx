import { FileIcon, LoaderCircle, X } from 'lucide-react';
import type { ChatAttachment } from '@aw/shared';
import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: ChatAttachment['status']): string {
  switch (status) {
    case 'pending':
      return '待上传';
    case 'uploading':
      return '上传中';
    case 'ready':
      return '已就绪';
    case 'failed':
      return '上传失败';
    default:
      return status;
  }
}

type AttachmentCardProps = {
  attachment: ChatAttachment;
  onRemove?: () => void;
  compact?: boolean;
};

export function AttachmentCard({ attachment, onRemove, compact }: AttachmentCardProps) {
  const failed = attachment.status === 'failed';
  const uploading = attachment.status === 'uploading';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[12px] border bg-card px-3 py-2',
        failed ? 'border-destructive/40' : 'border-border',
        compact && 'px-2.5 py-1.5',
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
        {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <FileIcon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{attachment.fileName}</div>
        <div className="text-xs text-muted-foreground">
          {attachment.mimeType.split('/').pop()} · {formatSize(attachment.sizeBytes)} ·{' '}
          {statusLabel(attachment.status)}
        </div>
        {failed && attachment.errorMessage ? (
          <div className="text-xs text-destructive">{attachment.errorMessage}</div>
        ) : null}
      </div>
      {onRemove ? (
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onRemove}>
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
