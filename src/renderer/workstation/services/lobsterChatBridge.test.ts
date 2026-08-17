import { describe, expect, it } from 'vitest';
import {
  formatWorkstationAgentId,
  isWorkstationAgentId,
  isWorkstationCoworkSession,
  memoryNamespaceForConversation,
  memoryNamespaceForDepartment,
  parseDepartmentIdFromAgentId,
  WORKSTATION_AGENT_PREFIX,
  workstationAgentDisplayName,
} from './lobsterChatBridge';

describe('lobsterChatBridge agentId formatting', () => {
  it('formats department id with workstation- prefix (no colon — OpenClaw agent ids)', () => {
    expect(formatWorkstationAgentId('hr')).toBe('workstation-hr');
    expect(formatWorkstationAgentId('workstation-finance')).toBe('workstation-finance');
    expect(formatWorkstationAgentId('workstation:finance')).toBe('workstation-finance');
  });

  it('detects and parses workstation agent ids (hyphen + legacy colon)', () => {
    expect(isWorkstationAgentId('workstation-production')).toBe(true);
    expect(isWorkstationAgentId('workstation:production')).toBe(true);
    expect(isWorkstationAgentId('main')).toBe(false);
    expect(parseDepartmentIdFromAgentId('workstation-ecommerce')).toBe('ecommerce');
    expect(parseDepartmentIdFromAgentId('workstation:ecommerce')).toBe('ecommerce');
    expect(parseDepartmentIdFromAgentId('main')).toBeNull();
    expect(WORKSTATION_AGENT_PREFIX).toBe('workstation-');
  });

  it('detects workstation cowork sessions by title and agent id', () => {
    expect(isWorkstationCoworkSession({ agentId: 'workstation-finance', title: 'x' })).toBe(true);
    expect(isWorkstationCoworkSession({ agentId: 'main', title: '[WS:finance] 财务智能体' })).toBe(true);
    expect(isWorkstationCoworkSession({ agentId: 'main', title: '普通任务' })).toBe(false);
  });

  it('uses department display names for workstation agents', () => {
    expect(workstationAgentDisplayName('hr')).toBe('人事智能体');
    expect(workstationAgentDisplayName('finance')).toBe('财务智能体');
  });

  it('scopes memory namespace per conversation for work agents', () => {
    expect(memoryNamespaceForDepartment('hr')).toBe('workstation-hr');
    expect(memoryNamespaceForConversation('hr', 'thread-1')).toBe('workstation-hr-thread-1');
    expect(memoryNamespaceForConversation('hr', 'thread-1')).not.toBe(
      memoryNamespaceForConversation('hr', 'thread-2'),
    );
  });
});
