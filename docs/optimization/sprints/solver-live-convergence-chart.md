# Solver Live Convergence Chart

**Sprint:** Optimization Scheduler
**New files:**
- `packages/web/src/admin/OptimizeLivePage.tsx` (or new route in `App.tsx`)

**Modifies:**
- `packages/engine/AI/Optimization/tabusearch.ts` — emit per-iteration samples via callback
- `packages/engine/AI/Optimization/types.ts` — add `IterationSample`, extend `TabuConfig` with `onSample`
- `ctp/optimize.service.ts` — accumulate samples into `job.progress.samples`
- `ctp/optimize.controller.ts` — return samples on poll, support `?since=N` for incremental fetch

**Effort:** ~3–4h
**Depends on:** Session 5 (OptimizeService + controller)

---

## What This Session Does

Adds a standalone admin page that runs an ILS optimization live and renders a smoother convergence curve as it progresses — not just one point per pass (5 points total) but per-iteration samples (hundreds of points). The page polls the existing job endpoint, no SSE/WebSocket required.

The "known schedule" is `result.originalMakespan` drawn as a horizontal baseline; pass boundaries appear as vertical dashed lines so the planner can see the perturbation kick at the start of each pass and the convergence that follows.

Use case: planner watches a run live to build intuition for whether more passes / longer budget is worth it on this dataset.

---

## Design

### Sample shape

```typescript
interface IterationSample {
  pass: number;              // 1-indexed, matches OptimizationResult.passes[].pass
  iteration: number;         // within this pass
  cumulativeIteration: number;  // monotonic across passes — natural X axis
  makespan: number;          // current solution makespan at this iteration
  bestSoFar: number;         // global best across all passes so far
  isNewBest: boolean;        // true when this sample IS the new global best
  elapsedMs: number;         // since job start
}
```

`bestSoFar` is included so the chart can render two series (current + best-so-far envelope) without the client having to recompute.

### Sampling policy (in `tabuSearch`)

Naive "record every iteration" produces 10k+ samples for a 5-pass / 2000-iter run — too much to send on every poll. Sample selectively:

- **Always record** when `currentMakespan < bestMakespan` (new global best — the meaningful events).
- **Heartbeat** every `sampleEveryN` iterations (default 25) so the chart still moves during stagnation periods.
- **First and last iteration of every pass** always recorded (so pass boundaries are visible).

Expected samples per run: 200–500. Cheap to send.

---

## File 1: `tabusearch.ts` change

Add an optional `onSample` callback to `TabuConfig`. The tabu loop calls it from inside the iteration body, after the move is applied and the critical path recomputed.

### `types.ts` additions

```typescript
export interface IterationSample {
  pass: number;
  iteration: number;
  cumulativeIteration: number;
  makespan: number;
  bestSoFar: number;
  isNewBest: boolean;
  elapsedMs: number;
}

export interface TabuConfig {
  // ... existing fields ...

  /** Optional sampling callback. If set, called per the rules above. */
  onSample?: (sample: Omit<IterationSample, 'pass' | 'cumulativeIteration'>) => void;

  /** Heartbeat interval — emit a sample every N iterations even without improvement. Default 25. */
  sampleEveryN?: number;
}
```

`pass` and `cumulativeIteration` are added by the *caller* (OptimizeService), since `tabuSearch` is pass-agnostic. The callback receives `iteration` (within-pass) and the OptimizeService maps it.

### Loop change in `tabuSearch` (tabusearch.ts:254)

After the move is applied and `noImproveCount` updated, add:

```typescript
const isNewBest = currentMakespan < bestMakespan;  // captured BEFORE bestMakespan is updated above
const heartbeat = config.sampleEveryN ?? 25;
const isFirst = iter === 0;
const isHeartbeat = (iter % heartbeat) === 0;

if (config.onSample && (isNewBest || isHeartbeat || isFirst)) {
  config.onSample({
    iteration: iter,
    makespan: currentMakespan,
    bestSoFar: bestMakespan,
    isNewBest,
    elapsedMs: Date.now() - startMs,
  });
}
```

(Order matters: capture `isNewBest` *before* the existing `bestMakespan = currentMakespan` line; the existing block already handles the assignment.)

