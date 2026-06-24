# SPRINT: Processing Sequences — Tenant-Defined Demand Prioritisation

**Status:** Draft for review
**Branch:** main (additive — schema, hydrator, engine read path)
**Author:** Chris
**Purpose:** Replace the hardcoded inter-Group priority criterion with a tenant-configurable, named sequence system. Each tenant defines one or more processing sequences specifying how demand (work orders) is prioritised for scheduling. Composite weighted ranking under the hood, with ergonomic config for tenants who think in priority order.

---

## Why this sprint exists

The platform currently has no first-class concept of demand prioritisation. The previous design landed on a single hardcoded rule for Stafford (delivery date asc, sales order number asc). That works for one tenant; it doesn't generalise.

This sprint replaces that with a tenant-configurable system: each tenant defines named sequences with explicit sort criteria; the hydrator computes a numeric rank per WO per sequence; the engine consumes ranks at solve time.

Three outcomes this sprint earns:

1. **Stafford's rule expressed as data, not code.** Same operational behaviour as the previous design, but configured in tenant config rather than embedded in the platform.
2. **The platform supports multiple priority orderings per tenant.** Different scenarios (push for delivery, optimise for throughput, customer-tier weighting) can be expressed and selected per solve.
3. **The architecture supports future ML-driven tuning.** Weights are continuous parameters; the system can be extended to optimise weights against observed schedule quality without restructuring.

---

## Design principles

1. **Composite weighted ranking is the single computational model.** No separate lexicographic mode. Lexicographic-style behaviour is achieved by skewed weights (primary dominates secondary by orders of magnitude). The math is forgiving — weights don't need precise calibration to produce sensible orderings.

2. **Multiple expression forms compile to the same engine.** Tenants who think in priority order use the `importance` shorthand ("primary," "secondary"); tenants who want explicit control use numeric `weight` values. Both produce the same numeric ranks consumed by the engine.

3. **Path expressions resolve cross-entity field references.** Sort criteria explicitly name the entity and field: `group.deliveryDate`, `order.dueDate`, `order.attributes.Strategy`. No implicit field resolution; no ambiguity about which entity's field is consulted.

4. **Ranks are computed at sync time, denormalised onto the WO.** Engine reads a single float per WO per sequence. Same pattern as task `sequence` derivation — derive once, consume flat.

5. **Sequences are user-named, user-selectable.** Each sequence has a name the user sees; users (or solve API callers) pick which sequence to use per solve.

6. **Backward compatibility via sensible defaults.** Tenants without explicit sequences fall back to a platform default (probably `order.priority asc`) so the engine never lacks a rank field.

---

## Backend / Model

### Phase 0 — RESOLVED (locked, 2026-06-24)

Verified against the Stafford data; two spec field names don't exist and are remapped:
- **`group.deliveryDate` → `group.promiseDate`** (the delivery commitment; `group.sourceEnd` is the alternative). `deliveryDate` is not a field on the group.
- **`order.salesOrderNumber` → `hierarchy.SalesOrder`** (hierarchy slot 3, populated 27/29 on slim-100; empties sort last). SalesOrder is a HIERARCHY slot, **not** an attribute (attributes are Strategy / JobType / CustomerSource / DbrEndDate / ProjectManager*).

Resolution is **source-shaped, computed at hydrate**: the lean entity classes don't expose attributes/hierarchies as typed fields, so the resolver reads `order.dueDate` / `order.priority` (first-class) else `order.rawFields[...]`, the `attributes[]` / `hierarchies[]` arrays, and `group.promiseDate` / `sourceEnd` from the raw group data (`getWorkOrderGroupsData()`), not the reduced `CTPWorkOrderGroup`.

Storage + read seam: net-new `processingRanks: Record<sequenceName, number>` per WO (on `CTPOrder`), read at solve start. Engine seam = `getChainPriority` / `getChainsInPriorityOrder` (`basescheduler.ts`); ranks key on the **component head WO** (composes with Phase 1 §6) with WO-topo position kept as the hard within-component tiebreak. Active sequence via `SolveRequestDto.activeSequence` (default = tenant `defaultSequence`).

### Schema additions

**Tenant config:**

