# Sprint: Cross-WO Precedence Enforcement via Component Grouping

**What it does:** Makes cross-work-order precedence actually enforced during the solve, not just wired into the data model. Changes the unit of chain construction from "one `linkId.name`" to "one connected precedence component," so a parent WO and the child WO that feeds it are evaluated together and their cross-WO edge is honored by the existing adjacency machinery.

**Size:** Est. medium — reshapes chain construction. Phase 0 is investigation only; do not start Phases 1+ until Phase 0 findings are returned and the design is confirmed.
**Depends on:** Cross-WO linking hydrator work (edges already wired; `predKey` present on solved data).
**Triggers:** slim-100 live test — 10 cross-WO links wired, edge present (`29575-A-1.predKey === "29576-QC-4"`), but all 9 wired pairs schedule the parent *before* the child. Precedence is not enforced.

---

## Why

The defect is confirmed at the source. Two facts in the code combine to drop the edge:

1. `Landscape.buildProcesses()` (landscape.ts:41–67) groups tasks **strictly by `linkId.name`** — one process = one WO:

   ```ts
   this.tasks.forEach(t => {
     if (t.hasLinkId() && t.linkId?.name) {
       let newP = this.processes.getEntity(t.linkId.name);   // keyed by linkId.name
       if (!newP) { newP = new CTPProcess(t.linkId.name); ... }
       newP.tasks?.add(t);
     }
   });
   ```

2. `ChainContextEngine.evaluateChain` (chaincontextengine.ts:152–159, and again ~270) rebuilds adjacency over **that single-WO subset**:

   ```ts
   const tasks = chain.tasks;        // exactly ONE linkId.name
   buildAdjacency(tasks);            // preds/succs over THIS WO only
   ```

The cross-WO predecessor (`29576-QC-4`) lives in a *different* `linkId.name` (`29576`), so it is not in `tasks`. `realPrevKey` finds nothing in the subset, the edge is dropped, the parent head ends up with no predecessor, and it schedules at its own window start — early.

The unit tests passed because they ran `buildAdjacency` over the **full** task set, where both endpoints exist. The live scheduler rebuilds per-WO, which strips the cross-chain edge. The spec assumption "the engine respects preds/succs" is true for the global edge list and false for the per-process rebuild.

### Architecture decision (locked)

Three options were on the table:

- **A — group linked WOs into one schedulable component** (this sprint). The unit of evaluation now matches the unit of precedence.
- **B — keep per-WO evaluation, add a solve-time window-floor + cross-process ordering.** Smaller, but embeds a process-level orderability assumption that fails on interleaved cross-WO dependencies, and re-derives the dropped edge through a side channel that must be maintained under backtracking.
- **C — ship wired-but-not-enforced, defer.**

**A is chosen.** No deadline; correctness over speed. A is a *strict generalization*: a WO with no cross-WO links is its own component, so its process is identical to today. Only tenants with cross-WO links change behavior — exactly the ones currently broken. It also makes the live path satisfy the same invariant the passing unit tests already encode (adjacency over the full relevant set).

B's mechanism is not discarded — it reappears in its correct niche (Phase 5: committed predecessors outside a partial solve).

---

## Phase 0 — Confirm before building (investigation only)

Do this first, report findings, then stop. The design below rests on assumptions about code you've read and I haven't. If any of these is false, flag it — it changes the plan.

**0a. Multi-predecessor merge in the ready-frontier.** Once a process spans WOs, `buildAdjacency` will see **branching and merging** — e.g., two child WOs feeding one parent (a task with multiple predecessors). A single-WO routing is usually linear; a component is a DAG. Confirm:
- Does the current topo / ready-frontier logic correctly handle a task with **more than one** predecessor (earliest start = max over all predecessor ends, not just the last one in a linear chain)?
- Where exactly is that computed, and does anything assume a linear single-predecessor chain?

This is the load-bearing assumption. If the frontier only handles linear chains, that's additional in-scope work and Phase 3 grows.

**0b. Process identity coupling.** Grep every consumer that reads a process key / `linkId.name` as if process == WO. Expected: Case/Order Gantt grouping, chain-integrity KPI, `processingRanks` head-WO keying. Report the full list — there may be more than these three.

**0c. `buildAdjacency` source.** Confirm `buildAdjacency` derives preds/succs from `prevLink`/`predKey` only, and that feeding it a multi-WO task set requires no change beyond the larger input. Confirm the second call site (~line 270) has the same subset behavior.

**Return:** answers to 0a–0c, and a flag on any assumption below that the code contradicts. Then await confirmation.

---

## The locked design (ratify against Phase 0 findings)

### 1. Grouping runs at hydrate, not in `buildProcesses`

The hydrator already wires the cross-WO `prevLink` edges. Add a **union-find pass over the full `prevLink` graph** (intra-WO and cross-WO edges alike) and stamp each task with a `componentKey`. `buildProcesses` then changes from grouping by `linkId.name` to grouping by `task.componentKey`. Relationship derivation stays in the hydrator; the engine stays a grouper-by-precomputed-key. The engine diff is one line.

### 2. Component identity = head WO

A multi-WO component needs a stable key. Use the **head WO**: the WO owning the component's terminal task — the sink with no successors leaving the component. For BOM parent-child that's the final-assembly WO. This matches the existing head-WO keying on `processingRanks`, so a component's identity and its rank share a root. Single-WO components keep `linkId.name` as their key (strict generalization).

