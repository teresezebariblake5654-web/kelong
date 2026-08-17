import { anomaly, defineTemplate, field } from '../define.js';

const supplier = field('supplier', '供应商', ['供应商名称', '供方']);
const material = field('material', '物料', ['物料名称', '商品', 'SKU']);

export const PROCUREMENT_TASK_TEMPLATES = [
  defineTemplate({
    code: 'PROCUREMENT_SPEND_ANALYSIS', role: 'procurement', name: '采购支出分析', description: '按供应商、品类和物料分析采购金额。',
    fields: [supplier, material, field('category', '采购品类', ['品类', '类别']), field('quantity', '采购数量', ['数量', '订购量'], 'number'), field('amount', '采购金额', ['金额', '含税金额'], 'number')],
    localOperations: [{ type: 'group', fields: ['category', 'supplier'] }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'purchaseAmount' }, { type: 'aggregate', field: 'quantity', operation: 'sum', as: 'purchaseQuantity' }],
    anomalyRules: [anomaly('SPEND_CONCENTRATION', '供应商集中', 'purchaseAmount', 'deviation', 3, 'warning', '采购金额过度集中于单一供应商')],
    outputMetrics: { purchaseAmount: '采购金额', purchaseQuantity: '采购数量', concentration: '供应商集中度' }, defaultGroupBy: ['采购品类'],
  }),
  defineTemplate({
    code: 'PROCUREMENT_PRICE_VARIANCE', role: 'procurement', name: '采购价格差异', description: '比较物料采购单价、基准价和价格波动。',
    fields: [supplier, material, field('unitPrice', '采购单价', ['单价', '含税单价'], 'number'), field('benchmarkPrice', '基准单价', ['标准价', '历史均价'], 'number'), field('date', '采购日期', ['订单日期', '日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['material', 'supplier'] }, { type: 'aggregate', field: 'unitPrice', operation: 'avg', as: 'averagePrice' }, { type: 'derive', as: 'priceVariance', expression: '(averagePrice-benchmarkPrice)/benchmarkPrice', description: '计算价格差异率' }],
    anomalyRules: [anomaly('PRICE_INCREASE', '采购涨价', 'priceVariance', 'gt', 0.1, 'critical', '采购价高于基准价 10%')],
    outputMetrics: { averagePrice: '平均采购价', priceVariance: '价格差异率' }, defaultGroupBy: ['物料'],
  }),
  defineTemplate({
    code: 'PROCUREMENT_SUPPLIER_DELIVERY', role: 'procurement', name: '供应商交付评价', description: '评估供应商准时交付率与延期情况。',
    fields: [supplier, field('orderId', '采购订单', ['采购单号', '订单号']), field('promisedDate', '承诺日期', ['计划到货日'], 'date'), field('actualDate', '实际到货日期', ['收货日期', '到货日'], 'date'), field('receivedQuantity', '到货数量', ['收货数量'], 'number')],
    localOperations: [{ type: 'group', fields: ['supplier'] }, { type: 'aggregate', field: 'orderId', operation: 'count-distinct', as: 'orderCount' }, { type: 'derive', as: 'delayDays', expression: 'actualDate-promisedDate', description: '计算延期天数' }],
    anomalyRules: [anomaly('DELIVERY_LATE', '供应商延期', 'delayDays', 'gt', 0, 'critical', '实际到货晚于承诺日期')],
    outputMetrics: { orderCount: '订单数', onTimeRate: '准时交付率', delayDays: '延期天数' }, defaultGroupBy: ['供应商'],
  }),
  defineTemplate({
    code: 'PROCUREMENT_SUPPLIER_QUALITY', role: 'procurement', name: '供应商质量分析', description: '分析来料合格率、退货和质量问题。',
    fields: [supplier, material, field('receivedQuantity', '到货数量', ['收货数量'], 'number'), field('defectQuantity', '不合格数量', ['缺陷数', '退货数'], 'number'), field('inspectionDate', '检验日期', ['日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['supplier', 'material'] }, { type: 'aggregate', field: 'receivedQuantity', operation: 'sum', as: 'received' }, { type: 'aggregate', field: 'defectQuantity', operation: 'sum', as: 'defects' }, { type: 'derive', as: 'defectRate', expression: 'defects/received', description: '计算不合格率' }],
    anomalyRules: [anomaly('HIGH_DEFECT_RATE', '来料不良偏高', 'defectRate', 'gt', 0.03, 'critical', '来料不合格率超过 3%')],
    outputMetrics: { received: '到货数量', defects: '不合格数', defectRate: '不合格率' }, defaultGroupBy: ['供应商'],
  }),
  defineTemplate({
    code: 'PROCUREMENT_ORDER_PROGRESS', role: 'procurement', name: '采购订单进度', description: '跟踪采购订单未交数量、到期和关闭状态。',
    fields: [supplier, field('orderId', '采购订单', ['采购单号', '订单号']), material, field('orderedQuantity', '订购数量', ['订单数量'], 'number'), field('receivedQuantity', '已到数量', ['收货数量'], 'number'), field('dueDate', '要求到货日', ['交期', '到期日'], 'date')],
    localOperations: [{ type: 'derive', as: 'openQuantity', expression: 'orderedQuantity-receivedQuantity', description: '计算未交数量' }, { type: 'group', fields: ['supplier'] }, { type: 'aggregate', field: 'openQuantity', operation: 'sum', as: 'openQuantity' }],
    anomalyRules: [anomaly('OVERDUE_ORDER', '采购订单逾期', 'dueDate', 'deviation', 0, 'critical', '采购订单到期仍有未交数量')],
    outputMetrics: { openQuantity: '未交数量', overdueCount: '逾期订单数' }, defaultGroupBy: ['供应商'],
  }),
] as const;
