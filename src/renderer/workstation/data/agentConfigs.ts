import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Package,
  PackageCheck,
  PackageMinus,
  PackageSearch,
  Receipt,
  RefreshCw,
  ScrollText,
  ShoppingBag,
  Target,
  Truck,
  UserPlus,
  Users,
  UserSearch,
  Wallet,
} from 'lucide-react';
import {
  AGENT_AVATAR_FILES,
  resolveAgentAvatarUrl,
} from '@workstation/assets/agents';
import type { DepartmentCode } from '@workstation/data/departmentAgents';
import { resolveModePromptPack } from '@workstation/data/workModePrompts';

/** 工作台主推岗位（统一 AgentWorkspace 模板） */
export type PrimaryAgentCode =
  | 'production'
  | 'hr'
  | 'finance'
  | 'logistics'
  | 'ecommerce'
  | 'administration';

export type AgentTheme = {
  from: string;
  to: string;
  accent: string;
  accentSoft: string;
  iconBg: string;
  heroFrom: string;
  heroTo: string;
};

export type AgentAvatarPosition = 'right' | 'right-bottom';

export type AgentWorkMode = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  /** 绑定现有任务模板；缺省表示功能开发中 */
  templateCode?: string;
  templateVersion?: string;
  recommended?: boolean;
  /** Chat-first prompts shown when this mode is selected */
  prompts?: string[];
  /** Short hint about recommended upload files */
  fileHint?: string;
};

export type AgentMetricDef = {
  key: 'todayTasks' | 'completed' | 'alerts' | 'sync';
  label: string;
};

export type AgentConfig = {
  code: DepartmentCode;
  name: string;
  /** 顶部下拉/短名 */
  shortName: string;
  description: string;
  slogan: string;
  welcomeTitle: string;
  intro: string;
  inputPlaceholder: string;
  /**
   * 岗位人物资源文件名（位于 src/assets/agents/）
   * 运行时通过 resolveAgentAvatarUrl 解析；缺图时 HeroBanner 显示兜底卡
   */
  avatar: string;
  avatarAlt: string;
  avatarPosition: AgentAvatarPosition;
  /** Banner / 选中态主题色 */
  themeColor: string;
  /** Banner 背景渐变 CSS（可含多层） */
  heroBackground: string;
  theme: AgentTheme;
  workModes: AgentWorkMode[];
  quickTasks: string[];
  metrics: AgentMetricDef[];
  statusLabel?: string;
};

function avatarFields(
  code: PrimaryAgentCode,
  alt: string,
  themeColor: string,
  heroBackground: string,
  heroFrom: string,
  heroTo: string,
) {
  const filename = AGENT_AVATAR_FILES[code];
  const resolved = resolveAgentAvatarUrl(filename);
  return {
    /** 解析后的图片 URL；缺图时为空字符串，由 HeroBanner 显示兜底 */
    avatar: resolved ?? '',
    avatarAlt: alt,
    avatarPosition: 'right-bottom' as const,
    themeColor,
    heroBackground,
    theme: {
      from: heroFrom,
      to: heroTo,
      accent: themeColor,
      accentSoft: `${themeColor}1F`,
      iconBg: `linear-gradient(145deg, ${themeColor}CC 0%, ${themeColor} 100%)`,
      heroFrom,
      heroTo,
    },
  };
}

export const PRIMARY_AGENT_CODES: PrimaryAgentCode[] = [
  'production',
  'hr',
  'finance',
  'logistics',
  'ecommerce',
  'administration',
];

