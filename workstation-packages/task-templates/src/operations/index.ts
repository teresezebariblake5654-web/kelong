import { anomaly, defineTemplate, field } from '../define.js';

const unit = field('businessUnit', '经营单元', ['门店', '项目', '业务线', '区域']);
const date = field('date', '日期', ['统计日期', '业务日期'], 'date');

export const OPERATIONS_TASK_TEMPLATES = [
  defineTemplate({
    code: 'OPERATIONS_KPI_DASHBOARD', role: 'operations', name: '经营指标汇总', description: '汇总收入、成本、利润和业务量。',
    fields: [unit, date, field('revenue', '营业收入', ['收入', '销售额'], 'number'), field('cost', '经营成本', ['成本', '费用'], 'number'), field('volume', '业务量', ['订单量', '客流量'], 'number')],
    localOperations: [{ type: 'group', fields: ['businessUnit'] }, { type: 'aggregate', field: 'revenue', operation: 'sum', as: 'revenue' }, { type: 'aggregate', field: 'cost', operation: 'sum', as: 'cost' }, { type: 'derive', as: 'profit', expression: 'revenue-cost', description: '计算经营利润' }],
    anomalyRules: [anomaly('NEGATIVE_PROFIT', '经营亏损', 'profit', 'lt', 0, 'critical', '经营单元利润为负')],
    outputMetrics: { revenue: '营业收入', cost: '经营成本', profit: '利润' }, defaultGroupBy: ['经营单元'],
  }),
  defineTemplate({
    code: 'OPERATIONS_TREND_COMPARISON', role: 'operations', name: '经营趋势对比', description: '按日、周、月对比核心指标变化。',
    fields: [unit, date, field('metric', '指标名称', ['指标', 'KPI']), field('value', '指标值', ['数值', '实际值'], 'number')],
    localOperations: [{ type: 'group', fields: ['businessUnit', 'metric', 'date'] }, { type: 'aggregate', field: 'value', operation: 'sum', as: 'metricValue' }, { type: 'sort', field: 'date', direction: 'asc' }],
    anomalyRules: [anomaly('SHARP_CHANGE', '指标突变', 'metricValue', 'deviation', 2, 'warning', '指标显著偏离历史趋势')],
    outputMetrics: { metricValue: '指标值', changeRate: '环比变化率' }, defaultGroupBy: ['经营单元', '指标名称'],
  }),
  defineTemplate({
    code: 'OPERATIONS_STORE_RANKING', role: 'operations', name: '门店与网点排名', description: '按综合经营指标比较门店和网点表现。',
    fields: [unit, field('region', '区域', ['大区', '城市']), field('revenue', '营业收入', ['收入', '销售额'], 'number'), field('target', '目标', ['预算', '目标额'], 'number'), field('customerCount', '客户数', ['客流', '服务人数'], 'integer')],
    localOperations: [{ type: 'group', fields: ['region', 'businessUnit'] }, { type: 'aggregate', field: 'revenue', operation: 'sum', as: 'revenue' }, { type: 'derive', as: 'achievementRate', expression: 'revenue/target', description: '计算达成率' }, { type: 'sort', field: 'achievementRate', direction: 'desc' }],
    anomalyRules: [anomaly('LOW_RANK', '经营落后', 'achievementRate', 'lt', 0.8, 'warning', '经营目标达成率低于 80%')],
    outputMetrics: { revenue: '营业收入', achievementRate: '目标达成率', rank: '经营排名' }, defaultGroupBy: ['区域'],
  }),
  defineTemplate({
    code: 'OPERATIONS_COST_EFFICIENCY', role: 'operations', name: '运营成本效率', description: '比较成本结构、单位成本和异常费用。',
    fields: [unit, date, field('costType', '成本类别', ['费用科目', '成本项']), field('cost', '成本金额', ['费用', '发生额'], 'number'), field('volume', '业务量', ['订单量', '产出量'], 'number')],
    localOperations: [{ type: 'group', fields: ['businessUnit', 'costType'] }, { type: 'aggregate', field: 'cost', operation: 'sum', as: 'totalCost' }, { type: 'derive', as: 'unitCost', expression: 'totalCost/volume', description: '计算单位成本' }],
    anomalyRules: [anomaly('HIGH_UNIT_COST', '单位成本偏高', 'unitCost', 'deviation', 2, 'warning', '单位成本显著高于整体水平')],
    outputMetrics: { totalCost: '总成本', unitCost: '单位成本' }, defaultGroupBy: ['经营单元', '成本类别'],
  }),
  defineTemplate({
    code: 'OPERATIONS_SERVICE_CAPACITY', role: 'operations', name: '运营产能与负载', description: '分析服务能力、实际负载与资源利用率。',
    fields: [unit, date, field('capacity', '设计产能', ['可用容量', '最大处理量'], 'number'), field('actualVolume', '实际业务量', ['实际处理量', '完成量'], 'number')],
    localOperations: [{ type: 'group', fields: ['businessUnit', 'date'] }, { type: 'aggregate', field: 'actualVolume', operation: 'sum', as: 'actualVolume' }, { type: 'derive', as: 'utilization', expression: 'actualVolume/capacity', description: '计算产能利用率' }],
    anomalyRules: [anomaly('OVER_CAPACITY', '超负荷', 'utilization', 'gt', 1, 'critical', '实际业务量超过设计产能')],
    outputMetrics: { actualVolume: '实际业务量', utilization: '产能利用率' }, defaultGroupBy: ['经营单元'],
  }),
] as const;
