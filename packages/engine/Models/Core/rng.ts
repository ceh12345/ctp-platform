/**
 * Seeded pseudo-random number generator.
 *
 * The optimization layer (ILS perturbation) previously called `Math.random()`
 * directly, which made two runs of the same technique on the same data return
 * different schedules. A comparison harness cannot attribute a KPI delta to a
 * technique when the technique's own run-to-run variance is unmeasured, so
 * every stochastic component takes an injectable `RandomSource` and callers
 * that need reproducibility pass a seeded one.
 *
 * `Math.random` remains the default so production behaviour is unchanged.
 */

/** A source of uniform random numbers in [0, 1). Signature-compatible with `Math.random`. */
export type RandomSource = () => number;

/**
 * mulberry32 — a 32-bit generator with a full 2^32 period, good statistical
 * quality for shuffling, and no dependencies. Chosen over an LCG because the
 * low bits of an LCG are notoriously non-random, and Fisher-Yates indexes off
 * exactly those bits.
 */
export function createSeededRandom(seed: number): RandomSource {
  // Coerce to a non-zero uint32 — a zero state produces a degenerate stream.
  let state = (seed >>> 0) || 0x9e3779b9;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The default source. Explicit so call sites read as a deliberate choice. */
export const defaultRandom: RandomSource = Math.random;
