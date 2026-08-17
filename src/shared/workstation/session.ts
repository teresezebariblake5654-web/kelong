/**
 * Shared helpers to keep workstation (department) sessions out of Agent mode.
 * Safe for both main and renderer (no Electron / DOM APIs).
 */

export const WORKSTATION_AGENT_PREFIX = 'workstation-';

export function isWorkstationAgentId(agentId?: string | null): boolean {
  const trimmed = agentId?.trim() || '';
  return trimmed.startsWith(WORKSTATION_AGENT_PREFIX) || trimmed.startsWith('workstation:');
}

export function isWorkstationSessionTitle(title?: string | null): boolean {
  return (title?.trim() || '').startsWith('[WS:');
}

export type WorkstationCoworkSessionLike = {
  agentId?: string | null;
  title?: string | null;
  cwd?: string | null;
};

/**
 * True when a cowork/OpenClaw session belongs to the enterprise workstation,
 * not the general Agent sidebar.
 */
export function isWorkstationCoworkSession(
  session: WorkstationCoworkSessionLike | null | undefined,
  options?: { workstationRootNorm?: string | null },
): boolean {
  if (!session) return false;
  if (isWorkstationAgentId(session.agentId)) return true;
  if (isWorkstationSessionTitle(session.title)) return true;

  const root = options?.workstationRootNorm?.trim();
  const cwd = session.cwd?.trim();
  if (root && cwd) {
    // Normalize separators for cross-platform path prefix checks.
    const normRoot = root.replace(/[/\\]+$/, '').replace(/\\/g, '/').toLowerCase();
    const normCwd = cwd.replace(/\\/g, '/').toLowerCase();
    if (normCwd === normRoot || normCwd.startsWith(`${normRoot}/`)) return true;
  }
  return false;
}
