import { MessageSquarePlus, Trash2 } from 'lucide-react';
import type { Conversation } from '@aw/shared';
import { Button } from '@workstation/components/ui/button';
import { ScrollArea } from '@workstation/components/ui/scroll-area';
import { cn } from '@workstation/lib/utils';

type ChatSidebarProps = {
  conversations: Conversation[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
};

/** ChatGPT-style conversation rail — main app nav stays in AppSidebar. */
export function ChatSidebar({
  conversations,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
}: ChatSidebarProps) {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-border bg-card">
      <div className="p-3">
        <Button className="w-full justify-start gap-2" onClick={onNewChat}>
          <MessageSquarePlus className="size-4" />
          新建对话
        </Button>
      </div>

      <div className="px-4 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        对话历史
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        <div className="flex flex-col gap-0.5">
          {conversations.length ? (
            conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-[10px] px-2 py-1.5',
                    active ? 'bg-muted' : 'hover:bg-muted/70',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    {conversation.title}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                    onClick={() => onDeleteConversation(conversation.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="px-2 py-3 text-xs text-muted-foreground">暂无历史对话</div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
