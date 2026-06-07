# Feature-B: Enrichment (`enrichment.json`)

**Status:** Designed from walkthrough evidence — spec ready, not yet prompted
**Depends on:** capture phase (`raw/`), normalization phase (`normalized/`), mapping (generic-model output)
**Siblings:**
- `SPRINT-feature-b-validation.md` (post-mapping assertions on the generic model)
- `SPRINT-feature-b-normalization.md` (pre-mapping source-shape mutations)
- Parent: `staging-architecture-design.md`

---

## Problem

The staging architecture spec calls out Phase 3 enrichment as "add derived fields, compute aggregates, mark cancellation-cascade tasks, annotate validation issues." That list suggests a single uniform mechanism. The walkthrough exposes that enrichment has **four structurally different output modalities** at once and a load-bearing architectural rule no spec currently documents (time-invariant vs time-sensitive).

Two concrete enrichment cases already exist as runtime code that would benefit from staging-time precompute:

1. **Cross-filter** (commit `8f00fd7`) — drops WOs whose Job isn't in the active set. Runs on every sync at runtime in `sync.service.ts`. Should run once at staging time and let runtime trust the staged data.
2. **WO sequence + CTPLinkId derivation** — described in `SPRINT-workordergroup-entity.md`'s "WO normalization" section. Deterministic from BOM tree structure. Currently happens at engine load via chain-propagation. Same precompute argument.

A third surfaced from the cross-filter walkthrough: **Stafford's Z-prefix overhead "bucket jobs"** (`Z-CLEANING`, `ZWOR 24-25`, `ZCUS`) are time-tracking infrastructure, not schedulable work. Today they're filtered out by accident because Stafford marks them `Active=false` in Genius. If that ever flips, the engine would try to schedule "CLEANING INDIRECT HOURS." A latent bug that staging enrichment should make impossible by classifying jobs by business intent, not by side-effect of a flag.

Feature-b surfaces and persists these with a per-tenant `enrichment.json` sibling to `mapping.json`, `validation.json`, and `normalization.json`.

```
config/tenants/{tenant}/integration/
  adapter.json
  mapping.json
  validation.json
  normalization.json
  enrichment.json   ← new
```

---

## Where this sits — last layer before the engine

Aligns with the existing validation sprint's pipeline ordering:

```
source data
   │
   ▼
[ normalization.json ]   source-shape mutations
   │
   ▼
[ mapping.json ]         → generic model
   │
   ▼
[ validation.json ]      assertions; advisory in beta
   │
   ▼
[ enrichment.json ]   ← THIS FEATURE
   │   classify, drop-with-annotation, derive sequence,
   │   emit CTPLinkId chain, compute per-Job aggregates
   │
   ▼
staged snapshot → engine reads
```

Boundary with neighbors:
- **Normalization** mutates source-shape (per-record cleanup), no cross-record analysis
- **Validation** reports, never mutates, per-record assertions on generic model
- **Enrichment** mutates the generic model **with cross-record analysis** — derives structural side-products, computes aggregates, annotates drops

The cross-record property is what separates enrichment from normalization. Normalization can run per-record in a streaming fashion; enrichment needs all relevant records loaded together.

---

## Core design decisions

### 1. Time-invariant vs time-sensitive — load-bearing architectural rule

The biggest call this sprint makes: **enrichment owns only time-invariant computations**. Anything that depends on the current wall-clock time stays at runtime.

| Concern | Time-invariant? | Where it lives |
|---|---|---|
| Cross-filter (active-job gate) | Yes — depends on JobEntity snapshot | Enrichment (move from runtime `sync.service.ts`) |
| WO topological sequence | Yes — depends only on tree structure | Enrichment (move from engine load) |
| CTPLinkId emission per BOM edge | Yes — depends only on parent/child edges | Enrichment |
| Per-Job aggregates (workOrderCount, taskCount, sum durations) | Yes | Enrichment |
| Job classification (production vs overhead vs system-test) | Yes — depends only on record fields | Enrichment |
| `wipState` per task | Yes | Mapping (existing, unchanged) |
| **WorkOrderGroup status (ON_TRACK / AT_RISK / LATE)** | **No — compares `currentTime` vs `sourceEnd`** | **Runtime — `WorkOrderGroupService.refreshRollups`** |
| **Buffer-day "AT_RISK fires when" check** | **No — same reason** | **Runtime** |

