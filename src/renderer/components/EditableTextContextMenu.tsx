import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { i18nService } from '../services/i18n';

type MenuAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll';

type MenuState = {
  x: number;
  y: number;
  target: HTMLInputElement | HTMLTextAreaElement | HTMLElement;
};

function isEditableTarget(node: EventTarget | null): node is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
  if (node instanceof HTMLInputElement) {
    if (node.disabled || node.readOnly) return false;
    const type = (node.type || 'text').toLowerCase();
    return ![
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ].includes(type);
  }
  return node.isContentEditable;
}

function runEditCommand(command: string): boolean {
  try {
    return document.execCommand(command);
  } catch {
    return false;
  }
}

async function pasteInto(target: HTMLInputElement | HTMLTextAreaElement | HTMLElement): Promise<void> {
  target.focus();
  if (runEditCommand('paste')) return;

  let text = '';
  const electronClipboard = window.electron?.clipboard;
  if (electronClipboard && 'readText' in electronClipboard) {
    try {
      const result = await (electronClipboard as { readText: () => Promise<{ success: boolean; text?: string }> }).readText();
      if (result.success && result.text) text = result.text;
    } catch {
      // fall through
    }
  }
  if (!text) {
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
  }
  if (!text) return;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + text + target.value.slice(end);
    const prototype = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    descriptor?.set?.call(target, next);
    const caret = start + text.length;
    target.setSelectionRange(caret, caret);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  document.execCommand('insertText', false, text);
}

/**
 * App-wide right-click Cut/Copy/Paste/Select All for every typed input.
 * Runs in the renderer so it works even when the main process has not restarted.
 */
export function EditableTextContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const hit = path.find((node) => isEditableTarget(node));
      if (!hit || !isEditableTarget(hit)) return;

      event.preventDefault();
      event.stopPropagation();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        target: hit,
      });
    };

    const close = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', close, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    // Adjust via DOM only — avoid setState loops that can freeze the UI.
    if (x !== menu.x || y !== menu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menu]);

  if (!menu) return null;

  const target = menu.target;
  const hasSelection = (() => {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return (target.selectionEnd ?? 0) > (target.selectionStart ?? 0);
    }
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && target.contains(selection.anchorNode));
  })();

  const actions: Array<{ id: MenuAction; label: string; enabled: boolean; danger?: boolean }> = [
    { id: 'cut', label: i18nService.t('editCut'), enabled: hasSelection },
    { id: 'copy', label: i18nService.t('editCopy'), enabled: hasSelection },
    { id: 'paste', label: i18nService.t('editPaste'), enabled: true },
    { id: 'delete', label: i18nService.t('editDelete'), enabled: hasSelection },
    { id: 'selectAll', label: i18nService.t('editSelectAll'), enabled: true },
  ];

  const run = async (action: MenuAction) => {
    const el = menu.target;
    el.focus();
    try {
      switch (action) {
        case 'undo':
          runEditCommand('undo');
          break;
        case 'redo':
          runEditCommand('redo');
          break;
        case 'cut':
          runEditCommand('cut');
          break;
        case 'copy':
          runEditCommand('copy');
          break;
        case 'paste':
          await pasteInto(el);
          break;
        case 'delete':
          runEditCommand('delete');
          break;
        case 'selectAll':
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.select();
          } else {
            runEditCommand('selectAll');
          }
          break;
      }
    } finally {
      setMenu(null);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[2147483000] min-w-[148px] overflow-hidden rounded-lg border border-black/10 bg-white py-1 text-[13px] text-slate-800 shadow-[0_12px_40px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#1c1f2a] dark:text-slate-100"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((item, index) => (
        <div key={item.id}>
          {index === 3 ? <div className="my-1 h-px bg-black/8 dark:bg-white/10" /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={!item.enabled}
            className="flex w-full items-center px-3 py-1.5 text-left hover:bg-black/5 disabled:cursor-default disabled:opacity-40 dark:hover:bg-white/8"
            onClick={() => void run(item.id)}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
