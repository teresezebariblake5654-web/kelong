import { FileUp, Trash2, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';
import {
  ALLOWED_UPLOAD_TYPES_MESSAGE,
  formatTemplateFileTypesLabel,
  getTemplateAcceptAttribute,
  isTemplateSupportedFile,
} from '@aw/shared';
import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';

export type TaskComposerFile = {
  fileId?: string;
  fileName: string;
  localFile?: File;
  status: 'ready' | 'uploading' | 'failed';
  errorMessage?: string;
};

type TaskComposerProps = {
  instruction: string;
  onInstructionChange: (value: string) => void;
  files: TaskComposerFile[];
  onPickFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
  disabled?: boolean;
  accept?: string;
  fileTypesHint?: string;
};

const DEFAULT_PLACEHOLDER =
  '请说明你希望智能体重点分析什么，例如：找出异常数据、对比不同部门、生成管理层报告。';

/** 可复用：上传区 + 附加指令 + 提交按钮 */
export function TaskComposer({
  instruction,
  onInstructionChange,
  files,
  onPickFiles,
  onRemoveFile,
  onSubmit,
  submitting,
  submitLabel = '开始分析',
  disabled,
  accept,
  fileTypesHint,
}: TaskComposerProps) {
  const [dragOver, setDragOver] = useState(false);
  const typesLabel = fileTypesHint || formatTemplateFileTypesLabel();
  const acceptAttr = accept || getTemplateAcceptAttribute();
  const hasReadyFile = files.some((item) => item.status === 'ready');
  const uploading = files.some((item) => item.status === 'uploading') || submitting;

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      const next: File[] = [];
      for (const file of Array.from(list)) {
        if (!isTemplateSupportedFile(file.name)) continue;
        next.push(file);
      }
      if (!next.length) return;
      onPickFiles(next);
    },
    [onPickFiles],
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          'rounded-[14px] border border-dashed bg-muted/40 px-6 py-10 text-center transition-colors',
          dragOver ? 'border-primary bg-accent' : 'border-border',
          (disabled || uploading) && 'pointer-events-none opacity-70',
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="mx-auto size-8 text-primary" />
        <div className="mt-3 text-sm font-medium">拖拽文件/图片到此处，或点击选择</div>
        <div className="mt-1 text-xs text-muted-foreground">
          支持 {typesLabel}；可多选，建议单文件不超过 20MB
        </div>
        <div className="mt-4">
          <Button variant="outline" asChild disabled={disabled || uploading}>
            <label className="cursor-pointer">
              <FileUp className="size-4" />
              选择文件
              <input
                type="file"
                accept={acceptAttr}
                multiple
                hidden
                disabled={disabled || uploading}
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">{ALLOWED_UPLOAD_TYPES_MESSAGE}</p>
      </div>

      {files.length ? (
        <div className="flex flex-col gap-2">
          {files.map((item, index) => (
            <div
              key={`${item.fileName}-${index}`}
              className="flex items-center gap-2 rounded-[12px] border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.fileName}</div>
                <div className="text-xs text-muted-foreground">
                  {item.status === 'uploading'
                    ? '上传中…'
                    : item.status === 'failed'
                      ? item.errorMessage || '上传失败'
                      : item.fileId
                        ? '已就绪'
                        : '本地文件已选择'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                disabled={item.status === 'uploading'}
                onClick={() => onRemoveFile(index)}
                aria-label="移除文件"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">附加指令</span>
        <textarea
          value={instruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          rows={4}
          placeholder={DEFAULT_PLACEHOLDER}
          disabled={disabled || uploading}
          className={cn(
            'min-h-[96px] w-full resize-y rounded-[12px] border border-input bg-card px-3 py-2 text-sm',
            'outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
            'placeholder:text-muted-foreground',
          )}
        />
        <span className="text-xs text-muted-foreground">
          可不填：将使用当前模板的默认分析任务。
        </span>
      </label>

      <Button
        className="w-full sm:w-auto"
        disabled={disabled || uploading || !hasReadyFile}
        onClick={onSubmit}
      >
        {submitting ? '提交中…' : submitLabel}
      </Button>
    </div>
  );
}