```json
{
  "tenant": "stafford-engineering-test",
  "processingSequences": [
    {
      "name": "delivery-date-first",
      "displayName": "Delivery Date Priority",
      "criteria": [
        {
          "field": "group.promiseDate",
          "direction": "asc",
          "importance": "primary"
        },
        {
          "field": "hierarchy.SalesOrder",
          "direction": "asc",
          "importance": "secondary"
        }
      ]
    }
  ],
  "defaultSequence": "delivery-date-first"
}
```

**Schema validation rules:**

- `name` — unique within the tenant; lowercase-hyphenated string.
- `displayName` — user-facing label.
- `criteria` — non-empty array.
- For each criterion:
  - `field` — path expression (see below). Must resolve against the tenant's entity model.
  - `direction` — `"asc"` or `"desc"`.
  - Either `weight` (non-negative number) OR `importance` (`"primary" | "secondary" | "tertiary" | "quaternary"`). Exactly one required.
  - `nullsHandling` — `"first"` or `"last"`. Default `"last"`.
- `defaultSequence` — must reference a defined sequence name.

### Path expressions

Sort field references use dotted-path syntax. Supported paths:

| Path | Resolves to |
|---|---|
| `order.<field>` | A direct field on the CTPOrder (e.g. `order.dueDate`, `order.name`) |
| `order.attributes.<name>` | An attribute on the CTPOrder (e.g. `order.attributes.Strategy`) |
| `group.<field>` | A field on the WO's WorkOrderGroup (e.g. `group.deliveryDate`, `group.promiseDate`) |
| `group.attributes.<name>` | An attribute on the WO's WorkOrderGroup |
| `hierarchy.<slot>` | A hierarchy slot value (e.g. `hierarchy.customer`, `hierarchy.project`) |

Resolution at sync time:

1. Parse the path into entity and field components.
2. For `order.X` — read X directly from the WO.
3. For `group.X` — look up the WO's group via `groupKey`; read X from that group. If the WO has no group, value is null.
4. For `*.attributes.X` — look up attribute named X in the relevant attributes list.
5. For `hierarchy.X` — look up the hierarchy slot value via mirror.

**Validation at config load:** every path must be resolvable for the tenant's entity model. A tenant without Groups (no WO has a `groupKey`) cannot use `group.*` paths.

### Importance-to-weight mapping

The `importance` shorthand maps to internal weight values:

| Importance | Weight |
|---|---|
| primary | 1.0 |
| secondary | 0.01 |
| tertiary | 0.0001 |
| quaternary | 0.000001 |

These produce lexicographic-style behaviour: primary dominates secondary by 100×, which dominates tertiary by 100×, etc. The skew is large enough that for normalised values in [0, 1], a one-unit-of-resolution change in the primary criterion outranks any value of the secondary.

Tenants needing fine-grained control use explicit `weight` values instead.

### Rank computation (hydrator)

For each tenant on each sync:

1. **Normalise weights.** Sum all criterion weights for the sequence; divide each by the sum. (Internal normalisation; user input is unnormalised.)
2. **Compute per-criterion normalised values.** For each criterion, across all WOs in the tenant:
   - Resolve the field value per WO.
   - Find min and max of resolved values.
   - For each WO: `normalised = (value - min) / (max - min)` (if max ≠ min; else 0).
   - If direction is `desc`: `normalised = 1 - normalised`.
   - For null values: place at `1.0` (sorts last) or `0.0` (sorts first) per `nullsHandling`.
3. **Compute composite rank per WO:** `rank = Σ (weight_i × normalised_i)`.
4. **Store** as `wo.processingRanks[sequenceName] = rank` (float).

The rank is a real number, naturally sorted ascending (lower = higher priority).

### Engine read path

At solve start:

1. Read the active sequence name from solve parameters (default = tenant's `defaultSequence`).
2. Sort WOs by `processingRanks[activeSequenceName]` ascending.
3. For group-aware solving: Groups iterated in order of their head WO's rank (same field, accessed via the Group's `headWorkOrderKey`).

The engine does no rank computation; it consumes the pre-populated float.

### Default sequence (platform fallback)

If a tenant config has no `processingSequences` defined, the platform provides a default:

```json
{
  "name": "platform-default",
  "criteria": [
    { "field": "order.priority", "direction": "asc", "importance": "primary" }
  ]
}
```

