import fs from 'fs';
import path from 'path';
import type { CoworkStore, CreateAgentRequest } from '../coworkStore';
import {
  loadWorkstationSessionRegistry,
  type WorkstationSessionRecord,
} from '../workstationSessionRegistry';

const WORKSTATION_AGENT_PREFIX = 'workstation-';

export type WorkstationAgentMigrationDeps = {
  store: CoworkStore;
  workstationRoot: string;
  createAgent: (request: CreateAgentRequest) => { id: string; name: string };
  departmentDisplayName?: (departmentId: string) => string;
};

type MainSessionRow = {
  id: string;
  title: string | null;
  cwd: string | null;
  agent_id: string | null;
};

function normalizeDepartmentId(departmentId: string): string {
  return departmentId.trim().replace(/^workstation[-:]/, '');
}

export function formatWorkstationAgentId(departmentId: string): string {
  return `${WORKSTATION_AGENT_PREFIX}${normalizeDepartmentId(departmentId)}`;
}

function parseDepartmentFromWsTitle(title: string | null | undefined): string | null {
  const match = /^\[WS:([^\]]+)\]/i.exec(String(title || '').trim());
  if (!match?.[1]) return null;
  return normalizeDepartmentId(match[1]) || null;
}

function parseDepartmentFromWorkstationCwd(
  cwd: string | null | undefined,
  workstationRoot: string,
): string | null {
  if (!cwd) return null;
  const root = path.normalize(workstationRoot);
  const normalized = path.normalize(cwd);
  if (normalized === root) return null;
  if (!normalized.startsWith(root + path.sep)) return null;
  const relative = normalized.slice(root.length + path.sep.length);
  const first = relative.split(/[/\\]/).find(Boolean);
  if (!first || first === '_registry' || first === 'memory') return null;
  return normalizeDepartmentId(first) || null;
}

function resolveDepartmentIdForSession(
  row: MainSessionRow,
  workstationRoot: string,
  registryBySessionId: Map<string, WorkstationSessionRecord>,
): string | null {
  const fromTitle = parseDepartmentFromWsTitle(row.title);
  if (fromTitle) return fromTitle;

  const fromRegistry = registryBySessionId.get(row.id);
  if (fromRegistry?.departmentId) {
    return normalizeDepartmentId(fromRegistry.departmentId) || null;
  }

  return parseDepartmentFromWorkstationCwd(row.cwd, workstationRoot);
}

function ensureWorkstationAgentExists(
  deps: WorkstationAgentMigrationDeps,
  departmentId: string,
): string {
  const agentId = formatWorkstationAgentId(departmentId);
  const existing = deps.store.getAgent(agentId);
  if (existing) return agentId;

  const display = deps.departmentDisplayName?.(departmentId) ?? departmentId;
  const departmentPath = path.join(deps.workstationRoot, departmentId);
  try {
    fs.mkdirSync(departmentPath, { recursive: true });
  } catch {
    // best-effort
  }

  deps.createAgent({
    id: agentId,
    name: `${display}智能体`,
    description: `AI员工助手 · ${display}`,
    workingDirectory: departmentPath,
  });
  return agentId;
}

/**
 * One-shot: move legacy workstation sessions off agent_id=main onto workstation-{dept}.
 */
export function migrateWorkstationSessionsOffMain(deps: WorkstationAgentMigrationDeps): number {
  const registryBySessionId = new Map<string, WorkstationSessionRecord>();
  for (const record of loadWorkstationSessionRegistry().sessions) {
    if (record.openClawSessionId) {
      registryBySessionId.set(record.openClawSessionId, record);
    }
  }

  const rows = deps.store.listMainAgentSessionsForWorkstationMigration();
  let migrated = 0;

  for (const row of rows) {
    const departmentId = resolveDepartmentIdForSession(
      row,
      deps.workstationRoot,
      registryBySessionId,
    );
    if (!departmentId) continue;

    const agentId = ensureWorkstationAgentExists(deps, departmentId);
    if (deps.store.reassignSessionAgentId(row.id, agentId)) {
      migrated += 1;
    }
  }

  return migrated;
}
