import type { PrimaryAgentCode } from '@workstation/data/agentConfigs';
import type { HistoryItem } from '@workstation/lib/localStore';

export type AgentMetricValue = {
  key: 'todayTasks' | 'completed' | 'alerts' | 'sync';
  label: string;
  value: string | number;
  trend?: string;
  trendPositive?: boolean;
  hint?: string;
};

export type AgentStatusBarData = {
  title: string;
  running: boolean;
  metrics: Array<{ label: string; value: string }>;
  health: string;
};

export type AgentRecentStat = {
  label: string;
  value: string;
  alert?: boolean;
};

export type AgentRecentResultData = {
  title: string;
  completedAt: string;
  stats: AgentRecentStat[];
  analysisTitle: string;
  analysisItems: string[];
  primaryAction: string;
  secondaryAction: string;
  /** 是否来自真实历史；false 表示 mock */
  fromHistory: boolean;
};

const MOCK_METRICS: Record<
  PrimaryAgentCode,
  { todayTasks: number; completed: number; alerts: number; trends: [string, string, string] }
> = {
  production: {
    todayTasks: 18,
    completed: 12,
    alerts: 2,
    trends: ['较昨日 +12%', '较昨日 +8%', '较昨日 -33%'],
  },
  hr: {
    todayTasks: 14,
    completed: 9,
    alerts: 3,
    trends: ['较昨日 +5%', '较昨日 +11%', '较昨日 -20%'],
  },
  finance: {
    todayTasks: 11,
    completed: 7,
    alerts: 1,
    trends: ['较昨日 +3%', '较昨日 +6%', '较昨日 -50%'],
  },
  logistics: {
    todayTasks: 16,
    completed: 10,
    alerts: 4,
    trends: ['较昨日 +9%', '较昨日 +4%', '较昨日 +12%'],
  },
  ecommerce: {
    todayTasks: 22,
    completed: 15,
    alerts: 5,
    trends: ['较昨日 +18%', '较昨日 +10%', '较昨日 -8%'],
  },
  administration: {
    todayTasks: 10,
    completed: 7,
    alerts: 2,
    trends: ['较昨日 +4%', '较昨日 +9%', '较昨日 -10%'],
  },
};

const MOCK_STATUS: Partial<Record<PrimaryAgentCode, AgentStatusBarData>> = {
  production: {
    title: '产线 A_01 运行中',
    running: true,
    metrics: [
      { label: 'OEE', value: '78.6%' },
      { label: '稼动率', value: '92.1%' },
      { label: '良品率', value: '97.3%' },
    ],
    health: '健康',
  },
  logistics: {
    title: '仓储中心 W_01 运行中',
    running: true,
    metrics: [
      { label: '出库准时率', value: '94.2%' },
      { label: '在途运单', value: '128' },
      { label: '库存准确率', value: '99.1%' },
    ],
    health: '健康',
  },
  ecommerce: {
    title: '店铺集群运行中',
    running: true,
    metrics: [
      { label: '今日订单', value: '1,286' },
      { label: '退款率', value: '2.4%' },
      { label: '转化率', value: '3.8%' },
    ],
    health: '健康',
  },
};