Sensible behaviour for any tenant; never leaves the engine without a rank field to sort on.

---

## Sprint scope

### In scope

- Tenant config schema additions: `processingSequences` array, `defaultSequence` field.
- Path-expression parser and resolver for supported paths.
- Hydrator computes per-WO ranks per sequence at sync time; stores as `processingRanks` dictionary on the WO.
- Engine reads `processingRanks[activeSequence]` at solve start; sorts demand by ascending rank.
- Group-aware integration: Group's effective rank = head WO's rank.
- Importance-to-weight mapping for ergonomic config.
- Platform default sequence (`order.priority asc`) when tenant has none defined.
- Validation at config load: paths must resolve; sequence names unique; default must reference a defined sequence.
- Stafford tenant config updated with `delivery-date-first` sequence as their default.
- Logging of sequence-resolution issues during sync (null fields, invalid paths, missing groups for `group.*` references).

### Explicitly out of scope

- **Bottleneck-aware sequencing.** Different mechanism — depends on schedule state, not just demand attributes. Separate sprint.
- **ML-driven weight tuning.** Architecture supports it; not built in v1.
- **Dynamic re-ranking between syncs** (Critical Ratio-style). Ranks are sync-time snapshots; conditions changing between syncs don't update ranks until next sync.
- **Task-level sequence overrides.** Task ordering remains structural (from linkId topology). This sprint is demand-level only.
- **Sequence editor UI.** Tenant config is edited at the file level for v1; UI for sequence management is a future feature.
- **Per-user default sequences.** Planners might prefer different defaults; deferred until requested.
- **Derived/computed sort fields** beyond what's stored on entities. E.g. "remaining work hours" as a sort field requires computing it; v1 sorts only on stored field values.
- **Conditional sequences** ("use delivery date for OEM, margin for aftermarket"). Speculative; defer.
- **Sequence comparison metrics** ("how different are these two sequences?"). Future analytics feature.

### Branch & merge plan

- Branch: `main` directly. Schema additions are non-breaking; new code paths are additive.
- No conflicts with the group-aware projection sprint or current Stafford work.

### Acceptance criteria

1. Stafford tenant config defines the `delivery-date-first` sequence with `group.deliveryDate` primary and `order.salesOrderNumber` secondary.
2. After sync, every WO has `processingRanks["delivery-date-first"]` populated as a float.
3. Ranks are consistent with the sequence's intended order — sorting WOs by rank ascending produces the same order as sorting by (group.deliveryDate asc, order.salesOrderNumber asc).
4. Engine reads `processingRanks` at solve start; demand order matches expectation.
5. Group-aware solving consumes Group's head WO rank; Groups process in priority order.
6. Tenants without `processingSequences` defined get the platform default (`order.priority asc`).
7. Path-expression validation rejects invalid paths at config load with clear error messages.
8. A second test sequence (e.g. `customer-priority-first`) can be defined and selected at solve time; the resulting order differs from the default.

### Sequencing inside the sprint

1. Schema: add `processingSequences` and `defaultSequence` to tenant config; validation rules.
2. Path expression parser and resolver: parse path strings; resolve against WO/Group/attributes/hierarchy.
3. Importance-to-weight mapping table.
4. Hydrator: compute ranks per WO per sequence; store as dictionary field.
5. Engine: read `processingRanks[activeSequence]` at solve start; sort demand ascending.
6. Group-aware integration: Group's rank derived from head WO.
7. Stafford tenant config update.
8. Tests: rank consistency, group-aware integration, default fallback, path validation.

---

## Open issues

### OI-1: Importance mapping defaults

Default mapping is `primary=1.0, secondary=0.01, tertiary=0.0001, quaternary=0.000001`. These produce strong lexicographic-like behaviour. If real-world testing reveals these are too skewed (secondary never matters in practice) or not skewed enough (secondary overrides primary unexpectedly), the mapping values should be tunable.

Recommend: keep these values as platform constants for v1. If tenants need different ratios, they use explicit `weight` instead of `importance`. Adjusting the importance table is a platform decision, not a tenant decision.

### OI-2: Null handling for `group.*` paths

