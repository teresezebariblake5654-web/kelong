import { dataEngine, matchCanonicalField, normalizeHeaderKey, type FieldAliasMap } from '@aw/data-engine';
import { getWorkflowDefinition } from '@aw/task-templates';
import {
  getFileExtension,
  isAllowedSpreadsheetExtension,
  isAllowedWorkflowInputExtension,
} from './pathSafety';
import { maskedSampleForField } from './sensitiveData';
import { checkWorkflowInputCapability, isImageOrPdfExtension } from './workflowCapabilities';
import { DesktopBridgeError, type InspectedInputFile } from './types';

export const WORKFLOW_ROLE_ALIASES: Record<string, FieldAliasMap> = {
  opening_stock: {
    materialCode: ['物料编码', '料号', '物料号', '编码', '物料代码', 'material_code', 'sku'],
    materialName: ['物料名称', '品名', '名称', '物料名', 'material_name'],
    warehouse: ['仓库', '仓位', '库位', '仓库名称', 'warehouse'],
    openingQty: ['期初', '期初数量', '期初库存', 'opening', 'opening_qty', '期初结存'],
    unit: ['单位', '计量单位', 'unit'],
  },
  movements: {
    date: ['日期', '业务日期', '单据日期', 'date', '交易日期'],
    materialCode: ['物料编码', '料号', '物料号', '编码', '物料代码', 'material_code', 'sku'],
    warehouse: ['仓库', '仓位', '库位', '仓库名称', 'warehouse'],
    movementType: ['类型', '出入库类型', '业务类型', '移动类型', 'movement_type', '单据类型'],
    qty: ['数量', 'qty', 'quantity', '出入库数量'],
  },
  physical_count: {
    materialCode: ['物料编码', '料号', '物料号', '编码', '物料代码', 'material_code', 'sku'],
    warehouse: ['仓库', '仓位', '库位', '仓库名称', 'warehouse'],
    actualQty: ['实盘', '实盘数量', '盘点数量', 'actual', 'actual_qty', '账面实盘'],
  },
  bom: {
    productCode: ['产品编码', '成品编码', '父件编码', 'product_code', 'sku'],
    materialCode: ['物料编码', '子件编码', '料号', 'material_code'],
    qtyPer: ['单位用量', '用量', '单耗', 'qty_per', '用量标准'],
  },
  production_output: {
    productCode: ['产品编码', '成品编码', 'product_code'],
    qty: ['产量', '合格数量', '产出数量', 'qty', 'quantity'],
    workOrderNo: ['工单号', '生产单号', 'work_order', 'wo'],
  },
  material_issue: {
    materialCode: ['物料编码', '料号', 'material_code'],
    qty: ['数量', '领料数量', 'qty'],
    workOrderNo: ['工单号', '生产单号', 'work_order', 'wo'],
  },
  plan: {
    planNo: ['计划号', '计划编号', 'plan_no'],
    productCode: ['产品编码', '成品编码', 'product_code'],
    qty: ['计划数量', '数量', 'qty'],
    dueDate: ['交期', '计划完工日', 'due_date', '完工日期'],
  },
  work_report: {
    workOrderNo: ['工单号', '生产单号', 'work_order'],
    qty: ['报工数量', '完工数量', 'qty'],
    date: ['日期', '报工日期', 'date'],
  },
  work_calendar: {
    date: ['日期', 'date'],
    isWorkday: ['是否工作日', '工作日', 'is_workday'],
  },
  inspection: {
    inspectionNo: ['检验单号', '检验编号', 'inspection_no'],
    date: ['检验日期', '日期', 'date'],
    productCode: ['产品编码', '成品编码', 'product_code'],
    lotNo: ['批次号', '批号', 'lot', 'lot_no'],
    workOrderNo: ['工单号', '生产单号', 'work_order'],
    item: ['检验项目', '项目', 'item'],
    result: ['结果', '检验结果', 'result'],
  },
  quality_standard: {
    productCode: ['产品编码', '成品编码', 'product_code'],
    item: ['检验项目', '项目', 'item'],
    lowerLimit: ['下限', '规格下限', 'lower_limit', 'LSL'],
    upperLimit: ['上限', '规格上限', 'upper_limit', 'USL'],
  },
  downtime: {
    workOrderNo: ['工单号', '生产单号', 'work_order'],
    startAt: ['开始时间', '停机开始', 'start_at'],
    endAt: ['结束时间', '停机结束', 'end_at'],
    reason: ['原因', '停机原因', 'reason'],
  },
  work_order: {
    workOrderNo: ['工单号', '生产单号', 'work_order'],
    productCode: ['产品编码', 'product_code'],
    qty: ['数量', '计划数量', 'qty'],
  },
  employee_master: {
    employeeId: ['工号', '员工编号', 'employee_id', 'emp_id'],
    employeeName: ['姓名', '员工姓名', 'employee_name'],
    department: ['部门', 'department'],
    employmentStatus: ['在职状态', '状态', 'employment_status'],
    hireDate: ['入职日期', 'hire_date'],
  },
  salary_standard: {
    employeeId: ['工号', '员工编号', 'employee_id'],
    baseSalary: ['基本工资', '底薪', 'base_salary'],
  },
  attendance_summary: {
    employeeId: ['工号', '员工编号', 'employee_id'],
    payableDays: ['应出勤天数', '应出勤', 'payable_days', 'workDays', '出勤天数'],
    attendedDays: ['实出勤天数', '实出勤', 'attended_days'],
    absenceDays: ['缺勤天数', '缺勤', 'absence_days'],
    overtimeHours: ['加班小时', '加班时长', 'overtime_hours'],
    lateMinutes: ['迟到分钟', '迟到', 'late_minutes'],
  },
  adjustments: {
    employeeId: ['工号', '员工编号'],
    itemName: ['项目', '调整项', 'item_name'],
    amount: ['金额', 'amount'],
    direction: ['方向', '加减', 'direction'],
  },
  social_tax: {
    employeeId: ['工号', '员工编号'],
    employeeSocial: ['个人社保', 'employee_social'],
    employeeFund: ['个人公积金', 'employee_fund'],
    personalTax: ['个税', 'personal_tax'],
  },
  schedule: {
    employeeId: ['工号', '员工编号'],
    date: ['日期', 'date'],
    shiftStart: ['上班时间', '班次开始', 'shift_start'],
    shiftEnd: ['下班时间', '班次结束', 'shift_end'],
  },
  punch: {
    employeeId: ['工号', '员工编号'],
    punchTime: ['打卡时间', 'punch_time', '时间'],
  },
  leave: {
    employeeId: ['工号', '员工编号'],
    date: ['日期', 'date'],
    leaveType: ['请假类型', 'leave_type'],
    hours: ['小时', '时长', 'hours'],
  },
  employee_files: {
    employeeId: ['工号', '员工编号', 'employee_id'],
    employeeName: ['姓名', '员工姓名'],
    department: ['部门'],
    hireDate: ['入职日期'],
    employmentStatus: ['在职状态', '状态'],
  },
  employee_changes: {
    employeeId: ['工号', '员工编号'],
    employeeName: ['姓名'],
    changeType: ['变动类型', 'change_type'],
    effectiveDate: ['生效日期', 'effective_date'],
    department: ['部门'],
    position: ['岗位', '职位'],
  },
  task_template: {
    changeType: ['变动类型'],
    department: ['部门'],
    taskName: ['任务名称', 'task_name'],
    ownerRole: ['负责人角色', 'owner_role'],
    dueOffsetDays: ['截止偏移天', 'due_offset_days'],
  },
  declared_base: {
    employeeId: ['工号'],
    insuranceBase: ['社保基数', 'insurance_base'],
    fundBase: ['公积金基数', 'fund_base'],
  },
  payment_detail: {
    employeeId: ['工号'],
    insuranceAmount: ['社保金额', 'insurance_amount'],
    fundAmount: ['公积金金额', 'fund_amount'],
    paymentMonth: ['缴费月', 'payment_month'],
  },
  candidates: {
    candidateId: ['候选人编号', 'candidate_id'],
    position: ['职位', '岗位'],
    source: ['来源', 'source'],
    stage: ['阶段', 'stage'],
    stageDate: ['阶段日期', 'stage_date'],
  },
  performance: {
    employeeId: ['工号'],
    department: ['部门'],
    level: ['职级', 'level'],
    score: ['分数', 'score'],
    rating: ['评级', 'rating'],
    cycle: ['周期', 'cycle'],
  },
  expense: {
    expenseId: ['费用编号', '报销单号', 'expense_id', 'expenseId'],
    date: ['日期', '报销日期', 'date', 'transactionDate'],
    employeeOrVendor: ['报销人', '供应商', '对方', 'counterparty', 'employeeOrVendor'],
    amount: ['金额', 'amount', '发生额'],
    description: ['说明', '摘要', 'description', 'summary'],
    taxAmount: ['税额', 'tax', 'taxAmount'],
    expenseType: ['费用类型', 'expense_type', 'expenseType'],
    businessUnit: ['业务单元', '事业部', 'business_unit', 'businessUnit'],
  },
  expense_policy: {
    expenseType: ['费用类型', 'expense_type'],
    limitAmount: ['限额', '标准金额', 'limit_amount', 'limitAmount'],
    receiptRequired: ['需要发票', 'receipt_required', 'receiptRequired'],
  },
  mapping: {
    keyword: ['关键词', 'keyword'],
    accountCode: ['科目代码', '科目', 'account_code', 'accountCode'],
    department: ['部门', 'department'],
    project: ['项目', 'project'],
  },
  bank_statement: {
    transactionId: ['流水号', '交易号', 'transaction_id', 'transactionId'],
    date: ['日期', '交易日期', 'date', 'transactionDate'],
    amount: ['金额', 'amount'],
    counterparty: ['对方户名', '对方', 'counterparty'],
    summary: ['摘要', 'summary', 'description'],
    documentNo: ['单据号', 'document_no', 'documentNo'],
  },
  ledger: {
    documentNo: ['单据号', '凭证号', 'document_no', 'documentNo'],
    date: ['日期', '记账日期', 'date', 'transactionDate'],
    amount: ['金额', 'amount'],
    counterparty: ['往来单位', '对方', 'counterparty'],
    status: ['状态', 'status'],
  },
  open_items: {
    documentNo: ['单据号', 'document_no', 'documentNo'],
    partyCode: ['往来编码', 'party_code', 'partyCode'],
    partyName: ['往来名称', '对方', 'counterparty', 'party_name', 'partyName'],
    documentType: ['单据类型', 'document_type', 'documentType'],
    invoiceDate: ['开票日期', 'invoice_date', 'invoiceDate'],
    dueDate: ['到期日', 'due_date', 'dueDate'],
    originalAmount: ['原币金额', 'original_amount', 'originalAmount'],
    openAmount: ['未结金额', 'open_amount', 'openAmount', 'amount'],
  },
  payments: {
    paymentNo: ['付款单号', 'payment_no', 'paymentNo', 'documentNo'],
    partyCode: ['往来编码', 'party_code'],
    amount: ['金额', 'amount'],
    paymentDate: ['付款日期', 'payment_date', 'date', 'transactionDate'],
  },
  invoice_files: {
    filePathOrRow: ['文件', 'file', 'path', 'filePathOrRow'],
    invoiceNo: ['发票号码', '发票号', 'invoice_no', 'invoiceNo'],
    invoiceCode: ['发票代码', 'invoice_code', 'invoiceCode'],
    invoiceDate: ['开票日期', 'invoice_date', 'invoiceDate', 'date'],
    amount: ['金额', '不含税金额', 'amount'],
    taxAmount: ['税额', 'tax', 'taxAmount'],
    totalAmount: ['价税合计', '合计', 'total_amount', 'totalAmount'],
    sellerName: ['销方名称', '销售方', 'seller_name', 'counterparty'],
    sellerTaxId: ['销方税号', 'seller_tax_id'],
  },
  purchase_records: {
    purchaseNo: ['采购单号', 'purchase_no', 'purchaseNo', 'documentNo'],
    vendorName: ['供应商', 'vendor', 'counterparty', 'vendorName'],
    amount: ['金额', 'amount'],
    taxAmount: ['税额', 'taxAmount'],
  },
  revenue: {
    date: ['日期', 'date', 'transactionDate'],
    businessUnit: ['业务单元', '事业部', 'business_unit', 'businessUnit'],
    productOrChannel: ['产品', '渠道', 'product', 'channel', 'productOrChannel'],
    revenue: ['收入', 'revenue', 'amount'],
  },
  cost: {
    date: ['日期', 'date', 'transactionDate'],
    businessUnit: ['业务单元', '事业部', 'business_unit', 'businessUnit'],
    productOrChannel: ['产品', '渠道', 'productOrChannel'],
    cost: ['成本', 'cost', 'amount'],
  },
  cash_collection: {
    date: ['日期', 'date', 'transactionDate'],
    businessUnit: ['业务单元', 'businessUnit'],
    amount: ['回款', '回款金额', 'cash', 'amount', 'cashAmount'],
    cashAmount: ['回款', '回款金额', 'cash', 'amount', 'cashAmount'],
  },
  budget: {
    period: ['期间', 'period'],
    businessUnit: ['业务单元', 'businessUnit'],
    metric: ['指标', 'metric'],
    budgetAmount: ['预算', 'budget', 'amount', 'budgetAmount'],
  },
};

