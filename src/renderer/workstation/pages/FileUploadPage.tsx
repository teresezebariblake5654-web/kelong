import { FileUp } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import {
  ALLOWED_UPLOAD_TYPES_MESSAGE,
  getUploadAcceptAttribute,
  isAllowedUploadExtension,
} from '@aw/shared';
import { PageHeader, ErrorState, EmptyState, LoadingState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { getUserAccessToken } from '@workstation/lib/localStore';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import { cn } from '@workstation/lib/utils';

type UploadedFileInfo = {
  fileId: string;
  originalName: string;
  size: number;
  extension: string;
  createdAt: string;
};

export function FileUploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFileInfo | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetSelection = useCallback(() => {
    setSelectedFile(null);
    setErrorMessage(null);
    setUploaded(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!isAllowedUploadExtension(file.name)) {
      setErrorMessage(ALLOWED_UPLOAD_TYPES_MESSAGE);
      setSelectedFile(null);
      setUploaded(null);
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
    setUploaded(null);
  }, []);

  const uploadFile = useCallback(async () => {
    if (!selectedFile) return;
    if (!getUserAccessToken()) {
      setErrorMessage('请先登录后再上传文件');
      return;
    }
    setUploading(true);
    setErrorMessage(null);
    try {
      const result = await getUserCloudClient().uploadFile(selectedFile, selectedFile.name);
      setUploaded(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '文件上传失败，请重试';
      setErrorMessage(message);
    } finally {
      setUploading(false);
    }
  }, [selectedFile]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="文件上传"
            lead={`支持 ${ALLOWED_UPLOAD_TYPES_MESSAGE.replace('仅支持 ', '').replace(' 文件', '')}，文件将上传到云端并按组织隔离存储。`}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            className={cn(
              'rounded-[14px] border border-dashed bg-muted/40 px-6 py-12 text-center transition-colors',
              dragOver ? 'border-primary bg-accent' : 'border-border',
              uploading && 'pointer-events-none opacity-70',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <FileUp className="mx-auto size-8 text-primary" />
            <div className="mt-3 text-sm font-medium">拖拽文件到此处，或点击选择</div>
            <div className="mt-1 text-xs text-muted-foreground">
              pdf、word、excel、图片、txt、ppt、rtf · 建议单文件不超过 20MB
            </div>
            <div className="mt-4">
              <Button variant="outline" asChild disabled={uploading}>
                <label className="cursor-pointer">
                  选择文件
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={getUploadAcceptAttribute()}
                    hidden
                    disabled={uploading}
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </Button>
            </div>
          </div>

          {uploading ? <LoadingState message="正在上传文件..." /> : null}

          {selectedFile && !uploading ? (
            <div className="rounded-[12px] border border-border bg-muted/40 p-4">
              <div className="text-xs text-muted-foreground">待上传文件</div>
              <div className="mt-1 text-base font-semibold">{selectedFile.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void uploadFile()}>上传到云端</Button>
                <Button variant="outline" onClick={resetSelection}>
                  重新选择
                </Button>
              </div>
            </div>
          ) : null}

          {errorMessage ? <ErrorState message={errorMessage} onRetry={resetSelection} /> : null}

          {uploaded ? (
            <div className="rounded-[12px] border border-border bg-muted/40 p-4">
              <div className="text-sm font-semibold">上传成功</div>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <div>文件名：{uploaded.originalName}</div>
                <div>文件 ID：{uploaded.fileId}</div>
                <div>类型：{uploaded.extension}</div>
                <div>大小：{(uploaded.size / 1024).toFixed(1)} KB</div>
              </div>
              <div className="mt-3">
                <Button variant="outline" onClick={resetSelection}>
                  继续上传其他文件
                </Button>
              </div>
            </div>
          ) : null}

          {!selectedFile && !errorMessage && !uploaded ? (
            <EmptyState message="选择文件后点击「上传到云端」，文件将通过后端安全存储。" />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
