import type { ChatAgentCode } from '@aw/shared';

export type ChatAgentOption = {
  code: ChatAgentCode;
  label: string;
  description: string;
};

export const CHAT_AGENTS: ChatAgentOption[] = [
  { code: 'general', label: '通用助手', description: '日常问答、总结与通用任务' },
  { code: 'data-analysis', label: '数据分析助手', description: '表格分析、趋势洞察与异常发现' },
  { code: 'finance', label: '财务助手', description: '费用、预算与财务指标解读' },
  { code: 'sales', label: '销售助手', description: '销售漏斗、业绩与线索分析' },
  { code: 'admin', label: '行政助手', description: '行政流程、文档整理与事务支持' },
  { code: 'hr', label: '人事助手', description: '薪酬、考勤、档案与入离职' },
  { code: 'production', label: '生产助手', description: '物料日清、消耗与进度' },
  { code: 'logistics', label: '物流助手', description: '库存、出入库与调拨' },
  { code: 'ecommerce', label: '电商助手', description: '订单、退款与销售汇总' },
];

export const DEFAULT_CHAT_AGENT: ChatAgentCode = 'general';

export function getChatAgentLabel(code: ChatAgentCode): string {
  return CHAT_AGENTS.find((item) => item.code === code)?.label ?? '通用助手';
}
