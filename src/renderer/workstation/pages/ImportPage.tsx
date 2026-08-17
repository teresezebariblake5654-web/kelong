import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataEngine } from '@aw/data-engine';
import { isExcelUploadExtension } from '@aw/shared';
import { PageHeader, ErrorState } from '@workstation/components/common';
import {
  TaskComposer,
  type TaskComposerFile,
} from '@workstation/components/templates/TaskComposer';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { getUserAccessToken } from '@workstation/lib/localStore';
import { goToTemplatesCenter } from '@workstation/lib/templateNavigation';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import { useTemplateSessionStore } from '@workstation/state/templateSessionStore';
import { useWorkflow } from '@workstation/state/workflow';

const CLEAR_PIPELINE_PATCH = {
  sheetName: undefined,
  sheet: undefined,
  fieldMappings: undefined,
  templateResult: undefined,
  structured: undefined,
  analysisText: undefined,
  analysisResult: undefined,
  taskId: undefined,
  error: undefined,
  importMode: undefined,
  uploadedFileId: undefined,
  fileIds: undefined,
  conversationId: undefined,
  followUps: undefined,
  workbook: undefined,
} as const;

/** 模板选中后的统一任务页：模板简介 + 上传 + 附加指令 + 开始分析 */
export function ImportPage() {
  const navigate = useNavigate();
  const { state, patch } = useWorkflow();
  const setUploadError = useTemplateSessionStore((s) => s.setUploadError);
  const setCurrentFile = useTemplateSessionStore((s) => s.setCurrentFile);
  const uploadError = useTemplateSessionStore((s) => s.uploadError);

  const [files, setFiles] = useState<TaskComposerFile[]>(() => {
    if (state.fileName && (state.uploadedFileId || state.workbook)) {
      return [
        {
          fileName: state.fileName,
          fileId: state.uploadedFileId,
          status: 'ready' as const,
        },
      ];
    }
    return [];
  });
  const [instruction, setInstruction] = useState(state.userInstruction ?? '');
  const [submitting, setSubmitting] = useState(false);

  const syncDocumentFiles = useCallback(
    (nextFiles: TaskComposerFile[]) => {
      const readyIds = nextFiles
        .filter((item) => item.status === 'ready' && item.fileId)
        .map((item) => item.fileId!);
      const names = nextFiles.map((item) => item.fileName).join('、');
      patch({
        ...CLEAR_PIPELINE_PATCH,
        importMode: 'document',
        fileName: names || undefined,
        uploadedFileId: readyIds[0],
        fileIds: readyIds,
        userInstruction: instruction.trim() || undefined,
        workbook: undefined,
      });
      setCurrentFile(names || null);
    },
    [instruction, patch, setCurrentFile],
  );

  const onPickFiles = useCallback(
    async (picked: File[]) => {
      setUploadError(null);
      for (const file of picked) {
        if (isExcelUploadExtension(file.name)) {
          // Excel：本地解析，进入表格流程
          setFiles((prev) => [
            ...prev.filter((item) => !isExcelUploadExtension(item.fileName)),
            { fileName: file.name, localFile: file, status: 'uploading' },
          ]);
          try {
            const buffer = await file.arrayBuffer();
            const workbook = dataEngine.parseFile(buffer, file.name);
            if (!workbook.sheets.length) throw new Error('未读取到有效工作表');
            setFiles([
              {
                fileName: file.name,
                localFile: file,
                status: 'ready',
              },
            ]);
            setCurrentFile(file.name);
            patch({
              ...CLEAR_PIPELINE_PATCH,
              importMode: 'excel',
              fileName: file.name,
              workbook,
              userInstruction: instruction.trim() || undefined,
              fileIds: undefined,
              uploadedFileId: undefined,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Excel 解析失败';
            setUploadError(message);
            setFiles((prev) =>
              prev.map((item) =>
                item.fileName === file.name
                  ? { ...item, status: 'failed', errorMessage: message }
                  : item,
              ),
            );
          }
          continue;
        }

        // 文档/图片：上传云端
        if (!getUserAccessToken()) {
          setUploadError('请先登录后再上传文档进行分析');
          return;
        }
        const pendingIndexRef = { current: -1 };
        setFiles((prev) => {
          const next = [...prev, { fileName: file.name, localFile: file, status: 'uploading' as const }];
          pendingIndexRef.current = next.length - 1;
          return next;
        });
        try {
          const uploaded = await getUserCloudClient().uploadFile(file, file.name);
          setFiles((prev) => {
            const next = prev.map((item, index) =>
              index === pendingIndexRef.current ||
              (item.fileName === file.name && item.status === 'uploading' && !item.fileId)
                ? {
                    ...item,
                    fileId: uploaded.fileId,
                    status: 'ready' as const,
                  }
                : item,
            );
            const readyIds = next
              .filter((item) => item.status === 'ready' && item.fileId)
              .map((item) => item.fileId!);
            const names = next.map((item) => item.fileName).join('、');
            patch({
              ...CLEAR_PIPELINE_PATCH,
              importMode: 'document',
              fileName: names,
              uploadedFileId: readyIds[0],
              fileIds: readyIds,
              userInstruction: instruction.trim() || undefined,
              workbook: undefined,
            });
            setCurrentFile(names);
            return next;
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : '文件上传失败';
          setUploadError(message);
          setFiles((prev) =>
            prev.map((item) =>
              item.fileName === file.name && item.status === 'uploading'
                ? { ...item, status: 'failed', errorMessage: message }
                : item,
            ),
          );
        }
      }
    },
    [instruction, patch, setCurrentFile, setUploadError],
  );

  const onRemoveFile = useCallback(
    (index: number) => {
      setFiles((prev) => {
        const next = prev.filter((_, i) => i !== index);
        if (!next.length) {
          patch({ ...CLEAR_PIPELINE_PATCH, fileName: undefined, userInstruction: instruction.trim() || undefined });
          setCurrentFile(null);
          return next;
        }
        const excel = next.find((item) => isExcelUploadExtension(item.fileName) && item.status === 'ready');
        if (excel?.localFile && state.workbook) {
          // keep excel mode if workbook still matches
          patch({
            userInstruction: instruction.trim() || undefined,
            fileName: excel.fileName,
          });
        } else {
          syncDocumentFiles(next);
        }
        return next;
      });
    },
    [instruction, patch, setCurrentFile, state.workbook, syncDocumentFiles],
  );

  const onSubmit = useCallback(async () => {
    if (!state.task) return;
    const ready = files.filter((item) => item.status === 'ready');
    if (!ready.length) {
      setUploadError('请先上传文件');
      return;
    }

    setSubmitting(true);
    setUploadError(null);
    try {
      const userInstruction = instruction.trim() || undefined;
      patch({ userInstruction, followUps: [], analysisText: undefined, analysisResult: undefined });

      if (state.importMode === 'excel' && state.workbook) {
        navigate('/sheet');
        return;
      }

      const fileIds = ready.map((item) => item.fileId!).filter(Boolean);
      if (!fileIds.length) {
        throw new Error('文件尚未上传完成');
      }
      const conversationId = `tpl-${state.task.code}-${crypto.randomUUID()}`;
      patch({
        importMode: 'document',
        fileIds,
        uploadedFileId: fileIds[0],
        fileName: ready.map((item) => item.fileName).join('、'),
        userInstruction,
        conversationId,
      });
      navigate('/progress');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '无法开始分析');
    } finally {
      setSubmitting(false);
    }
  }, [files, instruction, navigate, patch, setUploadError, state.importMode, state.task, state.workbook]);

  if (!state.task) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <PageHeader title="任务页面" lead="请先从工作智能体选择一个智能体模板。" />
          </CardHeader>
          <CardContent>
            <Button onClick={() => goToTemplatesCenter(navigate)}>前往工作智能体</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader title={state.task.name} lead={state.task.description} />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-[12px] border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            模板编码：<span className="font-mono text-foreground">{state.task.code}</span>
            {' · '}
            预计额度 {state.task.estimatedCredits}
          </div>

          <TaskComposer
            instruction={instruction}
            onInstructionChange={(value) => {
              setInstruction(value);
              patch({ userInstruction: value.trim() || undefined });
            }}
            files={files}
            onPickFiles={(picked) => void onPickFiles(picked)}
            onRemoveFile={onRemoveFile}
            onSubmit={() => void onSubmit()}
            submitting={submitting}
            submitLabel="开始分析"
          />

          {uploadError ? (
            <ErrorState message={uploadError} onRetry={() => setUploadError(null)} />
          ) : null}

          <div>
            <Button variant="outline" onClick={() => goToTemplatesCenter(navigate)}>
              返回工作智能体
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
