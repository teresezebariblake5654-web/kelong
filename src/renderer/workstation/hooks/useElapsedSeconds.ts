import { useEffect, useState } from 'react';

/** 从 active 变为 true 起累计秒数，停止后归零 */
export function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }

    setSeconds(0);
    const startedAt = Date.now();
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return seconds;
}
