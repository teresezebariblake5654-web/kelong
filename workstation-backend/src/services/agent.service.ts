import { getAgent, listAgents } from '../agents';
import { AppError } from '../utils/errors';

export const agentService = {
  list() {
    return listAgents();
  },

  get(agentId: string) {
    const agent = getAgent(agentId);
    if (!agent) {
      throw new AppError(404, `智能体 ${agentId} 不存在`, 'NOT_FOUND');
    }
    return agent;
  },
};
