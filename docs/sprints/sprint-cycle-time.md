# Sprint — Cycle Time on Tasks

## Goal

Preserve the **original standard duration** (cycle time) of every task as a separate field from the scheduling `duration`. Today `task.duration` is the *active* scheduling duration — for in-progress tasks it reflects remaining time, not the original cycle time. CTP queries against order chains need the full cycle time regardless of a task's current progress.

## Background

Stafford ships rich duration data on every task — both planned and cumulative — but our mapping currently collapses them into a single `task.duration`:

| Stafford field | Today's mapping target |
|---|---|
| `TotalPlannedMachineHours` (= setup + operation) | drops on the floor |
| `PlannedOperationMachineHours` | drops on the floor |
| `PlannedSetupMachineHours` | drops on the floor |
| `CycleTime` (per-unit) | drops on the floor |
| `TotalCumulativeMachineHours` | drops on the floor |
| `TotalRemainingMachineHours` | → `task.duration` (for in-progress tasks) |

For not-started tasks `task.duration` IS the cycle time. For in-progress tasks it's the remaining. That loss-of-original blocks CTP queries that ask "if a fresh order arrived today, when could we promise it?"

## Design decisions

| Decision | Rationale |
|---|---|
| New field `cycleTime: number \| null` on `CTPTask` — **seconds per unit** (not total) | Matches Stafford's native `Formula: "HR/UN"` (hours per unit). Total is derived. |
| Helper `theoreticalDurationSeconds(task): number` derives total from `cycleTime × qty` | Single source of truth; reads from existing `qty` field. Where total is needed, computed once. |
| Falls back to `task.duration.duration()` when `cycleTime` is null | Existing tenants and FIXED-only paths continue to work without mapping changes. |
| `task.duration` semantics unchanged | All existing scheduling, FLOAT walks, chain math, and tests stay untouched. The engine still schedules against `duration`. |
| API ships `cycleTimeSecondsPerUnit` (raw) and `theoreticalDurationSeconds` (derived) | Raw for inspection; derived for downstream callers. |
| UI displays in task detail panel when distinct from `duration` | Power users want to see both numbers; planners can ignore. Avoids clutter for FIXED-only tenants. |

## Changes by area

### Engine

1. **`packages/engine/Models/Entities/task.ts` `CTPTask`** — add per-unit field + derived helper:
   ```typescript
   public cycleTime: number | null = null;   // seconds PER UNIT; null = no theoretical, fall back to duration

   /** Total theoretical duration = cycleTime × qty. Falls back to scheduling duration. */
   public theoreticalDurationSeconds(): number {
     if (this.cycleTime != null && this.qty != null) {
       return this.cycleTime * this.qty;
     }
     return this.duration?.duration() ?? 0;
   }
   ```
   No engine code reads `cycleTime` — it's metadata. Scheduling continues to use `duration`. `qty` already exists on `CTPTask`.

### State hydration

2. **`packages/api/src/modules/state/state-hydrator.service.ts`** — when constructing `CTPTask`, populate `cycleTime` from the mapped value if present.

### Mapping engine

3. **`packages/api/src/modules/integration/mapping-engine.ts`** — already supports field-to-field rules. No change needed beyond confirming the new mapping rule type works.

### Tenant mapping configs

4. **`config/tenants/stafford-engineering-test/integration/mapping.json`** — add rule pulling from Stafford's native per-unit field:
   ```json
   {
     "target": "cycleTime",
     "from": "CycleTime",
     "factor": 3600
   }
   ```
   Stafford's `CycleTime` has `Formula: "HR/UN"` — hours per unit — matching our per-unit semantics exactly. For tasks where `CycleTime` is 0 or null (design/QC, non-machining), `cycleTime` stays null and `theoreticalDurationSeconds()` falls back to `duration`. Same rule in `stafford-engineering` (production) once verified on test.

### API

5. **`packages/api/src/modules/ctp/ctp.service.ts:3170`** task DTO — add both raw and derived next to `durationSeconds` and `workDurationSeconds`:
   ```typescript
   cycleTimeSecondsPerUnit: task.cycleTime,                         // raw — null when unset
   theoreticalDurationSeconds: task.theoreticalDurationSeconds(),   // derived — always a number
   ```

### Web UI

