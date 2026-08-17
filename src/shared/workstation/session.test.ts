import { describe, expect, it } from 'vitest';
import {
  isWorkstationAgentId,
  isWorkstationCoworkSession,
  isWorkstationSessionTitle,
} from './session';

describe('isWorkstationCoworkSession', () => {
  it('detects workstation agent ids', () => {
    expect(isWorkstationAgentId('workstation-finance')).toBe(true);
    expect(isWorkstationAgentId('workstation:finance')).toBe(true);
    expect(isWorkstationAgentId('main')).toBe(false);
  });

  it('detects [WS:] titles with leading whitespace', () => {
    expect(isWorkstationSessionTitle('[WS:finance] 财务智能体')).toBe(true);
    expect(isWorkstationSessionTitle('  [WS:hr] 人事智能体')).toBe(true);
    expect(isWorkstationSessionTitle('普通任务')).toBe(false);
  });

  it('detects sessions under workstation cwd root', () => {
    expect(
      isWorkstationCoworkSession(
        { agentId: 'main', title: 'legacy', cwd: 'C:\\Users\\x\\AppData\\Roaming\\App\\workstation\\finance' },
        { workstationRootNorm: 'C:\\Users\\x\\AppData\\Roaming\\App\\workstation' },
      ),
    ).toBe(true);
    expect(
      isWorkstationCoworkSession(
        { agentId: 'main', title: 'ok', cwd: 'D:\\projects\\demo' },
        { workstationRootNorm: 'C:\\Users\\x\\AppData\\Roaming\\App\\workstation' },
      ),
    ).toBe(false);
  });
});
