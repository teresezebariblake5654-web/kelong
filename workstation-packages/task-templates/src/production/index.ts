import { anomaly, defineTemplate, field } from '../define.js';

const line = field('line', '产线', ['生产线', '车间', '班组']);
const product = field('product', '产品', ['产品名称', '物料', 'SKU']);

/**
 * 生产岗位模板目录：全部为办结工作流入口（额度/名称元数据）。
 * 真实计算见 @aw/task-workflows ProductionWorkflowRegistry。
 * 旧分析模板代码保留映射兼容，不再作为产品主路径。
 */
export const PRODUCTION_TASK_TEMPLATES = [
  defineTemplate({
    code: 'PRODUCTION_MATERIAL_DAILY_CLOSE',
    role: 'production',
    name: '物料日清',
    description: '办结工作流：库存/领退/废料日清，导出结存与补料报废盘点单。实现见 task-workflows material_daily_close。',
    fields: [
      field('materialCode', '物料编码', ['料号', '物料编号'], 'string', false),
      field('material', '物料名称', ['物料', '品名'], 'string'),
      field('warehouse', '仓库', ['库位', '仓位'], 'string', false),
      field('openingQty', '期初库存', ['期初'], 'number'),
      field('outboundQty', '出库数量', ['领料数量'], 'number', false),
      field('physicalQty', '实盘数量', ['实盘'], 'number'),
    ],
    localOperations: [
      { type: 'derive', as: 'theoreticalQty', expression: 'openingQty-outboundQty', description: '目录占位；办结以 task-workflows 为准' },
    ],
    anomalyRules: [anomaly('NEGATIVE_VARIANCE', '盘亏需补料', 'theoreticalQty', 'lt', 0, 'critical', '结存异常')],
    outputMetrics: { replenishCount: '补料行数' },
    reportSections: ['今日物料结存', '补料申请单', '报废待审批单', '盘点差异单', '人工确认清单'],
    defaultGroupBy: ['仓库'],
    creditCost: 25,
  }),
  defineTemplate({
    code: 'PRODUCTION_MATERIAL_VARIANCE_CLOSE',
    role: 'production',
    name: '核对物料消耗',
    description: '办结工作流：BOM 理论消耗 vs 领退实际消耗。taskCode=material_variance_close。',
    fields: [
      product,
      field('material', '物料', ['原料', '物料名称', '物料编码']),
      field('standardUsage', '标准用量', ['定额用量', 'BOM用量'], 'number'),
      field('goodOutput', '合格产量', ['实际产量', '完工数量'], 'number'),
      field('issuedQty', '领料数量', ['领用量'], 'number'),
      field('returnedQty', '退料数量', ['退库数量'], 'number', false),
    ],
    localOperations: [
      { type: 'derive', as: 'usageVariance', expression: '(issuedQty-returnedQty)-(goodOutput*standardUsage)', description: '目录占位' },
    ],
    anomalyRules: [anomaly('EXCESS_USAGE', '物料超耗', 'usageVariance', 'gt', 0.05, 'warning', '实际用量超过理论 5%')],
    outputMetrics: { usageVariance: '消耗差异' },
    reportSections: ['物料消耗差异', '超耗核实单', '异常领料单', '待退料清单', '人工确认清单'],
    defaultGroupBy: ['物料'],
    creditCost: 20,
  }),
  defineTemplate({
    code: 'PRODUCTION_PLAN_CLOSE',
    role: 'production',
    name: '清理生产计划',
    description: '办结工作流：待完成/延期/阻塞/已完成待关闭工单。taskCode=production_plan_close。',
    fields: [
      field('workOrder', '生产工单', ['工单号', '订单号']),
      line,
      product,
      field('plannedQuantity', '计划数量', ['工单数量'], 'number'),
      field('completedQuantity', '完成数量', ['报工数量'], 'number'),
      field('dueDate', '计划完成日', ['交期'], 'date'),
    ],
    localOperations: [
      { type: 'derive', as: 'remainingQuantity', expression: 'plannedQuantity-completedQuantity', description: '目录占位' },
    ],
    anomalyRules: [anomaly('WORK_ORDER_LATE', '工单延期', 'dueDate', 'deviation', 0, 'critical', '到期未完工')],
    outputMetrics: { delayedCount: '延期工单数' },
    reportSections: ['今日待完成工单', '延期工单', '阻塞工单', '已完成待关闭', '生产进度调整清单'],
    defaultGroupBy: ['产线'],
    creditCost: 20,
  }),
  defineTemplate({
    code: 'PRODUCTION_OUTPUT_ATTAINMENT_CLOSE',
    role: 'production',
    name: '办结今日产量',
    description: '办结工作流：产量达成与缺口处理。taskCode=output_attainment_close。',
    fields: [
      line,
      product,
      field('plannedOutput', '计划产量', ['计划数', '目标产量'], 'number'),
      field('actualOutput', '实际产量', ['完成数量', '产量'], 'number'),
    ],
    localOperations: [
      { type: 'derive', as: 'achievementRate', expression: 'actualOutput/plannedOutput', description: '目录占位' },
    ],
    anomalyRules: [anomaly('LOW_OUTPUT', '产量未达标', 'achievementRate', 'lt', 0.9, 'critical', '达成率低于 90%')],
    outputMetrics: { achievementRate: '产量达成率' },
    reportSections: ['今日产量达成明细', '未达成工单', '产量缺口处理单', '人工确认清单'],
    defaultGroupBy: ['产线'],
    creditCost: 20,
  }),
  defineTemplate({
    code: 'PRODUCTION_QUALITY_EXCEPTION_CLOSE',
    role: 'production',
    name: '处理质量异常',
    description: '办结工作流：不良/返工/报废/异常批次。taskCode=quality_exception_close。',
    fields: [
      line,
      product,
      field('batch', '批次', ['生产批次', '批号']),
      field('output', '检验数量', ['生产数量'], 'number'),
      field('defects', '不良数量', ['不合格数'], 'number'),
    ],
    localOperations: [
      { type: 'derive', as: 'defectRate', expression: 'defects/output', description: '目录占位' },
    ],
    anomalyRules: [anomaly('HIGH_DEFECT', '不良率超标', 'defectRate', 'gt', 0.03, 'critical', '不良率超过 3%')],
    outputMetrics: { defectRate: '不良率' },
    reportSections: ['质量异常处置单', '返工任务单', '报废待审批单', '异常批次跟踪单', '人工确认清单'],
    defaultGroupBy: ['产线'],
    creditCost: 20,
  }),
  defineTemplate({
    code: 'PRODUCTION_DOWNTIME_LOSS_CLOSE',
    role: 'production',
    name: '处理停机损失',
    description: '办结工作流：停机损失产量与维修待办。taskCode=downtime_loss_close。',
    fields: [
      line,
      field('equipment', '设备', ['设备名称', '机台']),
      field('reason', '停机原因', ['故障原因']),
      field('downtimeMinutes', '停机分钟', ['停机时长'], 'number'),
    ],
    localOperations: [
      { type: 'aggregate', field: 'downtimeMinutes', operation: 'sum', as: 'downtimeMinutes' },
    ],
    anomalyRules: [anomaly('LONG_DOWNTIME', '长时间停机', 'downtimeMinutes', 'gt', 60, 'critical', '单次停机超过 60 分钟')],
    outputMetrics: { lostOutput: '损失产量' },
    reportSections: ['停机事件明细', '停机损失产量', '设备维修待办', '重复故障跟踪单', '人工确认清单'],
    defaultGroupBy: ['设备'],
    creditCost: 20,
  }),
] as const;
