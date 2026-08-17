import type { ProcessingTask } from '@workstation/types';
import { mockBusinessTemplates } from './templates';

const samples = mockBusinessTemplates.slice(0, 6);

export const mockProcessingTasks: ProcessingTask[] = samples.map((tpl, index) => ({
  id: `task_mock_${index + 1}`,
  fileName: ['考勤明细.xlsx', '销售漏斗.csv', '产量日报.xlsx', '物流延误表.xlsx', '客服工单.csv', '采购交期.xlsx'][
    index
  ]!,
  templateId: tpl.id,
  templateName: tpl.name,
  createdAt: new Date(Date.now() - index * 3_600_000 * 5).toISOString(),
  status: index === 1 ? 'running' : index === 4 ? 'failed' : 'completed',
  progress: index === 1 ? 62 : index === 4 ? 40 : 100,
  creditsCharged: index === 1 ? 0 : tpl.creditCost,
}));
