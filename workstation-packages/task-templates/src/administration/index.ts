import { anomaly, defineTemplate, field } from '../define.js';

const department = field('department', '部门', ['使用部门', '归属部门']);

export const ADMINISTRATION_TASK_TEMPLATES = [
  defineTemplate({
    code: 'ADMIN_ASSET_INVENTORY', role: 'administration', name: '行政资产盘点', description: '核对固定资产归属、状态与盘点差异。',
    fields: [field('assetId', '资产编号', ['资产ID', '标签号']), field('assetName', '资产名称', ['设备名称', '物品']), department, field('status', '资产状态', ['状态', '使用状态']), field('inventoryDate', '盘点日期', ['日期'], 'date')],
    localOperations: [{ type: 'deduplicate', fields: ['assetId'], keep: 'last' }, { type: 'group', fields: ['department', 'status'] }, { type: 'aggregate', field: 'assetId', operation: 'count-distinct', as: 'assetCount' }],
    anomalyRules: [anomaly('ASSET_DUPLICATE', '资产重复', 'assetId', 'duplicate', true, 'critical', '资产编号重复'), anomaly('ASSET_MISSING', '资产缺失', 'status', 'eq', '盘亏', 'critical', '盘点资产缺失')],
    outputMetrics: { assetCount: '资产数量', discrepancyCount: '盘点差异数' }, defaultGroupBy: ['部门'],
  }),
  defineTemplate({
    code: 'ADMIN_EXPENSE_ANALYSIS', role: 'administration', name: '行政费用分析', description: '按部门和费用类别分析预算执行。',
    fields: [department, field('category', '费用类别', ['科目', '报销类型']), field('amount', '金额', ['费用', '报销金额'], 'number'), field('budget', '预算', ['预算金额'], 'number', false), field('date', '发生日期', ['报销日期', '日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['department', 'category'] }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'actualAmount' }, { type: 'derive', as: 'budgetVariance', expression: 'actualAmount-budget', description: '计算预算差异' }],
    anomalyRules: [anomaly('OVER_BUDGET', '预算超支', 'budgetVariance', 'gt', 0, 'critical', '行政费用超过预算')],
    outputMetrics: { actualAmount: '实际费用', budgetVariance: '预算差异' }, defaultGroupBy: ['部门', '费用类别'],
  }),
  defineTemplate({
    code: 'ADMIN_MEETING_UTILIZATION', role: 'administration', name: '会议室利用率', description: '统计会议室使用、取消和空置情况。',
    fields: [field('room', '会议室', ['会议室名称', '地点']), department, field('startTime', '开始时间', ['会议开始'], 'datetime'), field('endTime', '结束时间', ['会议结束'], 'datetime'), field('status', '预订状态', ['状态', '使用状态'])],
    localOperations: [{ type: 'group', fields: ['room', 'status'] }, { type: 'aggregate', field: 'room', operation: 'count', as: 'bookingCount' }, { type: 'derive', as: 'durationHours', expression: '(endTime-startTime)/3600000', description: '计算使用时长' }],
    anomalyRules: [anomaly('NO_SHOW', '预订未使用', 'status', 'eq', '未使用', 'warning', '会议室预订后未使用')],
    outputMetrics: { bookingCount: '预订次数', durationHours: '使用时长', utilization: '利用率' }, defaultGroupBy: ['会议室'],
  }),
  defineTemplate({
    code: 'ADMIN_CONTRACT_EXPIRY', role: 'administration', name: '合同到期提醒', description: '汇总行政合同金额、到期与续签风险。',
    fields: [field('contractId', '合同编号', ['合同ID', '编号']), field('vendor', '合同方', ['供应商', '签约方']), field('amount', '合同金额', ['金额', '总价'], 'number'), field('expiryDate', '到期日期', ['终止日期', '合同截止日'], 'date'), field('status', '合同状态', ['状态'])],
    localOperations: [{ type: 'group', fields: ['status', 'vendor'] }, { type: 'aggregate', field: 'amount', operation: 'sum', as: 'contractAmount' }, { type: 'sort', field: 'expiryDate', direction: 'asc' }],
    anomalyRules: [anomaly('EXPIRING_SOON', '即将到期', 'expiryDate', 'deviation', 30, 'critical', '合同将在 30 天内到期')],
    outputMetrics: { contractAmount: '合同金额', expiringCount: '即将到期数量' }, defaultGroupBy: ['合同状态'],
  }),
] as const;
