import { Send } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@workstation/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@workstation/components/ui/card';
import { roleToAgentCode } from '@workstation/lib/roleToAgent';
import { cn } from '@workstation/lib/utils';
import { getChatService } from '@workstation/services/chat';
import { useWorkflow } from '@workstation/state/workflow';

/** 报告页继续追问：复用当前文件与分析结果，无需重新上传 */
export function ReportFollowUp() {
  const { state, patch } = useWorkflow();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const followUps = state.followUps ?? [];
  const fileIds =
    state.fileIds && state.fileIds.length > 0
      ? state.fileIds
      : state.uploadedFileId
        ? [state.uploadedFileId]
        : [];

  const onSend = useCallback(async () => {
    const question = draft.trim();
    if (!question || sending) return;
    if (!state.task) {
      setError('缺少当前模板，无法继续追问');
      return;
    }

    setSending(true);
    setError('');
    const conversationId =
      state.conversationId || `tpl-${state.task.code}-followup-${crypto.randomUUID()}`;

    const prior = [
      state.analysisText ? `【已有分析结果】\n${state.analysisText}` : '',
      ...followUps.map(
        (item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');

    const previous = followUps;
    patch({
      conversationId,
      followUps: [...previous, { role: 'user', content: question }],
    });
    setDraft('');

    try {
      const response = await getChatService().sendMessage({
        conversationId,
        agentCode: roleToAgentCode(state.role || state.task.role, state.task),
        content: `${prior}\n\n【继续追问】${question}`,
        fileIds,
        imageIds: [],
        templateCode: state.task.code,
        userInstruction: question,
      });
      patch({
        followUps: [
          ...previous,
          { role: 'user', content: question },
          { role: 'assistant', content: response.content },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '追问失败，请重试');
      patch({ followUps: previous });
    } finally {
      setSending(false);
    }
  }, [draft, fileIds, followUps, patch, sending, state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>继续追问</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          基于当前已上传文件与分析结果继续提问，无需重新上传。
        </p>

        {followUps.length ? (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-[12px] border border-border bg-muted/30 p-3">
            {followUps.map((item, index) => (
              <div
                key={`${item.role}-${index}`}
                className={cn(
                  'rounded-[10px] px-3 py-2 text-sm',
                  item.role === 'user' ? 'bg-card' : 'bg-primary/5',
                )}
              >
                <div className="mb-1 text-[11px] text-muted-foreground">
                  {item.role === 'user' ? '你' : '智能体'}
                </div>
                <pre className="m-0 whitespace-pre-wrap font-sans">{item.content}</pre>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-[14px] border border-border bg-card px-3 py-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="针对当前结果继续提问，例如：按部门再拆一版异常清单"
            disabled={sending}
            className={cn(
              'min-h-[48px] flex-1 resize-none bg-transparent py-1.5 text-sm',
              'outline-none ring-0 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
              'placeholder:text-muted-foreground',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            disabled={sending || !draft.trim()}
            onClick={() => void onSend()}
          >
            <Send className="size-4" />
          </Button>
        </div>
        {error ? <div className="text-xs text-destructive">{error}</div> : null}
      </CardContent>
    </Card>
  );
}
