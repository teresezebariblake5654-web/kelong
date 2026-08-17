import { AgentConfig } from './types';

export const salesAgent: AgentConfig = {
  id: 'sales',
  name: '销售智能体',
  description: '分析销售漏斗、客户转化、区域业绩等销售数据',
  creditCost: 10,
  supportedFiles: ['xlsx', 'xls'],
  tools: ['readExcel', 'summarizeTable', 'generateReport'],
  status: 'inactive',
};
