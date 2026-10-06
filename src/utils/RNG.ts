/** A source of randomness in [0, 1). Injected into every system that rolls dice, so tests can fake it. */
export type RNG = () => number;

/** Deterministic seeded generator (mulberry32). */
export function createRNG(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default for live play; tests pass their own. */
export const defaultRNG: RNG = () => Math.random();

/** Inclusive integer in [min, max]. */
export function randomInt(rng: RNG, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pickWeighted<T>(rng: RNG, entries: ReadonlyArray<{ item: T; weight: number }>): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry.item;
  }
  return entries[entries.length - 1]!.item;
}
