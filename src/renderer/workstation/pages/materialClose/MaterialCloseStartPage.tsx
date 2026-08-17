import { useCallback, useEffect, useMemo, useRef } from 'react';
import { dataEngine } from '@aw/data-engine';
import { isExcelUploadExtension } from '@aw/shared';
import {
  detectMany,
  MATERIAL_INPUT_TYPE_LABELS,
  runMaterialDailyCloseWorkflow,
  workbookToWorkflowInput,
  type ClarificationQuestion,
  type MaterialInputType,
  type RawWorkbookInput,
} from '@aw/task-workflows';
import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';
import {
  ensureDefaultEnterpriseRules,
  materialCloseScopeKey,
} from '@workstation/lib/materialDailyCloseLocal';
import {
  ensureMaterialCloseWorkspace,
  getMaterialCloseHistoryStore,
  getMaterialCloseRepository,
  persistMaterialCloseDb,
} from '@workstation/lib/materialCloseLocalDb';
import {
  useMaterialCloseSessionStore,
  type SlotKey,
} from '@workstation/state/materialCloseSessionStore';

const SLOTS: Array<{ key: SlotKey; title: string; hint: string; prefer?: MaterialInputType }> = [
  { key: 'inventory', title: '当前库存表', hint: '期初/实盘', prefer: 'inventory' },
  { key: 'issue', title: '今日领料表', hint: '领料出库', prefer: 'materialIssue' },
  { key: 'return', title: '今日退料表', hint: '退料入库', prefer: 'materialReturn' },
  { key: 'scrap', title: '今日废料/报废表', hint: '报废损耗', prefer: 'scrap' },
];

function downloadHintRules(historyStore: ReturnType<typeof getMaterialCloseHistoryStore>, scopeKey: string): string {
  const rules = historyStore.getEnterpriseRules(scopeKey);
  const mappings = historyStore.listMappings(scopeKey);
  if (!rules && !mappings.length) return '尚未保存企业规则，将使用默认安全库存与损耗阈值';
  const parts: string[] = [];
  if (rules) {
    parts.push(`损耗阈值 ${(rules.scrapRatioThreshold * 100).toFixed(1)}%`);
    parts.push(`默认安全库存 ${rules.defaultSafetyStock}`);
    if (Object.keys(rules.warehouseAlias ?? {}).length) parts.push('已配置仓库别名');
    if (Object.keys(rules.unitConversion ?? {}).length) parts.push('已配置单位换算');
  }
  if (mappings.length) parts.push(`已保存 ${mappings.length} 组字段映射`);
  return `已保存企业规则：${parts.join(' · ')}`;
}

