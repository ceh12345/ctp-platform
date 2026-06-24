# Sprint: Cross-WO Precedence Enforcement (rev — B+ / per-WO chains + window-floor)

**Supersedes** the component-grouping draft. CC's measurements broke that draft's load-bearing premise; this rev changes the architecture. See "Why the architecture changed" below.

**What it does:** Makes cross-work-order precedence actually enforced during the solve. Keeps the chain = one WO (so the combo engine stays in its useful regime), derives connected components and a WO-level topological order as *hydrate metadata*, evaluates WO chains in that order, and floors each task's window by its committed cross-WO predecessor's scheduled end. The WO stays the scheduling unit; components are metadata, not the evaluation unit.

**Size:** Est. small–medium. Engine diff is small (sort key + a pre-evaluation window-floor). The new work is a hydrate pass (union-find + WO-topo + cycle check) and separable UI (inter-WO arrows). Smaller blast radius than the grouping approach — `buildProcesses` is untouched.
**Depends on:** Cross-WO linking hydrator work (edges wired; `predKey` present on solved data).
**Triggers:** slim-100 live test — 10 cross-WO links wired, edge present (`29575-A-1.predKey === "29576-QC-4"`), but all 9 wired pairs schedule the parent *before* the child. Precedence is not enforced.

**Status:** ✅ **Phase-1-ready** — Phase 0 confirmed, all design decisions resolved. The section directly below is authoritative; where earlier prose in this doc differs, this wins.

---

## Phase 0 — RESOLVED + Final Decisions (authoritative)

