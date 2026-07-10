# Sprint — Dispatch Strategy Seam (the "what to make next" model)

**Status:** 📐 Draft — ready to build; behavior-preserving default plug gates the risk
**Origin:** Research thread on look-ahead / current-state dispatch rules (ATC, DBR) and whether the scheduler architecture holds for them.
**Consumer:** `SPRINT-solver-comparison.md` (the KPI bake-off). The harness *uses* this seam to run dynamic strategies as comparable configs — but the seam is built and shipped **independently** of the bake-off and is useful on its own.

---

## Thesis — the two-model asymmetry

Constructive scheduling is two decisions, and CTP has built one of them well and the other as a stub:

| Decision | "The question" | In this codebase | Sophistication today |
|---|---|---|---|
| **Placement** | *Where does a chosen task best fit?* — which resource, which slot | `pickBestSchedule` + `ScoringEngine` (12 weighted rules, blended, min-max normalized) | **High** — a real weighted, multi-objective model |
| **Selection** | *What do we make next?* — which task/WO to schedule now | `INeighborhoodStrategy` (`ChainNeighborhood`), sort by precomputed `rank` | **Low** — a static single-key lookup |

The placement half is a Ferrari; the selection half is a bicycle. Every well-known dispatch rule we care about — **ATC** (Apparent Tardiness Cost), **DBR** (Drum-Buffer-Rope / Theory-of-Constraints release), sequence-dependent setups, campaign runs — is a *selection* improvement, not a placement one. DBR in particular has **no** opinion about *where* a task goes; it is purely a rule about *what order to admit work, gated by the constraint*. So it structurally cannot live in the placement model — it must live in selection.

**This sprint makes the selection model as pluggable and state-aware as the placement model already is.** It does not add a new layer; it elevates an existing one (`INeighborhoodStrategy` + `resolveStrategy()` are already a plug pattern) from "static sort" to "pluggable dynamic dispatch," with the current sort preserved as the trivial default plug.

### Why now

- These rules are **standard, well-studied scheduling policies**, not research risks.
- The seam is the leverage. Once it exists, ATC, DBR, ATCS, and future rules are each *one class + one registry line* — additive, no loop or harness changes.
- The default plug is a **behavior-preserving refactor** with a byte-for-byte parity gate, so the whole architecture ships at near-zero regression risk.
- A smarter constructive selection produces a better sequence up front, which **reduces the work the ILS/tabu optimization layer** (`Engines/Optimization/`) has to do to repair sequencing after the fact. The two efforts compound; they don't compete.

---

## Relationship to the bake-off (decoupling is deliberate)

The solver-comparison harness compares configs defined today as `(sequence, objective-weights)`. This seam adds a **third axis — the dispatch plug** — and *subsumes* the first:

| Bake-off config class | Dispatch plug | Sequence | Notes |
|---|---|---|---|
| EDD / Stafford-default / slack@t0 | `StaticRankPriority` | varies | The spec's existing "data-only" configs = default plug + a different processing sequence. |
| ATC | `ATCDispatchPriority` | default | **This sprint** unblocks it as a runnable, comparable config. |
| DBR | `DBRDispatchPriority` | default | **This sprint.** |
| Slack/CR (Stafford strategy) | `SlackDispatchPriority` | default | EDD-backwards least-slack within an op-code pool — Kaleb/Logan's rule (`slack = deliveryDate − asOf − remainingWork`). Same due-date family as ATC; additive plug. |
| ATCS, campaign, … | (future plugs) | default | Additive later; no harness change. |

The **fairness invariant** the bake-off rests on ("only the scheduling policy varies between runs") is preserved *because* every plug reads the same shared `DispatchState` lens — so "now," "the bottleneck," and "average remaining work" are defined **once, one way**, and any KPI difference is attributable to the policy, never to two rules disagreeing about what the clock is.

**Boundary:** this sprint ships the seam + plugs + a parity gate. Wiring the dispatch axis into the bake-off's config manifest and comparison surface is the harness sprint's job, not this one. This sprint's only obligation to the harness is that a dispatch plug is selectable per solve and reads a shared, read-only state window.