A tenant with mixed-mode WOs (some grouped, some not) using `group.deliveryDate` will get null for ungrouped WOs. Default `nullsLast` sorts ungrouped WOs after grouped ones, which is probably right but worth confirming with Stafford.

For Stafford specifically: every WO has a group, so this never fires. For future tenants, the default is conservative.

### OI-3: Per-sequence vs per-criterion null handling

Currently null handling is per-criterion. Could simplify to per-sequence (one default for all criteria in the sequence). Slight loss of expressiveness; cleaner config. Defer the call.

### OI-4: Default sequence semantics when sequence is missing at solve time

If a user specifies a sequence name at solve time that doesn't exist in tenant config — error, or fall back to default? I'd lean error (explicit failure is better than silent fallback for solve parameters). Confirm.

### OI-5: Updating Stafford's existing config

Stafford currently has the priority criterion hardcoded somewhere (per previous discussions). When this sprint lands, that hardcoded rule needs to be replaced with the equivalent tenant config sequence. Should be a clean swap — same operational behaviour, expressed differently.

### OI-6: Computational cost of per-WO normalisation

Normalisation requires two passes over WOs per criterion: one to find min/max, one to compute normalised values. For Stafford's WORK7 scale (~1000 WOs), trivial. For a 100k-WO tenant with 4 criteria across 3 sequences, that's 100k × 4 × 3 × 2 = 2.4M operations per sync. Still fast on modern hardware but worth measuring.

---

## Out of scope (for this sprint, possibly later)

- **Bottleneck-aware sequencing.** Genuinely different mechanism. Future sprint when there's evidence Stafford or another tenant needs it.
- **ML weight tuning.** Future capability the architecture enables — a learning pass that adjusts weights based on observed schedule quality (e.g. tardiness, makespan). Not v1.
- **Composite sequences referencing other sequences.** Some shops have "first sort by sequence A, then break ties by sequence B." Could compose, but speculative.
- **Sequence presets shared across tenants.** Tenants currently define their own. If we see common patterns (e.g. "Standard EDD" with date+SO# tiebreak), platform-level presets might be valuable.
- **UI for sequence management.** Tenant config edits work for v1; a UI for non-technical users to define sequences is a future product feature.
- **Sequence analytics** ("how often is each sequence used; what's the average schedule quality difference between them"). Future capability.

---

## Next sprints (informed by this one)

- **`SPRINT-bottleneck-aware-sequencing`** — separate mechanism that ranks WOs by their current-bottleneck-resource consumption. Requires bottleneck identification (analysis pass), differs structurally from path-based sequencing.
- **`SPRINT-sequence-tuning-feedback-loop`** — capture solve quality metrics per sequence; surface to operators as "this sequence produced 12% better on-time delivery than that one over the last month." Foundation for future ML tuning.
- **`SPRINT-sequence-editor-ui`** — non-technical UI for tenant administrators to define and edit sequences. Once tenants beyond Stafford start managing their own.
- **`SPRINT-task-execution-priority`** — sequencing at the within-WO task level if a tenant emerges with that need (probably never; structural precedence is the right model for tasks).

---

## Notes for Chris (not for CC)

- The composite-weighted model is the design call you pushed for. Worth confirming this matches your intent before CC starts.
- The importance-to-weight mapping (1.0 / 0.01 / 0.0001 / 0.000001) is my guess at sensible defaults. Worth a sanity-check pass once the system is running on Stafford's data — see whether secondary criteria ever actually swap orderings, or whether the skew is too aggressive.
- The `nullsLast` default for `group.*` paths is conservative. Stafford-specific: every WO has a group so this never fires. For future tenants with mixed-mode WOs, behaviour will be visible.
- The sprint deliberately doesn't ship a sequence-management UI. Tenant config edits are fine for v1. UI work comes when tenant administrators (not just developers) need to manage their own sequences.
- Worth being explicit with CC that this sprint replaces the previous priority-criterion hardcoding for Stafford. The behavioural outcome should be identical for their default sequence; the mechanism differs.
- Path-expression validation is the most likely source of CC questions during implementation. The list of supported paths in this doc is the v1 set; if CC discovers a tenant data shape that needs additional paths (e.g. nested group attributes), surface as an extension rather than improvising.
