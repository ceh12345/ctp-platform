# Bitwise Availability — CTP Integration Plan

**Audience:** owner of the bitwise/bitmap availability logic
**Author:** CTP engine team
**Status:** DRAFT — for review
**Date:** 2026-07-31

---

## 1. Why we want this

CTP's scheduling engine represents resource availability as interval (window) lists.
Three current facts make a bitmap representation attractive:

1. **The Stafford tenant is 100% discrete.** All 68 resources are `class: "REUSABLE"`
   (verified in `config/tenants/stafford-slim-500/data/resources.json`). No consumable,
   cumulative, or rate-limited resources exist in this tenant, so a bitmap covers the
   *complete* resource-feasibility check — not just a candidate filter in front of
   numeric profile validation.

2. **The remaining solver hotspot is an availability-representation problem.** The
   calendar index on the perf branch falls back to a slow path when availability
   windows overlap (~20s of the slim-500 solve). Bitmaps are immune by construction:
   OR-ing overlapping or duplicated windows into a bitset is idempotent — a minute is
   free or it isn't, regardless of how many malformed windows assert it.

3. **The dispatch strategy needs group-level feasibility.** The op → group → machine
   preference work needs "can *some* machine in this group take this op" answered
   fast. That is an erode-then-combine bitmap operation (see §4.3).

Bonus: placing/retracting a booking becomes set-bits/clear-bits, which makes undo in
the Chain bump-and-retry solver nearly free.

## 2. Scope and non-goals

**In scope**
- A standalone bitset primitive module (no engine dependencies).
- Bitmap-backed net availability, per-resource start-time computation, and
  cross-resource intersection for **REUSABLE (discrete, capacity-1) resources only**.
- Group-level (pool) feasibility profiles for the dispatch preference pass.

**Out of scope**
- CONSUMABLE resources and any quantitative profile logic (levels, caps, rates).
  Those keep their existing representations.
- Conflict-analysis / diagnostic output. Human-facing explanations
  (`basescheduler.ts` resource-detail reporting) keep reading interval lists.
  The bitmap is a **derived index, never the source of truth**.
- Chain propagation, maxGap, and dependency ordering — task-to-task temporal
  constraints are untouched; bitmaps only accelerate the availability side.

## 3. Where it plugs in (CTP seams)

The engine already has a three-stage availability pipeline. The bitmap swaps the
representation *inside* each stage; the stage boundaries and everything downstream
(scoring, state changes, placement) are unchanged.

| Stage | Current code | Bitmap replacement |
|---|---|---|
| **Net availability** (calendar ⊖ assignments) | `packages/engine/Engines/availableengine.ts` → `recalculate()`; lists wired in `commonstarttimes.ts:49-58` | `netBits = calendarBits & ~assignmentBits`. `calendarBits` built once per resource (idempotent OR — kills the overlap fallback). `assignmentBits` updated incrementally on book/unbook. Lives as a shadow field on the resource's `available` object, refreshed under the existing `recompute` flag. |
| **Per-resource start times** ("where can duration d start in [st, et]") | `packages/engine/Engines/starttimeengine.ts:257` → `computeStartTimes()` | FIXED durations: erosion (shift-AND doubling, O(log d) word passes), masked to [st, et]. FLOAT durations: prefix-popcount walk (see §4.2). |
| **Cross-resource intersection** | `packages/engine/AI/Agents/commonstarttimes.ts:129-150` → `computeFeasible()` intersects per-resource start lists | AND of eroded bitmaps. Convert to `CTPStartTimes` intervals once, at the end, in `createStartTimes()`. |
| **Group/pool feasibility** (dispatch) | preference walk around `basescheduler.ts:1217-1271`, `combinationengine.ts` | Erode each member first, then OR (need 1) or bit-sliced count (need k). See §4.3 — order matters. |

## 4. Semantics the bitwise logic must honor

### 4.1 Quantization — conservative, minute-grain
Engine times are **seconds** (`startW`/`endW`); the bitmap is **1 bit per minute**.
The mapping must be strictly conservative (bitmap never admits a placement the
second-grain model would reject):

- Durations: **round up** to whole minutes.
- Availability windows: round starts **up**, ends **down**.
- A parity diff at the seconds level is a quantization bug, not noise.

Sizing at this grain: an 18-month horizon ≈ 786k bits ≈ 96 KB per resource
(`Uint32Array`); 68 Stafford resources ≈ 6.5 MB. Use `Uint32Array` word ops, not
`BigInt` (allocation-heavy at this size).

### 4.2 FIXED vs FLOAT durations — two different queries
- **FIXED**: task occupies d consecutive wall-clock minutes → classic erosion:
  `canStart = free & (free>>1) & (free>>2) ...` folded by doubling.
- **FLOAT**: duration accumulates **working time across shift gaps**
  (see the comment at `commonstarttimes.ts:79-82` and
  `interval-walker.ts` → `workingEndForwardW`). "d consecutive free minutes" is the
  **wrong test**. Correct test: from candidate start m, the cumulative count of free
  minutes reaches d before the window ends → implement with a prefix-popcount array
  over `netBits` (built once per recompute, O(1) per end-lookup via binary search or
  stepped scan).

