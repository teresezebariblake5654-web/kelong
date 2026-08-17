import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { useWorkflow } from '@workstation/state/workflow';

const PAGE_SIZE = 50;

export function CleanPage() {
  const navigate = useNavigate();
  const { state } = useWorkflow();
  const [page, setPage] = useState(0);

  const rows = state.templateResult?.cleanedRows ?? [];
  const headers = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]!);
  }, [rows]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const stats = state.templateResult?.statistics;

  if (!state.templateResult) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card>
          <CardHeader>
            <PageHeader title="数据清洗预览" />
          </CardHeader>
          <CardContent>
            <EmptyState message="请先完成字段映射。" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="数据清洗预览"
            lead="展示模板执行后的清洗结果。空值单元格会高亮，仅渲染当前页。"
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Metric label="清洗前行数" value={String(stats?.rowCountBeforeCleaning ?? '—')} />
            <Metric
              label="清洗后行数"
              value={String(stats?.rowCountAfterCleaning ?? rows.length)}
            />
            <Metric label="去重行数" value={String(stats?.duplicateRowsRemoved ?? 0)} />
          </div>

          {state.templateResult.warnings.length ? (
            <EmptyState
              message={`警告 ${state.templateResult.warnings.length} 条：${state.templateResult.warnings
                .slice(0, 3)
                .map((w) => w.message)
                .join('；')}`}
            />
          ) : null}

          <div className="max-h-[420px] overflow-auto rounded-[12px] border border-border">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th
                      key={header}
                      className="sticky top-0 whitespace-nowrap bg-muted/70 px-3 py-2 text-left font-medium"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, index) => (
                  <tr key={`${page}-${index}`}>
                    {headers.map((header) => {
                      const value = row[header];
                      const empty = value === null || value === undefined || String(value) === '';
                      return (
                        <td
                          key={header}
                          className={`whitespace-nowrap border-t border-border px-3 py-2 ${
                            empty ? 'italic text-warning' : ''
                          }`}
                        >
                          {empty ? '空' : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              第 {page + 1} / {totalPages} 页
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                下一页
              </Button>
              <Button onClick={() => navigate('/anomalies')}>下一步：异常与统计</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-muted/40 p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
