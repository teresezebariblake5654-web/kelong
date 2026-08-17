import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  selectCurrentSession,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import { CoworkSessionStatusValue } from '../../types/cowork';
import {
  DONE_MOOD_MS,
  PET_MOOD_BUBBLES,
  PET_PLAYGROUND,
  PLAYGROUND_BROWSE_MS,
  THINKING_ROTATE_MS,
  poolForMood,
  resolvePetMood,
  type PetClip,
  type PetMood,
} from './petAssets';
import { fetchPetCreditBalance } from './petCreditsBridge';
import {
  applyBalanceSnapshot,
  consumePendingUiDemo,
  demoForceRevive,
  demoForceReviving,
  demoForceStarve,
  feedVitality,
  lifeStateBubble,
  loadVitalityState,
  noteForeground,
  onCreditsConsumed,
  onOfflineSessionCompleted,
  resolveLifeState,
  reviveProgressRatio,
  reviveTipLines,
  saveVitalityState,
  stampDeathBalance,
  tickVitality,
  type PetVitalityState,
} from './petVitality';
import { isCowPetDemoAlwaysAlive } from '../../../shared/featureFlags';
import './cowPet.css';

const POS_KEY = 'lobster.cowPet.position';
const POS_KEY_LEGACY = 'cowPet.position';
const COLLAPSED_KEY = 'lobster.cowPet.collapsed';
const COLLAPSED_KEY_LEGACY = 'cowPet.collapsed';

type Pos = { right: number; bottom: number };

function bootstrapVitality(): PetVitalityState {
  let state = loadVitalityState();
  if (isCowPetDemoAlwaysAlive() && state.vitality <= 0) {
    state = demoForceRevive(state);
    saveVitalityState(state);
  }
  return state;
}

function readPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY) ?? localStorage.getItem(POS_KEY_LEGACY);
    if (!raw) return { right: 20, bottom: 88 };
    const parsed = JSON.parse(raw) as Pos;
    if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { right: 20, bottom: 88 };
}

function readCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY) ?? localStorage.getItem(COLLAPSED_KEY_LEGACY);
    return raw === '1';
  } catch {
    return false;
  }
}

function commitVitality(next: PetVitalityState): PetVitalityState {
  saveVitalityState(next);
  return next;
}

export interface CowPetProps {
  /** Hide while settings / privacy / welcome / permission modals are open. */
  suspended?: boolean;
}