Also emit one final sample after the loop exits with the final iteration index, so the curve closes at the actual stopping point regardless of heartbeat alignment.

**No behavioral change when `onSample` is unset.** All existing callers (sync Best-tier solve, ILSScheduler) continue to work.

---

## File 2: `optimize.service.ts` change

### Extend `OptimizeJobProgress`

```typescript
export interface OptimizeJobProgress {
  // ... existing fields ...
  samples: IterationSample[];  // append-only; bounded — see policy below
}
```

### Wire the callback in `executeJob` (optimize.service.ts:204)

Before the pass loop:

```typescript
job.progress = {
  currentPass: 0,
  totalPasses,
  bestMakespanSoFar: originalMakespan,
  improvementPercent: 0,
  elapsedSeconds: 0,
  samples: [],
};

let cumulativeIter = 0;
```

Inside the pass loop, before calling `tabuSearch(working, tabuConfig, ...)`:

```typescript
const passNumber = pass + 1;

tabuConfig.onSample = (s) => {
  job.progress!.samples.push({
    ...s,
    pass: passNumber,
    cumulativeIteration: cumulativeIter + s.iteration,
  });

  // Bounded buffer — drop oldest non-best samples if we exceed cap.
  // Always keep isNewBest samples (they're the convergence story).
  const MAX_SAMPLES = 1000;
  if (job.progress!.samples.length > MAX_SAMPLES) {
    job.progress!.samples = job.progress!.samples.filter(
      (x, i, arr) => x.isNewBest || i >= arr.length - (MAX_SAMPLES / 2),
    );
  }
};
```

After the call, advance the cumulative counter:

```typescript
cumulativeIter += result.totalIterations;
```

**Event-loop yielding.** The existing `await this.yieldToEventLoop()` runs *between* passes. With per-iteration sampling, the inside-pass loop still blocks the event loop, so polls during a pass return the *previous* pass's data. Acceptable for v1 (page polls every 1s, blocked window is the per-pass budget = ~30–60s — but the chart catches up at the next pass boundary). If smoother is needed: have `tabuSearch` await a yield every K iterations behind a flag — see "Future" below.

---

## File 3: `optimize.controller.ts` change

### `StartOptimizeDto` additions

Expose the existing tabu/sampling knobs that are currently hardcoded or read from settings:

```typescript
export class StartOptimizeDto {
  // ── Existing ──
  timeBudgetSeconds?: number;     // default 300
  passes?: number;                // default 5
  perturbStrength?: number;       // default 0.07
  freezeHorizon?: string;         // ISO datetime, optional

  // ── New ──
  maxIterations?: number;         // per pass; default settings.tabuIterations ?? 2000
  stagnationLimit?: number;       // per pass; default settings.tabuStagnation ?? 300
  sampleEveryN?: number;          // chart heartbeat; default 25
}
```

`OptimizeJobConfig` (in `optimize.service.ts`) gains the same three fields. In `executeJob`, the existing `tabuConfig` build picks them up:

```typescript
const tabuConfig: TabuConfig = {
  tenure: Math.min(25, Math.max(10, Math.floor(Math.sqrt(taskCount)))),
  maxIterations: job.config.maxIterations ?? settings.tabuIterations ?? 2000,
  stagnationLimit: job.config.stagnationLimit ?? settings.tabuStagnation ?? 300,
  timeBudgetMs: 0,
  freezeHorizon,
  sampleEveryN: job.config.sampleEveryN ?? 25,
};
```

`tenure` stays auto-derived — it's a solver-research knob, not a planner knob.

### `GET /v1/ctp/optimize/:jobId?since=<cumulativeIteration>`

Add an optional `since` query param. When set, return only samples with `cumulativeIteration > since`. The page sends `since = lastSeenCumulativeIteration` so each poll only ships new points, not the whole buffer.

```typescript
@Get(':jobId')
getJobStatus(
  @Param('jobId') jobId: string,
  @Query('since') since?: string,
): JobStatusResponse {
  // ... existing lookup ...

  if (job.progress) {
    const sinceN = since ? parseInt(since, 10) : -1;
    response.progress = {
      ...job.progress,
      samples: Number.isFinite(sinceN)
        ? job.progress.samples.filter(s => s.cumulativeIteration > sinceN)
        : job.progress.samples,
    };
  }
  // ... rest unchanged ...
}
```

