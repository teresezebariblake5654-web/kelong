/**
 * Cow pet vitality / starve / credit-revive (local phase-1).
 *
 * Tuning knobs (验收时可改这些常量):
 * - DECAY_FULL_DAYS: 完全不用约几天饿死
 * - HUNGRY_BELOW: 低于此显示「好饿」
 * - REVIVE_FLOOR_CREDITS: 复活费用下限（死亡时余额×10% 与此取 max）
 * - FOREGROUND_MIN_MS: 前台停留多久算一次有效打开
 * - LIGHT_FEED_PER_HOUR: 挂机轻喂每次 + 多少活力
 * - OFFLINE_REVIVE_SESSIONS: 未登录时靠完成会话复活所需次数（刻意偏难，避免聊几句就满血）
 *
 * 本地模拟验收：
 * 1) DevTools → Application → Local Storage → 改 `cowPet.vitality`
 *    把 lastFedAt 设为 Date.now()-5*86400000，刷新后应 dead
 * 2) 死亡后打 Agent / 产生积分扣费，应进入 reviving 并见进度
 * 3) reviveProgress >= reviveCost 或 offlineSessionProgress >= OFFLINE_REVIVE_SESSIONS → 复活
 */

export const DECAY_FULL_DAYS = 1;
export const HUNGRY_BELOW = 30;
export const REVIVE_FLOOR_CREDITS = 300;
export const FOREGROUND_MIN_MS = 30_000;
export const LIGHT_FEED_PER_HOUR = 10;
/** Offline/no-spend revive: need this many completed Agent turns (not “聊三句”). */
export const OFFLINE_REVIVE_SESSIONS = 12;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
/** Vitality lost per full idle day (100 / DECAY_FULL_DAYS). */
export const DECAY_PER_DAY = 100 / DECAY_FULL_DAYS;
export const JUST_REVIVED_MS = 8000;

/** Namespaced so pet storage never collides with app/session keys. */
export const PET_VITALITY_STORAGE_KEY = 'lobster.cowPet.vitality';
const PET_VITALITY_STORAGE_KEY_LEGACY = 'cowPet.vitality';

export type PetLifeState = 'alive' | 'hungry' | 'dead' | 'reviving';
export type FeedReason = 'foreground' | 'agent' | 'credits' | 'light';

export type PetVitalityState = {
  vitality: number;
  lastFedAt: number;
  lastDecayAt: number;
  lastLightFeedAt: number;
  foregroundSince: number | null;
  deadAt: number | null;
  balanceAtDeath: number | null;
  reviveCost: number;
  reviveProgress: number;
  offlineSessionProgress: number;
  lastKnownBalance: number | null;
  justRevivedUntil: number;
};

export function createDefaultVitalityState(now = Date.now()): PetVitalityState {
  return {
    vitality: 100,
    lastFedAt: now,
    lastDecayAt: now,
    lastLightFeedAt: 0,
    foregroundSince: null,
    deadAt: null,
    balanceAtDeath: null,
    reviveCost: REVIVE_FLOOR_CREDITS,
    reviveProgress: 0,
    offlineSessionProgress: 0,
    lastKnownBalance: null,
    justRevivedUntil: 0,
  };
}

/** Demo: force starved / dead look (灰阶 +「葬送了…」). */
export function demoForceStarve(
  state: PetVitalityState,
  now = Date.now(),
): PetVitalityState {
  const balance = state.lastKnownBalance ?? 1000;
  return {
    ...state,
    vitality: 0,
    lastFedAt: now - DECAY_FULL_DAYS * DAY_MS - DAY_MS,
    lastDecayAt: now,
    foregroundSince: null,
    deadAt: now,
    balanceAtDeath: balance,
    reviveCost: computeReviveCost(balance),
    reviveProgress: 0,
    offlineSessionProgress: 0,
    justRevivedUntil: 0,
  };
}

/** Demo: mid-revive with progress ring (~40%). */
export function demoForceReviving(
  state: PetVitalityState,
  now = Date.now(),
): PetVitalityState {
  const dead = state.vitality <= 0 ? state : demoForceStarve(state, now);
  const cost = Math.max(REVIVE_FLOOR_CREDITS, dead.reviveCost || REVIVE_FLOOR_CREDITS);
  return {
    ...dead,
    reviveProgress: Math.max(1, Math.floor(cost * 0.4)),
    offlineSessionProgress: 0,
  };
}

