import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@workstation/lib/utils';

type BlurTextProps = {
  text: string;
  className?: string;
};

/**
 * Word-by-word blur-in, triggered when ~10% visible.
 */
export function BlurText({ text, className }: BlurTextProps) {
  const rootRef = useRef<HTMLParagraphElement>(null);
  const [visible, setVisible] = useState(false);
  const words = useMemo(() => {
    const trimmed = text.trim();
    // CJK headlines have no spaces — animate character by character.
    if (/[\u4e00-\u9fff]/.test(trimmed) && !/\s/.test(trimmed)) {
      return Array.from(trimmed);
    }
    return trimmed.split(/\s+/);
  }, [text]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <p
      ref={rootRef}
      className={cn(className)}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        rowGap: '0.1em',
      }}
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          style={{ display: 'inline-block', marginRight: /[\u4e00-\u9fff]/.test(word) ? '0.02em' : '0.28em' }}
          initial={{ filter: 'blur(10px)', opacity: 0, y: 50 }}
          animate={
            visible
              ? {
                  filter: ['blur(10px)', 'blur(5px)', 'blur(0px)'],
                  opacity: [0, 0.5, 1],
                  y: [50, -5, 0],
                }
              : undefined
          }
          transition={{
            duration: 0.7,
            times: [0, 0.5, 1],
            ease: 'easeOut',
            delay: (i * 100) / 1000,
          }}
        >
          {word}
        </motion.span>
      ))}
    </p>
  );
}
