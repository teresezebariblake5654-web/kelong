export type RuleFieldType = 'number' | 'decimal-string' | 'boolean' | 'enum' | 'text' | 'readonly';

export type RuleFieldSchema = {
  key: string;
  label: string;
  type: RuleFieldType;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  min?: number;
  max?: number;
  /** 存储为 0–1，界面按百分比编辑（如 5 表示 5%） */
  percent?: boolean;
  /** 输入框下方提示 */
  hint?: string;
};

export type RuleSource = 'defaults' | 'company' | 'runtime';

const NON_ACTION_AUTO_RULE_KEYS = new Set(['autoRenewNoticeDays']);

/** 自动执行动作不是公司可配置规则，不在规则界面或生效规则详情中展示。 */
export function isAutomaticExecutionRuleKey(key: string): boolean {
  if (key.startsWith('safety.')) return true;
  const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  return /^auto[A-Z]/.test(leaf) && !NON_ACTION_AUTO_RULE_KEYS.has(leaf);
}

const PAYROLL_FIELDS: RuleFieldSchema[] = [
  { key: 'standardPayableDays', label: '标准应出勤天数', type: 'number', required: true, min: 1, max: 31 },
  { key: 'overtimeMultiplier', label: '加班倍率', type: 'number', required: true, min: 0 },
  { key: 'lateDeductionPerMinute', label: '迟到每分钟扣款', type: 'decimal-string', required: true },
  {
    key: 'absenceDeductionMode',
    label: '缺勤扣款模式',
    type: 'enum',
    options: [
      { value: 'DAILY_SALARY', label: '按日薪' },
      { value: 'FIXED', label: '固定金额' },
    ],
  },
  { key: 'roundingScale', label: '金额小数位', type: 'number', required: true, min: 0, max: 6 },
  { key: 'negativeNetPayBlocked', label: '禁止负工资', type: 'boolean' },
  {
    key: 'payrollChangeWarningRate',
    label: '净工资环比预警比例',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 5 表示 5%',
  },
];

const ATTENDANCE_FIELDS: RuleFieldSchema[] = [
  { key: 'lateGraceMinutes', label: '迟到宽限分钟', type: 'number', min: 0 },
  { key: 'earlyLeaveGraceMinutes', label: '早退宽限分钟', type: 'number', min: 0 },
  {
    key: 'missingPunchRule',
    label: '缺卡规则',
    type: 'enum',
    options: [
      { value: 'ABSENT', label: '记旷工' },
      { value: 'EXCEPTION', label: '记异常' },
      { value: 'IGNORE_ONCE', label: '首次忽略' },
    ],
  },
  { key: 'overtimeMinimumMinutes', label: '加班最少分钟', type: 'number', min: 0 },
  { key: 'maxWorkedMinutes', label: '最大连续工作分钟', type: 'number', min: 1 },
];

const SOCIAL_FIELDS: RuleFieldSchema[] = [
  { key: 'region', label: '地区', type: 'text' },
  { key: 'policyVersion', label: '政策版本', type: 'text', required: true },
  { key: 'effectiveDate', label: '生效日期', type: 'text' },
  { key: 'minBase', label: '社保基数下限', type: 'decimal-string' },
  { key: 'maxBase', label: '社保基数上限', type: 'decimal-string' },
  { key: 'minFundBase', label: '公积金基数下限', type: 'decimal-string' },
  { key: 'maxFundBase', label: '公积金基数上限', type: 'decimal-string' },
  {
    key: 'employeeInsuranceRate',
    label: '员工社保费率',
    type: 'decimal-string',
    hint: '小数，如 0.105=10.5%',
  },
  {
    key: 'companyInsuranceRate',
    label: '公司社保费率',
    type: 'decimal-string',
    hint: '小数，如 0.27=27%',
  },
  {
    key: 'employeeFundRate',
    label: '员工公积金费率',
    type: 'decimal-string',
    hint: '小数，如 0.12=12%',
  },
  {
    key: 'companyFundRate',
    label: '公司公积金费率',
    type: 'decimal-string',
    hint: '小数，如 0.12=12%',
  },
];

const PERFORMANCE_FIELDS: RuleFieldSchema[] = [
  {
    key: 'groupBy',
    label: '分组方式',
    type: 'enum',
    options: [
      { value: 'department', label: '部门' },
      { value: 'department,level', label: '部门+职级' },
      { value: 'level', label: '职级' },
    ],
  },
  { key: 'minimumGroupSize', label: '最小样本数', type: 'number', min: 1 },
  {
    key: 'outlierMethod',
    label: '离群识别方法',
    type: 'enum',
    options: [
      { value: 'ZSCORE', label: 'Z分数' },
      { value: 'IQR', label: '四分位距' },
    ],
  },
  {
    key: 'ratingBands',
    label: '评级区间',
    type: 'text',
    hint: 'JSON 数组，如 [{"rating":"A","minScore":90,"maxScore":100}]',
  },
];

const EXPENSE_FIELDS: RuleFieldSchema[] = [
  { key: 'duplicateWindowDays', label: '重复判定窗口(天)', type: 'number', required: true, min: 0 },
  { key: 'amountTolerance', label: '金额容差', type: 'decimal-string', required: true },
  { key: 'defaultAccount', label: '默认科目', type: 'text' },
  { key: 'receiptRequired', label: '默认需要发票', type: 'boolean' },
];

const RECONCILIATION_FIELDS: RuleFieldSchema[] = [
  { key: 'dateToleranceDays', label: '日期容差(天)', type: 'number', required: true, min: 0 },
  { key: 'amountTolerance', label: '金额容差', type: 'decimal-string', required: true },
  { key: 'allowManyToOne', label: '允许多对一', type: 'boolean' },
  { key: 'allowOneToMany', label: '允许一对多', type: 'boolean' },
  { key: 'maxSubsetSize', label: '组合匹配上限', type: 'number', min: 1, max: 8 },
  {
    key: 'highConfidenceThreshold',
    label: '高置信阈值',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 85 表示 85%',
  },
];

const ARAP_FIELDS: RuleFieldSchema[] = [
  { key: 'materialityAmount', label: '重要性金额', type: 'decimal-string', required: true },
  { key: 'longOverdueDays', label: '长期逾期天数', type: 'number', required: true, min: 1 },
];

