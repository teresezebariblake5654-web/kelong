import { LOCAL_TASK_TEMPLATES } from '@aw/task-templates';

export type DepartmentCode =
  | 'hr'
  | 'marketing'
  | 'sales'
  | 'operations'
  | 'administration'
  | 'procurement'
  | 'production'
  | 'logistics'
  | 'finance'
  | 'ecommerce';

export type DepartmentTheme = {
  from: string;
  to: string;
  accent: string;
  iconBg: string;
};

export type WorkflowMode = {
  templateCode: string;
  name: string;
  description: string;
  version: string;
};

export type DepartmentAgent = {
  code: DepartmentCode;
  name: string;
  description: string;
  icon: DepartmentCode;
  theme: DepartmentTheme;
  workflows: WorkflowMode[];
};

const DEPARTMENT_META: Array<Omit<DepartmentAgent, 'workflows'>> = [
  {
    code: 'production',
    name: '生产制造',
    description: '物料日清、消耗核对与产线进度追踪',
    icon: 'production',
    theme: {
      from: '#EEFBF0',
      to: '#E0F5E5',
      accent: '#3D9A55',
      iconBg: 'linear-gradient(145deg, #66C47D 0%, #3D9A55 100%)',
    },
  },
  {
    code: 'hr',
    name: '人事',
    description: '薪酬、考勤、档案与入离职办理',
    icon: 'hr',
    theme: {
      from: '#EEF4FF',
      to: '#E8EEFF',
      accent: '#5B7CFF',
      iconBg: 'linear-gradient(145deg, #8BA3FF 0%, #5B7CFF 100%)',
    },
  },
  {
    code: 'finance',
    name: '财务',
    description: '费用、对账、应收应付与经营汇总',
    icon: 'finance',
    theme: {
      from: '#FFF8EB',
      to: '#FFF1D6',
      accent: '#D4A017',
      iconBg: 'linear-gradient(145deg, #E8C15A 0%, #D4A017 100%)',
    },
  },
  {
    code: 'logistics',
    name: '物流',
    description: '库存盘点、出入库核对与运单追踪',
    icon: 'logistics',
    theme: {
      from: '#EEF6FF',
      to: '#E1EEFB',
      accent: '#3B7FBE',
      iconBg: 'linear-gradient(145deg, #6BA7E0 0%, #3B7FBE 100%)',
    },
  },
  {
    code: 'ecommerce',
    name: '电商',
    description: '订单清洗、退款异常与销售汇总',
    icon: 'ecommerce',
    theme: {
      from: '#FFF1F6',
      to: '#FFE4EF',
      accent: '#E0569B',
      iconBg: 'linear-gradient(145deg, #F08BB8 0%, #E0569B 100%)',
    },
  },
  {
    code: 'administration',
    name: '行政综合',
    description: '资产、费用、会议室与合同',
    icon: 'administration',
    theme: {
      from: '#F3F0FF',
      to: '#EAE4FF',
      accent: '#7B6FE0',
      iconBg: 'linear-gradient(145deg, #A59AEF 0%, #7B6FE0 100%)',
    },
  },
  {
    code: 'sales',
    name: '销售',
    description: '客户整理、跟进提醒与业绩分析',
    icon: 'sales',
    theme: {
      from: '#EAF8FF',
      to: '#DFF2FB',
      accent: '#2F8FBE',
      iconBg: 'linear-gradient(145deg, #5CB8E8 0%, #2F8FBE 100%)',
    },
  },
  {
    code: 'marketing',
    name: '市场品牌',
    description: '活动 ROI、渠道与内容效果',
    icon: 'marketing',
    theme: {
      from: '#F8EEFF',
      to: '#F0E4FF',
      accent: '#9B5CF0',
      iconBg: 'linear-gradient(145deg, #C28BFF 0%, #9B5CF0 100%)',
    },
  },
  {
    code: 'operations',
    name: '运营',
    description: '经营指标、门店排名与效率',
    icon: 'operations',
    theme: {
      from: '#EAFBF5',
      to: '#DDF6EE',
      accent: '#2E9B78',
      iconBg: 'linear-gradient(145deg, #55C7A0 0%, #2E9B78 100%)',
    },
  },
  {
    code: 'procurement',
    name: '采购',
    description: '支出、价格差异与供应商表现',
    icon: 'procurement',
    theme: {
      from: '#FFF4EA',
      to: '#FFE9D8',
      accent: '#C56A1E',
      iconBg: 'linear-gradient(145deg, #F0A35C 0%, #C56A1E 100%)',
    },
  },
];


