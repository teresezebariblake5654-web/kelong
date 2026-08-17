import { getTaskTemplate } from '@aw/task-templates';
import type { DepartmentCode } from '@workstation/data/departmentAgents';
import { getDepartmentCodeForTemplateCode } from '@workstation/data/departmentAgents';
import type { HistoryItem } from '@workstation/lib/localStore';
import { updateHistoryItem } from '@workstation/lib/localStore';
import { roleToAgentCode } from '@workstation/lib/roleToAgent';
import { getChatService } from '@workstation/services/chat';

const SESSIONS_KEY = 'lobsterai.workstation.deptSessions';
const MAX_SESSIONS = 80;

export type DepartmentWorkspaceMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type DepartmentTaskSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  departmentCode: DepartmentCode;
  templateCode: string;
  templateVersion: string;
  templateName: string;
  userInstruction?: string;
  fileName?: string;
  fileIds?: string[];
  conversationId: string;
  analysisText: string;
  analysisResult?: unknown;
  messages: DepartmentWorkspaceMessage[];
};

function newMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadDepartmentTaskSessions(): DepartmentTaskSession[] {
  const raw = localStorage.getItem(SESSIONS_KEY);
  return raw ? (JSON.parse(raw) as DepartmentTaskSession[]) : [];
}

export function loadDepartmentTaskSession(id: string): DepartmentTaskSession | undefined {
  return loadDepartmentTaskSessions().find((item) => item.id === id);
}

export function saveDepartmentTaskSession(session: DepartmentTaskSession) {
  const list = loadDepartmentTaskSessions().filter((item) => item.id !== session.id);
  list.unshift(session);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)));
}

/** 用完整分析结果重建首轮对话，保留后续追问 */
export function normalizeSessionMessages(session: DepartmentTaskSession): DepartmentTaskSession {
  const userContent = buildUserTaskMessage({
    userInstruction: session.userInstruction,
    fileName: session.fileName,
    taskName: session.templateName,
  });
  const fullAssistant = session.analysisText.trim();
  if (!fullAssistant) return session;

  const firstUser = session.messages.find((item) => item.role === 'user');
  const firstAssistant = session.messages.find((item) => item.role === 'assistant');
  const followUpStart = session.messages.findIndex((item) => item.role === 'assistant');
  const followUps =
    followUpStart >= 0 ? session.messages.slice(followUpStart + 1) : session.messages.slice(2);

  const rebuiltUser = {
    id: firstUser?.id ?? newMessageId('user'),
    role: 'user' as const,
    content: userContent,
  };
  const rebuiltAssistant = {
    id: firstAssistant?.id ?? newMessageId('assistant'),
    role: 'assistant' as const,
    content: fullAssistant,
  };

  const truncated =
    !firstAssistant || firstAssistant.content.length < Math.min(fullAssistant.length, fullAssistant.length * 0.95);
  const missingUser = !firstUser;

  if (!truncated && !missingUser) {
    return session;
  }

  const next: DepartmentTaskSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    messages: [rebuiltUser, rebuiltAssistant, ...followUps],
  };
  saveDepartmentTaskSession(next);
  return next;
}

export function upgradeSessionFromHistory(
  session: DepartmentTaskSession,
  item: HistoryItem,
): DepartmentTaskSession {
  const fullText = item.analysisText?.trim() || item.summary?.trim() || session.analysisText;
  const next: DepartmentTaskSession = {
    ...session,
    analysisText: fullText.length > session.analysisText.length ? fullText : session.analysisText,
    userInstruction: item.userInstruction ?? session.userInstruction,
    fileName: item.fileName || session.fileName,
  };
  return normalizeSessionMessages(next);
}

export function appendDepartmentSessionMessages(
  sessionId: string,
  messages: DepartmentWorkspaceMessage[],
): DepartmentTaskSession | undefined {
  const session = loadDepartmentTaskSession(sessionId);
  if (!session) return undefined;
  const next: DepartmentTaskSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    messages: [...session.messages, ...messages],
  };
  saveDepartmentTaskSession(next);
  return next;
}

