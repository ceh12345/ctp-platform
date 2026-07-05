# P0 — Field Classification & Investigation Gate (Scheduling Snapshot sprint)

**Status:** ✅ Investigation complete — pending sign-off. This is the **reconstruction contract**: every landscape field is assigned to exactly one bucket, and P1/P2 lock against it.
**Branch:** `feature/scheduling-snapshot`
**Method:** read-only code investigation of `packages/engine` (entities, hydrator, schedulers) + `packages/api` (mutation endpoints, solve DTO).

> Buckets: **BASE** (static input, loaded — not in snapshot) · **OVERLAY** (persisted in the snapshot, written every mutation) · **DERIVED** (re-derived on load, no solve, not persisted) · **ACTUALS** (floor reality; v1 carries inline in the overlay until the actuals layer exists).

---

## §10 gate questions — answered

**Q1 — Does the solve emit a thin scheduled-state projection, or only fat objects? → FAT ONLY.**
`TaskResultDto` (`dto/solve-result.dto.ts:83-199`) is the *only* task shape; the projection is built fat in `ctp.service.ts:~3140-3330`. No thin/placement DTO exists anywhere. **Consequence:** P1 must **project the thin overlay at write time** from the in-memory landscape — there is no thin source to copy. (~10 placement fields vs ~100 task properties; the rest are fat diagnostics → `debug`.)

**Q2 — Is {pinned, window, priority} the complete non-solve override set? → NO, it's larger.** Two refinements:
1. **More mutations write durable state without a solve** than we listed: `pin` (`pinned`,`includeInSolve`), `setTaskWindow` (`window.*`), `setTaskPriority` (`priority`), `updateResourceMode` (`capacityResources[].mode`), **`moveTo`** (`state`,`scheduled`,`scheduledResource` — *places a task with no solve*), **`optimize accept`** (same, from the optimized graph), and the whole **commitment stack** (`dispatch`/`start`/`hold`/`resume`/`complete`/`revert-dispatch`/`updateProgress`). Evidence: `ctp.service.ts:636,1422,1478,572,749,2297-2390,2617`; `optimize.service.ts:190`; controller comments "Does NOT trigger a re-solve" at `ctp.controller.ts:223,238`.
2. **`window` is also tightened by the solve itself** (constraint propagation), not just by `setTaskWindow`. So the post-solve window ≠ base window → **`window` is OVERLAY**, persisted in full (`startW,endW,origStartW,origEndW`), or reconstruction isn't byte-exact.

**Q3 — Generated tasks: reconstructable from config, or must be persisted whole? → MUST be persisted whole.** Two distinct kinds — keep them separate:
- **Config SETUP/TEAR_DOWN** — pre-exist in the task list as static chain members (loaded from data files). → **BASE**.
- **Generated CHANGEOVER** — created *during solve* by `StateChangeEngine.getScheduleStateChangeTasks()` (`statechangeerengine.ts:234-250`, via `TaskFactory.createStateTask` `taskfactory.ts:59-81`). `subType = CHANGE_OVER`; positioned by **sequence adjacency on the resource timeline, NOT `linkId.prevLink`** (SETUP at `from.scheduled.startW - duration`, TEARDOWN at `from.scheduled.endW`; `basescheduler.ts:431-457`). **Cannot** be re-derived without re-solving. → **OVERLAY, carried as a FAT row**: full definition (type, subType, name, duration, resource) + placement (`scheduled`) + **anchor** (parent PROCESS task key + before/after) so reconstruction re-inserts it at the right point on the resource timeline.

**Q4 — `score` classification? → DERIVED / DEBUG (not in the reconstruction set), with one residual check.** `score` defaults to `Number.MAX_VALUE` (`task.ts:394`), is set from solve contexts (`basescheduler.ts:335`), and reset on unschedule. For a *placed* task it's display-only. → **debug projection, NOT persisted for reconstruction.** **Residual check (do in P1):** confirm a *partial* solve (`scheduleBulk`) never reads a carried-forward task's `.score` to make a decision; if it does, promote `score` to OVERLAY. Same applies to `feasible` (derived, reset to null — `debug`).

---

