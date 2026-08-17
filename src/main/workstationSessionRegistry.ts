import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type WorkstationSessionRecord = {
  productMode: 'workstation';
  departmentId: string;
  workstationConversationId: string;
  openClawSessionId: string;
  workspacePath: string;
  memoryNamespace: string;
  updatedAt: number;
};

type RegistryFile = {
  sessions: WorkstationSessionRecord[];
};

function registryDir(): string {
  return path.join(app.getPath('userData'), 'workstation', '_registry');
}

function registryPath(): string {
  return path.join(registryDir(), 'sessions.json');
}

export function loadWorkstationSessionRegistry(): RegistryFile {
  try {
    const file = registryPath();
    if (!fs.existsSync(file)) return { sessions: [] };
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] };
    return { sessions: parsed.sessions };
  } catch {
    return { sessions: [] };
  }
}

export function saveWorkstationSessionRegistry(data: RegistryFile): void {
  const dir = registryDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(data, null, 2), 'utf8');
}

export function upsertWorkstationSession(
  record: Omit<WorkstationSessionRecord, 'productMode' | 'updatedAt'> & {
    productMode?: 'workstation';
    updatedAt?: number;
  },
): WorkstationSessionRecord {
  const next: WorkstationSessionRecord = {
    productMode: 'workstation',
    departmentId: record.departmentId,
    workstationConversationId: record.workstationConversationId,
    openClawSessionId: record.openClawSessionId,
    workspacePath: record.workspacePath,
    memoryNamespace: record.memoryNamespace,
    updatedAt: record.updatedAt ?? Date.now(),
  };

  const data = loadWorkstationSessionRegistry();
  const idx = data.sessions.findIndex(
    (item) =>
      item.openClawSessionId === next.openClawSessionId ||
      (item.departmentId === next.departmentId &&
        item.workstationConversationId === next.workstationConversationId),
  );
  if (idx >= 0) {
    data.sessions[idx] = { ...data.sessions[idx], ...next };
  } else {
    data.sessions.push(next);
  }
  saveWorkstationSessionRegistry(data);
  return next;
}

export function getByOpenClawSessionId(openClawSessionId: string): WorkstationSessionRecord | null {
  const data = loadWorkstationSessionRegistry();
  return data.sessions.find((item) => item.openClawSessionId === openClawSessionId) ?? null;
}

export function listByDepartment(departmentId: string): WorkstationSessionRecord[] {
  const data = loadWorkstationSessionRegistry();
  return data.sessions
    .filter((item) => item.departmentId === departmentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeWorkstationSession(openClawSessionId: string): boolean {
  const data = loadWorkstationSessionRegistry();
  const before = data.sessions.length;
  data.sessions = data.sessions.filter((item) => item.openClawSessionId !== openClawSessionId);
  if (data.sessions.length === before) return false;
  saveWorkstationSessionRegistry(data);
  return true;
}
