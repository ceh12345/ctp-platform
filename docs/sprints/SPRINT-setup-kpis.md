# SPRINT: Setup / Teardown KPIs + Mislabel Fixes

| | |
|---|---|
| **Sprint** | `setup-kpis` |
| **Owner** | CC (implementation from this spec) |
| **Surface** | `analytics.service.ts` (`getScheduling()`, `getSummary()`), job-shop tenant `kpis.json` |
| **Commits** | Phase 1 (setup KPIs) → Phase 2 (mislabel renames) |
| **Status** | Ready |

---

## Why

The analytics layer currently **discards** SET_UP and TEAR_DOWN tasks before computing any scheduling metric (`getScheduling()`, the early-return at the top of the per-task loop). Setup is the signature HMLV cost driver, and right now it is invisible in the KPI surface. This sprint exposes setup as a diagnostic — **surface the issue, do not solve it**. The numbers will later inform whether solver work (setup objective term, lane-vs-batch trade) is worth building; that decision is downstream and out of scope here.

A secondary cleanup: two existing scheduling KPIs are mislabeled and will actively collide with the new setup metrics. "On-Time Starts" measures *window front-loading* (a plan-quality signal), not execution. "Avg Turnover" measures *idle gap between consecutive scheduled tasks* (white space), not changeover/setup time. Once real setup time is surfaced in Phase 1, leaving a metric called "turnover" that is actually idle gap is misleading. Phase 2 renames both.

---

## DO

- Stop discarding SET_UP / TEAR_DOWN tasks in `getScheduling()`; accumulate setup **count** and setup **seconds** separately from PROCESS totals.
- Surface **both** setup count and setup-to-run ratio. They are different KPIs (one long decontamination vs. one quick tool swap are both "1 setup," very different pain). Count without time hides cost; time without count hides frequency.
- Add two `IKPIDefinition` entries to the **job-shop** tenant `kpis.json` only (Stafford / demo-manufacturing). These are job-shop metrics — healthcare/sports tenants do not enable them, same per-tenant pattern as `scoring.json`.
- Tie thresholds into the existing `kpiThresholdMap` lookup in `getSummary()` so the new cards color like every other KPI.
- Sequence Phase 2 after Phase 1.

## DON'T

