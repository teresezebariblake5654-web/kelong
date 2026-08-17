import type { DesktopExecuteResult } from './types';
import { formatRuleDisplayValue } from './workflowRuleSchemas';

export type MetricCard = { label: string; value: string };

function num(metrics: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function str(metrics: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = metrics[key];
    if (value === null || value === undefined) continue;
    return String(value);
  }
  return '—';
}

export function presentWorkflowResult(workflowId: string, result: DesktopExecuteResult): MetricCard[] {
  const m = result.metrics as Record<string, unknown>;
  const exceptionPeople = result.exceptions.reduce((n, e) => n + e.count, 0);

  if (workflowId === 'HR-PAYROLL-001') {
    const bank = str(m, 'bankNetPayTotal');
    const net = str(m, 'netPayTotal');
    const consistent = bank !== '—' && net !== '—' && bank === net;
    return [
      { label: '员工数量', value: str(m, 'employeeCount') },
      { label: '可发薪人数', value: str(m, 'readyToPayCount') },
      { label: '异常人数', value: String(exceptionPeople) },
      { label: '应发工资总额', value: str(m, 'grossPayTotal') },
      { label: '扣款总额', value: str(m, 'totalDeductionTotal', 'deductionTotal') },
      { label: '实发工资总额', value: net },
      { label: '银行发薪总额', value: bank },
      { label: '银行与实发是否一致', value: consistent ? '一致' : '不一致 / 待确认' },
    ];
  }

  if (workflowId === 'HR-ATTENDANCE-002') {
    return [
      { label: '员工天数', value: str(m, 'scheduleDayCount', 'employeeDayCount', 'detailRowCount') },
      { label: '迟到数量', value: str(m, 'lateCount') },
      { label: '早退数量', value: str(m, 'earlyLeaveCount') },
      { label: '缺卡数量', value: str(m, 'missingPunchCount') },
      { label: '请假冲突数量', value: str(m, 'leaveConflictCount') },
      { label: '异常加班数量', value: str(m, 'abnormalOvertimeCount', 'overtimeExceptionCount') },
    ];
  }

  if (workflowId === 'HR-EMPLOYEE-FILE-003') {
    return [
      { label: '标准档案数量', value: str(m, 'standardProfileCount', 'employeeCount') },
      { label: '重复冲突', value: str(m, 'duplicateConflictCount') },
      { label: '缺失资料', value: str(m, 'missingDocumentCount') },
      { label: '合同到期', value: str(m, 'contractExpiringCount') },
      { label: '证照到期', value: str(m, 'certificateExpiringCount') },
    ];
  }

  if (workflowId === 'HR-ONBOARD-OFFBOARD-004') {
    return [
      { label: '变动人数', value: str(m, 'changeCount', 'employeeCount') },
      { label: '待办任务', value: str(m, 'pendingTaskCount') },
      { label: '逾期任务', value: str(m, 'overdueTaskCount') },
      { label: '阻塞办结人数', value: str(m, 'blockedEmployeeCount') },
    ];
  }

  if (workflowId === 'HR-SOCIAL-INSURANCE-005') {
    return [
      { label: '核对人数', value: str(m, 'employeeCount', 'checkedCount') },
      { label: '漏缴', value: str(m, 'missingPaymentCount') },
      { label: '重复缴费', value: str(m, 'duplicatePaymentCount') },
      { label: '基数异常', value: str(m, 'baseExceptionCount') },
      { label: '金额差异', value: str(m, 'amountVarianceCount') },
      { label: '政策版本', value: str(m, 'policyVersion', 'version') },
    ];
  }

  if (workflowId === 'HR-RECRUITMENT-FUNNEL-006') {
    return [
      { label: '候选人数', value: str(m, 'candidateCount') },
      { label: '面试人数', value: str(m, 'interviewCount') },
      { label: 'Offer 数', value: str(m, 'offerCount') },
      { label: '入职人数', value: str(m, 'hiredCount') },
      { label: '停滞人数', value: str(m, 'staleCandidateCount') },
      { label: '招聘缺口', value: str(m, 'hiringGapTotal', 'hiringGap') },
    ];
  }

  if (workflowId === 'HR-PERFORMANCE-DISTRIBUTION-007') {
    return [
      { label: '参与人数', value: str(m, 'participantCount', 'employeeCount') },
      { label: '分组数量', value: str(m, 'groupCount') },
      { label: '分布异常组', value: str(m, 'distributionExceptionGroupCount') },
      { label: '离群人数', value: str(m, 'outlierCount') },
      { label: '小样本组数量', value: str(m, 'smallGroupCount') },
    ];
  }

  if (workflowId === 'FIN-EXPENSE-CLEAN-001') {
    const exceptionBy = (code: string) =>
      String(result.exceptions.find((e) => e.code.includes(code))?.count ?? 0);
    return [
      { label: '笔数', value: str(m, 'expenseCount') },
      { label: '总额(控制)', value: str(m, 'controlTotalAmount') },
      { label: '税额', value: str(m, 'taxTotal', 'controlTaxAmount') },
      { label: '重复', value: str(m, 'duplicateCount') },
      { label: '超标', value: exceptionBy('OVER_LIMIT') },
      { label: '缺票', value: exceptionBy('MISSING_RECEIPT') },
      { label: '待分科目', value: exceptionBy('UNMAPPED') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'FIN-RECONCILIATION-002') {
    const bankCount = num(m, 'bankCount') ?? 0;
    const matched = num(m, 'matchedCount') ?? 0;
    const matchRate =
      bankCount > 0 ? `${((matched / bankCount) * 100).toFixed(1)}%` : str(m, 'matchRate');
    return [
      { label: '银行总额', value: str(m, 'bankInputTotal') },
      { label: '账务总额', value: str(m, 'ledgerInputTotal') },
      { label: '精确/建议匹配', value: str(m, 'matchedCount') },
      { label: '未匹配金额(银行)', value: str(m, 'unmatchedBankTotal') },
      { label: '控制差异(银行)', value: str(m, 'diffBank') },
      { label: '控制差异(账务)', value: str(m, 'diffLedger') },
      { label: '匹配率', value: matchRate },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'FIN-ARAP-003') {
    return [
      { label: '未结项数', value: str(m, 'openItemCount') },
      { label: '应收笔数', value: str(m, 'arCount') },
      { label: '应付笔数', value: str(m, 'apCount') },
      { label: '应收/应付余额(控制)', value: str(m, 'controlOpenAmount') },
      { label: '逾期金额', value: str(m, 'overdueAmountTotal', 'overdueTotal') },
      { label: '长期逾期', value: str(m, 'longOverdueCount') },
      { label: '高优先级数量', value: str(m, 'highPriorityCount') },
      { label: '异常数量', value: str(m, 'exceptionCount') === '—' ? String(exceptionPeople) : str(m, 'exceptionCount') },
      {
        label: '账龄口径',
        value: '未到期 · 1–30天 · 31–60天 · 61–90天 · 91–180天 · 180天以上（详见结果表）',
      },
    ];
  }

  if (workflowId === 'FIN-INVOICE-OCR-004') {
    const ocrUnavailable = m.ocrUnavailable === true;
    return [
      { label: '发票数量', value: str(m, 'invoiceCount') },
      { label: '金额/税额', value: `${str(m, 'amountTotal')} / ${str(m, 'taxTotal')}` },
      { label: '重复', value: str(m, 'duplicateCount') },
      { label: '价税差', value: exceptionCountLabel(result, 'AMOUNT_MISMATCH') },
      { label: '低置信', value: str(m, 'lowConfidenceCount') },
      { label: '采购匹配', value: str(m, 'purchaseMatchedCount') },
      { label: '无法识别/OCR', value: ocrUnavailable ? 'OCR 不可用' : exceptionCountLabel(result, 'INVALID') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'FIN-OPERATING-SUMMARY-005') {
    const balanced = m.controlBalanced === true;
    return [
      { label: '收入', value: str(m, 'revenueTotal') },
      { label: '成本', value: str(m, 'costTotal') },
      { label: '毛利/毛利率', value: `${str(m, 'grossProfit')} / ${str(m, 'grossMargin')}` },
      { label: '费用(输入)', value: str(m, 'expenseInputTotal') },
      { label: '费用(已分摊)', value: str(m, 'allocatedExpenseTotal') },
      { label: '分摊是否平衡', value: balanced ? '平衡' : '不平衡' },
      { label: '分摊方式', value: formatRuleDisplayValue(result.effectiveRules?.allocationMethod) },
      { label: '利润/回款率', value: `${str(m, 'operatingProfit')} / ${str(m, 'cashCollectionRate')}` },
      { label: '预算差异/异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ECOM-ORDER-CLEAN-001') {
    return [
      { label: '订单数', value: str(m, 'orderCount') },
      { label: '订单行', value: str(m, 'orderLineCount') },
      { label: '可发货', value: str(m, 'readyCount') },
      { label: '重复', value: str(m, 'duplicateCount') },
      { label: '金额(控制)', value: str(m, 'controlItemAmount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ECOM-REFUND-002') {
    return [
      { label: '退款笔数', value: str(m, 'refundRowCount') },
      { label: '超额/重复退', value: str(m, 'overRefundCount') },
      { label: '超时处理', value: str(m, 'overdueCount') },
      { label: '退款额(控制)', value: str(m, 'controlRefundAmount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ECOM-PRODUCT-DATA-003') {
    return [
      { label: '商品数', value: str(m, 'productCount') },
      { label: '重复 SKU', value: str(m, 'duplicateCount') },
      { label: '缺货标记', value: str(m, 'stockoutCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ECOM-LIVE-ORDER-004') {
    return [
      { label: '订单数', value: str(m, 'orderCount') },
      { label: '订单行', value: str(m, 'orderLineCount') },
      { label: '场次数', value: str(m, 'sessionCount') },
      { label: '超卖标记', value: str(m, 'oversellCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ECOM-SALES-SUMMARY-005') {
    const balanced = m.controlBalanced === true;
    return [
      { label: '订单数', value: str(m, 'orderCount') },
      { label: '订单行', value: str(m, 'orderLineCount') },
      { label: '毛销售', value: str(m, 'grossSales') },
      { label: '退款额', value: str(m, 'refundAmount') },
      { label: '净销售', value: str(m, 'netSales') },
      { label: '客单价', value: str(m, 'averageOrderValue') },
      { label: '控制是否平衡', value: balanced ? '平衡' : '不平衡' },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'LOG-INVENTORY-COUNT-001') {
    return [
      { label: '盘点行数', value: str(m, 'lineCount') },
      { label: 'SKU 数', value: str(m, 'skuCount') },
      { label: '盘亏', value: str(m, 'shortageCount') },
      { label: '盘盈', value: str(m, 'overageCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'LOG-INOUT-RECONCILE-002') {
    return [
      { label: '核对行数', value: str(m, 'lineCount') },
      { label: '未匹配', value: str(m, 'unmatchedCount') },
      { label: '入库异常', value: str(m, 'inboundExceptionCount') },
      { label: '出库异常', value: str(m, 'outboundExceptionCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'LOG-SHIPMENT-TRACK-003') {
    return [
      { label: '运单数', value: str(m, 'shipmentCount') },
      { label: '延误', value: str(m, 'delayedCount') },
      { label: '异常运单', value: str(m, 'exceptionCount') },
      { label: '在途', value: str(m, 'inTransitCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'LOG-STOCK-ALERT-004') {
    return [
      { label: 'SKU 数', value: str(m, 'skuCount') },
      { label: '低库存', value: str(m, 'lowStockCount') },
      { label: '积压', value: str(m, 'overstockCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'LOG-TRANSFER-CLEAN-005') {
    return [
      { label: '调拨单数', value: str(m, 'transferCount') },
      { label: '在途超时', value: str(m, 'overdueCount') },
      { label: '待收货', value: str(m, 'pendingReceiptCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ADMIN-ASSET-INVENTORY-001') {
    return [
      { label: '台账数量', value: str(m, 'registerCount') },
      { label: '实盘数量', value: str(m, 'physicalCount') },
      { label: '盘亏', value: str(m, 'shortageCount') },
      { label: '盘盈', value: str(m, 'surplusCount') },
      { label: '维保提醒', value: str(m, 'maintenanceDueCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ADMIN-EXPENSE-ANALYSIS-002') {
    return [
      { label: '费用笔数', value: str(m, 'expenseLineCount') },
      { label: '总额', value: str(m, 'totalAmount') },
      { label: '控制总额', value: str(m, 'controlTotal') },
      { label: '异常增长', value: str(m, 'abnormalGrowthCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ADMIN-ROOM-UTILIZATION-003') {
    return [
      { label: '会议室数', value: str(m, 'roomCount') },
      { label: '预订次数', value: str(m, 'bookingCount') },
      {
        label: '重叠是否双计',
        value: m.overlapDoubleCount === false ? '否' : str(m, 'overlapDoubleCount'),
      },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  if (workflowId === 'ADMIN-CONTRACT-EXPIRY-004') {
    return [
      { label: '合同数', value: str(m, 'contractCount') },
      { label: '即将到期', value: str(m, 'expiringCount') },
      { label: '已过期', value: str(m, 'expiredCount') },
      { label: '逾期节点', value: str(m, 'overdueMilestoneCount') },
      { label: '异常', value: String(exceptionPeople) },
    ];
  }

  // production / generic
  return [
    { label: '输出行数', value: str(m, 'outputRowCount', 'rowCount') },
    { label: '异常数量', value: String(exceptionPeople) },
    {
      label: '输入行数',
      value: String(num(m, 'inputRowCount') ?? '—'),
    },
  ];
}

function exceptionCountLabel(result: DesktopExecuteResult, code: string): string {
  const hit = result.exceptions.find((e) => e.code.includes(code));
  return hit ? String(hit.count) : '0';
}

export function financeNeedsReview(result: DesktopExecuteResult): boolean {
  if (result.status === 'NEEDS_REVIEW' || result.status === 'NEEDS_CONFIRMATION') return true;
  const codes = result.exceptions.map((e) => e.code);
  const triggers = [
    'DUPLICATE',
    'OVER_LIMIT',
    'MISSING_RECEIPT',
    'UNMAPPED',
    'MAPPING_CONFLICT',
    'AMBIGUOUS',
    'CURRENCY_MISMATCH',
    'OCR_PROVIDER_UNAVAILABLE',
    'ALLOCATION_IMBALANCE',
    'AMOUNT_MISMATCH',
    'LOW_CONFIDENCE',
  ];
  return triggers.some((code) => codes.some((c) => c.includes(code)));
}

export function ecommerceNeedsReview(result: DesktopExecuteResult): boolean {
  if (result.status === 'NEEDS_REVIEW' || result.status === 'NEEDS_CONFIRMATION') return true;
  const codes = result.exceptions.map((e) => e.code);
  const triggers = [
    'DUPLICATE',
    'OVER_REFUND',
    'OVERSELL',
    'MISSING',
    'AMOUNT',
    'ADDRESS',
    'STOCKOUT',
    'OVERDUE',
    'CONTROL',
  ];
  return triggers.some((code) => codes.some((c) => c.includes(code)));
}

export function logisticsNeedsReview(result: DesktopExecuteResult): boolean {
  if (result.status === 'NEEDS_REVIEW' || result.status === 'NEEDS_CONFIRMATION') return true;
  const codes = result.exceptions.map((e) => e.code);
  const triggers = [
    'SHORTAGE',
    'OVERAGE',
    'VARIANCE',
    'UNMATCHED',
    'MISMATCH',
    'DELAY',
    'STALE',
    'LOW_STOCK',
    'OVERSTOCK',
    'OVERDUE',
    'PENDING',
    'MISSING',
    'NEGATIVE',
  ];
  return triggers.some((code) => codes.some((c) => c.includes(code)));
}

export function adminNeedsReview(result: DesktopExecuteResult): boolean {
  if (result.status === 'NEEDS_REVIEW' || result.status === 'NEEDS_CONFIRMATION') return true;
  const codes = result.exceptions.map((e) => e.code);
  const triggers = [
    'SHORTAGE',
    'SURPLUS',
    'LOCATION',
    'CUSTODIAN',
    'DAMAGED',
    'IDLE',
    'MAINTENANCE',
    'OVER_BUDGET',
    'ABNORMAL',
    'NO_SHOW',
    'OVERLAP',
    'EXPIR',
    'OVERDUE',
    'MISSING',
  ];
  return triggers.some((code) => codes.some((c) => c.includes(code)));
}

export function payrollNeedsReview(result: DesktopExecuteResult): boolean {
  if (result.status === 'NEEDS_REVIEW' || result.status === 'NEEDS_CONFIRMATION') return true;
  const codes = new Set(result.exceptions.map((e) => e.code));
  const triggers = [
    'NEGATIVE_NET_PAY',
    'MISSING_BANK',
    'DUPLICATE_BANK',
    'MISSING_SALARY_STANDARD',
    'MISSING_ATTENDANCE',
    'BANK_TOTAL_MISMATCH',
    'HIRE_BOUNDARY',
    'TERMINATION_BOUNDARY',
  ];
  return triggers.some((code) => [...codes].some((c) => c.includes(code.replace(/_/g, '')) || c.includes(code)));
}

export function socialPolicyMissing(result: DesktopExecuteResult): boolean {
  const version = result.metrics.policyVersion ?? result.metrics.version;
  return !version;
}

export function aiSummaryLooksSafe(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return true;
  const text = JSON.stringify(payload);
  if (payload.rawRows === true) return false;
  if (/\b1[3-9]\d{9}\b/.test(text)) return false;
  if (/\b\d{16,19}\b/.test(text)) return false;
  if (text.includes('employeeName') && text.includes('张')) return false;
  return true;
}
