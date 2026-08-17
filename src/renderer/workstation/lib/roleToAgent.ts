import type { ChatAgentCode } from '@aw/shared';
import type { AgentRole, LocalTaskTemplate } from '@aw/task-templates';

const ROLE_AGENT_MAP: Partial<Record<AgentRole, ChatAgentCode>> = {
  sales: 'sales',
  hr: 'hr',
  administration: 'admin',
  operations: 'data-analysis',
  procurement: 'data-analysis',
  production: 'production',
  logistics: 'logistics',
  marketing: 'data-analysis',
  'customer-service': 'general',
  universal: 'general',
};

export function roleToAgentCode(
  role: AgentRole,
  task?: Pick<LocalTaskTemplate, 'name' | 'description' | 'code'>,
): ChatAgentCode {
  if (
    task &&
    /财务|费用|报销|预算|账|发票|成本/.test(`${task.name}${task.description}${task.code}`)
  ) {
    return 'finance';
  }
  if (task && /电商|订单|退款|直播/.test(`${task.name}${task.description}${task.code}`)) {
    return 'ecommerce';
  }
  return ROLE_AGENT_MAP[role] ?? 'general';
}
