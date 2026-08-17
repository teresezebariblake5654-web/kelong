import { anomaly, defineTemplate, field } from '../define.js';

const dimension = field('dimension', '分析维度', ['分类', '类别', '分组']);
const value = field('value', '指标值', ['数值', '金额', '数量'], 'number');

export const UNIVERSAL_TASK_TEMPLATES = [
  defineTemplate({
    code: 'UNIVERSAL_DATA_SUMMARY', role: 'universal', name: '通用数据汇总', description: '按指定维度汇总记录数、合计与均值。',
    fields: [dimension, value, field('date', '日期', ['统计日期', '时间'], 'date', false)],
    localOperations: [{ type: 'group', fields: ['dimension'] }, { type: 'aggregate', field: 'value', operation: 'sum', as: 'total' }, { type: 'aggregate', field: 'value', operation: 'avg', as: 'average' }, { type: 'aggregate', field: 'value', operation: 'count', as: 'count' }],
    anomalyRules: [anomaly('MISSING_VALUE', '指标缺失', 'value', 'missing', true, 'warning', '存在空指标值')],
    outputMetrics: { total: '合计值', average: '平均值', count: '记录数' }, defaultGroupBy: ['分析维度'],
  }),
  defineTemplate({
    code: 'UNIVERSAL_ANOMALY_SCAN', role: 'universal', name: '通用异常扫描', description: '扫描缺失、重复、极值与统计偏离。',
    fields: [field('recordId', '记录编号', ['ID', '编号', '主键']), dimension, value],
    localOperations: [{ type: 'deduplicate', fields: ['recordId'], keep: 'last' }, { type: 'group', fields: ['dimension'] }, { type: 'aggregate', field: 'value', operation: 'avg', as: 'average' }],
    anomalyRules: [anomaly('DUPLICATE_ID', '重复记录', 'recordId', 'duplicate', true, 'critical', '记录编号重复'), anomaly('VALUE_OUTLIER', '数值离群', 'value', 'deviation', 3, 'warning', '指标值偏离分组均值 3 个标准差')],
    outputMetrics: { duplicateCount: '重复记录数', outlierCount: '离群值数量' }, defaultGroupBy: ['分析维度'],
  }),
  defineTemplate({
    code: 'UNIVERSAL_TREND_ANALYSIS', role: 'universal', name: '通用趋势分析', description: '按时间观察指标趋势、环比和突变。',
    fields: [field('date', '日期', ['统计日期', '时间'], 'date'), dimension, value],
    localOperations: [{ type: 'group', fields: ['date', 'dimension'] }, { type: 'aggregate', field: 'value', operation: 'sum', as: 'periodValue' }, { type: 'sort', field: 'date', direction: 'asc' }],
    anomalyRules: [anomaly('TREND_BREAK', '趋势突变', 'periodValue', 'deviation', 2, 'warning', '期间指标发生显著突变')],
    outputMetrics: { periodValue: '期间指标值', growthRate: '环比变化率' }, defaultGroupBy: ['日期'],
  }),
  defineTemplate({
    code: 'UNIVERSAL_GROUP_COMPARISON', role: 'universal', name: '通用分组对比', description: '比较不同分类的规模、均值和占比。',
    fields: [dimension, value, field('secondaryDimension', '次级维度', ['子分类', '二级分类'], 'string', false)],
    localOperations: [{ type: 'group', fields: ['dimension', 'secondaryDimension'] }, { type: 'aggregate', field: 'value', operation: 'sum', as: 'groupTotal' }, { type: 'aggregate', field: 'value', operation: 'avg', as: 'groupAverage' }, { type: 'sort', field: 'groupTotal', direction: 'desc' }],
    anomalyRules: [anomaly('GROUP_OUTLIER', '分组异常', 'groupAverage', 'deviation', 2, 'info', '分组均值显著偏离总体')],
    outputMetrics: { groupTotal: '分组合计', groupAverage: '分组均值', share: '分组占比' }, defaultGroupBy: ['分析维度'],
  }),
  defineTemplate({
    code: 'UNIVERSAL_DATA_QUALITY', role: 'universal', name: '通用数据质量检查', description: '检查关键字段完整性、唯一性和格式。',
    fields: [field('recordId', '记录编号', ['ID', '编号', '主键']), field('requiredValue', '关键字段', ['必填字段', '检查字段']), field('date', '日期', ['时间', '业务日期'], 'date', false)],
    localOperations: [{ type: 'deduplicate', fields: ['recordId'], keep: 'last' }, { type: 'aggregate', field: 'recordId', operation: 'count', as: 'recordCount' }],
    anomalyRules: [anomaly('DUPLICATE_RECORD', '重复记录', 'recordId', 'duplicate', true, 'critical', '记录编号重复'), anomaly('REQUIRED_MISSING', '必填缺失', 'requiredValue', 'missing', true, 'critical', '关键字段为空')],
    outputMetrics: { recordCount: '记录数', completeness: '完整率', duplicateRate: '重复率' },
  }),
] as const;
