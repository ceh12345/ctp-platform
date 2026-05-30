# SPRINT — Data Inspector Export (Mapping Validation, Excel-only)

**Purpose:** Generate a downloadable Excel workbook that renders the full
mapped hierarchy (Project → Sales Order → SO Line → Job → Head/Sub WOs →
Tasks → Materials) for a tenant, with every entity's fields and every
attribute's source-field provenance visible and filterable.

**Intended use:** Drive the Stafford mapping-validation working session
with Kaleb (business) and Allan (data). The Excel file is the session
artifact — they sort, filter, mark up rows in Excel, and the markup
becomes input to the next mapping pass. No UI; no live navigation.

**Status:** Engine work is done (`CTPWorkOrderGroup` + rollup engine
sprint). This is a read endpoint + Excel exporter sprint.

**Replaces:** `SPRINT-data-inspector.md` (the UI version). That sprint
deferred; the Excel export is the priority deliverable for the Stafford
session.

---

## SCOPE

### IN scope

- Extend mapping layer to plumb `sourcePath` on every attribute write.
  **This is the key requirement — Kaleb specifically called it out as the
  thing that makes the result useful.**
- One new read-only endpoint: `GET /v1/admin/inspector/export`
- Excel workbook generation, one sheet per entity level + index +
  attributes + unattached sheets
- Snapshot timestamp captured in the file
- Same in-memory snapshot the rest of the app uses (no separate DB query)

### OUT of scope

- UI page. Standalone Excel download only.
- JSON or zipped-CSV format. Excel only for v1.
- Live navigation, search, drill-down. Excel handles those natively.
- Status colors, charts, formatting beyond readable column widths.
- Source-field coverage (the inverse view: source fields *not* being
  read by the mapping). Deferred.
- Multi-tenant comparison. One tenant per export.
- Editing or write-back. Read-only.

---

## DESIGN DECISIONS

### Decision 1 — `sourcePath` plumbing (REQUIRED, not optional)

Every attribute the ETL mapping layer writes must have its source-field
path available to the Excel exporter. **Kaleb's quoted reason for the
session is to "assess the quality of the solving strategy"; without
provenance, the Attributes sheet is a list of names and values with no
way to tell where they came from — the session has nothing to act on.**

**Design: sidecar map, not inline metadata.**

The trace lives in a profile-level sidecar map computed once at
`MappingEngine.transform()` time. `NameValue` / `CTPAttribute` is **not
mutated** — it stays `{ name, value }` as today. This avoids rippling
a new field through every engine entity that uses `NameValue` (orders,
tasks, resources, groups, products, schedule contexts), and the
trace's per-(entity, attribute) granularity is profile-level (same
source for every record of a given entity), so per-instance storage
would be redundant.

**Shape:**
```typescript
export type AttributeSourceMap =
  Map<string /* entityType */, Map<string /* attributeName */, string /* sourcePath */>>;
```

Lives on `MappingResult` alongside `payload` + `workOrderGroups` +
`errors`. Stored on `StateService` per tenant alongside the landscape.
The Excel exporter does `sources.get(entityType)?.get(attrName) ?? null`
per attribute row.

**Engine-computed attributes** (e.g. the hierarchy-mirror entries the
rollup engine writes — `Customer`, `Project`, `SalesOrder` on Stafford)
get sidecar entries too, derived from the hierarchy slot's `source`
block. So the mirror values trace back to their hierarchy source, not
get flagged as engine-computed. Truly engine-internal attributes
(none today, hypothetical future) are simply absent from the sidecar
and the exporter flags them `isEngineComputed = TRUE`.

**`sourcePath` derivation from `ValueSource` (the existing union in
`hierarchy-mapping.interface.ts`):**

| `kind` | sourcePath value |
|---|---|
| `field` | `source.field` (e.g. `"Strategy"`) — with `.${transform}()` suffix if a transform is set |
| `constant` | `"const:" + source.value` (e.g. `"const:EA"`) |
| `composite` | `"template:" + source.template` (e.g. `"template:{ProjectNumber} - {ProjectName}"`) |
| `synthetic` | `"synthetic:hash-pool(" + source.hashOn + ")"` |
| `join` | `source.endpoint + "." + source.field + " via " + source.via` |