function resolveDepartmentCode(
  role: string,
  name: string,
  description: string,
  code: string,
): DepartmentCode | null {
  if (role === 'customer-service') return null;
  const blob = `${name}${description}${code}`;
  if (/财务|费用|报销|预算|账|发票|成本/.test(blob)) return 'finance';
  if (/电商|订单|退款|直播|店铺/.test(blob)) return 'ecommerce';
  if (role === 'universal') return 'administration';
  const allowed: DepartmentCode[] = [
    'hr',
    'marketing',
    'sales',
    'operations',
    'administration',
    'procurement',
    'production',
    'logistics',
    'finance',
    'ecommerce',
  ];
  if (allowed.includes(role as DepartmentCode)) return role as DepartmentCode;
  return null;
}

function buildWorkflowsByDepartment(): Record<DepartmentCode, WorkflowMode[]> {
  const map = Object.fromEntries(
    DEPARTMENT_META.map((d) => [d.code, [] as WorkflowMode[]]),
  ) as Record<DepartmentCode, WorkflowMode[]>;

  for (const task of LOCAL_TASK_TEMPLATES) {
    if (!task.enabled) continue;
    const dept = resolveDepartmentCode(task.role, task.name, task.description, task.code);
    if (!dept) continue;
    map[dept].push({
      templateCode: task.code,
      name: task.name,
      description: task.description,
      version: task.version,
    });
  }

  // 生产部门：办结工作流固定顺序（物料日清优先）
  const productionOrder = [
    'PRODUCTION_MATERIAL_DAILY_CLOSE',
    'PRODUCTION_MATERIAL_VARIANCE_CLOSE',
    'PRODUCTION_PLAN_CLOSE',
    'PRODUCTION_OUTPUT_ATTAINMENT_CLOSE',
    'PRODUCTION_QUALITY_EXCEPTION_CLOSE',
    'PRODUCTION_DOWNTIME_LOSS_CLOSE',
  ];
  map.production.sort((a, b) => {
    const ai = productionOrder.indexOf(a.templateCode);
    const bi = productionOrder.indexOf(b.templateCode);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return map;
}

const workflowsByDepartment = buildWorkflowsByDepartment();

/** 部门智能体配置（工作模式来自现有本地任务模板映射，不改后端） */
export const DEPARTMENT_AGENTS: DepartmentAgent[] = DEPARTMENT_META.map((meta) => ({
  ...meta,
  workflows: workflowsByDepartment[meta.code] ?? [],
}));

/** 前端主页上架的智能体（暂下架生产 / 物流；隐藏销售 / 采购 / 市场品牌 / 运营等） */
export const PUBLISHED_AGENT_CODES: DepartmentCode[] = [
  'hr',
  'finance',
  'ecommerce',
  'administration',
];

export const PUBLISHED_DEPARTMENT_AGENTS: DepartmentAgent[] = PUBLISHED_AGENT_CODES.map(
  (code) => DEPARTMENT_AGENTS.find((item) => item.code === code)!,
).filter(Boolean);

export function isPublishedDepartmentCode(code: string): boolean {
  return (PUBLISHED_AGENT_CODES as readonly string[]).includes(code);
}

export function resolveDepartmentCodeForTask(input: {
  role: string;
  name: string;
  description: string;
  code: string;
}): DepartmentCode | null {
  return resolveDepartmentCode(input.role, input.name, input.description, input.code);
}

export function getDepartmentCodeForTemplateCode(templateCode: string): DepartmentCode | null {
  for (const department of DEPARTMENT_AGENTS) {
    if (department.workflows.some((item) => item.templateCode === templateCode)) {
      return department.code;
    }
  }
  return null;
}

export function getDepartmentAgent(code: string): DepartmentAgent | undefined {
  return DEPARTMENT_AGENTS.find((item) => item.code === code);
}

export function isDepartmentCode(value: string): value is DepartmentCode {
  return DEPARTMENT_AGENTS.some((item) => item.code === value);
}
