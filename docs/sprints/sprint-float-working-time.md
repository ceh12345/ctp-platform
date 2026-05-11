# Sprint — FLOAT Working-Time Semantics

## Goal

FLOAT_DURATION tasks honor working-time accumulation across shift boundaries. A 16h FLOAT task on 8h Mon-Fri shifts ends at the second shift's end (Tue 15:00), not 16h after start (Mon 23:00). The overnight gap does not count toward task duration.

## Background

The engine's FLOAT plumbing exists end-to-end:

- `interval-walker.ts` — `walkForward` / `walkBackward` accumulate working time across intervals, skipping gaps.
- `range.ts` — `CTPRange.computeDurationForward` / `Backward` wrap the walkers and store results in `range.values.eet` / `lst`.
- `starttimeengine.ts:146-180` — invokes both walkers for every range, populating `eet` and `lst` correctly.

The break is one constructor: `commonstarttimes.ts:81-88` builds `CTPStartTime` with naive `startW + duration` math instead of pulling the walker results from the range. From that point downstream, `eEndW` / `lEndW` are wall-clock for FLOAT, and `ScheduleEngine.schedule()` ends up booking `et = st + duration` (wall-clock) instead of the working-time end.

## Design decisions

| Decision | Rationale |
|---|---|
| Fix `commonstarttimes.ts` to consume `computeFeasibleWindows()` | Walkers + ranges already correct; one constructor drops the data |
| `ScheduleEngine` reads `eEndW` / `lEndW` from `CTPStartTime`; no walking in schedule step | Direction-symmetric (forward/backward) by construction |
| `CTPAssignment` gains `segments: CTPInterval[]` + `workDuration()` | Single envelope kept; segments cached for consumers that need work time |
| Compute segments **only for FLOAT** at booking site | FIXED can't span shift gaps by construction; zero cost |
| Extend existing API endpoints with `workDurationSeconds` + `segments[]` | One transaction, all consumers (web, integrations) get identical shape |
| UI renders `assignment.segments[]` — N blocks for FLOAT, 1 block for FIXED | FIXED visually identical to today; FLOAT shows gap naturally |

## Changes by area

### Engine

1. **`commonstarttimes.ts:81-88`** — Switch from `computeStartTimes()` to `computeFeasibleWindows()`. Build `CTPStartTime` from `range.values.{est, eet, lst, lett}` so `eEndW` / `lEndW` carry walker results, not naive arithmetic.

2. **`scheduleengine.ts:44-56`** — Consume `stNode.eEndW` (forward) / `stNode.lEndW` + `stNode.lStartW` (backward) from the CTPStartTime node. FIXED behavior byte-identical (walker returns trivial `start + dur` for contiguous slots).

3. **`window.ts` `CTPAssignment`** — Add `segments: CTPInterval[]` (optional, default empty) and `workDuration(): number`. `duration()` unchanged (envelope `endW - startW`). `workDuration()` falls back to `duration()` when segments is empty.

4. **Booking sites** — `scheduleengine.ts:117`, `basescheduler.ts:915`, `basescheduler.ts:933`. Gate by `durationType`:
   ```typescript
   if (isFloat(task.duration)) {
     t.segments = intersectEngine.execute(resource.original, new CTPInterval(st, et));
   }
   ```

5. **Scoring rules** — `resourceutilizationscoringrule.ts:50` and `availableengine.ts:67-70` switch `(endW - startW)` / `duration()` → `workDuration()`. Cost rule unchanged (already uses `task.duration` which is work-time).

### API

1. **`ctp.service.ts:3164-3170`** — Task DTO gains `workDurationSeconds: assignment.workDuration()` and `segments: assignment.segments.map(s => ({ startW, endW }))`. Existing `durationSeconds`, `scheduledStart`, `scheduledEnd` unchanged for backward compat.

2. **`analytics.service.ts:169-179`** — Sum `workDuration()` instead of envelope durations.

### Web (`packages/web/src/App.tsx`)

1. **Gantt bars** — Render N blocks per `assignment.segments`. FIXED with `segments.length === 1` (or undefined) draws as one block — visually identical to today.
2. **Resource agenda panel** — Iterate `assignment.segments` instead of envelope.
3. **Task detail panel** (`:3095-3097`) — Display `workDurationSeconds` for the Duration field.
4. **WhereTo ghost bars** (`:5359-5366`) — Same segment-aware render path.

## Test plan (bottom-up)

| Phase | Tests | Status |
|---|---|---|
| A — interval-walker primitives | `tests/models/interval-walker.test.ts` | already green; verify |
| B — CTPRange forward/backward | `tests/models/range.refactor.test.ts` | already green; verify |
| C — Schedule engine FLOAT (this sprint) | `tests/scheduling/float-duration.test.ts` | drives the work |
| D — Regression | `npx vitest run` (full suite) | must stay green throughout |

### Phase C tests — order of implementation

1. ✅ Control: 4h FLOAT in 8h shift fits in one shift (matches FIXED behavior) — passing baseline
2. 🔴 PLL-5: 16h FLOAT spans two shifts, ends Tuesday 15:00 — drives `commonstarttimes.ts` + `scheduleengine.ts` fixes
3. Weekend skip: 12h FLOAT crossing Fri 15:00 → Mon 09:00
4. Mid-shift start: 6h FLOAT starting at 11:00 in an 8h shift
5. Backward direction: 16h FLOAT anchored to Fri 15:00 deadline
6. Schedule + unschedule round-trip: assignments cleared, segments cleared, calendar restored

## Commit order

| # | Commit | Tasks |
|---|---|---|
| 1 | Baseline test scaffolding (Test 2 skipped pending fix) | #1 |
| 2 | `commonstarttimes.ts` walker propagation + Test 2 unskip | #2, #3 |
| 3 | `scheduleengine.ts` consumer update + backward test | #6, #7 |
| 4 | `CTPAssignment` `segments[]` + `workDuration()` + booking sites (FLOAT-gated) | #8 |
| 5 | Scoring rules switch to `workDuration()` | #11 |
| 6 | API serialization (segments, workDurationSeconds) | #9 |
| 7 | UI rendering update (Gantt, agenda, detail, whereTo) | #10 |
| 8 | Tests 3, 4 + final regression | #4, #5 |

Each commit independently verifiable. Engine commits 2-5 land before API/UI commits 6-7 so frontends never see partial-state payloads.

## Out of scope (deferred)

- **Chain context engine `eEndW` propagation for FLOAT chains** — `chaincontextengine.ts:619, 623, 660, 757` assumes `eEndW = eStartW + duration` (wall-clock). Chain-with-FLOAT scenarios need a separate sprint.
- **SetEngine segment-awareness** — only needed if segments become inputs to interval algebra. Today they're outputs only.
- **Full per-segment booking** (N CTPAssignment rows per task) — single envelope + cached `segments[]` covers all known consumers; no schema change needed.
- **Tenant flag `computeFloatSegments: true|false`** — escape hatch if profiling shows segment computation is wasteful for some tenants. Not coded upfront; worth keeping in pocket.

## Done definition

- All 6 Phase C tests green
- Full regression (633+ tests) green
- PLL-5 case: `task.scheduled.endW = Tue 15:00`, `task.workDurationSeconds = 57600` (16h)
- API response includes `segments` for FLOAT tasks
- Gantt visually shows the overnight gap for FLOAT tasks
- FIXED behavior byte-identical (single segment, single block on Gantt)

## Branch

- `feature/float-engine-tests` (off `main` at commit `b19c626`)
- CI does not fire on feature branches; pushes are CI-quiet until PR opened against `main`