Without this rule, every time-sensitive concern would silently migrate into staging and stale instantly. Document it explicitly in the spec, enforce it in code review.

### 2. Annotate-don't-drop

When enrichment "drops" a record (cross-filter, classification rule, etc.), it **annotates the record** with `dropped: true, dropReason: "..."` rather than deleting it. Two reasons:

- **Auditability** — the inspector export and ops debugging can show "we dropped 157 WOs, here they are, here's why each"
- **Reversibility** — if a rule turns out wrong, the data is still there; just flip an annotation

The runtime layer reads only records with `dropped !== true`. Same end-state, more debuggable.

The current cross-filter (commit `8f00fd7`) silently drops; rewrite to annotate when relocating to staging.

### 3. Business intent over filter side-effects

The Z-prefix finding (see walkthrough) showed the cross-filter doing two structurally different jobs:
- Designed: drop WOs whose Job is `Active=false` (filter asymmetry cleanup)
- Accidental: drop overhead "bucket jobs" that Stafford happens to mark `Active=false`

The accidental case is brittle. Enrichment classifies records by **business intent** (production vs overhead vs system-test) using explicit rules, then drop rules reference the classification. If Stafford ever flips a Z-prefix bucket job to `Active=true`, the classification still catches it.

### 4. Four output modalities — co-located, distinct

Enrichment uniquely outputs all four:

| Modality | Example |
|---|---|
| **Mutate records** | Add `wgSequence: 7`, `classification: "production"`, `dropped: true, dropReason: "..."` |
| **Emit structural side-products** | `enriched/wg-chain.json` (CTPLinkIds), `enriched/aggregates.json` |
| **Drop records with logged reason** | Annotated above; counts feed `_enrichment-report.json` |
| **Compute aggregates** | Per-Job task counts, total planned hours, etc. |

Different mechanisms in the config schema, but one phase.

### 5. Idempotent on the same input

Same input snapshot + same `enrichment.json` → byte-identical output. Required for debugging diffs and for retry semantics.

---

## File schema

```jsonc
{
  "tenant": "stafford-engineering-test",
  "version": 1,

  // ── (1) Classify records by business intent ───────────────────────────
  // Multiple rules per entity, evaluated in order; first match wins.
  // Writes the value into a new field on the record (default: "classification").
  "classifications": {
    "jobs": {
      "writeTo": "classification",
      "rules": [
        { "match": "Job matches ^SYST",        "value": "system-test" },
        { "match": "Job matches ^Z",           "value": "overhead-bucket" },
        { "match": "JobType == C",             "value": "production" },
        { "match": "JobType in [I, U, Q]",     "value": "non-production" },
        { "default": true,                     "value": "unclassified" }
      ]
    }
  },

  // ── (2) Drop rules — annotate, don't delete ────────────────────────────
  // Each rule produces { dropped: true, dropReason: "<rule.id>" } on
  // matching records. Reports per-rule counts in _enrichment-report.json.
  "dropRules": [
    {
      "id": "non-production-job-wos",
      "entity": "wo",
      "match": "job.classification != production",
      "rationale": "Overhead buckets, system-test, non-production jobs don't enter scheduling"
    },
    {
      "id": "cancelled-wo-on-inactive-job",
      "entity": "wo",
      "match": "Wostatus == CANCELLED",
      "rationale": "Already filtered at adapter (commit f544c6d+8f00fd7); belt-and-braces"
    },
    {
      "id": "task-on-dropped-wo",
      "entity": "task",
      "match": "wo.dropped == true",
      "rationale": "Cascade — tasks of dropped WOs follow"
    },
    {
      "id": "task-with-missing-wo-reference",
      "entity": "task",
      "match": "wo == null",
      "rationale": "FK integrity gap; tasks pointing at non-existent WOs"
    }
  ],

  // ── (3) Derive structural side-products ────────────────────────────────
  // Each derivation produces side-output files in enriched/ and/or
  // annotates records with derived fields.
  "derive": [
    {
      "id": "wg-sequence",
      "type": "topological-sort",
      "entity": "wo",
      "groupBy": "Job",
      "parentField": "ParentWorkOrder",
      "selfField": "WorkOrder",
      "writeTo": "wgSequence",
      "tieBreak": "WorkOrder"
    },
    {
      "id": "ctp-link-chain",
      "type": "bom-edges",
      "entity": "wo",
      "groupBy": "Job",
      "parentField": "ParentWorkOrder",
      "selfField": "WorkOrder",
      "sideOutput": "enriched/wg-chain.json"
    }
  ],

  // ── (4) Aggregate computations ──────────────────────────────────────────
  // Each aggregate produces a row keyed by the groupBy value.
  // Aggregates over non-dropped records only.
  "aggregates": {
    "perJob": [
      { "id": "workOrderCount",     "from": "wo",   "groupBy": "Job",     "agg": "count" },
      { "id": "taskCount",          "from": "task", "groupBy": "JobCode", "agg": "count" },
      { "id": "totalPlannedHours",  "from": "task", "groupBy": "JobCode", "agg": "sum",   "field": "TotalPlannedMachineHours" },
      { "id": "totalProducedHours", "from": "task", "groupBy": "JobCode", "agg": "sum",   "field": "TotalCumulativeMachineHours" }
    ]
  }
}
```

