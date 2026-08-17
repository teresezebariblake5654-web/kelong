import { useMemo, useState } from 'react';
import {
  applyExceptionActionsAndRecompute,
  exceptionBusinessKey,
  optionsForException,
  toBusinessFacingException,
  type AppliedExceptionAction,
  type ExceptionUserAction,
  type MaterialException,
} from '@aw/task-workflows';
import { Button } from '@workstation/components/ui/button';
import { loadOrDefaultRules } from '@aw/task-workflows';
import {
  ensureMaterialCloseWorkspace,
  getMaterialCloseHistoryStore,
  getMaterialCloseRepository,
  persistMaterialCloseDb,
} from '@workstation/lib/materialCloseLocalDb';
import { materialCloseScopeKey } from '@workstation/lib/materialDailyCloseLocal';
import { useMaterialCloseSessionStore } from '@workstation/state/materialCloseSessionStore';

export function MaterialExceptionPage() {
  const { result, actions, setResult, setActions, setStep, runId } = useMaterialCloseSessionStore();
  const [draftValue, setDraftValue] = useState<Record<string, string>>({});
  const historyStore = useMemo(() => getMaterialCloseHistoryStore(), []);
  const scopeKey = useMemo(() => materialCloseScopeKey(), []);
  const rules = useMemo(() => loadOrDefaultRules(historyStore, scopeKey), [historyStore, scopeKey]);

  const visible = useMemo(() => {
    if (!result) return [];
    return result.exceptions
      .map(toBusinessFacingException)
      .filter((item): item is MaterialException => Boolean(item));
  }, [result]);

  if (!result) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">
        尚无异常数据，请先从开始页处理文件。
        <Button className="mt-4" variant="outline" onClick={() => setStep('start')}>
          返回开始
        </Button>
      </div>
    );
  }

  const applyAction = (exc: MaterialException, action: ExceptionUserAction) => {
    const key = exceptionBusinessKey(exc);
    const value = draftValue[key];
    const nextAction: AppliedExceptionAction = {
      exceptionKey: key,
      code: exc.code,
      materialCode: exc.materialCode,
      materialName: exc.materialName,
      warehouse: exc.warehouse,
      action,
      value: value != null && value !== '' ? (Number.isFinite(Number(value)) ? Number(value) : value) : undefined,
      resolvedAt: new Date().toISOString(),
    };
    const nextActions = [...actions.filter((a) => a.exceptionKey !== key), nextAction];
    const nextResult = applyExceptionActionsAndRecompute({
      result,
      actions: nextActions,
      rules,
    });
    setActions(nextActions);
    setResult(nextResult);

    // 持久化用户确认
    if (runId) {
      const repo = getMaterialCloseRepository();
      const { workspaceId } = ensureMaterialCloseWorkspace();
      repo.replaceExceptions(
        runId,
        workspaceId,
        nextResult.exceptions.map((e) => ({
          runId,
          workspaceId,
          code: e.code,
          severity: e.severity,
          message: e.message,
          materialCode: e.materialCode ?? null,
          materialName: e.materialName ?? null,
          warehouse: e.warehouse ?? null,
          value: e.value ?? null,
          userAction: nextActions.find((a) => a.code === e.code)?.action ?? null,
          userPayloadJson: null,
          resolved: 0,
        })),
      );
      for (const a of nextActions) {
        const rows = repo.listExceptions(runId);
        const row = rows.find(
          (r) =>
            r.code === a.code &&
            (r.materialCode ?? '') === (a.materialCode ?? '') &&
            (r.warehouse ?? '') === (a.warehouse ?? ''),
        );
        if (row) {
          repo.updateExceptionAction({
            id: row.id,
            userAction: a.action,
            userPayloadJson: a.value != null ? JSON.stringify({ value: a.value }) : undefined,
            resolved: true,
          });
        }
      }
      repo.updateRun({
        id: runId,
        resultJson: JSON.stringify(nextResult),
        summaryJson: JSON.stringify(nextResult.summary),
        status: nextResult.exceptions.length ? 'needs_confirm' : 'completed',
      });
      persistMaterialCloseDb();
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">业务异常确认</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          仅展示业务问题。确认后即时重算结存与单据，不修改算法参数。
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[12px] border border-border p-4 text-sm text-muted-foreground">
          当前无待确认异常，可进入结果页下载单据。
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((exc) => {
            const key = exceptionBusinessKey(exc);
            const opts = optionsForException(exc.code);
            const done = actions.some((a) => a.exceptionKey === key);
            return (
              <div key={key} className="rounded-[14px] border border-border p-4">
                <div className="text-sm font-medium text-foreground">{exc.message}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {[exc.materialCode, exc.materialName, exc.warehouse].filter(Boolean).join(' · ')}
                </div>
                {opts.some((o) => o.needsValue) ? (
                  <input
                    className="mt-3 w-full max-w-xs rounded-[8px] border border-border bg-background px-3 py-2 text-sm"
                    placeholder={opts.find((o) => o.needsValue)?.valueHint ?? '输入值'}
                    value={draftValue[key] ?? ''}
                    onChange={(e) => setDraftValue((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {opts.map((opt) => (
                    <Button
                      key={opt.action}
                      size="sm"
                      variant={done ? 'secondary' : 'outline'}
                      onClick={() => applyAction(exc, opt.action)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" onClick={() => setStep('start')}>
          返回上传
        </Button>
        <Button onClick={() => setStep('result')}>查看结果并下载</Button>
      </div>
    </div>
  );
}
