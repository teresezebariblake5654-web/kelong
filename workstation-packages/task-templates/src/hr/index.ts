import { anomaly, defineTemplate, field } from '../define.js';

const department = field('department', '部门', ['部门名称', '组织', '事业部']);
const employee = field('employee', '员工', ['姓名', '员工姓名', '工号']);
const date = field('date', '日期', ['考勤日期', '统计日期'], 'date');

export const HR_TASK_TEMPLATES = [
  defineTemplate({
    code: 'HR_ATTENDANCE_SUMMARY', role: 'hr', name: '考勤异常汇总', description: '统计迟到、早退、缺勤与部门分布。',
    fields: [department, employee, date, field('status', '考勤状态', ['状态', '出勤状态']), field('minutes', '异常分钟数', ['迟到分钟', '时长'], 'number', false)],
    localOperations: [{ type: 'group', fields: ['department', 'status'] }, { type: 'aggregate', field: 'employee', operation: 'count', as: 'recordCount' }, { type: 'aggregate', field: 'minutes', operation: 'sum', as: 'abnormalMinutes' }],
    anomalyRules: [anomaly('ABSENCE', '缺勤', 'status', 'eq', '缺勤', 'critical', '发现缺勤记录'), anomaly('LATE_LONG', '严重迟到', 'minutes', 'gt', 30, 'warning', '迟到超过 30 分钟')],
    outputMetrics: { recordCount: '异常记录数', abnormalMinutes: '异常总时长' }, defaultGroupBy: ['部门'],
  }),
  defineTemplate({
    code: 'HR_HEADCOUNT_SNAPSHOT', role: 'hr', name: '编制人数快照', description: '按部门对比在岗人数、编制与空缺。',
    fields: [department, employee, field('employmentStatus', '在职状态', ['员工状态', '状态']), field('headcountPlan', '编制人数', ['定编人数', '编制'], 'integer', false)],
    localOperations: [{ type: 'deduplicate', fields: ['employee'], keep: 'last' }, { type: 'group', fields: ['department'] }, { type: 'aggregate', field: 'employee', operation: 'count-distinct', as: 'activeHeadcount' }, { type: 'derive', as: 'vacancy', expression: 'headcountPlan-activeHeadcount', description: '计算编制空缺' }],
    anomalyRules: [anomaly('OVER_PLAN', '超编', 'vacancy', 'lt', 0, 'warning', '部门实际人数超过编制')],
    outputMetrics: { activeHeadcount: '在岗人数', vacancy: '编制空缺' }, defaultGroupBy: ['部门'],
  }),
  defineTemplate({
    code: 'HR_TURNOVER_ANALYSIS', role: 'hr', name: '离职与流动分析', description: '分析离职率、离职原因与高流动部门。',
    fields: [department, employee, field('hireDate', '入职日期', ['入司日期'], 'date'), field('leaveDate', '离职日期', ['最后工作日'], 'date', false), field('leaveReason', '离职原因', ['原因', '离职类型'], 'string', false)],
    localOperations: [{ type: 'group', fields: ['department', 'leaveReason'] }, { type: 'aggregate', field: 'employee', operation: 'count-distinct', as: 'leaverCount' }],
    anomalyRules: [anomaly('MISSING_REASON', '离职原因缺失', 'leaveReason', 'missing', true, 'warning', '离职记录未填写原因')],
    outputMetrics: { leaverCount: '离职人数', turnoverRate: '离职率' }, defaultGroupBy: ['部门'],
  }),
  defineTemplate({
    code: 'HR_RECRUITMENT_FUNNEL', role: 'hr', name: '招聘漏斗分析', description: '统计候选人从投递到入职的转化和耗时。',
    fields: [field('job', '岗位', ['职位', '招聘岗位']), field('candidate', '候选人', ['姓名', '候选人姓名']), field('stage', '招聘阶段', ['状态', '流程阶段']), field('stageDate', '阶段日期', ['更新时间', '操作日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['job', 'stage'] }, { type: 'aggregate', field: 'candidate', operation: 'count-distinct', as: 'candidateCount' }],
    anomalyRules: [anomaly('STALE_CANDIDATE', '流程停滞', 'stageDate', 'deviation', 14, 'warning', '候选人阶段超过 14 天未推进')],
    outputMetrics: { candidateCount: '候选人数', conversionRate: '阶段转化率' }, defaultGroupBy: ['岗位'],
  }),
  defineTemplate({
    code: 'HR_PAYROLL_VARIANCE', role: 'hr', name: '薪酬波动检查', description: '按部门检查应发、实发及环比异常。',
    fields: [department, employee, field('period', '薪资月份', ['月份', '期间']), field('grossPay', '应发工资', ['应发', '税前工资'], 'number'), field('netPay', '实发工资', ['实发', '到手工资'], 'number')],
    localOperations: [{ type: 'group', fields: ['department', 'period'] }, { type: 'aggregate', field: 'grossPay', operation: 'sum', as: 'grossTotal' }, { type: 'aggregate', field: 'netPay', operation: 'sum', as: 'netTotal' }],
    anomalyRules: [anomaly('NEGATIVE_PAY', '负数薪资', 'netPay', 'lt', 0, 'critical', '实发工资为负数')],
    outputMetrics: { grossTotal: '应发合计', netTotal: '实发合计' }, defaultGroupBy: ['部门'],
  }),
  defineTemplate({
    code: 'HR_PERFORMANCE_DISTRIBUTION', role: 'hr', name: '绩效分布分析', description: '分析部门绩效等级分布与异常集中度。',
    fields: [department, employee, field('period', '考核周期', ['周期', '月份']), field('rating', '绩效等级', ['绩效结果', '等级'])],
    localOperations: [{ type: 'group', fields: ['department', 'rating'] }, { type: 'aggregate', field: 'employee', operation: 'count-distinct', as: 'employeeCount' }],
    anomalyRules: [anomaly('MISSING_RATING', '绩效缺失', 'rating', 'missing', true, 'warning', '员工缺少绩效等级')],
    outputMetrics: { employeeCount: '各等级人数', distribution: '绩效分布' }, defaultGroupBy: ['部门'],
  }),
] as const;
