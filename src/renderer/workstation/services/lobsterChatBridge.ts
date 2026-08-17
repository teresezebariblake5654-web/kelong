/**
 * Bridges workstation chat to Lobster coworkService / OpenClaw IPC.
 * Never calls model HTTP APIs directly from the workstation frontend.
 */

import { agentService } from '@/services/agent';
import { coworkService } from '@/services/cowork';
import type { CoworkMessage } from '@/types/cowork';
import {
  isWorkstationAgentId as isWorkstationAgentIdShared,
  isWorkstationCoworkSession as isWorkstationCoworkSessionShared,
  WORKSTATION_AGENT_PREFIX as SHARED_WORKSTATION_AGENT_PREFIX,
  type WorkstationCoworkSessionLike,
} from '@shared/workstation/session';
import { getDepartmentAgent } from '../data/departmentAgents';

export const WORKSTATION_AGENT_PREFIX = SHARED_WORKSTATION_AGENT_PREFIX;
export const SESSION_MAP_STORAGE_KEY = 'lobsterai.workstation.sessionMap.v1';

export type WorkstationSessionMapEntry = {
  productMode: 'workstation';
  departmentId: string;
  workstationConversationId: string;
  openClawSessionId: string;
  workspacePath: string;
  memoryNamespace: string;
  updatedAt: number;
};

function normalizeDepartmentId(departmentId: string): string {
  return departmentId.trim().replace(/^workstation[-:]/, '');
}

export function formatWorkstationAgentId(departmentId: string): string {
  return `${WORKSTATION_AGENT_PREFIX}${normalizeDepartmentId(departmentId)}`;
}

export function isWorkstationAgentId(agentId?: string | null): boolean {
  return isWorkstationAgentIdShared(agentId);
}

export function isWorkstationCoworkSession(
  session: WorkstationCoworkSessionLike | null | undefined,
  options?: { workstationRootNorm?: string | null },
): boolean {
  return isWorkstationCoworkSessionShared(session, options);
}

export function parseDepartmentIdFromAgentId(agentId: string): string | null {
  const trimmed = agentId.trim();
  if (trimmed.startsWith(WORKSTATION_AGENT_PREFIX)) {
    return trimmed.slice(WORKSTATION_AGENT_PREFIX.length) || null;
  }
  if (trimmed.startsWith('workstation:')) {
    return trimmed.slice('workstation:'.length) || null;
  }
  return null;
}

export function memoryNamespaceForDepartment(departmentId: string): string {
  return `workstation-${normalizeDepartmentId(departmentId)}`;
}

/** Per-thread memory namespace — work agents stay DeepSeek-style isolated. */
export function memoryNamespaceForConversation(
  departmentId: string,
  conversationId: string,
): string {
  return `workstation-${normalizeDepartmentId(departmentId)}-${conversationId.trim()}`;
}

export function buildWorkstationIsolationPrompt(options: {
  departmentId: string;
  workspacePath: string;
  memoryNamespace?: string;
}): string {
  const departmentId = normalizeDepartmentId(options.departmentId);
  const memoryNamespace = options.memoryNamespace ?? memoryNamespaceForDepartment(departmentId);
  return [
    '[WORKSTATION_ISOLATION]',
    'productMode=workstation',
    `departmentId=${departmentId}`,
    `memoryNamespace=${memoryNamespace}`,
    `workspacePath=${options.workspacePath}`,
  ].join('\n');
}

function newConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadSessionMapFromStorage(): Map<string, WorkstationSessionMapEntry> {
  const map = new Map<string, WorkstationSessionMapEntry>();
  try {
    const raw = localStorage.getItem(SESSION_MAP_STORAGE_KEY);
    if (!raw) return map;
    const parsed = JSON.parse(raw) as Record<string, WorkstationSessionMapEntry>;
    for (const [key, value] of Object.entries(parsed)) {
      if (!value?.departmentId || !value.openClawSessionId) continue;
      // Prefer conversationId as map key (per-thread). Legacy maps were keyed by departmentId.
      const mapKey = value.workstationConversationId?.trim() || key;
      if (!value.workstationConversationId) {
        value.workstationConversationId = mapKey;
      }
      map.set(mapKey, value);
    }
  } catch {
    // ignore
  }
  return map;
}

