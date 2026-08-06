# Sprint — Multi-Configuration Solver Comparison (KPI bake-off)

**Status:** 📐 Draft — ready to build; not blocked (see Customer date, below)
**Depends on (shipped):** `SPRINT-dispatch-strategy-seam.md` (the dispatch axis) + `HANDOFF-dispatch-seam-to-bakeoff.md` (the contract). Three of the five starter configs (`Slack`/`DBR`/`ATC`) are dispatch plugs the seam already delivers; a config is a validated dispatch-axis row, not a new code path. **Placement:** in-monorepo, service layer, in-process (shared base landscape = the fixed-demand invariant); seeded from the existing `strategy-comparison.spec.ts` (the harness already exists as a test — this generalizes it).
**Origin:** Kaleb's strategy note — "assess via a number of solvers… which scheduling solution gave the best results." Read as: run one demand set through several configurations, compare KPIs, pick the best.
**Core reframe:** "different solvers" = **one metaheuristic engine, multiple configurations** (composite-weighted sort sequences + objective weights), all against **fixed demand** — the only thing varying between runs is the scheduling policy. This is a *harness + KPI + compare* sprint, not a new-algorithm sprint — it builds on existing processing-sequence machinery (ranks precomputed at sync, composite weighted sort). The comparison layer includes **Pareto dominance marking** over the per-config KPI vectors — post-processing only, no multi-objective search inside the engine.
**Customer date (not a blocker):** the harness builds and runs **now**, against the customer date authoritative today, read through a **single named mapping point**. Everything (objective, gap metric, KPIs) consumes that one point — never a raw Genius field directly. When Stafford/Genius confirms the authoritative source (Kaleb pt 1; Allan's ticket), it's a **one-field swap** at that mapping point, with no downstream change. Deferred-population, not a gate.

---

## Why

Kaleb wants to make a KPI-driven choice between scheduling strategies before committing a plan. Today there's one solve; he can't see how a due-date-first plan compares to a bottleneck-first or slack-first plan on the metrics he cares about. This sprint lets CTP run the **same fixed demand** through a **set of named configurations in one batch**, each emitting a comparable **KPI vector centered on the customer-date gap**, so the choice is made on numbers, not intuition.

**A configuration is scheduling policy only** — sort sequence + objective weights (+ optional metaheuristic seed). **Demand, capacity, calendars, routings, and due dates are identical across every run.** That fixed-demand invariant is what makes the comparison *fair and attributable*: because every run saw the same workload, any difference in the gap distribution is caused **by the solver**, not by a changed input. (This sprint does not vary demand or capacity between runs — that would be a different axis and is not in scope.)

This is also the concrete first instance of CTP's **parallel-solves-at-the-boundary** design — the configurations run as parallel solves off the same base, which is the identified-viable form of parallelism.

---

## The decision metric — the signed gap (CTP measures, Stafford interprets)

The measurement is the ± window between **job completion** and **customer date** — Genius's production/delivery gap ("penetration"). The clean division of labor:

- **CTP emits the raw, signed gap in seconds** per job: `gap = customerDate − jobCompletion`. Positive = finishing ahead of need (slack); negative = past the customer date (penetration). Objective, computable, and the thing only CTP can produce because it holds the plan. **No thresholds, no green/red, no verdicts** — just the number.
- **Stafford owns the interpretation.** Green/red thresholds, what slack is "safe," when a gap means "call the customer" — all business policy, supplied as **config**, not built into CTP. A 2-day gap is fine on a 3-week job and a crisis on a same-day job; only Stafford knows which. Keeping the threshold on their side means CTP never encodes their risk appetite, and a tolerance change is a config change, not a CTP change.

This makes graded-vs-binary a non-question: the signed gap **is** continuous; green/red is a presentation layer applied with Stafford's thresholds.

**For comparing configurations**, CTP rolls the per-job gaps up to a per-config summary — reported as **transparent components, not a blended score**. All customer-date rollups live under a **`deliveryGap.*`** namespace so they never collide with the UI's existing chain-idle diagnostic (`worstGapMinutes` in `strategy-comparison.spec.ts`, which is whitespace between a task and its predecessor — a different "gap"):

- **`deliveryGap.lateCount`** — jobs with a negative gap (how many miss the customer date).
- **`deliveryGap.lateTotalSec`** — sum of negative gaps (aggregate lateness).
- **`deliveryGap.worstLateSec`** — the deepest single penetration (the metric formerly called "worst-gap"; renamed to kill the clash).
- slack side: **`deliveryGap.onTimeCount`** (gap ≥ 0) and **`deliveryGap.slackTotalSec`** (sum of positive gaps).

These rank the five configs differently, so exposing them separately (rather than one "penetration score" that hides the weighting) lets Kaleb weigh them himself.

**Pareto dominance formalizes that weighing.** Each config's KPI vector is a point in objective space; a config is **dominated** if another config is at least as good on every agreed axis and strictly better on at least one. Dominance is objective even when weighting is not — dominated configs are eliminated without a weights argument, and Kaleb's judgment applies only among the **non-dominated (frontier) configs**, where genuine tradeoffs exist ("config A misses 3 jobs slightly, config B misses 1 job badly"). With ≤5 configs this is a trivial O(n²) pass over vectors already emitted — a projection, not a solve. Recommended v1 dominance axes: **count-late + total-late-seconds**, with worst-lateness as the third (Open Decision 7). The rest of the KPI vector:
- **On-time count** — jobs with gap ≥ 0 ("the number of things we can complete on time").
- **Feasibility** — scheduled vs included; horizon coverage.
- **Exceptions** — unscheduled / infeasible tasks and why (the bad-data tripwire).
- Supporting: makespan, bottleneck utilization.

---

## The configuration set (v1 starter bake-off)

Each config is a **manifest row** resolved against the shipped dispatch registry (`DISPATCHING_STRATEGIES`, from `SPRINT-dispatch-strategy-seam.md`). Three of the five are **dispatch plugs the seam already delivers** (`Slack`/`DBR`/`ATC`) — the seam turned "which task next" into a first-class swappable axis, so those configs are a *registry key*, not a hand-authored weight set. Each maps to a Kaleb priority:

| # | config (Kaleb priority) | manifest row | delivered by |
|---|---|---|---|
| 1 | **Customer-date EDD** — respect the customer date | `{ strategy: 'DueDate' }` | legacy strategy |
| 2 | **Slack / critical-ratio** — least slack-to-customer-date | `{ strategy: 'Slack' }` | **seam plug** (`SlackDispatchPriority`) |
| 3 | **Bottleneck-first (DBR)** — deprioritize the constraint | `{ strategy: 'DBR' }` | **seam plug** (`DBRDispatchPriority`) |
| 4 | **Weighted on-time (ATC)** — maximize count finishing on time | `{ strategy: 'ATC' }` | **seam plug** (`ATCDispatchPriority`) |
| 5 | **Stafford default** — the current reference | `{ strategy: 'Chain', activeSequence: 'delivery-date-first' }` | default plug + sequence |

Config 5 is the baseline every other config is measured against (delivery-date-asc, the tenant's `solverStrategy` today).

### Manifest row shape — validated flat (not a discriminated union)

A row is **one uniform flat shape**, validated at runtime against the registry:

```ts
interface BakeoffConfigRow {
  name: string;                                    // display name, e.g. "Bottleneck first"
  strategy: string;                                // dispatch key ∈ DISPATCHING_STRATEGIES
  activeSequence?: string;                         // ONLY valid when strategy is the static default (Chain)
  scoringWeights?: string | Record<string, number>; // named scoring.json set or inline
}
```

- **`activeSequence` on a dynamic strategy is a hard validation error, not a silent ignore.** A dynamic plug (`Slack`/`ATC`/`DBR`) computes its own order and *ignores* the precomputed rank, so `{ strategy: 'ATC', activeSequence: 'delivery-date-asc' }` reads as meaningful but is a lie — it's rejected at manifest-load, so no config that "doesn't mean what its name says" can persist. Datedness/dynamic-ness is **derived from the strategy's registry entry** (single source of truth), not authored as a `kind` discriminant — a union would duplicate that knowledge and drift when a plug is added.
- **`tier` is NOT a per-row field.** Solver *effort* (quick/balanced/thorough/best — `SOLVER_TIERS`) is a different axis; varying it per-config would confound the policy comparison. It's a **batch-level** setting, **fixed at the constructive (balanced) tier for v1** so the comparison isolates *selection* policy and stays deterministic (see Design → determinism).

These are config artifacts (registry keys + `scoring.json` sets / named sequences), not code paths — new configs are data, not builds.

**Frontier densification (optional, data-only):** because configs are data, weight-interpolation sweeps between two named configs (e.g., EDD ↔ bottleneck-first in 3–4 steps) generate additional frontier sample points with zero code — bounded only by the batch-runtime budget (Open Decision 4). Not required for v1.

---

## Design

- **One engine, N configurations, one demand.** Fetch demand once; run each configuration as a parallel solve off the same base. No intra-solve parallelism (ruled out); parallelism is at the boundary (batch of configs).
- **Batch runs against a pinned base reference.** All N runs read one frozen base for the batch's duration; a Genius sync landing mid-batch is invisible to in-flight runs. This is the existing immutable-per-sync base layer doing its job — "pinning" is the orchestrator holding one base reference, not resolving "latest" per run. This enforces the fixed-demand invariant.
- **Executes as a background batch job.** N parallel solves is a minutes-scale job, not an interactive request. Async trigger returns a batch id; a manifest tracks per-config run status; the comparison surface populates on batch completion (v1) or as runs finish (later). The live plan is untouched throughout — every result is non-promoted. This reframes Open Decision 4 from acceptable *wait* to acceptable *turnaround*.
- **The manifest is the durable artifact.** Per bake-off, one KB-scale manifest holds: batch id, display name + optional label, pinned-base / demand-as-of reference, config set, per-run result ids, the KPI vectors, and dominance flags. Reopening an old bake-off is a projection off the manifest + summary partitions — effectively free. What stays valuable long-term is the manifest (the decision record: "on this demand, bottleneck-first dominated the default"), not the N plan artifacts, which reference a base that goes stale within days.
- **Each run is an addressable, non-promoted result** — reuses the snapshot multi-solve addressing seam (`?id`), like what-if scenarios. A bake-off is N scenarios compared to the Stafford-default baseline; none is promoted to `current` until Kaleb selects one.
- **KPI vector is computed per run at write time** — the penetration metric is a projection over (job-end ⋈ customer-date), same projection discipline as the summary partition.
- **Dominance is computed post-batch, over results only.** After all runs complete, one cheap pass over the N KPI vectors (on the agreed axes) marks each config dominated or frontier. Pure post-processing — no solver involvement, no Pareto-native search inside the engine.
- **Selection adopts the policy, not the plan.** Selecting a config means adopting that scheduling policy and re-solving against the *current* base under it — not resurrecting the bake-off's plan artifact (which references the pinned base). Selection is human and advisory; the system presents KPI vectors side by side with dominance marked and Kaleb makes "an educated choice" among frontier configs. CTP does not auto-select or auto-commit — matches the planning-lens posture.
- **Customer date is the pivot.** Read it through a single named mapping point (current date now; SO-sourced when confirmed). The objective optimizes against it; the signed gap measures against it.
- **A config is a validated dispatch-axis row, not a code path.** Each config resolves to `{ name, strategy, activeSequence?, scoringWeights? }` against the shipped `DISPATCHING_STRATEGIES` registry (see The configuration set). Three of the five starter configs are dispatch *plugs* the seam already ships (`Slack`/`DBR`/`ATC`); the row is validated at manifest-load so a dynamic strategy carrying an `activeSequence` (which it would silently ignore) is a hard error, not a persisted lie. `tier` (solver effort) is a **batch-level** setting, not per-row, fixed at the constructive tier for v1.
- **Runs are deterministic (seeded), so KPI deltas are attributable — a correctness requirement for Stafford, not a demo-tenant nicety.** The fixed-demand invariant is meaningless if the *same* config yields different schedules run-to-run; if config A beats B by 2 late jobs and the optimizer's stochastic variance is ±3, the bake-off is measuring noise and calling it strategy. Stafford is one of the non-deterministic (optimizer) tenants and is the whole point, so this is load-bearing. **v1 runs at the constructive tier** — the 5 configs vary *selection* policy, which is the deterministic constructive pass, so no optimizer stochasticity enters the comparison (deterministic by construction; the dispatch-seam parity gate already proves slim-100 constructive-deterministic). Any optimizer-inclusive batch **pins one RNG seed batch-wide** (the RNG held constant *alongside* demand — the fixed-demand invariant extended to randomness) and **replaces the wall-clock termination with an iteration cap** (so runtime/machine can't inject variance) — the "optimizer determinism" follow-on the dispatch-seam sprint recorded. **Not variance-quantified in v1**; a bounded multi-seed noise-band (K runs, mean±band, dominance not claimed inside the band) is the evidence-gated fallback *only if* a pinned seed is later shown to bias the frontier.

---

## Phases (commit after each)

**Phase 0 — Investigation gate (CC, read-only).**
Confirm: (a) the engine can run N configurations in one batch off a shared base and emit per-config results; (b) the signed gap is computable from jobCompletion ⋈ customer-date on the current data; (c) where the customer date is read today (the single mapping point) and whether Work7's customer-date-vs-job-end misalignment is bad data or the ASAP/SO-date issue. Record which field is the stand-in so the eventual SO-source swap is diffable.
- **(d) The dated/backfill split is real, not phantom (tripwire).** Confirm each bake-off tenant shows a genuine `customerDeliveryDate` dated-vs-null split (jobType `C` vs `I`/`U`/`Q`), **not 100% dated**. Verified today: slim-100 = 23 dated / 6 null, slim-2000 = 459 / 103. If a tenant comes back 100% dated, the Phase 0.5 bootstrap stamp (`customerDeliveryDate = lateDueDate` on every order) hasn't been retired for it and the gap population is built on phantom dates — the harness must not run on it until the `DeliveryDate`-where-`jobType='C'` mapping is in effect. (The dated values are `DeliveryDate` today, sourced via the single mapping point; the SO-source swap is Open Decision 5.)
- **Primary tenant: `stafford-slim-2000`** (committed fixture, 562 orders / 2035 tasks, fixed horizon `2026-03-31`). Chosen because it has real resource *contention*, so configs diverge at the **schedule** level (not only selection-order — slim-100 is contention-free there), and `dueDate` genuinely differs from `customerDeliveryDate` (only 24/459 coincide), so ATC / Slack / DBR yield distinguishable `deliveryGap.*` vectors. `stafford-slim-100` stays the deterministic **parity/selection** anchor. Determinism at the constructive tier is *expected* (fixed horizon, no optimizer) but **not yet verified for slim-2000** — Phase 0(e) proves it (solve twice → identical) before any dominance is claimed.
- **(e) Determinism holds at the chosen tier.** Confirm the bake-off tier is deterministic on the target tenant — solve each config twice, assert identical schedules. At the constructive (v1) tier this holds by construction; if an optimizer tier is selected, this is the gate that the seed-pin + iteration-cap are in place before any dominance is claimed.

**Phase 1 — Customer-date objective + signed-gap KPI.**
Read the customer date through the single named mapping point (current date now; SO-source swap later). Compute the **signed gap in seconds** per job, and the per-config rollups (count-late, total-late-seconds, worst-lateness; slack side too). No thresholds/green-red in CTP — that's Stafford's interpretation config. This is the decision axis — build it before the bake-off so there's something to compare on.

**Null-date exclusion (inner-join, not coercion).** The rollup is a projection over `(jobCompletion ⋈ customerDeliveryDate)` and must be **inner-join**: a job whose `customerDeliveryDate` is null (stock/internal/deadline-free work — the dispatch layer's backfill class) is **dropped from the gap population**, not coerced to a zero/epoch/end-of-horizon due date. Coercion would manufacture phantom lateness or phantom slack and poison every rollup. This is the KPI-side counterpart of the dispatch seam's two-class model: null customer date = off the due-date axis, in the gap KPI exactly as in the sort. (Forward requirement carried from the dispatch-seam sprint, which returns honest null but cannot build or verify this rollup — the field and the rollup both land here.)

**Phase 2 — Multi-configuration run harness.**
Define the 5 starter configs as **validated manifest rows** (`{ name, strategy, activeSequence?, scoringWeights? }`, validated against `DISPATCHING_STRATEGIES`; `activeSequence` on a dynamic strategy rejected at load — see The configuration set). Three resolve directly to shipped seam plugs (`Slack`/`DBR`/`ATC`); the seed here is the existing `strategy-comparison.spec.ts` (the harness already exists as a test — this generalizes it to an endpoint + persisted batch, in-process at the service layer, not HTTP-per-config). Run them as a **background batch** (async trigger → batch id → per-run status; **not** a blocking POST) of parallel solves off **one pinned base** (frozen for the batch's duration; mid-batch syncs invisible), at a **batch-level fixed tier** (constructive/balanced for v1; if an optimizer tier, one **RNG seed pinned batch-wide** + iteration-cap termination — see Design → determinism). Each emits a `deliveryGap.*` KPI vector + exceptions; each is an addressable non-promoted result against the Stafford-default baseline. Write the **manifest** — batch id, display name + optional label, demand-as-of / pinned-base reference, tier + seed, config set, per-run result ids, KPI vectors, dominance flags. The manifest is the durable decision record; reopening a bake-off is a projection off it. (Display-name / label / demand-as-of carried here **because the Phase 5 UI renders them** — working backwards from the operator load surface determines what the harness must persist.)

**Phase 3 — Comparison surface + dominance marking (data/read layer).**
Produce the comparison read surface: the KPI vectors per configuration — gap rollups (count-late, total-late-seconds, worst-lateness), on-time count, feasibility, exceptions — as a projection off the batch results (no new heavy solve). Rollups exposed as separate components, not a blended score. Compute **dominance across the per-config KPI vectors on the 2–3 agreed axes** (Open Decision 7) and mark non-dominated configs; the projection returns a dominated/frontier flag per config plus the two primary axes for a scatter. If Stafford-default is dominated, that fact is in the projection — it's the headline. This is the machine-readable comparison; the Kaleb-facing presentation is Phase 5. Selection marks a config for promotion; it does not auto-commit. Graceful fallback: if dominance axes are disputed or the pass is skipped, the surface still carries transparent rollups for manual choice.

**Phase 3.5 — Selection (adopt the policy, re-solve current base).**
The one place the harness touches the live plan, so it's a build step, not a UI-time discovery. Selecting a config **adopts its scheduling policy** (its `strategy` + `activeSequence?`/`scoringWeights?`) and **re-solves against the *current* base** under it — a normal, explicit solve/promotion path. It does **not** resurrect the bake-off's plan artifact, which references the now-stale pinned base. Selection is human, advisory, and non-auto-committing: the endpoint takes a manifest + chosen config, runs one fresh solve against `current`, and returns an addressable result the operator then confirms (Open Decision 6, resolved). No write-back to Genius. A no-op before confirm; a mistake here is the user-visible one, so it's tested directly (selected policy round-trips to a fresh solve; the pinned-base artifact is never promoted).

**Phase 4 — Verification.**
Run the bake-off on the revised Work7 set; confirm the 5 configs produce distinguishable KPI vectors, the signed gap surfaces the known customer-date misalignment, and exceptions are consistent per config. Verify the dominance marking by hand against the emitted vectors (trivial at 5 points), and confirm that if Stafford-default is dominated it is surfaced explicitly. Confirm **determinism** (each config solves twice to an identical schedule at the batch tier) and the **inner-join** (a null-customer-date job is absent from every `deliveryGap.*` rollup).

**Phase 5 — Kaleb-facing UI (late; requirements-first).**
The self-service surface for a non-technical operator, built last but **specified first** so the Phase 2 harness persists what it needs. Two views:
- **Load surface — the comparison list.** Named saved comparisons, newest-first, each row showing display name (auto: dataset + week, e.g. "Week of Mar 9 — WORK7"), the "demand as of" timestamp (the pinned base, in plain language), strategy count, and a status chip (Running x of N / Complete / In use). Clicking a row opens its result. No batch ids, snapshot ids, or file paths surfaced. New comparison = pick a predefined strategy set (defaults to the standard 5; sets are curated by us/Allan — Kaleb never edits weights), optionally type a label, run in background.
- **Result view — the comparison.** A one-line plain-language summary (the dominance pass as a sentence; if the current strategy is dominated, that *is* the headline), a rollup table, and the two-axis scatter with frontier points marked. "View schedule" on any row opens the existing Gantt against that run's `?id`. "Use \<strategy\>" confirms selection.
- **Language translation is a hard requirement, not polish.** No "Pareto / dominated / frontier / seconds" in the operator UI. Configs get plain-verb names ("Bottleneck first"); dominance renders as "Best trade-off" vs "Outperformed"; gaps render in days; the confirm copy states the semantics — adopting the *policy* and re-planning current demand, nothing committed until confirm, no write-back to Genius.
- **Safety by construction:** everything up to the final confirm is read-only and non-promoted; a failed run is one bad row, not a broken batch; an accidental click before confirm does nothing.

---

## DO / DON'T

**DO**
- Treat configurations as **data** (weight sets / named sequences), not code paths; vary **only scheduling policy**, demand fixed across runs.
- Have CTP emit the **raw signed gap in seconds**; leave green/red thresholds to **Stafford's interpretation config**.
- Present config comparison as **transparent rollups** (count-late, total-late-seconds, worst-lateness), not a blended score.
- Run configs as **parallel solves at the boundary** off one shared demand/base.
- Make each run an **addressable, non-promoted** result vs the Stafford-default baseline.
- Keep **selection human and advisory**; present KPIs, let Kaleb choose.
- Read the **customer date through a single named mapping point** (current date now; SO-source swap later).
- Compute **Pareto dominance as post-processing over completed run results**; mark frontier vs dominated on the comparison surface.
- Run the batch off a **pinned base** (frozen per batch) as a **background job**; persist a **manifest** as the durable decision record.
- In the **operator UI, translate everything to plain language** — strategy names, "best trade-off" vs "outperformed", days not seconds, "demand as of" for the pinned base.
- Make **selection adopt the policy and re-solve current demand**; state that in the confirm copy.

**DON'T**
- Don't **write back to Genius** — that's a separate boundary decision, out of scope here (see below).
- Don't **build new solver algorithms** — this is configurations of the existing engine.
- Don't **auto-select or auto-commit** a configuration.
- Don't build the **setup-cost objective term or ML weight-tuning** here — future metaheuristic work; use existing objective terms.
- Don't build **Pareto-native (archive-based) multi-objective search into the metaheuristic** — dominance is computed over completed run results only; the engine still optimizes one blended score per run.
- Don't **promote** any bake-off result to `current` except by explicit selection.
- Don't **resurrect a bake-off's plan artifact** on selection — adopt the policy and re-solve against the current base (the pinned-base plan is stale within days).
- Don't **surface internal jargon** (Pareto, dominated, frontier, raw seconds, batch/snapshot ids, file paths) in the operator UI.
- Don't let **Kaleb edit weights** — he picks from curated strategy sets; weight authorship stays with us/Allan.

---

## Out of Scope (named follow-ons)

- **Write-back of task start/end to Genius** (Kaleb pt 5) — crosses the planning-lens boundary; a deliberate decision on its own, not folded in silently. The sprint produces compared, selectable plans; applying one to Genius is downstream.
- **New metaheuristic moves** — setup-cost objective term, insertion-based neighborhood moves (identified as next engine steps, separate).
- **ML weight tuning** — composite weights enable it; not built here.
- **Archive-based multi-objective search (NSGA-II-style)** — moving the engine from weighted-sum scalarization to a per-solve non-dominated archive. The bake-off *is* a coarse weighted-sum frontier sampler; its known limitation is reaching only convex frontier regions. Gated on evidence: only if Kaleb repeatedly wants points between frontier configs that no weight sweep produces does this get built. Lands alongside the other deferred engine work (setup-cost term, insertion moves).
- **Auto-recommendation** of the best config — v1 is human selection on presented KPIs.

---

## Acceptance Criteria

- [ ] One demand set runs through **≥5 named configurations** in one batch, **demand identical across all runs**.
- [ ] CTP emits the **signed gap in seconds** per job and the per-config **`deliveryGap.*`** rollups (`lateCount`, `lateTotalSec`, `worstLateSec`, `onTimeCount`, `slackTotalSec`); **no green/red thresholds baked into CTP**, and the namespace does **not** collide with the chain-idle `worstGapMinutes` diagnostic.
- [ ] The signed-gap rollup **inner-joins on `customerDeliveryDate`** — jobs with a null customer date (backfill class) are **excluded** from the gap population, never coerced to a sentinel due date (unit-tested with a null-date job present in the fixture).
- [ ] Configs are **data artifacts** (validated `{ name, strategy, activeSequence?, scoringWeights? }` rows over `DISPATCHING_STRATEGIES`), addable without code changes; a dynamic strategy carrying an `activeSequence` is **rejected at manifest-load** (unit-tested), and `tier` is a batch-level field, not per-row.
- [ ] **Runs are deterministic at the batch tier** — each config solves twice to an identical schedule on the target tenant (constructive tier by construction; optimizer tier via a batch-wide pinned RNG seed + iteration-cap). Dominance is never claimed across a variance the runs don't control.
- [ ] **The dated/backfill split is real on every bake-off tenant** (not 100%-dated) — the gap population is `DeliveryDate`-backed, not the retired bootstrap stamp (Phase 0 gate).
- [ ] Each run is **addressable and non-promoted**; the Stafford-default config is the baseline.
- [ ] The **comparison surface** shows rollups side by side as separate components; a config is selectable, and selection does **not** auto-commit.
- [ ] Customer date is read through a **single named mapping point** (current date now; one-field SO swap later).
- [ ] **No write-back to Genius** anywhere in the implementation.
- [ ] On revised Work7, the configs produce **distinguishable** KPIs and the signed gap surfaces the customer-date misalignment.
- [ ] **Dominance is marked correctly** on the comparison surface (frontier vs dominated, verified by hand against the emitted vectors); Stafford-default's dominated/frontier status is explicit.
- [ ] **No Pareto-native search in the engine** — dominance is post-processing over run results only.
- [ ] The batch runs off a **pinned base** (a mid-batch sync does not alter in-flight runs) as a **background job**, and writes a **manifest** (name, label, demand-as-of, config set, run ids, KPI vectors, dominance flags) that reopens an old comparison as a projection.
- [ ] The **operator UI** lets a non-technical user load a named comparison from a list, read plain-language results (no jargon / seconds / ids), and select a strategy; selection **adopts the policy and re-solves current demand** and does not auto-commit or write back.

---

## Open Decisions

1. **Gap interpretation is Stafford's** — CTP emits signed seconds; green/red thresholds and "call the customer" triggers are Stafford-supplied config, not a CC build. *(Resolves the old graded-vs-binary question — the signed gap is inherently continuous.)* Open part: confirm Stafford will supply thresholds, and where that interpretation config lives.
2. **Rollup set for comparison** — confirm the per-config rollups Kaleb wants to rank on (`deliveryGap.lateCount` + `lateTotalSec` + `worstLateSec` recommended); avoid a single blended penetration score. *(Naming resolved: `deliveryGap.*` namespace, so no clash with the chain-idle `worstGapMinutes` diagnostic.)*
3. **Starter config weights** — the exact composite weights for the 5 configs (esp. bottleneck-first successor-awareness and ATC weighting).
4. **Batch size vs runtime** — how many configs run per bake-off within an acceptable wait (5 is the starter; parallel-at-boundary keeps it bounded).
5. **Customer-date field (later, non-blocking)** — which SO entity field becomes authoritative (Allan / Genius ticket) and the Work7 misalignment resolution — a one-field swap at the mapping point.
6. **Selection semantics** — *Resolved (from working-backwards on the operator UI):* selecting a config **adopts the policy and re-solves against the current base**, a normal solve promotion — it does not resurrect the bake-off's pinned-base plan artifact. The confirm copy states this.
7. **Dominance axes for v1** — which 2–3 KPI components define the frontier. Recommended: count-late + total-late-seconds, worst-lateness as the third. Same Kaleb-question shape as Open Decision 2; resolvable in the same conversation. Beyond 3 axes, drop the scatter and keep only the dominated/frontier flag in the table.
8. **Manifest naming + retention** — auto display name (dataset + week) plus optional user label; retention: **manifest persists indefinitely** as the decision record, non-selected run detail partitions GC'd on selection or a TTL. Confirm the TTL and whether "In use" comparisons pin their run details.
9. **Manifest row shape** — *Resolved:* **validated flat** `{ name, strategy, activeSequence?, scoringWeights? }` over `DISPATCHING_STRATEGIES`, not a discriminated union. `activeSequence` on a dynamic strategy is a hard load-time error (datedness derived from the registry, the single source of truth — a union's `kind` discriminant would duplicate it and drift). `tier` is batch-level, not per-row.
10. **Determinism (Stafford correctness, not a demo nicety)** — *Resolved:* **seeded.** v1 runs at the constructive tier (deterministic by construction); any optimizer-inclusive batch pins one RNG seed batch-wide + iteration-cap termination, extending the fixed-demand invariant to the RNG. Not variance-quantified in v1; a bounded multi-seed noise-band is the evidence-gated fallback only if a pinned seed is shown to bias the frontier. Open part: confirm the tier Kaleb's bake-off runs at (constructive isolates *selection* policy — recommended for v1).
