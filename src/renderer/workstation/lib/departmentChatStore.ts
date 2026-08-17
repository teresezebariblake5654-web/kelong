import type { DepartmentCode } from '@workstation/data/departmentAgents';

/** Isolated from Lobster Cowork; multi-thread archive per department (DeepSeek-style). */
const STORAGE_KEY_V2 = 'lobsterai.workstation.deptChat.v2';
const STORAGE_KEY_V1 = 'lobsterai.workstation.deptChat.v1';
const MAX_MESSAGES = 200;
const MAX_THREADS_PER_DEPT = 50;

export type DepartmentChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type DepartmentChatThread = {
  departmentCode: DepartmentCode;
  conversationId: string;
  modeId: string;
  messages: DepartmentChatMessage[];
  updatedAt: string;
  /** DeepSeek-style list title */
  title: string;
  /** One-line preview for the history rail */
  preview: string;
};

export type DepartmentChatHistoryItem = {
  conversationId: string;
  title: string;
  preview: string;
  modeId: string;
  updatedAt: string;
  messageCount: number;
};

type DepartmentChatArchive = {
  activeId: string | null;
  threads: DepartmentChatThread[];
};

type DepartmentChatStoreV2 = Record<string, DepartmentChatArchive>;

function newConversationId() {
  return `dept-chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function deriveTitle(messages: DepartmentChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return '新对话';
  const cleaned = firstUser.content
    .replace(/（请基于已上传表格给出分析结论）/g, '')
    .replace(/（附件消息）/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '新对话';
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}…` : cleaned;
}

function derivePreview(messages: DepartmentChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (!item || item.role === 'system') continue;
    const cleaned = item.content.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
  }
  return '暂无内容';
}

function withMeta(
  thread: Omit<DepartmentChatThread, 'title' | 'preview'> &
    Partial<Pick<DepartmentChatThread, 'title' | 'preview'>>,
): DepartmentChatThread {
  return {
    ...thread,
    title: thread.title?.trim() || deriveTitle(thread.messages),
    preview: thread.preview?.trim() || derivePreview(thread.messages),
  };
}

function readStore(): DepartmentChatStoreV2 {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as DepartmentChatStoreV2;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // fall through to v1 migration
  }

  try {
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (!rawV1) return {};
    const parsed = JSON.parse(rawV1) as Record<
      string,
      {
        departmentCode: DepartmentCode;
        conversationId: string;
        modeId: string;
        messages: DepartmentChatMessage[];
        updatedAt: string;
      }
    >;
    if (!parsed || typeof parsed !== 'object') return {};

    const migrated: DepartmentChatStoreV2 = {};
    for (const [code, thread] of Object.entries(parsed)) {
      if (!thread || !Array.isArray(thread.messages)) continue;
      const normalized = withMeta({
        departmentCode: thread.departmentCode || (code as DepartmentCode),
        conversationId: thread.conversationId || newConversationId(),
        modeId: thread.modeId || '',
        messages: thread.messages.slice(-MAX_MESSAGES),
        updatedAt: thread.updatedAt || new Date().toISOString(),
      });
      migrated[code] = {
        activeId: normalized.conversationId,
        threads: [normalized],
      };
    }
    writeStore(migrated);
    return migrated;
  } catch {
    return {};
  }
}

function writeStore(store: DepartmentChatStoreV2) {
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(store));
}

function getArchive(departmentCode: DepartmentCode): DepartmentChatArchive {
  const store = readStore();
  return store[departmentCode] ?? { activeId: null, threads: [] };
}

function setArchive(departmentCode: DepartmentCode, archive: DepartmentChatArchive) {
  const store = readStore();
  store[departmentCode] = {
    activeId: archive.activeId,
    threads: archive.threads.slice(0, MAX_THREADS_PER_DEPT),
  };
  writeStore(store);
}

export function listDepartmentChatHistory(
  departmentCode: DepartmentCode,
): DepartmentChatHistoryItem[] {
  const archive = getArchive(departmentCode);
  return [...archive.threads]
    .filter((t) => t.messages.some((m) => m.role === 'user' || m.role === 'assistant'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((t) => ({
      conversationId: t.conversationId,
      title: t.title || deriveTitle(t.messages),
      preview: t.preview || derivePreview(t.messages),
      modeId: t.modeId,
      updatedAt: t.updatedAt,
      messageCount: t.messages.length,
    }));
}

export function getActiveDepartmentConversationId(
  departmentCode: DepartmentCode,
): string | null {
  return getArchive(departmentCode).activeId;
}

/** Load active thread, or a specific conversationId within this department. */
export function loadDepartmentChatThread(
  departmentCode: DepartmentCode,
  conversationId?: string | null,
): DepartmentChatThread | null {
  const archive = getArchive(departmentCode);
  if (!archive.threads.length) return null;
  const id = conversationId || archive.activeId;
  if (id) {
    const found = archive.threads.find((t) => t.conversationId === id);
    if (found) return withMeta(found);
  }
  return withMeta(archive.threads[0]!);
}

export function saveDepartmentChatThread(input: {
  departmentCode: DepartmentCode;
  conversationId: string;
  modeId: string;
  messages: DepartmentChatMessage[];
}): DepartmentChatThread {
  const archive = getArchive(input.departmentCode);
  const thread = withMeta({
    departmentCode: input.departmentCode,
    conversationId: input.conversationId,
    modeId: input.modeId,
    messages: input.messages.slice(-MAX_MESSAGES),
    updatedAt: new Date().toISOString(),
  });

  const without = archive.threads.filter((t) => t.conversationId !== thread.conversationId);
  // Empty chats stay out of the history list until there is content.
  const nextThreads = thread.messages.length
    ? [thread, ...without].slice(0, MAX_THREADS_PER_DEPT)
    : without;

  setArchive(input.departmentCode, {
    activeId: thread.conversationId,
    threads: nextThreads,
  });

  return thread;
}

/** Start a fresh DeepSeek-style conversation for this department only. */
export function createDepartmentChatThread(
  departmentCode: DepartmentCode,
  modeId = '',
): DepartmentChatThread {
  const archive = getArchive(departmentCode);
  const thread = withMeta({
    departmentCode,
    conversationId: newConversationId(),
    modeId,
    messages: [],
    updatedAt: new Date().toISOString(),
    title: '新对话',
    preview: '暂无内容',
  });
  setArchive(departmentCode, {
    activeId: thread.conversationId,
    threads: archive.threads,
  });
  return thread;
}

export function setActiveDepartmentChatThread(
  departmentCode: DepartmentCode,
  conversationId: string,
): DepartmentChatThread | null {
  const archive = getArchive(departmentCode);
  const thread = archive.threads.find((t) => t.conversationId === conversationId);
  if (!thread) return null;
  setArchive(departmentCode, { ...archive, activeId: conversationId });
  return withMeta(thread);
}

export function deleteDepartmentChatThread(
  departmentCode: DepartmentCode,
  conversationId: string,
): void {
  const archive = getArchive(departmentCode);
  const threads = archive.threads.filter((t) => t.conversationId !== conversationId);
  const activeId =
    archive.activeId === conversationId ? (threads[0]?.conversationId ?? null) : archive.activeId;
  setArchive(departmentCode, { activeId, threads });
}

export function clearDepartmentChatThread(departmentCode: DepartmentCode) {
  const store = readStore();
  delete store[departmentCode];
  writeStore(store);
}

export function clearDepartmentChatHistory(departmentCode: DepartmentCode) {
  clearDepartmentChatThread(departmentCode);
}

export function formatDepartmentHistoryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return `今天 ${hm}`;
  if (isYesterday) return `昨天 ${hm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
