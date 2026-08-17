import { ReportFollowUp } from '@workstation/components/templates/ReportFollowUp';
import { useNavigate } from 'react-router-dom';
import { dataEngine } from '@aw/data-engine';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { goToTemplatesCenter } from '@workstation/lib/templateNavigation';
import { useWorkflow } from '@workstation/state/workflow';

function downloadBlob(filename: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReportPage() {
  const navigate = useNavigate();
  const { state } = useWorkflow();
  const isDocument = state.importMode === 'document';
  const hasResult = isDocument
    ? Boolean(state.analysisText || state.analysisResult)
    : Boolean(state.structured);

  if (!hasResult) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardHeader>
            <PageHeader title="分析报告" lead="当前没有可展示的分析结果。" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <EmptyState message="还没有生成结果。请先完成导入与智能分析。" />
            <div className="flex gap-2">
              <Button onClick={() => goToTemplatesCenter(navigate)}>继续处理下一个</Button>
              <Button variant="outline" onClick={() => navigate('/progress')}>
                重试分析
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isDocument) {
    const analysis =
      typeof state.analysisResult === 'object' && state.analysisResult
        ? (state.analysisResult as Record<string, unknown>)
        : null;

    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Card>
          <CardHeader>
            <PageHeader
              title="文档分析报告"
              lead={`基于「${state.task?.name ?? '当前模板'}」对上传文件进行的智能分析结果。`}
            />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="文件" value={state.fileName || '—'} />
              <Metric label="任务 ID" value={state.taskId || '—'} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>智能分析总结</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="border-l-[3px] border-primary pl-4 text-sm">
              <pre className="m-0 whitespace-pre-wrap font-sans">
                {state.analysisText || '暂无总结'}
              </pre>
            </div>
            {Array.isArray(analysis?.details) ? (
              <div>
                <strong className="text-sm">详细要点</strong>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {(analysis.details as unknown[]).map((item, index) => (
                    <li key={index}>{String(item)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>导出</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const content = [
                  `任务：${state.task?.name || ''}`,
                  `文件：${state.fileName || ''}`,
                  `任务ID：${state.taskId || ''}`,
                  '',
                  '【智能分析总结】',
                  state.analysisText || '',
                ].join('\n');
                downloadBlob('report.txt', content, 'text/plain;charset=utf-8');
              }}
            >
              导出文本
            </Button>
            <Button variant="outline" onClick={() => navigate('/history')}>
              查看任务历史
            </Button>
            <Button onClick={() => goToTemplatesCenter(navigate)}>继续处理下一个</Button>
            <Button variant="outline" onClick={() => goToTemplatesCenter(navigate, { refresh: false })}>
              返回工作智能体
            </Button>
          </CardContent>
        </Card>

        <ReportFollowUp />
      </div>
    );
  }

  const structured = state.structured;
  if (!structured) {
    return null;
  }

  const aggregates = Object.entries({
    ...structured.aggregates,
    ...(state.templateResult?.statistics.aggregates ?? {}),
  });
  const sections = state.task?.reportSections ?? [];
  const analysis =
    typeof state.analysisResult === 'object' && state.analysisResult
      ? (state.analysisResult as Record<string, unknown>)
      : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="结构化报告"
            lead="精确数字来自本地统计；文字总结来自分析服务，分区展示。"
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="数据行数" value={String(structured.meta.rowCount)} />
            <Metric
              label="异常标记"
              value={String(
                state.templateResult?.anomalies.length ?? structured.anomalies.length,
              )}
            />
            <div className="rounded-[12px] border border-border bg-muted/40 p-4">
              <div className="text-xs text-muted-foreground">任务 ID</div>
              <div className="mt-1 truncate text-sm font-medium">{state.taskId || '—'}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>本地分类统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {aggregates.slice(0, 8).map(([key, value]) => (
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
        </CardContent>
      </Card>

      {sections.length ? (
        <Card>
          <CardHeader>
            <CardTitle>报告章节</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {sections.map((section) => (
              <div key={section.code} className="rounded-[12px] border border-border p-4">
                <strong className="text-sm">{section.title}</strong>
                <div className="mt-1 text-xs text-muted-foreground">
                  来源：
                  {section.source === 'ai'
                    ? '智能分析'
                    : section.source === 'local'
                      ? '本地'
                      : '本地 + 智能分析'}
                </div>
                {section.description ? (
                  <div className="mt-2 text-sm">{section.description}</div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>智能分析总结</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="border-l-[3px] border-primary pl-4 text-sm">
            <pre className="m-0 whitespace-pre-wrap font-sans">
              {state.analysisText || '暂无总结'}
            </pre>
          </div>
          {Array.isArray(analysis?.recommendations) ? (
            <div>
              <strong className="text-sm">行动建议</strong>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {(analysis.recommendations as unknown[]).map((item, index) => (
                  <li key={index}>{String(item)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>导出</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              const rows = state.templateResult?.cleanedRows?.length
                ? state.templateResult.cleanedRows
                : structured.previewRows;
              const csv = dataEngine.exportResult(rows, 'csv');
              downloadBlob('report-preview.csv', String(csv), 'text/csv;charset=utf-8');
            }}
          >
            导出 CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const content = [
                `任务：${state.task?.name || ''}`,
                `文件：${state.fileName || ''}`,
                `任务ID：${state.taskId || ''}`,
                '',
                '【本地指标】',
                ...aggregates.map(([k, v]) => `${k}=${v}`),
                '',
                '【智能分析总结】',
                state.analysisText || '',
              ].join('\n');
              downloadBlob('report.txt', content, 'text/plain;charset=utf-8');
            }}
          >
            导出文本
          </Button>
          <Button variant="outline" onClick={() => navigate('/history')}>
            查看任务历史
          </Button>
          <Button onClick={() => goToTemplatesCenter(navigate)}>继续处理下一个</Button>
          <Button variant="outline" onClick={() => goToTemplatesCenter(navigate, { refresh: false })}>
            返回工作智能体
          </Button>
        </CardContent>
      </Card>

      <ReportFollowUp />
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