export function MaterialCloseStartPage() {
  const {
    slots,
    workbooks,
    answers,
    clarifications,
    busy,
    error,
    rulesHint,
    setSlot,
    setAnswers,
    setClarifications,
    setResult,
    setActions,
    setDeliverables,
    setStep,
    setBusy,
    setError,
    setRulesHint,
    setRunMeta,
    reset,
  } = useMaterialCloseSessionStore();

  const historyStore = useMemo(() => getMaterialCloseHistoryStore(), []);
  const scopeKey = useMemo(() => materialCloseScopeKey(), []);

  useEffect(() => {
    ensureDefaultEnterpriseRules(historyStore, scopeKey);
    setRulesHint(downloadHintRules(historyStore, scopeKey));
  }, [historyStore, scopeKey, setRulesHint]);

  const onDropFile = useCallback(
    async (slot: SlotKey, file: File | null) => {
      if (!file) {
        setSlot(slot, null);
        return;
      }
      if (!isExcelUploadExtension(file.name)) {
        setError(`不支持的文件：${file.name}`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const buffer = await file.arrayBuffer();
        const workbook = dataEngine.parseFile(buffer, file.name);
        const input = workbookToWorkflowInput(workbook);
        // 自动识别类型（不弹 Sheet/算法选择）
        const detections = detectMany([input], { scopeKey, historyStore });
        const best = detections.sort((a, b) => b.confidence - a.confidence)[0];
        setSlot(slot, input);
        if (best?.inputType) {
          // 仅提示，不阻断
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '文件解析失败');
      } finally {
        setBusy(false);
      }
    },
    [historyStore, scopeKey, setBusy, setError, setSlot],
  );

  const runProcess = useCallback(
    async (books: RawWorkbookInput[], nextAnswers = answers) => {
      if (!books.length) {
        setError('请至少拖入一张业务表');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { workspaceId } = ensureMaterialCloseWorkspace();
        const repo = getMaterialCloseRepository();
        let clientRequestId = useMaterialCloseSessionStore.getState().clientRequestId;
        if (!clientRequestId) {
          clientRequestId = crypto.randomUUID();
          setRunMeta({ runId: null, clientRequestId, creditsCharged: 0 });
        }

        // 同一任务重试不重复扣费：先查本地 run
        const existing = repo.findRunByClientRequestId(workspaceId, clientRequestId);
        if (existing?.status === 'completed' && existing.resultJson) {
          const cached = JSON.parse(existing.resultJson);
          setResult(cached);
          setRunMeta({ runId: existing.id, clientRequestId, creditsCharged: existing.creditsCharged });
          setStep(cached.exceptions?.length ? 'exception' : 'result');
          setBusy(false);
          return;
        }

        ensureDefaultEnterpriseRules(historyStore, scopeKey);
        const result = runMaterialDailyCloseWorkflow({
          workbooks: books,
          answers: nextAnswers,
          scopeKey,
          historyStore,
        });

        setClarifications(result.clarifications);
        setResult(result);
        setActions([]);
        setDeliverables([]);

        const runId = existing?.id ?? `run_${Date.now().toString(36)}`;
        if (!existing) {
          repo.createRun({
            id: runId,
            workspaceId,
            workflowCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
            status: result.blocked ? 'needs_confirm' : result.exceptions.length ? 'needs_confirm' : 'completed',
            summaryJson: JSON.stringify(result.summary),
            sourceFilesJson: JSON.stringify(books.map((b) => b.fileName)),
            resultJson: JSON.stringify(result),
            clientRequestId,
            creditsCharged: 0,
          });
        } else {
          repo.updateRun({
            id: runId,
            status: result.blocked ? 'needs_confirm' : 'completed',
            summaryJson: JSON.stringify(result.summary),
            resultJson: JSON.stringify(result),
          });
        }
        persistMaterialCloseDb();
        setRunMeta({ runId, clientRequestId, creditsCharged: 0 });

        if (result.blocked && result.clarifications.length) {
          // 停留开始页展示极简确认
          return;
        }
        if (result.exceptions.length) {
          setStep('exception');
        } else {
          setStep('result');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '处理失败');
      } finally {
        setBusy(false);
      }
    },
    [
      answers,
      historyStore,
      scopeKey,
      setActions,
      setBusy,
      setClarifications,
      setDeliverables,
      setError,
      setResult,
      setRunMeta,
      setStep,
    ],
  );

  const answerClarification = useCallback(
    (question: ClarificationQuestion, value: string) => {
      const nextAnswers = [
        ...answers.filter((item) => item.questionId !== question.id),
        { questionId: question.id, value },
      ];
      setAnswers(nextAnswers);
      void runProcess(workbooks, nextAnswers);
    },
    [answers, runProcess, setAnswers, workbooks],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">做今日物料日清</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          拖入今日业务表，系统自动识别类型并本地计算。处理中不会让你选择算法、Sheet、清洗模式或模型。
        </p>
        {rulesHint ? (
          <p className="mt-2 rounded-[10px] border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {rulesHint}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SLOTS.map((slot) => (
          <DropZone
            key={slot.key}
            title={slot.title}
            hint={slot.hint}
            fileName={slots[slot.key]?.fileName}
            detected={
              slots[slot.key]
                ? detectMany([slots[slot.key]!], { scopeKey, historyStore })[0]
                : null
            }
            disabled={busy}
            onFile={(file) => void onDropFile(slot.key, file)}
            onClear={() => setSlot(slot.key, null)}
          />
        ))}
      </div>

      {clarifications.length ? (
        <div className="rounded-[14px] border border-border p-4">
          <div className="text-sm font-medium text-foreground">需要确认</div>
          <div className="mt-3 space-y-3">
            {clarifications.map((q) => (
              <div key={q.id} className="rounded-[10px] bg-muted/40 p-3">
                <div className="text-sm text-foreground">
                  {q.kind === 'criticalField' ? '哪一列是物料编码？' : null}
                  {q.kind === 'inputType' ? '这个文件是领料表还是退料表？' : null}
                  {q.kind !== 'criticalField' && q.kind !== 'inputType' ? q.message : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {q.fileName} · {q.message}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(q.options ?? []).map((opt) => (
                    <Button key={opt.value} size="sm" variant="outline" onClick={() => answerClarification(q, opt.value)}>
                      {q.kind === 'inputType'
                        ? (MATERIAL_INPUT_TYPE_LABELS as Record<string, string>)[opt.value] ?? opt.label
                        : opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={busy || !workbooks.length} onClick={() => void runProcess(workbooks)}>
          {busy ? '正在处理…' : '开始处理'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => reset()}>
          清空重来
        </Button>
      </div>
    </div>
  );
}

function DropZone({
  title,
  hint,
  fileName,
  detected,
  disabled,
  onFile,
  onClear,
}: {
  title: string;
  hint: string;
  fileName?: string;
  detected: { inputType: MaterialInputType | null; confidence: number } | null;
  disabled?: boolean;
  onFile: (file: File | null) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cn(
        'flex min-h-[140px] flex-col justify-between rounded-[14px] border border-dashed border-border bg-muted/20 p-4',
        'hover:border-primary/40 hover:bg-muted/40',
        disabled && 'opacity-60',
      )}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0] ?? null;
        onFile(file);
      }}
    >
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {fileName ? (
        <div className="mt-3 space-y-1">
          <div className="truncate text-xs text-foreground">{fileName}</div>
          {detected?.inputType ? (
            <div className="text-[11px] text-muted-foreground">
              识别为 {MATERIAL_INPUT_TYPE_LABELS[detected.inputType]}（
              {Math.round(detected.confidence * 100)}%）
            </div>
          ) : null}
          <button type="button" className="text-[11px] text-primary underline" onClick={onClear}>
            移除
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className="mt-3 text-left text-xs text-muted-foreground"
          onClick={() => inputRef.current?.click()}
        >
          拖入或点击选择 Excel / CSV
        </button>
      )}
    </div>
  );
}