## Total field classification

### Task (`CTPTask`, `task.ts`)

**OVERLAY — persisted, written on every mutation (the reconstruction-critical set):**

| Field | Why overlay | Evidence |
|---|---|---|
| `state` | placement (solve / moveTo / optimize-accept) | `scheduleengine.ts:59,97` |
| `scheduled` `{startW,endW}` | placement; also set by `moveTo`/optimize without solve | `scheduleengine.ts:68-69`; `ctp.service.ts:821` |
| `capacityResources[].scheduledResource` (+ slot index/key) | the assigned resource per slot | `scheduleengine.ts:164` |
| `capacityResources[].mode` | resource-mode override (no solve) | `ctp.service.ts:572` |
| `window` `{startW,endW,origStartW,origEndW}` | tightened by solve **and** by `setTaskWindow` | solve tightening (agent); `ctp.service.ts:1439-1444` |
| `pinned` | pin override (no solve) | `ctp.service.ts:648` |
| `includeInSolve` | set by pin/exclude/order-modes (no solve) | `landscape.ts:177-215` |
| `priority`, `manualPriority` | priority override (no solve); solve applies `priorityOverrides` | `ctp.service.ts:1487`; `task.ts:414` |
| **generated CHANGEOVER tasks** (fat rows) | solve-created, unreconstructable | Q3 |
| `infeasibilityReport` **classification** (unschedulable tasks only) | solve output — the placement-attempt result; **cannot be re-derived without re-solving** (same rule as generated tasks). Persist the classification (`conflictType`/`reason`/`bottleneckSlot`); **drop the fat `slots` breakdown** (~97% of the bytes; a card's expandable detail a fresh solve repopulates). Absent on scheduled tasks. Cold reconstruct was dropping it → the Conflicts tab reclassified horizon as dependency. | `overlay.ts` |

**OVERLAY-ACTUALS — floor state; mutated without solve; v1 carries inline in the overlay (→ extracted to the actuals layer in v2):**
`commitmentLevel`, `wipstate`, `dispatched`, `dispatchedAt`, `materialsPulled`, `percentComplete`, `remainingDuration`, `actualStart`, `actualEnd`, `actualResources`, `holdReason`, `holdStart`, `estimatedResumeTime`. Evidence: `ctp.service.ts:2297-2390,2617`. *(These are the “actuals” of the three-layer model. The layer/series/convergence is deferred — §9 of the spec — but the fields must be durable in v1, so they ride in the overlay now.)*

**BASE — static input, loaded, not in the snapshot:**
`key`, `name`, `type` (incl. config SETUP/TEAR_DOWN), `linkId` (`name`/`type`/`prevLink`/`maxGap`), `duration`, `capacityResources` *definitions* (resource/qty/isPrimary/preferences/default-mode), `materialsResources`, `inputMaterials`, `outputProductKey`/`outputQty`/`outputScrapRate`, `process`/`subType`/`requiresSetup`, `cadenceIntervalMinutes`, `hierarchy`/`attributes`/`typedAttributes`, `batchRuleKey`/`batchQty`, `originalPriority`, due-date hydration (`dueDate`/`lateDueDate`/`orderPriority`/`latenessPenaltyPerDay`, stamped from order at hydrate). *(Note: `originalPriority` is base — captured at hydrate; `priority` is overlay.)*

**DERIVED — re-derived on load, not persisted:**
`preds`/`succs` (buildAdjacency from `linkId.prevLink` — `task.ts:212`), `componentKey`/`componentTopoPos`/`componentAnchorStartW` (deriveComponents — `task.ts:247`), `sequence` (from linkId topology), `feasible`, `score` (debug), `errors`, `_tempPinned`, `processed`, `recompute`, `groupKey` (re-derivable from cross-WO links / order). *(Per `task.ts` comments these are explicitly “NOT serialized.”)*

> **Correction (post-P10):** `infeasibilityReport` was originally listed here as DERIVED, but it is solve output and **not** re-derivable on load without re-solving — the same rule that puts generated CHANGEOVER tasks in OVERLAY (Q3). It is now an OVERLAY field (see table above). Cold reconstruct was silently dropping it, so the Conflicts tab re-derived a wrong classification (horizon → dependency) while the persisted summary stayed correct. `feasible` stays DERIVED (it is recovered from `includeInSolve && state`).

### Resource (`CTPResource`, `resource.ts`)

- **BASE:** `key`, `name`, `type`, `class`, `hourlyRate`, `original` (raw calendar availability — *calendars are input, not snapshot*), hierarchy/attributes.
- **DERIVED:** `assignments` (rebuilt from the task→resource placements in the overlay), `available` (matrix recomputed `original − assignments`), `recompute`.
- **ACTUALS-adjacent:** resource downtime intervals added via `addResourceDowntime` mutate `assignments` — these are *durable, no-solve* edits. v1: carry resource-downtime intervals in the overlay (small) so consumption reconstructs exactly. `validationErrors`: persistent → carry if present.

### Order (`CTPOrder`, `order.ts`)

- **BASE:** `key`, `productKey`, `demandQty`, `dueDate`, `lateDueDate`, `priority`, `latenessPenaltyPerDay`, `groupKey`, `parentOrderKey`, `rawFields`, hierarchy/attributes.
- **DERIVED:** `scheduledQty` + `fillRate` (recomputed from task placements — `order.ts:65`), `processingRanks` (re-derived from tenant config — `state-hydrator.service.ts:228`).

---

## The overlay row (proposed shape, to lock in P1)

```
OverlayRow = {
  taskKey,
  // placement
  state, scheduled: {startW, endW} | null,
  assignments: [{ slotIndex, resourceKey }],           // capacityResources[].scheduledResource
  // planning overrides
  pinned, includeInSolve,
  window: {startW, endW, origStartW, origEndW},          // tightened + overridden
  priority, manualPriority,
  resourceModes: [{ slotIndex, mode }],                  // capacityResources[].mode deltas
  // actuals (inline for v1; → actuals layer in v2)
  commitmentLevel, wipstate, dispatched, dispatchedAt, materialsPulled,
  percentComplete, remainingDuration,
  actualStart, actualEnd, actualResources,
  holdReason, holdStart, estimatedResumeTime,
  // generated tasks only:
  generated?: true, type, subType, name, duration, resourceKey,
  anchorTaskKey, anchorSide: "before" | "after",
}
// + resourceDowntime: [{ resourceKey, startW, endW }]  (sidecar in the overlay doc)
```

Estimated size: thin rows still dominate; the actuals/generated fields are sparse (only populated when present). Expect **~300–450 KB at 2,000 tasks** — within the spec's budget.

---

## Decisions surfaced (need a nod before P1 locks shapes)

1. **Commitment stack rides inline in the overlay for v1** (not a separate actuals layer yet). It's the cleanest path to exact reconstruction now; the actuals *layer* (series + convergence) stays deferred. The overlay row simply has actuals fields that are usually empty. **Recommend: yes.**
2. **Resource downtime is durable, no-solve state** → carried as an overlay sidecar (`resourceDowntime[]`) so consumption reconstructs exactly. **Recommend: yes.**
3. **`score`/`feasible` are debug, not reconstruction** — pending the P1 residual check that partial solve doesn't read carried-forward `score`. **Recommend: classify debug, verify in P1.**
4. **`window` is overlay** (solve tightens it) — persist the full window, not just an override delta. **Recommend: yes.**

## Residual gate items (cheap, resolve in P1)
- Confirm `scheduleBulk` (partial solve) does not read other tasks' `.score` → finalize Q4.
- Confirm the generated-task **anchor** (parent key + before/after) is sufficient to re-insert on the resource timeline without a solve (vs needing the resource's full ordering).
- Confirm `originalPriority` is stable from config (base) and never mutated post-hydrate.

---

## Sign-off checklist
- [ ] Every Task/Resource/Order field above is in exactly one bucket (no field unlisted).
- [ ] Overlay row shape (above) accepted as the P1 serialize target.
- [ ] Decisions 1–4 confirmed.
- [ ] Residual items assigned to P1.

*Once signed off, P1 (overlay serialize) and P2 (reconstruct + round-trip identity) build against this contract.*
