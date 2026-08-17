import type { MoneyRoundingMode } from '../operators/money.js';
import type { PayrollRules } from '../adapters/PayrollPolicyAdapter.js';
import type { AttendanceRules } from '../operators/attendanceOps.js';

export type { PayrollRules, AttendanceRules };

export type RuleStore = {
  getDefaults(workflowId: string): Record<string, unknown>;
  resolve(
    workflowId: string,
    companyRules?: Record<string, unknown>,
    answers?: Record<string, unknown>,
    options?: {
      persisted?: Record<string, unknown>;
      rules?: Record<string, unknown>;
    },
  ): Record<string, unknown>;
  missingCriticalKeys(
    workflowId: string,
    companyRules?: Record<string, unknown>,
    answers?: Record<string, unknown>,
  ): string[];
};

export type ConsumptionRules = {
  defaultLossRate: number;
  overuseToleranceRate: number;
  underuseToleranceRate: number;
  allowSubstituteMaterial: boolean;
};

export type ProductionPlanRules = {
  priorityRule: 'DUE_DATE' | 'CUSTOMER_PRIORITY_THEN_DUE_DATE';
  freezeDays: number;
  defaultLeadDays: number;
  allowOverPlanRate: number;
  executableStatuses: string[];
  ignoredStatuses: string[];
  duplicateStrategy: 'VERSION_THEN_UPDATED_AT' | 'UPDATED_AT_ONLY';
  capacityCheckEnabled: boolean;
  excelDateSystem: '1900' | '1904';
};

export type ProductionProgressRules = {
  delayWarningDays: number;
  maxScrapRate: number;
  defaultWorkdayHours: number;
  allowedOverproductionRate: number;
  noReportWarningDays: number;
  useWorkCalendar: boolean;
};

export type QualityRules = {
  failRateThreshold: number;
  criticalDefects: string[];
  missingStandardBlocksRelease: boolean;
  duplicateInspectionStrategy: 'LATEST' | 'BLOCK';
  paretoThreshold: number;
};

export type DowntimeCloseRules = {
  defaultUnitsPerHour: number;
  outputToleranceRate: number;
  materialToleranceRate: number;
  requireMaterialBalanced: boolean;
  requireNoOpenQualityIssue: boolean;
  requireNoCriticalQualityIssue: boolean;
  overlapStrategy: 'BLOCK' | 'MERGE_FOR_NET_DURATION';
  timezone: string;
};

const MATERIAL_DAILY_DEFAULTS: Record<string, unknown> = {
  'materialDaily.toleranceQty': 1,
  'materialDaily.toleranceRate': 0.05,
  'materialDaily.negativeStockBlocked': true,
};

const CONSUMPTION_DEFAULTS: Record<string, unknown> = {
  defaultLossRate: 0,
  overuseToleranceRate: 0.05,
  underuseToleranceRate: 0.05,
  allowSubstituteMaterial: false,
  'consumption.defaultLossRate': 0,
  'consumption.overuseToleranceRate': 0.05,
  'consumption.underuseToleranceRate': 0.05,
  'consumption.allowSubstituteMaterial': false,
};

const PLAN_CLEAN_DEFAULTS: Record<string, unknown> = {
  priorityRule: 'DUE_DATE',
  freezeDays: 3,
  defaultLeadDays: 7,
  allowOverPlanRate: 0.05,
  executableStatuses: ['APPROVED', 'RELEASED', 'READY'],
  ignoredStatuses: ['COMPLETED', 'CANCELLED', 'CLOSED'],
  duplicateStrategy: 'VERSION_THEN_UPDATED_AT',
  capacityCheckEnabled: true,
  excelDateSystem: '1900',
  'plan.priorityRule': 'DUE_DATE',
  'plan.freezeDays': 3,
  'plan.defaultLeadDays': 7,
  'plan.allowOverPlanRate': 0.05,
};

const PROGRESS_DEFAULTS: Record<string, unknown> = {
  delayWarningDays: 2,
  maxScrapRate: 0.03,
  defaultWorkdayHours: 8,
  allowedOverproductionRate: 0.05,
  noReportWarningDays: 2,
  useWorkCalendar: false,
};

const QUALITY_DEFAULTS: Record<string, unknown> = {
  failRateThreshold: 0.03,
  criticalDefects: [],
  missingStandardBlocksRelease: true,
  duplicateInspectionStrategy: 'BLOCK',
  paretoThreshold: 0.8,
};

const DOWNTIME_DEFAULTS: Record<string, unknown> = {
  defaultUnitsPerHour: 0,
  outputToleranceRate: 0.02,
  materialToleranceRate: 0.05,
  requireMaterialBalanced: true,
  requireNoOpenQualityIssue: true,
  requireNoCriticalQualityIssue: true,
  overlapStrategy: 'BLOCK',
  timezone: 'UTC',
};

const PAYROLL_DEFAULTS: Record<string, unknown> = {
  standardPayableDays: 21.75,
  'payroll.payableDays': 21.75,
  overtimeMultiplier: 1.5,
  'payroll.overtimeMultiplier': 1.5,
  lateDeductionPerMinute: '1',
  absenceDeductionMode: 'DAILY_SALARY',
  absenceFixedAmount: '0',
  roundingScale: 2,
  'payroll.roundingScale': 2,
  roundingMode: 'HALF_UP',
  negativeNetPayBlocked: true,
  payrollChangeWarningRate: 0.3,
};

const ATTENDANCE_DEFAULTS: Record<string, unknown> = {
  lateGraceMinutes: 5,
  earlyLeaveGraceMinutes: 5,
  missingPunchRule: 'EXCEPTION',
  overtimeMinimumMinutes: 30,
  maxWorkedMinutes: 720,
  breakMinutesDefault: 60,
  'attendance.lateGraceMinutes': 5,
  'attendance.earlyLeaveGraceMinutes': 5,
  'attendance.missingPunchRule': 'EXCEPTION',
  'attendance.overtimeMinimumMinutes': 30,
};

const EMPLOYEE_FILE_DEFAULTS: Record<string, unknown> = {
  expiryWarningDays: 30,
  requiredDocuments: ['idCard', 'contract', 'bankAccount'],
  matchRule: 'EMPLOYEE_ID',
  'employee.expiryWarningDays': 30,
  'employee.requiredDocuments': ['idCard', 'contract', 'bankAccount'],
  'employee.matchRule': 'EMPLOYEE_ID',
};

const ONBOARD_OFFBOARD_DEFAULTS: Record<string, unknown> = {
  defaultOwners: { HR: '人事', IT: '信息', ADMIN: '行政', FINANCE: '财务' },
  blockingTasks: ['账号开通', '账号停用', '资产领用', '资产归还', '合同签署'],
  reminderDays: 3,
  'onoffboard.defaultOwners': { HR: '人事', IT: '信息', ADMIN: '行政', FINANCE: '财务' },
  'onoffboard.blockingTasks': ['账号开通', '账号停用', '资产领用', '资产归还', '合同签署'],
  'onoffboard.reminderDays': 3,
};

