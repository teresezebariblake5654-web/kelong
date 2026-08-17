import type { AgentRole, LocalTaskTemplate } from '@aw/task-templates';
import { LOCAL_TASK_TEMPLATES } from '@aw/task-templates';
import { formatTemplateFileTypesLabel } from '@aw/shared';

export type DepartmentId =
  | AgentRole
  | 'finance';

export type DepartmentDef = {
  id: DepartmentId;
  title: string;
  /** Soft accent token for subtle department distinction */
  accent: string;
  match: (template: LocalTaskTemplate) => boolean;
};

export const DEPARTMENT_CATALOG: DepartmentDef[] = [
  { id: 'hr', title: '人力资源', accent: 'hsl(243 40% 52%)', match: (t) => t.role === 'hr' },
  {
    id: 'marketing',
    title: '市场/品牌',
    accent: 'hsl(280 35% 48%)',
    match: (t) => t.role === 'marketing',
  },
  { id: 'sales', title: '销售', accent: 'hsl(200 45% 42%)', match: (t) => t.role === 'sales' },
  {
    id: 'operations',
    title: '运营',
    accent: 'hsl(170 40% 38%)',
    match: (t) => t.role === 'operations',
  },
  {
    id: 'administration',
    title: '行政',
    accent: 'hsl(220 20% 45%)',
    match: (t) => t.role === 'administration',
  },
  {
    id: 'procurement',
    title: '采购',
    accent: 'hsl(25 45% 45%)',
    match: (t) => t.role === 'procurement',
  },
  {
    id: 'production',
    title: '生产',
    accent: 'hsl(145 35% 38%)',
    match: (t) => t.role === 'production',
  },
  {
    id: 'logistics',
    title: '物流',
    accent: 'hsl(210 40% 44%)',
    match: (t) => t.role === 'logistics',
  },
  {
    id: 'finance',
    title: '财务',
    accent: 'hsl(40 50% 42%)',
    match: (t) =>
      /财务|费用|报销|预算|账|发票|成本/.test(`${t.name}${t.description}${t.code}`),
  },
  {
    id: 'customer-service',
    title: '客服',
    accent: 'hsl(330 35% 48%)',
    match: (t) => t.role === 'customer-service',
  },
];

export function departmentOf(template: LocalTaskTemplate): DepartmentDef {
  return (
    DEPARTMENT_CATALOG.find((d) => d.id !== 'finance' && d.match(template)) ??
    DEPARTMENT_CATALOG.find((d) => d.id === 'finance' && d.match(template)) ??
    DEPARTMENT_CATALOG.find((d) => d.id === template.role) ??
    DEPARTMENT_CATALOG[0]!
  );
}

export function departmentTitle(id: DepartmentId): string {
  return DEPARTMENT_CATALOG.find((d) => d.id === id)?.title ?? String(id);
}

export function templatesByDepartment(id: DepartmentId | 'all'): LocalTaskTemplate[] {
  const list = LOCAL_TASK_TEMPLATES.filter((t) => t.enabled);
  if (id === 'all') return list;
  return list.filter((t) => DEPARTMENT_CATALOG.find((d) => d.id === id)?.match(t));
}

export function departmentCounts(): Record<DepartmentId, number> {
  const counts = {} as Record<DepartmentId, number>;
  for (const dept of DEPARTMENT_CATALOG) {
    counts[dept.id] = LOCAL_TASK_TEMPLATES.filter((t) => t.enabled && dept.match(t)).length;
  }
  return counts;
}

export function inferDataTypes(template: LocalTaskTemplate): string {
  const types = Array.from(new Set(template.fields.map((f) => f.dataType)));
  return types.slice(0, 3).join(' / ') || '表格';
}

export function inferFileTypes(_template: LocalTaskTemplate): string {
  return formatTemplateFileTypesLabel();
}

export function templateFeatures(template: LocalTaskTemplate): string {
  const parts = [
    template.localOperations.length ? `本地运算 ${template.localOperations.length}` : null,
    template.anomalyRules.length ? `异常规则 ${template.anomalyRules.length}` : null,
    template.aiSummary?.enabled ? 'AI 总结' : null,
  ].filter(Boolean);
  return parts.join(' · ') || '数据分析';
}

export function greetingByHour(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '上午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
