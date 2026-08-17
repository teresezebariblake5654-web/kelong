import { AgentConfig } from './types';

export const productionAgent: AgentConfig = {
  id: 'production',
  name: '生产智能体',
  description: '分析生产计划、产能、良率、设备稼动等生产数据',
  creditCost: 10,
  supportedFiles: ['xlsx', 'xls'],
  tools: ['readExcel', 'summarizeTable', 'generateReport'],
  status: 'inactive',
};