export const agentConfigs: Record<PrimaryAgentCode, AgentConfig> = {
  production: {
    code: 'production',
    name: '生产制造',
    shortName: '生产制造',
    description: '物料日清、消耗核对与产线进度追踪',
    slogan: '数据驱动生产 · 智能创造价值',
    welcomeTitle: 'Hi, 生产制造智能体为您服务!',
    intro:
      '你好，我是生产制造智能体。我可以帮你完成物料日清、消耗核对、计划清理与进度追踪，上传表格或直接描述需求即可开始。',
    inputPlaceholder: '输入问题或上传文件，你的生产助手随时在线...',
    ...avatarFields(
      'production',
      '生产制造岗位人物：绿色安全帽与工装，手持生产检查板',
      '#3D9A55',
      'linear-gradient(125deg, #EEFBF0 0%, #E8F8EC 48%, #E0F5E5 100%)',
      '#EEFBF0',
      '#E0F5E5',
    ),
    workModes: [
      {
        id: 'material-daily',
        name: '物料日清',
        description: '核对当日发料、领料与差异',
        icon: ClipboardCheck,
        iconColor: '#22C55E',
        templateCode: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
        recommended: true,
      },
      {
        id: 'material-variance',
        name: '核对物料消耗',
        description: '比对计划消耗与实际用量',
        icon: PackageSearch,
        iconColor: '#16A34A',
        templateCode: 'PRODUCTION_MATERIAL_VARIANCE_CLOSE',
      },
      {
        id: 'plan-close',
        name: '清理生产计划',
        description: '办结过期与异常生产计划',
        icon: ClipboardList,
        iconColor: '#059669',
        templateCode: 'PRODUCTION_PLAN_CLOSE',
      },
      {
        id: 'progress-track',
        name: '生产进度追踪',
        description: '跟踪产量达成与未完工单',
        icon: BarChart3,
        iconColor: '#10B981',
        templateCode: 'PRODUCTION_OUTPUT_ATTAINMENT_CLOSE',
      },
      {
        id: 'shortage-alert',
        name: '质量异常',
        description: '检验判定、不合格隔离与缺陷分析',
        icon: PackageMinus,
        iconColor: '#84CC16',
        templateCode: 'PRODUCTION_QUALITY_EXCEPTION_CLOSE',
      },
      {
        id: 'workorder-close',
        name: '停机损失/工单结案',
        description: '停机损失核算与结案条件检查',
        icon: PackageCheck,
        iconColor: '#65A30D',
        templateCode: 'PRODUCTION_DOWNTIME_LOSS_CLOSE',
      },
    ],
    quickTasks: [
      '分析今天物料消耗情况',
      '查看产线异常预警',
      '生成日报',
      '检查库存与领料单',
    ],
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
    statusLabel: '产线 A_01 运行中',
  },
  hr: {
    code: 'hr',
    name: '人事',
    shortName: '人事',
    description: '薪酬、考勤、档案与入离职办理',
    slogan: '人才数据洞察 · 人事效能升级',
    welcomeTitle: 'Hi, 人事智能体为您服务!',
    intro:
      '你好，我是人事智能体。在右侧点选工作模式后，这里会给出提示词；上传工资/考勤等表格，点提示词或直接输入即可像平常聊天一样开始分析。',
    inputPlaceholder: '上传文件后输入问题，或点上方提示词开始…',
    ...avatarFields(
      'hr',
      '人事岗位人物：米白职业套装，手持员工档案夹',
      '#5B7CFF',
      'linear-gradient(125deg, #EEF4FF 0%, #E8EEFF 50%, #E0E7FF 100%)',
      '#EEF4FF',
      '#E0E7FF',
    ),
    workModes: [
      {
        id: 'payroll',
        name: '工资核算',
        description: '核对应发实发与波动异常',
        icon: Wallet,
        iconColor: '#5B7CFF',
        templateCode: 'HR_PAYROLL_VARIANCE',
        recommended: true,
      },
      {
        id: 'attendance',
        name: '考勤异常',
        description: '汇总迟到早退与缺勤分布',
        icon: AlertTriangle,
        iconColor: '#4F6EF7',
        templateCode: 'HR_ATTENDANCE_SUMMARY',
      },
      {
        id: 'archives',
        name: '员工档案',
        description: '整理编制、在岗与空缺信息',
        icon: FolderOpen,
        iconColor: '#6366F1',
        templateCode: 'HR_HEADCOUNT_SNAPSHOT',
      },
      {
        id: 'onboard',
        name: '入离职处理',
        description: '分析流动原因与办理进度',
        icon: UserPlus,
        iconColor: '#818CF8',
        templateCode: 'HR_TURNOVER_ANALYSIS',
      },
      {
        id: 'social-security',
        name: '社保核对',
        description: '核对社会保险缴纳差异',
        icon: ClipboardCheck,
        iconColor: '#3B82F6',
        templateCode: 'HR_SOCIAL_INSURANCE',
      },
      {
        id: 'recruitment',
        name: '招聘漏斗',
        description: '统计投递到入职的转化',
        icon: UserSearch,
        iconColor: '#0EA5E9',
        templateCode: 'HR_RECRUITMENT_FUNNEL',
      },
      {
        id: 'performance',
        name: '绩效分布',
        description: '分析绩效等级分布与离群',
        icon: BarChart3,
        iconColor: '#5B7CFF',
        templateCode: 'HR_PERFORMANCE_DISTRIBUTION',
      },
    ],
    quickTasks: ['核算本月工资差异', '汇总考勤异常', '生成入职清单', '检查编制空缺'],
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
  },
  finance: {
    code: 'finance',
    name: '财务',
    shortName: '财务',
    description: '费用、对账、应收应付与经营汇总',
    slogan: '账目清晰可控 · 经营决策有据',
    welcomeTitle: 'Hi, 财务智能体为您服务!',
    intro:
      '你好，我是财务智能体。右侧选择费用整理、对账等模式后，主页会跳出提示词；上传账单表格，点提示词就能开始 AI 分析。',
    inputPlaceholder: '上传文件后输入问题，或点上方提示词开始…',
    ...avatarFields(
      'finance',
      '财务岗位人物：金色商务装与眼镜，手持计算器',
      '#D4A017',
      'linear-gradient(125deg, #FFF8EB 0%, #FFF3DC 55%, #FFF1D6 100%)',
      '#FFF8EB',
      '#FFF1D6',
    ),
    workModes: [
      {
        id: 'expense',
        name: '费用整理',
        description: '归类费用并核对预算执行',
        icon: Receipt,
        iconColor: '#D4A017',
        templateCode: 'FIN_EXPENSE_CLEAN',
        recommended: true,
      },
      {
        id: 'reconcile',
        name: '对账核验',
        description: '比对账目差异与未达项',
        icon: RefreshCw,
        iconColor: '#F59E0B',
        templateCode: 'FIN_RECONCILIATION',
      },
      {
        id: 'ar-ap',
        name: '应收应付',
        description: '梳理往来账龄与风险',
        icon: FileSpreadsheet,
        iconColor: '#D97706',
        templateCode: 'FIN_ARAP',
      },
      {
        id: 'invoice',
        name: '发票识别',
        description: '识别发票关键字段与异常',
        icon: FileText,
        iconColor: '#EAB308',
        templateCode: 'FIN_INVOICE_OCR',
      },
      {
        id: 'ops-summary',
        name: '经营汇总',
        description: '汇总收入成本与利润概况',
        icon: BarChart3,
        iconColor: '#CA8A04',
        templateCode: 'FIN_OPERATING_SUMMARY',
      },
    ],
    quickTasks: ['整理本月费用', '核对银行对账单', '汇总应收逾期', '生成经营简报'],
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
  },
  logistics: {
    code: 'logistics',
    name: '物流',
    shortName: '物流',
    description: '库存盘点、出入库核对与运单追踪',
    slogan: '仓配协同高效 · 物流状态可视',
    welcomeTitle: 'Hi, 物流智能体为您服务!',
    intro:
      '你好，我是物流智能体。我可以协助库存盘点、出入库核对、运单追踪与库存预警，上传单据或描述场景即可启动。',
    inputPlaceholder: '输入问题或上传文件，你的物流助手随时在线...',
    ...avatarFields(
      'logistics',
      '物流岗位人物：蓝色工装与对讲机，手持运单平板',
      '#3B7FBE',
      'linear-gradient(125deg, #EEF6FF 0%, #E8F2FC 48%, #E1EEFB 100%)',
      '#EEF6FF',
      '#E1EEFB',
    ),
    workModes: [
      {
        id: 'inventory',
        name: '库存盘点',
        description: '核对账面与实盘差异',
        icon: Boxes,
        iconColor: '#3B7FBE',
        templateCode: 'LOG_INVENTORY_COUNT',
        recommended: true,
      },
      {
        id: 'inout',
        name: '出入库核对',
        description: '比对出入库单据与库存',
        icon: Package,
        iconColor: '#0EA5E9',
        templateCode: 'LOG_INOUT_RECONCILE',
      },
      {
        id: 'tracking',
        name: '运单追踪',
        description: '跟踪在途运单与延误',
        icon: Truck,
        iconColor: '#0284C7',
        templateCode: 'LOG_SHIPMENT_TRACK',
      },
      {
        id: 'stock-alert',
        name: '库存预警',
        description: '识别低库存与积压风险',
        icon: AlertTriangle,
        iconColor: '#38BDF8',
        templateCode: 'LOG_STOCK_ALERT',
      },
      {
        id: 'transfer',
        name: '调拨整理',
        description: '整理跨仓调拨与在途量',
        icon: RefreshCw,
        iconColor: '#0369A1',
        templateCode: 'LOG_TRANSFER_CLEAN',
      },
    ],
    quickTasks: ['盘点当前库存差异', '核对今日出入库', '追踪延误运单', '生成库存预警'],
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
  },
  ecommerce: {
    code: 'ecommerce',
    name: '电商',
    shortName: '电商',
    description: '订单清洗、退款异常与销售汇总',
    slogan: '订单数据清晰 · 经营转化可见',
    welcomeTitle: 'Hi, 电商智能体为您服务!',
    intro:
      '你好，我是电商智能体。点选订单清洗、退款异常等工作模式后，这里会出现提示词；上传订单表，像聊天一样开始处理。',
    inputPlaceholder: '上传文件后输入问题，或点上方提示词开始…',
    ...avatarFields(
      'ecommerce',
      '电商岗位人物：浅粉潮流服装与耳麦，手持订单平板',
      '#E0569B',
      'linear-gradient(125deg, #FFF1F6 0%, #FFE8F0 48%, #FFE4EF 100%)',
      '#FFF1F6',
      '#FFE4EF',
    ),
    workModes: [
      {
        id: 'order-clean',
        name: '订单清洗',
        description: '清洗重复、缺失与异常订单',
        icon: ShoppingBag,
        iconColor: '#E0569B',
        templateCode: 'ECOM_ORDER_CLEAN',
        recommended: true,
      },
      {
        id: 'refund',
        name: '退款异常',
        description: '识别异常退款与风险订单',
        icon: AlertTriangle,
        iconColor: '#DB2777',
        templateCode: 'ECOM_REFUND',
      },
      {
        id: 'product-data',
        name: '商品数据',
        description: '汇总商品销量与库存表现',
        icon: Package,
        iconColor: '#EC4899',
        templateCode: 'ECOM_PRODUCT_DATA',
      },
      {
        id: 'live-orders',
        name: '直播订单',
        description: '整理直播场次订单与转化',
        icon: BarChart3,
        iconColor: '#F472B6',
        templateCode: 'ECOM_LIVE_ORDER',
      },
      {
        id: 'sales-summary',
        name: '销售汇总',
        description: '按渠道与商品汇总销售',
        icon: Target,
        iconColor: '#BE185D',
        templateCode: 'ECOM_SALES_SUMMARY',
      },
    ],
    quickTasks: ['清洗今日订单', '排查退款异常', '汇总直播场次', '生成销售日报'],
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
  },
  administration: {
    code: 'administration',
    name: '行政综合',
    shortName: '行政综合',
    description: '资产、费用、会议室与合同',
    slogan: '行政事务有序 · 资产合同可追踪',
    welcomeTitle: 'Hi, 行政综合智能体为您服务!',
    intro:
      '你好，我是行政综合智能体。选择资产盘点、合同提醒等模式后，主页给出提示词；上传台账，点提示词即可开始。',
    inputPlaceholder: '上传文件后输入问题，或点上方提示词开始…',
    ...avatarFields(
      'administration',
      '行政综合岗位人物：浅紫商务装，手持资产台账平板',
      '#7B6FE0',
      'linear-gradient(125deg, #F3F0FF 0%, #EEE9FF 48%, #EAE4FF 100%)',
      '#F3F0FF',
      '#EAE4FF',
    ),
    workModes: [
      {
        id: 'asset',
        name: '资产盘点',
        description: '比对台账与实盘差异',
        icon: Building2,
        iconColor: '#7B6FE0',
        templateCode: 'ADMIN_ASSET_INVENTORY',
        recommended: true,
      },
      {
        id: 'expense',
        name: '费用分析',
        description: '识别行政费用异常增长',
        icon: Wallet,
        iconColor: '#8B5CF6',
        templateCode: 'ADMIN_EXPENSE_ANALYSIS',
      },
      {
        id: 'room',
        name: '会议室利用率',
        description: '统计预订、使用与爽约',
        icon: CalendarDays,
        iconColor: '#7C6CF0',
        templateCode: 'ADMIN_MEETING_UTILIZATION',
      },
      {
        id: 'contract',
        name: '合同到期提醒',
        description: '识别到期与续约节点',
        icon: ScrollText,
        iconColor: '#A78BFA',
        templateCode: 'ADMIN_CONTRACT_EXPIRY',
      },
    ],
    quickTasks: ['盘点本月资产', '分析行政费用', '统计会议室使用', '查看到期合同'],
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
  },
};