const SOCIAL_INSURANCE_DEFAULTS: Record<string, unknown> = {
  region: 'DEFAULT',
  policyVersion: 'v1',
  effectiveDate: '2024-01-01',
  minBase: '3523',
  maxBase: '35230',
  minFundBase: '3523',
  maxFundBase: '35230',
  employeeInsuranceRate: '0.105',
  companyInsuranceRate: '0.27',
  employeeFundRate: '0.12',
  companyFundRate: '0.12',
  joinLeaveMonthRule: 'JOIN_CURRENT_LEAVE_CURRENT',
  amountTolerance: '0.5',
  roundingScale: 2,
  roundingMode: 'HALF_UP',
  'social.minBase': '3523',
  'social.maxBase': '35230',
  'social.employeeRates': { insurance: '0.105', fund: '0.12' },
  'social.companyRates': { insurance: '0.27', fund: '0.12' },
  'social.joinLeaveMonthRule': 'JOIN_CURRENT_LEAVE_CURRENT',
};

const RECRUITMENT_DEFAULTS: Record<string, unknown> = {
  stageOrder: ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'],
  staleDays: 14,
  duplicateMatchRule: 'PHONE_OR_EMAIL_OR_NAME_POSITION',
  'recruitment.stageOrder': ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'],
  'recruitment.staleDays': 14,
  'recruitment.duplicateMatchRule': 'PHONE_OR_EMAIL_OR_NAME_POSITION',
};

const PERFORMANCE_DEFAULTS: Record<string, unknown> = {
  groupBy: ['department', 'level'],
  ratingBands: [
    { rating: 'A', minScore: 90, maxScore: 100 },
    { rating: 'B', minScore: 80, maxScore: 89.999 },
    { rating: 'C', minScore: 70, maxScore: 79.999 },
    { rating: 'D', minScore: 0, maxScore: 69.999 },
  ],
  outlierZScore: 2.5,
  minimumGroupSize: 8,
  outlierMethod: 'IQR',
  'performance.groupBy': ['department', 'level'],
  'performance.ratingBands': [
    { rating: 'A', minScore: 90, maxScore: 100 },
    { rating: 'B', minScore: 80, maxScore: 89.999 },
    { rating: 'C', minScore: 70, maxScore: 79.999 },
    { rating: 'D', minScore: 0, maxScore: 69.999 },
  ],
  'performance.outlierZScore': 2.5,
  'performance.minimumGroupSize': 8,
};

const EXPENSE_CLEAN_DEFAULTS: Record<string, unknown> = {
  duplicateWindowDays: 3,
  amountTolerance: '0.01',
  defaultAccount: '6602',
  receiptRequired: true,
  'expense.duplicateWindowDays': 3,
  'expense.amountTolerance': '0.01',
  'expense.defaultAccount': '6602',
  'expense.receiptRequired': true,
};

const RECONCILIATION_DEFAULTS: Record<string, unknown> = {
  dateToleranceDays: 3,
  amountTolerance: '0.01',
  allowManyToOne: true,
  allowOneToMany: true,
  maxSubsetSize: 4,
  highConfidenceThreshold: 0.85,
  'reconciliation.dateToleranceDays': 3,
  'reconciliation.amountTolerance': '0.01',
  'reconciliation.allowManyToOne': true,
  'reconciliation.allowOneToMany': true,
  'reconciliation.maxSubsetSize': 4,
  'reconciliation.highConfidenceThreshold': 0.85,
};

const ARAP_DEFAULTS: Record<string, unknown> = {
  materialityAmount: '10000',
  longOverdueDays: 180,
  'arap.materialityAmount': '10000',
  'arap.longOverdueDays': 180,
};

const INVOICE_OCR_DEFAULTS: Record<string, unknown> = {
  confidenceThreshold: 0.8,
  amountTolerance: '0.01',
  ocrMode: 'STRUCTURED_ONLY',
  'invoice.confidenceThreshold': 0.8,
  'invoice.amountTolerance': '0.01',
  'invoice.ocrMode': 'STRUCTURED_ONLY',
};

const OPERATING_SUMMARY_DEFAULTS: Record<string, unknown> = {
  periodMode: 'MONTH',
  allocationMethod: 'REVENUE_SHARE',
  materialityRate: 0.1,
  'operating.periodMode': 'MONTH',
  'operating.allocationMethod': 'REVENUE_SHARE',
  'operating.materialityRate': 0.1,
};

const ORDER_CLEAN_DEFAULTS: Record<string, unknown> = {
  orderUniqueRule: 'PLATFORM_ORDER_LINE',
  phoneMasking: true,
  addressRequiredFields: ['receiverName', 'phone', 'address'],
  amountTolerance: '0.01',
  'ecom.orderUniqueRule': 'PLATFORM_ORDER_LINE',
  'ecom.phoneMasking': true,
  'ecom.addressRequiredFields': ['receiverName', 'phone', 'address'],
  'ecom.amountTolerance': '0.01',
};

const REFUND_DEFAULTS: Record<string, unknown> = {
  allowNoReturnReasons: ['仅退款', '缺货', '未发货退款', 'NO_RETURN'],
  maxProcessingDays: 7,
  amountTolerance: '0.01',
  requireRestock: true,
  'refund.allowNoReturnReasons': ['仅退款', '缺货', '未发货退款', 'NO_RETURN'],
  'refund.maxProcessingDays': 7,
  'refund.amountTolerance': '0.01',
  'refund.requireRestock': true,
};

const PRODUCT_DATA_DEFAULTS: Record<string, unknown> = {
  requiredAttributes: ['productName', 'price', 'status'],
  lowSalesDays: 30,
  daysOfInventoryThreshold: 90,
  marginThreshold: 0.1,
  'product.requiredAttributes': ['productName', 'price', 'status'],
  'product.lowSalesDays': 30,
  'product.daysOfInventoryThreshold': 90,
  'product.marginThreshold': 0.1,
};

const LIVE_ORDER_DEFAULTS: Record<string, unknown> = {
  orderStatusMap: {},
  oversellPolicy: 'FLAG_ONLY',
  cancelWindowMinutes: 30,
  sessionMatchRule: 'SESSION_ID_FIRST',
  'live.orderStatusMap': {},
  'live.oversellPolicy': 'FLAG_ONLY',
  'live.cancelWindowMinutes': 30,
  'live.sessionMatchRule': 'SESSION_ID_FIRST',
};

const SALES_SUMMARY_DEFAULTS: Record<string, unknown> = {
  period: 'MONTH',
  revenueRecognitionRule: 'ORDER_DATE',
  refundAttributionRule: 'ORDER_DATE',
  orderCountRule: 'DISTINCT_ORDER_NO',
  'sales.period': 'MONTH',
  'sales.revenueRecognitionRule': 'ORDER_DATE',
  'sales.refundAttributionRule': 'ORDER_DATE',
  'sales.orderCountRule': 'DISTINCT_ORDER_NO',
};