---

## Client strategy alignment (Kaleb + Logan, mid-week email)

Stafford independently designed a scheduling strategy. It maps onto this seam almost entirely — validating the selection-model architecture from the customer side — and the exercise located the few items that need a home elsewhere. Captured here because it is the concrete first consumer of the seam and it resolves a long-open data question.

**What is a selection plug (this seam's job):**
- **The core rule is EDD-backwards / least-slack.** "Working backwards from the job delivery date, remaining hours and tasks, work out the priority of each task relative to others with the same operation code." That is a critical-ratio computation — `slack = deliveryDate − asOf − remainingWork`, ranked within an operation-code pool — the same due-date-driven family as ATC. It is a **named dynamic plug** (slack/CR), additive next to ATC/DBR: one class + one registry line. Their output ("update task sequence numbers 1..N within an op-code pool") is exactly the ranked pick this seam emits.
- **Their headline KPI is our signed gap.** Point 5 — the "production delivery gap," job-in-date (floating) vs. job-delivery-date (fixed), positive or negative — **is** the bake-off's signed customer-date gap. Same number, same sign convention. Convergence, not a new metric.

**What is placement, not selection (the important gap to set expectations on):**
- Points 3.i–3.ii flag that Stafford writes the sequence number at **work-order level** and lacks the granularity to spread "100 open fabrication tasks across 10 fabricators" — the top-ten tasks can all land on one person. **A selection rule ranks; it does not distribute.** The 1..N priority order is the selection half; spreading that ranked work across the fabricator pool is a **placement** concern (`ScoringEngine` + resource-preference / load-balancing), a different mechanism. CTP does both, but they are two halves of the two-model asymmetry — the ranking does not by itself solve the distribution. Set this expectation explicitly with Kaleb; it is the most useful clarification for the catch-up. (Placement work is **not** this sprint — this sprint ships the ranking half.)

**What is a constraint with an existing home (confirm, don't build):**
- **Started task stays with its person (4.i)** and **locked machine/person (4.iv)** are **pins** — hard assignment constraints, the same idea as the shipped lane/affinity `isPrimary` hard constraint. Open part: source the pin from Genius state (task started → pinned to assignee) rather than hand-setting.
- **Started-out-of-order predecessors (4.ii)** is a **correctness** item, not a preference. Kaleb notes Genius checks only the *one* immediate predecessor, so a task started out of order can appear ready while upstream work is incomplete. This seam's **ready-set gather walks all predecessors** (the `SCHEDULED` gate, Phase 0(f)), which is the fix — but it is **stricter than Genius**, so it will change behavior Stafford is used to (lands as "CTP caught what Genius didn't," not a bug). Route to Allan: does hydrate map Genius "complete" onto the predecessor model such that all-preds-complete is enforced?
- **SequenceNumber = 9999 → treat as complete (point 2)** is a **hydrate/mapping rule** at the single named mapping point. Confirm with Allan it's a stable Genius convention, not overloaded.

**Material availability (4.iii) — in CTP's scope, but not modelable yet (no data).**
Material readiness is neither resource capacity, precedence, nor calendar — it is a **per-task release gate** ("cannot start before material arrives"). The natural model is a task-level **earliest-start floor** carried by the existing Option-K window-floor mechanism. It is legitimate CTP territory, but **Stafford does not yet have the data to source the constraint** — there is no material-ready date on the current entities. So: architecturally homed (window floor), **blocked on data**, not built here. Named follow-on.

**Data-source resolution (points 1–2) — RESOLVED; the delivery date is already pulled.** `WorkOrderWithAdvancedInformationViewEntity.DeliveryDate` (an **active adapter endpoint** — `adapter.json` `workOrders`/`salesOrders`; not `ProductionTaskWithAdvancedInfoViewEntity`) is **already mapped**: in the Stafford mapping `"from": "DeliveryDate"` lands in **`order.lateDueDate`** and **`group.promiseDate`** today — while `dueDate`/`sourceEnd` come from a *different* Genius field, **`JobEndDate`**. So the authoritative customer date is **not a new field wire; it is already in the data** under `lateDueDate`/`promiseDate`. The work is a **re-point** — treat `DeliveryDate` as *the* customer date for Slack/CR, the signed gap, and the eval-clock `asOf` — plus a call on whether to re-map it onto the primary `dueDate` or keep reading `lateDueDate`. Verified in slim-100: `JobEndDate`→`dueDate` = **Jun 8** vs `DeliveryDate`→`promiseDate`/`lateDueDate` = **Jun 10**. **Consequence for the bake-off + eval-clock:** today's lateness/status judge against `dueDate` (= `JobEndDate`), so adopting the true customer date shifts which date the gap measures against — a deliberate change, not a silent one.

---

## Design

### One seam, two contracts

A dispatch rule is defined by what state it may read (**input contract**) and what it emits (**output contract**).

- **Input contract — `DispatchState`**: a **read-only lens over the live landscape**, not a copy. It holds a reference to the (read-only) landscape plus **memoized-per-round** derived accessors. A static rule reads none of them; ATC reads `now` + `avgRemainingDuration`; DBR adds `bottleneckQueue`. Because accessors are lazy, the default path triggers zero derivations — the lens is free for the common case. An **escape hatch** to the raw (read-only) landscape covers rules we haven't imagined.
- **Output contract — a ranked pick**: `priority(task, state) -> number`, higher = more urgent. This covers every "pick the best single next job under live pressure" rule. It deliberately does **not** cover batching ("run a set together / wait to fill") — that is a different output shape (set + defer) and belongs to a **separate seam** (see Out of Scope; the dormant `batchrule.ts` is its entry point).

### The default sort is the trivial plugin

Today's behavior — "ready head per chain, sort by `task.rank`, take top N" — becomes one `IDispatchPriority` that ignores the state window entirely (`priority = -task.rank`, since lower rank = more urgent). Static vs. dynamic is not two mechanisms; it is **how much of `DispatchState` a plug reads**. The default reads nothing. This is also the **regression anchor**: `DynamicNeighborhood(StaticRankPriority)` must produce schedules identical to today's `ChainNeighborhood`.

### Contracts (sketch)

```ts
// packages/engine/AI/Dispatch/dispatchpriority.ts
export interface DispatchState {
  readonly landscape: Readonly<SchedulingLandscape>;   // escape hatch, read-only
  now(): number;                                        // shared clock (frontier)
  avgRemainingDuration(): number;                       // p̄ over ready set
  resourceState(key: string): { currentState: string; load: number } | null;
  bottleneckQueue(key: string): number;                 // DBR
}

export interface IDispatchPriority {
  name: string;
  prepare?(state: DispatchState): void;   // plug-private per-round precompute (e.g. DBR bottleneck index)
  priority(task: CTPTask, state: DispatchState): number;  // higher = more urgent
}
```

`DynamicNeighborhood` is `ChainNeighborhood` with the comparator swapped: gather ready set (all preds scheduled), build `DispatchState` once, call `prepare?`, collapse to one ready head per chain (solos = singleton chains), sort heads by `priority(...)` descending, emit top N.

### Round semantics, N, and tie-breaking (contract details)

- **A round = one ready-set gather.** The `DispatchState` lens is built at round start and is **invalidated by any schedule/unschedule** — memoization never survives a placement. This is what "memoized-per-round" means; write it as a rule, not an implication.
- **Dynamic plugs run N=1.** The whole value of a state-aware rule is re-ranking after *every* placement (each placement moves the frontier); emitting top N off one pre-round lens ranks picks 2..N on stale state. The default static plug may keep today's N (state-independent, so staleness is moot). Perf is a non-issue at 0–3,000 tasks — `prepare()` is O(R) per round.
- **Tie-breaking must be pinned.** Collapsing today's comparator to a single scalar loses whatever secondary ordering the current sort has, and equal priorities become implementation-defined — which fails the byte-for-byte parity gate for reasons unrelated to the seam. Requirement: `DynamicNeighborhood`'s sort is **stable** and reproduces today's exact tie-break as an explicit secondary key (extracted in Phase 0, not inherited by accident). The same secondary key applies under dynamic plugs so results are deterministic.
- **Forward solves only (v1).** ATC ("slack collapsing toward now") and DBR ("don't overfeed the constraint") are forward-in-time concepts. Dynamic plugs apply to `FORWARD`; a `BACKWARD` solve falls back to the default plug (or errors loudly — pick in Phase 1, but never silently misbehave).

### DBR is down-ranking, not gating (v1)

The output contract is a scalar rank, and the loop always places something — a scalar can rank a task last but cannot *withhold* it. True DBR "hold and wait" is a defer decision, which is the **batching seam's output shape**, not this one's. So v1 `DBRDispatchPriority` expresses the rope as **aggressive down-ranking**: a deep queue at the constraint pushes bottleneck-bound work toward the bottom of the pick order, letting non-bottleneck work flow first — but if bottleneck-bound heads are all that's ready, one is released (progress is guaranteed by construction, no stall case exists). This is a deliberate v1 semantics choice, documented and diffable; a hard release gate arrives, if evidence demands it, with the defer-capable batching seam.

### The two modeling decisions (isolated on purpose)

Both live in `DispatchState` construction, so they are the only genuinely new judgments:

1. **What is `now`?** Batch selection is global, not per-machine. v1: the ready-set frontier (earliest feasible/window start among ready tasks). Textbook ATC uses per-machine free time; this is the one place the approximation matters. Localized to one method.
2. **Where does weight `w` come from (ATC/DBR)?** v1 default 1.0. The natural source is the order's lateness penalty (`order.latenessPenaltyPerDay`, already used in `optimize.service.computeSavings`), which also aligns the rule with Stafford's late-fee value driver.

Two further v1 approximations, documented for the same diffability:

3. **ATC remaining work = the task's own duration (v1).** Job-level ATC typically weighs the chain's remaining *downstream* work, not just the head task. v1 uses task duration only — a known coarsening, same spirit as the global-`now` choice. A `remainingChainWork(task)` lens accessor is the later refinement if evidence demands it.
4. **DBR's bottleneck is identified once per solve** (in the first `prepare()`, or config-pinned), not re-derived per round. TOC treats the constraint as stable; per-round re-identification can oscillate between two near-tied resources mid-solve. Per-round refresh is a later refinement, gated on evidence.

### Config representation — one named selection axis

EST / ATC / DBR are **selection** rules — the same family as the existing dispatching strategies (`Chain`, `Greedy`, `DueDate`, `ShortestFirst` in `strategy-defaults.ts`, which already answer "which task next"). So selection is **one config axis**, not a new parallel concept. The three axes a tenant configures:

- **objective weights** — `scoring.json` (how a placement is scored)
- **placement / tier** — strategy + solver tier (where / how hard)
- **selection** — *this seam* — extend the existing strategy axis with EST/ATC/DBR

**Config surface = one named enum + optional params**, exactly like weights and placement already are:

```json
// settings.json (per-tenant default)
{ "selectionStrategy": "ATC", "selectionParams": { "k": 3 } }
{ "selectionStrategy": "DBR", "selectionParams": { "bufferDays": 2 } }
```

**A single registry resolves the name → implementation** (mirroring `DISPATCHING_STRATEGIES` + `resolveStrategy`), carrying the same picker metadata plus a params bag:

```ts
interface IDispatchStrategy {
  key: string;               // 'EST' | 'ATC' | 'DBR' | ...
  label: string; detail: string; bestFor: string; tier: string;
  dynamic: boolean;          // reads DispatchState (ATC/DBR) vs static (EST)
  // -> DynamicNeighborhood(plug), plus a default sequence for the static case
  resolve(params?: Record<string, unknown>): INeighborhoodStrategy;
}
```

**The static/dynamic difference is hidden behind the name — do not leak it into config.** Under the hood these aren't the same kind of object:
- **EST is static** — really "the default plug + an earliest-start `processingSequence`" (pure data).
- **ATC / DBR are dynamic** — *plugs* (engine code) that ignore the static sequence and compute priority live from the lens.

The user picks one name; the registry decides whether it means "sequence + default plug" or "dynamic plug." The config UX stays a single dropdown, uniform with the other two axes.

**Single source of truth.** The registry is the *only* place the option list lives — the engine's `resolveStrategy`, the UI picker, and the bake-off all read it. Do not re-list options in the UI or the bake-off (the "two calculation paths" trap from the status audit, applied to config).

**Bake-off consumes it as the third axis.** A bake-off config bundle becomes `(sequence, weights, selectionStrategy)`: static configs vary the *sequence* under the default/EST selection; dynamic configs vary the *plug* (ATC/DBR). Same registry, one resolver.

---

## Phases (commit after each)

**Phase 0 — Investigation gate (read-only). ✅ DONE — design confirmed viable.**
- **(a) Seam:** `INeighborhoodStrategy` + `resolveStrategy` (`basescheduler.ts:359`) is the only selection seam. ✓
- **(b) `task.rank`:** `order.processingRanks[activeSequence]`, set at hydrate, not mutated mid-solve. ✓ static.
- **(c) Lens inputs — no schema change.** Resource load (`resource.available.staticOriginal/.staticAssignments`) and the changeover model (`landscape.stateChanges` + `getOrDefaultProcessChange`) are directly available mid-solve. The DBR utilization scalar (`resourceutilizationscoringrule.ts:37-64`), the resource current setup-state (walk `resource.available.stateChanges`, `statechangeengine.ts:180`), and bottleneck ranking are **derived** — the lens wraps existing derivations, it does not add landscape state. *(Resolves Open Decision 5.)*
- **(d) Parity harness does NOT exist** as a byte-for-byte gate (no golden/snapshot schedule fixtures). The extract→sort→compare pattern exists (`chain-verification.spec.ts:198-216`: solve → map to `{key,start,end}` → sort → deep-equal) but only as a two-run determinism check. **Phase 1 must BUILD the gate** — see Phase 1.
- **(e) The default plug reproduces TWO comparators, not one.** `ChainNeighborhood` sorts **chain heads** by `(rank ASC, window.startW ASC)` and **standalones** (no `linkId`) by a 5-key `greedySortFn` = `(earliestEnd, score, rank, window.startW, duration)` where `earliestEnd` reads `feasible?.startW` (**solve-time state**); chain heads emit first, standalones backfill. So `StaticRankPriority` is not "`-rank`" — the parity gate must exercise a tenant **with standalone tasks**.
- **(f) Cross-WO Option-K is ORDER-INDEPENDENT for correctness — the design is NOT reversed.** ✓ Precedence rests on the ready-set `SCHEDULED` gate and floors that read committed facts (`xpred.scheduled.endW`); an unscheduled pred **fails safe** (defers to bump-retry, never schedules early). The topological pick order (`getChainsInPriorityOrder`, `basescheduler.ts:1442`) is a **liveness/tightness optimization only**. **Caveat → Phase 1 requirement:** a new pick order can't produce a wrong schedule but can cost extra retries / infeasible-when-feasible on cross-WO tenants, so preserve or re-derive the child-before-parent topological ordering.

**Phase 1 — The seam + default plug (behavior-preserving).**
Add `IDispatchPriority` + `DispatchState` (read-only lens **over existing state — Phase 0(c)**, memoized accessors invalidated on any schedule/unschedule, escape hatch). Add `DynamicNeighborhood`. Add `StaticRankPriority` that reproduces **both Phase 0(e) comparators** — chain heads by `(rank, window.startW)` **and** the standalone `greedySortFn` `(earliestEnd, score, rank, window.startW, duration)` incl. its `feasible`-reading `earliestEnd` — with chain-heads-first backfill, as a stable sort. Dynamic plugs are **FORWARD-only**; `BACKWARD` resolves to the default plug (or errors loudly — decide here). **Preserve/re-derive the child-before-parent topological ordering** (Phase 0(f) caveat) so cross-WO liveness doesn't regress. Wire `resolveStrategy` so the default resolves to `DynamicNeighborhood(StaticRankPriority)`.
**Build the parity gate** (Phase 0(d): none exists) — promote `chain-verification.spec.ts:198-216`'s solve→`{key,start,end}`→sort→deep-equal into a **golden-JSON** comparison over **pinned-clock** tenants (needs the eval-clock `asOf` to freeze "now" — cross-sprint dependency), and **include a tenant with standalone tasks** so the second comparator is covered. **Gate: byte-for-byte parity.** Once it clears, **retire `ChainNeighborhood` in this same deliverable** — one selection path leaves the phase, not two. No new behavior ships in this phase.

**Phase 2 — ATC plug.**
`ATCDispatchPriority(k)` reading `now` + `avgRemainingDuration`. Register it. Unit test: on a 3-job case, ATC reorders as slack collapses (a job with shrinking slack overtakes a shorter but slack-rich job). Confirm it is selectable per solve and leaves the default untouched.

**Phase 3 — DBR plug.**
Extend `DispatchState` with `bottleneckQueue`/`resourceState`; `DBRDispatchPriority` uses `prepare()` to identify the constraint **once per solve** and build its index. v1 semantics: **down-ranking, not gating** — bottleneck-bound work with a deep constraint queue sinks in the pick order so non-bottleneck work flows first, but if only bottleneck-bound heads are ready, one is released (progress guaranteed by construction). Unit tests: (i) bottleneck-bound work is deprioritized behind non-bottleneck work even when due-date-urgent; (ii) an all-bottleneck-bound ready set still schedules (no stall). Confirm ATC and the default are unaffected by the state-lens extension.

**Phase 3.5 — Slack/CR plug (Stafford's rule — the first real consumer).**
`SlackDispatchPriority`: priority = **least slack**, `slack = deliveryDate − asOf − remainingWork`. Reuses ATC's due-date inputs (`asOf` + remaining work) — one class + one registry line, no new `DispatchState` accessor. Customer date is sourced from `WorkOrderWithAdvancedInformationViewEntity.Delivery date` at the single mapping point (see Data-source resolution above). Slack is an absolute time quantity, so the ranking is globally comparable; Stafford's "priority relative to others with the same operation code" is how they *apply* the ranking (sequence 1..N within a pool) — an output/placement convention, not a ranking-scope constraint (see the selection-vs-distribution note above). Unit test: within a ready set, the least-slack job ranks first; at equal delivery dates the job with more remaining work outranks the lighter one. Confirm default / ATC / DBR are untouched. *(In scope because Stafford is the first consumer and the rule is nearly free once ATC's machinery exists.)*

**Phase 4 — Verification.**
Run the full regression + strict type-check (`tsc --noEmit -p packages/api/tsconfig.json`). Confirm: default parity still holds; ATC, DBR, and Slack/CR produce *distinguishable* schedules from the default on a Stafford slim tenant; the lens is read-only (a plug cannot mutate the landscape — enforce by type and by test). Record which `now`/weight decisions were taken so they are diffable later.

**Phase 5 — Harness handoff (doc only, no harness code here).**
Document the dispatch axis for the bake-off: how a config names its plug, how the shared lens guarantees comparability, and the config taxonomy (static = default plug + sequence; dynamic = plug). The actual manifest/comparison-surface wiring is the harness sprint's Phase 2/3.

---

## DO / DON'T

**DO**
- Treat the **selection model** as the thing being upgraded; leave the placement model (`ScoringEngine`) untouched.
- Ship the **default sort as a plug** (`StaticRankPriority`) and gate on **byte-for-byte parity** before adding any dynamic rule.
- Make `DispatchState` a **read-only lens over the live landscape** — memoized shared derivations + an escape hatch — never a copy.
- Compute shared derivations (`now`, `p̄`, bottleneck) **once, one way**, so bake-off configs stay comparable.
- Give each plug a **`prepare()`** hook for its own per-round precompute; let the plug organize its own data on top of the shared substrate.
- Keep dynamic rules as **pure functions** of `(task, state)` returning a scalar (higher = more urgent).
- Rebuild the lens **every round** (invalidate on any schedule/unschedule); run **dynamic plugs at N=1** so every pick sees fresh state.
- Make the plug sort **stable with the extracted tie-break as an explicit secondary key** — determinism under equal priorities is a requirement, not an accident.
- Scope dynamic plugs to **FORWARD solves**; BACKWARD uses the default plug or errors loudly, never silently misbehaves.
- Source ATC/DBR weight from **`order.latenessPenaltyPerDay`** where available (ties to the late-fee value driver).

**DON'T**
- Don't hand a plug the **raw mutable** landscape — read-only only; a selection rule observes, never writes.
- Don't let two plugs **each define `now`/the bottleneck** — that silently breaks bake-off comparability.
- Don't stretch this seam to cover **batching** — set-formation + "wait to fill" is a different output contract and a separate seam.
- Don't add a **defer/withhold sentinel** to the scalar contract — v1 DBR is down-ranking; true "hold and wait" arrives with the batching seam's defer shape.
- Don't leave **two selection paths alive** after parity clears — `ChainNeighborhood` is retired in this sprint, not kept "for safety."
- Don't add a **placement/scoring** rule here — this sprint is selection only.
- Don't build **ATCS, campaign, or ML weight tuning** in this sprint — they are additive plugs once the seam exists.
- Don't change the **processing-sequence / `processingRanks`** machinery — the default plug reads it unchanged.
- Don't wire the **bake-off manifest/UI** here — that's the harness sprint.

---

## Out of Scope (named follow-ons)

- **Batching (ovens / furnaces / campaign p-batch)** — a *separate seam*, not this comparator. Needs a batch-formation step emitting a co-scheduled group + a defer ("wait to fill") decision. The data model already exists dormant: `batchrule.ts` (`minBatchSize`/`maxBatchSize`/`batchWindow`), unreferenced by `basescheduler`. Its own sprint. **A true DBR hard release gate ("withhold from the constraint") lands there too** — it needs the defer output shape this seam deliberately lacks; v1 DBR down-ranking is the scalar-contract approximation.
- **ATCS (Apparent Tardiness Cost with Setups)** and **campaign / run-length** rules — additive `IDispatchPriority` plugs once `resourceState`/`setupCost` are on the lens (DBR already adds `resourceState`, so ATCS becomes cheap after Phase 3). Not built here.
- **ML / auto-tuning of `k` and weights** — the seam enables it; not built here.
- **Bake-off harness integration** (config manifest carries a plug reference; comparison surface renders dispatch axis) — the consumer sprint's job.
- **Per-machine `now`** (replacing the global frontier approximation) — a refinement gated on evidence that the global clock materially misranks.
- **Material-availability release gate (Kaleb 4.iii)** — a per-task earliest-start floor carried by the existing Option-K window-floor mechanism. Architecturally homed; **blocked on data** — Stafford has no material-ready date on the current entities. Build when the source field exists.
- **Per-fabricator distribution of ranked work (Kaleb 3.i–3.ii)** — spreading a ranked op-code pool across the resource pool is **placement** (`ScoringEngine` + resource-preference / load-balancing), not selection. This seam ships the ranking (1..N); the distribution half is separate placement work.

---

## Acceptance Criteria

- [ ] `IDispatchPriority` + `DispatchState` exist; `DispatchState` is **read-only** over the landscape (enforced by type and test) with **memoized-per-round** shared accessors (invalidated on any schedule/unschedule) and a raw-landscape escape hatch.
- [ ] `DynamicNeighborhood(StaticRankPriority)` produces **byte-for-byte identical** schedules to the current engine across the standard tenant set (the regression/parity gate), with a **stable sort carrying the extracted tie-break** as an explicit secondary key.
- [ ] The **default sort is a plug** — no separate static code path; static vs. dynamic differ only by which accessors a plug reads. **`ChainNeighborhood` is retired in this sprint** once parity clears.
- [ ] **Dynamic plugs run at N=1** and are **FORWARD-only** (BACKWARD → default plug or loud error).
- [ ] `ATCDispatchPriority` is selectable per solve, reorders by live slack (unit-tested on a 3-job case), and does **not** alter the default. v1 remaining work = task duration (documented coarsening).
- [ ] `DBRDispatchPriority` **down-ranks** bottleneck-bound work against a once-per-solve constraint index built in `prepare()` (unit-tested), **never stalls** on an all-bottleneck-bound ready set (unit-tested), and leaves ATC + default unaffected.
- [ ] Full regression suite and **strict `tsc --noEmit -p packages/api/tsconfig.json`** pass.
- [ ] No change to `ScoringEngine`, `pickBestSchedule`, or the `processingRanks` machinery.
- [ ] The `now` derivation, ATC/DBR weight source, ATC remaining-work coarsening, and bottleneck-stability choice are **documented and diffable**.
- [ ] Handoff doc states the bake-off config taxonomy (static = default plug + sequence; dynamic = plug) and how the shared lens preserves comparability.

---

## Open Decisions

1. **`now` semantics** — v1 global ready-set frontier vs. per-machine free time. Recommend global for v1; revisit only if it misranks (Out of Scope refinement).
2. **Weight source** — `order.latenessPenaltyPerDay` when present, else 1.0. Confirm the fallback and whether a per-task typed-attribute weight is ever needed.
3. **ATC `k` (and DBR buffer size)** — tuning defaults. `k ≈ 3` is a common ATC starting point; DBR buffer/rope length TBD. These become bake-off knobs later.
4. **Default resolution** — *Resolved:* replace with `DynamicNeighborhood(StaticRankPriority)` once the parity gate clears, and retire `ChainNeighborhood` **in this sprint** (house rule: dead code goes in the deliverable that orphans it). "Keep and prove equivalence" as a standing state is the one option off the table.
5. **`bottleneckQueue` source** — *Resolved (Phase 0c):* derived, not stored. Raw load is on `resource.available.staticAssignments`; the utilization/queue scalar reuses `resourceutilizationscoringrule.ts:37-64`; bottleneck ranking reuses that or the disjunctive-graph bottleneck. The lens wraps these — no landscape schema change.
6. **Landing base** — branch off `main` now vs. after `feature/scheduling-snapshot` lands. Independent engine areas, so either works; rebase is cheap.
7. **Extend vs. replace the existing strategy axis** — recommended: **extend** `DISPATCHING_STRATEGIES` (one selection axis, EST/ATC/DBR as new registry entries) rather than add a parallel `selectionStrategy` concept. Open part: whether `Chain`/`Greedy`/`DueDate`/`ShortestFirst` are re-expressed as registry entries over the new seam (so there is literally one list), or the legacy keys are kept as aliases during migration. Settle when the registry type lands (Phase 1).
8. **Slack/CR plug scope** — Stafford's own strategy (`SlackDispatchPriority`) is the same family as ATC and cheap once the seam exists. Decide whether it ships in this sprint (alongside ATC/DBR, since Stafford will test against it directly) or as the immediate follow-on. Leaning include — it's the config the beta partner actually wants to run.
9. **Predecessor-completeness semantics (Allan)** — confirm hydrate maps Genius "complete" so the ready-gather enforces *all* predecessors, not Genius's one-prior check. Stricter-than-Genius is correct but visible; not a code change here if the gather already does it, but must be verified against Stafford data.
10. **Pin sourcing (Allan)** — can started-task and locked-resource pins (Kaleb 4.i/4.iv) be sourced from Genius state at hydrate rather than hand-set? Uses the shipped `isPrimary` hard-constraint mechanism; the open part is the data wire.
