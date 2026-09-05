import type { Clock } from '../types.js';

export const systemClock: Clock = { now: () => new Date() };

/**
 * Deterministic clock. Runs driven by this clock produce byte-identical audit
 * ledgers, which is what makes CivicOS runs reproducible for auditors.
 */
export function fixedClock(startIso: string, stepMs = 1000): Clock {
  let t = new Date(startIso).getTime();
  return {
    now() {
      const d = new Date(t);
      t += stepMs;
      return d;
    },
  };
}
