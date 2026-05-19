/**
 * bench-harness.ts — shared benchmark infrastructure for CODE-OPTIMIZATION-SPRINT
 *
 * One harness, copied/invoked per P0/P1 ticket. It enforces the sprint's
 * Definition of Done items 3, 4, 5 in code rather than in a commit message:
 *
 *   - CORRECTNESS GATE: refuses to emit a speedup number unless old and new
 *     produce deep-equal output. A fast wrong answer fails the run.
 *   - A/B IN ONE PROCESS: old and new impl benchmarked back-to-back on the
 *     SAME machine in the SAME run. Only the *ratio* is reported as the
 *     headline; absolute ms is informational (not portable across machines).
 *   - ROBUST STATISTIC: median + p95 from raw samples, never mean (GC pauses
 *     poison the mean; median is the real per-call cost).
 *   - WARM-UP: V8 JITs hot functions after a few hundred calls. Warm-up
 *     iterations are run and discarded so we measure optimized code, not
 *     the interpreter.
 *   - ALLOCATION DELTA: forced-GC heap delta over N iterations (requires
 *     running node with --expose-gc; reported as "n/a" otherwise).
 *   - COMMITTED ARTIFACT: writes benchmarks/results/<ticket>.json. THAT FILE
 *     is the artifact the ticket-close checklist wants — auditable, diffable.
 *
 * RUN:  node --expose-gc -r ts-node/register packages/engine/benchmarks/ticket-01.ts
 *       (--expose-gc optional but enables the allocation metric)
 *
 * tinybench is the only dependency: npm i -D tinybench
 */

import { Bench } from "tinybench";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