For scalar `mappings` (existing rule shape — `{from, lookup, factor, …}`),
the same approach when needed: a derivation helper walks the rule.
v1 may scope this to attribute sources only (per the doc — the per-
level sheets show core fields without provenance).

**Migration:** no migration. The sidecar is computed fresh on every
`transform()` call from the profile's existing config — no engine
type changes, no per-record state. Tenants without `attributes` in
their mapping (most non-Stafford tenants today) get an empty sidecar
and their `Attributes` sheet is empty; that's the correct semantic.

**Acceptance:** for the Stafford slim-100 dataset, **every attribute on
the `Jobs`, `WorkOrders`, `Tasks`, or `Materials` sheets resolves to a
non-empty `sourcePath` via the sidecar lookup unless it is deliberately
engine-computed and flagged `isEngineComputed = TRUE`.** Any empty
sourcePath on a real attribute indicates either (a) a mapping rule
not yet covered by the sidecar derivation, or (b) an engine-written
attribute that shouldn't be considered "authored" — both are session
worklist items.

### Decision 2 — Hierarchy levels and sheet layout

Entity types rendered as separate sheets:

1. **Projects** — distinct project keys/names from
   `WorkOrderGroup` attributes (if not their own entity)
2. **SalesOrders** — distinct SO keys from `WorkOrderGroup` attributes
   (if not their own entity)
3. **SOLines** — distinct SO-line keys from `WorkOrderGroup` attributes
   (if not their own entity)
4. **Jobs** — one row per `CTPWorkOrderGroup`
5. **WorkOrders** — one row per `CTPOrder`
6. **Tasks** — one row per `CTPTask`
7. **Materials** — one row per `(task, inputMaterial)` pair

For Stafford v1, levels 1–3 may not exist as their own entities yet —
they may live as attributes on `CTPWorkOrderGroup`. If so, the exporter
**synthesizes** rows for those sheets by grouping `WorkOrderGroup`
records on the relevant attribute and emitting one parent row per
distinct value. This is acceptable for the export: surfacing what
levels are real vs. synthesized IS the point.

The synthesized rows are flagged in a `synthesizedFromAttribute` column
so Kaleb can see at a glance which levels need to become real entities
in the model.

### Decision 3 — The `Attributes` sheet is the session's primary
artifact

A single flat sheet listing every attribute across every entity in the
tenant, with provenance. This is what Kaleb and Allan filter, sort, and
mark up during the session.

| Column | Notes |
|---|---|
| entityType | `Project`, `SalesOrder`, `Job`, `WorkOrder`, `Task`, etc. |
| entityKey | The entity's key |
| entityName | The entity's display name |
| attributeName | e.g. `customer`, `priority`, `projectKey` |
| attributeValue | Stringified value |
| sourcePath | The provenance string (Decision 1) |
| isUnmapped | TRUE if value is null/empty AND sourcePath is null |
| isEngineComputed | TRUE if sourcePath = null but value is populated |

Filtering this sheet by `entityType=Job AND sourcePath=null` gives the
mapping bugs at the Job level. By `isUnmapped=TRUE` gives the gaps.
Etc.

### Decision 4 — The `Unattached` sheet captures mapping failures

Single flat sheet listing entities whose hierarchy linkage failed:

| Column | Notes |
|---|---|
| entityType | `SalesOrder`, `Job`, `WorkOrder`, `Task` |
| entityKey | The entity's key |
| entityName | The entity's display name |
| reason | e.g. `"no projectKey attribute"`, `"groupKey is null"`, `"linkId.name does not match any order"` |
| sourceData | The relevant raw fields that should have established the link, JSON-stringified |

This is the second-priority sheet for the session — anything here is
a mapping failure to triage.