### Match expression grammar

Same posture as the validation sprint: keep small, expand only on demand. v1 supports:
- Field reference (`Job`, `JobType`, `Wostatus`)
- Cross-entity dotted reference (`job.classification`, `wo.dropped`) — resolves the linked record via FK
- Comparisons: `==`, `!=`, `in [...]`
- Regex: `matches <pattern>`
- Null check: `field == null`, `field != null`

Out of scope for v1: boolean composition (use multiple rules), arithmetic, user-defined functions.

---

## Cascade-reason taxonomy

The walkthrough found that "cancellation cascade" is too coarse — real data shows multiple distinct cascade reasons. Standardize as an enum, emitted in `dropReason`:

| Reason | When |
|---|---|
| `job-inactive` | Parent Job not in active JobEntity set |
| `cancelled-wo-on-inactive-job` | Wostatus CANCELLED + Job inactive (subset of above; more specific) |
| `non-production-job` | Job classification is overhead-bucket / system-test / non-production |
| `system-test-job` | Job matches SYST pattern (subset of non-production; more specific) |
| `missing-wo-reference` | Task references WO not in WO set |
| `missing-job-reference` | WO or task references Job not in any Job set (active or filtered) |
| `validation-failed` | Record failed a `severity: error` validation rule and `policy: blocking` is active |

Rules emit the **most specific** reason that applies (so `system-test-job` not `non-production-job` when both apply).

---

## Output: `_enrichment-report.json`

Parallel to `_validation-report.json` and `_normalization-report.json`. Machine-readable for promotion-gate logic and ops dashboards.

```jsonc
{
  "tenantId": "stafford-engineering-test",
  "snapshotId": "2026-06-03-2014",
  "enrichedAt": "2026-06-06T10:00:00Z",

  "classifications": {
    "jobs": {
      "production":      496,
      "non-production":  50,
      "overhead-bucket": 24,
      "system-test":     2,
      "unclassified":    0
    }
  },

  "drops": {
    "byRule": {
      "non-production-job-wos":      { "wos":  66, "tasks": 0  },
      "cancelled-wo-on-inactive-job": { "wos":  89, "tasks": 0  },
      "task-on-dropped-wo":          { "wos":  0,  "tasks": 46 },
      "task-with-missing-wo-reference": { "wos": 0, "tasks": 6 }
    },
    "totals": { "wos": 155, "tasks": 52 }
  },

  "derivations": {
    "wg-sequence":  { "wosSequenced": 714, "jobsCovered": 279, "maxDepth": 51, "cyclesDetected": 0 },
    "ctp-link-chain": { "edgesEmitted": 435, "sideOutput": "enriched/wg-chain.json" }
  },

  "aggregates": {
    "perJob": { "rowsEmitted": 279 }
  },

  "warnings": [
    "5 jobs ended with zero tasks after enrichment (3 empty-cascade, 2 empty-completed)"
  ]
}
```

---

## Seed config for Stafford

Derived from the 2026-06-06 walkthrough. First-draft; review against the next snapshot.

