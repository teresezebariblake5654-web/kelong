import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataEngine } from '@aw/data-engine';
import { PageHeader, EmptyState, ErrorState } from '@workstation/components/common';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import {
  applyFieldMappings,
  buildInitialMappings,
  buildStructuredFromTemplate,
} from '@workstation/lib/pipeline';
import { useWorkflow } from '@workstation/state/workflow';

export function MappingPage() {
  const navigate = useNavigate();
  const { state, patch } = useWorkflow();
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const autoResult = useMemo(() => {
    if (!state.sheet || !state.task) return null;
    try {
      return dataEngine.executeTemplate({
        templateCode: state.task.code,
        sheet: state.sheet,
        templateVersion: state.task.version,
      });
    } catch {
      return null;
    }
  }, [state.sheet, state.task]);

  useEffect(() => {
    if (state.fieldMappings) {
      setMappings(state.fieldMappings);
      return;
    }
    if (autoResult) {
      setMappings(buildInitialMappings(autoResult));
    }
  }, [autoResult, state.fieldMappings]);

  if (!state.sheet || !state.task) {
    return (
      <div className="mx-auto max-w-5xl">
        <Card>
          <CardHeader>
            <PageHeader title="确认字段映射" />
          </CardHeader>
          <CardContent>
            <EmptyState message="请先选择工作表与任务模板。" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const headers = state.sheet.headers;
  const requiredMissing = state.task.fields.filter(
    (field) => field.required && !mappings[field.key],
  );

  async function confirm() {
    if (!state.sheet || !state.task || !state.fileName) return;
    setRunning(true);
    setError('');
    try {
      const mappedSheet = applyFieldMappings(state.sheet, mappings);
      const templateResult = dataEngine.executeTemplate({
        templateCode: state.task.code,
        sheet: mappedSheet,
        templateVersion: state.task.version,
      });
      const structured = buildStructuredFromTemplate(state.fileName, mappedSheet, templateResult);
      patch({
        fieldMappings: mappings,
        templateResult,
        structured,
        analysisText: undefined,
        analysisResult: undefined,
        taskId: undefined,
      });
      navigate('/clean');
    } catch (err) {
      setError(err instanceof Error ? err.message : '字段映射执行失败');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="确认字段映射"
            lead="系统已按模板别名自动匹配列名，可手动调整。必填字段全部映射后方可继续。"
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {autoResult?.ambiguousColumns.length ? (
            <EmptyState
              message={`有 ${autoResult.ambiguousColumns.length} 个字段存在多个候选列，请人工确认。`}
            />
          ) : null}

          <div className="overflow-x-auto rounded-[12px] border border-border">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-muted/60 text-left">
                  <th className="sticky top-0 px-3 py-2 font-medium">模板字段</th>
                  <th className="sticky top-0 px-3 py-2 font-medium">类型</th>
                  <th className="sticky top-0 px-3 py-2 font-medium">必填</th>
                  <th className="sticky top-0 px-3 py-2 font-medium">匹配源列</th>
                  <th className="sticky top-0 px-3 py-2 font-medium">置信度</th>
                </tr>
              </thead>
              <tbody>
                {state.task.fields.map((field) => {
                  const matched = autoResult?.matchedColumns.find((m) => m.fieldKey === field.key);
                  return (
                    <tr key={field.key} className="border-t border-border">
                      <td className="border-t border-border px-3 py-2">
                        <div className="font-medium">{field.label}</div>
                        <div className="text-xs text-muted-foreground">{field.key}</div>
                      </td>
                      <td className="border-t border-border px-3 py-2">{field.dataType}</td>
                      <td className="border-t border-border px-3 py-2">
                        {field.required ? '是' : '否'}
                      </td>
                      <td className="border-t border-border px-3 py-2">
                        <select
                          className="h-9 w-full min-w-[160px] rounded-[10px] border border-input bg-card px-3 text-sm"
                          value={mappings[field.key] ?? ''}
                          onChange={(e) =>
                            setMappings((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                        >
                          <option value="">未映射</option>
                          {headers.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="border-t border-border px-3 py-2 font-mono tabular-nums">
                        {matched ? `${Math.round(matched.confidence * 100)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {requiredMissing.length ? (
            <EmptyState
              message={`尚有必填字段未映射：${requiredMissing.map((f) => f.label).join('、')}`}
            />
          ) : null}
          {error ? <ErrorState message={error} /> : null}

          <Button disabled={running || requiredMissing.length > 0} onClick={() => void confirm()}>
            {running ? '执行中…' : '确认映射并清洗'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
