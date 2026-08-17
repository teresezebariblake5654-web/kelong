import { describe, expect, it } from 'vitest';

import {
  DAY_MS,
  DECAY_FULL_DAYS,
  OFFLINE_REVIVE_SESSIONS,
  REVIVE_FLOOR_CREDITS,
  applyBalanceSnapshot,
  computeReviveCost,
  createDefaultVitalityState,
  feedVitality,
  onCreditsConsumed,
  onOfflineSessionCompleted,
  resolveLifeState,
  reviveProgressRatio,
  tickVitality,
} from './petVitality';

describe('petVitality', () => {
  it('computes revive cost as max(floor, 10% balance)', () => {
    expect(computeReviveCost(0)).toBe(REVIVE_FLOOR_CREDITS);
    expect(computeReviveCost(500)).toBe(REVIVE_FLOOR_CREDITS);
    expect(computeReviveCost(5000)).toBe(500);
  });

  it('decays to dead after enough idle days', () => {
    const now = 1_700_000_000_000;
    let state = createDefaultVitalityState(now);
    state = tickVitality(state, now + DECAY_FULL_DAYS * DAY_MS + DAY_MS);
    expect(state.vitality).toBe(0);
    expect(resolveLifeState(state)).toBe('dead');
    expect(state.deadAt).toBeTruthy();
  });

  it('full feed restores vitality when alive', () => {
    const now = 1_700_000_000_000;
    let state = createDefaultVitalityState(now);
    state = { ...state, vitality: 20, lastDecayAt: now };
    state = feedVitality(state, 'agent', now + 1000);
    expect(state.vitality).toBe(100);
    expect(resolveLifeState(state)).toBe('alive');
  });

  it('revives after enough credit spend while dead', () => {
    const now = 1_700_000_000_000;
    let state = createDefaultVitalityState(now);
    state = {
      ...state,
      vitality: 0,
      deadAt: now,
      balanceAtDeath: 2000,
      reviveCost: computeReviveCost(2000),
      reviveProgress: 0,
    };
    expect(resolveLifeState(state)).toBe('dead');
    expect(state.reviveCost).toBe(REVIVE_FLOOR_CREDITS);
    state = onCreditsConsumed(state, 100, now + 1);
    expect(resolveLifeState(state)).toBe('reviving');
    state = onCreditsConsumed(state, state.reviveCost - 100, now + 2);
    expect(state.vitality).toBe(100);
    expect(resolveLifeState(state)).toBe('alive');
  });

  it('revives via offline session completions', () => {
    const now = 1_700_000_000_000;
    let state = createDefaultVitalityState(now);
    state = {
      ...state,
      vitality: 0,
      deadAt: now,
      reviveCost: REVIVE_FLOOR_CREDITS,
      offlineSessionProgress: 0,
    };
    for (let i = 0; i < OFFLINE_REVIVE_SESSIONS; i += 1) {
      state = onOfflineSessionCompleted(state, now + i + 1);
    }
    expect(state.vitality).toBe(100);
  });

  it('offline revive % ignores balanceAtDeath until credits are spent', () => {
    const now = 1_700_000_000_000;
    const state = {
      ...createDefaultVitalityState(now),
      vitality: 0,
      deadAt: now,
      balanceAtDeath: 860,
      reviveCost: computeReviveCost(860),
      reviveProgress: 0,
      offlineSessionProgress: 4,
    };
    // Regression: previously stuck at 0% because balanceAtDeath forced credit path.
    expect(reviveProgressRatio(state)).toBeCloseTo(4 / OFFLINE_REVIVE_SESSIONS);
    expect(Math.round(reviveProgressRatio(state) * 100)).toBe(33);
  });

  it('detects credit spend from balance drops', () => {
    const now = 1_700_000_000_000;
    let state = createDefaultVitalityState(now);
    state = {
      ...state,
      vitality: 0,
      deadAt: now,
      balanceAtDeath: 5000,
      reviveCost: computeReviveCost(5000),
      reviveProgress: 0,
      lastKnownBalance: 5000,
    };
    expect(state.reviveCost).toBe(500);
    state = applyBalanceSnapshot(state, 4900, now + 1);
    expect(state.reviveProgress).toBe(100);
    expect(resolveLifeState(state)).toBe('reviving');
  });
});