// ---------------------------------------------------------------------------
// Percentiles from raw samples. We compute these ourselves rather than trust a
// library's internal aggregation — median/p95 of the sample array is exactly
// the statistic we want and is library-version-independent.
// ---------------------------------------------------------------------------
function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ---------------------------------------------------------------------------
// Deep structural equality for correctness gating. Engine outputs are linked
// lists / nested objects; the per-ticket file is responsible for projecting
// each output into a comparable plain form (toArray()-style) before passing
// here, so this stays a simple structural compare with no engine knowledge.
// ---------------------------------------------------------------------------
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableNormalize(a)) === JSON.stringify(stableNormalize(b));
}
function stableNormalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stableNormalize);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce((acc, k) => {
        acc[k] = stableNormalize(o[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Forced-GC heap delta. Only meaningful with --expose-gc. Single-shot
// memoryUsage() deltas are noise; this runs N iterations between two forced
// collections and reports the delta. Still approximate — treat as an
// order-of-magnitude signal, not a precise byte count.
// ---------------------------------------------------------------------------
function heapDeltaBytes(fn: () => unknown, iterations: number): number | null {
  const gc = (global as unknown as { gc?: () => void }).gc;
  if (typeof gc !== "function") return null;
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < iterations; i++) fn();
  gc();
  const after = process.memoryUsage().heapUsed;
  return after - before;
}

export interface TicketBenchConfig<T> {
  /** e.g. "ticket-01" — used for the results filename */
  ticketId: string;
  /** Human label for the console header */
  description: string;
  /**
   * Build the fixed input ONCE. Returned value is reused for every old/new
   * iteration and for both impls. MUST be deterministic and identical across
   * old and new — the comparison is meaningless otherwise. If the impl mutates
   * its input, return a factory that clones instead (see makeMutableFixture).
   */
  fixtureLabel: string;
  /** Old implementation. Returns a value projected to comparable plain form. */
  oldImpl: () => T;
  /** New implementation (the ticket's change). Same projected form. */
  newImpl: () => T;
  /** Acceptance threshold from the sprint, e.g. 5 for "≥5X". */
  minSpeedup: number;
  /** tinybench tuning. Defaults match the sprint's needs. */
  warmupIterations?: number;
  iterations?: number;
}

export interface TicketBenchResult {
  ticketId: string;
  description: string;
  fixture: string;
  timestamp: string;
  node: string;
  correctness: "PASS" | "FAIL";
  old: { medianMs: number; p95Ms: number; minMs: number; heapDeltaBytes: number | null };
  new: { medianMs: number; p95Ms: number; minMs: number; heapDeltaBytes: number | null };
  speedup: number;
  minSpeedupRequired: number;
  acceptancePass: boolean;
}

/**
 * Run one ticket's before/after benchmark. Throws (non-zero exit) on a
 * correctness failure so a bad change can never silently produce a green
 * benchmark. Writes the JSON artifact regardless of pass/fail so failures
 * are inspectable.
 */
export async function runTicketBench<T>(
  cfg: TicketBenchConfig<T>,
): Promise<TicketBenchResult> {
  const warmupIterations = cfg.warmupIterations ?? 100;
  const iterations = cfg.iterations ?? 1000;

  // ---- CORRECTNESS GATE (runs before any timing) -------------------------
  const oldOut = cfg.oldImpl();
  const newOut = cfg.newImpl();
  const correct = deepEqual(oldOut, newOut);

  console.log(`\n=== ${cfg.ticketId} — ${cfg.description} ===`);
  console.log(`fixture: ${cfg.fixtureLabel}`);
  console.log(`correctness: ${correct ? "PASS" : "FAIL"}`);

  if (!correct) {
    // Still write an artifact so the failure is on record, then hard-fail.
    const failResult: TicketBenchResult = {
      ticketId: cfg.ticketId,
      description: cfg.description,
      fixture: cfg.fixtureLabel,
      timestamp: new Date().toISOString(),
      node: process.version,
      correctness: "FAIL",
      old: { medianMs: NaN, p95Ms: NaN, minMs: NaN, heapDeltaBytes: null },
      new: { medianMs: NaN, p95Ms: NaN, minMs: NaN, heapDeltaBytes: null },
      speedup: NaN,
      minSpeedupRequired: cfg.minSpeedup,
      acceptancePass: false,
    };
    writeResult(cfg.ticketId, failResult);
    throw new Error(
      `${cfg.ticketId}: CORRECTNESS FAIL — old and new outputs differ. ` +
        `Benchmark aborted. Fix the change before measuring speed.`,
    );
  }

  // ---- TIMING (warm-up handled by tinybench) -----------------------------
  const bench = new Bench({ warmupIterations, iterations });
  bench.add("old", () => {
    cfg.oldImpl();
  });
  bench.add("new", () => {
    cfg.newImpl();
  });
  await bench.run();

  const byName = (n: string) => bench.tasks.find((t) => t.name === n)!.result!;
  const oldSamples = byName("old").samples as number[];
  const newSamples = byName("new").samples as number[];

  const oldMedian = percentile(oldSamples, 50);
  const newMedian = percentile(newSamples, 50);
  const speedup = oldMedian / newMedian;

  // ---- ALLOCATION DELTA --------------------------------------------------
  const allocIters = Math.min(iterations, 1000);
  const oldHeap = heapDeltaBytes(cfg.oldImpl, allocIters);
  const newHeap = heapDeltaBytes(cfg.newImpl, allocIters);

  const result: TicketBenchResult = {
    ticketId: cfg.ticketId,
    description: cfg.description,
    fixture: cfg.fixtureLabel,
    timestamp: new Date().toISOString(),
    node: process.version,
    correctness: "PASS",
    old: {
      medianMs: round(oldMedian),
      p95Ms: round(percentile(oldSamples, 95)),
      minMs: round(byName("old").min),
      heapDeltaBytes: oldHeap,
    },
    new: {
      medianMs: round(newMedian),
      p95Ms: round(percentile(newSamples, 95)),
      minMs: round(byName("new").min),
      heapDeltaBytes: newHeap,
    },
    speedup: round(speedup),
    minSpeedupRequired: cfg.minSpeedup,
    acceptancePass: speedup >= cfg.minSpeedup,
  };

  console.log(
    `old: median ${result.old.medianMs}ms  p95 ${result.old.p95Ms}ms` +
      (oldHeap != null ? `  heap +${fmtBytes(oldHeap)}` : ""),
  );
  console.log(
    `new: median ${result.new.medianMs}ms  p95 ${result.new.p95Ms}ms` +
      (newHeap != null ? `  heap +${fmtBytes(newHeap)}` : ""),
  );
  console.log(
    `speedup x${result.speedup}  (acceptance: >= x${cfg.minSpeedup} → ` +
      `${result.acceptancePass ? "PASS" : "FAIL"})`,
  );
  if (oldHeap == null) {
    console.log("note: allocation metric n/a — re-run with `node --expose-gc`");
  }

  writeResult(cfg.ticketId, result);
  return result;
}

function round(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(5)) : n;
}
function fmtBytes(b: number): string {
  return Math.abs(b) > 1024 * 1024
    ? `${(b / 1024 / 1024).toFixed(2)}MB`
    : `${(b / 1024).toFixed(1)}KB`;
}

function writeResult(ticketId: string, r: TicketBenchResult): void {
  const out = join(
    __dirname,
    "results",
    `${ticketId}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(`artifact: ${out}`);
}

/**
 * Helper for impls that MUTATE their input (most engine methods do — they
 * accumulate into a CTPIntervals list, mutate a matrix, etc). You CANNOT
 * reuse one frozen fixture across iterations in that case: the first
 * iteration would dirty it and every subsequent one measures different work.
 *
 * Pass a `build()` that constructs a fresh, deterministic input. The cost of
 * build() is paid inside every timed iteration — so keep build() cheap
 * relative to the method under test, OR (better) move the expensive setup
 * into a module-level constant and have build() only clone the small mutable
 * shell. The per-ticket file decides which; this is just the contract.
 */
export function makeMutableFixture<I, T>(
  build: () => I,
  run: (input: I) => T,
): () => T {
  return () => run(build());
}
