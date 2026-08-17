export type AgentStatus = 'active' | 'inactive';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  creditCost: number;
  supportedFiles: string[];
  tools: string[];
  status: AgentStatus;
}
