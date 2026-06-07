# Feature-B: Tenant Validation Layer (`validation.json`)

**Status:** 💡 Designed — spec ready, not yet prompted
**Depends on:** mapping layer (produces the generic model validation asserts against)
**Pairs with:** `SPRINT-data-inspector-export.md` (validation failures become inspector rows)

---

## Problem

The ETL pipeline runs in three phases: **validation → normalization → enrichment**. All three assume the validation rules exist. They don't — not as an artifact. "Required fields for tenant X" currently lives only in the head of whoever wrote that tenant's `mapping.json`.

We proved this by walking validation manually for Stafford: there was no file to consult. Not `mapping.json` (that says where fields come *from*, not whether they're required), not `adapter.json`, not any validation config. The knowledge is tacit, which means it can't be enforced, versioned, diffed, or shown to a client.

Feature-b surfaces and persists that knowledge. The natural shape is a per-tenant `validation.json` sibling to `mapping.json`.

```
config/tenants/{tenant}/integration/
  adapter.json
  mapping.json
  validation.json   ← new
```

---

## Why a separate file (not folded into mapping.json)

Mapping and validation are different concerns and the separation matches a boundary the architecture already draws:

- **Mapping** answers: *where does this field come from, and how is it transformed.*
- **Validation** answers: *must it be present, and is the value sane.*

These are independent axes. A field can be mappable but optional; required but derived. Folding them into one rule object tangles the axes and creates two ways to express the same fact — the exact duplication-of-truth problem this feature exists to kill. Keeping them siblings honors the clean-separation-of-concerns principle the rest of the system holds to.

---

## Core design decisions

### 1. Validation asserts against the **generic model**, not the raw source

Validation runs *after* mapping, on the post-mapping generic model. Rules reference generic field names (`durationType`, `wipState`, `hourlyRate`), never source field names (`RessourceType`, `MachineRateCost`).

Consequences:
- **Validation vocabulary is tenant-agnostic.** `required: durationType` reads identically whether the source is Genius, a flat file, or a future ERP. The mapping absorbs all source-specific weirdness; validation never sees it.
- **Validation catches "mapped output is missing/invalid,"** not "source field was missing." That's the right target — the engine consumes the generic model, so the generic model is what must be correct. A missing source field manifests as a missing/null mapped field, which validation catches downstream.

### 2. Validation owns **cross-field and presence assertions the mapping can't express on its own**

Do **not** restate single-field presence the mapping guarantees by construction. Example: the `wipState` derive rule has a `NOT_STARTED` fallback, so it never emits null — a `required: wipState` rule would be redundant and create a second source of truth.

Validation's job is the assertions mapping *can't* make:
- **Cross-field:** "a task with `wipState == COMPLETED` must have `actualEnd`."
- **Presence the mapping doesn't guarantee:** "every `PROCESS` task must have ≥1 `capacityResource`."
- **Ordering / sanity:** "`windowEnd` must be after `windowStart`," "`durationSeconds > 0`."

Rule of thumb: if the mapping makes a field total (always produces a valid value), validation doesn't restate it. Validation only covers what the mapping leaves open.

### 3. Severity axis: `error` vs `warn`, defaulting to `warn` during beta

The validation/normalization/enrichment pipeline implies some failures hard-stop the sync and some warn-and-continue. This is the same advisory-vs-blocking tension already settled for solve-gate-on-promotion (landed on **advisory during beta**). Apply the same posture here.

- Every rule carries an explicit `severity`: `error` or `warn`.
- **During beta, the effective policy is advisory** — both error and warn surface in the inspector export, neither kills the capture. A `policy` field on the file controls this (`advisory` | `blocking`), defaulting to `advisory`.
- When beta ends and we flip `policy: blocking`, `error`-severity failures abort the sync; `warn` still only reports. No rule rewrites needed for the transition — only the file-level policy flips.

### 4. Failures flow into the inspector export

A validation failure is a row in the data-inspector Excel output, carrying the same `sourcePath` provenance that's a hard acceptance criterion of the inspector sprint. This is what makes validation *actionable* for the Stafford session: "Task PV-001-WELD failed `process-needs-resource` (severity: error); the mapped `capacityResources` came from source path `productionTask[...].MachineCode` which was empty." Without `sourcePath`, a failure is a complaint with no lead; with it, it's a fix.

---

## File schema

```json
{
  "tenant": "stafford-engineering-test",
  "version": 1,
  "policy": "advisory",
  "rules": [
    {
      "id": "task-duration-present",
      "entity": "task",
      "assert": "durationSeconds > 0",
      "severity": "error",
      "message": "Task has no positive duration."
    },
    {
      "id": "process-needs-resource",
      "entity": "task",
      "when": "type == PROCESS",
      "assert": "capacityResources.length >= 1",
      "severity": "error",
      "message": "PROCESS task has no capacity resource to run on."
    },
    {
      "id": "completed-needs-actualend",
      "entity": "task",
      "when": "wipState == COMPLETED",
      "assert": "actualEnd != null",
      "severity": "warn",
      "message": "Completed task missing actualEnd; WIP timeline incomplete."
    },
    {
      "id": "window-ordering",
      "entity": "task",
      "assert": "windowEnd > windowStart",
      "severity": "error",
      "message": "Scheduling window end is not after start."
    }
  ]
}
```

Field reference:

| Field | Req | Notes |
|-------|-----|-------|
| `tenant` | Yes | Must match the tenant directory. |
| `version` | Yes | Schema version for forward compat. |
| `policy` | No | `advisory` (default) \| `blocking`. Controls whether `error` aborts the sync. |
| `rules[].id` | Yes | Stable identifier; appears in inspector rows. |
| `rules[].entity` | Yes | Which generic entity the rule applies to (`task`, `resource`, `order`). |
| `rules[].when` | No | Guard expression. Rule only evaluated when true. Same expression grammar as `assert`. |
| `rules[].assert` | Yes | Boolean expression over the entity's fields. Failure = the assert is false. |
| `rules[].severity` | Yes | `error` \| `warn`. |
| `rules[].message` | Yes | Human-readable, shown in inspector and logs. |

---

## Expression grammar — keep it small, deliberately

The temptation will be a full expression language: custom functions, cross-entity joins, arithmetic. **Resist it** the same way infrastructure has been deferred elsewhere — only add capability when a concrete tenant rule forces it.

**v1 grammar (ship this):**
- Field reference: `durationSeconds`, `capacityResources.length`
- Comparison: `==`, `!=`, `>`, `>=`, `<`, `<=`
- Null check: `field != null`, `field == null`
- Enum literal compare: `type == PROCESS`
- `.length` on array fields

**Explicitly out of scope for v1** (add only on demand):
- Cross-entity joins (e.g. "order's product must exist in products")
- Arithmetic in expressions
- Boolean composition (`&&` / `||`) — if a rule needs two conditions, write two rules, or use `when` + `assert`
- User-defined functions

**The line:** the moment a rule needs to be Turing-complete, it should be code, not config. Cross-entity referential integrity in particular is a different feature (referential validation over the assembled landscape) and shouldn't be smuggled into per-entity field validation.

---

## Where it sits in the pipeline

```
source data
   │
   ▼
[ mapping.json ]  → generic model (with sourcePath provenance retained)
   │
   ▼
[ validation.json ]  ← THIS FEATURE
   │   evaluate each rule against each entity
   │   collect failures with: rule id, entity key, severity, message, sourcePath
   │
   ├─ policy=advisory → all failures → inspector export; sync continues
   └─ policy=blocking → any error failure → abort sync; warn → report only
   │
   ▼
[ normalization ]
   │
   ▼
[ enrichment ]
   │
   ▼
assembled landscape → engine
```

Validation is the first gate after mapping and before normalization, because normalization/enrichment may assume validated inputs (e.g. enrichment that fans out `capacityResources` shouldn't run on a task that failed `process-needs-resource`).

---

## Seed ruleset for Stafford

Derived from the manual walkthrough. This is the starting `validation.json` for `stafford-engineering-test`, all `warn` or `error` per the table, `policy: advisory`:

| id | entity | when | assert | severity |
|----|--------|------|--------|----------|
| `task-duration-present` | task | — | `durationSeconds > 0` | error |
| `process-needs-resource` | task | `type == PROCESS` | `capacityResources.length >= 1` | error |
| `window-ordering` | task | — | `windowEnd > windowStart` | error |
| `completed-needs-actualend` | task | `wipState == COMPLETED` | `actualEnd != null` | warn |
| `inprocess-needs-actualstart` | task | `wipState == IN_PROCESS` | `actualStart != null` | warn |
| `resource-has-key` | resource | — | `key != null` | error |
| `order-has-duedate` | order | — | `dueDate != null` | warn |

These are first-draft and should be reviewed against the June snapshot once captured — the real data may reveal rules that fire constantly (signalling a mapping bug, not bad data) or rules that never fire (candidates for removal).

---

## Acceptance criteria

- [ ] `validation.json` schema documented and a well-formed file exists for `stafford-engineering-test`
- [ ] Validation runs after mapping, before normalization, on the generic model
- [ ] Each rule evaluation produces a result carrying `id`, entity key, `severity`, `message`, and `sourcePath` for the asserted field
- [ ] `policy: advisory` is honored — `error` failures do **not** abort the sync during beta; all failures are collected
- [ ] Validation failures appear as rows in the data-inspector Excel export with `sourcePath` populated
- [ ] Expression grammar is limited to the v1 set; no cross-entity joins, no boolean composition
- [ ] No single-field presence rules that duplicate what the mapping guarantees by construction (no redundant sources of truth)
- [ ] Flipping `policy: blocking` causes `error` failures to abort with a clear summary, without requiring any rule rewrites

---

## Explicitly NOT in this feature

- Cross-entity / referential integrity validation (separate future feature over the assembled landscape)
- A general expression/rules engine
- Auto-generation of rules from data profiling (the audit *informs* rules; it doesn't author them)
- Engine code changes — this is a data-layer config feature
- UI for editing `validation.json` (hand-edited like `mapping.json` for now)

---

## Open questions for review

1. **Rule authoring source.** The April audit bins fields by populated/distinct counts. Should rule authoring lean on that audit output (semi-manual), or stay fully hand-authored from domain knowledge? Leaning: hand-authored, audit-informed — same posture as the mapping.
2. **Per-entity vs landscape-level.** v1 is strictly per-entity. The first concrete cross-entity rule Stafford needs (e.g. "every task's resource must exist in resources") is the trigger to design landscape-level validation as a distinct phase — not to retrofit joins into this grammar.
3. **Normalization overlap.** Some "validation" (e.g. coercing a stray string qty to number) is arguably normalization, not validation. Boundary: validation only *asserts and reports*, never *mutates*. Anything that fixes a value belongs in normalization.

---

## Walkthrough findings — 2026-06-06 (research-mode manual pass)

The mapping rewrite shipping in `e21464b` finished the engine-side work for WorkOrderGroup. Before promoting the 2026-06-03 WORK7 capture to a fixture, walked the staging pipeline manually to surface what was missing. The exercise validated the post-mapping frame above and surfaced one set of findings that fit cleanly into the seed ruleset, and one set that confirms the case for the follow-up landscape-level validation sprint.

### Findings that ADD to this sprint (post-mapping rules)

Three additional seed rules implied by the manual pass:

| id | entity | when | assert | severity | walkthrough evidence |
|----|--------|------|--------|----------|----------------------|
| `resource-has-name` | resource | — | `name != null` | error | 34 person-resources carry employee first-names in `Description1`; the mapping reads it as `name`. A missing `name` would break the UI. |
| `task-actualstart-ordering` | task | `actualStart != null && scheduledStart != null` | `actualStart <= scheduledEnd` | warn | The 3.1.1 three-window model splits scheduled vs actual; an actualStart past scheduledEnd is a state-corruption signal that the mapping won't catch. |
| `group-has-customer` | order | — | `hierarchy.first != null` | warn | The `_customerLabel` cascade rule (Decision 4 fallback) means every group should have *some* Customer value, real or `[Auto]`. A null Customer would mean the cascade misfired. |

These extend the seed ruleset; no schema change needed.

### Findings that BELONG to the future landscape-level validation sprint

Four findings explicitly land outside this sprint's scope (per "Explicitly NOT in this feature" line 213). Captured here as design evidence for when the landscape-level sprint gets specced:

| Finding | Why it's landscape-level, not per-entity |
|---|---|
| **FK integrity has known gaps** — 157 WO orphans (18% of 871) whose Job isn't in active set. Pure-boolean FK check would block every Stafford promotion forever. | Per-entity rules can't express "this FK has a known structural mismatch with rationale X." Landscape-level validation needs **3-state outcomes**: PASS / EXPECTED-MISMATCH (config-declared with rationale) / UNEXPECTED-FAIL. |
| **Cross-filter logic (commit `8f00fd7`) runs at runtime in `sync.service.ts`** | Belongs at staging Phase 3 enrichment, not at every-sync runtime. Runtime should trust staged data. Move as part of the landscape-level sprint, not retrofitted into per-entity rules here. |
| **Expected record-count ranges** — "jobs.length should be 100..2000" | Per-entity rules don't observe collection size; that's an aggregate over the entity set. Same shape as FK integrity (3-state with config-declared range). |
| **Allowed enum values on source fields** — `Wostatus IN (PRINTED, PLANNED, CREATED)` — must be checked BEFORE mapping consumes the value | The existing spec asserts against the *generic model* by design — by the time validation runs, Wostatus has been mapped away. Pre-mapping enum validation is a different layer. |

### Findings that ADD nothing (already-covered)

Three findings the existing spec already handles:

| Finding | Where the existing spec covers it |
|---|---|
| Severity vs blocking semantics for filter mismatches | `policy: advisory` (default, beta) → `policy: blocking` (post-beta). Same posture, no new mechanism. |
| Validation failures need to be actionable | sourcePath flow into the inspector export — Decision 4 in core design |
| Required-fields derivable from mapping | Implied by the "no redundant sources of truth" principle (line 49); a `required: durationType` rule is *prohibited* when the mapping guarantees it. Required-fields aren't a separate config; they emerge from this principle. |

### Cross-references

- 2026-06-03 capture at `tools/mock-genius/recorded/stafford-work7-2026-06-03/` — the dataset that drove findings
- Cross-filter to relocate: `packages/api/src/modules/integration/cross-filter.ts` + `sync.service.ts` (commit `8f00fd7`)
- Mapping that produced the generic-model invariants under test: `config/tenants/stafford-engineering-test/integration/mapping.json` (commit `e21464b`)
- Capture metadata source-of-truth pattern: `tools/mock-genius/recorded/stafford-work7-2026-06-03/_capture-metadata.json`
- PII handling (sanitization) is **separate from validation** — fixture-publishing tax, not staging architecture. Discussed in staging-architecture-design.md, will get its own utility/sprint.
