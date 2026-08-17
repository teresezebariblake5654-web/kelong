import type { ChatAgentCode } from '@aw/shared';
import { CHAT_AGENTS } from '@workstation/constants/chatAgents';
import { cn } from '@workstation/lib/utils';

type AgentSelectorProps = {
  value: ChatAgentCode;
  onChange: (code: ChatAgentCode) => void;
  compact?: boolean;
};

export function AgentSelector({ value, onChange, compact }: AgentSelectorProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'gap-1.5')}>
      {CHAT_AGENTS.map((agent) => {
        const active = agent.code === value;
        return (
          <button
            key={agent.code}
            type="button"
            title={agent.description}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-muted/60',
              compact && 'px-2.5 py-0.5',
            )}
            onClick={() => onChange(agent.code)}
          >
            {agent.label}
          </button>
        );
      })}
    </div>
  );
}
