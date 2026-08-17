/**
 * Safe, one-way signals into the cow-pet layer.
 * App / workstation code may call these; the pet never calls back into business flows.
 */

export const COW_PET_CREDITS_CONSUMED_EVENT = 'lobster:cow-pet:credits-consumed';

/** Notify pet that credits were spent (alive → feed; dead → revive progress). */
export function notifyCowPetCreditsConsumed(amount: number): void {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return;
  try {
    window.dispatchEvent(
      new CustomEvent(COW_PET_CREDITS_CONSUMED_EVENT, { detail: { amount: n } }),
    );
  } catch {
    /* ignore */
  }
}
