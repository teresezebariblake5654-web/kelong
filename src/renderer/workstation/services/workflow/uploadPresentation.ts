import type { WorkflowDefinition } from '@aw/shared';
import type { DepartmentWorkflowCategory } from './departmentCatalog';

export type WorkflowDataHint = {
  title: string;
  purpose: string;
  fields: string[];
  optional: boolean;
};

const CATEGORY_COPY: Record<DepartmentWorkflowCategory, { title: string; description: string }> = {
  hr: {
    title: '上传员工相关文件',
    description: '上传本月员工相关数据，AI 会自动识别员工、考勤、请假、加班、工资等信息。',
  },
  production: {
    title: '上传生产数据文件',
    description: '上传生产计划、生产记录、物料库存、质量或设备数据，AI 会自动识别并匹配当前工作模式。',
  },
  finance: {
    title: '上传财务相关文件',
    description: '上传订单、发票、费用明细、银行流水或报销记录，AI 只做整理、分析和异常识别。',
  },
  logistics: {
    title: '上传物流文件',
    description: '上传库存、订单、出入库记录或物流轨迹，AI 会自动识别业务数据。',
  },
  ecommerce: {
    title: '上传订单数据',
    description: '支持淘宝、抖音、京东、拼多多导出数据，AI 会自动识别订单、商品、SKU、退款和平台字段。',
  },
  admin: {
    title: '上传行政业务文件',
    description: '上传资产、费用、会议室、合同等业务数据，AI 会自动识别并匹配当前工作模式。',
  },
};

const FIELD_LABELS: Record<string, string> = {
  employeeId: '工号 / 员工ID', employeeName: '姓名', department: '部门', position: '岗位',
  employmentStatus: '在职状态', hireDate: '入职日期', terminationDate: '离职日期',
  date: '日期', punchTime: '打卡时间', shiftStart: '上班时间', shiftEnd: '下班时间',
  leaveType: '请假类型', hours: '时长', overtimeHours: '加班时长', amount: '金额',
  materialCode: '物料编码', materialName: '物料名称', warehouse: '仓库', qty: '数量',
  productCode: '产品编码', workOrderNo: '工单号', planNo: '计划号', dueDate: '交期',
  inspectionNo: '检验单号', item: '检验项目', result: '检验结果', reason: '原因',
  orderNo: '订单号', sku: 'SKU', productName: '商品名称', platform: '平台',
  refundNo: '退款单号', refundAmount: '退款金额', trackingNo: '运单号', status: '状态',
  expenseId: '费用 / 报销单号', counterparty: '交易对方', documentNo: '单据号',
  invoiceNo: '发票号码', businessUnit: '业务单元', revenue: '收入', cost: '成本',
  customerId: '客户编号', contractNo: '合同编号', paymentNo: '收付款编号',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function workflowUploadCopy(category: DepartmentWorkflowCategory) {
  return CATEGORY_COPY[category];
}

export function workflowDataHints(definition: WorkflowDefinition): WorkflowDataHint[] {
  return definition.inputRoles.map((role) => ({
    title: role.description || role.role,
    purpose: role.required ? '用于完成当前工作模式的核心分析' : '用于补充分析并提高结果完整度',
    fields: role.requiredFields.slice(0, 6).map(fieldLabel),
    optional: !role.required,
  }));
}

export function workflowDataHintSummary(definition: WorkflowDefinition): string {
  return workflowDataHints(definition)
    .map((hint) => `${hint.title}${hint.optional ? '（可选）' : ''}`)
    .join('、');
}
