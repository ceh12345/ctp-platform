# Feature-B: Source-Shape Normalization (`normalization.json`)

**Status:** Designed from walkthrough evidence — spec ready, not yet prompted
**Depends on:** capture phase (raw source data + `_capture-metadata.json`)
**Sibling of:** `SPRINT-feature-b-validation.md` (asserts on the generic model post-mapping; normalization mutates the source pre-mapping)

---

## Problem

The staging architecture spec calls out Phase 2 normalization as "trim whitespace, normalize date timezones to UTC, standardize null/empty/missing representations, resolve `JobPlanningStrategyId` integers to strategy names." That list is concrete but understated. Walking it manually against the 2026-06-03 WORK7 capture surfaced that:

- 3,212 records carry leading-whitespace `ProjectManagerName` (" BEN FLEETWOOD")
- 1,456 records carry a `FullSearch` noise field that's pure Genius-internal concatenation
- 8,234 zero-date sentinels (`1900-01-01T00:00:00+13:00`) flow through unmolested
- 2,931 `"NA"` placeholder strings sit on top of Family / similar fields
- Integer ID fields (`JobPlanningStrategyId: 1606`) have no resolution path to human names
- `JobPlanningStrategyDescription` carries Genius localization markers like `[/rptJit/]`

None of this is captured anywhere — not in `mapping.json` (mapping just reads whatever it sees), not in `adapter.json`, not in any config. Like validation knowledge, the normalization knowledge is tacit.

Feature-b surfaces and persists it. The natural shape is a per-tenant `normalization.json` sibling to `mapping.json`, `adapter.json`, and `validation.json`.

```
config/tenants/{tenant}/integration/
  adapter.json
  mapping.json
  validation.json
  normalization.json   ← new
  reference/           ← optional, for ID→name lookups (see Open Questions)
```

---

## Where this sits — pre-mapping, source-shape

This is the layer the validation sprint deliberately doesn't touch. The split:

```
source data
   │
   ▼
[ normalization.json ]  ← THIS FEATURE — source-shape, tenant-specific
   │   strip noise fields, trim whitespace, sentinel-null,
   │   resolve integer ID refs via reference tables
   │
   ▼
[ mapping.json ]  → generic model
   │
   ▼
[ validation.json ]  ← sibling sprint — generic-model, tenant-agnostic
   │
   ▼
[ enrichment ] → engine
```

**Why pre-mapping, not post-mapping:**

1. Source quirks (FullSearch, 1900-01-01, NA, localization markers) are **Genius-specific** — they don't belong in a tenant-agnostic mapping vocabulary. Mapping should consume already-clean source data.
2. Mapping config stays focused on the "where does this field come from + how is it transformed" question; sentinel handling is a separate concern.
3. The downstream validation sprint asserts the **generic model is correct**; normalization makes that assertion possible by handing mapping a clean input.

The boundary the existing validation spec drew is reused: **validation asserts and reports, never mutates. Normalization mutates, never asserts.** This sprint owns the mutation; validation reports what's left.

---

## Why a separate file (not folded into mapping.json)

Same logic as the validation sprint:

- **Mapping** answers: *where does this field come from, and how is it transformed.*
- **Normalization** answers: *what's the canonical shape of the source data before mapping sees it.*

A field can be normalized AND mapped, normalized but not mapped (it gets dropped after cleansing), or mapped without specific normalization (mapping pulls the raw value). Folding both into one config tangles the axes and creates two ways to express the same fact.

Critically, **field-drop rules belong here, not in mapping.** Mapping has no reason to know `FullSearch` exists; the right model is "normalization strips Genius noise; mapping picks from what remains."

---

## Core design decisions

### 1. Normalization is pre-mapping, source-shape

Operates on raw source records, not the generic model. Rules reference source field names (`ProjectManagerName`, `JobPlanningStrategyId`), not generic names (`name`, `strategy`).

### 2. Normalization is structurally idempotent

