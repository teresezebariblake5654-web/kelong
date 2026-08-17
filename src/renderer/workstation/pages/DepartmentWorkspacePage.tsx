import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import type { ChatAttachment, GeneratedFile } from '@aw/shared';
import { fileToPendingAttachment } from '@workstation/components/chat/AttachmentPicker';
import { AgentWorkspace } from '@workstation/components/agent-workspace/AgentWorkspace';
import type { AgentWorkMode } from '@workstation/data/agentConfigs';
import { resolveAgentConfig } from '@workstation/data/agentConfigs';
import { getDepartmentAgent, isPublishedDepartmentCode } from '@workstation/data/departmentAgents';
import {
  buildDepartmentChatContext,
  departmentToChatAgentCode,
  matchWorkModeByQuickTask,
} from '@workstation/lib/departmentChatPersona';
import { extractSpreadsheetForChat } from '@workstation/lib/extractSpreadsheetPreview';
import { exportMessageAsTableLocally } from '@workstation/lib/exportChatTableLocal';
import {
  appendDepartmentSessionMessages,
  loadDepartmentTaskSession,
  normalizeSessionMessages,
  resolveSessionForHistoryItem,
  sessionToWorkspaceMessages,
  type DepartmentTaskSession,
} from '@workstation/lib/departmentTaskSessions';
import {
  createDepartmentChatThread,
  clearDepartmentChatHistory,
  deleteDepartmentChatThread,
  listDepartmentChatHistory,
  loadDepartmentChatThread,
  saveDepartmentChatThread,
  setActiveDepartmentChatThread,
} from '@workstation/lib/departmentChatStore';
import { clearWorkstationSessionBinding } from '@workstation/services/lobsterChatBridge';
import {
  needsWorkstationLlmKey,
  requestWorkstationLlmKeyGate,
} from '@workstation/services/workstationLlmPreset';
import {
  joinDepartmentUserMessageContent,
  splitDepartmentUserMessageContent,
} from '@workstation/lib/departmentUserMessageContent';
import { getUserAccessToken, getActiveOrganizationId, loadHistory } from '@workstation/lib/localStore';
import { getChatService, getChatServiceMode, uploadChatAttachment } from '@workstation/services/chat';
import { useWorkflow } from '@workstation/state/workflow';
import { appendAiPointsCostLine } from '@workstation/user-center/creditCopy';
import { notifyCreditsChanged } from '@workstation/user-center/creditDisplay';

function canUseDepartmentChat(): boolean {
  // Lobster/OpenClaw bridge does not require workstation cloud login.
  if (getChatServiceMode() === 'lobster') return true;
  return Boolean(getUserAccessToken() && getActiveOrganizationId());
}

type WorkspaceMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  generatedFiles?: GeneratedFile[];
  billingRequestId?: string;
  chargedCredits?: number;
};

function applyChargedCredits(
  content: string,
  response: { chargedCredits?: number; billingRequestId?: string },
): string {
  const next = appendAiPointsCostLine(content, response.chargedCredits);
  if (response.chargedCredits != null && response.chargedCredits > 0) {
    notifyCreditsChanged();
  }
  return next;
}

