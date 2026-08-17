import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Coins,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Plus,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ChatAttachment, GeneratedFile } from '@aw/shared';
import { AgentHomeCard } from '@workstation/components/agent-workspace/AgentHomeCard';
import { DepartmentHistoryPanel } from '@workstation/components/agent-workspace/DepartmentHistoryPanel';
import { HeroBanner } from '@workstation/components/agent-workspace/HeroBanner';
import { TaskInput, type PromptLaunchRequest } from '@workstation/components/agent-workspace/TaskInput';
import { WorkModePanel } from '@workstation/components/agent-workspace/WorkModePanel';
import { MessageCopyButton } from '@workstation/components/chat/MessageCopyButton';
import { MessageEditButton } from '@workstation/components/chat/MessageEditButton';
import { MessageRegenerateButton } from '@workstation/components/chat/MessageRegenerateButton';
import { ReplyGeneratingIndicator } from '@workstation/components/chat/ReplyGeneratingIndicator';
import { ScrollToBottomButton } from '@workstation/components/chat/ScrollToBottomButton';
import { ScrollToTopButton } from '@workstation/components/chat/ScrollToTopButton';
import { PageBackButton } from '@workstation/components/layout/PageBackButton';
import type { AgentConfig, AgentWorkMode } from '@workstation/data/agentConfigs';
import type { DepartmentAgent } from '@workstation/data/departmentAgents';
import { PUBLISHED_DEPARTMENT_AGENTS } from '@workstation/data/departmentAgents';
import type { DepartmentChatHistoryItem } from '@workstation/lib/departmentChatStore';
import { useWalletQuery } from '@workstation/hooks/useCloudQueries';
import { useChatScroll } from '@workstation/hooks/useChatScroll';
import { renderChatMarkdown } from '@workstation/lib/chatMarkdown';
import { resolveAvatarDisplayUrl } from '@workstation/lib/avatarUrl';
import { loadUserProfile, loadWorkspace } from '@workstation/lib/localStore';
import { cn } from '@workstation/lib/utils';
import { workspaceService } from '@workstation/services';
import { useChatStore } from '@workstation/state/chatStore';
import { useUserCenterStore } from '@workstation/state/userCenterStore';
import { UserCenterTrigger } from '@workstation/user-center';
import { useQuery } from '@tanstack/react-query';

type WorkspaceMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  generatedFiles?: GeneratedFile[];
};

type AgentWorkspaceProps = {
  department: DepartmentAgent;
  config: AgentConfig;
  modeId: string;
  onModeChange: (mode: AgentWorkMode | null) => void;
  onEnterChatMode?: () => void;
  attachments: ChatAttachment[];
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
  onUploadFiles: (files: File[]) => void;
  onSend: (content: string) => void;
  onStop?: () => void;
  onEditMessage?: (messageId: string) => void;
  editingMessageId?: string | null;
  editDraft?: string;
  onEditDraftChange?: (draft: string) => void;
  onCancelEdit?: () => void;
  onRegenerate?: (assistantMessageId: string) => void;
  regeneratingId?: string | null;
  onExportTable?: (assistantMessageId: string) => void;
  onDownloadFile?: (file: GeneratedFile) => void;
  exportingId?: string | null;
  sending: boolean;
  messages: WorkspaceMessage[];
  activeSessionId?: string | null;
  toast?: string | null;
  onDismissToast?: () => void;
  scrollPersistKey?: string;
  historyItems?: DepartmentChatHistoryItem[];
  activeConversationId?: string | null;
  onSelectHistory?: (conversationId: string) => void;
  onNewChat?: () => void;
  onClearHistory?: () => void;
  onDeleteHistory?: (conversationId: string) => void;
  onEnterLobster?: () => void;
};