### Decision 5 — Attribute flattening on entity-level sheets

Each entity-level sheet (Jobs, WorkOrders, Tasks, etc.) has its core
fields as columns. Attributes are added as extra columns —
`attr.{attributeName}` — using the union of attribute names across all
rows on that sheet. Empty cells where an entity doesn't carry that
attribute.

**Rationale:** sorting/filtering a Jobs sheet by `attr.customer` or
`attr.priority` is exactly what Kaleb will do first. The `Attributes`
sheet is for global analysis; the per-level sheets are for in-context
review.

### Decision 6 — Snapshot semantics

The export is built from the **same in-memory snapshot** the rest of
the app uses. No separate query against the source database.

- Snapshot timestamp recorded in the `_Index` sheet.
- Generating the export does not trigger a snapshot reload.
- If the snapshot is stale, the caller's responsibility to reload via
  the existing sync mechanism, then call this endpoint.

---

## API CONTRACT

### Endpoint

```
GET /v1/admin/inspector/export?tenant={tenantKey}
```

**Auth:** same as existing admin endpoints. Behind feature flag
`ENABLE_DATA_INSPECTOR_EXPORT` (default true in dev, false in prod
until explicitly enabled per tenant).

**Response:**
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="inspector-{tenantKey}-{YYYYMMDD-HHmmss}.xlsx"`
- Body: the XLSX file bytes

**Errors:**
- 404 if tenant unknown
- 503 if snapshot unavailable, with `{ error: 'snapshot_unavailable', detail: '...' }`
- 500 on export failure, with `{ error: 'export_failed', detail: '...' }`

**Performance:** synchronous response. Stafford WORK7 full dataset
(~10k tasks max) should generate in under 30 seconds. If generation
exceeds 60s, log a warning — but don't async this in v1. Session use
is one-off; latency is acceptable.

---

## WORKBOOK SPECIFICATION

### Sheet: `_Index`

Top of workbook. Single column of (label, value) pairs:

```
Tenant key                  stafford-engineering
Tenant display name         Stafford Engineering
Snapshot timestamp          2026-05-29T14:22:03Z
Export generated at         2026-05-30T15:01:42Z
Display label: Job          (Stafford's term for WorkOrderGroup)

ENTITY COUNTS
Projects                    3       (synthesized from attribute)
SalesOrders                 12      (synthesized from attribute)
SOLines                     24      (synthesized from attribute)
Jobs                        89
WorkOrders                  156
Tasks                       612
Materials                   348

UNATTACHED COUNTS
Unattached SalesOrders      0
Unattached Jobs             12      ⚠ no SO linkage
Unattached WorkOrders       3       ⚠ no groupKey
Unattached Tasks            0

ATTRIBUTE COVERAGE
Total attributes            2,847
With sourcePath             2,791
With null sourcePath        56      ⚠ review needed
Unmapped (null value)       12
```

### Sheet: `Projects`

Columns: `key`, `name`, `synthesizedFromAttribute`, `childSOCount`,
`childJobCount`, `childWOCount`, `attr.*` (flattened attributes).

### Sheet: `SalesOrders`

Columns: `key`, `name`, `projectKey`, `customerName`,
`synthesizedFromAttribute`, `lineCount`, `totalDemandQty`, `attr.*`.

### Sheet: `SOLines`

Columns: `key`, `parentSOKey`, `lineNumber`, `jobReference`,
`productKey`, `demandQty`, `dueDate`, `synthesizedFromAttribute`,
`attr.*`.

### Sheet: `Jobs`

Columns:
- Identity: `key`, `name`, `parentSOLineKey`, `headWorkOrderKey`
- Source timing: `sourceStart`, `sourceEnd`, `promiseDate`
- Computed timing: `computedStart`, `computedEnd`
- Status rollups: `status`, `totalWorkOrders`, `completedWorkOrders`,
  `inProcessWorkOrders`, `notStartedWorkOrders`, `cancelledWorkOrders`
- Qty rollups: `totalDemandQty`, `totalScheduledQty`, `totalProducedQty`
- Members: `workOrderKeys` (comma-separated)
- Attributes: `attr.*`

### Sheet: `WorkOrders`

Columns: `key`, `name`, `groupKey`, `parentWorkOrderKey`, `isHead`,
`dueDate`, `lateDueDate`, `demandQty`, `productKey`, `taskCount`,
`wipState`, `attr.*`.

### Sheet: `Tasks`

Columns: `key`, `name`, `orderKey`, `process`, `type`, `subType`,
`durationSeconds`, `theoreticalCycleTime`, `windowStart`, `windowEnd`,
`scheduledStart`, `scheduledEnd`, `state`, `wipState`, `pinned`,
`capacityResourceKeys` (comma-separated), `attr.*`.

### Sheet: `Materials`

Columns: `taskKey`, `taskName`, `productKey`, `requiredQty`,
`scrapRate`, `grossQty`, `unitOfMeasure`, `attr.*`.

### Sheet: `Attributes`

Columns (one row per (entity, attribute) pair):

| Column | Type | Notes |
|---|---|---|
| entityType | string | Project / SalesOrder / SOLine / Job / WorkOrder / Task / Material |
| entityKey | string | |
| entityName | string | |
| attributeName | string | |
| attributeValue | string | Stringified; empty for null/missing |
| sourcePath | string | The provenance string; empty if null |
| isUnmapped | boolean | TRUE if value empty AND sourcePath null |
| isEngineComputed | boolean | TRUE if sourcePath null but value populated |

**This sheet is the session's primary artifact. Sort by sourcePath to
audit by mapping rule. Filter by isUnmapped to find gaps. Filter by
entityType for level-specific review.**

### Sheet: `Unattached`

Columns: `entityType`, `entityKey`, `entityName`, `reason`,
`sourceData` (JSON-stringified).

---

## IMPLEMENTATION NOTES

### Backend

- New controller method on the admin/inspector module:
  `exportTree(tenant)`.
- New service: `inspector-export.service.ts` that walks the landscape
  and builds the workbook in memory.
- **Library:** `exceljs` (already a candidate in the codebase; if not
  present, add it — it's the standard pick for streamed XLSX in
  Node).
- Walk order:
  1. Build the `Attributes` collection first (every attribute from
     every entity in one pass) — this is the canonical source.
  2. Group attributes by entityType to compute the union of attribute
     names per entity-level sheet.
  3. Emit `_Index` sheet last (counts known after the walk).
  4. Emit Projects / SalesOrders / SOLines by grouping
     `WorkOrderGroup` attributes if they aren't first-class entities
     yet.
  5. Emit Jobs (from `CTPWorkOrderGroups`), WorkOrders (from
     `CTPOrders`), Tasks (from `CTPTasks`), Materials (from
     `task.inputMaterials`).
  6. Emit Unattached buckets last.

### Provenance plumbing

Sidecar shape (per Decision 1) — built once per `transform()` call,
threaded through state, looked up by the exporter.

1. Define `AttributeSourceMap = Map<entityType, Map<attrName, sourcePath>>`
   alongside the existing mapping-engine types.
2. `MappingResult` gains `attributeSources: AttributeSourceMap`.
3. `MappingEngine.transform()` walks each entity's `attributes[]` and
   `hierarchies[]` from the profile, derives `sourcePath` from each
   `ValueSource.kind`, populates the sidecar. Hierarchy slot names go
   in too so mirror entries trace back to their source.
4. `SyncService.sync()` returns the sidecar in its `MappingResult`.
5. `StateService.applyTransformed()` accepts the sidecar and stores
   per-tenant alongside the landscape.
6. `StateService.getAttributeSources()` exposes it to the exporter.

No engine-side changes. No `NameValue` mutation. No per-record cost.

### Files expected to change

- `packages/api/src/modules/integration/mapping-engine.ts` — add
  `buildAttributeSources(profile)` and the `describeSource(rule)`
  helper. Extend `MappingResult` shape.
- `packages/api/src/modules/integration/sync.service.ts` — already
  passes `MappingResult` through; no change beyond the type.
- `packages/api/src/modules/state/state.service.ts` — store +
  expose the sidecar per tenant.
- `packages/api/src/modules/inspector/inspector-export.service.ts`
  (new) — reads the sidecar via `stateService.getAttributeSources()`.
- `packages/api/src/modules/inspector/inspector-export.controller.ts`
  (new) — registers the export route.
- `packages/api/src/modules/inspector/inspector.module.ts` (new).
- `packages/api/src/app.module.ts` — register inspector module.
- `packages/api/package.json` — add `exceljs`.

---

## ACCEPTANCE CRITERIA

1. `GET /v1/admin/inspector/export?tenant=stafford-engineering` returns
   a valid XLSX file as an attachment with a timestamped filename.
2. The workbook contains all required sheets: `_Index`, `Projects`,
   `SalesOrders`, `SOLines`, `Jobs`, `WorkOrders`, `Tasks`,
   `Materials`, `Attributes`, `Unattached`.
3. The `_Index` sheet shows accurate counts matching the per-sheet row
   counts.
4. The `Attributes` sheet contains one row per (entity, attribute) pair
   across all entities in the tenant.
5. For the Stafford slim-100 dataset, **every attribute on the Jobs,
   WorkOrders, Tasks, and Materials sheets has a non-null sourcePath
   unless it is deliberately engine-computed and flagged via
   `isEngineComputed=TRUE`.**
6. Synthesized parent rows (Project, SO, SO Line) are flagged in the
   `synthesizedFromAttribute` column.
7. The `Unattached` sheet captures every entity whose hierarchy link
   failed, with a clear `reason`.
8. Filtering the `Attributes` sheet by `sourcePath=""` in Excel surfaces
   the audit worklist for the session.
9. Filtering by `isUnmapped=TRUE` surfaces the mapping gaps.
10. Generation completes in under 60 seconds for the Stafford WORK7 full
    dataset.
11. No write operations exist on the endpoint. Read-only.
12. Tenant display label for `WorkOrderGroup` (e.g. "Job" for Stafford)
    is honored in the `_Index` sheet and in sheet ordering decisions
    where relevant.

---

## FOLLOW-UP SPRINTS (NOT IN THIS ONE)

- `SPRINT-mapping-session-output` — capture decisions from the Stafford
  working session and translate into mapping rule updates. Likely
  follows within days of the session.
- `SPRINT-data-inspector-ui` — the original UI inspector. Now deferred
  until mapping stabilizes. Becomes a tenant-onboarding tool, not a
  validation tool.
- `SPRINT-source-field-coverage` — inverse view: source fields *not*
  being read by the mapping. Useful for v2 audit but deferred.
- `SPRINT-jobs-page-rebuild` — the real customer-facing Jobs page with
  status, KPIs, filtering. Distinct from this export. Comes after
  mapping validation lands.

---

## NOTES FOR THE WORKING SESSION

Session structure once the export is in hand:

1. **Walk one real job end-to-end** (30 min) — pick a representative
   Stafford job. Filter `Jobs` sheet to that one row, then `WorkOrders`
   by its `groupKey`, then `Tasks` by their `orderKey`. Allan confirms
   each field came from the right source by reading the `sourcePath`
   column.
2. **Audit the `Attributes` sheet** (30 min) — sort by `sourcePath`,
   walk the list. Anything wrong, mark it in a comment column. Filter
   `isUnmapped=TRUE` and walk those too.
3. **Triage the `Unattached` sheet** (15 min) — each row is either a
   mapping bug, a Stafford data issue, or a design assumption to
   revisit. Categorize each.
4. **Decisions list** (15 min) — what changes for the next mapping
   pass, what's an action for Allan, what's an open design question.

Output captured in `STAFFORD-MAPPING-SESSION-{date}.md`. The marked-up
Excel itself becomes an attachment to that doc.
