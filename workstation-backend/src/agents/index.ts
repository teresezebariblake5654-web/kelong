import { AgentConfig } from './types';
import { hrAgent } from './hr.agent';
import { productionAgent } from './production.agent';
import { salesAgent } from './sales.agent';
import { financeAgent } from './finance.agent';

export const agents: Record<string, AgentConfig> = {
  [hrAgent.id]: hrAgent,
  [productionAgent.id]: productionAgent,
  [salesAgent.id]: salesAgent,
  [financeAgent.id]: financeAgent,
};

export function getAgent(agentId: string): AgentConfig | undefined {
  return agents[agentId];
}

export function listAgents(): AgentConfig[] {
  return Object.values(agents);
}

export { hrAgent, productionAgent, salesAgent, financeAgent };