The `JobStatusResponse.progress` interface gains `samples: IterationSample[]`.

---

## File 4: Admin page `OptimizeLivePage.tsx`

Single React component. Lives at `/admin/optimize-live` in the web app routing. Add a left-nav link under the existing Admin section.

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│ Live Optimization                                              │
├────────────────────────────────────────────────────────────────┤
│ Preset: [ Default ▾ ]  (Quick / Default / Aggressive / Custom) │
│                                                                │
│ Config:                                                        │
│   Passes:          [5    ]   Time budget (s): [300 ]           │
│   Max iterations:  [2000 ]   Stagnation limit: [300 ]          │
│   Perturb strength:[0.07 ]   Sample every N:   [25  ]          │
│   Freeze horizon:  [ 2026-04-22  ▾ ]  (optional)               │
│                                                                │
│   [ Start Run ]   Status: running — pass 2/5 — 47s elapsed     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  makespan                                               │  │
│   │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  ← baseline (originalMakespan) │  │
│   │  ▓▓▓▓▓▓▓▓▓▓                                            │  │
│   │       ▓▓▓▓▓▓▓▓▓                                         │  │
│   │             ╲▓▓▓▓▓▓▓▓                                  │  │
│   │              │ ╲▓▓▓▓▓▓▓                                │  │
│   │              │      ╲▓▓▓▓▓                            │  │
│   │              ↑                                          │  │
│   │           pass 2                                        │  │
│   │                              cumulative iteration       │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                │
│   Best so far: 14:32 (-12.4%)    Iterations: 847              │
│                                                                │
│   [ Accept ]  [ Reject ]  (enabled when status === complete)   │
└────────────────────────────────────────────────────────────────┘
```

### State & polling

```typescript
const [jobId, setJobId] = useState<string | null>(null);
const [status, setStatus] = useState<JobStatus>('idle');
const [samples, setSamples] = useState<IterationSample[]>([]);
const [progress, setProgress] = useState<OptimizeJobProgress | null>(null);
const [result, setResult] = useState<OptimizationResult | null>(null);
const [originalMakespan, setOriginalMakespan] = useState<number | null>(null);

