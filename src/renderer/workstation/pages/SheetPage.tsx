import { useNavigate } from 'react-router-dom';
import { dataEngine } from '@aw/data-engine';
import { PageHeader, EmptyState } from '@workstation/components/common';
import { Badge } from '@workstation/components/ui/badge';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader } from '@workstation/components/ui/card';
import { cn } from '@workstation/lib/utils';
import { useWorkflow } from '@workstation/state/workflow';

export function SheetPage() {
  const navigate = useNavigate();
  const { state, patch } = useWorkflow();

  if (!state.workbook) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <PageHeader title="选择工作表" />
          </CardHeader>
          <CardContent>
            <EmptyState message="请先导入文件。" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <PageHeader
            title="选择工作表"
            lead={`文件「${state.fileName}」包含 ${state.workbook.sheets.length} 个工作表，请选择要分析的数据表。`}
          />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {state.workbook.sheets.map((sheet) => {
              const selected = state.sheetName === sheet.name;
              return (
                <button
                  key={sheet.name}
                  type="button"
                  className={cn(
                    'rounded-[12px] border p-4 text-left transition-colors',
                    selected
                      ? 'border-primary bg-accent shadow-[inset_0_0_0_1px_hsl(var(--primary))]'
                      : 'border-border bg-card hover:border-primary/30 hover:bg-muted/40',
                  )}
                  onClick={() => {
                    const cleaned = dataEngine.cleanData(sheet, {
                      dropEmptyRows: true,
                      trimStrings: true,
                    });
                    patch({
                      sheetName: cleaned.sheet.name,
                      sheet: cleaned.sheet,
                      fieldMappings: undefined,
                      templateResult: undefined,
                      structured: undefined,
                      analysisText: undefined,
                      analysisResult: undefined,
                      taskId: undefined,
                    });
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm">{sheet.name}</strong>
                    <Badge variant="secondary">
                      {sheet.rows.length} 行 · {sheet.headers.length} 列
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    表头：{sheet.headers.slice(0, 8).join('、')}
                    {sheet.headers.length > 8 ? '…' : ''}
                  </div>
                </button>
              );
            })}
          </div>
          <Button disabled={!state.sheet} onClick={() => navigate('/mapping')}>
            下一步：确认字段映射
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
