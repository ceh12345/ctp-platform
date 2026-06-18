# Design Note — Parallel Processes Within a Chain (Work Order Groups)

**Status:** Design / exploration (no code yet)
**Date:** 2026-06-17
**Scope:** Engine — chain scheduling model
**Related:** Work Order Group entity (`SPRINT-workordergroup-entity.md`), chain primary anchor (`engine-sprint-chain-primary-anchor.md`), disjunctive graph (`solver-8-disjunctive-graph-design.md`)

---

## 1. Problem

Work Order Groups have a head WO and child WOs. We want the engine to schedule
tasks that run **in parallel within a single `linkId.name`** (chain) — e.g. two
branches of a WO group that proceed concurrently and then converge.

The engine's chain model is currently **strictly linear**. This note captures
what the engine does today, the proposed model for parallelism, and the bounded
work required — grounded in a code trace, not assumptions.

> Out of scope here: *solving* the WO-group collapse driver itself (the
> save/reset-linkname/reschedule/restore "take on Case A" discussed separately).
> This note is about the engine's ability to represent parallel branches at all.

---

## 2. What the engine does today (verified)

### 2.1 A chain = tasks sharing `linkId.name`
`landscape.buildProcesses()` (`landscape.ts:53`) groups tasks into a `CTPProcess`
strictly by `linkId.name`. Within the process, `prevLink` is the precedence edge
and `sequence` is the sort key.

### 2.2 Precedence is enforced by `sequence` adjacency, NOT `prevLink`
`ChainContextEngine.propagateCombo` (`chaincontextengine.ts:610`) walks
`pred = working[i-1]`, `succ = working[i]` over a **sequence-sorted** array
(`:102`). It reads `maxGap` off the *successor's* `linkId` (`:614`). It never
re-reads `prevLink` to decide ordering. So:

- `sequence` is the load-bearing precedence signal the engine consumes.
- `prevLink` exists to *derive* `sequence` (in the hydrator) and satisfy the
  invariant checks — the engine timing keys off `sequence` + `maxGap`.
- The model is single-predecessor / single-successor. **No parallel notion
  exists anywhere in the timing math.**

`sequence` itself is derived upstream in the API hydrator
(`state-hydrator.service.ts:816`, `deriveSequencesFromLinkId`) by walking
`prevLink` and assigning 1..N per chain; a producer-side invariant
(`assertSequenceMatchesLinkId`, `:895`) and an opt-in engine-side check
(`basescheduler.ts:125`, `CTP_VALIDATE_SEQUENCE`) enforce
`predecessor.sequence < successor.sequence` along every `prevLink` edge.

### 2.3 `detectLanes` is resource coherence, not parallelism
`detectLanes` (`chaincontextengine.ts:315`) groups tasks that share a *primary
resource preference* so the combo builder assigns them to one resource
consistently. It is orthogonal to precedence — it does **not** model parallel
branches.

### 2.4 Availability evaluation is a read-only snapshot; consumption is deferred to commit
- **Evaluation** (`propagateCombo`, `assignStartTimes`) only *reads*
  `staticAvailable` as a calendar (`workingEndForwardW` / `workingStartBackwardW`
  at `:618`, `:656`, `:871`, `:896`, `:930`, `:950`, `:978`). Nothing is
  decremented. Every task in a combo evaluates against the **same untouched
  snapshot**.
- **Consumption** happens only at commit: `commitChain` (`:1135`) →
  `scheduleEngine.schedule` → `addTaskToResource` (`scheduleengine.ts:155`)
  appends a `CTPAssignment(st, et, qty)` and sets `recompute = true`.
  Availability is recomputed lazily (`availableengine.ts:458`,
  `staticAvailable = subtract(original, assignments)`).

### 2.5 Capacity (qty) is already modeled — pooled and unit are the same machinery
- `CTPTaskResource.qty` defaults to `1.0` (`task.ts:44`) — a reusable draws one
  unit.
- Consumption window is class-based, in the set engine (`baseengine.ts`):
  - **Reusable** (`:130`): qty drawn over the assignment's `[st, et]`; segments
    where `qty === 0` are removed (unavailable). Default qty=1 → exclusive over
    the window. *Unit-machine exclusivity is just qty hitting 0.*
  - **Consumable** (`:145`, `:163`): draw extends to **end of horizon**
    (`a.tail.data.endW = a.endOfHorizon`) — a depleting running balance.
- Availability is evaluated **identically** for both classes (qty subtract over
  intervals). Only the assignment *window* differs (scheduled window vs horizon).

**Implication:** "pooled resource" is not a new concept — it is `qty > 1`. A unit
machine is `qty = 1`. Both are already handled at the booking/availability layer.

---

## 3. The gap parallelism actually exposes

Because evaluation is snapshot-based and consumption is commit-deferred:

- **Across chains / solve cycles → correct.** Chain A commits, `recompute`
  fires, chain B's evaluation sees A's draw. Sequential tasks self-correct via
  commit + recompute.
- **Within a single combo → blind.** Two tasks evaluated in the same combo read
  the same snapshot; neither sees the other's draw. This was always safe because
  **linear chains time-separate their tasks** — even on the same resource they
  never overlap. **Parallelism breaks exactly that assumption.**

Commit does not save us: `commitChain` just appends assignments and does not
re-validate qty. Two concurrent siblings on the same `qty=1` resource (or
over-drawing a `qty=N` pool) would **silently over-subscribe**; the recompute
produces over-drawn availability rather than a rejection.

So the **only true new gap** is **intra-combo concurrency accounting** for
overlapping siblings. The capacity-accounting substrate itself already exists.

---