const INVOICE_FIELDS: RuleFieldSchema[] = [
  {
    key: 'confidenceThreshold',
    label: '置信度阈值',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 80 表示 80%',
  },
  { key: 'amountTolerance', label: '金额容差', type: 'decimal-string', required: true },
  {
    key: 'ocrMode',
    label: '识别模式',
    type: 'enum',
    options: [
      { value: 'STRUCTURED_ONLY', label: '仅结构化（推荐）' },
      { value: 'MANUAL', label: '人工录入' },
    ],
  },
];

const OPERATING_FIELDS: RuleFieldSchema[] = [
  {
    key: 'periodMode',
    label: '期间模式',
    type: 'enum',
    options: [
      { value: 'MONTH', label: '按月' },
      { value: 'WEEK', label: '按周' },
    ],
  },
  {
    key: 'allocationMethod',
    label: '费用分摊方式',
    type: 'enum',
    options: [
      { value: 'REVENUE_SHARE', label: '按收入占比' },
      { value: 'FIXED_RATIO', label: '固定比例' },
      { value: 'DIRECT', label: '直接归属' },
    ],
  },
  {
    key: 'materialityRate',
    label: '重大差异阈值',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 10 表示 10%',
  },
];

const ORDER_CLEAN_FIELDS: RuleFieldSchema[] = [
  {
    key: 'orderUniqueRule',
    label: '订单唯一规则',
    type: 'enum',
    options: [
      { value: 'PLATFORM_ORDER_LINE', label: '平台+订单号+行' },
      { value: 'ORDER_LINE', label: '订单号+行' },
      { value: 'ORDER_NO', label: '仅订单号' },
    ],
  },
  { key: 'phoneMasking', label: '手机号脱敏', type: 'boolean' },
  { key: 'amountTolerance', label: '金额容差', type: 'decimal-string', required: true },
];

const REFUND_FIELDS: RuleFieldSchema[] = [
  { key: 'maxProcessingDays', label: '最长处理天数', type: 'number', min: 1 },
  { key: 'amountTolerance', label: '金额容差', type: 'decimal-string', required: true },
  { key: 'requireRestock', label: '要求退货入库', type: 'boolean' },
];

const PRODUCT_DATA_FIELDS: RuleFieldSchema[] = [
  { key: 'lowSalesDays', label: '滞销天数阈值', type: 'number', min: 1 },
  { key: 'daysOfInventoryThreshold', label: '库存天数阈值', type: 'number', min: 1 },
  {
    key: 'marginThreshold',
    label: '毛利率阈值',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 20 表示 20%',
  },
];

const LIVE_ORDER_FIELDS: RuleFieldSchema[] = [
  {
    key: 'oversellPolicy',
    label: '超卖策略',
    type: 'enum',
    options: [
      { value: 'FLAG_ONLY', label: '仅标记' },
      { value: 'BLOCK_READY', label: '阻塞可发货' },
    ],
  },
  { key: 'cancelWindowMinutes', label: '取消窗口(分钟)', type: 'number', min: 0 },
  {
    key: 'sessionMatchRule',
    label: '场次匹配规则',
    type: 'enum',
    options: [
      { value: 'SESSION_ID_FIRST', label: '优先场次ID' },
      { value: 'TIME_WINDOW', label: '时间窗匹配' },
    ],
  },
];

const SALES_SUMMARY_FIELDS: RuleFieldSchema[] = [
  {
    key: 'period',
    label: '汇总周期',
    type: 'enum',
    options: [
      { value: 'DAY', label: '按日' },
      { value: 'WEEK', label: '按周' },
      { value: 'MONTH', label: '按月' },
    ],
  },
  {
    key: 'orderCountRule',
    label: '订单计数规则',
    type: 'enum',
    options: [
      { value: 'DISTINCT_ORDER_NO', label: '去重订单号' },
      { value: 'ORDER_LINE', label: '按订单行' },
    ],
  },
];