### Phase 0 findings
- **0a Combo regime — confirmed, *tighter* than assumed.** `hardLimit` default = 500 (`maxChainCombos ?? 500`); `perSetCap = max(3, floor(500^(1/n)))` floors at 3 once **n ≥ 5** (not ~7). Useful exploration is **n ≤ 4–5** → keep the evaluation unit per-WO; do **not** enlarge to the component. *(Corrects §0a's "~n ≤ 7".)*
- **0b Acyclic + single-sink — holds.** Across both tenants: **0 cyclic, 0 multi-sink** (slim-100: 10 multi-WO components, depth ≤ 2; engineering-test: 60 multi-WO components, max **51 WOs but depth 3**, single sink). Head-WO identity well-defined; WO-topo order exists.
- **0c Real vs artifact — clean.** The artifact signature (cycles / multi-sink tangles) is absent; shape is genuine BOM (acyclic, single-sink, shallow wide fan-in). **No cleansing prerequisite.** Under B+ component *size* is engine-irrelevant (chains stay per-WO), so a stray edge is at worst an unnecessary wait, not an explosion.

**Decision-tree outcome:** 0b holds + 0c clean → **B+ as written.**

### Multi-predecessor merge — PRIMARY case (not an edge case)
`assignStartTimes` already places a successor at the **MAX over all predecessors** (`chaincontextengine.ts:1265-1272`); `topoOrder`/ready-frontier already count all preds. A parent with two cross-WO children waits for the **later** child for free. Treat multi-pred merge as the primary case in tests, not an afterthought.

### realPrevKey relaxation — REVERT (clean, no hole)
Revert the groundwork's `realPrevKey` group-relaxation; adjacency returns to within-chain only. **No enforcement hole**, because precedence flows from the wired `prevLink` into each path's own mechanism:
- **Constructive + bump-retry:** floor lives in `tightenWindowFromPredecessor` (`basescheduler.ts:637`, called `:585`). It floors by `task.preds`; since the cross-WO pred is no longer in `preds`, **extend it to also read the cross-WO `predKey`** (`linkId.prevLink` whose owner is outside the chain) and floor by that pred's committed end.
- **Optimizer (Tabu/ILS, opt-in tiers):** needs **no change**. `DisjunctiveGraph.buildFromLandscape` builds conjunctive (precedence) arcs **directly from `linkId.prevLink`** (`disjunctivegraph.ts:164-171`, no same-chain guard), and tabu moves only swap **disjunctive resource arcs** within critical blocks (`tabusearch.ts:83-90`) — conjunctive arcs are inviolable. Cross-WO precedence is preserved through optimization independent of `realPrevKey`.
- One source (`prevLink`), two path-appropriate enforcements. **Keep** the hydrator wiring + the `assertSequenceMatchesLinkId` same-chain scoping (both still needed). **Drop** the 2 adjacency tests asserting cross-WO edges in `preds`/`topoOrder`.

### Final decisions (D1–D5)
**D1 — Inter-component sort key:** `(headWO_leadTask.rank, WO_topoPosition, existing_intra_chain_tiebreak)`.
- `headWO_leadTask` = the head WO's **first schedulable task** (the component's topological-root WO's lead task) — the exact scalar that head WO would sort on standalone today. Not "min rank across component," not "head task rank" loosely — name the task.
- Within a component, child WOs precede the parent by `WO_topoPosition`; within a WO, existing order untouched.
- **Strict-generalization assertion (must hold):** a single-WO component yields the **identical** sort scalar it has today (head WO = the WO, topo position = 0). If not, the key is wrong. Processing Sequences later replaces only the first term with a component rank; key structure unchanged.

**D2 — Multi-sink → fail loud.** Component acyclic but with >1 terminal WO → **throw at hydrate**, naming the component + terminal WOs (same message family as the cycle throw). No silent lowest-key tiebreak. Legitimate multi-sink BOMs (co-products, split assemblies) are a deliberate future extension, own sprint.

**D3 — UI inter-WO arrows → REMOVED to backlog.** Out of this sprint. Backlog one-liner: *"Cross-WO predecessor arrows on the Case/Order Gantt — pure frontend; cross-WO edges + component membership are already on the hydrated model after the enforcement sprint, so no engine work."*

**D4 — Partial / Solve-Selected floor → IN v1.** Same floor code reading committed ends from the landscape; only new surface is the pinned-predecessor-outside-scope test. Solve-Selected (rush-order, rebalance) is a primary operator workflow — enforcing on full solves but dropping on partials works in the demo and breaks in daily use.

**D5 — Cascade-infeasibility → reuse `dependency` conflict type.** Don't mint a new type. **Requirement:** the reason names the **specific blocking predecessor WO/task key** (e.g. "cross-WO predecessor `29576-QC-4` unscheduled"), not the component — critical given 0b's ~50-way fan-in.

### maxGap (cross-cutting)
Hydrate sets `maxGap = null` **directly** on the cross-WO edge (do not inherit the incidental chain-head null). One fix protects both the floor and the conjunctive arc. **Add a test** asserting the cross-WO edge's `maxGap` is null, so a future change to chain-head handling can't silently introduce a gap constraint on a cross-WO link.

### Verification deltas (fold into the list below)
- Merge "10th link" into the cascade item: predecessor unscheduled → successor reported blocked with the **specific predecessor named**, never scheduled early. (Reconcile the count: 10 links vs 9 violations + 2 no-schedule — likely a pair-counting artifact; make the fixture's expected-results table exact.)
- Add an **optimizer test**: run an ILS-tier solve on the slim-100 fixture; assert the 9 pairs stay ordered (locks the conjunctive-arc protection).
- Add a **strict-generalization scalar check** for D1: a non-cross-WO tenant produces byte-identical sort scalars pre/post.

---

## Why the architecture changed

The previous draft chose **A** (make the chain a connected component so the cross-WO edge is in the adjacency the engine already honors). CC's measurements break the premise:

- Max component is **6 WOs / 25 tasks** on slim-100 and **51 WOs / 163 tasks** on engineering-test. Today a chain is one WO ≈ 2–6 tasks.
- `ChainContextEngine.evaluateChain` doesn't merely group — it enumerates combos across the chain's tasks under a per-task cap (chaincontextengine.ts:557): `perSetCap = Math.max(3, Math.floor(Math.pow(hardLimit, 1/n)))`. That floors at 3 once `n` exceeds roughly `ln(hardLimit)/ln(4)` — i.e. **n ≈ 6–7**. A 25- or 163-task chain is simultaneously expensive (O(n) propagate/assign × many combos) and low-quality (the cap explores essentially none of the space).

So A only protects tenants that don't change; the one tenant that *does* change (Stafford) is exactly where A converts well-sized chains into chains the combo engine can neither explore nor place. The fix CC proposed for that — place large components by topological waves (task-by-task, max-over-preds, which `assignStartTimes` already does) — **dissolves A's only advantage**: once you place topologically rather than by whole-component combo enumeration, "evaluate the component as one chain" buys nothing. A and the scalable version of A converge on *per-WO chains + topological order + window-floor*. That is B.

B's earlier rejection was the interleaving objection — cross-WO deps could form a WO-level cycle. That objection does **not** hold for one-directional BOM parent/child: a tree is acyclic at the WO level, a topological order exists, and the per-task floor gates only the linked task (not whole-WO serialization). For tree-structured precedence, B is correct, keeps chains small, and needs no new placement mode. It also breaks **zero** downstream consumers (process stays `linkId.name`-keyed), whereas A breaks ~10 sites that assume process == WO (ctp.service.ts:3144, timing.ts:87, dependencylookahead.ts:79/104, both chain neighborhoods, ~6 more in ctp.service.ts).

**Decision: B+ (B with hydrate-derived components, WO-topological ordering, and fail-loud on WO-level cycle), conditional on Phase 0 confirming the tree preconditions.**

---

## Phase 0 — Confirm before building (investigation only)

CC already answered the process-coupling and adjacency questions; the open items are the two preconditions and one data-quality check. Report findings, then stop.

**0a. Combo cost — confirm the regime.** Confirm `evaluateChain` behavior at n = 25 / 100 / 163 (the measured maxes) and that the useful-exploration threshold is ~n ≤ 7. This is the evidence base for keeping chains WO-sized; it should confirm we do **not** want to enlarge the evaluation unit. (Mostly already characterized — confirm the threshold and the n=163 cap=3 behavior.)

**0b. WO-level acyclicity + single sink.** B+'s correctness precondition. For each connected component:
- Is the component a **DAG at the WO level** (a valid WO topological order exists)?
- Does it have a **single terminal WO** (one sink with no successors leaving the component), so head-WO identity is well-defined?
- Report the worst cases on engineering-test — a 51-WO component is unlikely to be a clean single-sink tree by inspection.

**0c. Real vs. artifact.** Are the deep components (51 WO / 163 task) genuine BOM assemblies, or inflated by the known CTP↔Genius linking inconsistency — the same data issue behind the "Horizon 1" entries and the operation-count discrepancy? Quantify. If the edges are partly spurious, the fix is **data cleansing at hydrate**, not engine work, and the real max component is much smaller. This also bears on 0b: spurious edges are exactly what would manufacture a WO-level cycle or a multi-sink mess.

**Decision tree from Phase 0:**
- 0b holds (acyclic, single sink) and 0c clean (or cleansed) → **B+ as written.**
- 0b fails because of spurious edges (0c) → **cleanse at hydrate first**, then B+ on the cleaned graph.
- 0b fails on *genuine* WO-level cycles → that's a data error with no valid schedule order; **fail loud** (see §3). Do not paper over it in the engine.
- Genuine non-tree-but-acyclic precedence with multiple sinks → B+ still works for ordering and floor; only head-WO identity needs a tiebreak rule (deterministic pick among sinks). Flag to Chris rather than guessing.

---

## The design (ratify against Phase 0)

### 1. Hydrate derives components as metadata — not the evaluation unit
Add a **union-find pass over the full `prevLink` graph** (intra- and cross-WO edges) and stamp each task with a `componentKey`. Compute, per component, the **WO-level topological order** and the **head WO** (terminal-WO owner). These are metadata for ordering, validation, and ranking. `buildProcesses` is **unchanged** — chains stay keyed by `linkId.name`, WO-sized.

### 2. Evaluation order = (component rank, WO-topological position)
The engine sorts WO chains by a composite key: the **component's** rank first, the **within-component WO topological position** second. Effect: components are ordered relative to each other by rank; inside a component, child WOs are always evaluated before the parent WO that consumes them. This guarantees a cross-WO predecessor is already scheduled when its successor is evaluated.

> Note: per-component ranking is a forward dependency on the (unbuilt) Processing Sequences sprint — see §6. For *this* sprint, the topological position alone is sufficient to fix enforcement; the component-rank tier layers in when that sprint lands.

### 3. Enforcement = topological order + committed-predecessor window-floor (one mechanism)
The cross-WO edge is **not** in the per-WO adjacency (its other endpoint is in another WO), so it is honored explicitly: before placing a task, if it carries a `predKey` whose owner is **outside the current WO chain**, look up that predecessor's scheduled/committed end from the landscape and floor the task's window by it. Then normal intra-WO propagation flows it forward.

This single mechanism covers both cases:
- **Full solve** — predecessor is already scheduled (topological order guarantees it).
- **Partial / Solve-Selected** — predecessor is pinned/committed outside the solve scope; the floor reads its committed end regardless of order. This is what makes "partial subset scheduling works automatically" true.

**Cascade infeasibility:** if a cross-WO predecessor is unscheduled/infeasible, the successor cannot be floored — mark it blocked with a clear reason ("cross-WO predecessor `X` unscheduled"), don't silently schedule it early. Ties into the rich-infeasibility reporting from the bottleneck sprint.

### 4. Fail loud on WO-level cycle
If hydrate's topological sort finds a cycle at the WO level, that is a data error (no valid order exists) — throw at hydrate with the offending WOs named. Consistent with the fail-loud-on-bad-keys principle. Never schedule a component with a cyclic WO graph.

### 5. Cross-WO edges are precedence-only — `maxGap: null`
A subassembly can sit in inventory before consumption. Cross-WO edges default to `maxGap: null`; ensure hydrate does not inherit an intra-WO `maxGap` onto a cross-WO edge.

### 6. Processing Sequences (forward note — not work in this sprint)
The ranking layer is the next sprint and is unbuilt; there is nothing to "reconcile" here. Instead, **author that sprint component-aware from the start**: rank by component (head-WO keyed), with the within-component WO topological order as a hard constraint layered on the rank. Sequence ranks order components; topology orders WOs inside one. Capture this as a requirement on that sprint.

### 7. Case/Order Gantt — inter-WO arrows → REMOVED to backlog (see D2/D3 above)
**Out of this sprint.** Pulled to a backlog item: cross-WO predecessor arrows on the Case/Order Gantt (stays keyed on `linkId.name`, one row per WO; arrows drawn *between* WO rows). Pure frontend — the data it needs (cross-WO edges + component membership) is already on the hydrated model after this sprint, so it must **not** be re-scoped as engine work.

---

## DO / DON'T

**DO**
- Keep `buildProcesses` keyed by `linkId.name`. Chains stay WO-sized.
- Derive components, WO-topological order, and head WO at hydrate as metadata.
- Sort WO chains by (component rank, WO-topological position).
- Enforce cross-WO precedence with the committed-predecessor window-floor.
- Fail loud at hydrate on a WO-level cycle.
- Default cross-WO edges to `maxGap: null`.
- Mark a successor blocked (with reason) when its cross-WO predecessor is unscheduled.

**DON'T**
- Don't enlarge the evaluation unit to the component — that lands chains in the n≫7 regime where the combo cap explores nothing.
- Don't rekey `buildProcesses` to `componentKey` — it breaks ~10 process==WO consumers for no benefit under B+.
- Don't put the cross-WO edge into the per-WO adjacency (its endpoint isn't in the subset).
- Don't inherit intra-WO `maxGap` onto cross-WO edges.
- Don't schedule a component with a cyclic WO graph — throw.
- Don't change scheduling behavior for tenants with no cross-WO links.

---

## Phases (after Phase 0 confirmed)

1. **Hydrate — component + topo metadata.** Union-find over full prevLink graph → `componentKey`; WO-level topological sort per component; head WO; throw on cycle.
2. **Evaluation order.** Compose the sort key (component rank placeholder + WO-topological position). For this sprint, topological position is the operative term; rank tier is wired when Processing Sequences lands.
3. **Window-floor enforcement.** Pre-placement floor from committed cross-WO predecessor end; cascade-infeasibility on unscheduled predecessor.
4. **Case/Order Gantt arrows.** Inter-WO predecessor arrows (separable; can follow).

---

## Verification (against slim-100 ten-link fixture)

- [ ] **The 9 wired pairs now schedule predecessor-end ≤ successor-start.** Headline acceptance — the exact thing that failed live.
- [ ] The 10th link behaves correctly per its structure (CC: confirm what distinguished it from the 9).
- [ ] **Combo regime unchanged:** chains stay WO-sized; `perSetCap` on every chain is well above the floor of 3 (i.e. we did not enlarge the evaluation unit). Confirm n per chain is unchanged from pre-sprint.
- [ ] **Strict-generalization check:** a tenant with no cross-WO links produces a schedule identical to pre-sprint output.
- [ ] Injected WO-level cycle throws at hydrate, names the WOs, and does not solve.
- [ ] Cross-WO predecessor left infeasible → successor reported blocked with reason, not scheduled early.
- [ ] Partial solve: re-solving the parent WO alone, child pinned, floors the parent's linked task at the child's committed end.
- [ ] Multi-child merge: a parent task with two cross-WO predecessors floors at the **later** of the two committed ends.

---

## Out of scope
- Processing Sequences ranking (separate sprint; §6 is a forward requirement on it, not work here).
- `buildProcesses` reshape / component-as-evaluation-unit (rejected — combo cost).
- Dual-key process index (only needed under the rejected A).
- maxGap *tightening* propagation beyond setting cross-WO edges to null.
- Snapshot read-surface / load path changes.
- Data cleansing of spurious links — *unless* Phase 0c shows the deep components are artifacts, in which case cleansing becomes a prerequisite and gets its own scope.

---

## Open questions for Chris
- If Phase 0c shows the 51-WO components are largely artifacts of the linking inconsistency: cleanse first as a prerequisite, or proceed on the dirty graph and cleanse separately?
- Head-WO tiebreak for a genuine multi-sink (but acyclic) component, if 0b surfaces one: deterministic pick rule, or treat multi-sink as a data finding to escalate?
- Inter-WO Gantt arrows (§7): in this sprint or split to a UI follow-on?