| Concern | Mechanism | Evidence from walkthrough |
|---|---|---|
| Z-prefix overhead bucket jobs | classification → drop | 66 WOs + 46 tasks dropped accidentally today via Active=false side-effect |
| SYST-prefix system test | classification | 2 WOs leaked via filter asymmetry |
| Production vs non-production via JobType | classification | C=496 production, I+U+Q=62 non-production, balanced against the 24 Z-prefix overhead |
| Cancelled WOs on inactive Job | drop rule | 89 WOs (already filterable at adapter per PR `8f00fd7`; belt-and-braces here) |
| WO sequence + CTPLinkId | derivation | 279 Jobs, 714 WOs sequenced, 435 BOM edges, 0 cycles |
| Per-Job aggregates | aggregation | 5 Jobs end with 0 tasks (empty-cascade or empty-completed) |

---

## Ordering tension with adapter-level filters

The walkthrough exposed that many records dropped here could have been filtered at capture time. Example: PR `f544c6d`+`8f00fd7` added `Wostatus!=CANCELLED` to the WO adapter filter. If that adapter config were in place at capture time for the 2026-06-03 snapshot, the 89 cancelled-WO drops here wouldn't exist — they'd never be captured.

This is a real ops tradeoff:

- **Tight capture filters** → less data flows through pipeline → faster Phases 1-3, smaller snapshots
- **Loose capture filters** → more debuggable, can see what got dropped and why

Lean: **loose at capture, tight at enrichment**. Capture gets `Wostatus!=CLOSED` (one filter, broad). Enrichment classifies and drops with annotations. This makes the pipeline observable; the `dropReason` annotations are the evidence Stafford-ops can audit.

Document this as a feature-b operational principle.

---

## Acceptance criteria

When feature-b implements this sprint:

- [ ] `enrichment.json` schema documented + JSON-schema-validated
- [ ] Enrichment runs against `stafford-engineering-test` 2026-06-03 snapshot and produces:
  - Classifications matching seed (~496 production, ~24 overhead-bucket, ~2 system-test)
  - Drop counts matching the walkthrough table (~155 WOs, ~52 tasks)
  - `enriched/wg-chain.json` with 435 CTPLinkIds, no cycles
  - Per-Job aggregates for 279 jobs
- [ ] `_enrichment-report.json` matches the spec shape
- [ ] Annotate-don't-drop: every dropped record retains its data + carries `dropped: true, dropReason: "..."`
- [ ] Idempotency: re-running on same input produces byte-identical output
- [ ] Time-invariant rule enforced in code review (no `Date.now()` / `new Date()` in enrichment code paths)
- [ ] Cross-filter logic in `sync.service.ts` removed; runtime trusts staged data
- [ ] WO sequence + CTPLinkId derivation in engine load path removed; engine reads precomputed `enriched/wg-chain.json`
- [ ] Cascade-reason taxonomy enforced (specific over general)

---

## Explicitly NOT in this feature

- **Time-sensitive enrichment.** `WorkOrderGroupService.refreshRollups` stays at runtime. Status (ON_TRACK / AT_RISK / LATE) and buffer-day checks read current time and cannot be cached.
- **Validation issue annotation.** Validation owns its report (`_validation-report.json`). Enrichment doesn't re-export validation failures; it consumes the validation outcome when `policy: blocking` is active (drops records that hard-failed validation).
- **Mapping changes.** Enrichment runs on the generic model produced by mapping; it doesn't restructure or re-map.
- **Engine refactor to consume precomputed `wg-chain.json`.** This sprint produces the artifact; the engine-side consumption is a separate engine sprint. Until that lands, engine continues to derive in-flight (harmless duplicate work, not a correctness gap).
- **Schema migration of historical snapshots.** When `enrichment.json` evolves, old snapshots stay valid; re-enrich on demand if needed. Don't auto-rebuild.

---

## Open questions for the implementer

1. **Ordering relative to validation.** Two valid orderings:
   - (a) **Validation → enrichment**: validation flags records; enrichment can drop them via `validation-failed` reason
   - (b) **Enrichment-drop → validation → enrichment-derive**: drop first so validation doesn't waste rules on doomed records
   Lean (a) — single enrichment pass, validation as upstream advisor. Performance overhead of validating doomed records is small at our scale (~thousands of records).