export function buildUserTaskMessage(input: {
  userInstruction?: string;
  fileName?: string;
  taskName: string;
}): string {
  const parts = [
    input.userInstruction?.trim(),
    input.fileName ? `附件：${input.fileName}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('\n') : `（${input.taskName} 分析任务）`;
}

export function createDepartmentTaskSession(input: {
  id: string;
  departmentCode: DepartmentCode;
  templateCode: string;
  templateVersion: string;
  templateName: string;
  userInstruction?: string;
  fileName?: string;
  fileIds?: string[];
  conversationId: string;
  analysisText: string;
  analysisResult?: unknown;
}): DepartmentTaskSession {
  const now = new Date().toISOString();
  const userContent = buildUserTaskMessage({
    userInstruction: input.userInstruction,
    fileName: input.fileName,
    taskName: input.templateName,
  });
  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    departmentCode: input.departmentCode,
    templateCode: input.templateCode,
    templateVersion: input.templateVersion,
    templateName: input.templateName,
    userInstruction: input.userInstruction,
    fileName: input.fileName,
    fileIds: input.fileIds,
    conversationId: input.conversationId,
    analysisText: input.analysisText,
    analysisResult: input.analysisResult,
    messages: [
      {
        id: newMessageId('user'),
        role: 'user',
        content: userContent,
      },
      {
        id: newMessageId('assistant'),
        role: 'assistant',
        content: input.analysisText,
      },
    ],
  };
}

export async function sendDepartmentFollowUp(
  session: DepartmentTaskSession,
  question: string,
): Promise<string> {
  const task = getTaskTemplate(session.templateCode, session.templateVersion);
  if (!task) {
    throw new Error('未找到对应的工作模式模板');
  }

  const prior = [
    session.analysisText ? `【已有分析结果】\n${session.analysisText}` : '',
    ...session.messages
      .filter((item) => item.role !== 'system')
      .slice(2)
      .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`),
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await getChatService().sendMessage({
    conversationId: session.conversationId,
    agentCode: roleToAgentCode(task.role, task),
    content: prior ? `${prior}\n\n【继续追问】${question}` : question,
    fileIds: session.fileIds ?? [],
    imageIds: [],
    templateCode: session.templateCode,
    userInstruction: question,
  });

  return response.content;
}

/** 将任务历史与已存会话重新关联，并回填完整分析文本 */
export function relinkHistoryWithSessions(history: HistoryItem[]): HistoryItem[] {
  const sessions = loadDepartmentTaskSessions();
  if (!sessions.length) return history;

  const next = history.map((item) => {
    const session = sessions.find(
      (entry) => entry.id === item.sessionId || entry.id === item.id,
    );
    if (!session) return item;

    const analysisText =
      session.analysisText.length > (item.analysisText?.length ?? 0)
        ? session.analysisText
        : item.analysisText;
    const patched = {
      ...item,
      sessionId: item.sessionId ?? session.id,
      departmentCode: item.departmentCode ?? session.departmentCode,
      analysisText,
      userInstruction: item.userInstruction ?? session.userInstruction,
    };

    if (
      patched.sessionId !== item.sessionId ||
      patched.departmentCode !== item.departmentCode ||
      patched.analysisText !== item.analysisText ||
      patched.userInstruction !== item.userInstruction
    ) {
      updateHistoryItem(item.id, {
        sessionId: patched.sessionId,
        departmentCode: patched.departmentCode,
        analysisText: patched.analysisText,
        userInstruction: patched.userInstruction,
      });
    }
    return patched;
  });

  return next;
}

/** 打开历史时：读取完整会话并修复被截断的旧数据 */
export function resolveSessionForHistoryItem(item: HistoryItem): DepartmentTaskSession | null {
  const departmentCode =
    item.departmentCode ?? getDepartmentCodeForTemplateCode(item.taskCode);
  if (!departmentCode) return null;

  const task = getTaskTemplate(item.taskCode);
  if (!task) return null;

  const fullText = item.analysisText?.trim() || item.summary?.trim();
  if (!fullText) return null;

  const existing = loadDepartmentTaskSession(item.sessionId ?? item.id);
  if (existing) {
    return upgradeSessionFromHistory(existing, {
      ...item,
      analysisText: fullText,
    });
  }

  const session = createDepartmentTaskSession({
    id: item.id,
    departmentCode,
    templateCode: item.taskCode,
    templateVersion: task.version,
    templateName: item.taskName,
    userInstruction: item.userInstruction,
    fileName: item.fileName || undefined,
    conversationId: `hist-${item.id}`,
    analysisText: fullText,
  });
  saveDepartmentTaskSession(session);
  updateHistoryItem(item.id, {
    sessionId: session.id,
    departmentCode,
    analysisText: fullText,
    userInstruction: item.userInstruction,
  });
  return session;
}

export function sessionToWorkspaceMessages(session: DepartmentTaskSession) {
  return normalizeSessionMessages(session).messages.filter((item) => item.role !== 'system');
}
