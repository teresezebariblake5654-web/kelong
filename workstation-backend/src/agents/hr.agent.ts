import { AgentConfig } from './types';

export const hrAgent: AgentConfig = {
  id: 'hr',
  name: 'HR 智能体',
  description: '分析人事 Excel 数据，支持招聘、考勤、绩效、薪酬等 HR 场景报告生成',
  creditCost: 20,
  supportedFiles: ['xlsx', 'xls'],
  tools: ['readExcel', 'summarizeTable', 'generateReport'],
  status: 'active',
};
