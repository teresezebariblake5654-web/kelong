import { AgentConfig } from './types';

export const financeAgent: AgentConfig = {
  id: 'finance',
  name: '财务智能体',
  description: '分析费用、预算、现金流等财务数据',
  creditCost: 10,
  supportedFiles: ['xlsx', 'xls'],
  tools: ['readExcel', 'summarizeTable', 'generateReport'],
  status: 'inactive',
};
