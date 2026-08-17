import { anomaly, defineTemplate, field } from '../define.js';

const ticket = field('ticketId', '工单编号', ['工单ID', '服务单号']);
const agent = field('agent', '客服人员', ['客服', '处理人', '坐席']);

export const CUSTOMER_SERVICE_TASK_TEMPLATES = [
  defineTemplate({
    code: 'CUSTOMER_SERVICE_TICKET_SUMMARY', role: 'customer-service', name: '客服工单汇总', description: '按类型、渠道和状态统计服务工单。',
    fields: [ticket, agent, field('channel', '服务渠道', ['渠道', '来源']), field('category', '问题类型', ['工单类型', '分类']), field('status', '工单状态', ['状态', '处理状态'])],
    localOperations: [{ type: 'group', fields: ['channel', 'category', 'status'] }, { type: 'aggregate', field: 'ticketId', operation: 'count-distinct', as: 'ticketCount' }],
    anomalyRules: [anomaly('OPEN_BACKLOG', '未结工单', 'status', 'eq', '未解决', 'warning', '存在未解决客服工单')],
    outputMetrics: { ticketCount: '工单量', openCount: '未结工单量' }, defaultGroupBy: ['问题类型'],
  }),
  defineTemplate({
    code: 'CUSTOMER_SERVICE_SLA_ANALYSIS', role: 'customer-service', name: '客服 SLA 分析', description: '分析首次响应、解决时长与超时情况。',
    fields: [ticket, agent, field('createdAt', '创建时间', ['受理时间', '提交时间'], 'datetime'), field('firstResponseAt', '首次响应时间', ['响应时间'], 'datetime'), field('resolvedAt', '解决时间', ['关闭时间', '完成时间'], 'datetime', false), field('slaHours', 'SLA小时', ['时限', '承诺时长'], 'number')],
    localOperations: [{ type: 'derive', as: 'responseHours', expression: '(firstResponseAt-createdAt)/3600000', description: '计算首次响应时长' }, { type: 'derive', as: 'resolutionHours', expression: '(resolvedAt-createdAt)/3600000', description: '计算解决时长' }, { type: 'group', fields: ['agent'] }],
    anomalyRules: [anomaly('SLA_BREACH', 'SLA 超时', 'resolutionHours', 'gt', 'slaHours', 'critical', '工单解决时长超过 SLA')],
    outputMetrics: { responseHours: '平均响应时长', resolutionHours: '平均解决时长', slaRate: 'SLA 达标率' }, defaultGroupBy: ['客服人员'],
  }),
  defineTemplate({
    code: 'CUSTOMER_SERVICE_SATISFACTION', role: 'customer-service', name: '客户满意度分析', description: '分析满意度评分、低分原因和客服表现。',
    fields: [ticket, agent, field('score', '满意度评分', ['评分', 'CSAT'], 'number'), field('feedback', '客户反馈', ['评价', '意见'], 'string', false), field('category', '问题类型', ['工单类型', '分类'])],
    localOperations: [{ type: 'group', fields: ['agent', 'category'] }, { type: 'aggregate', field: 'score', operation: 'avg', as: 'averageScore' }, { type: 'aggregate', field: 'ticketId', operation: 'count-distinct', as: 'responseCount' }],
    anomalyRules: [anomaly('LOW_SATISFACTION', '低满意度', 'score', 'lt', 3, 'critical', '客户满意度评分低于 3 分')],
    outputMetrics: { averageScore: '平均满意度', responseCount: '评价数', lowScoreRate: '低分率' }, defaultGroupBy: ['客服人员'],
  }),
  defineTemplate({
    code: 'CUSTOMER_SERVICE_COMPLAINT_ANALYSIS', role: 'customer-service', name: '客户投诉分析', description: '识别投诉热点、重复投诉与升级风险。',
    fields: [ticket, field('customer', '客户', ['客户名称', '客户编号']), field('complaintType', '投诉类型', ['问题类型', '投诉原因']), field('severity', '投诉等级', ['严重程度', '级别']), field('status', '处理状态', ['状态', '投诉状态'])],
    localOperations: [{ type: 'group', fields: ['complaintType', 'severity', 'status'] }, { type: 'aggregate', field: 'ticketId', operation: 'count-distinct', as: 'complaintCount' }, { type: 'aggregate', field: 'customer', operation: 'count-distinct', as: 'customerCount' }],
    anomalyRules: [anomaly('SEVERE_COMPLAINT', '重大投诉', 'severity', 'eq', '重大', 'critical', '发现重大客户投诉')],
    outputMetrics: { complaintCount: '投诉量', customerCount: '涉及客户数', repeatRate: '重复投诉率' }, defaultGroupBy: ['投诉类型'],
  }),
  defineTemplate({
    code: 'CUSTOMER_SERVICE_AGENT_WORKLOAD', role: 'customer-service', name: '客服工作负载', description: '比较坐席工单量、处理效率和积压。',
    fields: [agent, ticket, field('status', '工单状态', ['状态']), field('handlingMinutes', '处理分钟', ['处理时长', '耗时'], 'number'), field('date', '处理日期', ['日期', '完成日期'], 'date')],
    localOperations: [{ type: 'group', fields: ['agent', 'status'] }, { type: 'aggregate', field: 'ticketId', operation: 'count-distinct', as: 'ticketCount' }, { type: 'aggregate', field: 'handlingMinutes', operation: 'avg', as: 'averageHandlingMinutes' }],
    anomalyRules: [anomaly('WORKLOAD_OUTLIER', '负载异常', 'ticketCount', 'deviation', 2, 'warning', '客服工单负载显著偏离团队平均')],
    outputMetrics: { ticketCount: '处理工单数', averageHandlingMinutes: '平均处理时长', backlog: '积压量' }, defaultGroupBy: ['客服人员'],
  }),
] as const;