const MOCK_RECENT: Record<PrimaryAgentCode, Omit<AgentRecentResultData, 'fromHistory'>> = {
  production: {
    title: '物料日清 · 今日执行概览',
    completedAt: '10:24',
    stats: [
      { label: '应发料数', value: '124 项' },
      { label: '已发料数', value: '118 项' },
      { label: '差异数', value: '6 项', alert: true },
    ],
    analysisTitle: '差异原因分析',
    analysisItems: [
      '3 项因产线临时换单未及时回写领料单',
      '2 项为盘点尾差，建议复核库位',
      '1 项供应商少发，已标记待补料',
    ],
    primaryAction: '生成日报',
    secondaryAction: '查看明细',
  },
  hr: {
    title: '考勤异常 · 今日执行概览',
    completedAt: '09:40',
    stats: [
      { label: '应出勤', value: '286 人' },
      { label: '异常人次', value: '12 人', alert: true },
      { label: '已处理', value: '8 人' },
    ],
    analysisTitle: '异常分布',
    analysisItems: ['迟到 7 人，集中在早班一线', '缺勤 3 人，待补交说明', '早退 2 人，已通知直属主管'],
    primaryAction: '生成日报',
    secondaryAction: '查看明细',
  },
  finance: {
    title: '费用整理 · 今日执行概览',
    completedAt: '11:05',
    stats: [
      { label: '单据数', value: '86 笔' },
      { label: '已核验', value: '79 笔' },
      { label: '异常', value: '7 笔', alert: true },
    ],
    analysisTitle: '异常说明',
    analysisItems: ['4 笔缺少发票附件', '2 笔科目归类不一致', '1 笔超预算待审批'],
    primaryAction: '生成汇总',
    secondaryAction: '查看明细',
  },
  logistics: {
    title: '库存盘点 · 今日执行概览',
    completedAt: '08:55',
    stats: [
      { label: '盘点 SKU', value: '420' },
      { label: '一致', value: '401' },
      { label: '差异', value: '19', alert: true },
    ],
    analysisTitle: '差异原因',
    analysisItems: ['12 项出入库单据滞后', '5 项库位错放', '2 项待复核'],
    primaryAction: '生成日报',
    secondaryAction: '查看明细',
  },
  ecommerce: {
    title: '订单清洗 · 今日执行概览',
    completedAt: '10:12',
    stats: [
      { label: '原始订单', value: '2,340' },
      { label: '有效订单', value: '2,218' },
      { label: '异常', value: '122', alert: true },
    ],
    analysisTitle: '清洗结果',
    analysisItems: ['重复订单 48 笔已合并', '缺地址 31 笔待补全', '异常退款标记 43 笔'],
    primaryAction: '生成汇总',
    secondaryAction: '查看明细',
  },
  administration: {
    title: '资产盘点 · 今日执行概览',
    completedAt: '09:18',
    stats: [
      { label: '盘点资产', value: '186' },
      { label: '一致', value: '172' },
      { label: '差异', value: '14', alert: true },
    ],
    analysisTitle: '关键洞察',
    analysisItems: ['8 项位置与台账不符', '4 项维保即将到期', '2 项闲置超 90 天'],
    primaryAction: '生成日报',
    secondaryAction: '查看明细',
  },
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfYesterday() {
  return startOfToday() - 24 * 60 * 60 * 1000;
}

/** 用真实任务历史计算指标；无数据时回退 mock */
export function resolveAgentMetrics(
  code: string,
  labels: Array<{ key: AgentMetricValue['key']; label: string }>,
  history: HistoryItem[],
): { metrics: AgentMetricValue[]; source: 'history' | 'mock' } {
  const primary = (code in MOCK_METRICS ? code : 'production') as PrimaryAgentCode;
  const mock = MOCK_METRICS[primary];
  const todayStart = startOfToday();
  const yesterdayStart = startOfYesterday();

  const deptHistory = history.filter((item) => item.departmentCode === code);
  const todayItems = deptHistory.filter((item) => new Date(item.createdAt).getTime() >= todayStart);
  const yesterdayItems = deptHistory.filter((item) => {
    const t = new Date(item.createdAt).getTime();
    return t >= yesterdayStart && t < todayStart;
  });

  const hasHistory = deptHistory.length > 0;
  const todayTasks = hasHistory ? todayItems.length : mock.todayTasks;
  const completed = hasHistory
    ? todayItems.filter((item) => (item.status ?? 'completed') === 'completed').length
    : mock.completed;
  const alerts = hasHistory
    ? todayItems.filter((item) => item.status === 'failed').length
    : mock.alerts;

  let todayTrend = mock.trends[0];
  let todayPositive = !mock.trends[0].includes('-');
  if (hasHistory && yesterdayItems.length > 0) {
    const pct = ((todayTasks - yesterdayItems.length) / yesterdayItems.length) * 100;
    const sign = pct >= 0 ? '+' : '';
    todayTrend = `较昨日 ${sign}${pct.toFixed(0)}%`;
    todayPositive = pct >= 0;
  }

  const now = new Date();
  const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const valueMap: Record<AgentMetricValue['key'], Omit<AgentMetricValue, 'key' | 'label'>> = {
    todayTasks: {
      value: todayTasks,
      trend: todayTrend,
      trendPositive: todayPositive,
    },
    completed: {
      value: completed,
      trend: mock.trends[1],
      trendPositive: !mock.trends[1].includes('-'),
    },
    alerts: {
      value: alerts,
      trend: mock.trends[2],
      trendPositive: mock.trends[2].includes('-'),
    },
    sync: {
      value: '实时',
      hint: `最后更新 ${timeLabel}`,
    },
  };

  return {
    source: hasHistory ? 'history' : 'mock',
    metrics: labels.map((item) => ({
      key: item.key,
      label: item.label,
      ...valueMap[item.key],
    })),
  };
}

export function resolveAgentStatusBar(code: string): AgentStatusBarData | null {
  if (code in MOCK_STATUS) return MOCK_STATUS[code as PrimaryAgentCode] ?? null;
  return null;
}

/** 优先用最近一条部门历史拼装结果卡；否则 mock */
export function resolveAgentRecentResult(
  code: string,
  history: HistoryItem[],
): AgentRecentResultData {
  const primary = (code in MOCK_RECENT ? code : 'production') as PrimaryAgentCode;
  const mock = MOCK_RECENT[primary];
  const latest = history
    .filter((item) => item.departmentCode === code)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!latest) {
    return { ...mock, fromHistory: false };
  }

  const completedAt = new Date(latest.createdAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    title: `${latest.taskName} · 最近执行`,
    completedAt,
    stats: [
      { label: '任务状态', value: latest.status === 'failed' ? '失败' : '已完成', alert: latest.status === 'failed' },
      { label: '文件', value: latest.fileName || '—' },
      { label: 'AI 积分', value: latest.creditsCharged != null ? `${latest.creditsCharged}` : '—' },
    ],
    analysisTitle: '执行摘要',
    analysisItems: latest.summary
      ? [latest.summary]
      : latest.analysisText
        ? [latest.analysisText.slice(0, 160) + (latest.analysisText.length > 160 ? '…' : '')]
        : ['暂无详细摘要，可点击查看明细继续追问。'],
    primaryAction: '生成日报',
    secondaryAction: '查看明细',
    fromHistory: true,
  };
}
