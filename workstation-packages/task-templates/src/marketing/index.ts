import { anomaly, defineTemplate, field } from '../define.js';

const campaign = field('campaign', '活动', ['营销活动', '活动名称', 'Campaign']);
const channel = field('channel', '渠道', ['投放渠道', '来源']);
const spend = field('spend', '投放费用', ['花费', '消耗', '广告费'], 'number');

export const MARKETING_TASK_TEMPLATES = [
  defineTemplate({
    code: 'MARKETING_CAMPAIGN_ROI', role: 'marketing', name: '营销活动 ROI', description: '比较活动投入、收入、转化与回报率。',
    fields: [campaign, channel, spend, field('revenue', '归因收入', ['收入', '成交金额'], 'number'), field('conversions', '转化数', ['成交数', '转化量'], 'integer')],
    localOperations: [{ type: 'group', fields: ['campaign', 'channel'] }, { type: 'aggregate', field: 'spend', operation: 'sum', as: 'totalSpend' }, { type: 'aggregate', field: 'revenue', operation: 'sum', as: 'totalRevenue' }, { type: 'derive', as: 'roi', expression: '(totalRevenue-totalSpend)/totalSpend', description: '计算营销回报率' }],
    anomalyRules: [anomaly('NEGATIVE_ROI', '负回报活动', 'roi', 'lt', 0, 'critical', '活动 ROI 为负')],
    outputMetrics: { totalSpend: '总投放费用', totalRevenue: '归因收入', roi: 'ROI' }, defaultGroupBy: ['活动', '渠道'],
  }),
  defineTemplate({
    code: 'MARKETING_CHANNEL_EFFECTIVENESS', role: 'marketing', name: '渠道效能分析', description: '按渠道比较曝光、点击、获客与成本。',
    fields: [channel, field('impressions', '曝光量', ['展示量', '曝光'], 'integer'), field('clicks', '点击量', ['点击'], 'integer'), field('leads', '线索量', ['线索数'], 'integer'), spend],
    localOperations: [{ type: 'group', fields: ['channel'] }, { type: 'aggregate', field: 'clicks', operation: 'sum', as: 'clicks' }, { type: 'aggregate', field: 'leads', operation: 'sum', as: 'leads' }, { type: 'derive', as: 'costPerLead', expression: 'spend/leads', description: '计算单线索成本' }],
    anomalyRules: [anomaly('HIGH_CPL', '获客成本偏高', 'costPerLead', 'deviation', 2, 'warning', '单线索成本显著高于整体水平')],
    outputMetrics: { clicks: '点击量', leads: '线索量', costPerLead: '单线索成本' }, defaultGroupBy: ['渠道'],
  }),
  defineTemplate({
    code: 'MARKETING_CONTENT_PERFORMANCE', role: 'marketing', name: '内容效果分析', description: '分析内容曝光、互动和转化表现。',
    fields: [field('content', '内容', ['内容标题', '素材', '文章']), field('contentType', '内容类型', ['素材类型', '形式']), field('views', '浏览量', ['阅读量', '播放量'], 'integer'), field('engagements', '互动量', ['点赞评论分享', '互动数'], 'integer'), field('conversions', '转化数', ['线索数', '成交数'], 'integer')],
    localOperations: [{ type: 'group', fields: ['contentType', 'content'] }, { type: 'aggregate', field: 'views', operation: 'sum', as: 'views' }, { type: 'derive', as: 'engagementRate', expression: 'engagements/views', description: '计算互动率' }],
    anomalyRules: [anomaly('LOW_ENGAGEMENT', '低互动内容', 'engagementRate', 'deviation', -2, 'warning', '内容互动率显著偏低')],
    outputMetrics: { views: '浏览量', engagementRate: '互动率', conversions: '转化数' }, defaultGroupBy: ['内容类型'],
  }),
  defineTemplate({
    code: 'MARKETING_LEAD_QUALITY', role: 'marketing', name: '营销线索质量', description: '按来源分析线索评分、有效率和转化率。',
    fields: [field('leadId', '线索编号', ['线索ID', '客户编号']), channel, field('score', '线索评分', ['评分', '质量分'], 'number'), field('status', '线索状态', ['状态', '跟进结果'])],
    localOperations: [{ type: 'group', fields: ['channel', 'status'] }, { type: 'aggregate', field: 'leadId', operation: 'count-distinct', as: 'leadCount' }, { type: 'aggregate', field: 'score', operation: 'avg', as: 'averageScore' }],
    anomalyRules: [anomaly('LOW_SCORE', '低质量线索', 'score', 'lt', 40, 'warning', '线索评分低于 40')],
    outputMetrics: { leadCount: '线索数', averageScore: '平均评分', conversionRate: '转化率' }, defaultGroupBy: ['渠道'],
  }),
] as const;