6. **`packages/web/src/App.tsx`** task detail panel (~line 3097) — below the Work Time row, add two rows shown **only when** `theoreticalDurationSeconds !== durationSeconds` (don't clutter when they're identical):
   - `DetailRow label="Cycle Time / Unit" value={fmtDuration(task.cycleTimeSecondsPerUnit)}` — hidden when null
   - `DetailRow label="Theoretical Duration" value={fmtDuration(task.theoreticalDurationSeconds)}`

## Test plan

| Phase | Tests |
|---|---|
| A — Engine unit | `theoreticalDurationSeconds()` returns `cycleTime × qty` when both set; falls back to `duration.duration()` when cycleTime null. Edge: qty=0 falls back to duration. |
| B — Hydrator unit | When mapping rule populates `cycleTime` from per-unit source, `CTPTask.cycleTime` matches the mapped value (seconds per unit). |
| C — API contract | Task DTO ships `cycleTimeSecondsPerUnit` (nullable) and `theoreticalDurationSeconds` (always number) for Stafford slim; FIXED-only tenants show `cycleTimeSecondsPerUnit === null` and `theoreticalDurationSeconds === durationSeconds`. |
| D — Regression | Full `npx vitest run` stays green (no behavior change for engine scheduling). |

### Critical: progress-aware test case

Take a task with:
- `qty = 10`
- `CycleTime = 0.8` (HR/UN — 0.8 hours per unit)
- `TotalPlannedMachineHours = 8` (= cycleTime × qty)
- `TotalCumulativeMachineHours = 5`
- `TotalRemainingMachineHours = 3`
- `CompletionPercentageByMachineHours = 62.5`

After hydration:
- `task.duration.duration()` = 3h × 3600 = 10800 (remaining, used for scheduling)
- `task.cycleTime` = 0.8h × 3600 = 2880 (per-unit, raw)
- `task.theoreticalDurationSeconds()` = 2880 × 10 = 28800 (full standard, used for queries)
- `task.workDurationSeconds` (UI) = whatever `duration` resolves to under FLOAT/FIXED semantics

Distinct values prove the separation. Also test edge: a design task with `CycleTime=0` → `cycleTime` stays null → `theoreticalDurationSeconds()` falls back to `duration` (no spurious zero).

## Commit order

| # | Commit | Notes |
|---|---|---|
| 1 | Add `cycleTime` field + getter on `CTPTask` + unit test | Engine foundation, no behavior change |
| 2 | State hydrator wiring + tests | Reads from mapping output |
| 3 | API DTO extension (`cycleTimeSeconds`) + regression | Existing tests pass; new field appears in response |
| 4 | UI: task detail panel row | Hidden when cycle == duration to avoid clutter |
| 5 | Stafford mapping config rule | Wired only after engine/API/UI ready |
| 6 | Final regression + summary | All green; Stafford slim shows distinct cycle vs duration |

## Out of scope (deferred)

- **CTP query implementation** — actually using `cycleTime` to answer "promise date for a fresh order on chain X". That's the next sprint after this one. This sprint just preserves the data.
- **`setupTime` as a separate field** — Stafford has `PlannedSetupMachineHours` distinctly. Useful for future setup-aware scheduling rules but not needed for CTP queries today. Leave as a follow-up.
- **Per-unit cycle time** (`CycleTime` field × qty) — Stafford's `Formula: "HR/UN"` semantics. For volume products this matters; for the current Stafford slim where most tasks are 0/null on `CycleTime`, the aggregate `TotalPlannedMachineHours` is the right v1 source.
- **Engine optimization rules using cycle time** — e.g., prefer fast-cycle resources. Out of scope; just storing the data.

## Done definition

- `CTPTask.cycleTime` field exists with fallback getter
- Stafford slim tenant: task DTOs show `cycleTimeSeconds !== durationSeconds` for in-progress tasks (proves the separation)
- All existing 1061+ tests still pass
- Task detail panel shows Cycle Time row when distinct from Duration
- Sprint doc committed (this file)

## Pairs with

- **Chain-FLOAT maxGap fix** (deferred from FLOAT sprint) — both unblock Stafford's v3.2 mapping flip.
- **Stafford v3.2 FLOAT mapping flip** — once `durationType` becomes 1 (FLOAT) for Stafford tasks, the cycle-time data also needs `cycleTime` populated so CTP queries against FLOAT chains work correctly.

## Branch

- Suggested: `feature/cycle-time`, off latest `main`