const ADMIN_ASSET_DEFAULTS: Record<string, unknown> = {
  matchRule: 'ASSET_CODE',
  idleDays: 90,
  expiryWarningDays: 30,
  allowedStatuses: ['IN_USE', 'IDLE', 'DAMAGED', 'IN_REPAIR', 'SCRAPPED', '在用', '闲置', '损坏', '维修中', '报废'],
  'asset.matchRule': 'ASSET_CODE',
  'asset.idleDays': 90,
  'asset.expiryWarningDays': 30,
  'asset.allowedStatuses': ['IN_USE', 'IDLE', 'DAMAGED', 'IN_REPAIR', 'SCRAPPED', '在用', '闲置', '损坏', '维修中', '报废'],
};

const ADMIN_EXPENSE_DEFAULTS: Record<string, unknown> = {
  period: 'MONTH',
  materialityRate: 0.1,
  perCapitaMetrics: true,
  'adminExpense.period': 'MONTH',
  'adminExpense.materialityRate': 0.1,
  'adminExpense.perCapitaMetrics': true,
};

const ADMIN_ROOM_DEFAULTS: Record<string, unknown> = {
  workingDays: 5,
  minimumBookingMinutes: 30,
  noShowGraceMinutes: 15,
  useCheckinAsActual: true,
  'room.workingDays': 5,
  'room.minimumBookingMinutes': 30,
  'room.noShowGraceMinutes': 15,
  'room.useCheckinAsActual': true,
};

const ADMIN_CONTRACT_DEFAULTS: Record<string, unknown> = {
  warningDays: 30,
  autoRenewNoticeDays: 60,
  materialAmount: '10000',
  requiredFields: ['contractNo', 'contractName', 'counterparty', 'startDate', 'endDate', 'owner', 'amount'],
  'contract.warningDays': 30,
  'contract.autoRenewNoticeDays': 60,
  'contract.materialAmount': '10000',
  'contract.requiredFields': ['contractNo', 'contractName', 'counterparty', 'startDate', 'endDate', 'owner', 'amount'],
};

const LOG_INVENTORY_DEFAULTS: Record<string, unknown> = {
  matchRule: 'SKU_WAREHOUSE',
  qtyTolerance: '0',
  'log.inventory.matchRule': 'SKU_WAREHOUSE',
  'log.inventory.qtyTolerance': '0',
};

const LOG_INOUT_DEFAULTS: Record<string, unknown> = {
  qtyTolerance: '0',
  dateToleranceDays: 1,
  'log.inout.qtyTolerance': '0',
  'log.inout.dateToleranceDays': 1,
};

const LOG_TRACK_DEFAULTS: Record<string, unknown> = {
  delayHours: 24,
  staleHours: 72,
  'log.track.delayHours': 24,
  'log.track.staleHours': 72,
};

const LOG_ALERT_DEFAULTS: Record<string, unknown> = {
  lowStockDays: 7,
  overstockDays: 90,
  'log.alert.lowStockDays': 7,
  'log.alert.overstockDays': 90,
};

const LOG_TRANSFER_DEFAULTS: Record<string, unknown> = {
  inTransitDays: 7,
  qtyTolerance: '0',
  'log.transfer.inTransitDays': 7,
  'log.transfer.qtyTolerance': '0',
};

const DEFAULTS_BY_WORKFLOW: Record<string, Record<string, unknown>> = {
  'PROD-MATERIAL-DAILY-001': MATERIAL_DAILY_DEFAULTS,
  'PROD-CONSUMPTION-CHECK-002': CONSUMPTION_DEFAULTS,
  'PROD-PLAN-CLEAN-003': PLAN_CLEAN_DEFAULTS,
  'PROD-PROGRESS-004': PROGRESS_DEFAULTS,
  'PROD-QUALITY-005': QUALITY_DEFAULTS,
  'PROD-DOWNTIME-CLOSE-006': DOWNTIME_DEFAULTS,
  'HR-PAYROLL-001': PAYROLL_DEFAULTS,
  'HR-ATTENDANCE-002': ATTENDANCE_DEFAULTS,
  'HR-EMPLOYEE-FILE-003': EMPLOYEE_FILE_DEFAULTS,
  'HR-ONBOARD-OFFBOARD-004': ONBOARD_OFFBOARD_DEFAULTS,
  'HR-SOCIAL-INSURANCE-005': SOCIAL_INSURANCE_DEFAULTS,
  'HR-RECRUITMENT-FUNNEL-006': RECRUITMENT_DEFAULTS,
  'HR-PERFORMANCE-DISTRIBUTION-007': PERFORMANCE_DEFAULTS,
  'FIN-EXPENSE-CLEAN-001': EXPENSE_CLEAN_DEFAULTS,
  'FIN-RECONCILIATION-002': RECONCILIATION_DEFAULTS,
  'FIN-ARAP-003': ARAP_DEFAULTS,
  'FIN-INVOICE-OCR-004': INVOICE_OCR_DEFAULTS,
  'FIN-OPERATING-SUMMARY-005': OPERATING_SUMMARY_DEFAULTS,
  'ECOM-ORDER-CLEAN-001': ORDER_CLEAN_DEFAULTS,
  'ECOM-REFUND-002': REFUND_DEFAULTS,
  'ECOM-PRODUCT-DATA-003': PRODUCT_DATA_DEFAULTS,
  'ECOM-LIVE-ORDER-004': LIVE_ORDER_DEFAULTS,
  'ECOM-SALES-SUMMARY-005': SALES_SUMMARY_DEFAULTS,
  'ADMIN-ASSET-INVENTORY-001': ADMIN_ASSET_DEFAULTS,
  'ADMIN-EXPENSE-ANALYSIS-002': ADMIN_EXPENSE_DEFAULTS,
  'ADMIN-ROOM-UTILIZATION-003': ADMIN_ROOM_DEFAULTS,
  'ADMIN-CONTRACT-EXPIRY-004': ADMIN_CONTRACT_DEFAULTS,
  'LOG-INVENTORY-COUNT-001': LOG_INVENTORY_DEFAULTS,
  'LOG-INOUT-RECONCILE-002': LOG_INOUT_DEFAULTS,
  'LOG-SHIPMENT-TRACK-003': LOG_TRACK_DEFAULTS,
  'LOG-STOCK-ALERT-004': LOG_ALERT_DEFAULTS,
  'LOG-TRANSFER-CLEAN-005': LOG_TRANSFER_DEFAULTS,
};

