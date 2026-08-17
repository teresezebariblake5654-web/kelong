import { anomaly, defineTemplate, field } from '../define.js';

const owner = field('owner', '销售人员', ['销售', '负责人', '业务员']);
const amount = field('amount', '销售金额', ['金额', '成交额', '含税金额'], 'number');

export const SALES_TASK_TEMPLATES = [
  defineTemplate({
    code: 'SALES_PERFORMANCE_SUMMARY', role: 'sales', name: '销售业绩汇总', description: '按人员、区域和产品统计销售额与订单量。',
    fields: [owner, field('region', '区域', ['地区', '大区']), field('product', '产品', ['商品', 'SKU']), amount, field('orderId', '订单编号', ['订单号', '单据号'])],
    localOperations: [{ type: 'group', fields: ['owner', 'region', 'product'] }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'salesAmount' }, { type: 'aggregate', field: 'orderId', operation: 'count-distinct', as: 'orderCount' }],
    anomalyRules: [anomaly('NEGATIVE_SALE', '负数销售', 'amount', 'lt', 0, 'critical', '销售金额为负数')],
    outputMetrics: { salesAmount: '销售额', orderCount: '订单量' }, defaultGroupBy: ['销售人员'],
  }),
  defineTemplate({
    code: 'SALES_TARGET_ACHIEVEMENT', role: 'sales', name: '销售目标达成', description: '比较目标、实际和达成率。',
    fields: [owner, field('period', '期间', ['月份', '季度']), field('target', '销售目标', ['目标额', '预算'], 'number'), amount],
    localOperations: [{ type: 'group', fields: ['owner', 'period'] }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'actual' }, { type: 'derive', as: 'achievementRate', expression: 'actual/target', description: '计算目标达成率' }],
    anomalyRules: [anomaly('LOW_ACHIEVEMENT', '目标达成不足', 'achievementRate', 'lt', 0.8, 'critical', '目标达成率低于 80%')],
    outputMetrics: { actual: '实际销售额', achievementRate: '达成率' }, defaultGroupBy: ['销售人员'],
  }),
  defineTemplate({
    code: 'SALES_PIPELINE_FUNNEL', role: 'sales', name: '销售漏斗分析', description: '统计商机阶段、金额、转化率与停滞情况。',
    fields: [field('opportunityId', '商机编号', ['商机ID', '机会编号']), owner, field('stage', '商机阶段', ['阶段', '状态']), amount, field('updateDate', '更新日期', ['最后跟进日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['owner', 'stage'] }, { type: 'aggregate', field: 'opportunityId', operation: 'count-distinct', as: 'opportunityCount' }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'pipelineAmount' }],
    anomalyRules: [anomaly('STALE_OPPORTUNITY', '商机停滞', 'updateDate', 'deviation', 14, 'warning', '商机超过 14 天未更新')],
    outputMetrics: { opportunityCount: '商机数', pipelineAmount: '管道金额', conversionRate: '转化率' }, defaultGroupBy: ['商机阶段'],
  }),
  defineTemplate({
    code: 'SALES_CUSTOMER_CONTRIBUTION', role: 'sales', name: '客户贡献分析', description: '识别重点客户、收入集中度与客户流失风险。',
    fields: [field('customer', '客户', ['客户名称', '客户编号']), owner, amount, field('orderDate', '订单日期', ['成交日期', '日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['customer', 'owner'] }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'customerRevenue' }, { type: 'aggregate', field: 'orderDate', operation: 'max', as: 'lastOrderDate' }],
    anomalyRules: [anomaly('CUSTOMER_INACTIVE', '客户沉默', 'lastOrderDate', 'deviation', 90, 'warning', '客户超过 90 天未下单')],
    outputMetrics: { customerRevenue: '客户收入', concentration: '收入集中度' }, defaultGroupBy: ['客户'],
  }),
  defineTemplate({
    code: 'SALES_RECEIVABLES_RISK', role: 'sales', name: '销售回款风险', description: '分析应收余额、逾期天数和回款责任人。',
    fields: [field('customer', '客户', ['客户名称']), owner, field('receivable', '应收金额', ['未收金额', '余额'], 'number'), field('dueDate', '到期日期', ['应收日期', '账期截止'], 'date'), field('paidAmount', '已回款金额', ['回款金额'], 'number', false)],
    localOperations: [{ type: 'group', fields: ['owner', 'customer'] }, { type: 'aggregate', field: 'receivable', operation: 'sum', as: 'receivableTotal' }, { type: 'sort', field: 'dueDate', direction: 'asc' }],
    anomalyRules: [anomaly('OVERDUE_RECEIVABLE', '应收逾期', 'dueDate', 'deviation', 0, 'critical', '存在到期未回款应收')],
    outputMetrics: { receivableTotal: '应收余额', overdueAmount: '逾期金额' }, defaultGroupBy: ['销售人员'],
  }),
] as const;
