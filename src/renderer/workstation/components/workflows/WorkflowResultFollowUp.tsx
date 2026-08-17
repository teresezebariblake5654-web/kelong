import { Send, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderChatMarkdown } from '@workstation/lib/chatMarkdown';
import { getActiveOrganizationId } from '@workstation/lib/localStore';
import {
  buildWorkflowResultPrompt,
  createWorkflowResultSnapshot,
  loadOrCreateWorkflowResultConversation,
  newWorkflowResultMessage,
  saveWorkflowResultConversation,
  type WorkflowResultConversation,
} from '@workstation/lib/workflowResultConversationStore';
import { getChatService } from '@workstation/services/chat';
import type { DepartmentWorkflowCategory, DesktopExecuteResult } from '@workstation/services/workflow';
import { cn } from '@workstation/lib/utils';

const AGENT_BY_CATEGORY = {
  production: 'production',
  hr: 'hr',
  finance: 'finance',
  ecommerce: 'ecommerce',
  logistics: 'logistics',
  admin: 'admin',
} as const;

type WorkflowResultFollowUpProps = {
  category: DepartmentWorkflowCategory;
  workflowName: string;
  result: DesktopExecuteResult;
  outputFileName?: string;
};

export function WorkflowResultFollowUp({
  category,
  workflowName,
  result,
  outputFileName,
}: WorkflowResultFollowUpProps) {
  const snapshot = useMemo(
    () => createWorkflowResultSnapshot({ result, workflowName, outputFileName }),
    [outputFileName, result, workflowName],
  );
  const [session, setSession] = useState<WorkflowResultConversation>(() =>
    loadOrCreateWorkflowResultConversation({
      organizationId: getActiveOrganizationId() || 'local-device',
      snapshot,
    }),
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSession(
      loadOrCreateWorkflowResultConversation({
        organizationId: getActiveOrganizationId() || 'local-device',
        snapshot,
      }),
    );
    setDraft('');
    setError('');
  }, [snapshot]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onSend = useCallback(async () => {
    const question = draft.trim();
    if (!question || sending) return;

    const prompt = buildWorkflowResultPrompt(session, question);
    const userMessage = newWorkflowResultMessage('user', question);
    const pending = saveWorkflowResultConversation({
      ...session,
      messages: [...session.messages, userMessage],
    });
    setSession(pending);
    setDraft('');
    setError('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await getChatService().sendMessage(
        {
          conversationId: `workflow-result-${result.runId}`,
          clientRequestId: `workflow-followup-${crypto.randomUUID()}`,
          agentCode: AGENT_BY_CATEGORY[category],
          content: prompt,
          fileIds: [],
          imageIds: [],
          userInstruction: question,
        },
        { signal: controller.signal },
      );
      const completed = saveWorkflowResultConversation({
        ...pending,
        messages: [
          ...pending.messages,
          newWorkflowResultMessage('assistant', response.content),
        ],
      });
      setSession(completed);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('已停止生成，你可以修改问题后重新发送。');
      } else {
        setError(err instanceof Error ? err.message : '追问失败，请重试');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  }, [category, draft, result.runId, sending, session]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">基于本次结果继续追问</h3>
        <p className="mt-1 text-xs text-slate-500">
          智能体只读取本次运行的脱敏指标、异常和规则摘要，不上传原始工作簿。
        </p>
      </div>

      {session.messages.length ? (
        <div className="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
          {session.messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'max-w-[90%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                message.role === 'user'
                  ? 'ml-auto bg-indigo-100 text-slate-800'
                  : 'mr-auto border border-slate-200 bg-white text-slate-800',
              )}
            >
              {message.role === 'assistant' ? (
                renderChatMarkdown(message.content)
              ) : (
                <pre className="m-0 whitespace-pre-wrap font-sans">{message.content}</pre>
              )}
            </div>
          ))}
          {sending ? <div className="text-xs text-slate-400">正在基于结果分析…</div> : null}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {['哪些异常最需要先处理？', '按严重程度给出处理顺序', '解释关键指标并给出下一步建议'].map(
            (question) => (
              <button
                key={question}
                type="button"
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                onClick={() => setDraft(question)}
              >
                {question}
              </button>
            ),
          )}
        </div>
      )}

      <div className="mt-3 flex items-end gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-indigo-300">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          rows={2}
          disabled={sending}
          placeholder="继续询问本次结果，例如：这些异常应该如何分工处理？"
          className="min-h-12 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-slate-400"
        />
        {sending ? (
          <button
            type="button"
            title="停止生成"
            aria-label="停止生成"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white"
            onClick={() => abortRef.current?.abort()}
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            title="发送追问"
            aria-label="发送追问"
            disabled={!draft.trim()}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white disabled:opacity-40"
            onClick={() => void onSend()}
          >
            <Send className="size-4" />
          </button>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}