Running the pipeline twice on the same source produces the same normalized output. Required for retry semantics (staging spec's deferred decision #2) and for diff-based debugging of "what did the normalizer do."

### 3. Per-field rules, conservative defaults

Default for an unconfigured field: **pass through unchanged**. Normalization is opt-in per field-rule. Avoids surprising over-cleanup (e.g., collapsing internal whitespace on a description that semantically had intentional spacing).

### 4. Normalization produces a change log

Output is `normalized/` + `_normalization-report.json` carrying record counts per rule applied. Feeds the inspector export and provides operator visibility into what was changed.

### 5. Reference data lives outside `normalization.json`

ID-to-name resolution (`JobPlanningStrategyId: 1606 → "JIT"`) needs reference tables. Those tables ship with the snapshot (`reference/` directory), captured from Genius separately. `normalization.json` declares *which* reference to use; the table itself is data, not config.

---

## File schema

```jsonc
{
  "tenant": "stafford-engineering-test",
  "version": 1,

  // Fields to strip entirely from each entity before mapping sees them.
  // Use for Genius-internal noise (FullSearch concatenations, etc.) and
  // any field that adds bulk without semantic value.
  "fieldDrops": {
    "jobs":  ["FullSearch", "JobHistory"],
    "wos":   [],
    "tasks": [],
    "sos":   ["FullSearch"],
    "res":   ["FullSearch", "LinkedFile"]
  },

  // Per-entity, per-field string rules. Each rule is a list of transforms
  // applied in order. Unconfigured fields pass through unchanged.
  "stringRules": {
    "jobs": {
      "ProjectManagerName": ["trim"],
      "Description1":       ["trim", "collapseInternalWhitespace"],
      "JobPlanningStrategyDescription": ["trim", "stripLocalizationMarkers"]
    },
    "wos": {
      "ProjectManagerName": ["trim"],
      "ItemDescription1":   ["trim", "collapseInternalWhitespace"]
    },
    "tasks": {
      "ProjectManagerName":    ["trim"],
      "OperationDescription2": ["trim", "collapseInternalWhitespace"],
      "OperationDescription3": ["trim", "collapseInternalWhitespace"]
    }
  },

  // Sentinel values to coerce to null. Applied AFTER string rules.
  // sentinelDates uses startsWith prefix match (so "1900-01-01T..." → null
  // regardless of time/tz suffix). sentinelStrings uses exact match.
  "sentinels": {
    "dates":   ["1900-01-01", "0001-01-01"],
    "strings": ["NA", "N/A", "(none)"]
  },

  // Empty-string-as-null policy per entity. true = coerce "" to null on
  // all string fields. Default = false (preserve empty strings).
  "emptyStringAsNull": {
    "jobs":  true,
    "wos":   true,
    "tasks": true,
    "sos":   true,
    "res":   false
  },

  // Reference table lookups. Each rule resolves an integer ID field to a
  // string by consulting a reference table shipped with the snapshot.
  // Adds a new field with the resolved name; original ID field is preserved.
  "referenceLookups": {
    "jobs": [
      {
        "from":       "JobPlanningStrategyId",
        "table":      "job-planning-strategies",
        "tableKey":   "Id",
        "tableValue": "Name",
        "writeTo":    "JobPlanningStrategy"
      },
      {
        "from":       "DbrDateModeId",
        "table":      "dbr-date-modes",
        "tableKey":   "Id",
        "tableValue": "Name",
        "writeTo":    "DbrDateMode"
      }
    ]
  }
}
```

### Available string transforms (v1)

Keep small, expand only when a tenant rule forces it.

| Transform | Behavior |
|---|---|
| `trim` | Leading/trailing whitespace removed. |
| `collapseInternalWhitespace` | Runs of 2+ spaces collapsed to single space. Newlines untouched unless `collapseNewlines` also applied. |
| `collapseNewlines` | `\r\n` and `\n` collapsed to single space. |
| `stripLocalizationMarkers` | Removes `[/.../ ]` markers from Genius's localized descriptions. |
| `uppercase` / `lowercase` | Case coercion. |

**Explicitly NOT in v1:**
- Regex-based custom transforms (escape hatch, but invites complexity creep)
- Cross-field transforms (e.g. "trim FieldA only if FieldB == X")
- User-defined transforms in code

If a tenant rule needs Turing-completeness, it should be code (custom normalizer plugin), not config.

---

## Seed config for Stafford

Derived from the 2026-06-06 walkthrough findings. First-draft; review against the next snapshot.

| Concern | Rule | Evidence |
|---|---|---|
| Noise fields | drop `FullSearch` from jobs/sos/res | 1,456 records carry concatenated noise; saves ~2 MB per snapshot |
| Noise fields | drop `JobHistory` from jobs | Free-text incident log, not consumed by mapping |
| Noise fields | drop `LinkedFile` from res | 11 records carry stray whitespace-only values |
| Trim | `ProjectManagerName` on jobs/wos/tasks | 3,212 records have leading space (" BEN FLEETWOOD") |
| Trim + collapse | `Description1`, `OperationDescription2`, `OperationDescription3`, `ItemDescription1` | Multi-line entries with embedded `\r\n`; double-spaces from data entry |
| Strip localization | `JobPlanningStrategyDescription` | Carries `[/rptJit/]` markers — should render "rptJit" or resolved to "JIT" via reference lookup |
| Sentinel dates | coerce `1900-01-01...` → null | 8,234 occurrences across capture |
| Sentinel strings | coerce `"NA"` → null | 2,931 occurrences (mostly Family fields) |
| Empty string as null | true for jobs/wos/tasks/sos, false for res | Resources legitimately use empty strings; other entities don't |
| Reference lookup | `JobPlanningStrategyId` → `JobPlanningStrategy` via `job-planning-strategies` table | Per-Job `1606` should resolve to "JIT" for display/Inspector |
| Reference lookup | `DbrDateModeId` → `DbrDateMode` | Per-Job `1609` is the DBR-date-mode classification |

---

## Reference-data sub-design

`reference/` directory inside the staging snapshot. Shipped alongside `raw/` and `cleansed/`. Captured from Genius via separate endpoint pulls (e.g. `GET /api/lookup/job-planning-strategies`). Each table is a flat JSON array of `{Id, Name, Code, Description, ...}` objects.

```
snapshots/stafford-engineering-test/2026-06-03-2014/
  raw/
  cleansed/
  reference/
    job-planning-strategies.json
    dbr-date-modes.json
    resource-types.json
    item-families.json
  _metadata.json
  _validation-report.json
  _normalization-report.json
```

Reference data refresh is **decoupled from the entity-data capture** — refs change rarely; entities change every sync. Adapter config gets a separate `referenceEndpoints` block; capture phase pulls them on a different cadence (e.g. daily vs hourly).

If a reference lookup fails (ID not in table), normalization writes `null` to the resolved field and logs the miss in `_normalization-report.json`. Not an error — downstream layers (mapping/validation) decide what missing-name means.

---

## Acceptance criteria

When feature-b implements this sprint:

- [ ] `normalization.json` schema documented + JSON-schema-validated
- [ ] Normalizer runs against `stafford-engineering-test` 2026-06-03 capture and produces clean output (no `FullSearch`, all `1900-01-01` → null, all `NA` → null, all `" BEN FLEETWOOD"` → `"BEN FLEETWOOD"`)
- [ ] `_normalization-report.json` records per-rule application counts matching the seed table above (8,234 sentinel-date hits, 2,931 sentinel-string hits, etc.)
- [ ] Idempotency test: re-running normalizer on already-normalized data produces zero changes
- [ ] Reference-lookup miss writes `null` + logs (does not error)
- [ ] No field-drop or transform is applied to fields not listed in config (default = pass-through)
- [ ] Field-drop is the FIRST step (drops happen before string rules run; sentinel/lookup rules can't reference dropped fields)

---

## Explicitly NOT in this feature

- **Post-mapping (generic-model) normalization.** If something needs canonical shape AFTER mapping, that's a different sprint. Mapping should produce canonical generic-model output; if it doesn't, fix the mapping, don't add a second normalization pass.
- **Sanitization for repo-fixture publishing.** Sanitization is repo-publishing tax, not staging architecture. See validation sprint's same explicit exclusion. Separate utility, separate sprint.
- **UTC date conversion.** The existing mapping engine already handles `toUTC` per-field (see `mapping-engine.ts` line 215+). Staging-time UTC conversion is redundant for tenants with a mapping engine. Pure-file tenants without mapping might need it; defer until one appears.
- **Schema migration / shape changes.** Normalization preserves the source record shape (modulo dropped fields). Restructuring records (e.g., flattening nested objects, splitting arrays) is an enrichment-phase concern.
- **Cross-record normalization.** All rules are per-record. "Make sure every WO with `Job=X` has the same `ProjectName`" is a referential-integrity concern, not normalization.

---

## Open questions for the implementer

1. **Reference-data capture cadence.** Daily vs hourly vs on-demand. Probably daily for v1 — references change rarely. Adapter config might need a `referenceRefreshPolicy`.
2. **Reference-data versioning.** When a reference table changes, do snapshots before the change get re-normalized with the new table? Probably no — snapshot uses whatever reference was captured at snapshot time. Bundle reference snapshot WITH entity snapshot to keep them consistent.
3. **Should normalization config carry "expected counts" for each rule?** (E.g., "expect ~8,000 sentinel-date hits per snapshot.") A wild drift would signal data shape changes. Could surface in `_normalization-report.json` but probably belongs in validation, not here.
4. **Custom normalizer plugins.** When a tenant has a rule that's genuinely beyond config (e.g., parsing a structured string field), do we ship a plugin SDK or just write tenant-specific code? Lean: write code, ship as part of tenant-specific normalizer module loaded by name. Don't build a plugin framework prematurely.
5. **Should `fieldDrops` support glob patterns?** (E.g., `"*FullSearch"` to drop the field on every entity that has it.) Probably no in v1 — explicit per-entity declarations are clearer.

---

## Walkthrough findings — 2026-06-06 (research-mode manual pass)

Source evidence for this sprint. Each finding maps to a config mechanism above.

| # | Manual finding (against 2026-06-03 WORK7 capture) | Maps to |
|---|---|---|
| 1 | `ProjectManagerName` has leading space on ~3,212 records (jobs/wos/tasks) | `stringRules: { *: { ProjectManagerName: ["trim"] } }` |
| 2 | `FullSearch` field on 1,456 records carries Genius-internal concatenated noise | `fieldDrops` per entity |
| 3 | Multi-line `Description1`/`OperationDescription` with embedded `\r\n` | `["trim", "collapseInternalWhitespace"]`; `collapseNewlines` decision per-field |
| 4 | Double-spaces within strings ("LOWER PLATE  - 3 DROP DIVERTER") | `collapseInternalWhitespace` transform |
| 5 | Dates split +12:00 NZST / +13:00 NZDT within same field | **Out-of-scope — handled by mapping `toUTC`**. Observation documented in capture metadata. |
| 6 | 8,234 `1900-01-01` zero-date sentinels | `sentinels.dates: ["1900-01-01"]` |
| 7 | 2,931 `"NA"` placeholder strings (mostly Family fields) | `sentinels.strings: ["NA", "N/A"]` |
| 8a | `JobPlanningStrategyId: 1606` has no human-readable resolution | `referenceLookups` + new `reference/` directory in snapshot |
| 8b | `JobPlanningStrategyDescription` carries `[/rptJit/]` localization markers | `stripLocalizationMarkers` transform |

The 8 findings map cleanly into 4 mechanisms (fieldDrops, stringRules, sentinels, referenceLookups). The reference-lookup work introduces a new artifact (`reference/` directory) that affects the capture phase too — flagged in Open Question #1.

---

## Related work

- Parent: [staging-architecture-design.md](staging-architecture-design.md) — overall feature-b spec; Phase 2 normalization is what this sprint implements
- Sibling: [SPRINT-feature-b-validation.md](SPRINT-feature-b-validation.md) — generic-model assertions, post-mapping
- Future: landscape-level validation sprint (hinted by validation sprint) will handle cross-entity FK integrity, expected count ranges, and the source-enum allowed-values concern that doesn't fit here OR in the per-entity validation sprint
- 2026-06-03 capture (walkthrough source): `tools/mock-genius/recorded/stafford-work7-2026-06-03/`
- Mapping that will consume the normalized output: `config/tenants/stafford-engineering-test/integration/mapping.json` (commit `e21464b`)
- UTC conversion that won't be duplicated by this sprint: `mapping-engine.ts` line 215+ (`toUTC` rule support)
