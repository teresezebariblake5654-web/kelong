import { ImagePlus, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageAnalysisResult } from '@aw/shared';
import { IMAGE_UPLOAD_EXTENSIONS, IMAGE_UPLOAD_TYPES_MESSAGE } from '@aw/shared';
import { PageHeader, ErrorState, EmptyState, LoadingState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import { getUserAccessToken } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';

const ACCEPTED_EXTENSIONS = IMAGE_UPLOAD_EXTENSIONS;
const DEFAULT_INSTRUCTION = '识别并分析图片内容';

type Phase = 'idle' | 'recognizing' | 'done' | 'error';

function isAcceptedImage(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function ImageAnalysisPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImageAnalysisResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const uploadedFileIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const resetAll = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
    setPhase('idle');
    setErrorMessage(null);
    setResult(null);
    uploadedFileIdRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewUrl]);

  const handleFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (!isAcceptedImage(file.name)) {
        setErrorMessage(IMAGE_UPLOAD_TYPES_MESSAGE);
        setPhase('error');
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setPhase('idle');
      setErrorMessage(null);
      setResult(null);
      uploadedFileIdRef.current = null;
    },
    [previewUrl],
  );

  const startRecognition = useCallback(async () => {
    if (!selectedFile) return;
    if (!getUserAccessToken()) {
      setErrorMessage('请先登录后再使用图片智能识别');
      setPhase('error');
      return;
    }
    setPhase('recognizing');
    setErrorMessage(null);
    setResult(null);
    try {
      const client = getUserCloudClient();
      let fileId = uploadedFileIdRef.current;
      if (!fileId) {
        const uploaded = await client.uploadFile(selectedFile, selectedFile.name);
        fileId = uploaded.fileId;
        uploadedFileIdRef.current = fileId;
      }
      const response = await client.analyzeImage({
        fileId,
        instruction: DEFAULT_INSTRUCTION,
      });
      setResult(response.result);
      setPhase('done');
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'IMAGE_ANALYSIS_UNSUPPORTED') {
        setErrorMessage('当前智能分析服务暂不支持图片识别');
      } else if (code === 'UNAUTHORIZED') {
        setErrorMessage('请先登录后再使用图片智能识别');
      } else {
        setErrorMessage('图片识别失败，请重新尝试');
      }
      setPhase('error');
    }
  }, [selectedFile]);

  const recognizing = phase === 'recognizing';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="图片智能识别"
            lead="上传图片后由云端智能分析服务识别内容。支持 png、jpg、jpeg、webp。"
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!selectedFile ? (
            <div
              className={cn(
                'rounded-[14px] border border-dashed bg-muted/40 px-6 py-12 text-center transition-colors',
                dragOver ? 'border-primary bg-accent' : 'border-border',
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
              <ImagePlus className="mx-auto size-8 text-primary" />
              <div className="mt-3 text-sm font-medium">拖拽图片到此处，或点击选择</div>
              <div className="mt-1 text-xs text-muted-foreground">
                支持 png、jpg、jpeg、webp，建议不超过 10MB
              </div>
              <div className="mt-4">
                <Button variant="outline" asChild>
                  <label className="cursor-pointer">
                    选择图片
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={IMAGE_UPLOAD_EXTENSIONS.join(',')}
                      hidden
                      onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="rounded-[12px] border border-border bg-muted/40 p-4">
                <div className="text-xs text-muted-foreground">图片预览</div>
                <div className="mt-2 flex justify-center">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={selectedFile.name}
                      className="max-h-80 max-w-full rounded-[10px] object-contain"
                    />
                  ) : null}
                </div>
                <div className="mt-2 text-center text-sm text-muted-foreground">
                  {selectedFile.name}
                </div>
              </div>

              {recognizing ? (
                <LoadingState message="正在识别图片内容..." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void startRecognition()}>
                    <ScanSearch className="size-4" />
                    {phase === 'done' || phase === 'error' ? '重新识别' : '开始识别'}
                  </Button>
                  <Button variant="outline" onClick={resetAll}>
                    选择下一张图片
                  </Button>
                </div>
              )}

              {phase === 'error' && errorMessage ? (
                <ErrorState message={errorMessage} onRetry={() => void startRecognition()} />
              ) : null}
            </div>
          )}

          {!selectedFile && phase === 'error' && errorMessage ? (
            <ErrorState message={errorMessage} onRetry={() => setPhase('idle')} />
          ) : null}
        </CardContent>
      </Card>

      {phase === 'done' && result ? (
        <Card>
          <CardHeader>
            <PageHeader title="智能分析结果" lead="以下内容由图片智能识别生成。" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <section>
              <div className="text-sm font-semibold">图片内容概述</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {result.summary || '（无概述）'}
              </p>
            </section>
            <section>
              <div className="text-sm font-semibold">识别文字</div>
              {result.extractedText ? (
                <p className="mt-1 whitespace-pre-wrap rounded-[10px] border border-border bg-muted/40 p-3 text-sm">
                  {result.extractedText}
                </p>
              ) : (
                <EmptyState message="图片中未识别到文字。" />
              )}
            </section>
            <section>
              <div className="text-sm font-semibold">详细分析</div>
              {result.details.length ? (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {result.details.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="暂无更多分析要点。" />
              )}
            </section>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void startRecognition()}>重新识别</Button>
              <Button variant="outline" onClick={resetAll}>
                选择下一张图片
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
