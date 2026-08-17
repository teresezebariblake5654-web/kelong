import { useMemo } from 'react';
import { buildFiveDeliverables, loadOrDefaultRules } from '@aw/task-workflows';
import { Button } from '@workstation/components/ui/button';
import { getMaterialCloseHistoryStore, getMaterialCloseRepository, persistMaterialCloseDb } from '@workstation/lib/materialCloseLocalDb';
import { materialCloseScopeKey } from '@workstation/lib/materialDailyCloseLocal';
import { pushHistory } from '@workstation/lib/localStore';
import { useMaterialCloseSessionStore } from '@workstation/state/materialCloseSessionStore';

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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[12px] border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export function MaterialCloseResultPage() {
  const { result, actions, deliverables, setDeliverables, setStep, runId, workbooks, creditsCharged } =
    useMaterialCloseSessionStore();
  const historyStore = useMemo(() => getMaterialCloseHistoryStore(), []);
  const scopeKey = useMemo(() => materialCloseScopeKey(), []);
  const rules = useMemo(() => loadOrDefaultRules(historyStore, scopeKey), [historyStore, scopeKey]);

  const files = useMemo(() => {
    if (!result || result.blocked) return deliverables;
    if (deliverables.length) return deliverables;
    const built = buildFiveDeliverables({ result: { ...result, appliedActions: actions }, rules });
    return built;
  }, [actions, deliverables, result, rules]);

  if (!result || result.blocked) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">
        尚无可下载结果。
        <Button className="mt-4" variant="outline" onClick={() => setStep('start')}>
          返回开始
        </Button>
      </div>
    );
  }

  const s = result.summary;
  const ensureFiles = () => {
    const built = buildFiveDeliverables({ result: { ...result, appliedActions: actions }, rules });
    setDeliverables(built);
    if (runId) {
      const repo = getMaterialCloseRepository();
      const run = repo.getRun(runId);
      for (const file of built) {
        repo.saveDeliverable({
          runId,
          workspaceId: run?.workspaceId ?? '',
          fileName: file.fileName,
          fileKind: file.kind,
          localPath: file.fileName,
          byteSize: file.bytes.byteLength,
        });
      }
      repo.updateRun({
        id: runId,
        status: 'completed',
        summaryJson: JSON.stringify({
          ...s,
          deliverableCount: built.length,
        }),
      });
      persistMaterialCloseDb();
    }
    pushHistory({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      role: 'production',
      taskCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
      taskName: '物料日清',
      fileName: workbooks.map((w) => w.fileName).join('、'),
      summary: `处理 ${s.processedRecordCount ?? s.balanceRows} / 自动办结 ${s.autoClosedCount ?? 0} / 人工 ${s.manualConfirmCount ?? 0}`,
      status: 'completed',
      departmentCode: 'production',
    });
    return built;
  };

  const downloadOne = (fileName: string) => {
    const list = files.length ? files : ensureFiles();
    const stem = fileName.replace('.xlsx', '').replace(/_\d+$/, '');
    const match =
      list.find((f) => f.fileName.includes(stem)) ??
      list.find((f) => f.fileName.startsWith(fileName.split('_')[0]!));
    if (match) downloadBytes(match.fileName, match.bytes);
  };

  const downloadAll = () => {
    const list = ensureFiles();
    for (const file of list) downloadBytes(file.fileName, file.bytes);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">日清结果</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          直接下载可交给仓库 / 采购 / 主管的 Excel。AI 摘要不是主交付。
        </p>
        {creditsCharged > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            本次消耗：{creditsCharged} AI 积分
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="处理记录总数" value={s.processedRecordCount ?? s.balanceRows} />
        <Metric label="自动办结数量" value={s.autoClosedCount ?? Math.max(0, s.balanceRows - result.exceptions.length)} />
        <Metric label="人工确认数量" value={s.manualConfirmCount ?? actions.length} />
        <Metric label="负库存数量" value={s.negativeInventoryCount ?? 0} />
        <Metric label="缺料数量" value={s.shortageCount ?? 0} />
        <Metric label="异常损耗数量" value={s.excessiveScrapCount ?? 0} />
      </div>

      <div className="rounded-[14px] border border-border p-4">
        <div className="text-sm font-medium text-foreground">下载单据</div>
        <div className="mt-3 flex flex-col gap-2">
          {[
            '今日物料结存.xlsx',
            '补料申请单.xlsx',
            '报废待审批单.xlsx',
            '盘点差异单.xlsx',
            '人工确认清单.xlsx',
          ].map((name) => (
            <button
              key={name}
              type="button"
              className="rounded-[10px] border border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
              onClick={() => {
                ensureFiles();
                const list = useMaterialCloseSessionStore.getState().deliverables;
                const stem = name.replace('.xlsx', '');
                const file = list.find((f) => f.fileName.includes(stem));
                if (file) downloadBytes(file.fileName, file.bytes);
                else downloadOne(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button size="lg" onClick={downloadAll}>
            全部下载
          </Button>
          <Button variant="ghost" onClick={() => setStep('exception')}>
            返回异常确认
          </Button>
          <Button variant="ghost" onClick={() => setStep('start')}>
            新的一日清
          </Button>
        </div>
      </div>
    </div>
  );
}
