import { useNavigate } from 'react-router-dom';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Badge } from '@workstation/components/ui/badge';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { useWorkflow } from '@workstation/state/workflow';

export function AnomaliesPage() {
  const navigate = useNavigate();
  const { state } = useWorkflow();
  const result = state.templateResult;
  const structured = state.structured;

  if (!result) {
    return (
      <div className="mx-auto max-w-6xl">
        <Card>
          <CardHeader>
            <PageHeader title="异常与统计" />
          </CardHeader>
          <CardContent>
            <EmptyState message="请先完成数据清洗。" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const aggregates = Object.entries({
    ...result.statistics.aggregates,
    ...(structured?.aggregates ?? {}),
  });
  const groups = result.statistics.groups;
  const anomalies = result.anomalies;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="异常与统计结果"
            lead="本地规则识别的异常与分组统计。确认无误后创建云端 AI 分析任务。"
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="异常条数" value={String(anomalies.length)} />
            <Metric label="分组数" value={String(groups.length)} />
            <Metric
              label="预计额度"
              value={String(state.estimatedCredits ?? state.task?.estimatedCredits ?? '—')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>关键统计</CardTitle>
        </CardHeader>
        <CardContent>
          {aggregates.length ? (
            <div className="grid grid-cols-2 gap-3">
              {aggregates.slice(0, 12).map(([key, value]) => (
                <div key={key} className="rounded-[12px] border border-border bg-muted/40 p-4">
                  <div className="text-xs text-muted-foreground">{key}</div>
                  <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                    {value === null || value === undefined
                      ? '—'
                      : typeof value === 'number'
                        ? value.toLocaleString('zh-CN')
                        : String(value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="暂无聚合指标。" />
          )}
        </CardContent>
      </Card>

      {groups.length ? (
        <Card>
          <CardHeader>
            <CardTitle>分组结果（前 20）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[320px] overflow-auto rounded-[12px] border border-border">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {Object.keys(groups[0]!).map((key) => (
                      <th
                        key={key}
                        className="sticky top-0 whitespace-nowrap bg-muted/70 px-3 py-2 text-left font-medium"
                      >
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(0, 20).map((group, index) => (
                    <tr key={index}>
                      {Object.keys(groups[0]!).map((key) => (
                        <td
                          key={key}
                          className="whitespace-nowrap border-t border-border px-3 py-2"
                        >
                          {String(group[key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>异常明细（前 50）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!anomalies.length ? (
            <EmptyState message="未发现模板规则异常。" />
          ) : (
            <div className="max-h-[360px] overflow-auto rounded-[12px] border border-border">
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {['严重度', '规则', '字段', '行号', '说明'].map((h) => (
                      <th
                        key={h}
                        className="sticky top-0 whitespace-nowrap bg-muted/70 px-3 py-2 text-left font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {anomalies.slice(0, 50).map((item, index) => (
                    <tr key={`${item.ruleCode}-${item.rowIndex}-${index}`}>
                      <td className="border-t border-border px-3 py-2">
                        <Badge
                          variant={
                            item.severity === 'critical'
                              ? 'danger'
                              : item.severity === 'warning'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {item.severity}
                        </Badge>
                      </td>
                      <td className="border-t border-border px-3 py-2">{item.ruleName}</td>
                      <td className="border-t border-border px-3 py-2">{item.field}</td>
                      <td className="border-t border-border px-3 py-2 font-mono tabular-nums">
                        {item.rowIndex + 1}
                      </td>
                      <td className="border-t border-border px-3 py-2">{item.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button onClick={() => navigate('/progress')}>创建分析任务</Button>
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