## 4. Proposed model

### 4.1 Precedence: `sequence`-as-rank, barrier semantics
Promote `sequence` from a unique ordinal to a **topological rank (level)**:

- Equal `sequence` ⇒ tasks are **concurrent** (same level).
- Rank *k+1* depends on rank *k* (barrier: all of *k* before any of *k+1*).
- "Same sequence ⇒ shared successor" — equal-rank siblings converge on a common
  next task. This specifically encodes **fork → join (diamonds)**.

**Expressiveness boundary (decide deliberately):**
- Clean fork → barrier → join (diamonds), branches synchronized at each level:
  rank model is the proportionate choice.
- Need **unequal-length branches** or **partial dependencies** (a task depending
  on only *some* concurrent siblings): the rank model can't express it — that
  requires a true DAG (`prevLink` → `prevLinks: string[]`, edge-driven
  topological propagation, `sequence` demoted to display/tiebreak). Larger change.

The existing invariant survives ranks unchanged: it checks
`predecessor.sequence < successor.sequence` only along `prevLink` edges, and
same-rank siblings have no edge between them, so equal sequences never trip it.

### 4.2 Resource correctness: soft allocation (reusing existing primitives)
With parallelism, intra-combo accounting is needed *only if* concurrent siblings
can share a resource. Two paths:

**Now (scoped): assume disjoint resources across parallel branches.**
Parallel branches use different resources (data/modeling guarantee). No soft
ledger needed. Add a **cheap, qty-aware guard** (not identity-based): after
assigning a combo, for each resource sum the `qty` of time-overlapping concurrent
assignments and assert ≤ the interval `qty`. Permits pools, flags real
violations, fails loud instead of emitting an infeasible schedule.

**Later (if the disjoint assumption is dropped): intra-combo soft allocation.**
The "temporary soft allocation so the next sibling sees the previous draw"
pattern. It is **class-agnostic** because availability evaluation is identical
across classes — a temporary qty-subtract makes the next sibling correctly see a
unit reusable as unavailable (qty→0), a pool as reduced (qty−1), or a consumable
as a lower balance.

The primitives already exist:
- **Snapshot/restore:** `AvailableMatrix.staticAvailableCopy` +
  `revertAvailable()` (`availablematrix.ts:61`).
- **Consume:** `subtractEngine` + the class-aware `CTPAssignment(st, et, qty)`
  already built by `addTaskToResource` (`scheduleengine.ts:147`).

Implementation = apply the commit-time subtract to a **throwaway copy** inside
the `assignStartTimes` sibling loop, then `revertAvailable()` at the end
(evaluation must not mutate the real ledger that other combos/chains read).

---

## 5. Work items

### Precedence (the core change)
1. **Rank-aware `propagateCombo`** (`chaincontextengine.ts:585`): group combo
   tasks by rank; forward floor = `max` effective-end across rank *k*; backward
   symmetric; `maxGap` measured against the latest predecessor end.
2. **Rank-aware anchor/assign** (`identifyPrimary` / `assignStartTimes`,
   `:832`): handle multiple tasks per rank instead of a single spine.
3. **Hydrator leveling** (`deriveSequencesFromLinkId`): replace the 1..N
   single-successor walk with topological ranking (longest-path);
   `successorOf` becomes multi-valued.

### Resource (scoped)
4. **qty-aware concurrency guard** (cheap, ship with the disjoint-resource
   assumption).
5. *(Deferred)* **Intra-combo soft allocation** via snapshot/subtract/revert —
   only if concurrent siblings may share a resource.

---

## 6. Open questions
- **Topology:** are WO-group parallelisms always clean diamonds (rank model
  suffices), or do they need unequal branches / partial deps (true DAG)?
- **Anchor semantics under ranks:** primary per rank, or one primary for the
  whole chain? Affects how `assignStartTimes` walks outward.
- **maxGap on a join:** single successor `maxGap` measured against the latest
  predecessor end is the proposed rule — confirm it matches business intent.

---

## 7. Bottom line
Nothing here is greenfield. Parallelism = **rank-aware precedence** +
**reusing the existing availability machinery across concurrent siblings**. The
capacity/qty model already handles pooled and unit uniformly; the only genuinely
new accounting is intra-combo concurrency, which is the soft-allocation pattern
with snapshot/subtract/revert primitives already present in the codebase.

---

## File reference index
| Concern | Location |
| --- | --- |
| Chain grouping by `linkId.name` | `packages/engine/Models/Entities/landscape.ts:53` |
| Linear precedence propagation | `packages/engine/Engines/chaincontextengine.ts:585` |
| Start-time assignment (anchor) | `packages/engine/Engines/chaincontextengine.ts:832` |
| Commit / consume | `packages/engine/Engines/chaincontextengine.ts:1135`, `scheduleengine.ts:125` |
| Lane (resource coherence) detection | `packages/engine/Engines/chaincontextengine.ts:315` |
| Availability snapshot/restore | `packages/engine/Models/Intervals/availablematrix.ts:61` |
| Lazy availability recompute (subtract) | `packages/engine/Engines/availableengine.ts:458` |
| Class-based consumption window | `packages/engine/Engines/baseengine.ts:130` (reusable), `:163` (consumable) |
| `qty` default = 1 | `packages/engine/Models/Entities/task.ts:44` |
| `sequence` derivation from `prevLink` | `packages/api/src/modules/state/state-hydrator.service.ts:816` |
| Sequence invariant (producer) | `packages/api/src/modules/state/state-hydrator.service.ts:895` |
| Sequence invariant (engine, opt-in) | `packages/engine/AI/Schedulers/basescheduler.ts:125` |