### 4.3 Pools: erode first, then combine — never union raw availability
Union-of-availability answers "is *anyone* free at minute m", not "can *someone*
take the whole task". Counter-example: member A free 9–10, member B free 10–11;
the union shows a contiguous 9–11 slot that **no single member can serve**.

Required order:
1. Erode each member's `netBits` by the task duration → per-member can-start bitmap.
2. Need 1 member → OR the can-start bitmaps. Any set bit has, by construction, a
   concrete member covering the full run.
3. Need k members → per-minute count of set can-start bits ≥ k (bit-sliced
   carry-save counters or a plain integer profile). Any k counted members form a
   valid assignment.

Member *selection* (preference order, load balancing) happens after feasibility, in
CTP dispatch code — the bitmap layer only answers feasibility.

Known residual gap (accepted): with heterogeneous member calendars, *joint*
assignment of several tasks against one group is a matching problem the aggregate
cannot make exact. CTP handles this with a repair loop (unplace, ban slot, retry) —
the bitmap layer does not need to solve it. We will instrument repair-loop entries;
near-zero confirms the relaxation is paying for itself.

### 4.4 Duration must not depend on member choice
The erosion grain assumes all members of a group take the same duration for the op.
If machine speeds differ within a group, CTP will pre-split groups into speed
classes before they reach the bitmap layer. The bitwise logic can assume uniform
duration per query.

## 5. Deliverable contract (what the bitwise owner provides)

A pure module — proposed `packages/engine/Models/Core/bitset.ts` — with no
dependencies on engine types:

```
create(minutes) / fromIntervals(list, quantize) / toIntervals()
and / or / andNot / not          — in-place and copying variants
setRange / clearRange            — booking place & retract
shiftRight(k)                    — cross-word, for erosion
erode(d)                         — shift-AND doubling
prefixPopcount()                 — for FLOAT duration queries
countPlanes(bitmaps[])           — bit-sliced k-of-n counting (phase 4)
firstSetBit(from) / runs()       — slot scan / interval extraction
```

All operations minute-indexed against a fixed horizon origin supplied at creation.
Cross-word `shiftRight` is the one fiddly primitive — it must be exhaustively
unit-tested (word-boundary offsets, tail-word masking).

## 6. Phases and gates

| Phase | Deliverable | Gate |
|---|---|---|
| **0** | `bitset.ts` primitive + unit tests | Fuzz: random window sets → interval path vs bitmap path → identical start sets. Word-boundary edge cases covered. |
| **1** | Shadow mode in `starttimeengine` behind a flag: compute start times both ways, assert equal, log diffs | Parity harness: **0 placement diffs** at slim-100 and slim-500. Fuzz the book/unbook sync path (a stale bit is silent until it double-books). |
| **2** | Bitmap-primary for REUSABLE resources; interval lists retained for diagnostics | Same parity gate + perf: slim-500 solve measured against the **~20s overlap-fallback baseline**. |
| **3** | Incremental assignment-bit maintenance wired into place/retract (removes recompute cost from the bump-and-retry loop) | Parity + no regression in ILS/tabu move-evaluation benchmarks. |
| **4** | Group-level erode-then-count profiles for the dispatch preference pass | Dispatch results identical to per-member enumeration on stafford-slim tenants; repair-loop entry count instrumented. |

Phases 0–3 belong on the perf branch (`feature/solver-performance` worktree) next to
the calendar index they supersede. Phase 4 belongs on `feature/dispatch-strategy`.

## 7. Risks and open questions

1. **Changeover/state-change seam.** `commonstarttimes.ts:130` ("Remove Changeovers")
   and `statechangeerengine.ts` operate between raw start times and final
   feasibility. Not yet traced — before Phase 1 we must decide whether changeover
   exclusions become a mask (stay in bit domain) or run after the interval
   conversion. **Action: CTP team traces this seam and reports the answer before the
   bitset API is frozen.**
2. **FLOAT semantics confirmation.** §4.2's prefix-popcount model must be validated
   against `workingEndForwardW` behavior on real Stafford calendars (multi-shift
   days, 2027 coverage) during Phase 0 fuzzing.
3. **Index staleness.** The bitmap is a derived index; every code path that mutates
   assignments or calendars must invalidate or incrementally update it. Lesson
   learned from the calendar-index sprint: guard + fall back loudly, never silently.
4. **Granularity ceiling.** Minute grain is conservative by design; if a tenant ever
   needs sub-minute precision, the horizon origin/scale is a bitset constructor
   parameter — do not hard-code 60s anywhere in the primitive.

## 8. Success criteria (summary)

- 0 placement diffs on the slim-100 / slim-500 parity harness at every phase.
- Measurable reduction of the ~20s overlap-fallback cost at slim-500.
- Overlapping / ill-formed calendar windows handled with no fallback path.
- Group feasibility for the dispatch pass answered without per-member enumeration.
