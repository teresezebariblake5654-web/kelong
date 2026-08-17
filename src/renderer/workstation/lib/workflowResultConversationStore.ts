import type { DesktopExecuteResult } from '@workstation/services/workflow';

const STORAGE_KEY = 'aw.desktop.workflowResultConversations.v1';
const MAX_SESSIONS = 80;
const MAX_MESSAGES = 20;
const MAX_CONTEXT_CHARS = 24_000;

export type WorkflowResultMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export type WorkflowResultSnapshot = {
  runId: string;
  workflowId: string;
  workflowVersion: string;
  workflowName: string;
  status: DesktopExecuteResult['status'];
  executedAt: string;
  outputFileName?: string;
  metrics: DesktopExecuteResult['metrics'];
  exceptions: DesktopExecuteResult['exceptions'];
  effectiveRules: Record<string, unknown>;
  aiSummaryPayload?: Record<string, unknown>;
};

export type WorkflowResultConversation = {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  snapshot: WorkflowResultSnapshot;
  messages: WorkflowResultMessage[];
};

function readSessions(): WorkflowResultConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkflowResultConversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: WorkflowResultConversation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
}

export function workflowResultConversationId(
  organizationId: string,
  workflowId: string,
  runId: string,
): string {
  return `${organizationId}:${workflowId}:${runId}`;
}

export function createWorkflowResultSnapshot(input: {
  result: DesktopExecuteResult;
  workflowName: string;
  outputFileName?: string;
}): WorkflowResultSnapshot {
  const { result } = input;
  return {
    runId: result.runId,
    workflowId: result.workflowId,
    workflowVersion: result.workflowVersion,
    workflowName: input.workflowName,
    status: result.status,
    executedAt: result.executedAt,
    outputFileName: input.outputFileName,
    metrics: result.metrics,
    exceptions: result.exceptions,
    effectiveRules: result.effectiveRules,
    aiSummaryPayload: result.aiSummaryPayload,
  };
}

export function loadOrCreateWorkflowResultConversation(input: {
  organizationId: string;
  snapshot: WorkflowResultSnapshot;
}): WorkflowResultConversation {
  const id = workflowResultConversationId(
    input.organizationId,
    input.snapshot.workflowId,
    input.snapshot.runId,
  );
  const existing = readSessions().find((item) => item.id === id);
  if (existing) return existing;

  const now = new Date().toISOString();
  const session: WorkflowResultConversation = {
    id,
    organizationId: input.organizationId,
    createdAt: now,
    updatedAt: now,
    snapshot: input.snapshot,
    messages: [],
  };
  writeSessions([session, ...readSessions()]);
  return session;
}

export function saveWorkflowResultConversation(
  session: WorkflowResultConversation,
): WorkflowResultConversation {
  const next = {
    ...session,
    updatedAt: new Date().toISOString(),
    messages: session.messages.slice(-MAX_MESSAGES),
  };
  writeSessions([next, ...readSessions().filter((item) => item.id !== next.id)]);
  return next;
}

export function newWorkflowResultMessage(
  role: WorkflowResultMessage['role'],
  content: string,
): WorkflowResultMessage {
  return {
    id: `workflow-msg-${crypto.randomUUID()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function truncateJson(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars)}\n…（内容过长，已截断）`;
}

/** 仅构造脱敏结果上下文；不包含原始工作簿、文件路径或二进制内容。 */
export function buildWorkflowResultPrompt(
  session: WorkflowResultConversation,
  question: string,
): string {
  const snapshot = session.snapshot;
  const resultContext = {
    workflow: {
      id: snapshot.workflowId,
      name: snapshot.workflowName,
      version: snapshot.workflowVersion,
      runId: snapshot.runId,
      status: snapshot.status,
      executedAt: snapshot.executedAt,
      outputFileName: snapshot.outputFileName,
    },
    metrics: snapshot.metrics,
    exceptions: snapshot.exceptions,
    effectiveRules: snapshot.effectiveRules,
    aiSummaryPayload: snapshot.aiSummaryPayload,
  };
  const resultText = truncateJson(resultContext, 16_000);
  const historyBudget = Math.max(0, MAX_CONTEXT_CHARS - resultText.length - question.length);
  const history = session.messages
    .slice(-10)
    .map((item) => `${item.role === 'user' ? '用户' : '智能体'}：${item.content}`)
    .join('\n\n')
    .slice(-historyBudget);

  return [
    '你正在解释一次已经完成的本地工作流结果。数字以结果快照为准，不得编造快照中不存在的明细。若问题需要原始行数据，请明确说明当前上下文不足。',
    '',
    '【本地结果快照】',
    resultText,
    history ? `\n【此前追问】\n${history}` : '',
    '',
    `【本次追问】\n${question}`,
  ].join('\n');
}
