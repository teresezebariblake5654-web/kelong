import type { AgentRole } from '@aw/task-templates';
import type { WorkflowStepKey } from '../state/workflowSession';

export type RoleOption = {
  id: AgentRole;
  title: string;
  desc: string;
};

export const ROLE_OPTIONS: RoleOption[] = [
  { id: 'hr', title: '人事', desc: '考勤、编制、薪酬、绩效与招聘' },
  { id: 'marketing', title: '市场', desc: '活动、渠道、投放与转化' },
  { id: 'sales', title: '销售', desc: '业绩、客户、漏斗与回款' },
  { id: 'operations', title: '运营', desc: '活动效果、留存与转化' },
  { id: 'administration', title: '行政', desc: '费用、资产、后勤统计' },
  { id: 'procurement', title: '采购', desc: '供应商、价格、交期分析' },
  { id: 'production', title: '生产', desc: '产量、达成、良率与波动' },
  { id: 'logistics', title: '物流', desc: '延误、承运、在途状态' },
  { id: 'customer-service', title: '客服', desc: '工单、响应、满意度' },
  { id: 'universal', title: '通用', desc: '跨部门通用分析模板' },
];

export type WorkflowStepDef = {
  path: string;
  label: string;
  key: WorkflowStepKey;
};

export const WORKFLOW_STEPS: WorkflowStepDef[] = [
  { path: '/roles', label: '岗位', key: 'role' },
  { path: '/tasks', label: '模板', key: 'task' },
  { path: '/import', label: '任务', key: 'import' },
  { path: '/sheet', label: '工作表', key: 'sheet' },
  { path: '/mapping', label: '字段', key: 'mapping' },
  { path: '/clean', label: '清洗', key: 'clean' },
  { path: '/anomalies', label: '统计', key: 'anomalies' },
  { path: '/progress', label: '分析', key: 'progress' },
  { path: '/report', label: '报告', key: 'report' },
  { path: '/history', label: '历史', key: 'history' },
];

export function roleLabel(role?: AgentRole): string {
  if (!role) return '未选择';
  return ROLE_OPTIONS.find((item) => item.id === role)?.title ?? role;
}
