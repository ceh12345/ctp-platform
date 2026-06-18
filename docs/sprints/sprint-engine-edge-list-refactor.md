# Sprint — Engine Refactor to Explicit Pred/Succ Edge Lists

**Status:** Spec (ready for kickoff) — **sequenced after engine-optimization (see §0)**
**Date:** 2026-06-17
**Scope:** Engine — precedence representation
**Related:** `sprint-parallel-processes-wo-groups.md` (the capability this unblocks), `work-order-group-scheduling-questions.md` (Stafford discovery)

---

## 0. Sequencing dependency — land `feature/engine-optimization` first

**Do not run this in parallel with the engine-optimization branch.** Overlap
analysis (2026-06-17) of `feature/engine-optimization` (then ~42 commits ahead of
`main`) vs. this refactor's call-site inventory:

- **Clean — zero conflict:** every other file this refactor touches is untouched
  by the opt branch — `basescheduler.ts`, `landscape.ts`, `task.ts`, `timing.ts`,
  the neighborhoods, and **both `disjunctivegraph.ts` files** (so the planned
  topo-sort/adjacency reuse is safe).
- **Collision — one file, worst spots:** the opt branch changes
  `chaincontextengine.ts` (+272/−28), and its hunks land squarely on the two
  functions this refactor rewrites most heavily:
  - **forward-pass propagation** (`~609–644`)
  - **`assignStartTimes`** (`~839–851`, `~877–887`, `~905–1010`) — the one
    genuinely hard area of this refactor.
  (The backward pass `647–736` and `detectLanes` `315` were *not* touched by the
  opt branch.)

Run as two long-lived branches, this becomes a hand-reconciliation of the two
most complex functions in the engine — not a small merge.

**Required ordering:**
1. Land `feature/engine-optimization` to `main`.
2. Do this refactor against the optimized `main`. Because the refactor *rewrites*
   propagate / `assignStartTimes` anyway, it rewrites the already-optimized code —
   **no merge, just a rewrite of current code.**

**Do not invert the order:** doing the refactor first forces the opt branch to
re-derive its perf changes on top of the edge-list rewrite (its optimizations
were written against the linear `i±1` structure).

