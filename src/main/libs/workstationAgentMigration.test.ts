import { describe, expect, it, vi } from 'vitest';
import path from 'path';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/mock',
    getPath: () => path.join('/tmp', 'ws-agent-mig-userdata'),
  },
}));

vi.mock('../workstationSessionRegistry', () => ({
  loadWorkstationSessionRegistry: () => ({ sessions: [] }),
}));

import {
  formatWorkstationAgentId,
  migrateWorkstationSessionsOffMain,
} from './workstationAgentMigration';

describe('migrateWorkstationSessionsOffMain', () => {
  it('formats workstation agent ids', () => {
    expect(formatWorkstationAgentId('hr')).toBe('workstation-hr');
    expect(formatWorkstationAgentId('workstation:finance')).toBe('workstation-finance');
  });

  it('rewrites [WS:] sessions from main to workstation-{dept}', () => {
    const workstationRoot = path.join('/data', 'workstation');
    const agents = new Map<string, { id: string; name: string }>();
    const sessions = [
      {
        id: 's-hr',
        title: '[WS:hr] 人事智能体',
        cwd: path.join(workstationRoot, 'hr'),
        agent_id: 'main',
      },
      {
        id: 's-plain',
        title: '普通对话',
        cwd: path.join('/data', 'docs'),
        agent_id: 'main',
      },
    ];

    const store = {
      listMainAgentSessionsForWorkstationMigration: () => sessions,
      getAgent: (id: string) => agents.get(id) ?? null,
      reassignSessionAgentId: (sessionId: string, agentId: string) => {
        const row = sessions.find((s) => s.id === sessionId);
        if (!row || (row.agent_id || 'main') !== 'main') return false;
        row.agent_id = agentId;
        return true;
      },
    };

    const migrated = migrateWorkstationSessionsOffMain({
      store: store as never,
      workstationRoot,
      createAgent: (request) => {
        const agent = { id: request.id!, name: request.name };
        agents.set(agent.id, agent);
        return agent;
      },
      departmentDisplayName: (id) => (id === 'hr' ? '人事' : id),
    });

    expect(migrated).toBe(1);
    expect(sessions[0].agent_id).toBe('workstation-hr');
    expect(sessions[1].agent_id).toBe('main');
    expect(agents.get('workstation-hr')?.name).toBe('人事智能体');
  });

  it('uses cwd under workstation/{dept} when title has no [WS:] marker', () => {
    const workstationRoot = path.join('/data', 'workstation');
    const sessions = [
      {
        id: 's-fin',
        title: '旧财务会话',
        cwd: path.join(workstationRoot, 'finance'),
        agent_id: 'main',
      },
    ];
    const agents = new Map<string, { id: string; name: string }>();

    const migrated = migrateWorkstationSessionsOffMain({
      store: {
        listMainAgentSessionsForWorkstationMigration: () => sessions,
        getAgent: (id: string) => agents.get(id) ?? null,
        reassignSessionAgentId: (sessionId: string, agentId: string) => {
          const row = sessions.find((s) => s.id === sessionId);
          if (!row) return false;
          row.agent_id = agentId;
          return true;
        },
      } as never,
      workstationRoot,
      createAgent: (request) => {
        const agent = { id: request.id!, name: request.name };
        agents.set(agent.id, agent);
        return agent;
      },
    });

    expect(migrated).toBe(1);
    expect(sessions[0].agent_id).toBe('workstation-finance');
  });
});