- **No solver changes.** No objective term, no changeover weight tuning, no lane interaction. This sprint is read-only analytics.
- **No lane metrics.** Lane-induced infeasibility, lane integrity, per-resource setup attribution — all deferred. Not in this sprint.
- **No per-resource / per-lane grouping** of setup KPIs yet. Shop-wide rollup only. (Grouping is the hook a future solver investigation would need; don't build it speculatively.)
- Don't bundle the Phase 2 renames into the Phase 1 commit. Keep "add setup KPIs" a clean, isolated deliverable.

---

## Phase 1 — Setup / Teardown KPIs (commit 1)

### 1a. `getScheduling()` — accumulate instead of discard

The per-task loop currently early-returns on SET_UP / TEAR_DOWN. Replace that with a branch:

- **If task is SET_UP or TEAR_DOWN and scheduled:** increment `setupCount`, add `task.scheduled.duration()` to `setupSeconds`, then `return` (do not count toward `totalTasks` / PROCESS metrics — preserves existing feasibility/on-time/turnover semantics exactly).
- **If task is SET_UP or TEAR_DOWN and not scheduled:** `return` as before (no change).
- **PROCESS branch (unchanged behavior) plus one addition:** inside the existing `isScheduled` block, accumulate `runSeconds += task.scheduled.duration()`.

This keeps every current PROCESS-based metric (feasibility, on-time, turnover) numerically identical — setup tasks are still excluded from those — while capturing setup as its own dimension.

### 1b. Extend the `getScheduling()` return

Add:

```
setup: {
  count: setupCount,
  seconds: setupSeconds,
  minutes: Math.round(setupSeconds / 60),
},
setupToRun: {
  setupSeconds,
  runSeconds,
  ratioPct: runSeconds > 0
    ? Math.round((setupSeconds / runSeconds) * 1000) / 10
    : 0,
},
```

### 1c. `getSummary()` — two new Scheduling KPI cards

In the scheduling KPI block, add alongside the existing entries:

- **Setup Count** — `value: schedData.setup.count`, `group: 'Scheduling'`, `format: 'number'`, objective `minimize`, thresholds from `kpiThresholdMap.get('SetupCount')`.
- **Setup-to-Run Ratio** — `value: schedData.setupToRun.ratioPct`, `unit: '%'`, `format: 'percent'`, objective `minimize`, thresholds from `kpiThresholdMap.get('SetupToRunRatio')`.

Use the same `?? default` fallback pattern as the existing `OnTimeStart` / `TurnoverTime` lookups so missing tenant thresholds degrade gracefully.

### 1d. Canonical definitions — job-shop `kpis.json`

Add two `IKPIDefinition` entries to the job-shop tenant kpis file(s) only:

```
{ "key": "SetupCount",      "name": "Setup Count",         "objective": "minimize", "targetValue": <baseline>, "criticalThreshold": <baseline> }
{ "key": "SetupToRunRatio", "name": "Setup-to-Run Ratio",  "objective": "minimize", "targetValue": 10,         "criticalThreshold": 25 }
```

Set `SetupToRunRatio` targets from a real solve baseline, not a guess (see Acceptance). `SetupCount` thresholds are dataset-dependent — derive from the demo baseline.

### Open confirmation (does not block Phase 1)

Confirm whether **inserted changeovers** (from `state-changes.json`) materialize as SET_UP tasks or only as inflated task durations / gaps. Phase 1 scopes setup KPIs to **explicit SET_UP / TEAR_DOWN task types** (what line ~287 skips today). If inserted changeovers are *not* tasks, they are not counted here — note that limitation in the KPI definition description rather than expanding scope.

---

## Phase 2 — Mislabel renames (commit 2)

Display-name + definition clarity only. No computation changes.

### 2a. "On-Time Starts" → "Start Buffer" (or "Window Front-Load")

It measures whether the engine *placed* each task near the front of its window — a buffer/plan-quality signal, **not** execution adherence. Rename the display `name` and add a definition string clarifying it is a planned-placement metric. This frees the term "on-time" for a future real adherence metric (actual vs. planned start) so the two never collide.

### 2b. "Avg Turnover Time" → "Avg Idle Gap" (or "Inter-Task Gap")

It measures the gap between consecutive scheduled tasks on a resource — idle white space, **not** changeover/setup time. After Phase 1 surfaces real setup time, a metric named "turnover" that means idle gap is actively confusing. Rename display `name` + definition.

### 2c. Key-rename decision (call out, don't silently pick)

Renaming the internal KPI `key` and the `kpiThresholdMap` key (`OnTimeStart`, `TurnoverTime`) is the clean option but breaks existing `kpis.json` threshold lookups and any persisted config referencing those keys.
- **Recommended:** rename display `name` + definition now; keep internal keys stable to avoid breaking threshold lookups. Log a follow-on for a clean key migration if desired.
- If a clean key rename is chosen, migrate the `kpis.json` entries in the same commit and retire the old keys explicitly.

---

## Verification

**Phase 1**
- [ ] PROCESS-based KPIs (feasibility, on-time, turnover, scheduled count) are **numerically unchanged** vs. pre-sprint on the demo dataset — setup accumulation must not leak into them.
- [ ] `setup.count` equals the known number of scheduled SET_UP/TEAR_DOWN tasks in the demo-manufacturing dataset (establish this baseline first, assert against it).
- [ ] `setupToRun.ratioPct` matches a hand-computed setup ÷ run from the same solve.
- [ ] Both new cards render in the Analytics → Scheduling group with correct threshold coloring.
- [ ] Tenant without `SetupCount` / `SetupToRunRatio` definitions falls back to defaults without error (non-job-shop tenants unaffected).

**Phase 2**
- [ ] Renamed cards display new names; values identical to pre-rename.
- [ ] No threshold lookup breaks (keys stable per recommended path, or migrated per chosen path).

---

## Out of scope (explicit)

- Any solver/engine change — objective terms, changeover weighting, lane behavior.
- Lane metrics: lane-induced infeasibility, lane integrity, lane-attributed setup.
- Per-resource / per-lane / per-work-center grouping of setup KPIs.
- Tardiness distribution, flow efficiency (separate job-shop KPI work).
- Adherence / stability / promise-accuracy (actuals + cross-snapshot follow-on).
- Inserted-changeover-as-setup counting (pending the §1d confirmation).

## Acceptance criteria

1. Setup count and setup-to-run ratio appear as two distinct Scheduling KPIs on job-shop tenants, threshold-colored, baselined against the demo dataset.
2. All pre-existing scheduling KPIs unchanged in value.
3. The two mislabeled KPIs read accurately (Phase 2), with no threshold-lookup regressions.
4. Zero solver/engine diff in the sprint.
