import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ChatAgentCode,
  ChatAttachment,
  ChatMessage,
  Conversation,
} from '@aw/shared';
import { DEFAULT_CHAT_AGENT } from '@workstation/constants/chatAgents';

export type LibraryFile = ChatAttachment & {
  /** 加入文件库时间（本地） */
  addedAt?: string;
};

type ChatState = {
  conversations: Conversation[];
  messagesByConversation: Record<string, ChatMessage[]>;
  activeConversationId: string | null;
  selectedAgentCode: ChatAgentCode;
  recentFiles: LibraryFile[];
  /** 从文件库「在对话中使用」时暂存，进入聊天页后由 Composer 取走 */
  pendingComposerAttachments: ChatAttachment[];
};

type ChatActions = {
  setSelectedAgent: (code: ChatAgentCode) => void;
  prepareNewChat: (agentCode?: ChatAgentCode) => string;
  createConversation: (agentCode?: ChatAgentCode) => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  clearActiveConversation: () => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>,
  ) => void;
  setConversationMessages: (conversationId: string, messages: ChatMessage[]) => void;
  setConversationTitle: (id: string, title: string) => void;
  touchConversation: (id: string) => void;
  addRecentFile: (file: ChatAttachment) => void;
  removeRecentFile: (fileId: string) => void;
  useFileInChat: (file: ChatAttachment) => void;
  consumePendingComposerAttachments: () => ChatAttachment[];
  getMessages: (conversationId: string) => ChatMessage[];
};

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 将首条用户问题（及可选助手回复）总结为侧栏历史标题 */
function summarizeConversationTitle(userText: string, assistantText?: string): string {
  const user = userText.trim().replace(/\s+/g, ' ');
  const assistant = (assistantText ?? '').replace(/[#*`|_]/g, ' ').trim().replace(/\s+/g, ' ');

  if (/^(你好|您好|hi|hello|hey)[！!。.\s]*$/i.test(user)) {
    if (assistant) {
      const topic = assistant.slice(0, 20);
      return topic.length < assistant.length ? `${topic}…` : topic || '新对话';
    }
    return '打招呼';
  }

  if (!user) {
    if (assistant) {
      const topic = assistant.slice(0, 20);
      return topic.length < assistant.length ? `${topic}…` : topic;
    }
    return '新对话';
  }

  return user.length > 20 ? `${user.slice(0, 20)}…` : user;
}

function deriveTitle(content: string): string {
  return summarizeConversationTitle(content);
}

function countEmptyConversations(conversations: Conversation[], messagesByConversation: Record<string, ChatMessage[]>): number {
  return conversations.filter((item) => (messagesByConversation[item.id] ?? []).length === 0).length;
}

function nextNewConversationTitle(
  conversations: Conversation[],
  messagesByConversation: Record<string, ChatMessage[]>,
): string {
  const emptyCount = countEmptyConversations(conversations, messagesByConversation);
  return emptyCount === 0 ? '新对话' : `新对话 ${emptyCount + 1}`;
}

export const useChatStore = create<ChatState & ChatActions>()(
  persist(
    (set, get) => ({
      conversations: [],
      messagesByConversation: {},
      activeConversationId: null,
      selectedAgentCode: DEFAULT_CHAT_AGENT,
      recentFiles: [],
      pendingComposerAttachments: [],

      setSelectedAgent: (code) => set({ selectedAgentCode: code }),

      createConversation: (agentCode) => {
        const state = get();
        const now = new Date().toISOString();
        const id = newId('conv');
        const code = agentCode ?? state.selectedAgentCode;
        const conversation: Conversation = {
          id,
          title: nextNewConversationTitle(state.conversations, state.messagesByConversation),
          agentCode: code,
          createdAt: now,
          updatedAt: now,
        };
        set({
          conversations: [conversation, ...state.conversations],
          messagesByConversation: { ...state.messagesByConversation, [id]: [] },
          activeConversationId: id,
          selectedAgentCode: code,
        });
        return id;
      },

      /** 新建对话：始终保证侧边栏有可见条目，空对话不会被切换时清掉。 */
      prepareNewChat: (agentCode) => {
        const state = get();
        const activeId = state.activeConversationId;
        const activeMessages = activeId ? state.messagesByConversation[activeId] ?? [] : [];

        if (activeId && activeMessages.length === 0) {
          const code = agentCode ?? state.selectedAgentCode;
          set({
            selectedAgentCode: code,
            conversations: state.conversations.map((item) =>
              item.id === activeId
                ? { ...item, agentCode: code, updatedAt: new Date().toISOString() }
                : item,
            ),
          });
          return activeId;
        }

        return get().createConversation(agentCode);
      },

      selectConversation: (id) =>
        set((state) => ({
          activeConversationId: id,
          selectedAgentCode:
            state.conversations.find((item) => item.id === id)?.agentCode ?? state.selectedAgentCode,
        })),

      deleteConversation: (id) =>
        set((state) => {
          const { [id]: _removed, ...restMessages } = state.messagesByConversation;
          const conversations = state.conversations.filter((item) => item.id !== id);
          const activeConversationId =
            state.activeConversationId === id
              ? conversations[0]?.id ?? null
              : state.activeConversationId;
          return {
            conversations,
            messagesByConversation: restMessages,
            activeConversationId,
          };
        }),

      clearActiveConversation: () => set({ activeConversationId: null }),

      addMessage: (conversationId, message) =>
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: [...(state.messagesByConversation[conversationId] ?? []), message],
          },
        })),

      updateMessage: (conversationId, messageId, patch) =>
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((item) =>
              item.id === messageId ? { ...item, ...patch } : item,
            ),
          },
        })),

      setConversationMessages: (conversationId, messages) =>
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: messages,
          },
        })),

      setConversationTitle: (id, title) =>
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === id ? { ...item, title, updatedAt: new Date().toISOString() } : item,
          ),
        })),

      touchConversation: (id) =>
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === id ? { ...item, updatedAt: new Date().toISOString() } : item,
          ),
        })),

      addRecentFile: (file) =>
        set((state) => {
          const next: LibraryFile = {
            ...file,
            addedAt: new Date().toISOString(),
          };
          return {
            recentFiles: [
              next,
              ...state.recentFiles.filter((item) => item.fileId !== file.fileId),
            ].slice(0, 100),
          };
        }),

      removeRecentFile: (fileId) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter((item) => item.fileId !== fileId),
        })),

      useFileInChat: (file) =>
        set((state) => {
          if (!file.fileId) return state;
          const exists = state.pendingComposerAttachments.some((item) => item.fileId === file.fileId);
          if (exists) return state;
          return {
            pendingComposerAttachments: [
              ...state.pendingComposerAttachments,
              { ...file, status: 'ready' as const },
            ],
          };
        }),

      consumePendingComposerAttachments: () => {
        const pending = get().pendingComposerAttachments;
        if (!pending.length) return [];
        set({ pendingComposerAttachments: [] });
        return pending;
      },

      getMessages: (conversationId) => get().messagesByConversation[conversationId] ?? [],
    }),
    {
      name: 'aw.desktop.chat.v1',
      partialize: (state) => ({
        conversations: state.conversations,
        messagesByConversation: state.messagesByConversation,
        activeConversationId: state.activeConversationId,
        selectedAgentCode: state.selectedAgentCode,
        recentFiles: state.recentFiles,
        // pendingComposerAttachments 不持久化
      }),
    },
  ),
);

export { deriveTitle, summarizeConversationTitle, newId };
