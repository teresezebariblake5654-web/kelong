import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '@workstation/lib/utils';

const FADE_MS = 500;
const FADE_OUT_LEAD = 0.55;

type FadingVideoProps = {
  src: string;
  className?: string;
  style?: CSSProperties;
  /** object-position hint for cinematic framing */
  objectPosition?: string;
  /** Match landing-page hero: 120% cover framed from top */
  heroScale?: boolean;
};

/**
 * Full-bleed looping background video with rAF opacity crossfade (no CSS transitions).
 * Local bundled assets preferred — remote CDN often fails in desktop runtime.
 */
export function FadingVideo({
  src,
  className,
  style,
  objectPosition = 'center center',
  heroScale = false,
}: FadingVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const fadingOutRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setReady(false);
    fadingOutRef.current = false;

    const cancelFade = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const readOpacity = () => {
      const raw = video.style.opacity;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const fadeTo = (target: number, duration: number) => {
      cancelFade();
      const start = performance.now();
      const from = readOpacity();
      const delta = target - from;

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        video.style.opacity = String(from + delta * t);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    };

    const onLoadedData = () => {
      setReady(true);
      video.style.opacity = '0';
      void video.play().catch(() => {});
      fadeTo(1, FADE_MS);
    };

    const onTimeUpdate = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const remaining = duration - video.currentTime;
      if (!fadingOutRef.current && remaining <= FADE_OUT_LEAD && remaining > 0) {
        fadingOutRef.current = true;
        fadeTo(0, FADE_MS);
      }
    };

    const onEnded = () => {
      video.style.opacity = '0';
      window.setTimeout(() => {
        try {
          video.currentTime = 0;
        } catch {
          // ignore
        }
        void video.play().catch(() => {});
        fadingOutRef.current = false;
        fadeTo(1, FADE_MS);
      }, 100);
    };

    video.style.opacity = '0';
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('canplay', onLoadedData);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    video.load();

    if (video.readyState >= 2) onLoadedData();

    return () => {
      cancelFade();
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('canplay', onLoadedData);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
    };
  }, [src]);

  return (
    <div className={cn('absolute inset-0 overflow-hidden bg-black', className)} style={style}>
      {/* Soft placeholder only until first frame — never the final “look” */}
      {!ready ? (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#1a1520_0%,#000_70%)]" />
      ) : null}
      <video
        ref={videoRef}
        className={cn(
          'absolute object-cover',
          heroScale
            ? 'left-1/2 top-0 h-[120%] w-[120%] -translate-x-1/2'
            : 'inset-0 h-full w-full',
        )}
        style={{ opacity: 0, objectPosition }}
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        loop={false}
      />
    </div>
  );
}