2. **Cross-entity match resolution.** The schema uses `job.classification`, `wo.dropped` as cross-entity references. How are these joins computed efficiently? Lean: build all join indexes up-front, evaluate matches in a single pass per rule.

3. **Should aggregates land back on the parent record?** E.g., write `job.workOrderCount: 51` rather than emit a separate `aggregates.json`. Pros: easier to consume in inspector. Cons: pollutes the entity record with derived state. Probably both — sidecar file for machine-readable, fields-on-record for human-friendly.

4. **Pattern-match grammar — regex vs glob.** The seed uses `matches ^SYST` (regex). Glob (`SYST*`) is friendlier but less powerful. Stay with regex; it's a config edited by engineers, not operators.

5. **What happens to dropped records during inspector export?** Show them with `[DROPPED]` styling? Hide them by default with a toggle? UI concern, but enrichment owns the annotation that drives it.

---

## Walkthrough findings — 2026-06-06 (research-mode manual pass)

Source evidence for this sprint. Each finding maps to a config mechanism above.

| # | Manual finding (against 2026-06-03 WORK7 capture) | Maps to |
|---|---|---|
| 1 | Cross-filter at staging drops 157 WOs + 52 tasks (= runtime work in commit `8f00fd7`) | Relocate to enrichment. Annotate, don't delete. |
| 2 | **Z-prefix overhead "bucket jobs"** (`Z-CLEANING`, `ZWOR`, `ZCON`, `ZCUS`) — 66 PRINTED/CREATED WOs + 46 tasks — get dropped today only because Stafford marks them `Active=false`. Not a designed filter. | `classifications.jobs` rule + drop rule. Business intent, not Active-flag side-effect. |
| 3 | WO topological sequence (Kahn): 279 jobs, 714 WOs, max depth 51, 0 cycles | `derive: { type: "topological-sort" }` precomputed at staging, not engine load |
| 4 | 435 BOM-tree edges → 435 CTPLinkIds across 279 jobs | `derive: { type: "bom-edges" }` emitted to `enriched/wg-chain.json` |
| 5 | 5 Jobs end with 0 tasks after cross-filter (cascade casualty vs all-completed) | Aggregates + `warnings[]` in `_enrichment-report.json` |
| 6 | Cancellation cascade is NOT a single bucket — real data has 4+ distinct reasons (job-inactive, cancelled-wo-on-inactive, missing-wo-ref, system-test) | Cascade-reason taxonomy enum, most-specific-reason rule |
| 7 | `SYST-01`, `SYST-02` leak through WO endpoint despite `Job<SYST` filter on JobEntity | `classifications.jobs` rule `Job matches ^SYST → system-test`. Enrichment catches what tighter capture-side filtering would've prevented. |
| 8 | 147 tasks have `TotalPlannedMachineHours <= 0` — will fail validation | Annotate (don't drop). Let validation report. Inspector shows. |
| 9 | Cross-filter today silently drops 209 records; auditability matters | Annotate-don't-drop principle established as core design decision |
| 10 | 89 cancelled WOs flow through here that PR `f544c6d`+`8f00fd7` would have filtered at adapter time | Ordering principle: **loose at capture, tight at enrichment** for observability |

## Related work

- Parent: [staging-architecture-design.md](staging-architecture-design.md) — overall feature-b spec
- Siblings: [SPRINT-feature-b-validation.md](SPRINT-feature-b-validation.md), [SPRINT-feature-b-normalization.md](SPRINT-feature-b-normalization.md)
- Cross-filter to relocate: `packages/api/src/modules/integration/cross-filter.ts` + `sync.service.ts` (commit `8f00fd7`)
- WO normalization (sequence + CTPLinkId) currently described as engine work: `docs/sprints/SPRINT-workordergroup-entity.md` "WO normalization within a WorkOrderGroup" section — moves to enrichment when feature-b ships
- Time-sensitive rollup that stays at runtime: `packages/api/src/modules/workordergroup/workordergroup.service.ts` `refreshRollups`
- 2026-06-03 capture (walkthrough source): `tools/mock-genius/recorded/stafford-work7-2026-06-03/`