function enrichWorkModes(
  departmentCode: DepartmentCode,
  modes: AgentWorkMode[],
): AgentWorkMode[] {
  return modes.map((mode) => {
    if (mode.prompts?.length) return mode;
    const pack = resolveModePromptPack(departmentCode, mode.id, mode.name);
    return {
      ...mode,
      prompts: pack.prompts,
      fileHint: mode.fileHint ?? pack.fileHint,
    };
  });
}

function enrichAgentConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    workModes: enrichWorkModes(config.code, config.workModes),
  };
}

export function isPrimaryAgentCode(code: string): code is PrimaryAgentCode {
  return PRIMARY_AGENT_CODES.includes(code as PrimaryAgentCode);
}

export function getAgentConfig(code: string): AgentConfig | undefined {
  if (!isPrimaryAgentCode(code)) return undefined;
  return enrichAgentConfig(agentConfigs[code]);
}

/** 非主推岗位：用部门基础信息拼出可用的工作台配置 */
export function buildFallbackAgentConfig(
  department: {
    code: DepartmentCode;
    name: string;
    description: string;
    theme: { from: string; to: string; accent: string; iconBg: string };
    workflows: Array<{ templateCode: string; name: string; description: string; version: string }>;
  },
): AgentConfig {
  const icons = [ClipboardList, BarChart3, Package, FileText, Users, Target];
  const colors = ['#22C55E', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6'];
  return enrichAgentConfig({
    code: department.code,
    name: department.name,
    shortName: department.name,
    description: department.description,
    slogan: `${department.name} · 智能提效`,
    welcomeTitle: `Hi, ${department.name}智能体为您服务!`,
    intro: `你好，我是${department.name}智能体。在右侧选择工作模式后，主页会给出提示词；上传文件并点提示词即可像平常聊天一样开始分析。`,
    inputPlaceholder: `上传文件后输入问题，或点上方提示词开始…`,
    avatar: '',
    avatarAlt: `${department.name}岗位人物（待替换）`,
    avatarPosition: 'right-bottom',
    themeColor: department.theme.accent,
    heroBackground: `linear-gradient(125deg, ${department.theme.from} 0%, ${department.theme.to} 100%)`,
    theme: {
      from: department.theme.from,
      to: department.theme.to,
      accent: department.theme.accent,
      accentSoft: `${department.theme.accent}1F`,
      iconBg: department.theme.iconBg,
      heroFrom: department.theme.from,
      heroTo: department.theme.to,
    },
    workModes: department.workflows.map((wf, index) => ({
      id: wf.templateCode,
      name: wf.name,
      description: wf.description,
      icon: icons[index % icons.length]!,
      iconColor: colors[index % colors.length]!,
      templateCode: wf.templateCode,
      templateVersion: wf.version,
      recommended: index === 0,
    })),
    quickTasks: department.workflows.slice(0, 4).map((wf) => wf.name),
    metrics: [
      { key: 'todayTasks', label: '今日任务' },
      { key: 'completed', label: '已完成' },
      { key: 'alerts', label: '异常预警' },
      { key: 'sync', label: '数据同步' },
    ],
  });
}

export function resolveAgentConfig(department: {
  code: DepartmentCode;
  name: string;
  description: string;
  theme: { from: string; to: string; accent: string; iconBg: string };
  workflows: Array<{ templateCode: string; name: string; description: string; version: string }>;
}): AgentConfig {
  return getAgentConfig(department.code) ?? buildFallbackAgentConfig(department);
}
