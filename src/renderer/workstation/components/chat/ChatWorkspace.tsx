import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, ChatMessage, GeneratedFile } from '@aw/shared';
import { isImageUploadExtension } from '@aw/shared';
import { ChatComposer } from '@workstation/components/chat/ChatComposer';
import { ChatMessageList } from '@workstation/components/chat/ChatMessageList';
import { ScrollToBottomButton } from '@workstation/components/chat/ScrollToBottomButton';
import { ScrollToTopButton } from '@workstation/components/chat/ScrollToTopButton';
import { fileToPendingAttachment } from '@workstation/components/chat/AttachmentPicker';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { useChatScroll } from '@workstation/hooks/useChatScroll';
import { getUserAccessToken } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';
import { getChatService, uploadChatAttachment } from '@workstation/services/chat';
import { deriveTitle, newId, summarizeConversationTitle, useChatStore } from '@workstation/state/chatStore';

export function ChatWorkspace() {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const selectedAgentCode = useChatStore((s) => s.selectedAgentCode);
  const recentFiles = useChatStore((s) => s.recentFiles);
  const messagesByConversation = useChatStore((s) => s.messagesByConversation);

  const createConversation = useChatStore((s) => s.createConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setConversationMessages = useChatStore((s) => s.setConversationMessages);
  const setConversationTitle = useChatStore((s) => s.setConversationTitle);
  const touchConversation = useChatStore((s) => s.touchConversation);
  const addRecentFile = useChatStore((s) => s.addRecentFile);
  const consumePendingComposerAttachments = useChatStore((s) => s.consumePendingComposerAttachments);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [exportingMessageId, setExportingMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const messages = useMemo(
    () => (activeConversationId ? messagesByConversation[activeConversationId] ?? [] : []),
    [activeConversationId, messagesByConversation],
  );

  const scrollPersistKey = activeConversationId
    ? `chat-scroll:${activeConversationId}`
    : undefined;

  const {
    scrollContainerRef,
    bottomRef,
    showScrollButton,
    showTopButton,
    scrollToBottom,
    scrollToTop,
    pinToBottom,
    handleScroll,
  } = useChatScroll({
    persistKey: scrollPersistKey,
    deps: [messages, sending],
  });

  // 回到聊天页时，恢复最近会话选中状态，避免历史在侧边栏“看起来消失”
  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      selectConversation(conversations[0]!.id);
    }
  }, [activeConversationId, conversations, selectConversation]);

  // 切换会话时清空附件；从文件库「用于对话」带来的附件在此挂上
  useEffect(() => {
    if (!activeConversationId) return;
    setEditingMessageId(null);
    setEditDraft('');
    setRegeneratingMessageId(null);
    setExportingMessageId(null);
    const pending = consumePendingComposerAttachments();
    setAttachments(
      pending.length
        ? pending.map((file) => ({ ...file, status: 'ready' as const }))
        : [],
    );
  }, [activeConversationId, consumePendingComposerAttachments]);

  const ensureConversation = useCallback(() => {
    if (activeConversationId) return activeConversationId;
    return createConversation(selectedAgentCode);
  }, [activeConversationId, createConversation, selectedAgentCode]);

  const uploadAttachment = useCallback(
    async (index: number, file: File) => {
      if (!getUserAccessToken()) {
        setAttachments((prev) =>
          prev.map((item, i) =>
            i === index
              ? { ...item, status: 'failed', errorMessage: '请先登录后再上传附件' }
              : item,
          ),
        );
        return;
      }

      setAttachments((prev) =>
        prev.map((item, i) => (i === index ? { ...item, status: 'uploading' } : item)),
      );

      try {
        const uploaded = await uploadChatAttachment(file);
        const ready: ChatAttachment = {
          fileId: uploaded.fileId,
          fileName: uploaded.originalName,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: uploaded.size,
          status: 'ready',
        };
        setAttachments((prev) => prev.map((item, i) => (i === index ? ready : item)));
        addRecentFile(ready);
      } catch (error) {
        const message = error instanceof Error ? error.message : '文件上传失败';
        setAttachments((prev) =>
          prev.map((item, i) =>
            i === index ? { ...item, status: 'failed', errorMessage: message } : item,
          ),
        );
      }
    },
    [addRecentFile],
  );

  const handleUploadFiles = useCallback(
    (files: File[]) => {
      const startIndex = attachments.length;
      const pending = files.map(fileToPendingAttachment);
      setAttachments((prev) => [...prev, ...pending]);
      files.forEach((file, offset) => {
        void uploadAttachment(startIndex + offset, file);
      });
    },
    [attachments.length, uploadAttachment],
  );

  const handlePickLibraryFile = useCallback((file: ChatAttachment) => {
    if (!file.fileId) return;
    setAttachments((prev) => {
      if (prev.some((item) => item.fileId === file.fileId)) return prev;
      return [...prev, { ...file, status: 'ready' }];
    });
    setLibraryOpen(false);
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleExportTable = useCallback(
    async (messageId: string) => {
      if (!activeConversationId || exportingMessageId) return;
      const message = messages.find((item) => item.id === messageId);
      const service = getChatService();
      if (!message?.content.trim()) return;
      if (!service.exportMessageAsTable) {
        window.alert('当前对话模式不支持导出表格');
        return;
      }

      setExportingMessageId(messageId);
      try {
        const result = await service.exportMessageAsTable(
          activeConversationId,
          message.content,
        );
        if (result.saved) window.alert(`${result.fileName} 已保存到本地`);
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '整理 Excel 失败，请稍后重试');
      } finally {
        setExportingMessageId(null);
      }
    },
    [activeConversationId, exportingMessageId, messages],
  );

  const handleDownloadFile = useCallback(async (file: GeneratedFile) => {
    const service = getChatService();
    if (!service.downloadGeneratedFile) return;
    try {
      await service.downloadGeneratedFile(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '文件下载失败，请稍后重试');
    }
  }, []);

  const dispatchMessage = useCallback(
    async (
      conversationId: string,
      content: string,
      readyAttachments: ChatAttachment[],
      assistantMessageId: string,
      signal: AbortSignal,
    ) => {
      const fileIds = readyAttachments.map((item) => item.fileId!).filter(Boolean);
      const imageIds = readyAttachments
        .filter((item) => isImageUploadExtension(item.fileName))
        .map((item) => item.fileId!)
        .filter(Boolean);

      let streamed = '';
      try {
        const response = await getChatService().sendMessage(
          {
            conversationId,
            agentCode: selectedAgentCode,
            content,
            fileIds,
            imageIds,
          },
          {
            attachments: readyAttachments,
            signal,
            onEvent: (event) => {
              if (event.type === 'thinking') {
                // 思考过程仅内部推进状态，不展示给用户
                updateMessage(conversationId, assistantMessageId, {
                  status: 'sending',
                });
                return;
              }
              if (event.type === 'delta') {
                streamed += event.text;
                updateMessage(conversationId, assistantMessageId, {
                  status: 'streaming',
                  content: streamed,
                });
                return;
              }
              if (event.type === 'done') {
                updateMessage(conversationId, assistantMessageId, {
                  content: event.content,
                  status: 'completed',
                  generatedFiles: event.generatedFiles,
                });
              }
            },
          },
        );

        updateMessage(conversationId, assistantMessageId, {
          content: response.content,
          status: 'completed',
          generatedFiles: response.generatedFiles,
        });
        setConversationTitle(
          conversationId,
          summarizeConversationTitle(
            content || readyAttachments[0]?.fileName || '',
            response.content,
          ),
        );
        touchConversation(conversationId);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          updateMessage(conversationId, assistantMessageId, {
            status: 'completed',
            content: streamed
              ? `${streamed}\n\n（已停止生成）`
              : '（已停止生成）',
          });
          touchConversation(conversationId);
          return;
        }
        const code =
          error instanceof Error && 'code' in error
            ? (error as { code?: string }).code
            : undefined;
        const status =
          error instanceof Error && 'status' in error
            ? (error as { status?: number }).status
            : undefined;
        const message =
          code === 'CHAT_MODEL_NOT_CONFIGURED'
            ? '当前智能分析服务未配置，请联系管理员'
            : code === 'UNAUTHORIZED' || status === 401
              ? '登录已失效，请先到个人中心退出后重新登录'
              : error instanceof Error
                ? error.message
                : '消息发送失败，请重新尝试';
        updateMessage(conversationId, assistantMessageId, {
          status: 'failed',
          content: message,
        });
      }
    },
    [selectedAgentCode, setConversationTitle, touchConversation, updateMessage],
  );

  const handleStartEdit = useCallback(
    (messageId: string) => {
      if (sending) return;
      const conversationId = activeConversationId;
      if (!conversationId) return;
      const target = (messagesByConversation[conversationId] ?? []).find(
        (item) => item.id === messageId,
      );
      if (!target || target.role !== 'user') return;
      setEditingMessageId(messageId);
      setEditDraft(target.content);
    },
    [activeConversationId, messagesByConversation, sending],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft('');
  }, []);

  const runAssistantReply = useCallback(
    async (
      conversationId: string,
      content: string,
      readyAttachments: ChatAttachment[],
      assistantMessageId: string,
    ) => {
      pinToBottom();
      setSending(true);
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;
      try {
        await dispatchMessage(
          conversationId,
          content,
          readyAttachments,
          assistantMessageId,
          abortController.signal,
        );
      } finally {
        if (abortRef.current === abortController) abortRef.current = null;
        setSending(false);
      }
    },
    [dispatchMessage, pinToBottom],
  );

  const handleRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (sending || regeneratingMessageId || editingMessageId) return;
      const conversationId = activeConversationId;
      if (!conversationId) return;

      const msgs = messagesByConversation[conversationId] ?? [];
      const assistantIndex = msgs.findIndex((item) => item.id === assistantMessageId);
      if (assistantIndex < 0) return;

      const assistantMsg = msgs[assistantIndex];
      if (!assistantMsg || assistantMsg.role === 'user' || assistantMsg.role === 'system') return;
      if (assistantMsg.status === 'sending' || assistantMsg.status === 'streaming') return;

      const userMsg = [...msgs.slice(0, assistantIndex)]
        .reverse()
        .find((item) => item.role === 'user');
      if (!userMsg) return;

      const readyAttachments = userMsg.attachments.filter(
        (item) => item.status === 'ready' && item.fileId,
      );

      updateMessage(conversationId, assistantMessageId, {
        status: 'sending',
        content: '',
      });
      setRegeneratingMessageId(assistantMessageId);
      await runAssistantReply(
        conversationId,
        userMsg.content,
        readyAttachments,
        assistantMessageId,
      );
      setRegeneratingMessageId(null);
    },
    [
      activeConversationId,
      editingMessageId,
      messagesByConversation,
      regeneratingMessageId,
      runAssistantReply,
      sending,
      updateMessage,
    ],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (sending) return;

      if (editingMessageId && activeConversationId) {
        const trimmed = content.trim();
        if (!trimmed) return;

        const msgs = messagesByConversation[activeConversationId] ?? [];
        const editIndex = msgs.findIndex((item) => item.id === editingMessageId);
        if (editIndex < 0 || msgs[editIndex]?.role !== 'user') return;

        const original = msgs[editIndex]!;
        const updatedUser: ChatMessage = {
          ...original,
          content: trimmed,
          createdAt: new Date().toISOString(),
        };
        const assistantMessage: ChatMessage = {
          id: newId('msg'),
          conversationId: activeConversationId,
          role: 'assistant',
          content: '',
          attachments: [],
          status: 'sending',
          createdAt: new Date().toISOString(),
        };

        setConversationMessages(activeConversationId, [...msgs.slice(0, editIndex), updatedUser]);
        addMessage(activeConversationId, assistantMessage);
        setConversationTitle(
          activeConversationId,
          summarizeConversationTitle(trimmed, undefined),
        );
        setEditingMessageId(null);
        setEditDraft('');
        setAttachments([]);

        const readyAttachments = updatedUser.attachments.filter(
          (item) => item.status === 'ready' && item.fileId,
        );
        await runAssistantReply(
          activeConversationId,
          trimmed,
          readyAttachments,
          assistantMessage.id,
        );
        return;
      }

      const readyAttachments = attachments.filter((item) => item.status === 'ready' && item.fileId);
      if (!content.trim() && !readyAttachments.length) return;

      const conversationId = ensureConversation();
      const isFirstMessage = (messagesByConversation[conversationId] ?? []).length === 0;
      const userMessage: ChatMessage = {
        id: newId('msg'),
        conversationId,
        role: 'user',
        content,
        attachments: readyAttachments,
        status: 'completed',
        createdAt: new Date().toISOString(),
      };
      const assistantMessage: ChatMessage = {
        id: newId('msg'),
        conversationId,
        role: 'assistant',
        content: '',
        attachments: [],
        status: 'sending',
        createdAt: new Date().toISOString(),
      };

      addMessage(conversationId, userMessage);
      addMessage(conversationId, assistantMessage);
      if (isFirstMessage) {
        setConversationTitle(conversationId, deriveTitle(content || readyAttachments[0]?.fileName || '新对话'));
      }
      setAttachments([]);
      await runAssistantReply(conversationId, content, readyAttachments, assistantMessage.id);
    },
    [
      activeConversationId,
      addMessage,
      attachments,
      editingMessageId,
      ensureConversation,
      messagesByConversation,
      runAssistantReply,
      sending,
      setConversationMessages,
      setConversationTitle,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#F7FAFD]">
      {/* 仅中间消息区可滚；侧栏与底部输入框固定 */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className={cn(
            'h-full overflow-y-auto overscroll-contain',
            '[&::-webkit-scrollbar]:w-1.5',
            '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border',
            '[&::-webkit-scrollbar-track]:bg-transparent',
          )}
        >
          <ChatMessageList
            messages={messages}
            onQuickPrompt={(text) => void handleSend(text)}
            bottomRef={bottomRef}
            editingMessageId={editingMessageId}
            regeneratingMessageId={regeneratingMessageId}
            onEditMessage={handleStartEdit}
            onRegenerate={(messageId) => void handleRegenerate(messageId)}
            onExportTable={(messageId) => void handleExportTable(messageId)}
            onDownloadFile={(file) => void handleDownloadFile(file)}
            exportingMessageId={exportingMessageId}
            disableActions={sending}
          />
        </div>
        <ScrollToTopButton
          visible={showTopButton}
          onClick={() => scrollToTop()}
          className="border-[#D7E4F2] bg-white hover:bg-[#F7FAFD]"
        />
        <ScrollToBottomButton
          visible={showScrollButton}
          onClick={() => scrollToBottom()}
          className="border-[#D7E4F2] bg-white hover:bg-[#F7FAFD]"
        />
      </div>
      <div className="shrink-0 border-t border-[#E6EEF6] bg-[#F7FAFD]">
        <ChatComposer
          agentCode={selectedAgentCode}
          onAgentChange={setSelectedAgent}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onUploadFiles={handleUploadFiles}
          onOpenLibrary={() => setLibraryOpen(true)}
          onSend={(content) => void handleSend(content)}
          onStop={handleStop}
          editingMessageId={editingMessageId}
          editDraft={editDraft}
          onEditDraftChange={setEditDraft}
          onCancelEdit={handleCancelEdit}
          sending={sending}
        />
      </div>

      {libraryOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <Card className="w-full max-w-lg">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">从文件库选择</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setLibraryOpen(false)}>
                关闭
              </Button>
            </CardHeader>
            <CardContent className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {recentFiles.length ? (
                recentFiles.map((file) => (
                  <button
                    key={file.fileId ?? file.fileName}
                    type="button"
                    className="rounded-[10px] border border-border px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => handlePickLibraryFile(file)}
                  >
                    <div className="font-medium">{file.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {file.sizeBytes ? `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB` : '已保存'}
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  暂无已上传文件。请先在聊天中上传，或前往文件库。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
