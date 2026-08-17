import { useCallback, useEffect, useRef, useState } from 'react';

const NEAR_BOTTOM_PX = 96;
const SHOW_TOP_BUTTON_PX = 320;

type UseChatScrollOptions = {
  /** 用于离开页面后恢复滚动位置，如 dept-chat-hr / chat-conv-123 */
  persistKey?: string;
  deps?: unknown[];
};

export function useChatScroll({ persistKey, deps = [] }: UseChatScrollOptions = {}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showTopButton, setShowTopButton] = useState(false);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  }, []);

  const persistScrollTop = useCallback(() => {
    if (!persistKey) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    sessionStorage.setItem(persistKey, String(el.scrollTop));
  }, [persistKey]);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    });
    stickToBottomRef.current = true;
    setShowScrollButton(false);
    requestAnimationFrame(persistScrollTop);
  }, [persistScrollTop]);

  const scrollToTop = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    stickToBottomRef.current = false;
    setShowTopButton(false);
    setShowScrollButton(el.scrollHeight > el.clientHeight + NEAR_BOTTOM_PX);
    requestAnimationFrame(persistScrollTop);
  }, [persistScrollTop]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    const atBottom = isNearBottom();
    stickToBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
    setShowTopButton(Boolean(el && el.scrollTop > SHOW_TOP_BUTTON_PX));
    persistScrollTop();
  }, [isNearBottom, persistScrollTop]);

  // 切换会话/岗位时恢复滚动位置
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    stickToBottomRef.current = true;
    setShowScrollButton(false);

    if (!persistKey) {
      requestAnimationFrame(() => scrollToBottom(false));
      return;
    }

    const saved = sessionStorage.getItem(persistKey);
    requestAnimationFrame(() => {
      if (saved != null && saved !== '') {
        el.scrollTop = Number(saved);
        const atBottom = isNearBottom();
        stickToBottomRef.current = atBottom;
        setShowScrollButton(!atBottom);
        setShowTopButton(el.scrollTop > SHOW_TOP_BUTTON_PX);
      } else {
        scrollToBottom(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 persistKey 变化时恢复
  }, [persistKey]);

  // 仅在贴底时跟随新消息；用户上滑阅读时不打断
  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom(false);
    } else {
      setShowScrollButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const pinToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    setShowScrollButton(false);
  }, []);

  return {
    scrollContainerRef,
    bottomRef,
    showScrollButton,
    showTopButton,
    scrollToBottom,
    scrollToTop,
    pinToBottom,
    handleScroll,
  };
}

