import { anomaly, defineTemplate, field } from '../define.js';

const carrier = field('carrier', '承运商', ['物流商', '运输商']);
const shipment = field('shipmentId', '运单号', ['物流单号', '运输单号']);

export const LOGISTICS_TASK_TEMPLATES = [
  defineTemplate({
    code: 'LOGISTICS_DELAY_SUMMARY', role: 'logistics', name: '物流延误汇总', description: '统计延误单量、承运商与影响范围。',
    fields: [shipment, carrier, field('status', '状态', ['物流状态', '运输状态']), field('promisedDate', '承诺送达日', ['预计送达', '要求到货日'], 'date'), field('actualDate', '实际送达日', ['签收日期', '到货日'], 'date', false)],
    localOperations: [{ type: 'derive', as: 'delayDays', expression: 'actualDate-promisedDate', description: '计算延误天数' }, { type: 'group', fields: ['carrier', 'status'] }, { type: 'aggregate', field: 'shipmentId', operation: 'count-distinct', as: 'shipmentCount' }],
    anomalyRules: [anomaly('SHIPMENT_LATE', '运输延误', 'delayDays', 'gt', 0, 'critical', '运单晚于承诺日期送达')],
    outputMetrics: { shipmentCount: '运单数', delayDays: '延误天数', onTimeRate: '准时率' }, defaultGroupBy: ['承运商'],
  }),
  defineTemplate({
    code: 'LOGISTICS_FREIGHT_COST', role: 'logistics', name: '物流费用分析', description: '按承运商、线路和运输方式分析运费。',
    fields: [shipment, carrier, field('route', '运输线路', ['路线', '始发地-目的地']), field('weight', '计费重量', ['重量', '吨位'], 'number'), field('freight', '运费', ['物流费', '运输费用'], 'number')],
    localOperations: [{ type: 'group', fields: ['carrier', 'route'] }, { type: 'aggregate', field: 'freight', operation: 'sum', as: 'freightTotal' }, { type: 'derive', as: 'costPerWeight', expression: 'freightTotal/weight', description: '计算单位重量运费' }],
    anomalyRules: [anomaly('HIGH_FREIGHT', '运费偏高', 'costPerWeight', 'deviation', 2, 'warning', '单位运费显著偏高')],
    outputMetrics: { freightTotal: '运费合计', costPerWeight: '单位重量运费' }, defaultGroupBy: ['承运商', '运输线路'],
  }),
  defineTemplate({
    code: 'LOGISTICS_CARRIER_SCORECARD', role: 'logistics', name: '承运商绩效评价', description: '综合评价准时率、破损率和投诉。',
    fields: [carrier, shipment, field('onTime', '是否准时', ['准时', '按时送达'], 'boolean'), field('damaged', '是否破损', ['货损', '破损'], 'boolean'), field('complaint', '是否投诉', ['投诉', '客诉'], 'boolean')],
    localOperations: [{ type: 'group', fields: ['carrier'] }, { type: 'aggregate', field: 'shipmentId', operation: 'count-distinct', as: 'shipmentCount' }],
    anomalyRules: [anomaly('DAMAGED_SHIPMENT', '货物破损', 'damaged', 'eq', true, 'critical', '运输过程中发生货损')],
    outputMetrics: { shipmentCount: '运单数', onTimeRate: '准时率', damageRate: '货损率' }, defaultGroupBy: ['承运商'],
  }),
  defineTemplate({
    code: 'LOGISTICS_DELIVERY_COMPLETION', role: 'logistics', name: '配送完成分析', description: '分析配送签收、拒收、失败和重派。',
    fields: [shipment, field('driver', '配送人员', ['司机', '配送员']), field('region', '配送区域', ['区域', '片区']), field('status', '配送状态', ['签收状态', '状态']), field('attempts', '配送次数', ['派送次数', '尝试次数'], 'integer')],
    localOperations: [{ type: 'group', fields: ['region', 'driver', 'status'] }, { type: 'aggregate', field: 'shipmentId', operation: 'count-distinct', as: 'shipmentCount' }, { type: 'aggregate', field: 'attempts', operation: 'avg', as: 'averageAttempts' }],
    anomalyRules: [anomaly('MULTIPLE_ATTEMPTS', '重复配送', 'attempts', 'gt', 2, 'warning', '运单配送尝试超过 2 次')],
    outputMetrics: { shipmentCount: '配送单数', successRate: '签收率', averageAttempts: '平均配送次数' }, defaultGroupBy: ['配送区域'],
  }),
  defineTemplate({
    code: 'LOGISTICS_ROUTE_EFFICIENCY', role: 'logistics', name: '运输线路效率', description: '比较线路里程、耗时、装载率与成本。',
    fields: [field('route', '运输线路', ['路线', '线路名称']), carrier, field('distance', '运输里程', ['里程', '公里数'], 'number'), field('durationHours', '运输时长', ['耗时', '小时'], 'number'), field('loadRate', '装载率', ['满载率', '载重率'], 'number')],
    localOperations: [{ type: 'group', fields: ['route', 'carrier'] }, { type: 'aggregate', field: 'durationHours', operation: 'avg', as: 'averageDuration' }, { type: 'aggregate', field: 'loadRate', operation: 'avg', as: 'averageLoadRate' }],
    anomalyRules: [anomaly('LOW_LOAD', '装载率偏低', 'loadRate', 'lt', 0.7, 'warning', '车辆装载率低于 70%')],
    outputMetrics: { averageDuration: '平均运输时长', averageLoadRate: '平均装载率' }, defaultGroupBy: ['运输线路'],
  }),
] as const;