// Poll loop
useEffect(() => {
  if (!jobId || status === 'complete' || status === 'failed') return;

  const lastSeen = samples.length > 0
    ? samples[samples.length - 1].cumulativeIteration
    : -1;

  const interval = setInterval(async () => {
    const res = await fetch(`/v1/ctp/optimize/${jobId}?since=${lastSeen}`);
    const data = await res.json();

    setStatus(data.status);
    setProgress(data.progress);

    if (data.progress?.samples?.length) {
      setSamples(prev => [...prev, ...data.progress.samples]);
    }

    if (data.status === 'complete') {
      setResult(data.result);
      setOriginalMakespan(data.result.originalMakespan);
    }
  }, 1000);

  return () => clearInterval(interval);
}, [jobId, status, samples]);
```

### Chart

Use Recharts (already in the bundle? check first — if not, hand-rolled SVG works for ~500 points). Two `<Line>` series:

1. **Current** — `samples.map(s => ({ x: s.cumulativeIteration, y: s.makespan }))` — light gray, thin
2. **Best so far** — `samples.map(s => ({ x: s.cumulativeIteration, y: s.bestSoFar }))` — solid blue, thicker

Plus:
- Horizontal `<ReferenceLine>` at `originalMakespan` — dashed, labeled "Baseline"
- Vertical `<ReferenceLine>` at each pass boundary — dashed, labeled "Pass 2", "Pass 3", etc. Boundaries derived from samples: where `s.pass !== prev.pass`.

X axis label: "Cumulative iteration". Tooltip on hover shows `(pass N, iter M, makespan = X, +/- Y%)`.

### Config form & presets

Seven inputs total, mapped 1:1 to `StartOptimizeDto` fields above. All numerics validated client-side (positive integers; perturb in [0, 1]; sampleEveryN ≥ 1).

The **Preset** dropdown fills the numeric fields and locks them (Custom unlocks). Presets:

| Preset      | passes | timeBudget | maxIter | stagnation | perturb | sampleEveryN |
|-------------|--------|------------|---------|------------|---------|--------------|
| Quick       | 1      | 30         | 500     | 100        | 0.07    | 10           |
| Default     | 5      | 300        | 2000    | 300        | 0.07    | 25           |
| Aggressive  | 10     | 1800       | 5000    | 500        | 0.10    | 50           |
| Custom      | (user) | (user)     | (user)  | (user)     | (user)  | (user)       |

`freezeHorizon` is always editable, independent of preset (it's a tenant/calendar concern, not a solver-tuning concern).

Most planners pick a preset and click Start. Custom is an escape hatch for the curious.

### Buttons

- **Start Run** — POST `/v1/ctp/optimize` with form values, capture `jobId`, reset `samples = []`, `status = 'queued'`.
- **Accept** — POST `/v1/ctp/optimize/:jobId/accept`. Disabled unless `status === 'complete'` and `result.improvementPercent > 0`.
- **Reject** — POST `/v1/ctp/optimize/:jobId/reject`. Disabled unless `status === 'complete'`.

Both buttons reset the page state on success (clear samples, jobId, result).

---

## Behavioral Notes

**Why no SSE/WebSocket.** Polling is simpler, the buffered `since=N` mode is cheap (a few KB per poll), and there's no infrastructure change required. SSE would be marginally smoother but adds a long-lived connection per planner.

**The page reads the live tenant landscape** — same tenant resolution as the rest of the optimize endpoints. No multi-tenant chart overlay in v1.

**Accept/Reject scope.** The page IS the planner UI for this run — accepting from the live page commits to the live landscape exactly as the existing endpoints do. There's no preview-on-Gantt step. If that's wanted later it's a separate sprint.

**No persistence.** When the page closes mid-run, the run keeps going (server-side job survives), but the chart is lost. Reopening the page with the same jobId would replay the buffer (`?since=-1`) — could be a future "resume" feature, not v1.

**Sampling skew.** Heartbeat-only samples during a stagnation plateau make the curve look flat even when the algorithm is doing useful exploration. That's accurate — the makespan really isn't moving — but worth flagging in the chart legend ("flat = stagnation, not idle").

---

## Tests

1. **Engine: `tabuSearch` emits samples.** Run with `onSample: (s) => collected.push(s)` on a 100-task graph. Verify ≥1 sample per new best, ≥1 sample every `sampleEveryN` iterations, and a final sample at loop exit.

2. **Engine: no callback = no behavior change.** Run `tabuSearch` without `onSample`. Verify identical `bestMakespan` and `totalIterations` to before this change (regression test against a fixed seed).

3. **Service: samples accumulate in progress.** Start a job. Poll `/v1/ctp/optimize/:jobId` repeatedly while running. Verify `progress.samples` grows monotonically and `cumulativeIteration` is strictly increasing.

4. **Controller: `since` filter works.** Start a job, wait for ~50 samples. GET with `?since=10`. Verify all returned samples have `cumulativeIteration > 10`.

5. **Service: bounded buffer.** Force a long run (high iteration count). Verify `progress.samples.length <= 1000` and that all `isNewBest === true` samples are retained even after the cap kicks in.

6. **Page: chart renders during run.** Start a run from the page. Verify the chart appears within ~2s and grows over time. Verify pass-boundary vertical lines appear when pass changes.

7. **Page: baseline reference line.** Verify the horizontal baseline equals `originalMakespan` and stays fixed as the chart updates.

8. **Page: accept commits.** Run to completion, click Accept. Verify the live tenant's makespan now matches `optimizedMakespan` (re-solve and compare).

9. **Page: reject discards.** Run to completion, click Reject. Verify the live tenant's makespan is unchanged from before the run.

---

## Future (out of scope for this sprint)

- **Per-K iteration event-loop yields** so polls can land mid-pass (smoother live updates). Behind a flag because yields cost a small amount of throughput.
- **Multi-run overlay** — store the last N runs' sample arrays in memory and let the page toggle them on the same chart to compare configs. Requires server-side run history (the part you said you don't need yet).
- **Move-type breakdown** — color segments by which Taillard move type produced the new best (block_first / block_last / internal). Diagnostic for tuning the neighborhood.
- **Resource-utilization side panel** — show, per resource, how loaded it is at the current best. Helps explain *why* a plateau is happening.