const COMMON_FIELD_ALIASES: FieldAliasMap = {
  employeeId: ['工号', '员工编号', '人员编号', '员工ID', '人员ID'], employeeName: ['姓名', '员工姓名', '人员姓名'],
  department: ['部门', '所属部门'], position: ['岗位', '职位'], employmentStatus: ['在职状态', '员工状态', '状态'],
  hireDate: ['入职日期', '入职时间'], terminationDate: ['离职日期', '离职时间'], date: ['日期', '业务日期'],
  workDays: ['应出勤天数', '出勤天数', '工作天数'], absenceDays: ['缺勤天数', '缺勤'],
  overtimeHours: ['加班小时', '加班时长'], lateMinutes: ['迟到分钟', '迟到时长'], punchTime: ['打卡时间', '考勤时间'],
  shiftStart: ['上班时间', '班次开始'], shiftEnd: ['下班时间', '班次结束'], leaveType: ['请假类型', '休假类型'],
  hours: ['小时', '时长'], baseSalary: ['基本工资', '底薪'], itemName: ['项目', '调整项'], amount: ['金额', '发生额'],
  direction: ['方向', '加减'], employeeSocial: ['个人社保'], employeeFund: ['个人公积金'], personalTax: ['个税', '个人所得税'],
  materialCode: ['物料编码', '料号', '物料号'], materialName: ['物料名称', '品名'], warehouse: ['仓库', '仓位'],
  openingQty: ['期初数量', '期初库存'], movementType: ['出入库类型', '业务类型', '类型'], qty: ['数量'], actualQty: ['实盘数量', '盘点数量'],
  productCode: ['产品编码', '成品编码'], unitUsage: ['单位用量', '标准用量', '单耗'], workOrderNo: ['工单号', '生产单号'],
  goodQty: ['合格数量', '良品数量', '产量'], issueQty: ['领料数量', '实际用量'], planNo: ['计划号', '计划编号'],
  planQty: ['计划数量'], orderNo: ['订单号', '订单编号'], orderQty: ['订单数量'], dueDate: ['交期', '到期日'],
  availableQty: ['可用库存', '可用数量'], lineCode: ['产线编码', '产线'], availableHours: ['可用工时'], unitsPerHour: ['每小时产能', '小时产能'],
  startDate: ['开始日期', '开工日期'], reportDate: ['报工日期'], scrapQty: ['报废数量'], workHours: ['工时'], isWorkday: ['是否工作日', '工作日'],
  inspectionNo: ['检验单号', '检验编号'], lotNo: ['批次号', '批号'], item: ['检验项目', '项目'], result: ['检验结果', '结果'],
  lowerLimit: ['规格下限', '下限'], upperLimit: ['规格上限', '上限'], machineCode: ['设备编码', '机器编码'],
  startTime: ['开始时间'], endTime: ['结束时间'], reason: ['原因'], status: ['状态'], standardQty: ['标准数量'], openIssueCount: ['未关闭问题数'],
  changeType: ['变动类型'], effectiveDate: ['生效日期'], taskName: ['任务名称'], ownerRole: ['负责人角色'], dueOffsetDays: ['截止偏移天'], completedAt: ['完成时间'],
  insuranceBase: ['社保基数'], fundBase: ['公积金基数'], insuranceAmount: ['社保金额'], fundAmount: ['公积金金额'], paymentMonth: ['缴费月'],
  candidateId: ['候选人编号'], source: ['来源'], stage: ['阶段'], stageDate: ['阶段日期'], plannedHeadcount: ['计划招聘人数'], targetDate: ['目标日期'],
  level: ['职级'], score: ['分数', '绩效分数'], rating: ['评级', '绩效评级'], cycle: ['周期'], groupKey: ['分组键'], targetMinRate: ['目标最低比例'], targetMaxRate: ['目标最高比例'],
  expenseId: ['费用编号', '报销单号'], employeeOrVendor: ['报销人', '供应商', '交易对方'], description: ['说明', '摘要'], businessUnit: ['业务单元', '事业部'], expenseType: ['费用类型'],
  limitAmount: ['限额', '标准金额'], receiptRequired: ['是否需要发票', '需要发票'], keyword: ['关键词'], accountCode: ['科目代码', '科目'], project: ['项目'],
  transactionId: ['流水号', '交易号'], counterparty: ['交易对方', '对方户名', '往来单位'], summary: ['摘要'], documentNo: ['单据号', '凭证号'],
  partyCode: ['往来编码'], partyName: ['往来名称'], documentType: ['单据类型'], invoiceDate: ['开票日期'], originalAmount: ['原币金额'], openAmount: ['未结金额'],
  paymentNo: ['付款单号', '收付款编号'], paymentDate: ['付款日期'], referenceNo: ['关联单号'], filePathOrRow: ['文件', '发票文件'], invoiceNo: ['发票号码', '发票号'],
  purchaseNo: ['采购单号'], vendorName: ['供应商'], taxAmount: ['税额'], productOrChannel: ['产品', '渠道'], revenue: ['收入'], cost: ['成本'], cashAmount: ['回款金额', '回款'],
  period: ['期间'], metric: ['指标'], budgetAmount: ['预算金额', '预算'], sku: ['SKU', '商品编码'], orderTime: ['下单时间', '订单时间'], itemAmount: ['商品金额'],
  orderAmount: ['订单金额'], paymentStatus: ['支付状态'], fulfillmentStatus: ['履约状态', '发货状态'], paidAmount: ['实付金额'], paymentMethod: ['支付方式'],
  productName: ['商品名称'], weight: ['重量'], refundNo: ['退款单号'], refundAmount: ['退款金额'], refundTime: ['退款时间'], refundStatus: ['退款状态'], refundReason: ['退款原因'], refundDate: ['退款日期'],
  returnNo: ['退货单号'], returnQty: ['退货数量'], restockStatus: ['入库状态'], productId: ['商品ID'], price: ['价格'], inventoryValue: ['库存金额'], onHand: ['现有库存', '账面库存'], safetyStock: ['安全库存'],
  salesQty: ['销售数量'], salesAmount: ['销售金额'], platform: ['平台'], liveSessionId: ['直播场次ID', '场次ID'], orderStatus: ['订单状态'],
  shop: ['店铺'], grossSales: ['销售总额'], discount: ['优惠金额'], shipping: ['运费'], tax: ['税费'], unitCost: ['单位成本'],
  assetCode: ['资产编码'], assetName: ['资产名称'], category: ['分类', '类别'], custodian: ['保管人', '责任人'], location: ['位置', '存放地点'], actualLocation: ['实盘位置'], actualCustodian: ['实盘保管人'], actualStatus: ['实盘状态'], countDate: ['盘点日期'], countedQty: ['盘点数量'],
  warrantyEndDate: ['质保到期日'], nextMaintenanceDate: ['下次维保日期'], vendor: ['供应商'], headcount: ['人数'], roomId: ['会议室编号'], roomName: ['会议室名称'], capacity: ['容量'],
  availableStart: ['可用开始时间'], availableEnd: ['可用结束时间'], eventId: ['预约编号', '事件ID'], attendeeCount: ['参会人数'], checkinTime: ['签到时间'], checkoutTime: ['签退时间'],
  contractNo: ['合同编号'], contractName: ['合同名称'], endDate: ['结束日期', '到期日期'], owner: ['负责人'], milestoneName: ['节点名称'],
  asOfDate: ['库存日期'], docNo: ['单据号'], moveDate: ['出入库日期'], trackingNo: ['运单号'], carrier: ['承运商'], shipDate: ['发货日期'], eta: ['预计到达时间'], eventTime: ['轨迹时间'],
  avgDailySales: ['日均销量'], transferNo: ['调拨单号'], fromWarehouse: ['调出仓库'], toWarehouse: ['调入仓库'],
};

