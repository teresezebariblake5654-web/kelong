import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '@workstation/components/ui/button';
import { cn } from '@workstation/lib/utils';
import {
  applyWorkstationLlmKey,
  needsWorkstationLlmKey,
  probeWorkstationLlmKey,
} from '@workstation/services/workstationLlmPreset';

export type WorkstationLlmKeyGateProps = {
  open: boolean;
  /** When true, user cannot dismiss without saving a key. */
  forced: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured: () => void;
};

export function WorkstationLlmKeyGate({
  open,
  forced,
  onOpenChange,
  onConfigured,
}: WorkstationLlmKeyGateProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setShowKey(false);
    setError(null);
    setSaving(false);
  }, [open]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && forced) return;
      onOpenChange(next);
    },
    [forced, onOpenChange],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('请粘贴我们提供的 API Key');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await applyWorkstationLlmKey(trimmed);
      const probe = await probeWorkstationLlmKey();
      if (!probe.ok) {
        setError(probe.error || 'Key 无效或网络不通，请检查后重试');
        setSaving(false);
        return;
      }
      onConfigured();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [apiKey, onConfigured, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[80] bg-black/55 backdrop-blur-[2px]',
            forced && 'cursor-not-allowed',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[81] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-white/15 bg-[#12141c] p-6 text-white shadow-2xl',
            'focus:outline-none',
          )}
          onEscapeKeyDown={(event) => {
            if (forced) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (forced) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (forced) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            连接智能体服务
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-white/65">
            把我们提供的 Key 粘贴到下方，即可开始使用部门智能体与通用 Agent。
          </Dialog.Description>

          <label className="mt-5 block text-xs font-medium text-white/70" htmlFor="ws-llm-api-key">
            API Key
          </label>
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 focus-within:border-amber-400/50">
            <input
              id="ws-llm-api-key"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !saving) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="sk-…"
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none"
              disabled={saving}
            />
            <button
              type="button"
              className="shrink-0 rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? '隐藏 Key' : '显示 Key'}
            >
              {showKey ? (
                <EyeSlashIcon className="h-4 w-4" />
              ) : (
                <EyeIcon className="h-4 w-4" />
              )}
            </button>
          </div>

          {error ? (
            <p className="mt-2 text-xs leading-relaxed text-rose-300" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            {!forced ? (
              <Button
                type="button"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={saving || !apiKey.trim()}
              className="bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
              onClick={() => void handleSubmit()}
            >
              {saving ? '连接中…' : forced ? '开始使用' : '保存并连接'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Hook helpers for host pages. */
export function useWorkstationLlmConfigured(): boolean {
  const [configured, setConfigured] = useState(() => !needsWorkstationLlmKey());

  useEffect(() => {
    const refresh = () => setConfigured(!needsWorkstationLlmKey());
    refresh();
    window.addEventListener('config-updated', refresh);
    return () => window.removeEventListener('config-updated', refresh);
  }, []);

  return configured;
}