export function AgentWorkspace({
  department,
  config,
  modeId,
  onModeChange,
  onEnterChatMode,
  attachments,
  onAttachmentsChange,
  onUploadFiles,
  onSend,
  onStop,
  onEditMessage,
  editingMessageId,
  editDraft,
  onEditDraftChange,
  onCancelEdit,
  onRegenerate,
  regeneratingId,
  onExportTable,
  onDownloadFile,
  exportingId,
  sending,
  messages,
  activeSessionId,
  toast,
  onDismissToast,
  scrollPersistKey,
  historyItems = [],
  activeConversationId = null,
  onSelectHistory,
  onNewChat,
  onClearHistory,
  onDeleteHistory,
  onEnterLobster,
}: AgentWorkspaceProps) {
  const navigate = useNavigate();
  const openUserCenter = useUserCenterStore((s) => s.openUserCenter);
  const {
    scrollContainerRef,
    bottomRef: messagesEndRef,
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

  const workspace = loadWorkspace();
  const [profileTick, setProfileTick] = useState(0);
  useEffect(() => {
    const bump = () => setProfileTick((n) => n + 1);
    window.addEventListener('workstation:profile-changed', bump);
    return () => window.removeEventListener('workstation:profile-changed', bump);
  }, []);
  const user = useMemo(() => {
    void profileTick;
    return loadUserProfile();
  }, [profileTick]);
  const walletQuery = useWalletQuery(Boolean(user));
  const quotaQuery = useQuery({
    queryKey: ['workspace', 'quota'],
    queryFn: () => workspaceService.getQuota(),
    staleTime: 30_000,
  });

  const selectedMode = config.workModes.find((m) => m.id === modeId);
  const modeLabel = selectedMode?.name ?? '自由对话';
  const activePrompts =
    selectedMode?.prompts?.length
      ? selectedMode.prompts
      : config.quickTasks;
  const fileHint =
    selectedMode?.fileHint ??
    '上传 Excel/CSV 后直接提问或点提示词，AI 会在聊天里读表并出结果；可点「保存表格」下载。';
  const inputPlaceholder = selectedMode
    ? `【${selectedMode.name}】直接提问，或点上方提示词；上传文件可选…`
    : config.inputPlaceholder;

  const quotaBalance =
    walletQuery.data?.balance ??
    quotaQuery.data?.balance ??
    null;

  const avatarDisplayUrl = resolveAvatarDisplayUrl(user?.avatarUrl);

  const showEmptyIntro = !messages.length && !activeSessionId;
  const lastAssistantId = [...messages].reverse().find((item) => item.role === 'assistant')?.id;
  const [promptLaunch, setPromptLaunch] = useState<PromptLaunchRequest | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [openFilePickerNonce, setOpenFilePickerNonce] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const recentFiles = useChatStore((s) => s.recentFiles);
  const accent = department.theme.accent;
  const accentSoft = `${accent}1F`;
  const iconBg = department.theme.iconBg;

  const launchPrompt = (text: string) => {
    pinToBottom();
    setPromptLaunch({ text, nonce: Date.now() });
  };

  const pickLibraryFile = (file: ChatAttachment) => {
    const exists = attachments.some(
      (item) =>
        (item.fileId && file.fileId && item.fileId === file.fileId) ||
        item.fileName === file.fileName,
    );
    if (!exists) {
      onAttachmentsChange([...attachments, { ...file, status: file.status || 'ready' }]);
    }
    setLibraryOpen(false);
  };

  return (
    <div
      className="agent-workbench relative flex h-full min-h-0 overflow-hidden"
      style={
        {
          '--wb-accent': accent,
          '--wb-from': department.theme.from,
          '--wb-to': department.theme.to,
        } as CSSProperties
      }
    >
      <div className="agent-workbench__glow" aria-hidden />

      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="relative z-50 flex shrink-0 items-center gap-3 px-5 py-3">
          <UserCenterTrigger
            title="打开用户中心"
            avatarUrl={avatarDisplayUrl}
          />
          <PageBackButton onBack={() => navigate('/')} label="返回主页" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-slate-800">
              AI员工助手
              <span className="mx-1.5 text-slate-300">|</span>
              <span style={{ color: accent }}>{config.shortName}</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            {onEnterLobster ? (
              <button
                type="button"
                onClick={onEnterLobster}
                className="lobster-jelly-cta !py-1.5 !text-xs"
                aria-label="进入通用智能体"
              >
                <span className="lobster-jelly-cta__icon" aria-hidden>
                  ✦
                </span>
                <span>进入通用智能体</span>
              </button>
            ) : null}
            {onNewChat ? (
              <button
                type="button"
                onClick={onNewChat}
                className="apple-glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600"
                title="新建对话"
              >
                <Plus className="size-3.5" />
                新对话
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => openUserCenter('credits')}
              className="apple-glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600"
            >
              <Coins className="size-3.5 text-amber-500" />
              AI 积分 {quotaBalance != null ? quotaBalance : '—'}
            </button>
          </div>
        </header>

        <div className="flex shrink-0 justify-center px-5 pb-2">
          <div className="apple-glass-chip inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full p-1">
            {PUBLISHED_DEPARTMENT_AGENTS.map((item) => {
              const active = item.code === department.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => navigate(`/templates/${item.code}`)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-xs font-semibold transition',
                    active ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-white/55',
                  )}
                  style={active ? { background: item.theme.accent } : undefined}
                >
                  {item.name}
                </button>
              );
            })}
          </div>
        </div>

        {toast ? (
          <div className="mx-5 mt-1 flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs text-amber-800 backdrop-blur">
            <span>{toast}</span>
            <button type="button" className="font-medium" onClick={onDismissToast}>
              关闭
            </button>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className={cn(
              'h-full overflow-y-auto px-5 py-3',
              '[&::-webkit-scrollbar]:w-1.5',
              '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/70',
            )}
          >
            <div className="mx-auto flex max-w-[980px] flex-col gap-4">
              {showEmptyIntro ? (
                <>
                  <div className="px-2 pt-4 text-center sm:pt-8">
                    <h1 className="text-[26px] font-semibold tracking-tight text-slate-900 sm:text-[32px]">
                      你好，欢迎使用AI员工助手
                    </h1>
                    <p className="mt-2 text-sm text-slate-500">
                      上传文件或直接提问，{config.shortName}智能体随时待命
                    </p>
                  </div>
                  <AgentHomeCard
                    agentName={config.shortName}
                    slogan={config.slogan}
                    accent={accent}
                    iconBg={iconBg}
                    quickActions={activePrompts}
                    onQuickAction={launchPrompt}
                    onUploadClick={() => setOpenFilePickerNonce(Date.now())}
                    onAskClick={() => setFocusNonce(Date.now())}
                  />
                  {selectedMode ? (
                    <HeroBanner
                      agentId={config.code}
                      title={config.welcomeTitle}
                      slogan={config.slogan}
                      themeColor={accent}
                      heroBackground={`linear-gradient(125deg, ${department.theme.from} 0%, ${department.theme.to} 100%)`}
                      agentName={config.name}
                      modeLabel={modeLabel}
                      modeSelected={Boolean(selectedMode)}
                      fileHint={fileHint}
                      prompts={activePrompts}
                      onSelectPrompt={launchPrompt}
                      className="apple-glass border-0 shadow-none"
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <HeroBanner
                    agentId={config.code}
                    title={config.welcomeTitle}
                    slogan={config.slogan}
                    themeColor={accent}
                    heroBackground={`linear-gradient(125deg, ${department.theme.from} 0%, ${department.theme.to} 100%)`}
                    agentName={config.name}
                    modeLabel={modeLabel}
                    modeSelected={Boolean(selectedMode)}
                    fileHint={fileHint}
                    prompts={activePrompts}
                    onSelectPrompt={launchPrompt}
                    className="apple-glass border-0 shadow-none"
                  />

                  <div className="flex flex-col gap-3">
                    {messages.map((message, index) => {
                      const isLast = index === messages.length - 1;
                      const isPendingAssistant =
                        message.role === 'assistant' &&
                        !message.content.trim() &&
                        sending &&
                        isLast;
                      const isStreamingAssistant =
                        message.role === 'assistant' &&
                        Boolean(message.content.trim()) &&
                        sending &&
                        isLast;
                      const showCopy =
                        message.role !== 'system' &&
                        Boolean(message.content.trim()) &&
                        (message.role === 'user' ||
                          (message.role === 'assistant' &&
                            !isPendingAssistant &&
                            !isStreamingAssistant));
                      const showEdit =
                        message.role === 'user' &&
                        Boolean(onEditMessage) &&
                        Boolean(message.content.trim()) &&
                        !sending;
                      const showRegenerate =
                        message.role === 'assistant' &&
                        message.id === lastAssistantId &&
                        Boolean(onRegenerate) &&
                        !isPendingAssistant &&
                        !isStreamingAssistant;
                      const showExport =
                        message.role === 'assistant' &&
                        Boolean(message.content.trim()) &&
                        Boolean(onExportTable) &&
                        !isPendingAssistant &&
                        !isStreamingAssistant;
                      const showActions = showCopy || showEdit || showRegenerate || showExport;

                      return (
                        <div
                          key={message.id}
                          className={cn(
                            'group flex flex-col',
                            message.role === 'user' ? 'ml-8 items-end' : 'mr-8 items-start',
                          )}
                        >
                          <div
                            className={cn(
                              'group relative rounded-[18px] px-4 py-3 text-sm leading-relaxed shadow-sm',
                              message.role === 'user'
                                ? 'text-slate-800'
                                : message.role === 'assistant'
                                  ? 'apple-glass text-slate-800'
                                  : 'border border-white/60 bg-white/40 text-slate-500',
                            )}
                            style={
                              message.role === 'user'
                                ? { background: `${accent}28` }
                                : undefined
                            }
                          >
                            {isPendingAssistant ? (
                              <ReplyGeneratingIndicator active={sending} phase="waiting" />
                            ) : message.role === 'assistant' ? (
                              <div className="text-sm leading-relaxed">
                                {isStreamingAssistant ? (
                                  <div className="whitespace-pre-wrap break-words text-slate-800">
                                    {message.content}
                                  </div>
                                ) : (
                                  renderChatMarkdown(message.content)
                                )}
                                {isStreamingAssistant ? (
                                  <div className="mt-2">
                                    <ReplyGeneratingIndicator active={sending} phase="streaming" />
                                  </div>
                                ) : null}
                                {message.generatedFiles?.length ? (
                                  <div className="mt-3 flex flex-col gap-2 border-t border-slate-200/70 pt-3">
                                    <div className="text-xs text-slate-400">生成文件</div>
                                    {message.generatedFiles.map((file) => (
                                      <button
                                        key={file.fileId}
                                        type="button"
                                        onClick={() => onDownloadFile?.(file)}
                                        className="inline-flex items-center gap-2 rounded-md border border-slate-200/80 px-3 py-2 text-sm hover:bg-white/70"
                                      >
                                        <Download className="size-4" />
                                        {file.fileName}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <pre className="m-0 whitespace-pre-wrap font-sans">{message.content}</pre>
                            )}
                          </div>
                          {showActions ? (
                            <div
                              className={cn(
                                'mt-1 flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100',
                                message.role === 'user' ? 'justify-end' : 'justify-start',
                                (editingMessageId === message.id || regeneratingId === message.id) &&
                                  'opacity-100',
                              )}
                            >
                              {showCopy ? (
                                <MessageCopyButton
                                  text={message.content}
                                  className="size-7 text-slate-400 hover:bg-white/70 hover:text-slate-600"
                                />
                              ) : null}
                              {showEdit ? (
                                <MessageEditButton
                                  onClick={() => onEditMessage?.(message.id)}
                                  disabled={editingMessageId === message.id || sending}
                                  className="size-7 text-slate-400 hover:bg-white/70 hover:text-slate-600"
                                />
                              ) : null}
                              {showRegenerate ? (
                                <MessageRegenerateButton
                                  onClick={() => onRegenerate?.(message.id)}
                                  spinning={regeneratingId === message.id}
                                  disabled={Boolean(regeneratingId) || sending}
                                  className="size-7 text-slate-400 hover:bg-white/70 hover:text-slate-600"
                                />
                              ) : null}
                              {showExport ? (
                                <button
                                  type="button"
                                  title="保存表格到 Excel"
                                  aria-label="保存表格到 Excel"
                                  onClick={() => onExportTable?.(message.id)}
                                  disabled={Boolean(exportingId) || sending}
                                  className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-slate-400 hover:bg-white/70 hover:text-slate-600 disabled:opacity-50"
                                >
                                  {exportingId === message.id ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    <FileSpreadsheet className="size-4" />
                                  )}
                                  <span>保存表格</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="flex flex-col gap-2">
                    {selectedMode ? (
                      <p className="text-[11px] text-slate-400">
                        当前「{selectedMode.name}」· {fileHint}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {activePrompts.map((task) => (
                        <button
                          key={task}
                          type="button"
                          onClick={() => launchPrompt(task)}
                          className="apple-glass-chip rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          {task}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <p className="pb-1 text-center text-[11px] text-slate-400">
                {workspace.organizationName} · 当前模式：{modeLabel}
              </p>
            </div>
          </div>
          <ScrollToTopButton visible={showTopButton} onClick={() => scrollToTop()} />
          <ScrollToBottomButton visible={showScrollButton} onClick={() => scrollToBottom()} />
        </div>

        <TaskInput
          placeholder={inputPlaceholder}
          attachments={attachments}
          onAttachmentsChange={onAttachmentsChange}
          onUploadFiles={onUploadFiles}
          onOpenLibrary={() => setLibraryOpen(true)}
          onSend={(content) => {
            pinToBottom();
            onSend(content);
          }}
          onStop={onStop}
          editingMessageId={editingMessageId}
          editDraft={editDraft}
          onEditDraftChange={onEditDraftChange}
          onCancelEdit={onCancelEdit}
          onFocus={onEnterChatMode}
          sending={sending}
          accent={accent}
          promptLaunch={promptLaunch}
          fileHint={fileHint}
          onPromptLaunchHandled={() => setPromptLaunch(null)}
          focusNonce={focusNonce}
          openFilePickerNonce={openFilePickerNonce}
        />
      </div>

      {libraryOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="apple-glass w-full max-w-lg rounded-[18px] p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">从文件库选择</h3>
              <button
                type="button"
                aria-label="关闭文件库"
                onClick={() => setLibraryOpen(false)}
                className="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-white/70 hover:text-slate-700"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {recentFiles.length ? (
                recentFiles.map((file) => (
                  <button
                    key={file.fileId ?? file.fileName}
                    type="button"
                    className="rounded-[12px] border border-white/40 bg-white/50 px-3 py-2 text-left text-sm hover:bg-white/80"
                    onClick={() => pickLibraryFile(file)}
                  >
                    <div className="font-medium text-slate-800">{file.fileName}</div>
                    <div className="text-xs text-slate-500">
                      {file.sizeBytes
                        ? `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`
                        : '已保存'}
                    </div>
                  </button>
                ))
              ) : (
                <div className="py-6 text-center text-sm text-slate-500">
                  暂无已上传文件。请先在对话中上传附件。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <aside className="relative z-10 flex h-full w-[300px] shrink-0 flex-col gap-3 border-l border-white/30 bg-white/20 p-3 backdrop-blur-xl max-[1440px]:w-[280px]">
        <WorkModePanel
          modes={config.workModes}
          selectedId={modeId}
          accent={accent}
          accentSoft={accentSoft}
          onSelect={onModeChange}
          onNewChat={() => onNewChat?.()}
          className="max-h-[46%]"
        />
        <DepartmentHistoryPanel
          items={historyItems}
          activeId={activeConversationId}
          accent={accent}
          onSelect={(id) => onSelectHistory?.(id)}
          onNewChat={() => onNewChat?.()}
          onClearAll={() => onClearHistory?.()}
          onDelete={onDeleteHistory}
        />
      </aside>
    </div>
  );
}