/** Demo: full revive / healthy. */
export function demoForceRevive(
  state: PetVitalityState,
  now = Date.now(),
): PetVitalityState {
  return {
    ...state,
    vitality: 100,
    lastFedAt: now,
    lastDecayAt: now,
    foregroundSince: null,
    deadAt: null,
    balanceAtDeath: null,
    reviveCost: REVIVE_FLOOR_CREDITS,
    reviveProgress: 0,
    offlineSessionProgress: 0,
    justRevivedUntil: now + JUST_REVIVED_MS,
  };
}

/** One-shot flag consumed by CowPet after code reload (use queueUiDemo / Ctrl+Alt+Shift+D). */
let pendingUiDemo: 'starve' | 'reviving' | 'revive' | null = null;

export function consumePendingUiDemo(): 'starve' | 'reviving' | 'revive' | null {
  const next = pendingUiDemo;
  pendingUiDemo = null;
  return next;
}

export function queueUiDemo(kind: 'starve' | 'reviving' | 'revive'): void {
  pendingUiDemo = kind;
}

function clampVitality(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function computeReviveCost(balanceAtDeath: number | null | undefined): number {
  const bal = typeof balanceAtDeath === 'number' && Number.isFinite(balanceAtDeath)
    ? Math.max(0, balanceAtDeath)
    : 0;
  return Math.max(REVIVE_FLOOR_CREDITS, Math.floor(bal * 0.1));
}

export function resolveLifeState(state: PetVitalityState): PetLifeState {
  if (state.vitality <= 0) {
    if (state.reviveProgress > 0 || state.offlineSessionProgress > 0) {
      return 'reviving';
    }
    return 'dead';
  }
  if (state.vitality < HUNGRY_BELOW) return 'hungry';
  return 'alive';
}

export function reviveProgressRatio(state: PetVitalityState): number {
  if (state.vitality > 0) return 0;
  // Credit path only once real spend landed — do NOT treat balanceAtDeath alone
  // as "on credit path", or offline session progress stays stuck at 0% in the UI.
  if (state.reviveProgress > 0) {
    const cost = Math.max(1, state.reviveCost || REVIVE_FLOOR_CREDITS);
    return Math.min(1, state.reviveProgress / cost);
  }
  return Math.min(1, state.offlineSessionProgress / OFFLINE_REVIVE_SESSIONS);
}

export function loadVitalityState(): PetVitalityState {
  try {
    let raw = localStorage.getItem(PET_VITALITY_STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(PET_VITALITY_STORAGE_KEY_LEGACY);
      if (raw) {
        try {
          localStorage.setItem(PET_VITALITY_STORAGE_KEY, raw);
          localStorage.removeItem(PET_VITALITY_STORAGE_KEY_LEGACY);
        } catch {
          /* ignore */
        }
      }
    }
    if (!raw) return createDefaultVitalityState();
    const parsed = JSON.parse(raw) as Partial<PetVitalityState>;
    const base = createDefaultVitalityState();
    return {
      ...base,
      ...parsed,
      vitality: clampVitality(Number(parsed.vitality ?? base.vitality)),
      lastFedAt: Number(parsed.lastFedAt ?? base.lastFedAt),
      lastDecayAt: Number(parsed.lastDecayAt ?? parsed.lastFedAt ?? base.lastDecayAt),
      lastLightFeedAt: Number(parsed.lastLightFeedAt ?? 0),
      foregroundSince:
        parsed.foregroundSince == null ? null : Number(parsed.foregroundSince),
      deadAt: parsed.deadAt == null ? null : Number(parsed.deadAt),
      balanceAtDeath:
        parsed.balanceAtDeath == null ? null : Number(parsed.balanceAtDeath),
      reviveCost: Math.max(
        REVIVE_FLOOR_CREDITS,
        Number(parsed.reviveCost ?? REVIVE_FLOOR_CREDITS),
      ),
      reviveProgress: Math.max(0, Number(parsed.reviveProgress ?? 0)),
      offlineSessionProgress: Math.max(0, Number(parsed.offlineSessionProgress ?? 0)),
      lastKnownBalance:
        parsed.lastKnownBalance == null ? null : Number(parsed.lastKnownBalance),
      justRevivedUntil: Number(parsed.justRevivedUntil ?? 0),
    };
  } catch {
    return createDefaultVitalityState();
  }
}

export function saveVitalityState(state: PetVitalityState): void {
  try {
    localStorage.setItem(PET_VITALITY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

function maybeEnterDeath(state: PetVitalityState, now: number): PetVitalityState {
  if (state.vitality > 0 || state.deadAt != null) return state;
  return {
    ...state,
    vitality: 0,
    deadAt: now,
    balanceAtDeath: state.balanceAtDeath,
    reviveCost: computeReviveCost(state.balanceAtDeath ?? state.lastKnownBalance),
    reviveProgress: 0,
    offlineSessionProgress: 0,
  };
}

function maybeFinishRevive(state: PetVitalityState, now: number): PetVitalityState {
  if (state.vitality > 0) return state;
  const creditDone = state.reviveProgress >= Math.max(1, state.reviveCost);
  const offlineDone = state.offlineSessionProgress >= OFFLINE_REVIVE_SESSIONS;
  if (!creditDone && !offlineDone) return state;
  return {
    ...state,
    vitality: 100,
    lastFedAt: now,
    lastDecayAt: now,
    deadAt: null,
    balanceAtDeath: null,
    reviveCost: REVIVE_FLOOR_CREDITS,
    reviveProgress: 0,
    offlineSessionProgress: 0,
    justRevivedUntil: now + JUST_REVIVED_MS,
  };
}

/** Apply time-based decay. Call on interval / visibility. */
export function tickVitality(
  state: PetVitalityState,
  now = Date.now(),
  options?: { skipDecay?: boolean },
): PetVitalityState {
  if (state.vitality <= 0) {
    return maybeFinishRevive(state, now);
  }
  if (options?.skipDecay) {
    return state;
  }
  const elapsed = Math.max(0, now - state.lastDecayAt);
  if (elapsed < 60_000) return state; // skip sub-minute noise
  const lost = (elapsed / DAY_MS) * DECAY_PER_DAY;
  const nextVitality = clampVitality(state.vitality - lost);
  let next: PetVitalityState = {
    ...state,
    vitality: nextVitality,
    lastDecayAt: now,
  };
  if (nextVitality <= 0) {
    next = maybeEnterDeath({ ...next, vitality: 0 }, now);
  }
  return next;
}

export function feedVitality(
  state: PetVitalityState,
  reason: FeedReason,
  now = Date.now(),
): PetVitalityState {
  // Dead pets cannot be fed back to life without revive progress
  if (state.vitality <= 0 && reason !== 'credits') {
    return state;
  }
  if (reason === 'light') {
    if (state.vitality <= 0) return state;
    if (now - state.lastLightFeedAt < HOUR_MS) return state;
    const nextVitality = clampVitality(state.vitality + LIGHT_FEED_PER_HOUR);
    return {
      ...state,
      vitality: nextVitality,
      lastLightFeedAt: now,
      lastDecayAt: now,
    };
  }
  if (state.vitality <= 0) return state;
  return {
    ...state,
    vitality: 100,
    lastFedAt: now,
    lastDecayAt: now,
  };
}

/** Track foreground dwell; after FOREGROUND_MIN_MS apply a full feed once per visit. */
export function noteForeground(
  state: PetVitalityState,
  visible: boolean,
  now = Date.now(),
): PetVitalityState {
  if (!visible) {
    return { ...state, foregroundSince: null };
  }
  if (state.foregroundSince == null) {
    return { ...state, foregroundSince: now };
  }
  if (state.vitality <= 0) return state;
  if (now - state.foregroundSince < FOREGROUND_MIN_MS) return state;
  // Already fed after this visible stretch started
  if (state.lastFedAt >= state.foregroundSince) return state;
  return feedVitality(state, 'foreground', now);
}

export function onCreditsConsumed(
  state: PetVitalityState,
  amount: number,
  now = Date.now(),
): PetVitalityState {
  const spent = Math.max(0, amount);
  if (spent <= 0) return state;

  if (state.vitality > 0) {
    return feedVitality(state, 'credits', now);
  }

  let next: PetVitalityState = {
    ...state,
    reviveProgress: state.reviveProgress + spent,
  };
  if (next.reviveCost < REVIVE_FLOOR_CREDITS) {
    next = { ...next, reviveCost: computeReviveCost(next.balanceAtDeath) };
  }
  return maybeFinishRevive(next, now);
}

/** Completed Agent session while dead (offline revive path). */
export function onOfflineSessionCompleted(
  state: PetVitalityState,
  now = Date.now(),
): PetVitalityState {
  if (state.vitality > 0) {
    return feedVitality(state, 'agent', now);
  }
  const next: PetVitalityState = {
    ...state,
    offlineSessionProgress: state.offlineSessionProgress + 1,
  };
  return maybeFinishRevive(next, now);
}

export function applyBalanceSnapshot(
  state: PetVitalityState,
  balance: number,
  now = Date.now(),
): PetVitalityState {
  const bal = Math.max(0, balance);
  let next: PetVitalityState = { ...state, lastKnownBalance: bal };

  // Detect spend via balance drop
  if (state.lastKnownBalance != null && bal < state.lastKnownBalance) {
    const delta = state.lastKnownBalance - bal;
    next = onCreditsConsumed(next, delta, now);
  }

  // First death without balance: stamp cost when we learn balance
  if (next.vitality <= 0 && next.deadAt != null && next.balanceAtDeath == null) {
    next = {
      ...next,
      balanceAtDeath: bal,
      reviveCost: computeReviveCost(bal),
    };
  }

  return next;
}

export function stampDeathBalance(
  state: PetVitalityState,
  balance: number | null,
): PetVitalityState {
  if (state.vitality > 0 || state.deadAt == null) return state;
  if (state.balanceAtDeath != null) return state;
  const bal = balance == null ? null : Math.max(0, balance);
  return {
    ...state,
    balanceAtDeath: bal,
    reviveCost: computeReviveCost(bal ?? state.lastKnownBalance),
  };
}

/** Bubble / hint copy for life layer (overrides activity mood when relevant). */
export function lifeStateBubble(state: PetVitalityState, life: PetLifeState): string {
  if (life === 'dead') return '葬送了…谁来摸摸我';
  if (life === 'reviving') {
    const pct = Math.round(reviveProgressRatio(state) * 100);
    if (state.reviveProgress > 0) {
      return `眼睛亮了一点点 ${pct}%`;
    }
    return `正在爬起来… ${pct}%`;
  }
  if (life === 'hungry') return '好饿…摸我一下嘛';
  if (state.justRevivedUntil > Date.now()) return '哞的天！复活啦';
  return '';
}

/** Cute side tip teaching how to revive (shown next to the pet). */
export function reviveTipLines(state: PetVitalityState, life: PetLifeState): string[] {
  if (life === 'dead') {
    return [
      '小贴士：牛牛饿晕啦',
      '① 多跟 Agent 认真干活（不是聊两句）',
      '② 或正常使用、攒够积分能量',
      `③ 约 ${state.reviveCost || REVIVE_FLOOR_CREDITS} 积分能量可醒`,
      `没登录？要完成 ${OFFLINE_REVIVE_SESSIONS} 次对话才行～`,
    ];
  }
  if (life === 'reviving') {
    const pct = Math.round(reviveProgressRatio(state) * 100);
    if (state.reviveProgress > 0) {
      return [
        '还在使劲爬起来…',
        `能量 ${Math.floor(state.reviveProgress)} / ${state.reviveCost}`,
        `进度 ${pct}% · 继续用 App 攒能量`,
      ];
    }
    const left = Math.max(0, OFFLINE_REVIVE_SESSIONS - state.offlineSessionProgress);
    return [
      '对话在给牛牛充电…',
      `会话 ${state.offlineSessionProgress} / ${OFFLINE_REVIVE_SESSIONS}`,
      `进度 ${pct}% · 还差 ${left} 次对话`,
    ];
  }
  return [];
}
