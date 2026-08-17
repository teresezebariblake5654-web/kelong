import { LOCAL_TASK_TEMPLATES } from '@aw/task-templates';
import { templateFileTypesForDisplay } from '@aw/shared';
import type {
  BusinessTemplate,
  TemplateCategory,
  TemplateCategoryId,
} from '@workstation/types';

const CATEGORY_META: Array<{
  id: TemplateCategoryId;
  name: string;
  description: string;
}> = [
  { id: 'hr', name: '人力资源', description: '考勤、编制、薪酬与招聘' },
  { id: 'marketing', name: '市场/品牌', description: '活动、渠道与投放' },
  { id: 'sales', name: '销售', description: '业绩、客户与回款' },
  { id: 'operations', name: '运营', description: '留存、转化与活动效果' },
  { id: 'administration', name: '行政', description: '费用、资产与后勤' },
  { id: 'procurement', name: '采购', description: '供应商、价格与交期' },
  { id: 'production', name: '生产', description: '产量、达成与良率' },
  { id: 'logistics', name: '物流', description: '延误、承运与在途' },
  { id: 'finance', name: '财务', description: '费用、预算与成本相关' },
  { id: 'customer-service', name: '客服', description: '工单、响应与满意度' },
];

function resolveCategoryId(role: string, name: string, description: string, code: string): TemplateCategoryId {
  if (/财务|费用|报销|预算|账|发票|成本/.test(`${name}${description}${code}`)) {
    return 'finance';
  }
  if (role === 'universal') return 'administration';
  return role as TemplateCategoryId;
}

function buildTemplates(): BusinessTemplate[] {
  return LOCAL_TASK_TEMPLATES.filter((t) => t.enabled).map((t, index) => {
    const categoryId = resolveCategoryId(t.role, t.name, t.description, t.code);
    const dataTypes = Array.from(new Set(t.fields.map((f) => f.dataType))).slice(0, 3);
    return {
      id: `tpl_${t.code}`,
      code: t.code,
      version: t.version,
      name: t.name,
      categoryId,
      scenario: t.description,
      description: t.description,
      fileTypes: templateFileTypesForDisplay(),
      dataTypes,
      features: [
        t.localOperations.length ? `本地运算 ${t.localOperations.length}` : '本地清洗',
        t.anomalyRules.length ? `异常规则 ${t.anomalyRules.length}` : '质量检查',
        t.aiSummary.enabled ? 'AI 总结' : '结构化输出',
      ],
      creditCost: t.estimatedCredits,
      usageCount: Math.max(0, 12 - (index % 13)),
      lastUsedAt: index % 4 === 0 ? null : new Date(Date.now() - index * 86_400_000).toISOString(),
      favorited: index % 7 === 0,
      recommended: index < 8,
      requiredFields: t.fields.filter((f) => f.required).map((f) => f.label),
      agentRole: t.role,
    };
  });
}

export const mockBusinessTemplates: BusinessTemplate[] = buildTemplates();

export const mockTemplateCategories: TemplateCategory[] = CATEGORY_META.map((meta) => ({
  ...meta,
  templateCount: mockBusinessTemplates.filter((t) => t.categoryId === meta.id).length,
  accentToken: `dept-${meta.id}`,
}));