const MATERIAL_DAILY_FIELDS: RuleFieldSchema[] = [
  { key: 'materialDaily.toleranceQty', label: '数量容差', type: 'number', min: 0 },
  { key: 'materialDaily.toleranceRate', label: '比例容差', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 5 表示 5%' },
  { key: 'materialDaily.negativeStockBlocked', label: '禁止负库存', type: 'boolean' },
];

const CONSUMPTION_FIELDS: RuleFieldSchema[] = [
  { key: 'defaultLossRate', label: '默认损耗率', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 3 表示 3%' },
  { key: 'overuseToleranceRate', label: '超领容差比例', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 5 表示 5%' },
  { key: 'underuseToleranceRate', label: '少领容差比例', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 5 表示 5%' },
  { key: 'allowSubstituteMaterial', label: '允许替代料', type: 'boolean' },
];

const PLAN_CLEAN_FIELDS: RuleFieldSchema[] = [
  {
    key: 'priorityRule',
    label: '优先级规则',
    type: 'enum',
    options: [
      { value: 'DUE_DATE', label: '按交期' },
      { value: 'CUSTOMER_PRIORITY_THEN_DUE_DATE', label: '客户优先级再交期' },
    ],
  },
  { key: 'freezeDays', label: '冻结天数', type: 'number', min: 0 },
  { key: 'defaultLeadDays', label: '默认交期天数', type: 'number', min: 0 },
  { key: 'allowOverPlanRate', label: '允许超计划比例', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 10 表示 10%' },
  { key: 'capacityCheckEnabled', label: '启用产能检查', type: 'boolean' },
  {
    key: 'duplicateStrategy',
    label: '重复计划策略',
    type: 'enum',
    options: [
      { value: 'VERSION_THEN_UPDATED_AT', label: '版本优先，其次更新时间' },
      { value: 'UPDATED_AT_ONLY', label: '仅按更新时间' },
    ],
  },
  {
    key: 'excelDateSystem',
    label: 'Excel 日期系统',
    type: 'enum',
    options: [
      { value: '1900', label: '1900 系统' },
      { value: '1904', label: '1904 系统' },
    ],
  },
];

const PROGRESS_FIELDS: RuleFieldSchema[] = [
  { key: 'delayWarningDays', label: '延期预警天数', type: 'number', min: 0 },
  { key: 'maxScrapRate', label: '最大报废率', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 5 表示 5%' },
  { key: 'defaultWorkdayHours', label: '默认工时(小时/天)', type: 'number', min: 1 },
  { key: 'allowedOverproductionRate', label: '允许超产比例', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 10 表示 10%' },
  { key: 'noReportWarningDays', label: '无报工预警天数', type: 'number', min: 0 },
  { key: 'useWorkCalendar', label: '使用工作日历', type: 'boolean' },
];

const QUALITY_FIELDS: RuleFieldSchema[] = [
  { key: 'failRateThreshold', label: '不合格率阈值', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 5 表示 5%' },
  { key: 'missingStandardBlocksRelease', label: '缺标准则禁止放行', type: 'boolean' },
  {
    key: 'duplicateInspectionStrategy',
    label: '重复检验策略',
    type: 'enum',
    options: [
      { value: 'LATEST', label: '取最新' },
      { value: 'BLOCK', label: '直接阻塞' },
    ],
  },
  { key: 'paretoThreshold', label: '帕累托阈值', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 80 表示 80%' },
];

const DOWNTIME_FIELDS: RuleFieldSchema[] = [
  { key: 'defaultUnitsPerHour', label: '默认小时产量', type: 'number', min: 0 },
  {
    key: 'outputToleranceRate',
    label: '产量容差比例',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 5 表示 5%',
  },
  {
    key: 'materialToleranceRate',
    label: '物料容差比例',
    type: 'number',
    min: 0,
    max: 1,
    percent: true,
    hint: '按百分比填写，如 5 表示 5%',
  },
  { key: 'requireMaterialBalanced', label: '要求物料平衡', type: 'boolean' },
  { key: 'requireNoOpenQualityIssue', label: '要求无未关闭质量问题', type: 'boolean' },
  { key: 'requireNoCriticalQualityIssue', label: '要求无严重质量问题', type: 'boolean' },
  {
    key: 'overlapStrategy',
    label: '停机重叠策略',
    type: 'enum',
    options: [
      { value: 'BLOCK', label: '重叠则阻塞' },
      { value: 'MERGE_FOR_NET_DURATION', label: '合并净时长' },
    ],
  },
  { key: 'timezone', label: '时区', type: 'text' },
];

const EMPLOYEE_FILE_FIELDS: RuleFieldSchema[] = [
  { key: 'expiryWarningDays', label: '到期预警天数', type: 'number', min: 1 },
  {
    key: 'matchRule',
    label: '匹配规则',
    type: 'enum',
    options: [
      { value: 'EMPLOYEE_ID', label: '按员工编号' },
      { value: 'ID_NUMBER', label: '按身份证号' },
      { value: 'PHONE', label: '按手机号' },
      { value: 'NAME_HIRE_DATE', label: '按姓名+入职日期' },
    ],
  },
];

const ONBOARD_FIELDS: RuleFieldSchema[] = [
  { key: 'reminderDays', label: '提醒提前天数', type: 'number', min: 0 },
];

const RECRUITMENT_FIELDS: RuleFieldSchema[] = [
  { key: 'staleDays', label: '停滞天数阈值', type: 'number', min: 1 },
];

const LOG_INVENTORY_FIELDS: RuleFieldSchema[] = [
  {
    key: 'matchRule',
    label: '匹配规则',
    type: 'enum',
    options: [
      { value: 'SKU_WAREHOUSE', label: 'SKU + 仓库' },
      { value: 'SKU_ONLY', label: '仅 SKU' },
    ],
  },
  { key: 'qtyTolerance', label: '数量容差', type: 'decimal-string', required: true },
];

const LOG_INOUT_FIELDS: RuleFieldSchema[] = [
  { key: 'qtyTolerance', label: '数量容差', type: 'decimal-string', required: true },
  { key: 'dateToleranceDays', label: '日期容差(天)', type: 'number', min: 0 },
];

const LOG_TRACK_FIELDS: RuleFieldSchema[] = [
  { key: 'delayHours', label: '延误小时阈值', type: 'number', min: 0 },
  { key: 'staleHours', label: '停滞小时阈值', type: 'number', min: 0 },
];

const LOG_ALERT_FIELDS: RuleFieldSchema[] = [
  { key: 'lowStockDays', label: '低库存天数阈值', type: 'number', min: 1 },
  { key: 'overstockDays', label: '积压天数阈值', type: 'number', min: 1 },
];

const LOG_TRANSFER_FIELDS: RuleFieldSchema[] = [
  { key: 'inTransitDays', label: '在途超时天数', type: 'number', min: 1 },
  { key: 'qtyTolerance', label: '数量容差', type: 'decimal-string', required: true },
];

const ADMIN_ASSET_FIELDS: RuleFieldSchema[] = [
  {
    key: 'matchRule',
    label: '资产匹配规则',
    type: 'enum',
    options: [
      { value: 'ASSET_CODE', label: '按资产编号' },
      { value: 'QR_CODE', label: '按二维码' },
    ],
  },
  { key: 'idleDays', label: '闲置天数阈值', type: 'number', min: 1 },
  { key: 'expiryWarningDays', label: '维保到期预警天数', type: 'number', min: 1 },
];

const ADMIN_EXPENSE_FIELDS: RuleFieldSchema[] = [
  {
    key: 'period',
    label: '汇总周期',
    type: 'enum',
    options: [
      { value: 'MONTH', label: '按月' },
      { value: 'QUARTER', label: '按季' },
      { value: 'WEEK', label: '按周' },
    ],
  },
  { key: 'materialityRate', label: '重大差异阈值', type: 'number', min: 0, max: 1, percent: true, hint: '按百分比填写，如 10 表示 10%' },
  { key: 'perCapitaMetrics', label: '启用人均费用指标', type: 'boolean' },
];

const ADMIN_ROOM_FIELDS: RuleFieldSchema[] = [
  { key: 'workingDays', label: '每周工作日数', type: 'number', min: 1, max: 7 },
  { key: 'minimumBookingMinutes', label: '最短预订分钟', type: 'number', min: 1 },
  { key: 'noShowGraceMinutes', label: '爽约宽限分钟', type: 'number', min: 0 },
  { key: 'useCheckinAsActual', label: '以签到作为实际使用', type: 'boolean' },
];

const ADMIN_CONTRACT_FIELDS: RuleFieldSchema[] = [
  { key: 'warningDays', label: '到期预警天数', type: 'number', min: 1 },
  { key: 'autoRenewNoticeDays', label: '续约提醒天数', type: 'number', min: 1 },
  { key: 'materialAmount', label: '重大合同金额', type: 'decimal-string', required: true },
];

/** 英文 key → 中文标签（兜底，避免界面直接露出英文键名） */
const RULE_KEY_LABELS: Record<string, string> = {
  'materialDaily.toleranceQty': '数量容差',
  'materialDaily.toleranceRate': '比例容差',
  'materialDaily.negativeStockBlocked': '禁止负库存',
  defaultLossRate: '默认损耗率',
  overuseToleranceRate: '超领容差比例',
  underuseToleranceRate: '少领容差比例',
  allowSubstituteMaterial: '允许替代料',
  priorityRule: '优先级规则',
  freezeDays: '冻结天数',
  defaultLeadDays: '默认交期天数',
  allowOverPlanRate: '允许超计划比例',
  capacityCheckEnabled: '启用产能检查',
  duplicateStrategy: '重复计划策略',
  excelDateSystem: 'Excel 日期系统',
  executableStatuses: '可执行状态',
  ignoredStatuses: '忽略状态',
  delayWarningDays: '延期预警天数',
  maxScrapRate: '最大报废率',
  defaultWorkdayHours: '默认工时(小时/天)',
  allowedOverproductionRate: '允许超产比例',
  noReportWarningDays: '无报工预警天数',
  useWorkCalendar: '使用工作日历',
  failRateThreshold: '不合格率阈值',
  criticalDefects: '关键缺陷',
  missingStandardBlocksRelease: '缺标准则禁止放行',
  duplicateInspectionStrategy: '重复检验策略',
  paretoThreshold: '帕累托阈值',
  defaultUnitsPerHour: '默认小时产量',
  outputToleranceRate: '产量容差比例',
  materialToleranceRate: '物料容差比例',
  requireMaterialBalanced: '要求物料平衡',
  requireNoOpenQualityIssue: '要求无未关闭质量问题',
  requireNoCriticalQualityIssue: '要求无严重质量问题',
  overlapStrategy: '停机重叠策略',
  timezone: '时区',
  minBase: '社保基数下限',
  maxBase: '社保基数上限',
  minFundBase: '公积金基数下限',
  maxFundBase: '公积金基数上限',
  insuranceMinBase: '社保基数下限',
  insuranceMaxBase: '社保基数上限',
  fundMinBase: '公积金基数下限',
  fundMaxBase: '公积金基数上限',
  employeeInsuranceRate: '员工社保费率',
  companyInsuranceRate: '公司社保费率',
  employeeFundRate: '员工公积金费率',
  companyFundRate: '公司公积金费率',
  groupBy: '分组方式',
  ratingBands: '评级区间',
  minimumGroupSize: '最小样本数',
  outlierMethod: '离群识别方法',
  expiryWarningDays: '到期预警天数',
  requiredDocuments: '必备资料',
  matchRule: '匹配规则',
  reminderDays: '提醒提前天数',
  blockingTasks: '阻塞任务',
  defaultOwners: '默认责任人',
  staleDays: '停滞天数阈值',
  stageOrder: '阶段顺序',
  duplicateMatchRule: '重复匹配规则',
  qtyTolerance: '数量容差',
  dateToleranceDays: '日期容差(天)',
  delayHours: '延误小时阈值',
  staleHours: '停滞小时阈值',
  lowStockDays: '低库存天数阈值',
  overstockDays: '积压天数阈值',
  inTransitDays: '在途超时天数',
  idleDays: '闲置天数阈值',
  allowedStatuses: '允许状态',
  period: '汇总周期',
  materialityRate: '重大差异阈值',
  perCapitaMetrics: '启用人均费用指标',
  workingDays: '每周工作日数',
  minimumBookingMinutes: '最短预订分钟',
  noShowGraceMinutes: '爽约宽限分钟',
  useCheckinAsActual: '以签到作为实际使用',
  warningDays: '到期预警天数',
  autoRenewNoticeDays: '续约提醒天数',
  materialAmount: '重大合同金额',
  requiredFields: '必填字段',
  cloudUpload: '云端上传',
  autoAdjustStock: '自动调整库存',
  autoShip: '自动发货',
  autoCancel: '自动取消',
  autoPost: '自动过账',
  autoComplete: '自动完成',
  autoUpdateLedger: '自动更新台账',
  autoRenew: '自动续约',
  autoTerminate: '自动终止',
  autoDispose: '自动处置',
  autoReplenish: '自动补货',
  autoFulfill: '自动履约',
  autoRefund: '自动退款',
  autoCancelShipment: '自动取消运单',
  autoCompleteTransfer: '自动完成调拨',
};

const RULE_VALUE_LABELS: Record<string, string> = {
  true: '是',
  false: '否',
  DAILY_SALARY: '按日薪',
  FIXED: '固定金额',
  ABSENT: '记旷工',
  EXCEPTION: '记异常',
  IGNORE_ONCE: '首次忽略',
  department: '部门',
  department_level: '部门+职级',
  level: '职级',
  ZSCORE: 'Z分数',
  IQR: '四分位距',
  STRUCTURED_ONLY: '仅结构化',
  MANUAL: '人工录入',
  MONTH: '按月',
  QUARTER: '按季',
  YEAR: '按年',
  WEEK: '按周',
  DAY: '按日',
  REVENUE_SHARE: '按收入占比',
  FIXED_RATIO: '固定比例',
  DIRECT: '直接归属',
  PLATFORM_ORDER_LINE: '平台+订单号+行',
  ORDER_LINE: '订单号+行',
  ORDER_NO: '仅订单号',
  FLAG_ONLY: '仅标记',
  BLOCK_READY: '阻塞可发货',
  SESSION_ID_FIRST: '优先场次ID',
  TIME_WINDOW: '时间窗匹配',
  DISTINCT_ORDER_NO: '去重订单号',
  DUE_DATE: '按交期',
  CUSTOMER_PRIORITY_THEN_DUE_DATE: '客户优先级再交期',
  VERSION_THEN_UPDATED_AT: '版本优先，其次更新时间',
  UPDATED_AT_ONLY: '仅按更新时间',
  '1900': '1900 系统',
  '1904': '1904 系统',
  LATEST: '取最新',
  BLOCK: '直接阻塞',
  MERGE_FOR_NET_DURATION: '合并净时长',
  EMPLOYEE_ID: '按员工编号',
  ID_NUMBER: '按身份证号',
  PHONE: '按手机号',
  NAME_HIRE_DATE: '按姓名+入职日期',
  ASSET_CODE: '按资产编号',
  QR_CODE: '按二维码',
  SKU_WAREHOUSE: 'SKU + 仓库',
  SKU_ONLY: '仅 SKU',
  ORDER_DATE: '按下单日',
  idCard: '身份证',
  contract: '合同',
  bankAccount: '银行账户',
};

const KEY_ALIASES: Record<string, string[]> = {
  standardPayableDays: ['standardPayableDays', 'payroll.payableDays', 'payableDays'],
  overtimeMultiplier: ['overtimeMultiplier', 'payroll.overtimeMultiplier'],
  lateDeductionPerMinute: ['lateDeductionPerMinute', 'payroll.lateDeductionRule'],
  absenceDeductionMode: ['absenceDeductionMode'],
  roundingScale: ['roundingScale', 'payroll.roundingScale'],
  negativeNetPayBlocked: ['negativeNetPayBlocked'],
  payrollChangeWarningRate: ['payrollChangeWarningRate'],
  lateGraceMinutes: ['lateGraceMinutes', 'attendance.lateGraceMinutes'],
  earlyLeaveGraceMinutes: ['earlyLeaveGraceMinutes', 'attendance.earlyLeaveGraceMinutes'],
  missingPunchRule: ['missingPunchRule', 'attendance.missingPunchRule'],
  overtimeMinimumMinutes: ['overtimeMinimumMinutes', 'attendance.overtimeMinimumMinutes'],
  maxWorkedMinutes: ['maxWorkedMinutes'],
  region: ['region'],
  policyVersion: ['policyVersion', 'version'],
  effectiveDate: ['effectiveDate'],
  minBase: ['minBase', 'insuranceMinBase', 'social.minBase'],
  maxBase: ['maxBase', 'insuranceMaxBase', 'social.maxBase'],
  minFundBase: ['minFundBase', 'fundMinBase'],
  maxFundBase: ['maxFundBase', 'fundMaxBase'],
  employeeInsuranceRate: ['employeeInsuranceRate'],
  companyInsuranceRate: ['companyInsuranceRate'],
  employeeFundRate: ['employeeFundRate'],
  companyFundRate: ['companyFundRate'],
  groupBy: ['groupBy', 'performance.groupBy'],
  minimumGroupSize: ['minimumGroupSize', 'performance.minimumGroupSize'],
  outlierMethod: ['outlierMethod', 'performance.outlierMethod'],
  ratingBands: ['ratingBands', 'performance.ratingBands'],
  duplicateWindowDays: ['duplicateWindowDays', 'expense.duplicateWindowDays'],
  amountTolerance: [
    'amountTolerance',
    'expense.amountTolerance',
    'reconciliation.amountTolerance',
    'invoice.amountTolerance',
    'ecom.amountTolerance',
    'refund.amountTolerance',
  ],
  defaultAccount: ['defaultAccount', 'expense.defaultAccount'],
  receiptRequired: ['receiptRequired', 'expense.receiptRequired'],
  dateToleranceDays: ['dateToleranceDays', 'reconciliation.dateToleranceDays'],
  allowManyToOne: ['allowManyToOne', 'reconciliation.allowManyToOne'],
  allowOneToMany: ['allowOneToMany', 'reconciliation.allowOneToMany'],
  maxSubsetSize: ['maxSubsetSize', 'reconciliation.maxSubsetSize'],
  highConfidenceThreshold: ['highConfidenceThreshold', 'reconciliation.highConfidenceThreshold'],
  materialityAmount: ['materialityAmount', 'arap.materialityAmount'],
  longOverdueDays: ['longOverdueDays', 'arap.longOverdueDays'],
  confidenceThreshold: ['confidenceThreshold', 'invoice.confidenceThreshold'],
  ocrMode: ['ocrMode', 'invoice.ocrMode'],
  periodMode: ['periodMode', 'operating.periodMode'],
  allocationMethod: ['allocationMethod', 'operating.allocationMethod'],
  materialityRate: ['materialityRate', 'operating.materialityRate'],
  orderUniqueRule: ['orderUniqueRule', 'ecom.orderUniqueRule'],
  phoneMasking: ['phoneMasking', 'ecom.phoneMasking'],
  maxProcessingDays: ['maxProcessingDays', 'refund.maxProcessingDays'],
  requireRestock: ['requireRestock', 'refund.requireRestock'],
  lowSalesDays: ['lowSalesDays', 'product.lowSalesDays'],
  daysOfInventoryThreshold: ['daysOfInventoryThreshold', 'product.daysOfInventoryThreshold'],
  marginThreshold: ['marginThreshold', 'product.marginThreshold'],
  oversellPolicy: ['oversellPolicy', 'live.oversellPolicy'],
  cancelWindowMinutes: ['cancelWindowMinutes', 'live.cancelWindowMinutes'],
  sessionMatchRule: ['sessionMatchRule', 'live.sessionMatchRule'],
  period: ['period', 'sales.period', 'adminExpense.period'],
  orderCountRule: ['orderCountRule', 'sales.orderCountRule'],
  'materialDaily.toleranceQty': ['materialDaily.toleranceQty', 'toleranceQty'],
  'materialDaily.toleranceRate': ['materialDaily.toleranceRate', 'toleranceRate'],
  'materialDaily.negativeStockBlocked': [
    'materialDaily.negativeStockBlocked',
    'negativeStockBlocked',
  ],
  defaultLossRate: ['defaultLossRate', 'consumption.defaultLossRate'],
  overuseToleranceRate: ['overuseToleranceRate', 'consumption.overuseToleranceRate'],
  underuseToleranceRate: ['underuseToleranceRate', 'consumption.underuseToleranceRate'],
  allowSubstituteMaterial: ['allowSubstituteMaterial', 'consumption.allowSubstituteMaterial'],
  priorityRule: ['priorityRule', 'plan.priorityRule'],
  freezeDays: ['freezeDays', 'plan.freezeDays'],
  defaultLeadDays: ['defaultLeadDays', 'plan.defaultLeadDays'],
  allowOverPlanRate: ['allowOverPlanRate', 'plan.allowOverPlanRate'],
  capacityCheckEnabled: ['capacityCheckEnabled'],
  duplicateStrategy: ['duplicateStrategy'],
  excelDateSystem: ['excelDateSystem'],
  delayWarningDays: ['delayWarningDays'],
  maxScrapRate: ['maxScrapRate'],
  defaultWorkdayHours: ['defaultWorkdayHours'],
  allowedOverproductionRate: ['allowedOverproductionRate'],
  noReportWarningDays: ['noReportWarningDays'],
  useWorkCalendar: ['useWorkCalendar'],
  failRateThreshold: ['failRateThreshold'],
  missingStandardBlocksRelease: ['missingStandardBlocksRelease'],
  duplicateInspectionStrategy: ['duplicateInspectionStrategy'],
  paretoThreshold: ['paretoThreshold'],
  defaultUnitsPerHour: ['defaultUnitsPerHour'],
  outputToleranceRate: ['outputToleranceRate'],
  materialToleranceRate: ['materialToleranceRate'],
  requireMaterialBalanced: ['requireMaterialBalanced'],
  requireNoOpenQualityIssue: ['requireNoOpenQualityIssue'],
  requireNoCriticalQualityIssue: ['requireNoCriticalQualityIssue'],
  overlapStrategy: ['overlapStrategy'],
  timezone: ['timezone'],
  expiryWarningDays: ['expiryWarningDays', 'employee.expiryWarningDays', 'asset.expiryWarningDays'],
  matchRule: [
    'matchRule',
    'employee.matchRule',
    'asset.matchRule',
    'log.inventory.matchRule',
  ],
  reminderDays: ['reminderDays', 'onoffboard.reminderDays'],
  staleDays: ['staleDays', 'recruitment.staleDays'],
  qtyTolerance: [
    'qtyTolerance',
    'log.inventory.qtyTolerance',
    'log.inout.qtyTolerance',
    'log.transfer.qtyTolerance',
  ],
  delayHours: ['delayHours', 'log.track.delayHours'],
  staleHours: ['staleHours', 'log.track.staleHours'],
  lowStockDays: ['lowStockDays', 'log.alert.lowStockDays'],
  overstockDays: ['overstockDays', 'log.alert.overstockDays'],
  inTransitDays: ['inTransitDays', 'log.transfer.inTransitDays'],
  idleDays: ['idleDays', 'asset.idleDays'],
  perCapitaMetrics: ['perCapitaMetrics', 'adminExpense.perCapitaMetrics'],
  workingDays: ['workingDays', 'room.workingDays'],
  minimumBookingMinutes: ['minimumBookingMinutes', 'room.minimumBookingMinutes'],
  noShowGraceMinutes: ['noShowGraceMinutes', 'room.noShowGraceMinutes'],
  useCheckinAsActual: ['useCheckinAsActual', 'room.useCheckinAsActual'],
  warningDays: ['warningDays', 'contract.warningDays'],
  autoRenewNoticeDays: ['autoRenewNoticeDays', 'contract.autoRenewNoticeDays'],
  materialAmount: ['materialAmount', 'contract.materialAmount'],
};

/** 保存/执行前剔除 UI 只读安全锁，避免写入公司规则 */
export function stripSafetyLockRules(rules: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rules)) {
    if (key.startsWith('safety.')) continue;
    out[key] = value;
  }
  return out;
}

export function ruleFieldsForWorkflow(workflowId: string): RuleFieldSchema[] {
  let fields: RuleFieldSchema[] = [];
  if (workflowId === 'HR-PAYROLL-001') fields = PAYROLL_FIELDS;
  else if (workflowId === 'HR-ATTENDANCE-002') fields = ATTENDANCE_FIELDS;
  else if (workflowId === 'HR-EMPLOYEE-FILE-003') fields = EMPLOYEE_FILE_FIELDS;
  else if (workflowId === 'HR-ONBOARD-OFFBOARD-004') fields = ONBOARD_FIELDS;
  else if (workflowId === 'HR-SOCIAL-INSURANCE-005') fields = SOCIAL_FIELDS;
  else if (workflowId === 'HR-RECRUITMENT-FUNNEL-006') fields = RECRUITMENT_FIELDS;
  else if (workflowId === 'HR-PERFORMANCE-DISTRIBUTION-007') fields = PERFORMANCE_FIELDS;
  else if (workflowId === 'FIN-EXPENSE-CLEAN-001') fields = EXPENSE_FIELDS;
  else if (workflowId === 'FIN-RECONCILIATION-002') fields = RECONCILIATION_FIELDS;
  else if (workflowId === 'FIN-ARAP-003') fields = ARAP_FIELDS;
  else if (workflowId === 'FIN-INVOICE-OCR-004') fields = INVOICE_FIELDS;
  else if (workflowId === 'FIN-OPERATING-SUMMARY-005') fields = OPERATING_FIELDS;
  else if (workflowId === 'ECOM-ORDER-CLEAN-001') fields = ORDER_CLEAN_FIELDS;
  else if (workflowId === 'ECOM-REFUND-002') fields = REFUND_FIELDS;
  else if (workflowId === 'ECOM-PRODUCT-DATA-003') fields = PRODUCT_DATA_FIELDS;
  else if (workflowId === 'ECOM-LIVE-ORDER-004') fields = LIVE_ORDER_FIELDS;
  else if (workflowId === 'ECOM-SALES-SUMMARY-005') fields = SALES_SUMMARY_FIELDS;
  else if (workflowId === 'PROD-MATERIAL-DAILY-001') fields = MATERIAL_DAILY_FIELDS;
  else if (workflowId === 'PROD-CONSUMPTION-CHECK-002') fields = CONSUMPTION_FIELDS;
  else if (workflowId === 'PROD-PLAN-CLEAN-003') fields = PLAN_CLEAN_FIELDS;
  else if (workflowId === 'PROD-PROGRESS-004') fields = PROGRESS_FIELDS;
  else if (workflowId === 'PROD-QUALITY-005') fields = QUALITY_FIELDS;
  else if (workflowId === 'PROD-DOWNTIME-CLOSE-006') fields = DOWNTIME_FIELDS;
  else if (workflowId === 'LOG-INVENTORY-COUNT-001') fields = LOG_INVENTORY_FIELDS;
  else if (workflowId === 'LOG-INOUT-RECONCILE-002') fields = LOG_INOUT_FIELDS;
  else if (workflowId === 'LOG-SHIPMENT-TRACK-003') fields = LOG_TRACK_FIELDS;
  else if (workflowId === 'LOG-STOCK-ALERT-004') fields = LOG_ALERT_FIELDS;
  else if (workflowId === 'LOG-TRANSFER-CLEAN-005') fields = LOG_TRANSFER_FIELDS;
  else if (workflowId === 'ADMIN-ASSET-INVENTORY-001') fields = ADMIN_ASSET_FIELDS;
  else if (workflowId === 'ADMIN-EXPENSE-ANALYSIS-002') fields = ADMIN_EXPENSE_FIELDS;
  else if (workflowId === 'ADMIN-ROOM-UTILIZATION-003') fields = ADMIN_ROOM_FIELDS;
  else if (workflowId === 'ADMIN-CONTRACT-EXPIRY-004') fields = ADMIN_CONTRACT_FIELDS;
  return fields.filter((field) => !isAutomaticExecutionRuleKey(field.key));
}

/** 任意规则键的中文标签（含点号键与兜底） */
export function ruleKeyLabel(key: string): string {
  if (RULE_KEY_LABELS[key]) return RULE_KEY_LABELS[key]!;
  const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  if (RULE_KEY_LABELS[leaf]) return RULE_KEY_LABELS[leaf]!;
  // 已有 schema 字段时复用其 label
  for (const fields of [
    PAYROLL_FIELDS,
    ATTENDANCE_FIELDS,
    SOCIAL_FIELDS,
    PERFORMANCE_FIELDS,
    EXPENSE_FIELDS,
    RECONCILIATION_FIELDS,
    ARAP_FIELDS,
    INVOICE_FIELDS,
    OPERATING_FIELDS,
    ORDER_CLEAN_FIELDS,
    REFUND_FIELDS,
    PRODUCT_DATA_FIELDS,
    LIVE_ORDER_FIELDS,
    SALES_SUMMARY_FIELDS,
    MATERIAL_DAILY_FIELDS,
    CONSUMPTION_FIELDS,
    PLAN_CLEAN_FIELDS,
    PROGRESS_FIELDS,
    QUALITY_FIELDS,
    DOWNTIME_FIELDS,
    EMPLOYEE_FILE_FIELDS,
    ONBOARD_FIELDS,
    RECRUITMENT_FIELDS,
    LOG_INVENTORY_FIELDS,
    LOG_INOUT_FIELDS,
    LOG_TRACK_FIELDS,
    LOG_ALERT_FIELDS,
    LOG_TRANSFER_FIELDS,
    ADMIN_ASSET_FIELDS,
    ADMIN_EXPENSE_FIELDS,
    ADMIN_ROOM_FIELDS,
    ADMIN_CONTRACT_FIELDS,
  ]) {
    const hit = fields.find((f) => f.key === key || f.key === leaf);
    if (hit) return hit.label;
  }
  return leaf;
}

export function formatRuleDisplayValue(
  value: unknown,
  field?: RuleFieldSchema,
): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field?.key === 'groupBy') {
    const encoded = encodeGroupByForUi(value);
    const opt = field.options?.find((o) => o.value === encoded);
    return opt?.label ?? encoded;
  }
  if (field?.key === 'ratingBands') {
    return encodeRatingBandsForUi(value) || '—';
  }
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value.map((item) => formatRuleDisplayValue(item, field)).join('、');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${ruleKeyLabel(k)}=${formatRuleDisplayValue(v)}`)
      .join('；');
  }
  const text = String(value);
  if (field?.percent) {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(num)) {
      const pct = num * 100;
      const shown = Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(6)));
      return `${shown}%`;
    }
  }
  if (field?.type === 'enum' && field.options) {
    const opt = field.options.find((o) => o.value === text);
    if (opt) return opt.label;
  }
  return RULE_VALUE_LABELS[text] ?? text;
}

/** 将生效规则对象转为中文键名，便于界面展示 */
export function localizeRulesForDisplay(rules: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rules)) {
    if (isAutomaticExecutionRuleKey(key)) continue;
    // 跳过带点号重复键，优先展示扁平中文键，避免整屏英文
    if (key.includes('.') && Object.prototype.hasOwnProperty.call(rules, key.split('.').pop()!)) {
      continue;
    }
    out[ruleKeyLabel(key)] = formatRuleDisplayValue(value);
  }
  return out;
}

export function readRuleValue(
  rules: Record<string, unknown>,
  fieldKey: string,
): unknown {
  const aliases = KEY_ALIASES[fieldKey] ?? [fieldKey];
  for (const key of aliases) {
    if (rules[key] !== undefined && rules[key] !== null && rules[key] !== '') {
      return rules[key];
    }
  }
  return undefined;
}

/** 编辑态读取：主 key 已写入（含空串）时优先，避免别名把清空弹回 */
export function readEditableRuleValue(
  rules: Record<string, unknown>,
  fieldKey: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(rules, fieldKey)) {
    return rules[fieldKey];
  }
  return readRuleValue(rules, fieldKey);
}

/** 写入主 key，并同步已有/已知别名，避免引擎仍读到旧别名 */
export function writeRuleField(
  rules: Record<string, unknown>,
  fieldKey: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...rules };
  const aliases = KEY_ALIASES[fieldKey] ?? [fieldKey];
  for (const alias of aliases) {
    next[alias] = value;
  }
  next[fieldKey] = value;
  return next;
}

export function encodeGroupByForUi(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(',');
  if (value == null || value === '') return 'department,level';
  const text = String(value);
  if (text === 'department_level') return 'department,level';
  return text;
}

export function decodeGroupByFromUi(value: unknown): string[] {
  const text = Array.isArray(value) ? value.map(String).join(',') : String(value ?? '');
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : ['department', 'level'];
}

export function encodeRatingBandsForUi(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function decodeRatingBandsFromUi(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('评级区间必须是 JSON 数组');
  }
  return parsed;
}

function ruleValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'string' && isValidDecimalString(b)) {
    return a === Number(b);
  }
  if (typeof b === 'number' && typeof a === 'string' && isValidDecimalString(a)) {
    return Number(a) === b;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function coerceFieldValue(field: RuleFieldSchema, raw: unknown): unknown {
  if (raw === '' || raw === undefined || raw === null) return raw;
  if (field.key === 'groupBy') return decodeGroupByFromUi(raw);
  if (field.key === 'ratingBands') return decodeRatingBandsFromUi(raw);
  if (field.type === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  if (field.type === 'boolean') return Boolean(raw);
  return raw;
}

/** 将 defaults+company 压成可编辑草稿（结构化字段转为 UI 可编辑形态） */
export function canonicalizeRulesDraft(
  workflowId: string,
  defaults: Record<string, unknown>,
  company: Record<string, unknown> = {},
): Record<string, unknown> {
  const merged = { ...defaults, ...company };
  const fields = ruleFieldsForWorkflow(workflowId);
  if (fields.length === 0) return merged;

  const draft: Record<string, unknown> = { ...merged };
  for (const field of fields) {
    if (field.type === 'readonly') continue;
    let value = readRuleValue(merged, field.key);
    if (field.key === 'groupBy') value = encodeGroupByForUi(value);
    else if (field.key === 'ratingBands') value = encodeRatingBandsForUi(value);
    draft[field.key] = value ?? (field.type === 'boolean' ? false : '');
  }
  return draft;
}

/** 仅保存相对默认有变化的 schema 字段（含别名同步） */
export function buildCompanyRulePatch(
  workflowId: string,
  draft: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const fields = ruleFieldsForWorkflow(workflowId);
  const patch: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.type === 'readonly') continue;
    const raw = readEditableRuleValue(draft, field.key);
    let value: unknown;
    try {
      value = coerceFieldValue(field, raw);
    } catch {
      value = raw;
    }
    const defaultRaw = readRuleValue(defaults, field.key);
    const defaultValue =
      field.key === 'groupBy'
        ? decodeGroupByFromUi(encodeGroupByForUi(defaultRaw))
        : field.key === 'ratingBands'
          ? defaultRaw
          : defaultRaw;

    if (ruleValuesEqual(value, defaultValue)) continue;
    if (value === '' || value === undefined || value === null) continue;

    const aliases = KEY_ALIASES[field.key] ?? [field.key];
    for (const alias of aliases) {
      patch[alias] = value;
    }
  }

  return patch;
}

/** 运行前把 UI 草稿物化为引擎可消费的规则对象 */
export function materializeRulesForRun(
  workflowId: string,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const fields = ruleFieldsForWorkflow(workflowId);
  let next = { ...draft };
  for (const field of fields) {
    if (field.type === 'readonly') continue;
    const raw = readEditableRuleValue(draft, field.key);
    try {
      const value = coerceFieldValue(field, raw);
      next = writeRuleField(next, field.key, value);
    } catch {
      // keep raw; validateWorkflowRules will surface the error
    }
  }
  return stripSafetyLockRules(next);
}

export function formatRuleInputText(value: unknown, field: RuleFieldSchema): string {
  if (value === undefined || value === null) return '';
  if (field.percent) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '';
    const pct = num * 100;
    return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(6)));
  }
  if (field.key === 'groupBy') return encodeGroupByForUi(value);
  if (field.key === 'ratingBands') return encodeRatingBandsForUi(value);
  return String(value);
}

export function parseRuleInputText(text: string, field: RuleFieldSchema): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (field.percent) {
    if (trimmed === '-' || trimmed === '.' || trimmed.endsWith('.')) return trimmed;
    const pct = Number(trimmed);
    if (!Number.isFinite(pct)) return trimmed;
    return pct / 100;
  }
  if (field.type === 'number') {
    if (trimmed === '-' || trimmed === '.' || trimmed.endsWith('.')) return trimmed;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : trimmed;
  }
  if (field.key === 'groupBy') return trimmed;
  if (field.key === 'ratingBands') return trimmed;
  return text;
}

export function fieldConstraintHint(field: RuleFieldSchema): string | undefined {
  if (field.hint) return field.hint;
  if (field.percent) return '按百分比填写，如 5 表示 5%';
  if (field.type === 'number' && (field.min !== undefined || field.max !== undefined)) {
    if (field.min !== undefined && field.max !== undefined) {
      return `允许范围 ${field.min}–${field.max}`;
    }
    if (field.min !== undefined) return `不能小于 ${field.min}`;
    if (field.max !== undefined) return `不能大于 ${field.max}`;
  }
  return undefined;
}

export function isValidDecimalString(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/nan|inf/i.test(text)) return false;
  return /^-?\d+(\.\d+)?$/.test(text);
}

/** Spec alias — decimal-string amounts only (no float stepping). */
export function validateDecimalString(value: string): boolean {
  return isValidDecimalString(value);
}

export function validateWorkflowRules(
  workflowId: string,
  rules: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const fields = ruleFieldsForWorkflow(workflowId);
  if (fields.length === 0) return { ok: true };

  for (const field of fields) {
    if (field.type === 'readonly') continue;
    let value = readEditableRuleValue(rules, field.key);
    if (value === undefined || value === null || value === '') {
      value = readRuleValue(rules, field.key);
    }

    if (field.required && (value === undefined || value === null || value === '')) {
      return { ok: false, message: `规则「${field.label}」不能为空` };
    }
    if (value === undefined || value === null || value === '') continue;

    if (field.key === 'groupBy') {
      const encoded = encodeGroupByForUi(value);
      if (field.options && !field.options.some((o) => o.value === encoded)) {
        return { ok: false, message: `规则「${field.label}」取值无效` };
      }
      continue;
    }

    if (field.key === 'ratingBands') {
      try {
        decodeRatingBandsFromUi(value);
      } catch {
        return { ok: false, message: `规则「${field.label}」必须是合法 JSON 数组` };
      }
      continue;
    }

    if (field.type === 'decimal-string' && !isValidDecimalString(value)) {
      return { ok: false, message: `规则「${field.label}」必须是合法金额字符串（禁止浮点步进）` };
    }
    if (field.type === 'number') {
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(num)) {
        return { ok: false, message: `规则「${field.label}」必须是有效数字` };
      }
      if (field.min !== undefined && num < field.min) {
        const shown = field.percent ? `${field.min * 100}%` : String(field.min);
        return { ok: false, message: `规则「${field.label}」不能小于 ${shown}` };
      }
      if (field.max !== undefined && num > field.max) {
        const shown = field.percent ? `${field.max * 100}%` : String(field.max);
        return { ok: false, message: `规则「${field.label}」不能大于 ${shown}` };
      }
    }
    if (field.type === 'enum' && field.options) {
      if (!field.options.some((o) => o.value === String(value))) {
        return { ok: false, message: `规则「${field.label}」取值无效` };
      }
    }
  }

  if (workflowId === 'HR-SOCIAL-INSURANCE-005') {
    const version = readRuleValue(rules, 'policyVersion') ?? readEditableRuleValue(rules, 'policyVersion');
    if (!version) {
      return { ok: false, message: '社保政策版本缺失，禁止运行核对' };
    }
  }

  return { ok: true };
}

export function resolveRuleSource(input: {
  key: string;
  defaults: Record<string, unknown>;
  company: Record<string, unknown>;
  runtime: Record<string, unknown>;
}): RuleSource {
  const aliases = KEY_ALIASES[input.key] ?? [input.key];
  const has = (bag: Record<string, unknown>) =>
    aliases.some((k) => bag[k] !== undefined && bag[k] !== null && bag[k] !== '');
  if (has(input.runtime) && JSON.stringify(readRuleValue(input.runtime, input.key)) !== JSON.stringify(readRuleValue(input.company, input.key))) {
    // runtime draft differs from company → treat as runtime param
    if (has(input.company) || has(input.defaults)) return 'runtime';
  }
  if (has(input.company)) return 'company';
  return 'defaults';
}

export function ruleSourceLabel(source: RuleSource): string {
  if (source === 'runtime') return '运行参数';
  if (source === 'company') return '公司规则';
  return '默认规则';
}