function persistSessionMap(map: Map<string, WorkstationSessionMapEntry>): void {
  try {
    const obj: Record<string, WorkstationSessionMapEntry> = {};
    for (const [key, value] of map.entries()) {
      obj[key] = value;
    }
    localStorage.setItem(SESSION_MAP_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

/** conversationId → openClaw session id (runtime) */
const sessionByConversation = new Map<string, string>();
/** conversationId → full metadata (also persisted to localStorage) */
const sessionMapByConversation = loadSessionMapFromStorage();

// Restore openClaw bindings from persisted map on module init
for (const [conversationId, entry] of sessionMapByConversation.entries()) {
  if (entry.openClawSessionId) {
    sessionByConversation.set(conversationId, entry.openClawSessionId);
  }
}

async function upsertSessionRegistry(entry: WorkstationSessionMapEntry): Promise<void> {
  const key = entry.workstationConversationId;
  sessionMapByConversation.set(key, entry);
  persistSessionMap(sessionMapByConversation);

  try {
    await window.electron?.workstation?.sessionUpsert?.(entry);
  } catch {
    // registry is best-effort; local map still holds restore data
  }
}

export function workstationAgentDisplayName(departmentId: string): string {
  const dept = normalizeDepartmentId(departmentId);
  const meta = getDepartmentAgent(dept);
  return meta ? `${meta.name}智能体` : `${dept}智能体`;
}

/** Ensure a dedicated OpenClaw/SQLite agent exists for this department (lazy create). */
export async function ensureWorkstationAgent(
  departmentId: string,
  workingDirectory: string,
): Promise<string> {
  const agentId = formatWorkstationAgentId(departmentId);
  const existing = await window.electron?.agents?.get?.(agentId);
  if (existing) {
    const cwd = workingDirectory.trim();
    if (cwd && (existing.workingDirectory || '').trim() !== cwd) {
      try {
        await agentService.updateAgent(agentId, { workingDirectory: cwd });
      } catch {
        // best-effort cwd sync
      }
    }
    return agentId;
  }

  const name = workstationAgentDisplayName(departmentId);
  const meta = getDepartmentAgent(normalizeDepartmentId(departmentId));
  const created = await agentService.createAgent({
    id: agentId,
    name,
    description: `AI员工助手 · ${meta?.name ?? normalizeDepartmentId(departmentId)}`,
    workingDirectory,
  });
  if (!created) {
    // Race: another path may have created it; prefer get over failing the chat.
    const again = await window.electron?.agents?.get?.(agentId);
    if (!again) {
      throw new Error(`无法创建工作站智能体 ${agentId}`);
    }
  }
  return agentId;
}

/** Skip repeated getUserDataPath/ensureDirs IPC on every chat turn. */
const cwdPathCache = new Map<string, string>();

export async function resolveWorkstationCwd(departmentId: string): Promise<string> {
  const key = normalizeDepartmentId(departmentId);
  const cached = cwdPathCache.get(key);
  if (cached) return cached;

  const electron = window.electron as Window['electron'] & {
    workstation?: {
      getUserDataPath?: (departmentId?: string) => Promise<{
        userData: string;
        workstationRoot: string;
        lobsterRoot: string;
        departmentPath: string;
      }>;
      ensureDirs?: (departmentId?: string) => Promise<{ departmentPath: string }>;
    };
  };

  if (electron?.workstation?.getUserDataPath) {
    const paths = await electron.workstation.getUserDataPath(departmentId);
    if (electron.workstation.ensureDirs) {
      await electron.workstation.ensureDirs(departmentId);
    }
    cwdPathCache.set(key, paths.departmentPath);
    return paths.departmentPath;
  }

  // Fallback: ask main for generic userData if exposed
  const appInfo = electron?.appInfo as { getUserDataPath?: () => Promise<string> } | undefined;
  if (appInfo?.getUserDataPath) {
    const userData = await appInfo.getUserDataPath();
    const fallback = `${userData}/workstation/${departmentId}`;
    cwdPathCache.set(key, fallback);
    return fallback;
  }

  throw new Error('workstation:getUserDataPath IPC unavailable');
}

export type LobsterChatStreamHandlers = {
  onDelta?: (text: string) => void;
  onDone?: (content: string) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
};

type ActiveTurn = {
  sessionId: string;
  assistantContent: string;
  handlers: LobsterChatStreamHandlers;
  cleanups: Array<() => void>;
  settled: boolean;
  resolve: (content: string) => void;
  reject: (error: Error) => void;
};

let activeTurn: ActiveTurn | null = null;

function isAssistantLike(message: CoworkMessage): boolean {
  return message.type === 'assistant';
}

function attachStreamListeners(turn: ActiveTurn): void {
  const cowork = window.electron?.cowork;
  if (!cowork) return;

  const onMessage = cowork.onStreamMessage?.(({ sessionId, message }) => {
    if (sessionId !== turn.sessionId || turn.settled) return;
    if (message.type === 'system' && typeof message.content === 'string' && /error|失败|失败/i.test(message.content)) {
      // soft: keep streaming; hard errors usually come via onStreamError
    }
    if (isAssistantLike(message) && typeof message.content === 'string') {
      const next = message.content;
      const prev = turn.assistantContent;
      if (next.startsWith(prev) && next.length > prev.length) {
        turn.handlers.onDelta?.(next.slice(prev.length));
      } else if (next !== prev) {
        turn.handlers.onDelta?.(next);
      }
      turn.assistantContent = next;
    }
  });

  const onUpdate = cowork.onStreamMessageUpdate?.(({ sessionId, messageId: _id, content }) => {
    void _id;
    if (sessionId !== turn.sessionId || turn.settled || content == null) return;
    const next = String(content);
    const prev = turn.assistantContent;
    if (next.startsWith(prev) && next.length > prev.length) {
      turn.handlers.onDelta?.(next.slice(prev.length));
    } else if (next !== prev) {
      turn.handlers.onDelta?.(next);
    }
    turn.assistantContent = next;
  });

  const onComplete = cowork.onStreamComplete?.(({ sessionId }) => {
    if (sessionId !== turn.sessionId || turn.settled) return;
    settleTurn(turn, null);
  });

  const onError = cowork.onStreamError?.(({ sessionId, error }) => {
    if (sessionId !== turn.sessionId || turn.settled) return;
    settleTurn(turn, new Error(error || '会话出错'));
  });

  if (onMessage) turn.cleanups.push(onMessage);
  if (onUpdate) turn.cleanups.push(onUpdate);
  if (onComplete) turn.cleanups.push(onComplete);
  if (onError) turn.cleanups.push(onError);
}

function settleTurn(turn: ActiveTurn, error: Error | null): void {
  if (turn.settled) return;
  turn.settled = true;
  for (const cleanup of turn.cleanups) {
    try {
      cleanup();
    } catch {
      // ignore
    }
  }
  turn.cleanups = [];
  if (activeTurn === turn) activeTurn = null;

  if (error) {
    turn.handlers.onError?.(error.message);
    turn.reject(error);
    return;
  }
  turn.handlers.onDone?.(turn.assistantContent);
  turn.resolve(turn.assistantContent);
}

async function waitForTurn(
  sessionId: string,
  handlers: LobsterChatStreamHandlers,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const turn: ActiveTurn = {
      sessionId,
      assistantContent: '',
      handlers,
      cleanups: [],
      settled: false,
      resolve,
      reject,
    };
    activeTurn = turn;
    attachStreamListeners(turn);

    const onAbort = () => {
      void stopWorkstationChat(sessionId);
      settleTurn(turn, new DOMException('Aborted', 'AbortError'));
    };
    if (handlers.signal) {
      if (handlers.signal.aborted) {
        onAbort();
        return;
      }
      handlers.signal.addEventListener('abort', onAbort, { once: true });
      turn.cleanups.push(() => handlers.signal?.removeEventListener('abort', onAbort));
    }
  });
}

function mergeSystemPrompt(isolationBlock: string, extra?: string): string {
  if (!extra?.trim()) return isolationBlock;
  if (extra.includes('[WORKSTATION_ISOLATION]')) return extra;
  return `${isolationBlock}\n\n${extra}`;
}

async function recordSessionSuccess(options: {
  departmentId: string;
  conversationId: string;
  openClawSessionId: string;
  workspacePath: string;
}): Promise<void> {
  const departmentId = options.departmentId.trim().replace(/^workstation[-:]/, '');
  const conversationId = options.conversationId.trim() || newConversationId();
  const memoryNamespace = memoryNamespaceForConversation(departmentId, conversationId);
  const entry: WorkstationSessionMapEntry = {
    productMode: 'workstation',
    departmentId,
    workstationConversationId: conversationId,
    openClawSessionId: options.openClawSessionId,
    workspacePath: options.workspacePath,
    memoryNamespace,
    updatedAt: Date.now(),
  };
  sessionByConversation.set(conversationId, options.openClawSessionId);
  await upsertSessionRegistry(entry);
}

export async function startWorkstationChat(options: {
  departmentId: string;
  conversationId?: string;
  prompt: string;
  systemPrompt?: string;
  title?: string;
  handlers?: LobsterChatStreamHandlers;
}): Promise<{ sessionId: string; content: string }> {
  const departmentId = options.departmentId.trim().replace(/^workstation[-:]/, '');
  const conversationId = options.conversationId?.trim() || newConversationId();
  const cwd = await resolveWorkstationCwd(departmentId);
  const memoryNamespace = memoryNamespaceForConversation(departmentId, conversationId);
  const isolation = buildWorkstationIsolationPrompt({
    departmentId,
    workspacePath: cwd,
    memoryNamespace,
  });
  const systemPrompt = mergeSystemPrompt(isolation, options.systemPrompt);
  const existingSessionId = sessionByConversation.get(conversationId);

  if (existingSessionId) {
    try {
      // Subscribe before continueSession — runTurn is fire-and-forget and early
      // tokens are lost if listeners attach after the turn has already started.
      const turnPromise = waitForTurn(existingSessionId, options.handlers ?? {});
      const ok = await coworkService.continueSession({
        sessionId: existingSessionId,
        prompt: options.prompt,
        systemPrompt,
      });
      void recordSessionSuccess({
        departmentId,
        conversationId,
        openClawSessionId: existingSessionId,
        workspacePath: cwd,
      });
      if (!ok) {
        if (activeTurn?.sessionId === existingSessionId && !activeTurn.settled) {
          settleTurn(activeTurn, new Error('继续会话失败'));
        }
        await turnPromise.catch(() => undefined);
        throw new Error('继续会话失败');
      }
      const content = await turnPromise;
      return { sessionId: existingSessionId, content };
    } catch (error) {
      if (activeTurn?.sessionId === existingSessionId && !activeTurn.settled) {
        settleTurn(
          activeTurn,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      // Stale bindings → recreate for this thread only.
      clearWorkstationSessionBinding(departmentId, conversationId);
      try {
        await window.electron?.workstation?.sessionRemove?.(existingSessionId);
      } catch {
        // ignore
      }
      console.warn(
        '[lobsterChatBridge] continue failed; starting fresh session',
        error instanceof Error ? error.message : error,
      );
    }
  }

  const agentId = await ensureWorkstationAgent(departmentId, cwd);
  const result = await coworkService.startSession({
    prompt: options.prompt,
    cwd,
    systemPrompt,
    title: options.title ?? `[WS:${departmentId}] ${workstationAgentDisplayName(departmentId)}`,
    agentId,
  });

  if (!result.session) {
    throw new Error(result.error || '创建会话失败');
  }

  // Attach immediately after session id is known; do not await registry IPC first.
  const turnPromise = waitForTurn(result.session.id, options.handlers ?? {});
  void recordSessionSuccess({
    departmentId,
    conversationId,
    openClawSessionId: result.session.id,
    workspacePath: cwd,
  });
  const content = await turnPromise;
  return { sessionId: result.session.id, content };
}

export async function continueWorkstationChat(options: {
  departmentId: string;
  conversationId?: string;
  prompt: string;
  systemPrompt?: string;
  handlers?: LobsterChatStreamHandlers;
}): Promise<{ sessionId: string; content: string }> {
  return startWorkstationChat(options);
}

export async function stopWorkstationChat(sessionId?: string): Promise<void> {
  const id = sessionId ?? activeTurn?.sessionId;
  if (!id) return;
  await coworkService.stopSession(id);
}

/** Clear one thread binding, or all bindings for a department when conversationId omitted. */
export function clearWorkstationSessionBinding(
  departmentId: string,
  conversationId?: string,
): void {
  const dept = normalizeDepartmentId(departmentId);
  if (conversationId?.trim()) {
    const cid = conversationId.trim();
    sessionByConversation.delete(cid);
    sessionMapByConversation.delete(cid);
  } else {
    for (const [cid, entry] of [...sessionMapByConversation.entries()]) {
      if (normalizeDepartmentId(entry.departmentId) === dept) {
        sessionByConversation.delete(cid);
        sessionMapByConversation.delete(cid);
      }
    }
  }
  persistSessionMap(sessionMapByConversation);
}

export function getBoundWorkstationSessionId(conversationId: string): string | undefined {
  return sessionByConversation.get(conversationId.trim());
}

export function getWorkstationSessionMapEntry(
  conversationId: string,
): WorkstationSessionMapEntry | undefined {
  return sessionMapByConversation.get(conversationId.trim());
}