function answerToRulePatch(answers: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!answers) return {};
  const patch: Record<string, unknown> = {};
  if (answers.toleranceQty !== undefined) {
    patch['materialDaily.toleranceQty'] = Number(answers.toleranceQty);
  }
  if (answers.toleranceRate !== undefined) {
    patch['materialDaily.toleranceRate'] = Number(answers.toleranceRate);
  }
  if (answers.negativeStockBlocked !== undefined) {
    patch['materialDaily.negativeStockBlocked'] = Boolean(answers.negativeStockBlocked);
  }
  if (answers.defaultLossRate !== undefined) patch.defaultLossRate = Number(answers.defaultLossRate);
  if (answers.overuseToleranceRate !== undefined) {
    patch.overuseToleranceRate = Number(answers.overuseToleranceRate);
  }
  if (answers.underuseToleranceRate !== undefined) {
    patch.underuseToleranceRate = Number(answers.underuseToleranceRate);
  }
  if (answers.allowSubstituteMaterial !== undefined) {
    patch.allowSubstituteMaterial = Boolean(answers.allowSubstituteMaterial);
  }
  for (const [key, value] of Object.entries(answers)) {
    if (key.includes('.')) patch[key] = value;
  }
  return patch;
}

export class InMemoryRuleStore implements RuleStore {
  getDefaults(workflowId: string): Record<string, unknown> {
    return { ...(DEFAULTS_BY_WORKFLOW[workflowId] ?? {}) };
  }