### 3. Decouple display grouping from scheduling grouping

Process == WO breaks for multi-WO components. **Do not try to preserve 1:1.** Split the two groupings explicitly:

- **Case/Order Gantt** stays keyed on `linkId.name` — operators think in WOs. Add cross-WO predecessor arrows drawn *between* WO rows. (Better UX than collapsing WOs into one row.)
- **Chain-integrity KPI** runs over the **component** — so it finally catches cross-WO predecessor violations, which it was silently passing before — then rolls up per WO for display.
- **`processingRanks`** become **per-component**, keyed on head WO. The sequence sort now orders *components*, not individual WOs. This is more correct: a parent and its child WO move as a unit; the sort must not interleave them.

### 4. The component is a DAG

Covered by Phase 0a. The design assumes the ready-frontier already does max-over-predecessors. Confirm before relying on it.

### 5. Cross-WO edges are precedence-only — `maxGap: null`

A subassembly can sit in inventory before the parent consumes it. Cross-WO edges must default to `maxGap: null`. Ensure the hydrator does **not** inherit an intra-WO `maxGap` onto a cross-WO edge.

### 6. Partial / Solve-Selected solves — committed-predecessor floor

When re-solving one WO of a component while its cross-WO predecessor is already scheduled and **pinned outside the solve scope**, there is no in-scope edge to honor. Floor that task's window from the predecessor's **committed end time** read from the landscape. This is B's window-floor used correctly: not as the enforcement mechanism for full solves (Phase 1–3 handle those), but as the out-of-scope-committed-predecessor path for incremental solves. This is what makes "partial subset scheduling works automatically" actually true.

---

## DO / DON'T

**DO**
- Derive components at hydrate via union-find over the full prevLink graph; stamp `componentKey`.
- Make `buildProcesses` group by `componentKey`; keep the engine diff minimal.
- Key multi-WO components on the head WO (terminal-task owner).
- Keep Case/Order Gantt keyed on `linkId.name`; add inter-WO arrows.
- Run chain-integrity over the component; roll up per WO.
- Make `processingRanks` per-component, keyed on head WO.
- Default cross-WO edges to `maxGap: null`.
- Floor windows from committed predecessor ends for partial solves only.

**DON'T**
- Don't group in `buildProcesses` itself — grouping is a hydrator concern.
- Don't preserve process == WO. Decouple display from scheduling instead.
- Don't add the window-floor as the full-solve enforcement path — that's A's job; the floor is for committed out-of-scope predecessors only.
- Don't inherit intra-WO `maxGap` onto cross-WO edges.
- Don't change scheduling behavior for tenants with no cross-WO links. If a non-cross-WO tenant's schedule changes, something is wrong.

---

## Phases (after Phase 0 confirmed)

1. **Hydrate — component derivation.** Union-find over full prevLink graph → `componentKey` per task; compute head WO per component.
2. **`buildProcesses` rekey.** Group by `componentKey` instead of `linkId.name`. Multi-WO components get the head-WO key; single-WO components keep `linkId.name`.
3. **DAG / merge handling.** Per Phase 0a findings — confirm or extend the ready-frontier for multi-predecessor merges within a component.
4. **Display / KPI / rank reconciliation.** Case/Order Gantt arrows; chain-integrity over component; per-component `processingRanks`.
5. **Partial-solve floor.** Committed-predecessor window-floor for incremental / Solve-Selected solves.

---

## Verification (against slim-100 ten-link fixture)

- [ ] **The 9 wired pairs now schedule predecessor-end ≤ successor-start.** This is the headline acceptance — it's the exact thing that failed in the live test.
- [ ] The 10th link (whatever distinguished it from the 9) behaves correctly per its structure.
- [ ] **Strict-generalization check:** a tenant with no cross-WO links produces a schedule identical to pre-sprint output. (Run a non-cross-WO tenant before/after; diff the solve result.)
- [ ] Chain-integrity KPI now flags a cross-WO violation when one is artificially introduced (it passed silently before).
- [ ] Multi-predecessor merge: a component with two child WOs feeding one parent schedules the parent after the **later** of the two children.
- [ ] Partial solve: re-solving the parent WO alone, with the child pinned, floors the parent head at the child's committed end.
- [ ] `processingRanks` order components as units — a parent/child pair is not interleaved with an unrelated WO between them.

---

## Out of scope

- Parallel-WO-groups sprint proper (this is the grouping change that sprint will build on, scoped to the enforcement bug — but its other concerns are not here).
- Sequence editor UI / new sequences.
- maxGap *tightening* propagation beyond setting cross-WO edges to null.
- Any change to the snapshot read-surface / load path.
- Bump-backtracking interaction tuning beyond confirming the edge lives in the adjacency graph (which makes backtracking honor it for free).

---

## Open questions for Chris (only if Phase 0 contradicts the design)

- If the ready-frontier does **not** handle multi-predecessor merges today, do we extend it here, or split that into its own engine sub-sprint?
- If process identity is consumed in more places than the three listed in 0b, which additional ones need reconciliation vs. can stay WO-keyed?
- Head-WO definition for a component that is *not* a clean tree (multiple sinks) — does slim-100 contain any such case, or is "single terminal task" safe to assume for now?