**Synergy:** run the opt branch's benchmark harness (`packages/engine/benchmarks/
ticket-*.ts`) as an extra Phase-1/2 gate — it guards that this behavior-preserving
refactor doesn't regress the perf wins, alongside the regression suite guarding
correctness.

---

## 1. Goal

Replace the engine's **implicit** precedence relationship (sequence adjacency
`i±1` / single `linkId.prevLink`) with an **explicit edge model**: each task
carries a `preds: string[]` and `succs: string[]` of task keys. Every
precedence decision becomes the same two-shape clamp:

- **forward (floor):** a task's earliest start is floored by `max` over its
  **preds**' effective ends.
- **backward (ceiling):** a task's latest start is ceiled by `min` over its
  **succs**' latest starts.

Today both lists are length-1 (or the implicit neighbor), so this refactor is
**behavior-preserving on all current (linear) data**. It is the structural
foundation that later makes parallel branches / DAGs (Work Order Groups) a data
change rather than an engine change.

### Why this is low-risk
The full regression suite is the safety net: with length-1 lists, `max`/`min`
over a single element is identical to the current single-neighbor logic. Any
behavioral drift on existing tenants is a bug, not a feature. (Tests run on every
commit — this is blast-radius containment, not a risk multiplier.)

---

## 2. Scope

### In scope
- New in-memory `preds[]` / `succs[]` adjacency on `CTPTask`, built by a single
  pass from existing `linkId.prevLink` (forward + reverse edges).
- Convert all precedence-decision call sites (inventory in §5) to consume the
  lists via `max(pred)` / `min(succ)`.
- Redesign `assignStartTimes` (the one non-mechanical area) to a topological
  fill that is correct for both linear chains and DAGs.
- Topological ordering of combo tasks (replacing the `sequence` sort as the
  *execution* order; `sequence` stays as a display/tiebreak field).
- New synthetic **DAG fixtures + tests** proving branch correctness, with the
  existing suite proving linear parity.

### Out of scope (explicitly deferred)
- **Producers emitting branched topologies.** The hydrator still derives
  single-parent linear data this sprint; `preds[]` stays length-1 from real
  tenants. No tenant data migration, no `prevLinks[]` serialization change.
- **Parallelism enablement** — barrier/rank semantics, multi-head derivation,
  multiple-sink due dates: waits on the Stafford topology answer
  (`work-order-group-scheduling-questions.md`, Q4).
- **Resource correctness for concurrent siblings** (intra-combo soft allocation /
  qty guard): not reachable until producers emit branches.

> The engine comes out of this sprint *able to represent and correctly schedule a
> DAG*, while every shipping tenant still runs exactly as today.

---

## 3. Data model

```ts
// CTPTask (in-memory, populated by adjacency build — NOT serialized this sprint)
preds: string[] = [];   // task keys this task depends on
succs: string[] = [];   // task keys that depend on this task
```

- **Source of truth this sprint:** still `linkId.prevLink` (single parent). A
  build pass fills `preds = [prevLink]` (when in-chain) and reverse-fills `succs`.
  Zero serialization change → zero tenant migration.
- **Do NOT reuse `task.rank`** — it already means *priority* (inherited from
  `entity`, used by `chainneighborhood`/`greedyneighborhood`). Keep `sequence`
  as the topological level for sort/tiebreak; precedence comes from the lists.
- **Build location:** extend `landscape.buildProcesses()` (or a sibling
  `buildAdjacency()`) — runs once per solve, after grouping by `linkId.name`.
- **Reuse:** the disjunctive-graph engines already build pred/succ adjacency from
  `prevLink` and provide Kahn's topological sort
  (`Engines/Optimization/disjunctivegraph.ts`). Mirror that, or extract the
  topo-sort + adjacency helpers so both share one implementation.

### Helper API (single chokepoint for all sites)
```ts
predsOf(task): CTPTask[]      // resolved, in-chain only
succsOf(task): CTPTask[]
maxPredEnd(task, bounds): number      // forward floor
minSuccStart(task, bounds): number    // backward ceiling
topoOrder(tasks): CTPTask[]           // Kahn's; falls back to sequence on cycle
```
Routing every site through these keeps the mechanical conversions uniform and
makes the length-1 == current-behavior guarantee auditable in one place.

### Resolution model — lists are KEYS, resolved once per evaluation
`preds[]`/`succs[]` hold **task keys** (strings), not object references — by
design:
- Keys are consistent with the existing model (`linkId.prevLink` is already a
  key) and with how the engine looks tasks up everywhere
  (`landscape.tasks.getEntity(key)`, the `byKey` maps in
  `assertSequenceMatchesLinkId` and the disjunctive graph). Keys survive
  serialization/sync; object refs don't.
- Computing `max(pred ends)` / `min(succ starts)` therefore requires a **lookup**
  per edge (key → task / key → working-array position). That is intended.

**Performance discipline — resolve once, use many.** The min/max runs in the
**innermost combo loop**, so the inner loop must do **zero map lookups**:
- At the start of each chain/combo evaluation, resolve every task's
  `preds[]`/`succs[]` keys to **positions in the combo's working array** (or to
  resolved refs) in a single pass — mirroring the disjunctive graph's
  `nodeIndex` (key → index) approach.
- The forward/backward passes then iterate over the pre-resolved positions.
- Keep this resolution inside the helper chokepoint (`predsOf`/`succsOf`/
  `maxPredEnd`/`minSuccStart`) so lookups live in exactly one place.

### Generated-task splicing (correctness, not just perf)
Engine-generated tasks (SETUP / TEARDOWN / changeover — the `mqj0…`-style
generated keys) are spliced into chains at solve time. Today that insertion
rides on `sequence` renumbering. With explicit edge lists it must be done **on
the edges**: inserting a SETUP between A→B means A's `succs` gains SETUP, SETUP's
`preds=[A]` / `succs=[B]`, and B's `preds` swaps A→SETUP. The adjacency build /
state-change insertion path must weave generated tasks into `preds[]`/`succs[]`,
not only into the sequence order. (Parity tests will catch a miss — generated
tasks would otherwise float free of the precedence graph.)

---

## 4. Phases

### Phase 0 — Foundation (no behavior change)
- Add `preds[]`/`succs[]` fields + adjacency build pass.
- Add helper API (§3) + `topoOrder` (reuse/extract from disjunctive graph).
- Unit tests for adjacency build + topo sort (incl. cycle fallback).
- **Gate:** full suite green, zero diffs in scheduling output.

### Phase 1 — Mechanical site conversion (behavior-preserving)
Convert the §5 sites to the helper API. Each is a `max(pred)`/`min(succ)` swap
that is identical for length-1 lists. Commit in small batches by file, running
the suite between batches.
- **Gate:** full suite green after each batch; scheduling output byte-identical
  on all tenant fixtures.

### Phase 2 — `assignStartTimes` redesign (the one hard area)
Current logic anchors on one primary task and walks strictly backward (ancestors)
then forward (descendants) — assumes a single spine. In a DAG a parallel sibling
of the primary is neither ancestor nor descendant and is never reached.
- Redesign to: anchor primary → topological backward fill (latest feasible start
  for every node, bounded by `min(succ starts)`) → topological forward fill
  (earliest feasible start, bounded by `max(pred ends)`).
- For a linear chain this reduces exactly to the current backward-then-forward
  walk.
- **Gate:** full suite green (linear parity) **and** new DAG-fixture tests pass.

### Phase 3 — DAG fixtures + capability tests
- Synthetic fixtures: simple diamond (fork→join), unequal-length branches,
  multi-sink fork. Built directly with `preds[]/succs[]` (bypassing the
  still-linear producer) to exercise the engine in isolation.
- Assert correct precedence (no successor before all preds end) and correct
  windows.
- **Gate:** new tests pass; existing suite still green.

---

## 5. Call-site inventory (from code audit, 2026-06-17)

### Core correctness — ~14 sites, 3 files
**`chaincontextengine.ts` (8):**
- `:102` / `:202` sort-by-sequence → `topoOrder`
- `:610-644` forward pass → floor by `maxPredEnd`
- `:647-687` backward pass → ceil by `minSuccStart`
- `:693-696` totalGap → vs latest pred end
- `:862-883` pred-candidate walk → walk `preds[]` paths
- `:888-907` succ-candidate walk → walk `succs[]` paths
- `:939-959` backward assign → per-edge succ
- `:960+` forward assign + `:998` gap → per-edge pred

**`basescheduler.ts` (4):**
- `:630` `tightenWindowFromPredecessor` → all preds (max) + succs (min)
- `:585-587` retry-skip → all preds scheduled?
- `:1055-1075` `addChainPredecessors` → multi-parent DFS over preds
- `:144-149` invariant check → iterate all edges

**`landscape.ts` (2):**
- `:280-311` constraint propagation → preds/succs max/min
- `:325-333` `hydrateDueDates` terminal detection → `succs[]` empty;
  ⚠️ multiple sinks possible (handle now even if data is linear)

### Selection / lookahead — ~5 sites (convert for completeness; linear-safe)
- `timing.ts:43-44` sequence `>=`/`<=` truncation → reachability via lists
- `dependencylookahead.ts` (`:33,44,65,69,72,85,88,107`) → frontier over lists
- `chainneighborhood.ts:64` next-task min-sequence → ready-succ frontier
- `chainfirstfitneighborhood.ts:48` sort → topo order
- `greedyneighborhood.ts:80` reporting only — low impact

### No change needed
- `identifyPrimary` (`:736`), `detectLanes` (`:315`) — order-agnostic.
- `sortBySequence` impls — pure display/iteration sort, keep.

### Producers (touch lightly this sprint)
- `buildProcesses` (`landscape.ts:53`) → also build adjacency.
- Hydrator `deriveSequencesFromLinkId` (API) → unchanged output, but becomes the
  future home for branched derivation (next sprint).

### Reuse, don't rebuild
- `Engines/disjunctivegraph.ts`, `Engines/Optimization/disjunctivegraph.ts` —
  existing pred/succ adjacency + Kahn topo sort.

---

## 6. Backward compatibility & invariants
- `linkId.prevLink` remains the serialized single-parent form — no tenant data
  changes.
- `assertSequenceMatchesLinkId` (producer) and the opt-in engine check generalize
  to "along every edge, `pred.sequence < succ.sequence`" — already edge-based,
  just iterate `preds[]`.
- Cycle handling: `topoOrder` falls back to `sequence` order and logs (mirrors
  the hydrator's existing cycle fallback).

---

## 7. Acceptance criteria
1. Full regression suite green at every phase gate.
2. Scheduling output **byte-identical** on all tenant fixtures after Phase 1 & 2
   (linear parity — the core guarantee).
3. New DAG-fixture tests pass (diamond, unequal branches, multi-sink).
4. `npx tsc --noEmit -p packages/api/tsconfig.json` clean (strict, matches CI).
5. No tenant data files modified.
6. Engine benchmark harness (`packages/engine/benchmarks/ticket-*.ts`, inherited
   from engine-optimization) shows no >5% regression after Phase 1 & 2.

---

## 8. Risks
- **`assignStartTimes` regression** — the only redesign; mitigated by linear
  parity tests + small DAG fixtures. Highest-attention area in review.
- **Hidden order assumptions** — some site may rely on array index beyond
  precedence (e.g. `combo.contexts[i]` alignment). Audit each conversion for
  index coupling; the helper API forces explicit edge resolution.
- **Topo sort vs `sequence` divergence** on malformed data — covered by cycle
  fallback + the invariant check.

---

## 9. Estimate
- Phase 0: ~0.5 day
- Phase 1: ~1–1.5 days (mechanical, batched, suite between)
- Phase 2: ~1–1.5 days (`assignStartTimes` redesign + parity)
- Phase 3: ~0.5 day
- **Total: ~3.5–4 days**, the bulk low-risk; concentrated attention on Phase 2.

---

## 10. What this unblocks
Once shipped, enabling parallel Work Order Groups becomes a **producer +
semantics** change (hydrator emits branched `preds[]/succs[]`, barrier/rank rules,
soft-allocation) — no further core-engine restructuring. The structural cost is
paid here, behind a behavior-preserving guarantee.
