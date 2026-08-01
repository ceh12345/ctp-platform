# Handoff — Dispatch Seam → KPI Bake-off Harness

**From:** `SPRINT-dispatch-strategy-seam.md` (Phases 0.5–4, shipped)
**To:** `SPRINT-solver-comparison.md` (the KPI bake-off harness)
**Status:** the seam is built, tested, and on `feature/dispatch-strategy`. This doc is Phase 5 — the contract the harness consumes. **No harness code is in this sprint;** the manifest / comparison-surface wiring is the harness sprint's Phase 2/3.

---

## 1. What the seam gives you

The bake-off's job is "hold everything constant, vary one thing, attribute the KPI delta to that thing." The seam makes **the dispatch rule ("what to make next") that one thing** — a first-class, swappable axis, with a fairness guarantee baked in.

Concretely, three things are now true that weren't before:

1. **Selection is a plug, selectable per solve.** The rule that decides pick-order is an `IDispatchPriority` chosen by a single string key — no code change to swap it.
2. **Every rule reads one shared, read-only lens** (`DispatchState`), so the derived quantities a rule needs (`now`, `asOf`, average remaining work, resource load, order dates) are computed **once, one way**. Two runs can't disagree about "what the clock is" — the only thing that varies is the policy.
3. **The default rule is itself a plug** (`StaticRankPriority`) that reproduces the legacy schedule **byte-for-byte** (parity-gated). So "no dispatch change" is a real, measurable baseline in the same machinery.

---

## 2. How a config names its rule (the selection API)

One field selects the rule. Resolution order in `CTPService.solve()`:

```
request.strategy  →  configurationKey's strategy  →  tenant settings.solverStrategy  →  'Chain'
```

For a bake-off run, set it per solve:

```ts
await ctpService.solve({ strategy: 'Slack' });   // or 'ATC' | 'DBR' | 'Chain' | 'DueDate' | ...
```

- **Validated** against the registry (`StrategyConfigService.validateStrategy`) — an unknown key throws `INVALID_STRATEGY`, so a manifest typo fails loudly, not silently.
- **Registry:** `DISPATCHING_STRATEGIES` in `packages/api/src/config/strategy-defaults.ts`. Each entry carries picker metadata (`label`, `icon`, `short`, `detail`, `bestFor`, `time`) you can render directly in the comparison surface. Current keys: `Chain`, `ATC`, `DBR`, `Slack` (new; seam-based), plus legacy `Greedy`, `DueDate`, `ShortestFirst`, `ChainFirstFit`.
- **`resolveStrategy(key)`** (`basescheduler.ts`) maps the key → implementation. Adding a rule later is one registry entry + one `case` — no harness change.

---

## 3. The config taxonomy — static vs. dynamic

A bake-off config bundle is **`(processingSequence, objectiveWeights, dispatchStrategy)`**. The dispatch axis has two shapes:

| shape | what varies | how it's expressed |
|---|---|---|
| **Static** | the *processing sequence* (`activeSequence` → `processingRanks`), under the **default plug** | `{ strategy: 'Chain', activeSequence: '<name>' }` |
| **Dynamic** | the *plug itself*, computed live from the lens (ignores the static sequence) | `{ strategy: 'ATC' \| 'DBR' \| 'Slack' }` |

- **Static configs** are "same rule, different demand priority" — they re-rank via the tenant's `processingSequences` (e.g. Work-Order-Priority vs. delivery-date-first). `StaticRankPriority` reads that precomputed `rank`; the sequence is the variable.
- **Dynamic configs** are "different rule" — the plug derives priority from current state (slack, bottleneck, ATC index) and does **not** consult the static sequence.

So a manifest row is fully specified by `{ strategy, activeSequence?, scoringWeights?, tier? }`. `configurationKey` can bundle scoring + strategy + tier if you prefer named configs over inline.

---

## 4. Why the numbers are comparable (the fairness invariant)

Every plug receives the **same** `DispatchState` lens, rebuilt once per selection round by `DynamicNeighborhood`. Its derived accessors are **memoized and computed one way**:

