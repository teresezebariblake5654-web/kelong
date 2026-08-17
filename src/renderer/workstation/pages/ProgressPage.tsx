import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isImageUploadExtension } from '@aw/shared';
import { PageHeader, ErrorState, LoadingState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { getUserCloudClient } from '@workstation/lib/userCloud';
import {
  buildAnalyzePayload,
  formatAnalysisResult,
  formatDocumentImageResult,
} from '@workstation/lib/pipeline';
import { roleToAgentCode } from '@workstation/lib/roleToAgent';
import { goToTemplatesCenter } from '@workstation/lib/templateNavigation';
import {
  createDepartmentTaskSession,
  saveDepartmentTaskSession,
} from '@workstation/lib/departmentTaskSessions';
import {
  getDepartmentCodeForTemplateCode,
  resolveDepartmentCodeForTask,
} from '@workstation/data/departmentAgents';
import { getActiveOrganizationId, getUserAccessToken, pushHistory } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';
import { getChatService } from '@workstation/services/chat';
import { useTemplateSessionStore } from '@workstation/state/templateSessionStore';
import { useWorkflow } from '@workstation/state/workflow';

type Step = { id: string; label: string; scope: 'local' | 'cloud' };

const EXCEL_STEPS: Step[] = [
  { id: 'pack', label: '打包结构化结果', scope: 'local' },
  { id: 'submit', label: '提交智能分析任务', scope: 'cloud' },
  { id: 'wait', label: '等待分析结果', scope: 'cloud' },
  { id: 'save', label: '保存任务历史', scope: 'local' },
];

const DOCUMENT_STEPS: Step[] = [
  { id: 'ready', label: '文件已上传', scope: 'local' },
  { id: 'submit', label: '提交智能分析任务', scope: 'cloud' },
  { id: 'wait', label: '等待分析结果', scope: 'cloud' },
  { id: 'save', label: '保存任务历史', scope: 'local' },
];

export function ProgressPage() {
  const navigate = useNavigate();
  const { state, patch } = useWorkflow();
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const setAnalysisError = useTemplateSessionStore((s) => s.setAnalysisError);
  const cancelled = useRef(false);
  const clientRequestId = useRef(crypto.randomUUID());
  const isDocument = state.importMode === 'document';
  const steps = isDocument ? DOCUMENT_STEPS : EXCEL_STEPS;
  const snapshot = useRef({
    importMode: state.importMode,
    uploadedFileId: state.uploadedFileId,
    fileIds: state.fileIds,
    userInstruction: state.userInstruction,
    conversationId: state.conversationId,
    structured: state.structured,
    templateResult: state.templateResult,
    task: state.task,
    role: state.role,
    departmentCode: state.departmentCode,
    fileName: state.fileName,
    estimatedCredits: state.estimatedCredits ?? state.task?.estimatedCredits,
  });

  const runAnalyze = useCallback(async () => {
    cancelled.current = false;
    const {
      importMode,
      uploadedFileId,
      fileIds,
      userInstruction,
      conversationId,
      structured,
      templateResult,
      task,
      role,
      departmentCode,
      fileName,
    } = snapshot.current;
    const documentMode = importMode === 'document';
    setError('');
    setRunning(true);
    setActive(0);

    if (!getUserAccessToken()) {
      const message = '请先登录后再进行智能分析';
      setError(message);
      setAnalysisError(message);
      setRunning(false);
      return;
    }
    if (!getActiveOrganizationId()) {
      const message = '缺少当前组织，请重新登录以同步 Organization';
      setError(message);
      setAnalysisError(message);
      setRunning(false);
      return;
    }
    if (!task) {
      const message = '缺少任务模板';
      setError(message);
      setAnalysisError(message);
      setRunning(false);
      return;
    }

    const resolvedFileIds =
      fileIds && fileIds.length > 0
        ? fileIds
        : uploadedFileId
          ? [uploadedFileId]
          : [];

    if (documentMode) {
      if (!resolvedFileIds.length && !userInstruction?.trim()) {
        const message = '缺少已上传的文件或分析说明，请返回重新提交';
        setError(message);
        setAnalysisError(message);
        setRunning(false);
        return;
      }
    } else if (!structured || !templateResult) {
      const message = '缺少结构化结果或任务模板';
      setError(message);
      setAnalysisError(message);
      setRunning(false);
      return;
    }

    const defaultInstruction = resolvedFileIds.length
      ? `请根据「${task.name}」任务（${task.description}）分析我上传的文件「${fileName || ''}」，给出结构化洞察、关键发现与可执行建议。`
      : `请根据「${task.name}」任务（${task.description}）完成分析，给出结构化洞察、关键发现与可执行建议。`;
    const effectiveInstruction = userInstruction?.trim() || defaultInstruction;
    const stableConversationId =
      conversationId || `tpl-${task.code}-${clientRequestId.current}`;

    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (cancelled.current) return;

      setActive(1);
      const client = getUserCloudClient();
      let text: string;
      let taskId: string;
      let analysisResult: unknown;

      if (documentMode) {
        const primaryName = fileName || '';
        if (resolvedFileIds.length === 1 && isImageUploadExtension(primaryName)) {
          const response = await client.analyzeImage({
            fileId: resolvedFileIds[0]!,
            instruction: effectiveInstruction,
          });
          text = formatDocumentImageResult(response.result);
          analysisResult = response.result;
          taskId = `img_${clientRequestId.current}`;
        } else {
          const imageIds = primaryName
            .split('、')
            .flatMap((name, index) =>
              isImageUploadExtension(name) && resolvedFileIds[index]
                ? [resolvedFileIds[index]!]
                : [],
            );
          const response = await getChatService().sendMessage({
            conversationId: stableConversationId,
            agentCode: roleToAgentCode(role || task.role, task),
            content: effectiveInstruction,
            fileIds: resolvedFileIds,
            imageIds,
            templateCode: task.code,
            userInstruction: userInstruction?.trim() || undefined,
          });
          text = response.content;
          analysisResult = { summary: response.content };
          taskId = response.messageId;
        }
      } else {
        const result = await client.analyze({
          taskCode: task.code,
          templateCode: task.code,
          templateVersion: task.version,
          structuredData: buildAnalyzePayload(structured!, templateResult!),
          clientRequestId: clientRequestId.current,
          userInstruction: userInstruction?.trim() || undefined,
        });
        text = formatAnalysisResult(result.result);
        analysisResult = result.result;
        taskId = result.taskId;
      }

      if (cancelled.current) return;

      setActive(2);
      patch({
        analysisText: text,
        analysisResult,
        taskId,
        conversationId: stableConversationId,
        fileIds: resolvedFileIds.length ? resolvedFileIds : state.fileIds,
        error: undefined,
      });

      setActive(3);
      const historyId = taskId || crypto.randomUUID();
      const resolvedDepartmentCode =
        departmentCode ??
        resolveDepartmentCodeForTask(task) ??
        getDepartmentCodeForTemplateCode(task.code) ??
        undefined;

      let savedSessionId: string | undefined;

      if (resolvedDepartmentCode) {
        const session = createDepartmentTaskSession({
          id: historyId,
          departmentCode: resolvedDepartmentCode,
          templateCode: task.code,
          templateVersion: task.version,
          templateName: task.name,
          userInstruction: userInstruction?.trim() || undefined,
          fileName: fileName || undefined,
          fileIds: resolvedFileIds.length ? resolvedFileIds : undefined,
          conversationId: stableConversationId,
          analysisText: text,
          analysisResult,
        });
        saveDepartmentTaskSession(session);
        savedSessionId = session.id;
        pushHistory({
          id: historyId,
          createdAt: new Date().toISOString(),
          role: role || 'universal',
          taskCode: task.code,
          taskName: task.name,
          fileName: fileName || '',
          summary: text.slice(0, 160),
          analysisText: text,
          userInstruction: userInstruction?.trim() || undefined,
          status: 'completed',
          progress: 100,
          departmentCode: resolvedDepartmentCode,
          sessionId: session.id,
        });
      } else {
        pushHistory({
          id: historyId,
          createdAt: new Date().toISOString(),
          role: role || 'universal',
          taskCode: task.code,
          taskName: task.name,
          fileName: fileName || '',
          summary: text.slice(0, 160),
          analysisText: text,
          userInstruction: userInstruction?.trim() || undefined,
          status: 'completed',
          progress: 100,
        });
      }
      setAnalysisError(null);

      if (resolvedDepartmentCode && savedSessionId) {
        navigate(`/templates/${resolvedDepartmentCode}?session=${savedSessionId}`);
      } else {
        navigate('/report');
      }
    } catch (err) {
      if (!cancelled.current) {
        const message = err instanceof Error ? err.message : '分析失败';
        setError(message);
        setAnalysisError(message);
      }
    } finally {
      if (!cancelled.current) setRunning(false);
    }
    // patch/navigate are stable enough for a one-shot analyze run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAnalysisError]);

  useEffect(() => {
    void runAnalyze();
    return () => {
      cancelled.current = true;
    };
  }, [runAnalyze]);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <PageHeader
            title="智能分析进度"
            lead={
              isDocument ? (
                <>
                  文件已上传至云端，正在结合「{snapshot.current.task?.name}」模板进行智能分析。预计消耗{' '}
                  <strong className="font-mono tabular-nums">
                    {snapshot.current.estimatedCredits ?? '—'}
                  </strong>{' '}
                  分析额度。
                </>
              ) : (
                <>
                  本地结果已就绪，正在创建智能分析任务。预计消耗{' '}
                  <strong className="font-mono tabular-nums">
                    {snapshot.current.estimatedCredits ?? '—'}
                  </strong>{' '}
                  分析额度。
                </>
              )
            }
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {running && !error ? <LoadingState message="正在提交并等待分析结果…" /> : null}

          <div className="flex flex-col gap-3">
            {steps.map((step, index) => {
              const status = index < active ? 'done' : index === active ? 'active' : 'idle';
              return (
                <div key={step.id} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-1 size-2.5 shrink-0 rounded-full',
                      status === 'done' && 'bg-success',
                      status === 'active' && 'bg-primary',
                      status === 'idle' && 'bg-border',
                    )}
                  />
                  <div>
                    <div className="text-sm font-medium">{step.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {step.scope === 'local' ? '本地处理' : '分析服务'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error ? (
            <div className="flex flex-col gap-3">
              <ErrorState
                message={error}
                onRetry={() => {
                  clientRequestId.current = crypto.randomUUID();
                  setAnalysisError(null);
                  void runAnalyze();
                }}
              />
              <Button
                variant="outline"
                onClick={() => {
                  cancelled.current = true;
                  goToTemplatesCenter(navigate);
                }}
              >
                取消并返回工作智能体
              </Button>
              {!getUserAccessToken() ? (
                <Button onClick={() => navigate('/login')}>去登录</Button>
              ) : null}
            </div>
          ) : (
            <Button
              variant="destructive"
              onClick={() => {
                cancelled.current = true;
                goToTemplatesCenter(navigate);
              }}
            >
              取消任务
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
