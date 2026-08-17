import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { dataEngine } from '@aw/data-engine';
import { isExcelUploadExtension } from '@aw/shared';
import {
  ProductionWorkflowRegistry,
  WorkspaceDatabaseManager,
  buildProductionDeliverables,
  createProductionRepository,
  recomputeWithActions,
  resolveProductionWorkflowCode,
  runProductionWorkflow,
  type AppliedProductionAction,
  type ProductionDeliverable,
  type ProductionWorkflowResult,
  type RawWorkbook,
} from '@aw/task-workflows';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import { Button } from '@workstation/components/ui/button';
import { getActiveOrganizationId } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';

type Step = 'start' | 'exception' | 'result';

function downloadBytes(filename: string, bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 生产办结通用三步页（上传 → 确认 → 下载）
 * 物料日清专用页仍保留；其余五个工作流走此壳，复用 Runtime / 额度入口。
 */
export function ProductionClosePage() {
  const navigate = useNavigate();
  const { taskCode: rawCode } = useParams<{ taskCode: string }>();
  const taskCode = resolveProductionWorkflowCode(rawCode ?? '') ?? rawCode ?? '';
  const def = useMemo(() => (taskCode ? ProductionWorkflowRegistry.get(taskCode) : undefined), [taskCode]);

  const [step, setStep] = useState<Step>('start');
  const [workbooks, setWorkbooks] = useState<RawWorkbook[]>([]);
  const [result, setResult] = useState<ProductionWorkflowResult | null>(null);
  const [actions, setActions] = useState<AppliedProductionAction[]>([]);
  const [deliverables, setDeliverables] = useState<ProductionDeliverable[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    WorkspaceDatabaseManager.initRoundDatabases();
  }, []);

  useEffect(() => {
    setStep('start');
    setWorkbooks([]);
    setResult(null);
    setActions([]);
    setDeliverables([]);
    setError(null);
    setRunId(null);
    setClientRequestId(null);
  }, [taskCode]);

  const onPick = useCallback(async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const parsed: RawWorkbook[] = [];
      for (const file of files) {
        if (!isExcelUploadExtension(file.name)) throw new Error(`不支持：${file.name}`);
        const buffer = await file.arrayBuffer();
        const wb = dataEngine.parseFile(buffer, file.name);
        parsed.push({
          fileName: file.name,
          sheets: wb.sheets.map((s) => ({
            sheetName: s.name,
            headers: s.headers,
            rows: s.rows,
          })),
        });
      }
      setWorkbooks((prev) => [...prev, ...parsed]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, []);

  const run = useCallback(
    (books: RawWorkbook[], nextActions: AppliedProductionAction[] = []) => {
      if (!def) return;
      setBusy(true);
      setError(null);
      try {
        WorkspaceDatabaseManager.initRoundDatabases();
        const repo = createProductionRepository();
        const orgId = getActiveOrganizationId() || 'local-device';
        const ws = repo.ensureWorkspace(orgId);
        let reqId = clientRequestId;
        if (!reqId) {
          reqId = crypto.randomUUID();
          setClientRequestId(reqId);
        }
        const existing = repo.findRunByClientRequestId(ws.id, reqId);
        if (existing?.status === 'completed' && existing.resultJson && !nextActions.length) {
          const cached = JSON.parse(existing.resultJson) as ProductionWorkflowResult;
          setResult(cached);
          setRunId(existing.id);
          setStep(cached.exceptions.length ? 'exception' : 'result');
          return;
        }

        const next = nextActions.length
          ? recomputeWithActions(def.taskCode, result!, nextActions, books)
          : runProductionWorkflow(def.taskCode, { workbooks: books, actions: nextActions });
        setResult(next);
        setActions(nextActions);

        const id = existing?.id ?? `run_${Date.now().toString(36)}`;
        if (!existing) {
          repo.createRun({
            id,
            workspaceId: ws.id,
            taskCode: def.taskCode,
            status: next.exceptions.length ? 'needs_confirm' : 'completed',
            summaryJson: JSON.stringify(next.summary),
            sourceFilesJson: JSON.stringify(books.map((b) => b.fileName)),
            resultJson: JSON.stringify(next),
            clientRequestId: reqId,
            creditsCharged: 0,
          });
        } else {
          repo.updateRun({
            id,
            status: next.exceptions.length ? 'needs_confirm' : 'completed',
            summaryJson: JSON.stringify(next.summary),
            resultJson: JSON.stringify(next),
          });
        }
        repo.persist();
        setRunId(id);

        if (next.blocked) {
          setError(next.clarifications[0]?.message ?? '请补充文件');
          return;
        }
        setStep(next.exceptions.length ? 'exception' : 'result');
      } catch (err) {
        setError(err instanceof Error ? err.message : '处理失败');
      } finally {
        setBusy(false);
      }
    },
    [clientRequestId, def, result],
  );

  if (!def) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <PageBackButton
          onBack={() => navigate('/templates/production')}
          label="返回工作站"
        />
        <p className="mt-4 text-sm text-muted-foreground">未知生产工作流：{rawCode}</p>
      </div>
    );
  }

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <PageBackButton
          onBack={() => navigate('/templates/production')}
          label="返回工作站"
        />
        <div className="mt-2 flex gap-2 text-xs text-muted-foreground">
          <span className={step === 'start' ? 'font-medium text-foreground' : undefined}>上传</span>
          <span>·</span>
          <span className={step === 'exception' ? 'font-medium text-foreground' : undefined}>确认</span>
          <span>·</span>
          <span className={step === 'result' ? 'font-medium text-foreground' : undefined}>下载</span>
        </div>
      </div>

      {step === 'start' ? (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{def.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{def.description}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              数据仅写入本地 production.db，不进入 Sheet 选择 / 完整映射 / 清洗 / 分析配置。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[...def.requiredInputs, ...def.optionalInputs].map((slot) => (
              <div
                key={slot.key}
                className="rounded-[14px] border border-dashed border-border bg-muted/20 p-4 text-sm"
              >
                <div className="font-medium">
                  {slot.label}
                  {slot.required ? '' : '（可选）'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">识别关键词：{slot.hints.join('、')}</div>
              </div>
            ))}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            className="hidden"
            onChange={(e) => void onPick(e.target.files)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex min-h-[120px] w-full flex-col items-center justify-center rounded-[14px] border border-dashed border-border bg-muted/30 px-4 py-8',
              'hover:border-primary/40 hover:bg-muted/50 disabled:opacity-60',
            )}
          >
            <div className="text-sm font-medium">{busy ? '解析中…' : '拖入或点击上传所需 Excel'}</div>
            <div className="mt-1 text-xs text-muted-foreground">可多文件；自动识别类型</div>
          </button>

          {workbooks.length ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {workbooks.map((w) => (
                <span key={w.fileName} className="rounded-full bg-muted px-2 py-1">
                  {w.fileName}
                </span>
              ))}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Button size="lg" disabled={busy || !workbooks.length} onClick={() => run(workbooks)}>
            {busy ? '处理中…' : '开始处理'}
          </Button>
        </div>
      ) : null}

      {step === 'exception' && result ? (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
          <h1 className="text-2xl font-semibold">业务异常确认</h1>
          <p className="text-sm text-muted-foreground">仅展示业务问题；确认后即时重算。</p>
          <div className="space-y-3">
            {result.exceptions.map((exc) => {
              const key = [exc.code, exc.materialCode ?? '', exc.workOrder ?? '', exc.equipment ?? '', exc.message].join(
                '|',
              );
              return (
                <div key={key} className="rounded-[14px] border border-border p-4">
                  <div className="text-sm font-medium">{exc.message}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(
                      [
                        ['confirm', '确认'],
                        ['ignore_once', '忽略本次'],
                        ['mark_manual', '标记人工处理'],
                      ] as const
                    ).map(([action, label]) => (
                      <Button
                        key={action}
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const nextActions: AppliedProductionAction[] = [
                            ...actions.filter((a) => a.exceptionKey !== key),
                            {
                              exceptionKey: key,
                              code: exc.code,
                              action,
                              materialCode: exc.materialCode,
                              workOrder: exc.workOrder,
                              equipment: exc.equipment,
                              resolvedAt: new Date().toISOString(),
                            },
                          ];
                          run(workbooks, nextActions);
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep('start')}>
              返回上传
            </Button>
            <Button onClick={() => setStep('result')}>查看结果并下载</Button>
          </div>
        </div>
      ) : null}

      {step === 'result' && result ? (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
          <h1 className="text-2xl font-semibold">办结结果</h1>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="处理记录" value={result.summary.processedRecordCount ?? 0} />
            <Metric label="自动办结" value={result.summary.autoClosedCount ?? 0} />
            <Metric label="待确认异常" value={result.summary.exceptionCount ?? result.exceptions.length} />
          </div>
          <div className="rounded-[14px] border border-border p-4">
            <div className="text-sm font-medium">下载业务文件</div>
            <div className="mt-3 flex flex-col gap-2">
              {def.deliverables.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="rounded-[10px] border border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  onClick={() => {
                    const files =
                      deliverables.length > 0
                        ? deliverables
                        : buildProductionDeliverables(def.taskCode, result);
                    if (!deliverables.length) {
                      setDeliverables(files);
                      if (runId) {
                        const repo = createProductionRepository();
                        const orgId = getActiveOrganizationId() || 'local-device';
                        const ws = repo.ensureWorkspace(orgId);
                        for (const f of files) {
                          repo.saveDeliverable({
                            runId,
                            workspaceId: ws.id,
                            taskCode: def.taskCode,
                            fileName: f.fileName,
                            fileKind: f.kind,
                            localPath: f.fileName,
                            byteSize: f.bytes.byteLength,
                          });
                        }
                        repo.persist();
                      }
                    }
                    const file = files.find((f) => f.fileName.includes(name));
                    if (file) downloadBytes(file.fileName, file.bytes);
                  }}
                >
                  {name}.xlsx
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                size="lg"
                onClick={() => {
                  const files = buildProductionDeliverables(def.taskCode, result);
                  setDeliverables(files);
                  for (const f of files) downloadBytes(f.fileName, f.bytes);
                }}
              >
                全部下载
              </Button>
              <Button variant="ghost" onClick={() => setStep('exception')}>
                返回确认
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[12px] border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