- `now()` — ready-set frontier
- `asOf()` — **fixed snapshot clock = `horizon.startW`** (the `ClockService` asOf materialized); this is what ATC/Slack measure slack against, so it's identical across runs
- `avgRemainingDuration()` — `p̄`
- `resourceLoad()` — per-resource demand (DBR's drum)
- `dueDateOf` / `deliveryDateOf` / `penaltyOf` — order-sourced dates

Because "now," "the bottleneck," and "average work" are defined **once**, any KPI delta between two runs is attributable to the **policy**, never to two rules disagreeing about the inputs. The lens is **read-only** (enforced by type and by `lens-readonly.test.ts`) — a rule observes, never mutates — so runs can't contaminate each other. This is the property the bake-off rests on; don't bypass the lens (e.g. don't let a harness config compute its own `now`).

---

## 5. The signed-gap KPI — the one thing the harness must get right

The headline KPI is the **signed customer-delivery gap** (job-in-date floating vs. customer-delivery-date fixed, ±). Two hard requirements the seam sets up but the harness must enforce:

1. **Inner-join, not left-join.** The gap population is `(jobEnd ⋈ customerDeliveryDate)`. An order with **null `customerDeliveryDate`** (internal/stock — jobType ≠ `C`) has **no customer date to be late against** → it **drops from the gap population**. Do **not** coerce null → 0/epoch; that's a sentinel leaking through the KPI door and would fabricate a gap. The seam guarantees the upstream honesty (the lens returns real `null`, never a sentinel); enforcing the inner-join at the rollup is the harness's job.
2. **Backfill ≠ late.** Under the dynamic plugs, null-customer-date work is *backfill* (fills white space), not "very late." It should be invisible to the customer-gap KPI and measured, if at all, on throughput/utilization — a different axis.

Data note: `customerDeliveryDate` = Genius `DeliveryDate`, populated only for `jobType='C'`; `dueDate` = `JobEndDate` (internal target). They are **distinct real dates** — so ATC (internal) and Slack (customer) genuinely diverge; the bake-off will see different schedules and different gaps between them.

---

## 6. Gotchas (read before you wire runs)

- **Not every tenant is deterministic.** `demo-manufacturing`, `summit-pharma`, `stafford-engineering` run the ILS/tabu **optimizer** after the constructive pass (`perturbation.ts` uses `Math.random()`; `tabusearch.ts` terminates on a wall-clock budget) — so their schedules vary run-to-run and **cannot back a byte-for-byte comparison.** The constructive dispatch is deterministic; the parity gate uses only `stafford-slim-100`, `acme-outpatient`, `hrmd-rec-sports`. For the bake-off, either compare on deterministic tenants or seed/iteration-cap the optimizer first (a recorded follow-on).
- **"Slack == default on tenant X" is usually a data fact, not a bug.** If a tenant hasn't hydrated `customerDeliveryDate`, every order is backfill → Slack reduces to the default. See the "Field-dependency ordering" note in the sprint doc. Verify Slack on a tenant that actually carries customer dates (slim-100/2000 do).
- **Schedule-level divergence needs contention.** On small/uncontended tenants (slim-100), pick-order changes but final placement doesn't — the plugs differ at the *selection* layer, not the schedule. For a schedule-level bake-off, use a contended tenant (slim-2000, 2035 tasks) or measure selection-order/KPI directly.
- **Dispatch is *selection* only.** Stafford's full rule also has a *distribution* half (spread a ranked op-code pool across fabricators) — that's **placement** (`ScoringEngine`/resource-preference), a separate axis. The bake-off varies selection here; don't attribute placement effects to the dispatch rule.
- **The lens escape hatch** (`state.landscape`) exists for rules that need raw state, but anything a rule reads through it is *not* memoized/shared — prefer the typed accessors so comparability holds.

---

## 7. What the harness sprint still owns

- The **manifest** format (a list of `{ strategy, activeSequence?, scoringWeights?, tier? }` rows) and its runner.
- The **comparison surface** (render the per-config KPI table; the registry metadata in §2 feeds the labels).
- The **signed-gap rollup** with the inner-join semantics of §5.
- Optimizer **determinism** (seed + iteration cap) if the bake-off needs the non-deterministic tenants.

Everything above the line — selecting a rule, the shared lens, the taxonomy, the honest-null contract — is shipped and stable. Build the harness on top; don't reach under it.