export function workflowAliasesForRole(role: string, requiredFields: string[]): FieldAliasMap {
  const base = WORKFLOW_ROLE_ALIASES[role] ?? {};
  const merged: FieldAliasMap = { ...base };
  for (const field of requiredFields) {
    merged[field] = [...new Set([...(COMMON_FIELD_ALIASES[field] ?? []), ...(base[field] ?? []), field])];
  }
  return merged;
}
function aliasesForRole(role: string, requiredFields: string[]): FieldAliasMap {
  return workflowAliasesForRole(role, requiredFields);
}

export async function inspectSpreadsheetBytes(input: {
  workflowId: string;
  role: string;
  bytes: Uint8Array;
  fileName: string;
}): Promise<InspectedInputFile> {
  const definition = getWorkflowDefinition(input.workflowId);
  if (!definition) {
    throw new DesktopBridgeError('WORKFLOW_NOT_FOUND', `未找到工作流：${input.workflowId}`);
  }
  const roleSpec = definition.inputRoles.find((r) => r.role === input.role);
  if (!roleSpec) {
    throw new DesktopBridgeError('MISSING_REQUIRED_ROLE', `工作流不包含输入角色：${input.role}`);
  }

  const ext = getFileExtension(input.fileName);
  if (isImageOrPdfExtension(ext)) {
    const capability = checkWorkflowInputCapability({
      workflowId: input.workflowId,
      role: input.role,
      fileName: input.fileName,
      extension: ext,
    });
    return {
      role: input.role,
      fileName: input.fileName,
      fileCount: 1,
      sheetName: '—',
      rowCount: 0,
      recognizedFields: [],
      missingRequiredFields: roleSpec.requiredFields,
      aliasMappings: [],
      fieldPreviews: roleSpec.requiredFields.map((field) => ({
        field,
        dataType: 'binary',
        recognized: false,
        maskedSample: '需 OCR',
      })),
      canRunRole: false,
      parseError: capability.message,
    };
  }

  if (!isAllowedSpreadsheetExtension(ext) && !isAllowedWorkflowInputExtension(ext)) {
    throw new DesktopBridgeError(
      'UNSUPPORTED_FORMAT',
      `不支持的文件格式：.${ext || '未知'}（请使用 xlsx/xls/csv）`,
    );
  }
  if (!isAllowedSpreadsheetExtension(ext)) {
    throw new DesktopBridgeError(
      'UNSUPPORTED_FORMAT',
      `不支持的文件格式：.${ext || '未知'}（请使用 xlsx/xls/csv）`,
    );
  }

  try {
    const workbook = dataEngine.parseFile(input.bytes, input.fileName);
    const sheet = workbook.sheets[0];
    if (!sheet) {
      throw new DesktopBridgeError('EXCEL_CORRUPT', '文件中没有可用的数据表');
    }

    const headers = sheet.headers?.length
      ? sheet.headers
      : Object.keys(sheet.rows[0] ?? {}).map(String);
    const aliases = aliasesForRole(input.role, roleSpec.requiredFields);
    const aliasMappings: Array<{ canonical: string; header: string }> = [];
    const recognizedFields: string[] = [];

    for (const header of headers) {
      const canonical = matchCanonicalField(String(header), aliases);
      if (canonical) {
        recognizedFields.push(canonical);
        if (normalizeHeaderKey(String(header)) !== normalizeHeaderKey(canonical)) {
          aliasMappings.push({ canonical, header: String(header) });
        }
      }
    }

    const uniqueRecognized = [...new Set(recognizedFields)];
    // invoice_files catalog uses placeholder filePathOrRow — structured rows count as ready
    const missingRequiredFields = roleSpec.requiredFields.filter((field) => {
      if (field === 'filePathOrRow' && sheet.rows.length > 0) return false;
      return !uniqueRecognized.includes(field);
    });
    if (input.role === 'invoice_files' && sheet.rows.length > 0 && uniqueRecognized.includes('invoiceNo')) {
      // structured invoice recognized
    }
    const fieldPreviews = roleSpec.requiredFields.map((field) => ({
      field,
      dataType: field.toLowerCase().includes('amount') || field.toLowerCase().includes('date')
        ? field.toLowerCase().includes('date')
          ? 'date'
          : 'decimal'
        : 'string',
      recognized:
        field === 'filePathOrRow'
          ? sheet.rows.length > 0
          : uniqueRecognized.includes(field),
      maskedSample:
        field === 'filePathOrRow'
          ? sheet.rows.length > 0
            ? '已加载行'
            : '未识别'
          : uniqueRecognized.includes(field)
            ? maskedSampleForField(field)
            : '未识别',
    }));

    // Also show common finance aliases in preview when present
    const extraPreviewFields = ['amount', 'transactionDate', 'counterparty', 'documentNo', 'invoiceNo', 'dueDate'];
    for (const field of extraPreviewFields) {
      if (roleSpec.requiredFields.includes(field)) continue;
      if (!uniqueRecognized.includes(field)) continue;
      fieldPreviews.push({
        field,
        dataType: field.toLowerCase().includes('date') ? 'date' : field.includes('amount') || field.includes('Amount') ? 'decimal' : 'string',
        recognized: true,
        maskedSample: maskedSampleForField(field),
      });
    }

    return {
      role: input.role,
      fileName: input.fileName,
      fileCount: 1,
      sheetName: sheet.name,
      rowCount: sheet.rows.length,
      recognizedFields: uniqueRecognized,
      missingRequiredFields,
      aliasMappings,
      fieldPreviews,
      canRunRole: missingRequiredFields.length === 0,
    };
  } catch (error) {
    if (error instanceof DesktopBridgeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new DesktopBridgeError('EXCEL_CORRUPT', 'Excel 文件损坏或无法解析', message);
  }
}

export async function inspectSpreadsheetFiles(input: {
  workflowId: string;
  role: string;
  files: Array<{ name: string; bytes: Uint8Array }>;
}): Promise<InspectedInputFile> {
  if (input.files.length === 0) {
    throw new DesktopBridgeError('MISSING_REQUIRED_ROLE', '多文件角色尚未选择文件');
  }
  const parts: InspectedInputFile[] = [];
  for (const file of input.files) {
    parts.push(
      await inspectSpreadsheetBytes({
        workflowId: input.workflowId,
        role: input.role,
        bytes: file.bytes,
        fileName: file.name,
      }),
    );
  }
  const recognized = [...new Set(parts.flatMap((p) => p.recognizedFields))];
  const definition = getWorkflowDefinition(input.workflowId);
  const roleSpec = definition?.inputRoles.find((r) => r.role === input.role);
  const required = roleSpec?.requiredFields ?? [];
  const missingRequiredFields = required.filter((field) => !recognized.includes(field));
  return {
    role: input.role,
    fileName: parts.map((p) => p.fileName).join(' + '),
    fileCount: parts.length,
    sheetName: parts.map((p) => p.sheetName).join(','),
    rowCount: parts.reduce((n, p) => n + p.rowCount, 0),
    recognizedFields: recognized,
    missingRequiredFields,
    aliasMappings: parts.flatMap((p) => p.aliasMappings).slice(0, 20),
    fieldPreviews: required.map((field) => ({
      field,
      dataType: 'string',
      recognized: recognized.includes(field),
      maskedSample: recognized.includes(field) ? maskedSampleForField(field) : '未识别',
    })),
    canRunRole: missingRequiredFields.length === 0,
  };
}