  resolve(
    workflowId: string,
    companyRules?: Record<string, unknown>,
    answers?: Record<string, unknown>,
    options?: {
      persisted?: Record<string, unknown>;
      rules?: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    // Precedence: request.rules > companyRules > persisted > defaults > answers applied last as aliases
    // User spec: 1) request.rules 2) company saved 3) defaults
    // companyRules kept as explicit mid override for backward compatibility.
    return {
      ...this.getDefaults(workflowId),
      ...(options?.persisted ?? {}),
      ...(companyRules ?? {}),
      ...answerToRulePatch(answers),
      ...(options?.rules ?? {}),
    };
  }

  missingCriticalKeys(
    workflowId: string,
    companyRules?: Record<string, unknown>,
    answers?: Record<string, unknown>,
  ): string[] {
    const defaults = this.getDefaults(workflowId);
    const resolved = this.resolve(workflowId, companyRules, answers);
    return Object.keys(defaults).filter((key) => resolved[key] === undefined || resolved[key] === null);
  }
}

export function createRuleStore(): RuleStore {
  return new InMemoryRuleStore();
}

export function toConsumptionRules(resolved: Record<string, unknown>): ConsumptionRules {
  return {
    defaultLossRate: Number(
      resolved.defaultLossRate ?? resolved['consumption.defaultLossRate'] ?? 0,
    ),
    overuseToleranceRate: Number(
      resolved.overuseToleranceRate ?? resolved['consumption.overuseToleranceRate'] ?? 0.05,
    ),
    underuseToleranceRate: Number(
      resolved.underuseToleranceRate ?? resolved['consumption.underuseToleranceRate'] ?? 0.05,
    ),
    allowSubstituteMaterial: Boolean(
      resolved.allowSubstituteMaterial ??
        resolved['consumption.allowSubstituteMaterial'] ??
        false,
    ),
  };
}

export function toProductionPlanRules(resolved: Record<string, unknown>): ProductionPlanRules {
  const executableStatuses = Array.isArray(resolved.executableStatuses)
    ? (resolved.executableStatuses as string[])
    : ['APPROVED', 'RELEASED', 'READY'];
  const ignoredStatuses = Array.isArray(resolved.ignoredStatuses)
    ? (resolved.ignoredStatuses as string[])
    : ['COMPLETED', 'CANCELLED', 'CLOSED'];

  return {
    priorityRule:
      (resolved.priorityRule as ProductionPlanRules['priorityRule']) ??
      (resolved['plan.priorityRule'] as ProductionPlanRules['priorityRule']) ??
      'DUE_DATE',
    freezeDays: Number(resolved.freezeDays ?? resolved['plan.freezeDays'] ?? 3),
    defaultLeadDays: Number(resolved.defaultLeadDays ?? resolved['plan.defaultLeadDays'] ?? 7),
    allowOverPlanRate: Number(
      resolved.allowOverPlanRate ?? resolved['plan.allowOverPlanRate'] ?? 0.05,
    ),
    executableStatuses,
    ignoredStatuses,
    duplicateStrategy:
      (resolved.duplicateStrategy as ProductionPlanRules['duplicateStrategy']) ??
      'VERSION_THEN_UPDATED_AT',
    capacityCheckEnabled:
      resolved.capacityCheckEnabled === undefined
        ? true
        : Boolean(resolved.capacityCheckEnabled),
    excelDateSystem:
      resolved.excelDateSystem === '1904' || resolved['plan.excelDateSystem'] === '1904'
        ? '1904'
        : '1900',
  };
}

export function toProductionProgressRules(
  resolved: Record<string, unknown>,
): ProductionProgressRules {
  return {
    delayWarningDays: Number(resolved.delayWarningDays ?? 2),
    maxScrapRate: Number(resolved.maxScrapRate ?? resolved['progress.maxScrapRate'] ?? 0.03),
    defaultWorkdayHours: Number(
      resolved.defaultWorkdayHours ?? resolved['progress.workdayHours'] ?? 8,
    ),
    allowedOverproductionRate: Number(resolved.allowedOverproductionRate ?? 0.05),
    noReportWarningDays: Number(resolved.noReportWarningDays ?? 2),
    useWorkCalendar: Boolean(resolved.useWorkCalendar ?? false),
  };
}

export function toQualityRules(resolved: Record<string, unknown>): QualityRules {
  const criticalDefects = Array.isArray(resolved.criticalDefects)
    ? (resolved.criticalDefects as string[])
    : [];
  return {
    failRateThreshold: Number(
      resolved.failRateThreshold ?? resolved['quality.failRateThreshold'] ?? 0.03,
    ),
    criticalDefects,
    missingStandardBlocksRelease:
      resolved.missingStandardBlocksRelease === undefined
        ? true
        : Boolean(resolved.missingStandardBlocksRelease),
    duplicateInspectionStrategy:
      resolved.duplicateInspectionStrategy === 'LATEST' ? 'LATEST' : 'BLOCK',
    paretoThreshold: Number(resolved.paretoThreshold ?? 0.8),
  };
}

export function toDowntimeCloseRules(resolved: Record<string, unknown>): DowntimeCloseRules {
  return {
    defaultUnitsPerHour: Number(
      resolved.defaultUnitsPerHour ?? resolved['downtime.defaultUnitsPerHour'] ?? 0,
    ),
    outputToleranceRate: Number(
      resolved.outputToleranceRate ?? resolved['close.outputToleranceRate'] ?? 0.02,
    ),
    materialToleranceRate: Number(resolved.materialToleranceRate ?? 0.05),
    requireMaterialBalanced:
      resolved.requireMaterialBalanced === undefined
        ? true
        : Boolean(resolved.requireMaterialBalanced),
    requireNoOpenQualityIssue:
      resolved.requireNoOpenQualityIssue === undefined
        ? true
        : Boolean(
            resolved.requireNoOpenQualityIssue ??
              resolved['close.requireNoOpenQualityIssue'] ??
              true,
          ),
    requireNoCriticalQualityIssue:
      resolved.requireNoCriticalQualityIssue === undefined
        ? true
        : Boolean(resolved.requireNoCriticalQualityIssue),
    overlapStrategy:
      resolved.overlapStrategy === 'MERGE_FOR_NET_DURATION'
        ? 'MERGE_FOR_NET_DURATION'
        : 'BLOCK',
    timezone: String(resolved.timezone ?? 'UTC'),
  };
}

export function toPayrollRules(resolved: Record<string, unknown>): PayrollRules {
  const mode = String(resolved.roundingMode ?? 'HALF_UP').toUpperCase();
  const roundingMode: MoneyRoundingMode =
    mode === 'HALF_EVEN' || mode === 'DOWN' || mode === 'UP' ? mode : 'HALF_UP';
  return {
    standardPayableDays: Number(
      resolved.standardPayableDays ?? resolved['payroll.payableDays'] ?? 21.75,
    ),
    overtimeMultiplier: Number(
      resolved.overtimeMultiplier ?? resolved['payroll.overtimeMultiplier'] ?? 1.5,
    ),
    lateDeductionPerMinute: String(
      resolved.lateDeductionPerMinute ??
        resolved['payroll.lateDeductionPerMinute'] ??
        resolved['payroll.lateDeductionRule'] ??
        '1',
    ),
    absenceDeductionMode:
      resolved.absenceDeductionMode === 'FIXED' ? 'FIXED' : 'DAILY_SALARY',
    absenceFixedAmount: String(resolved.absenceFixedAmount ?? '0'),
    roundingScale: Number(resolved.roundingScale ?? resolved['payroll.roundingScale'] ?? 2),
    roundingMode,
    negativeNetPayBlocked:
      resolved.negativeNetPayBlocked === undefined
        ? true
        : Boolean(resolved.negativeNetPayBlocked),
    payrollChangeWarningRate: Number(resolved.payrollChangeWarningRate ?? 0.3),
  };
}

export function toAttendanceRules(resolved: Record<string, unknown>): AttendanceRules {
  const missing = String(
    resolved.missingPunchRule ?? resolved['attendance.missingPunchRule'] ?? 'EXCEPTION',
  ).toUpperCase();
  const missingPunchRule: AttendanceRules['missingPunchRule'] =
    missing === 'ABSENT' || missing === 'IGNORE_ONCE' ? missing : 'EXCEPTION';
  return {
    lateGraceMinutes: Number(
      resolved.lateGraceMinutes ?? resolved['attendance.lateGraceMinutes'] ?? 5,
    ),
    earlyLeaveGraceMinutes: Number(
      resolved.earlyLeaveGraceMinutes ?? resolved['attendance.earlyLeaveGraceMinutes'] ?? 5,
    ),
    missingPunchRule,
    overtimeMinimumMinutes: Number(
      resolved.overtimeMinimumMinutes ?? resolved['attendance.overtimeMinimumMinutes'] ?? 30,
    ),
    maxWorkedMinutes: Number(resolved.maxWorkedMinutes ?? 720),
    breakMinutesDefault: Number(resolved.breakMinutesDefault ?? 60),
  };
}

export type EmployeeFileRules = {
  expiryWarningDays: number;
  requiredDocuments: string[];
  matchRule: 'EMPLOYEE_ID' | 'ID_NUMBER' | 'PHONE' | 'NAME_HIRE_DATE';
};

export function toEmployeeFileRules(resolved: Record<string, unknown>): EmployeeFileRules {
  const docs = Array.isArray(resolved.requiredDocuments)
    ? (resolved.requiredDocuments as string[])
    : Array.isArray(resolved['employee.requiredDocuments'])
      ? (resolved['employee.requiredDocuments'] as string[])
      : ['idCard', 'contract', 'bankAccount'];
  const match = String(
    resolved.matchRule ?? resolved['employee.matchRule'] ?? 'EMPLOYEE_ID',
  ).toUpperCase();
  const matchRule: EmployeeFileRules['matchRule'] =
    match === 'ID_NUMBER' || match === 'PHONE' || match === 'NAME_HIRE_DATE'
      ? match
      : 'EMPLOYEE_ID';
  return {
    expiryWarningDays: Number(
      resolved.expiryWarningDays ?? resolved['employee.expiryWarningDays'] ?? 30,
    ),
    requiredDocuments: docs,
    matchRule,
  };
}

export type OnboardOffboardRules = {
  defaultOwners: Record<string, string>;
  blockingTasks: string[];
  reminderDays: number;
};

export function toOnboardOffboardRules(resolved: Record<string, unknown>): OnboardOffboardRules {
  const ownersRaw =
    resolved.defaultOwners ?? resolved['onoffboard.defaultOwners'] ?? {};
  const blockingRaw =
    resolved.blockingTasks ?? resolved['onoffboard.blockingTasks'] ?? [];
  return {
    defaultOwners:
      ownersRaw && typeof ownersRaw === 'object' && !Array.isArray(ownersRaw)
        ? (ownersRaw as Record<string, string>)
        : {},
    blockingTasks: Array.isArray(blockingRaw) ? (blockingRaw as string[]) : [],
    reminderDays: Number(resolved.reminderDays ?? resolved['onoffboard.reminderDays'] ?? 3),
  };
}

export type SocialInsuranceRules = {
  region: string;
  policyVersion: string;
  effectiveDate: string;
  minBase: string;
  maxBase: string;
  minFundBase: string;
  maxFundBase: string;
  employeeInsuranceRate: string;
  companyInsuranceRate: string;
  employeeFundRate: string;
  companyFundRate: string;
  joinLeaveMonthRule: 'JOIN_CURRENT_LEAVE_CURRENT' | 'JOIN_NEXT_LEAVE_CURRENT' | 'JOIN_CURRENT_LEAVE_PREVIOUS';
  amountTolerance: string;
  roundingScale: number;
  roundingMode: MoneyRoundingMode;
};

export function toSocialInsuranceRules(resolved: Record<string, unknown>): SocialInsuranceRules {
  const empRates =
    (resolved['social.employeeRates'] as Record<string, unknown> | undefined) ?? {};
  const coRates =
    (resolved['social.companyRates'] as Record<string, unknown> | undefined) ?? {};
  const mode = String(resolved.roundingMode ?? 'HALF_UP').toUpperCase();
  const roundingMode: MoneyRoundingMode =
    mode === 'HALF_EVEN' || mode === 'DOWN' || mode === 'UP' ? mode : 'HALF_UP';
  const joinLeave = String(
    resolved.joinLeaveMonthRule ?? resolved['social.joinLeaveMonthRule'] ?? 'JOIN_CURRENT_LEAVE_CURRENT',
  ).toUpperCase();
  const joinLeaveMonthRule: SocialInsuranceRules['joinLeaveMonthRule'] =
    joinLeave === 'JOIN_NEXT_LEAVE_CURRENT' || joinLeave === 'JOIN_CURRENT_LEAVE_PREVIOUS'
      ? joinLeave
      : 'JOIN_CURRENT_LEAVE_CURRENT';
  return {
    region: String(resolved.region ?? 'DEFAULT'),
    policyVersion: String(resolved.policyVersion ?? 'v1'),
    effectiveDate: String(resolved.effectiveDate ?? '2024-01-01'),
    minBase: String(
      resolved.minBase ?? resolved.insuranceMinBase ?? resolved['social.minBase'] ?? '3523',
    ),
    maxBase: String(
      resolved.maxBase ?? resolved.insuranceMaxBase ?? resolved['social.maxBase'] ?? '35230',
    ),
    minFundBase: String(
      resolved.minFundBase ?? resolved.fundMinBase ?? resolved.minBase ?? resolved.insuranceMinBase ?? '3523',
    ),
    maxFundBase: String(
      resolved.maxFundBase ?? resolved.fundMaxBase ?? resolved.maxBase ?? resolved.insuranceMaxBase ?? '35230',
    ),
    employeeInsuranceRate: String(
      resolved.employeeInsuranceRate ?? empRates.insurance ?? '0.105',
    ),
    companyInsuranceRate: String(
      resolved.companyInsuranceRate ?? coRates.insurance ?? '0.27',
    ),
    employeeFundRate: String(resolved.employeeFundRate ?? empRates.fund ?? '0.12'),
    companyFundRate: String(resolved.companyFundRate ?? coRates.fund ?? '0.12'),
    joinLeaveMonthRule,
    amountTolerance: String(resolved.amountTolerance ?? '0.5'),
    roundingScale: Number(resolved.roundingScale ?? 2),
    roundingMode,
  };
}

export type RecruitmentRules = {
  stageOrder: string[];
  staleDays: number;
  duplicateMatchRule: string;
};

export function toRecruitmentRules(resolved: Record<string, unknown>): RecruitmentRules {
  const stages = Array.isArray(resolved.stageOrder)
    ? (resolved.stageOrder as string[])
    : Array.isArray(resolved['recruitment.stageOrder'])
      ? (resolved['recruitment.stageOrder'] as string[])
      : ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
  return {
    stageOrder: stages.map((s) => String(s).toUpperCase()),
    staleDays: Number(resolved.staleDays ?? resolved['recruitment.staleDays'] ?? 14),
    duplicateMatchRule: String(
      resolved.duplicateMatchRule ??
        resolved['recruitment.duplicateMatchRule'] ??
        'PHONE_OR_EMAIL_OR_NAME_POSITION',
    ),
  };
}

export type PerformanceRatingBand = { rating: string; minScore: number; maxScore: number };

export type PerformanceRules = {
  groupBy: string[];
  ratingBands: PerformanceRatingBand[];
  outlierZScore: number;
  minimumGroupSize: number;
  outlierMethod: 'IQR' | 'ZSCORE';
};

export function toPerformanceRules(resolved: Record<string, unknown>): PerformanceRules {
  const groupBy = Array.isArray(resolved.groupBy)
    ? (resolved.groupBy as string[])
    : Array.isArray(resolved['performance.groupBy'])
      ? (resolved['performance.groupBy'] as string[])
      : ['department', 'level'];
  const bandsRaw = Array.isArray(resolved.ratingBands)
    ? resolved.ratingBands
    : Array.isArray(resolved['performance.ratingBands'])
      ? resolved['performance.ratingBands']
      : [];
  const ratingBands: PerformanceRatingBand[] =
    bandsRaw.length > 0
      ? (bandsRaw as PerformanceRatingBand[]).map((b) => ({
          rating: String((b as PerformanceRatingBand).rating),
          minScore: Number((b as PerformanceRatingBand).minScore),
          maxScore: Number((b as PerformanceRatingBand).maxScore),
        }))
      : [
          { rating: 'A', minScore: 90, maxScore: 100 },
          { rating: 'B', minScore: 80, maxScore: 89.999 },
          { rating: 'C', minScore: 70, maxScore: 79.999 },
          { rating: 'D', minScore: 0, maxScore: 69.999 },
        ];
  const method = String(resolved.outlierMethod ?? 'IQR').toUpperCase();
  return {
    groupBy,
    ratingBands,
    outlierZScore: Number(resolved.outlierZScore ?? resolved['performance.outlierZScore'] ?? 2.5),
    minimumGroupSize: Number(
      resolved.minimumGroupSize ?? resolved['performance.minimumGroupSize'] ?? 8,
    ),
    outlierMethod: method === 'ZSCORE' ? 'ZSCORE' : 'IQR',
  };
}

export type ExpenseCleanRules = {
  duplicateWindowDays: number;
  amountTolerance: string;
  defaultAccount: string;
  receiptRequired: boolean;
};

export function toExpenseCleanRules(resolved: Record<string, unknown>): ExpenseCleanRules {
  return {
    duplicateWindowDays: Number(
      resolved.duplicateWindowDays ?? resolved['expense.duplicateWindowDays'] ?? 3,
    ),
    amountTolerance: String(
      resolved.amountTolerance ?? resolved['expense.amountTolerance'] ?? '0.01',
    ),
    defaultAccount: String(
      resolved.defaultAccount ?? resolved['expense.defaultAccount'] ?? '6602',
    ),
    receiptRequired:
      resolved.receiptRequired === undefined && resolved['expense.receiptRequired'] === undefined
        ? true
        : Boolean(resolved.receiptRequired ?? resolved['expense.receiptRequired']),
  };
}

export type ReconciliationRules = {
  dateToleranceDays: number;
  amountTolerance: string;
  allowManyToOne: boolean;
  allowOneToMany: boolean;
  maxSubsetSize: number;
  highConfidenceThreshold: number;
};

export function toReconciliationRules(resolved: Record<string, unknown>): ReconciliationRules {
  return {
    dateToleranceDays: Number(
      resolved.dateToleranceDays ?? resolved['reconciliation.dateToleranceDays'] ?? 3,
    ),
    amountTolerance: String(
      resolved.amountTolerance ?? resolved['reconciliation.amountTolerance'] ?? '0.01',
    ),
    allowManyToOne:
      resolved.allowManyToOne === undefined && resolved['reconciliation.allowManyToOne'] === undefined
        ? true
        : Boolean(resolved.allowManyToOne ?? resolved['reconciliation.allowManyToOne']),
    allowOneToMany:
      resolved.allowOneToMany === undefined && resolved['reconciliation.allowOneToMany'] === undefined
        ? true
        : Boolean(resolved.allowOneToMany ?? resolved['reconciliation.allowOneToMany']),
    maxSubsetSize: Number(
      resolved.maxSubsetSize ?? resolved['reconciliation.maxSubsetSize'] ?? 4,
    ),
    highConfidenceThreshold: Number(
      resolved.highConfidenceThreshold ??
        resolved['reconciliation.highConfidenceThreshold'] ??
        0.85,
    ),
  };
}

export type ArapRules = {
  materialityAmount: string;
  longOverdueDays: number;
};

export function toArapRules(resolved: Record<string, unknown>): ArapRules {
  return {
    materialityAmount: String(
      resolved.materialityAmount ?? resolved['arap.materialityAmount'] ?? '10000',
    ),
    longOverdueDays: Number(
      resolved.longOverdueDays ?? resolved['arap.longOverdueDays'] ?? 180,
    ),
  };
}

export type InvoiceOcrRules = {
  confidenceThreshold: number;
  amountTolerance: string;
  ocrMode: 'STRUCTURED_ONLY' | 'MANUAL' | string;
};

export function toInvoiceOcrRules(resolved: Record<string, unknown>): InvoiceOcrRules {
  return {
    confidenceThreshold: Number(
      resolved.confidenceThreshold ?? resolved['invoice.confidenceThreshold'] ?? 0.8,
    ),
    amountTolerance: String(
      resolved.amountTolerance ?? resolved['invoice.amountTolerance'] ?? '0.01',
    ),
    ocrMode: String(resolved.ocrMode ?? resolved['invoice.ocrMode'] ?? 'STRUCTURED_ONLY'),
  };
}

export type OperatingSummaryRules = {
  periodMode: 'MONTH' | 'WEEK';
  allocationMethod: 'DIRECT' | 'REVENUE_SHARE' | 'FIXED_RATIO';
  materialityRate: number;
};

export function toOperatingSummaryRules(resolved: Record<string, unknown>): OperatingSummaryRules {
  const period = String(resolved.periodMode ?? resolved['operating.periodMode'] ?? 'MONTH').toUpperCase();
  const method = String(
    resolved.allocationMethod ?? resolved['operating.allocationMethod'] ?? 'REVENUE_SHARE',
  ).toUpperCase();
  return {
    periodMode: period === 'WEEK' ? 'WEEK' : 'MONTH',
    allocationMethod:
      method === 'DIRECT' || method === 'FIXED_RATIO' ? method : 'REVENUE_SHARE',
    materialityRate: Number(
      resolved.materialityRate ?? resolved['operating.materialityRate'] ?? 0.1,
    ),
  };
}

export type OrderCleanRules = {
  orderUniqueRule: string;
  phoneMasking: boolean;
  addressRequiredFields: string[];
  amountTolerance: string;
};

export function toOrderCleanRules(resolved: Record<string, unknown>): OrderCleanRules {
  const fields =
    resolved.addressRequiredFields ?? resolved['ecom.addressRequiredFields'] ?? [
      'receiverName',
      'phone',
      'address',
    ];
  return {
    orderUniqueRule: String(
      resolved.orderUniqueRule ?? resolved['ecom.orderUniqueRule'] ?? 'PLATFORM_ORDER_LINE',
    ),
    phoneMasking:
      resolved.phoneMasking === undefined && resolved['ecom.phoneMasking'] === undefined
        ? true
        : Boolean(resolved.phoneMasking ?? resolved['ecom.phoneMasking']),
    addressRequiredFields: Array.isArray(fields)
      ? fields.map(String)
      : String(fields)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
    amountTolerance: String(
      resolved.amountTolerance ?? resolved['ecom.amountTolerance'] ?? '0.01',
    ),
  };
}

export type RefundRules = {
  allowNoReturnReasons: string[];
  maxProcessingDays: number;
  amountTolerance: string;
  requireRestock: boolean;
};

export function toRefundRules(resolved: Record<string, unknown>): RefundRules {
  const reasons =
    resolved.allowNoReturnReasons ??
    resolved['refund.allowNoReturnReasons'] ?? ['仅退款', '缺货', '未发货退款', 'NO_RETURN'];
  return {
    allowNoReturnReasons: Array.isArray(reasons) ? reasons.map(String) : [String(reasons)],
    maxProcessingDays: Number(
      resolved.maxProcessingDays ?? resolved['refund.maxProcessingDays'] ?? 7,
    ),
    amountTolerance: String(
      resolved.amountTolerance ?? resolved['refund.amountTolerance'] ?? '0.01',
    ),
    requireRestock:
      resolved.requireRestock === undefined && resolved['refund.requireRestock'] === undefined
        ? true
        : Boolean(resolved.requireRestock ?? resolved['refund.requireRestock']),
  };
}

export type ProductDataRules = {
  requiredAttributes: string[];
  lowSalesDays: number;
  daysOfInventoryThreshold: number;
  marginThreshold: number;
};

export function toProductDataRules(resolved: Record<string, unknown>): ProductDataRules {
  const attrs =
    resolved.requiredAttributes ??
    resolved['product.requiredAttributes'] ?? ['productName', 'price', 'status'];
  return {
    requiredAttributes: Array.isArray(attrs) ? attrs.map(String) : [String(attrs)],
    lowSalesDays: Number(resolved.lowSalesDays ?? resolved['product.lowSalesDays'] ?? 30),
    daysOfInventoryThreshold: Number(
      resolved.daysOfInventoryThreshold ?? resolved['product.daysOfInventoryThreshold'] ?? 90,
    ),
    marginThreshold: Number(
      resolved.marginThreshold ?? resolved['product.marginThreshold'] ?? 0.1,
    ),
  };
}

export type LiveOrderRules = {
  oversellPolicy: string;
  cancelWindowMinutes: number;
  sessionMatchRule: string;
};

export function toLiveOrderRules(resolved: Record<string, unknown>): LiveOrderRules {
  return {
    oversellPolicy: String(
      resolved.oversellPolicy ?? resolved['live.oversellPolicy'] ?? 'FLAG_ONLY',
    ),
    cancelWindowMinutes: Number(
      resolved.cancelWindowMinutes ?? resolved['live.cancelWindowMinutes'] ?? 30,
    ),
    sessionMatchRule: String(
      resolved.sessionMatchRule ?? resolved['live.sessionMatchRule'] ?? 'SESSION_ID_FIRST',
    ),
  };
}

export type SalesSummaryRules = {
  period: 'DAY' | 'WEEK' | 'MONTH';
  revenueRecognitionRule: string;
  refundAttributionRule: string;
  orderCountRule: string;
};

export function toSalesSummaryRules(resolved: Record<string, unknown>): SalesSummaryRules {
  const period = String(resolved.period ?? resolved['sales.period'] ?? 'MONTH').toUpperCase();
  return {
    period: period === 'DAY' || period === 'WEEK' ? period : 'MONTH',
    revenueRecognitionRule: String(
      resolved.revenueRecognitionRule ??
        resolved['sales.revenueRecognitionRule'] ??
        'ORDER_DATE',
    ),
    refundAttributionRule: String(
      resolved.refundAttributionRule ??
        resolved['sales.refundAttributionRule'] ??
        'ORDER_DATE',
    ),
    orderCountRule: String(
      resolved.orderCountRule ?? resolved['sales.orderCountRule'] ?? 'DISTINCT_ORDER_NO',
    ),
  };
}

export type LogInventoryRules = {
  matchRule: string;
  qtyTolerance: string;
};

export function toLogInventoryRules(resolved: Record<string, unknown>): LogInventoryRules {
  return {
    matchRule: String(
      resolved.matchRule ?? resolved['log.inventory.matchRule'] ?? 'SKU_WAREHOUSE',
    ),
    qtyTolerance: String(
      resolved.qtyTolerance ?? resolved['log.inventory.qtyTolerance'] ?? '0',
    ),
  };
}

export type LogInoutRules = {
  qtyTolerance: string;
  dateToleranceDays: number;
};

export function toLogInoutRules(resolved: Record<string, unknown>): LogInoutRules {
  return {
    qtyTolerance: String(resolved.qtyTolerance ?? resolved['log.inout.qtyTolerance'] ?? '0'),
    dateToleranceDays: Number(
      resolved.dateToleranceDays ?? resolved['log.inout.dateToleranceDays'] ?? 1,
    ),
  };
}

export type LogTrackRules = {
  delayHours: number;
  staleHours: number;
};

export function toLogTrackRules(resolved: Record<string, unknown>): LogTrackRules {
  return {
    delayHours: Number(resolved.delayHours ?? resolved['log.track.delayHours'] ?? 24),
    staleHours: Number(resolved.staleHours ?? resolved['log.track.staleHours'] ?? 72),
  };
}

export type LogAlertRules = {
  lowStockDays: number;
  overstockDays: number;
};

export function toLogAlertRules(resolved: Record<string, unknown>): LogAlertRules {
  return {
    lowStockDays: Number(resolved.lowStockDays ?? resolved['log.alert.lowStockDays'] ?? 7),
    overstockDays: Number(resolved.overstockDays ?? resolved['log.alert.overstockDays'] ?? 90),
  };
}

export type LogTransferRules = {
  inTransitDays: number;
  qtyTolerance: string;
};

export function toLogTransferRules(resolved: Record<string, unknown>): LogTransferRules {
  return {
    inTransitDays: Number(
      resolved.inTransitDays ?? resolved['log.transfer.inTransitDays'] ?? 7,
    ),
    qtyTolerance: String(
      resolved.qtyTolerance ?? resolved['log.transfer.qtyTolerance'] ?? '0',
    ),
  };
}

export type AdminAssetRules = {
  matchRule: 'ASSET_CODE' | 'QR_CODE';
  idleDays: number;
  expiryWarningDays: number;
  allowedStatuses: string[];
};

export function toAdminAssetRules(resolved: Record<string, unknown>): AdminAssetRules {
  const statuses =
    resolved.allowedStatuses ??
    resolved['asset.allowedStatuses'] ?? [
      'IN_USE',
      'IDLE',
      'DAMAGED',
      'IN_REPAIR',
      'SCRAPPED',
      '在用',
      '闲置',
      '损坏',
      '维修中',
      '报废',
    ];
  const match = String(resolved.matchRule ?? resolved['asset.matchRule'] ?? 'ASSET_CODE').toUpperCase();
  return {
    matchRule: match === 'QR_CODE' ? 'QR_CODE' : 'ASSET_CODE',
    idleDays: Number(resolved.idleDays ?? resolved['asset.idleDays'] ?? 90),
    expiryWarningDays: Number(
      resolved.expiryWarningDays ?? resolved['asset.expiryWarningDays'] ?? 30,
    ),
    allowedStatuses: Array.isArray(statuses) ? statuses.map(String) : [String(statuses)],
  };
}

export type AdminExpenseRules = {
  period: 'MONTH' | 'QUARTER' | 'WEEK';
  materialityRate: number;
  perCapitaMetrics: boolean;
};

export function toAdminExpenseRules(resolved: Record<string, unknown>): AdminExpenseRules {
  const period = String(
    resolved.period ?? resolved['adminExpense.period'] ?? 'MONTH',
  ).toUpperCase();
  return {
    period: period === 'QUARTER' || period === 'WEEK' ? period : 'MONTH',
    materialityRate: Number(
      resolved.materialityRate ?? resolved['adminExpense.materialityRate'] ?? 0.1,
    ),
    perCapitaMetrics:
      resolved.perCapitaMetrics === undefined &&
      resolved['adminExpense.perCapitaMetrics'] === undefined
        ? true
        : Boolean(resolved.perCapitaMetrics ?? resolved['adminExpense.perCapitaMetrics']),
  };
}

export type AdminRoomRules = {
  workingDays: number;
  minimumBookingMinutes: number;
  noShowGraceMinutes: number;
  useCheckinAsActual: boolean;
};

export function toAdminRoomRules(resolved: Record<string, unknown>): AdminRoomRules {
  return {
    workingDays: Number(resolved.workingDays ?? resolved['room.workingDays'] ?? 5),
    minimumBookingMinutes: Number(
      resolved.minimumBookingMinutes ?? resolved['room.minimumBookingMinutes'] ?? 30,
    ),
    noShowGraceMinutes: Number(
      resolved.noShowGraceMinutes ?? resolved['room.noShowGraceMinutes'] ?? 15,
    ),
    useCheckinAsActual:
      resolved.useCheckinAsActual === undefined &&
      resolved['room.useCheckinAsActual'] === undefined
        ? true
        : Boolean(resolved.useCheckinAsActual ?? resolved['room.useCheckinAsActual']),
  };
}

export type AdminContractRules = {
  warningDays: number;
  autoRenewNoticeDays: number;
  materialAmount: string;
  requiredFields: string[];
};

export function toAdminContractRules(resolved: Record<string, unknown>): AdminContractRules {
  const fields =
    resolved.requiredFields ??
    resolved['contract.requiredFields'] ?? [
      'contractNo',
      'contractName',
      'counterparty',
      'startDate',
      'endDate',
      'owner',
      'amount',
    ];
  return {
    warningDays: Number(resolved.warningDays ?? resolved['contract.warningDays'] ?? 30),
    autoRenewNoticeDays: Number(
      resolved.autoRenewNoticeDays ?? resolved['contract.autoRenewNoticeDays'] ?? 60,
    ),
    materialAmount: String(
      resolved.materialAmount ?? resolved['contract.materialAmount'] ?? '10000',
    ),
    requiredFields: Array.isArray(fields) ? fields.map(String) : [String(fields)],
  };
}