function attachmentKey(fileName: string, sizeBytes: number) {
  return `${fileName}::${sizeBytes}`;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 部门智能体工作台：右侧选工作模式 → 主页提示词 → 上传文件聊天开干 */
export function DepartmentWorkspacePage({
  onEnterLobster,
}: {
  onEnterLobster?: () => void;
} = {}) {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
  const { departmentCode = '' } = useParams();
  const department = getDepartmentAgent(departmentCode);
  const { patch } = useWorkflow();

  const config = useMemo(
    () => (department ? resolveAgentConfig(department) : null),
    [department],
  );

  const [modeId, setModeId] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [activeSession, setActiveSession] = useState<DepartmentTaskSession | null>(null);
  const [conversationId, setConversationId] = useState(() => newId('dept-chat'));
  const [sending, setSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState(() =>
    department ? listDepartmentChatHistory(department.code) : [],
  );
  const localFilesRef = useRef<Map<string, File>>(new Map());
  const editAttachmentSuffixRef = useRef('');
  const toastTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamDeltaRef = useRef({ assistantId: '', pending: '', raf: 0 });

  const flushStreamDelta = useCallback(() => {
    const state = streamDeltaRef.current;
    state.raf = 0;
    const chunk = state.pending;
    const assistantId = state.assistantId;
    if (!chunk || !assistantId) return;
    state.pending = '';
    setMessages((prev) =>
      prev.map((item) =>
        item.id === assistantId ? { ...item, content: `${item.content}${chunk}` } : item,
      ),
    );
  }, []);

  const appendStreamDelta = useCallback(
    (assistantId: string, text: string) => {
      const state = streamDeltaRef.current;
      if (state.assistantId !== assistantId) {
        if (state.raf) {
          window.cancelAnimationFrame(state.raf);
          state.raf = 0;
        }
        state.assistantId = assistantId;
        state.pending = '';
      }
      state.pending += text;
      if (!state.raf) {
        state.raf = window.requestAnimationFrame(() => flushStreamDelta());
      }
    },
    [flushStreamDelta],
  );

  const resetStreamDelta = useCallback((assistantId?: string) => {
    const state = streamDeltaRef.current;
    if (state.raf) {
      window.cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    if (assistantId && state.assistantId === assistantId && state.pending) {
      const chunk = state.pending;
      state.pending = '';
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId ? { ...item, content: `${item.content}${chunk}` } : item,
        ),
      );
    } else {
      state.pending = '';
    }
    state.assistantId = '';
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshHistory = useCallback(() => {
    if (!department) {
      setHistoryItems([]);
      return;
    }
    setHistoryItems(listDepartmentChatHistory(department.code));
  }, [department]);

  const persistChat = useCallback(
    (
      nextMessages: WorkspaceMessage[],
      overrides?: { conversationId?: string; modeId?: string },
    ) => {
      if (!department) return;
      saveDepartmentChatThread({
        departmentCode: department.code,
        conversationId: overrides?.conversationId ?? conversationId,
        modeId: overrides?.modeId ?? modeId,
        messages: nextMessages,
      });
      refreshHistory();
    },
    [conversationId, department, modeId, refreshHistory],
  );

  const handleExportTable = useCallback(
    async (messageId: string) => {
      if (exportingId) return;
      const message = messages.find((item) => item.id === messageId);
      if (!message?.content.trim()) return;

      setExportingId(messageId);
      try {
        // Prefer local save so chat results export even when backend is down.
        const local = await exportMessageAsTableLocally(
          message.content,
          `${department?.name || '对话'}-表格.xlsx`,
        );
        if (local.saved) {
          notify(`${local.fileName} 已保存到本地`);
          return;
        }
        const service = getChatService();
        if (!service.exportMessageAsTable) {
          notify('当前对话模式不支持导出表格');
          return;
        }
        const result = await service.exportMessageAsTable(conversationId, message.content);
        if (result.saved) notify(`${result.fileName} 已保存到本地`);
      } catch (error) {
        notify(error instanceof Error ? error.message : '保存表格失败，请稍后重试');
      } finally {
        setExportingId(null);
      }
    },
    [conversationId, department?.name, exportingId, messages, notify],
  );

  const handleDownloadFile = useCallback(
    async (file: GeneratedFile) => {
      const service = getChatService();
      if (!service.downloadGeneratedFile) return;
      try {
        await service.downloadGeneratedFile(file);
      } catch (error) {
        notify(error instanceof Error ? error.message : '文件下载失败，请稍后重试');
      }
    },
    [notify],
  );

  const applySession = useCallback(
    (session: DepartmentTaskSession) => {
      const normalized = normalizeSessionMessages(session);
      setActiveSession(normalized);
      const matched = config?.workModes.find((m) => m.templateCode === normalized.templateCode);
      setModeId(matched?.id ?? config?.workModes[0]?.id ?? '');
      setMessages(sessionToWorkspaceMessages(normalized));
      setConversationId(normalized.conversationId || newId('dept-chat'));
      setAttachments([]);
      localFilesRef.current.clear();
      patch({
        taskId: normalized.id,
        analysisText: normalized.analysisText,
        analysisResult: normalized.analysisResult,
        conversationId: normalized.conversationId,
        fileIds: normalized.fileIds,
        fileName: normalized.fileName,
        userInstruction: normalized.userInstruction,
        departmentCode: normalized.departmentCode,
      });
    },
    [config, patch],
  );

  useEffect(() => {
    if (!department || !config) return;

    if (sessionId) {
      const session = loadDepartmentTaskSession(sessionId);
      if (session && session.departmentCode === department.code) {
        applySession(session);
        return;
      }

      const historyItem = loadHistory().find(
        (item) => item.sessionId === sessionId || item.id === sessionId,
      );
      if (historyItem) {
        const resolved = resolveSessionForHistoryItem(historyItem);
        if (resolved && resolved.departmentCode === department.code) {
          applySession(resolved);
          return;
        }
      }

      setActiveSession(null);
      setModeId('');
      setConversationId(newId('dept-chat'));
      setMessages([
        {
          id: newId('sys'),
          role: 'system',
          content: '未找到完整对话记录。可以直接提问，或上传表格后点建议获取分析结果。',
        },
      ]);
      setAttachments([]);
      localFilesRef.current.clear();
      return;
    }

    // 无 session 参数：恢复本岗位最近人设聊天
    const thread = loadDepartmentChatThread(department.code);
    setActiveSession(null);
    setAttachments([]);
    localFilesRef.current.clear();
    setHistoryItems(listDepartmentChatHistory(department.code));

    if (thread && thread.messages.length > 0) {
      const restoredMode =
        thread.modeId && config.workModes.some((m) => m.id === thread.modeId)
          ? thread.modeId
          : '';
      setModeId(restoredMode);
      setConversationId(thread.conversationId || newId('dept-chat'));
      setMessages(thread.messages);
      return;
    }

    setModeId('');
    setConversationId(newId('dept-chat'));
    setMessages([]);
  }, [applySession, config, department, sessionId]);

  const currentMode = useMemo(
    () => config?.workModes.find((item) => item.id === modeId),
    [config, modeId],
  );

  const onUploadFiles = useCallback((files: File[]) => {
    setAttachments((prev) => [
      ...prev,
      ...files.map((file) => {
        localFilesRef.current.set(attachmentKey(file.name, file.size), file);
        return {
          ...fileToPendingAttachment(file),
          status: 'ready' as const,
        };
      }),
    ]);
  }, []);

  const onAttachmentsChange = useCallback((next: ChatAttachment[]) => {
    const nextKeys = new Set(next.map((item) => attachmentKey(item.fileName, item.sizeBytes)));
    for (const key of localFilesRef.current.keys()) {
      if (!nextKeys.has(key)) localFilesRef.current.delete(key);
    }
    setAttachments(next);
  }, []);

  const persistModeId = useCallback(
    (nextModeId: string) => {
      if (!department) return;
      if (messages.length) {
        persistChat(messages, { modeId: nextModeId });
        return;
      }
      const thread = loadDepartmentChatThread(department.code);
      if (thread) {
        saveDepartmentChatThread({
          departmentCode: department.code,
          conversationId: thread.conversationId,
          modeId: nextModeId,
          messages: thread.messages,
        });
      }
    },
    [department, messages, persistChat],
  );

  const enterChatMode = useCallback(() => {
    // Keep selected work mode while chatting — prompts stay context-aware.
  }, []);

  const onModeChange = useCallback(
    (mode: AgentWorkMode | null) => {
      const nextId = mode === null ? '' : mode.id === modeId ? '' : mode.id;
      setModeId(nextId);
      if (mode && !mode.templateCode && nextId === mode.id) {
        notify(`「${mode.name}」功能开发中`);
      }
      persistModeId(nextId);
    },
    [modeId, notify, persistModeId],
  );

  const flushCurrentThread = useCallback(() => {
    if (!department || !messages.length) return;
    saveDepartmentChatThread({
      departmentCode: department.code,
      conversationId,
      modeId,
      messages,
    });
  }, [conversationId, department, messages, modeId]);

  const resetComposer = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft('');
    editAttachmentSuffixRef.current = '';
  }, []);

  const onNewChat = useCallback(() => {
    if (!department) return;
    flushCurrentThread();
    // New thread gets a fresh conversationId → isolated OpenClaw session; keep other threads.
    const thread = createDepartmentChatThread(department.code, '');
    setActiveSession(null);
    setModeId('');
    setConversationId(thread.conversationId);
    setMessages([]);
    setAttachments([]);
    localFilesRef.current.clear();
    resetComposer();
    refreshHistory();
    notify('已开启新对话');
  }, [department, flushCurrentThread, notify, refreshHistory, resetComposer]);

  const onSelectHistory = useCallback(
    (id: string) => {
      if (!department || !config || id === conversationId) return;
      flushCurrentThread();
      const thread = setActiveDepartmentChatThread(department.code, id);
      if (!thread) {
        notify('未找到该段对话');
        return;
      }
      // Keep per-thread OpenClaw binding so resumed chats stay isolated and continuous within-thread.
      setActiveSession(null);
      setAttachments([]);
      localFilesRef.current.clear();
      resetComposer();
      const restoredMode =
        thread.modeId && config.workModes.some((m) => m.id === thread.modeId)
          ? thread.modeId
          : '';
      setModeId(restoredMode);
      setConversationId(thread.conversationId);
      setMessages(thread.messages);
      refreshHistory();
    },
    [config, conversationId, department, flushCurrentThread, notify, refreshHistory, resetComposer],
  );

  const onClearHistory = useCallback(() => {
    if (!department) return;
    if (!window.confirm(`清空「${department.name}」下的全部历史对话？此操作不可恢复。`)) return;
    clearDepartmentChatHistory(department.code);
    clearWorkstationSessionBinding(department.code);
    const thread = createDepartmentChatThread(department.code, '');
    setActiveSession(null);
    setModeId('');
    setConversationId(thread.conversationId);
    setMessages([]);
    setAttachments([]);
    localFilesRef.current.clear();
    resetComposer();
    refreshHistory();
    notify('已清空本岗位历史对话');
  }, [department, notify, refreshHistory, resetComposer]);

  const onDeleteHistory = useCallback(
    (id: string) => {
      if (!department) return;
      deleteDepartmentChatThread(department.code, id);
      clearWorkstationSessionBinding(department.code, id);
      if (id === conversationId) {
        const next = loadDepartmentChatThread(department.code);
        if (next && next.messages.length) {
          setConversationId(next.conversationId);
          setModeId(next.modeId || '');
          setMessages(next.messages);
        } else {
          const thread = createDepartmentChatThread(department.code, '');
          setConversationId(thread.conversationId);
          setModeId('');
          setMessages([]);
        }
        setActiveSession(null);
        setAttachments([]);
        localFilesRef.current.clear();
        resetComposer();
      }
      refreshHistory();
    },
    [conversationId, department, refreshHistory, resetComposer],
  );

  const onStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleStartEdit = useCallback(
    (messageId: string) => {
      if (sending) return;
      const target = messages.find((item) => item.id === messageId);
      if (!target || target.role !== 'user') return;
      const { text, attachmentSuffix } = splitDepartmentUserMessageContent(target.content);
      const editable =
        text === '（请基于已上传表格给出分析结论）' || text === '（附件消息）' ? '' : text;
      setEditingMessageId(messageId);
      setEditDraft(editable);
      editAttachmentSuffixRef.current = attachmentSuffix;
    },
    [messages, sending],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft('');
    editAttachmentSuffixRef.current = '';
  }, []);

  const onRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (!department || !config || sending || regeneratingId || editingMessageId) return;

      const assistantIndex = messages.findIndex((item) => item.id === assistantMessageId);
      if (assistantIndex < 0) return;

      const userMsg = [...messages.slice(0, assistantIndex)]
        .reverse()
        .find((item) => item.role === 'user');
      if (!userMsg) return;

      if (needsWorkstationLlmKey()) {
        requestWorkstationLlmKeyGate();
        notify('请先填写 API Key，再开始对话');
        return;
      }

      if (!canUseDepartmentChat()) {
        notify('请先登录后再使用智能体对话');
        return;
      }

      const { text } = splitDepartmentUserMessageContent(userMsg.content);
      const promptText =
        text === '（请基于已上传表格给出分析结论）' || text === '（附件消息）' ? '' : text;
      const mode = currentMode;

      setRegeneratingId(assistantMessageId);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantMessageId ? { ...item, content: '' } : item,
        ),
      );
      setSending(true);
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;
      const { signal } = abortController;

      try {
        const personaContext = buildDepartmentChatContext({ config, mode });
        const agentCode = departmentToChatAgentCode(department.code);
        const prompt = [
          personaContext,
          '',
          '【用户请求】',
          promptText || '请基于上下文继续回答上一个问题，给出核算/核对结论、关键差异与建议下一步。',
          mode?.templateCode ? `关联模板：${mode.templateCode}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        const response = await getChatService().sendMessage(
          {
            conversationId,
            agentCode,
            content: prompt,
            fileIds: [],
            imageIds: [],
            templateCode: mode?.templateCode,
            userInstruction: promptText || mode?.name,
          },
          {
            signal,
            onEvent: (event) => {
              if (event.type === 'delta') {
                setMessages((prev) =>
                  prev.map((item) =>
                    item.id === assistantMessageId
                      ? { ...item, content: `${item.content}${event.text}` }
                      : item,
                  ),
                );
              }
              if (event.type === 'done') {
                setMessages((prev) =>
                  prev.map((item) =>
                    item.id === assistantMessageId
                      ? { ...item, content: event.content }
                      : item,
                  ),
                );
              }
            },
          },
        );

        setMessages((prev) => {
          const next = prev.map((item) =>
            item.id === assistantMessageId ? { ...item, content: applyChargedCredits(response.content, response) } : item,
          );
          persistChat(next);
          return next;
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setMessages((prev) => {
            const next = prev.map((item) =>
              item.id === assistantMessageId
                ? {
                    ...item,
                    content: item.content
                      ? `${item.content}\n\n（已停止生成）`
                      : '（已停止生成）',
                  }
                : item,
            );
            persistChat(next);
            return next;
          });
          return;
        }

        const raw = error instanceof Error ? error.message : '重新生成失败，请稍后重试';
        setMessages((prev) => {
          const next = prev.map((item) =>
            item.id === assistantMessageId
              ? { ...item, content: item.content || raw }
              : item,
          );
          persistChat(next);
          return next;
        });
        notify('重新生成失败');
      } finally {
        if (abortRef.current === abortController) abortRef.current = null;
        setRegeneratingId(null);
        setSending(false);
      }
    },
    [
      config,
      conversationId,
      currentMode,
      department,
      editingMessageId,
      messages,
      notify,
      persistChat,
      regeneratingId,
      sending,
    ],
  );

  const onSend = useCallback(
    async (content: string) => {
      if (!department || !config) return;
      if (sending) return;
      const text = content.trim();
      const readyAttachments = attachments.filter((item) => item.status === 'ready');
      const files = readyAttachments
        .map((item) => localFilesRef.current.get(attachmentKey(item.fileName, item.sizeBytes)))
        .filter((file): file is File => Boolean(file));

      if (needsWorkstationLlmKey()) {
        requestWorkstationLlmKeyGate();
        notify('请先填写 API Key，再开始对话');
        return;
      }

      if (editingMessageId) {
        if (!text && !editAttachmentSuffixRef.current) {
          notify('请输入问题后再发送');
          return;
        }

        if (!canUseDepartmentChat()) {
          notify('请先登录后再使用智能体对话');
          return;
        }

        const editIndex = messages.findIndex((item) => item.id === editingMessageId);
        if (editIndex < 0 || messages[editIndex]?.role !== 'user') return;

        const displayUserText = joinDepartmentUserMessageContent(
          text,
          editAttachmentSuffixRef.current,
        );
        const userMessage: WorkspaceMessage = {
          id: editingMessageId,
          role: 'user',
          content: displayUserText,
        };
        const assistantId = newId('assistant');
        const mode = currentMode;

        setEditingMessageId(null);
        setEditDraft('');
        editAttachmentSuffixRef.current = '';
        setMessages((prev) => [
          ...prev.slice(0, editIndex),
          userMessage,
          { id: assistantId, role: 'assistant', content: '' },
        ]);
        setSending(true);
        abortRef.current?.abort();
        const abortController = new AbortController();
        abortRef.current = abortController;
        const { signal } = abortController;

        try {
          const personaContext = buildDepartmentChatContext({ config, mode });
          const agentCode = departmentToChatAgentCode(department.code);
          const prompt = [
            personaContext,
            '',
            '【用户请求】',
            text || '请基于上下文继续回答上一个问题，给出核算/核对结论、关键差异与建议下一步。',
            mode?.templateCode ? `关联模板：${mode.templateCode}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          const response = await getChatService().sendMessage(
            {
              conversationId,
              agentCode,
              content: prompt,
              fileIds: [],
              imageIds: [],
              templateCode: mode?.templateCode,
              userInstruction: text || mode?.name,
            },
            {
              signal,
              onEvent: (event) => {
                if (event.type === 'delta') {
                  appendStreamDelta(assistantId, event.text);
                }
                if (event.type === 'done') {
                  resetStreamDelta(assistantId);
                  setMessages((prev) =>
                    prev.map((item) =>
                      item.id === assistantId ? { ...item, content: event.content } : item,
                    ),
                  );
                }
              },
            },
          );

          setMessages((prev) => {
            const next = prev.map((item) =>
              item.id === assistantId ? { ...item, content: applyChargedCredits(response.content, response) } : item,
            );
            persistChat(next);
            return next;
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setMessages((prev) => {
              const next = prev.map((item) =>
                item.id === assistantId
                  ? {
                      ...item,
                      content: item.content
                        ? `${item.content}\n\n（已停止生成）`
                        : '（已停止生成）',
                    }
                  : item,
              );
              persistChat(next);
              return next;
            });
            return;
          }
          const raw = error instanceof Error ? error.message : '编辑发送失败，请稍后重试';
          setMessages((prev) => {
            const next = prev.map((item) =>
              item.id === assistantId ? { ...item, content: item.content || raw } : item,
            );
            persistChat(next);
            return next;
          });
          notify('编辑发送失败');
        } finally {
          resetStreamDelta(assistantId);
          if (abortRef.current === abortController) abortRef.current = null;
          setSending(false);
        }
        return;
      }

      if (!text && !files.length) {
        notify('请输入问题，或上传表格后再点建议');
        return;
      }

      if (!canUseDepartmentChat()) {
        notify('请先登录后再使用智能体对话');
        setMessages((prev) => {
          const next: WorkspaceMessage[] = [
            ...prev,
            {
              id: newId('user'),
              role: 'user',
              content: text || '（附件消息）',
            },
            {
              id: newId('sys'),
              role: 'system',
              content:
                '登录已失效或未登录，智能体对话需要登录后才能调用模型。\n请到左下角账号中重新登录。\n\n你仍可先上传 Excel/CSV；登录后在聊天里发送即可直接读表分析并出结果。',
            },
          ];
          persistChat(next);
          return next;
        });
        return;
      }

      // 快捷建议自动匹配技能
      const matched = text ? matchWorkModeByQuickTask(config.workModes, text) : undefined;
      const mode = matched ?? currentMode;
      if (matched && matched.id !== modeId) {
        setModeId(matched.id);
      }

      const displayUserText = [
        text || '（请基于已上传表格给出分析结论）',
        readyAttachments.length
          ? `附件：${readyAttachments.map((item) => item.fileName).join('、')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const userMessage: WorkspaceMessage = {
        id: newId('user'),
        role: 'user',
        content: displayUserText,
      };
      const assistantId = newId('assistant');
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: 'assistant', content: '' },
      ]);
      setSending(true);
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;
      const { signal } = abortController;

      try {
        if (files.length) {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId
                ? { ...item, content: '正在读取表格…' }
                : item,
            ),
          );
        }
        const sheet = await extractSpreadsheetForChat(files);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (sheet.notice) notify(sheet.notice);
        if (files.length) {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, content: '' } : item,
            ),
          );
        }

        const personaContext = buildDepartmentChatContext({
          config,
          mode,
          spreadsheetPreview: sheet.text || undefined,
        });

        // Lobster/OpenClaw reads attachments locally via extractSpreadsheet — do not
        // block first token on cloud upload (fileIds unused on lobster path).
        const fileIds: string[] = [];
        if (
          files.length
          && getChatServiceMode() !== 'lobster'
          && getUserAccessToken()
        ) {
          for (const file of files) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            try {
              const uploaded = await uploadChatAttachment(file);
              fileIds.push(uploaded.fileId);
            } catch {
              // 本地预览仍可继续；云端附件失败不阻断
            }
          }
        }

        const agentCode = departmentToChatAgentCode(department.code);
        const prompt = [
          personaContext,
          '',
          '【用户请求】',
          text || '请基于附件表格，按当前技能给出核算/核对结论、关键差异与建议下一步。',
          mode?.templateCode ? `关联模板：${mode.templateCode}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        const response = await getChatService().sendMessage(
          {
            conversationId,
            agentCode,
            content: prompt,
            fileIds,
            imageIds: [],
            templateCode: mode?.templateCode,
            userInstruction: text || mode?.name,
          },
          {
            attachments: readyAttachments,
            signal,
            onEvent: (event) => {
              if (event.type === 'delta') {
                appendStreamDelta(assistantId, event.text);
              }
              if (event.type === 'done') {
                resetStreamDelta(assistantId);
                setMessages((prev) =>
                  prev.map((item) =>
                    item.id === assistantId ? { ...item, content: event.content } : item,
                  ),
                );
              }
            },
          },
        );

        setMessages((prev) => {
          const next = prev.map((item) =>
            item.id === assistantId ? { ...item, content: applyChargedCredits(response.content, response) } : item,
          );
          persistChat(next, matched ? { modeId: matched.id } : undefined);
          return next;
        });

        if (activeSession) {
          const updated = appendDepartmentSessionMessages(activeSession.id, [
            { id: userMessage.id, role: 'user', content: displayUserText },
            { id: assistantId, role: 'assistant', content: applyChargedCredits(response.content, response) },
          ]);
          if (updated) setActiveSession(updated);
        }

        // 发送后清空附件，避免重复喂同一份；文件仍可在本地会话上下文中被追问引用
        setAttachments([]);
        localFilesRef.current.clear();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setMessages((prev) => {
            const next = prev.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: item.content
                      ? `${item.content}\n\n（已停止生成）`
                      : '（已停止生成）',
                  }
                : item,
            );
            persistChat(next, matched ? { modeId: matched.id } : undefined);
            return next;
          });
          return;
        }

        const code =
          error instanceof Error && 'code' in error
            ? String((error as { code?: string }).code ?? '')
            : '';
        const status =
          error instanceof Error && 'status' in error
            ? Number((error as { status?: number }).status ?? 0)
            : 0;
        const raw = error instanceof Error ? error.message : '发送失败，请稍后重试';
        const isAuth =
          code === 'UNAUTHORIZED' ||
          status === 401 ||
          /无效的 token|未登录|登录|UNAUTHORIZED/i.test(raw);

        const message = isAuth
          ? '登录已失效，请先到左下角账号退出后重新登录，再继续对话。'
          : raw;

        const tip = isAuth
          ? '请先登录后再继续对话；表格可先上传，登录后发送即可在聊天中分析出表。'
          : '可直接在聊天上传 Excel/CSV，AI 读表后在对话中出结果；回复旁点「保存表格」即可下载。';

        setMessages((prev) => {
          const next = prev.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content:
                    item.content && item.content !== '正在读取表格…'
                      ? item.content
                      : `${message}\n\n${tip}`,
                }
              : item,
          );
          persistChat(next, matched ? { modeId: matched.id } : undefined);
          return next;
        });
        if (isAuth) notify('请重新登录后再试');
      } finally {
        resetStreamDelta(assistantId);
        if (abortRef.current === abortController) abortRef.current = null;
        setSending(false);
      }
    },
    [
      activeSession,
      appendStreamDelta,
      attachments,
      config,
      conversationId,
      currentMode,
      department,
      editingMessageId,
      modeId,
      notify,
      persistChat,
      resetStreamDelta,
      sending,
    ],
  );

  if (!department || !config || !isPublishedDepartmentCode(department.code)) {
    return <Navigate to="/templates" replace />;
  }

  return (
    <AgentWorkspace
      department={department}
      config={config}
      modeId={modeId}
      onModeChange={onModeChange}
      onEnterChatMode={enterChatMode}
      attachments={attachments}
      onAttachmentsChange={onAttachmentsChange}
      onUploadFiles={onUploadFiles}
      onSend={(content) => void onSend(content)}
      onStop={onStop}
      onEditMessage={handleStartEdit}
      editingMessageId={editingMessageId}
      editDraft={editDraft}
      onEditDraftChange={setEditDraft}
      onCancelEdit={handleCancelEdit}
      onRegenerate={(id) => void onRegenerate(id)}
      regeneratingId={regeneratingId}
      onExportTable={(id) => void handleExportTable(id)}
      onDownloadFile={(file) => void handleDownloadFile(file)}
      exportingId={exportingId}
      sending={sending}
      messages={messages}
      activeSessionId={activeSession?.id}
      toast={toast}
      onDismissToast={() => setToast(null)}
      scrollPersistKey={`dept-chat-scroll:${department.code}`}
      historyItems={historyItems}
      activeConversationId={conversationId}
      onSelectHistory={onSelectHistory}
      onNewChat={onNewChat}
      onClearHistory={onClearHistory}
      onDeleteHistory={onDeleteHistory}
      onEnterLobster={onEnterLobster}
    />
  );
}