const CowPet: React.FC<CowPetProps> = ({ suspended = false }) => {
  const isStreaming = useSelector(selectIsStreaming);
  const currentSession = useSelector(selectCurrentSession);
  const sessionStatus = currentSession?.status ?? null;

  const [vitality, setVitality] = useState<PetVitalityState>(() => bootstrapVitality());
  const [doneUntilMs, setDoneUntilMs] = useState(0);
  const [clipIndex, setClipIndex] = useState(0);
  /** When > now, clicks cycle the full playground album instead of the tiny mood pool. */
  const [browseUntilMs, setBrowseUntilMs] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [pos, setPos] = useState<Pos>(readPos);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const prevStreamingRef = useRef(false);
  const lastMoodRef = useRef<PetMood | null>(null);

  const patchVitality = useCallback((updater: (prev: PetVitalityState) => PetVitalityState) => {
    setVitality((prev) => commitVitality(updater(prev)));
  }, []);

  const runDemo = useCallback((kind: 'starve' | 'reviving' | 'revive') => {
    setCollapsed(false);
    try {
      localStorage.setItem(COLLAPSED_KEY, '0');
    } catch {
      /* ignore */
    }
    setBrowseUntilMs(0);
    setBubbleVisible(true);
    if (kind === 'starve') {
      patchVitality((prev) => demoForceStarve(prev));
    } else if (kind === 'reviving') {
      patchVitality((prev) => demoForceReviving(prev));
    } else {
      patchVitality((prev) => demoForceRevive(prev));
    }
  }, [patchVitality]);

  // One-shot demo after hot reload / first paint (pending flag in petVitality)
  useEffect(() => {
    const pending = consumePendingUiDemo();
    if (!pending) return;
    const t = window.setTimeout(() => runDemo(pending), 80);
    return () => window.clearTimeout(t);
  }, [runDemo]);

  // Dev shortcuts + window helpers for repeated demos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey && e.shiftKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'd') {
        e.preventDefault();
        runDemo('starve');
      } else if (key === 'v') {
        e.preventDefault();
        runDemo('reviving');
      } else if (key === 'r') {
        e.preventDefault();
        runDemo('revive');
      }
    };
    window.addEventListener('keydown', onKey);
    (window as unknown as { __cowPetDemo?: Record<string, () => void> }).__cowPetDemo = {
      starve: () => runDemo('starve'),
      reviving: () => runDemo('reviving'),
      revive: () => runDemo('revive'),
    };
    return () => {
      window.removeEventListener('keydown', onKey);
      delete (window as unknown as { __cowPetDemo?: unknown }).__cowPetDemo;
    };
  }, [runDemo]);

  // Self-contained vitality tick (no App.tsx / global bus coupling)
  useEffect(() => {
    const runTick = () => {
      patchVitality((prev) => {
        let next = tickVitality(prev, Date.now(), {
          skipDecay: isCowPetDemoAlwaysAlive(),
        });
        next = noteForeground(next, document.visibilityState === 'visible');
        if (document.visibilityState === 'visible' && next.vitality > 0) {
          next = feedVitality(next, 'light');
        }
        return next;
      });
    };
    runTick();
    const onVis = () => {
      patchVitality((prev) => noteForeground(prev, document.visibilityState === 'visible'));
      if (document.visibilityState === 'visible') runTick();
    };
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(runTick, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
  }, [patchVitality]);

  // Credits observation (one-way): read-only balance probe + optional notify event.
  // Isolation = no session kick / no pointer steal; NOT "ignore app usage".
  useEffect(() => {
    let cancelled = false;
    const life = resolveLifeState(vitality);
    const urgent = life === 'dead' || life === 'reviving';
    // Alive: slower watch for spend→feed. Dead/reviving: faster for revive progress.
    const intervalMs = urgent ? 45_000 : 90_000;

    const syncBalance = async () => {
      const bal = await fetchPetCreditBalance();
      if (cancelled || bal == null) return;
      patchVitality((prev) => {
        let next = applyBalanceSnapshot(prev, bal);
        if (next.vitality <= 0 && next.deadAt != null && next.balanceAtDeath == null) {
          next = stampDeathBalance(next, bal);
        }
        return next;
      });
    };

    const onCreditsEvent = (e: Event) => {
      const amount = Number((e as CustomEvent<{ amount?: number }>).detail?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      patchVitality((prev) => onCreditsConsumed(prev, amount));
    };

    // Workstation already emits this after AI charge / wallet refresh — pet only re-reads balance.
    const onWorkstationCreditsChanged = () => {
      void syncBalance();
    };

    void syncBalance();
    const id = window.setInterval(() => void syncBalance(), intervalMs);
    window.addEventListener('lobster:cow-pet:credits-consumed', onCreditsEvent as EventListener);
    window.addEventListener('workstation:credits-changed', onWorkstationCreditsChanged);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('lobster:cow-pet:credits-consumed', onCreditsEvent as EventListener);
      window.removeEventListener('workstation:credits-changed', onWorkstationCreditsChanged);
    };
  }, [patchVitality, vitality.vitality, vitality.deadAt]);

  // Agent start → full feed; completed session while dead → offline revive step
  useEffect(() => {
    const was = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (!was && isStreaming) {
      patchVitality((prev) => feedVitality(prev, 'agent'));
    }
  }, [isStreaming, patchVitality]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = sessionStatus;
    if (
      sessionStatus === CoworkSessionStatusValue.Completed
      && prev !== CoworkSessionStatusValue.Completed
      && !isStreaming
    ) {
      setDoneUntilMs(Date.now() + DONE_MOOD_MS);
      patchVitality((prev) => onOfflineSessionCompleted(prev));
    }
  }, [sessionStatus, isStreaming, patchVitality]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const need =
      doneUntilMs > Date.now()
      || vitality.justRevivedUntil > Date.now()
      || vitality.vitality <= 0
      || browseUntilMs > Date.now();
    if (!need) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [doneUntilMs, vitality.justRevivedUntil, vitality.vitality, browseUntilMs]);

  const lifeState = useMemo(() => resolveLifeState(vitality), [vitality]);
  const mood = useMemo(
    () =>
      resolvePetMood({
        isStreaming,
        sessionStatus,
        doneUntilMs,
        nowMs: nowTick,
        lifeState,
        justRevivedUntil: vitality.justRevivedUntil,
      }),
    [
      isStreaming,
      sessionStatus,
      doneUntilMs,
      nowTick,
      lifeState,
      vitality.justRevivedUntil,
    ],
  );

  const browsing = browseUntilMs > nowTick
    && lifeState !== 'dead'
    && lifeState !== 'reviving';
  const pool: PetClip[] = browsing ? PET_PLAYGROUND : poolForMood(mood);
  const safeIndex = pool.length > 0 ? clipIndex % pool.length : 0;
  const activeClip = pool[safeIndex];
  const src = activeClip?.src ?? '';
  const reviveRatio = reviveProgressRatio(vitality);
  const lifeBubble = lifeStateBubble(vitality, lifeState);
  const tipLines = reviveTipLines(vitality, lifeState);
  const bubbleText = browsing
    ? (activeClip?.line || '哞～')
    : (lifeBubble || activeClip?.line || PET_MOOD_BUBBLES[mood]);

  useEffect(() => {
    // Status change exits browse and resets clip in the mood pool
    if (lastMoodRef.current !== mood) {
      lastMoodRef.current = mood;
      setBrowseUntilMs(0);
      setClipIndex(0);
      setBubbleVisible(true);
      const t = window.setTimeout(() => setBubbleVisible(false), lifeState === 'reviving' ? 5000 : 3000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [mood, lifeState]);

  // Keep revive bubble more persistent
  useEffect(() => {
    if (lifeState === 'reviving' || lifeState === 'dead' || lifeState === 'hungry') {
      setBubbleVisible(true);
    }
  }, [lifeState, vitality.reviveProgress, vitality.offlineSessionProgress]);

  useEffect(() => {
    if (mood !== 'thinking' || pool.length <= 1 || collapsed) return;
    if (lifeState === 'dead' || lifeState === 'reviving') return;
    const id = window.setInterval(() => {
      setClipIndex((i) => (i + 1) % pool.length);
    }, THINKING_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [mood, pool.length, collapsed, lifeState]);

  const persistCollapsed = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const persistPos = useCallback((next: Pos) => {
    setPos(next);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startRight: pos.right,
        startBottom: pos.bottom,
        moved: false,
      };
    },
    [pos.right, pos.bottom],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    setPos({
      right: Math.max(8, drag.startRight - dx),
      bottom: Math.max(8, drag.startBottom - dy),
    });
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (drag.moved) {
        persistPos({
          right: Math.max(8, drag.startRight - (e.clientX - drag.startX)),
          bottom: Math.max(8, drag.startBottom - (e.clientY - drag.startY)),
        });
        return;
      }
      if (collapsed) {
        persistCollapsed(false);
        setBubbleVisible(true);
        window.setTimeout(() => setBubbleVisible(false), 3000);
        return;
      }
      if (lifeState === 'dead') {
        setBubbleVisible(true);
        return;
      }
      // Click browses the full album (all clips), not just the current status pool.
      setBrowseUntilMs(Date.now() + PLAYGROUND_BROWSE_MS);
      setClipIndex((i) => (i + 1) % Math.max(1, PET_PLAYGROUND.length));
      setBubbleVisible(true);
      // Keep line visible long enough to read while browsing
      window.setTimeout(() => setBubbleVisible(false), 4500);
    },
    [collapsed, persistCollapsed, persistPos, lifeState],
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      persistCollapsed(!collapsed);
    },
    [collapsed, persistCollapsed],
  );

  if (suspended || !src) return null;

  const ringR = 46;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - reviveRatio);

  return (
    <div
      className={[
        'cow-pet',
        collapsed ? 'cow-pet--collapsed' : '',
        lifeState === 'dead' ? 'cow-pet--dead' : '',
        lifeState === 'reviving' ? 'cow-pet--reviving' : '',
        lifeState === 'hungry' ? 'cow-pet--hungry' : '',
        tipLines.length > 0 ? 'cow-pet--with-tip' : '',
      ].filter(Boolean).join(' ')}
      style={{ right: pos.right, bottom: pos.bottom }}
      aria-label="奶牛小宠物"
      data-life={lifeState}
      data-vitality={Math.round(vitality.vitality)}
    >
      {!collapsed && tipLines.length > 0 && (
        <aside className="cow-pet__tip" aria-live="polite">
          <div className="cow-pet__tip-title">
            {lifeState === 'dead' ? '哞呜…需要你的陪伴' : '加油，牛牛在醒啦'}
          </div>
          <ul className="cow-pet__tip-list">
            {tipLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </aside>
      )}
      <div className="cow-pet__stack">
        <div
          className={`cow-pet__bubble${bubbleVisible ? ' cow-pet__bubble--visible' : ''}`}
          role="status"
        >
          {bubbleText}
        </div>
        <div
          className="cow-pet__frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          title={
            collapsed
              ? '展开小宠物'
              : lifeState === 'dead' || lifeState === 'reviving'
                ? tipLines.join(' · ')
                : browsing
                  ? `点按浏览全部表情 ${safeIndex + 1}/${pool.length} · 双击折叠`
                  : '点击浏览全部表情 · 双击折叠 · 拖动移动'
          }
        >
          <img className="cow-pet__img" src={src} alt="" draggable={false} />
          {(lifeState === 'reviving' || (lifeState === 'dead' && reviveRatio > 0)) && (
            <div className="cow-pet__ring" aria-hidden>
              <svg className="cow-pet__ring-svg" viewBox="0 0 100 100">
                <circle className="cow-pet__ring-track" cx="50" cy="50" r={ringR} />
                <circle
                  className="cow-pet__ring-progress"
                  cx="50"
                  cy="50"
                  r={ringR}
                  strokeDasharray={ringC}
                  strokeDashoffset={ringOffset}
                />
              </svg>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              className="cow-pet__collapse"
              aria-label="折叠小宠物"
              onClick={(e) => {
                e.stopPropagation();
                persistCollapsed(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              −
            </button>
          )}
        </div>
        {!collapsed && (
          <div className="cow-pet__vitality">
            {lifeState === 'reviving' || lifeState === 'dead'
              ? `${Math.round(reviveRatio * 100)}%`
              : `HP ${Math.round(vitality.vitality)}`}
          </div>
        )}
      </div>
    </div>
  );
};

export default CowPet;
