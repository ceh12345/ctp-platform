# SPRINT: WorkOrderGroup Entity

**Status:** Draft for review
**Branch:** main (additive — does not conflict with `performance` or `staging-architecture` feature branches)
**Author:** Chris
**Purpose:** Add the WorkOrderGroup entity and rollup engine to the data model. No engine integration in this sprint — solver remains unaware. UI work and solver-awareness deferred to follow-up sprints.

---

## Why this exists

Our current model is flat: `CTPOrder` (work order) → `CTPTask` (operation), with `linkId` chains carrying precedence within an order. Above the work order, we carry nothing structural — just whatever fields the mapping layer denormalises onto the order.

Stafford's tree (Customer → Project → SO → SO Line → Job → Head WO → child WOs → Tasks) doesn't fit that. Specifically, the **Job level** — a bundle of work orders that share a single customer-facing deliverable — has no representation in our model today. Kaleb's quote frames the impact:

> *"We believe these metrics will allow us to assess the quality of the solving strategy that we have applied to the current environment so I think we need to spend a bit more time getting the mapping a bit more fleshed out and comprehensive in the first instance."*

He wants to slice KPIs by project, sales order, work order, task, and material. Project and SO are hierarchy levels (we can carry them via the existing `CTPHierarchies` slots). Work order and task are entities we already have. The gap is the level *between* — the thing he calls a Job. That's WorkOrderGroup.

---

## What it is

A grouping entity that bundles work orders sharing a single rolled-up identity, timing, and status. **Solver doesn't touch it.** It's populated at sync time from the source ERP and refreshed by a rollup engine after every solve.

- **One per Job at Stafford** (`Job = "15897"` → one `WorkOrderGroup`).
- **Member work orders** form a parent/child tree (Stafford's head WO with sub-WOs underneath). The tree is internal to the group — we model it via `parentOrderKey` on the work order, not as a structural property of the group itself.
- **Generic by design.** Other tenants may use the same entity for surgical case bundles, batch campaigns, service visits. Stafford configures the display label to "Job"; the platform name stays `WorkOrderGroup`.

---

## Class shape

Inherits from `CTPKeyEntity` (which already gives us `id`, `key`, `name`, `hierarchy`, `attributes`, `timeStamp`).

```typescript
export enum WorkOrderGroupStatus {
  ON_TRACK = 0,
  AT_RISK = 1,
  LATE = 2,
  BLOCKED = 3,
  COMPLETED = 4,
  CANCELLED = 5,
}

export interface IWorkOrderGroup extends IKeyEntity {
  // Membership
  workOrderKeys: string[];
  headWorkOrderKey: string | null;

  // Source-of-truth timing (from ERP at sync time)
  sourceStart: number | null;
  sourceEnd: number | null;
  promiseDate: number | null;        // customer-facing commitment, if distinct

  // Computed timing (recomputed by rollup engine after each solve)
  computedStart: number | null;
  computedEnd: number | null;

  // Rolled-up counts
  totalWorkOrders: number;
  completedWorkOrders: number;
  inProcessWorkOrders: number;
  notStartedWorkOrders: number;
  cancelledWorkOrders: number;

  // Rolled-up qty
  totalDemandQty: number;
  totalScheduledQty: number;
  totalProducedQty: number;

  // Status (derived)
  status: WorkOrderGroupStatus;

  // Convenience
  completionRatio(): number;
  isFullyComplete(): boolean;
  isLate(now: number): boolean;
}

export class CTPWorkOrderGroup extends CTPKeyEntity implements IWorkOrderGroup {
  public workOrderKeys: string[] = [];
  public headWorkOrderKey: string | null = null;

  public sourceStart: number | null = null;
  public sourceEnd: number | null = null;
  public promiseDate: number | null = null;

  public computedStart: number | null = null;
  public computedEnd: number | null = null;

  public totalWorkOrders: number = 0;
  public completedWorkOrders: number = 0;
  public inProcessWorkOrders: number = 0;
  public notStartedWorkOrders: number = 0;
  public cancelledWorkOrders: number = 0;

  public totalDemandQty: number = 0;
  public totalScheduledQty: number = 0;
  public totalProducedQty: number = 0;

  public status: WorkOrderGroupStatus = WorkOrderGroupStatus.ON_TRACK;

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
  }

  public completionRatio(): number {
    if (this.totalWorkOrders === 0) return 0;
    return this.completedWorkOrders / this.totalWorkOrders;
  }

  public isFullyComplete(): boolean {
    return this.totalWorkOrders > 0 &&
           this.completedWorkOrders === this.totalWorkOrders;
  }

  public isLate(now: number): boolean {
    if (this.computedEnd === null) return false;
    if (this.sourceEnd === null) return false;
    return this.computedEnd > this.sourceEnd;
  }
}

export class CTPWorkOrderGroups extends EntityHashMap<CTPWorkOrderGroup> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }

  public override fromArray(arr: CTPWorkOrderGroup[]): void {
    arr.forEach((g) => this.addEntity(g));
  }

  // Find all groups whose computed end exceeds source end
  public lateGroups(): CTPWorkOrderGroup[] {
    const result: CTPWorkOrderGroup[] = [];
    this.forEach((g) => {
      if (g.computedEnd !== null && g.sourceEnd !== null &&
          g.computedEnd > g.sourceEnd) {
        result.push(g);
      }
    });
    return result;
  }

  // Find all groups containing a given work order
  public groupForWorkOrder(workOrderKey: string): CTPWorkOrderGroup | null {
    let found: CTPWorkOrderGroup | null = null;
    this.forEach((g) => {
      if (g.workOrderKeys.includes(workOrderKey)) found = g;
    });
    return found;
  }
}
```

### CTPOrder additions

```typescript
// CTPOrder gains:
public groupKey: string | null = null;       // → WorkOrderGroup.key
public parentOrderKey: string | null = null; // → another CTPOrder.key, for the WO tree
```

Both denormalised at sync time. `groupKey` is what task-table queries join on for "group by Job" without a recursive walk.

### CTPTask additions

```typescript
// CTPTask gains (denormalised from its order's group):
public groupKey: string | null = null;
```

Carries the same `groupKey` as its parent order, so task-level queries can group by Job without a join through the order table.

---

## WO normalization within a WorkOrderGroup

WOs within a Job form a multi-level BOM-style tree. The structure lives on the WO record, not on `JobEntity` (which only carries counts: `TotalQuantityOfWorkOrder`, `QuantityOfOpenWorkorder`, `QuantityOfCloseWorkOrder`).

### Source fields on `workOrderWithAdvancedInformationViewEntity`

| Field | Use | Reliability (2026-06-03 capture, 871 WOs) |
|---|---|---|
| `WorkOrder` | Self ID (string) | 100% populated |
| `ParentWorkOrder` | FK to parent WO (string) | 100% populated |
| `Sequence` | Genius's operation sequence | **Useless** — only values observed are `null` and `1`. Do not store. |

### Head identification

**Rule: head WO is the one where `WorkOrder === ParentWorkOrder`** (self-reference). Genius marks this for us — no need to promote a head from candidate WOs. This supersedes the earlier "`ParentWorkOrder = null`" guess (OI-2).

### Per-WG sequence number

Topological sort by `ParentWorkOrder`, leaves first → root last. Kahn's algorithm; tie-break by `WorkOrder` string ascending for determinism. Tree depths observed: 0=345, 1=335, 2=173, 3=18 (max 4 levels). O(n) per Job, free at any realistic tenant size.

Stored on `CTPOrder` as a new `wgSequence: number` field (denormalised at sync time alongside `groupKey`).

### Per-edge CTPLinkId

For each parent/child WO edge in the tree, emit one `CTPLinkId`:

- **From:** child WO's terminal task
- **To:** parent WO's first material-consuming task
- **Direction:** finish-to-start (BOM consumption — parent assembly can't start until child sub-component is produced)
- **maxGap:** 0 for v1 (tight coupling). `Job.ShippingBufferDays` is a candidate but introduces slack; defer to a follow-up sprint.

Reuses the existing Solver 2.5 chain-propagation machinery (commit `b6f79c9`). No new engine code; just additional links seeded at sync time.

### Structural invariants (verified against 2026-06-03 WORK7 capture)

1. **Containment** — WO parents never cross Job boundaries. 0/871 violations.
2. **Closure** — head closed ⇒ all children closed; conversely, no live child has a closed parent. Verified by cross-referencing 20 "orphan" child refs and 18 "headless" jobs: all 20 orphan children are `CANCELLED`, all 18 headless jobs contain only `CANCELLED` WOs, and none of those 18 jobs are in `JobEntity(Active=true)`. No anomaly — these are inactive Jobs whose WOs leaked through the looser WO-side filter.

### Adapter filter — tighten both sides

Both edge-case categories collapse if the adapter filters consistently on both endpoints:

| Endpoint | Filter |
|---|---|
| `workOrderWithAdvancedInformationViewEntity` | `Wostatus!=CLOSED & Wostatus!=CANCELLED` |
| `JobEntity` | `Active=true & Job<SYST` (already in 2026-06-03 capture) |
| Cross-check | Drop any WO whose `Job` is not in the active `JobEntity` set |

Effect on 2026-06-03 dataset:
- Drops 89 `CANCELLED` WOs
- Eliminates all 20 orphan parent refs
- Eliminates all 18 headless jobs
- Resulting WO set: ~782 records (PRINTED 743 + CREATED 37 + PLANNED 2), every Job has exactly one self-referential head

No "virtually-head" hack, no phantom-parent synthesis, no orphan policy needed.

### Adapter / payload work this implies

- Add `JobEntity` to the Genius adapter endpoint list with filter `Active=true & Job<SYST`
- Add a `jobs` key to `IRawDataPayload`
- Add the cross-filter step (active Jobs gate WOs) to the mapping pipeline
- Sanitize the 2026-06-03 capture and promote to `tools/mock-genius/fixtures/stafford-snapshot-2026-06-03/`

---

## Field sourcing — Stafford / WORK7

Mapping rules to populate each field from Genius data. All from `workOrderWithAdvancedInformationViewEntity` unless noted.

| Field | Source | Notes |
|---|---|---|
| `key` | `Job` | `"15897"` — primary group key |
| `name` | `ProjectName` + ` / ` + head WO `ItemDescription1`? | Best guess; confirm format with Kaleb |
| `headWorkOrderKey` | Member WO that is its own parent (`ParentWorkOrder = WorkOrder`) — Stafford convention. Engine also accepts `ParentWorkOrder = null` for tenants using that convention. | Derived; group is "flat" if 0 or 2+ candidates |
| `workOrderKeys` | All WOs sharing same `Job` value | Derived |
| `sourceStart` | `JobStartDate` | Or `DateJobProductionStart` from SO — confirm which is authoritative |
| `sourceEnd` | `JobEndDate` | Or `DateJobProductionEnd` — confirm |
| `promiseDate` | `DateDelivery` from SO line? | **Open — see Decision 3** |
| `computedStart` | `min(WoStartDate)` across members after solve | Rollup engine |
| `computedEnd` | `max(WoEndDate)` across members after solve | Rollup engine |
| `totalWorkOrders` | `count(workOrderKeys)` | Rollup engine |
| `completedWorkOrders` | count where `Wostatus = "CLOSED"` | Confirm enum — see Decision 5 |
| `cancelledWorkOrders` | count where `Wostatus` indicates cancellation | Confirm enum |
| `totalDemandQty` | `sum(QuantityPlanned)` | Rollup engine |
| `totalProducedQty` | `sum(QuantityProduced)` | Rollup engine |
| `hierarchy.first` (Customer) | Synthetic mode for the test tenant — deterministic assignment from a 5-name pool, hashed off `SalesOrderNo`. Real `CustomerName` is denormalised on every WO record; swapping in `{ kind: "field", field: "CustomerName" }` is the live-mode path. | The originally-planned `salesOrderHeaderEntity` join is unnecessary; both modes are one-line edits to the slot's `source` block. |
| `hierarchy.second` (Project) | `ProjectNumber` / `ProjectName` | |
| `hierarchy.third` (Sales Order) | `SalesOrderNo` | |
| `attributes` | `Strategy`, `JobType`, `JobRiskCode`, `ProjectManagerCode`, `ProjectManagerName`, `DbrEndDate`, `JobIsReserved`, `JobWarehouseCode` | Pass-through |

### Worked example — Job 15897

From the WORK7 sample (member WO 23898):

```json
{
  "key": "15897",
  "name": "MI 252525 - 1 x C1000R / Ø110 WEAR SLEEVE",
  "headWorkOrderKey": "23872",
  "workOrderKeys": ["23872", "23898", "..."],
  "sourceStart": "2025-08-13T19:08:45+12:00",
  "sourceEnd": "2026-11-27T00:00:00+13:00",
  "promiseDate": "2026-12-01T00:00:00+13:00",
  "computedStart": null,
  "computedEnd": null,
  "totalWorkOrders": 0,
  "completedWorkOrders": 0,
  "hierarchy": {
    "first":  { "name": "Customer",     "value": "CEM INTERNATIONAL P/L (NZ A/C)" },
    "second": { "name": "Project",      "value": "MI 252525 - 1 x C1000R" },
    "third":  { "name": "Sales Order",  "value": "00011698" }
  },
  "attributes": [
    { "name": "Strategy",            "value": "JIT" },
    { "name": "JobType",             "value": "C" },
    { "name": "ProjectManagerCode",  "value": "050" },
    { "name": "ProjectManagerName",  "value": "KALEB JAMES" },
    { "name": "DbrEndDate",          "value": "2026-11-27T00:00:00+13:00" }
  ]
}
```

The single sample we have shows WO 23898 with `ParentWorkOrder = "23872"`, meaning 23898 is *not* the head — 23872 is. We don't have 23872's record in the sample to confirm `ParentWorkOrder = null` for it. Worth pulling against the live endpoint before the session.

Customer value `"CEM INTERNATIONAL P/L (NZ A/C)"` is one of five entries in the synthetic pool the test tenant uses. The real `CustomerName` is denormalised on the WO endpoint payload (confirmed against the May 8 fixture), so swapping to real names is a one-line edit (`{ kind: "field", field: "CustomerName" }`) — not a separate sprint. CEM is included in the pool as a plausible name; the other four are abstract.

---

## Hierarchy → attribute mirror

After hierarchy values are resolved (sync time, in `RollupEngine.rebuildGroups`), the engine **mirrors each populated hierarchy slot's `name` + `value` into the entity's attributes list**. This means a consumer iterating only `attributes` still sees the group's dimensions — uniformity at the read path. UI widgets that filter on attribute chips, KPI computations that walk attributes, exports that flatten attributes — none of them need to know that some entries originated from hierarchy.

### Three rules

1. **Engine writes the mirror, mapping config does not.** The mapping config's `hierarchies` block declares the slots; the `attributes` block authors explicit entries. The engine combines them at sync time. Authors never write hierarchy-mirroring attributes in mapping.

2. **Regenerated each pass.** `rebuildGroups` strips any prior mirror entries (by name-match against current hierarchy slot names) before re-writing. Config edits to slot names or values propagate without leaving duplicates. Stale entries from a previous slot-name (e.g. config rename) persist until restart — acceptable since renames are rare and an unsynced rename is already a configuration smell.

3. **Indistinguishable from authored attributes at the read path.** No special marker, no separate field. A consumer can't tell whether `attributes[3]` came from a mapping author or from the mirror — and shouldn't need to.

### Config validator

`MappingEngine.transform()` rejects any config where an `AttributeMapping.name` collides with a `HierarchySlotMapping.name` on the same entity. Fails at config-load (start of transform), not at rebuild time. Without this guard, an authored attribute would be silently stripped on each rebuild and surface as "my attribute keeps disappearing."

### Denormalisation interaction

Group hierarchy + attributes are **reference-shared** down to member orders and member tasks (single instance, three pointers). The mirror is written **once per group** on the shared list; orders and tasks see it via the share. Engine unit tests pin this invariant with identity-equality assertions (`order.attributes === group.attributes`) so any future refactor into per-entity copies fails loudly before subtle aliasing bugs reach distant code.

If a future tenant ever needs per-entity hierarchy divergence (an order or task carrying a value distinct from its group's), the per-entity-copy approach gets evaluated then. The decision today: avoid speculative complexity, lock the invariant with a test, revisit on real need.

### API payload exposure

Both `hierarchies` (typed slot array) and `attributes` (flat name/value list) appear on `WorkOrderGroupResultDto`. Hierarchy values appearing in **both** is expected behaviour, not a duplication bug. The mirror means clients can choose either shape: structured (filter on slot 1 = Customer) or flat (treat all attributes uniformly). A comment in the serialiser (`extractResults`) flags this so future readers don't "fix" the duplication.

---

## Rollup engine

A new component, `RollupEngine`, that lives in the same module as the existing engines (`engines.ts`) but is **not part of the solve loop**.

### When it runs

1. **After state sync.** Once orders/tasks/resources have been loaded from the source, rebuild all WorkOrderGroups from scratch. Member discovery (which WOs belong to which group) happens here.
2. **After every solve.** Recompute `computedStart`, `computedEnd`, the count fields, and `status`. Membership is unchanged — only computed values refresh.

### What it does (one pass per group)

```typescript
class RollupEngine {
  // Called after sync — rebuilds group membership and source data
  rebuildGroups(orders: CTPOrders, groups: CTPWorkOrderGroups): void;

  // Called after solve — recomputes rollup values; membership unchanged
  refreshRollups(
    groups: CTPWorkOrderGroups,
    orders: CTPOrders,
    tasks: CTPTasks,
    now: number,
  ): void;

  // Status derivation — applied per group
  private deriveStatus(group: CTPWorkOrderGroup, now: number): WorkOrderGroupStatus;
}
```

### Status derivation — first cut

Worst-case-wins across members:

| Condition | Status |
|---|---|
| All members `Wostatus = CLOSED` (or COMPLETED in our terms) | `COMPLETED` |
| All members cancelled | `CANCELLED` |
| Any member infeasible (no scheduled slot) | `BLOCKED` |
| `computedEnd > sourceEnd` | `LATE` |
| `computedEnd > sourceEnd - bufferDays` | `AT_RISK` |
| Otherwise | `ON_TRACK` |

`bufferDays` is tenant-configurable (default 3?). Stafford's `ShippingBufferDays` field on the SO line is 2 — could plausibly source from there. **Open — see Decision 1.**

### What it doesn't do

- Doesn't touch the solver.
- Doesn't modify member WOs or tasks.
- Doesn't propagate group state down to tasks (denormalised at sync, not at rollup).
- Doesn't have its own scoring rules.

---

## Solver-awareness — three options

This is the structural decision the session has to resolve. Recap of where each option lands:

### Option A — Group is pure rollup, solver is unaware

Solver respects `dueDate` / `lateDueDate` on `CTPOrder` (= WO) as today. Group rollup happens after solve, doesn't constrain anything.

- ✅ Cheapest. Ships with the entity itself.
- ✅ Doesn't touch engine code.
- ✅ Validates the rollup mechanic before adding complexity.
- ⚠️ If WO dates are noisy, group rollup inherits the noise.
- ⚠️ Group-level commitment (`JobEndDate`) isn't honoured by the solver — only the WO dates are.

### Option B — Group carries a deadline; solver respects it as a soft constraint

Group's `promiseDate` is treated as a deadline. Tasks under that group's WOs have effective window = `min(WO lateDueDate, group promiseDate)`. Scoring penalises lateness against the group deadline.

- ✅ Honours the customer-facing commitment at the right level.
- ⚠️ Window calculation needs group-context lookup at solve time.
- ⚠️ Scoring rule additions / changes.
- ⚠️ Performance: every task's window calc gains a join.

### Option C — Group is a first-class solver concept

Group has scoring weight, priority, possibly its own scoring rule (e.g. "minimise changeovers within a group", "schedule all of a group's tasks contiguously where possible").

- ✅ Most powerful.
- ❌ Significant engine work.
- ❌ Risk of overfitting to Stafford's model before validating it.
- ❌ Speculative — we don't have evidence we need this.

### Recommendation

**Ship A. Plan to move to B once we have evidence about how WO dates and Job dates actually relate at Stafford.** Skip C entirely until/unless a real use case demands it.

The Stafford session needs to surface *whether the customer-facing promise is JobEndDate or the WO dates*. If JobEndDate, B becomes the obvious next step (and we should plan for it in this design). If the WO dates are the real commitments, A is sufficient long-term.

Either way, A is the right v1.

---

## Module placement & file structure

New files:

- `Models/Entities/workordergroup.ts` — entity, list, hashmap (mirrors `order.ts`)
- `Engines/rollupengine.ts` — rollup engine

Modified files:

- `Models/Entities/order.ts` — add `groupKey`, `parentOrderKey` to `CTPOrder`
- `Models/Entities/task.ts` — add `groupKey` to `CTPTask`
- `engines.ts` — register `RollupEngine`
- `ctp_service.ts` — wire rollup invocation into sync + post-solve flows
- `Models/Entities/landscape.ts` — add `groups: CTPWorkOrderGroups` to `SchedulingLandscape` alongside `orders` / `tasks` / `resources`

Mapping config:

- Tenant mapping schema gains a `workOrderGroups` section with rules for sourcing group fields.
- For Stafford: rules derive group membership from the `Job` field on WOs, and pull source dates / project / SO from the WO record.

UI changes — **deferred to a separate doc.** Rough direction: Orders page rebuilds around groups (becomes "Jobs page" for Stafford), table view of one row per group with rollup columns. Not in scope here.

---

## Open issues

Tracking ambiguous problems separately, in the pattern of the existing open-issues docs.

### OI-1: Group naming convention

What goes in `WorkOrderGroup.name`? Options:
- `ProjectName` only (e.g. "MI 252525 - 1 x C1000R") — loses Job-level distinction when one project has multiple jobs
- Head WO's `ItemDescription1` only — Job-specific, less project context
- `ProjectName / head WO ItemDescription1` (combo)
- Tenant-configurable template

Lean: tenant-configurable template, with the Stafford default being "ProjectName / head WO description." Confirm with Kaleb.

### OI-2: Head WO identification (RESOLVED — 2026-06-03 capture)

Head WO is the one where `WorkOrder === ParentWorkOrder` (self-reference). Genius writes it this way; no promotion logic needed. Verified against 871 open WOs: every active Job has exactly one self-referential head, never zero or more than one. See "WO normalization within a WorkOrderGroup" section above for the full evidence.

The earlier guess (`ParentWorkOrder = null`) was wrong — `ParentWorkOrder` is 100% populated.

### OI-3: Member discovery — by `Job` field alone, or by walking the WO tree?

Two ways to determine group membership:
1. **By Job field:** all WOs with the same `Job` value belong together.
2. **By tree walk:** start at head WO, recursively collect all descendants via `ParentWorkOrder`.

These *should* produce the same set. If they don't, that's a Genius data-integrity question we need to surface. Worth running both on the WORK7 fixture and diff'ing.

### OI-4: `parentOrderKey` on `CTPOrder` — exposed in API?

The WO parent/child tree is currently internal to a group. Some clients may want to render it in the UI (Stafford definitely will). Question: does `parentOrderKey` go in the public API contract on `CTPOrder`, or stay internal?

Lean: expose it. It's no different from any other relationship field, and Stafford clearly wants the tree view.

### OI-5: Rollup engine performance

For Stafford's WORK7 (956 work orders across however many jobs), the rollup engine runs in O(n) over orders+tasks. Should be sub-100ms.

For larger tenants (10k+ WOs), need to verify. Probably fine — it's a single pass — but worth a smoke test before declaring victory.

### OI-6: Inventory-fulfilled SO lines

Allan flagged that `salesOrderDetailEntity.JobCode` is sometimes null because that SO line is fulfilled from inventory rather than production. These lines have no Job, no WO, and therefore no WorkOrderGroup. They represent real customer commitments but don't participate in scheduling.

**Decision for this sprint:** filter them out at the mapping layer. Mapping rule: only ingest SO lines where `JobCode` is non-null. They don't appear in groups, don't consume scheduling capacity, don't appear in the solver's view of demand.

**Deferred:** representing inventory commitments in the model so that customer- and project-level KPIs are complete (e.g. "this project is 80% complete, but the inventory-fulfilled half isn't counted in our view"). Likely a separate `Demand` or `Commitment` entity in a future sprint — not WorkOrderGroup's job to represent these.

**Action:** CC review sprint should report how many SO lines have null `JobCode` in the May 8 fixture, so we know the scale of what's being filtered. If the proportion is high, the deferred follow-up becomes more urgent.

---

## Decisions to bring to Stafford

Five items to put in front of Kaleb and Allan. Each has options; the goal is *get an answer*, not open a wandering discussion.

### Decision 1 — What defines "ON_TRACK" vs "AT_RISK" vs "LATE"?

Options:
- **Buffer days against `sourceEnd`** — `AT_RISK` if `computedEnd > sourceEnd - bufferDays`. Default buffer 3 days.
- **Buffer days against `promiseDate`** (customer-facing) — same logic but anchored on `DateDelivery`.
- **Percentage of total job duration** — `AT_RISK` if computed end is within last 5% of source window.

Recommendation to put forward: buffer days against `sourceEnd`, configurable per tenant, default 3.

### Decision 2 — Head WO identification (RESOLVED by data inspection)

Head = self-referential WO (`WorkOrder === ParentWorkOrder`). 2026-06-03 capture confirms: every active Job has exactly one head, none have zero, none have more than one. Containment is also clean (0 cross-Job parent refs in 871 WOs). Nothing to ask Stafford. See "WO normalization within a WorkOrderGroup" for the full structural analysis.

### Decision 3 — Customer-facing promise date: Job or WO?

The structural one. Frame to Kaleb:

> *"When you tell a customer 'your order ships by X', is X based on the Job-level end date, or on the individual work order end dates?"*

If Job: we plan toward Option B for the solver. If WO: Option A is sufficient.

### Decision 4 — Customer endpoint (RESOLVED by data inspection, updated 2026-06-05)

The May 8 WORK7 fixture confirms `CustomerName` is denormalised on every `workOrderWithAdvancedInformationViewEntity` record. Example from Job 19071:

```json
"CustomerCode": "GEA-AU",
"CustomerName": "GEA AUSTRALIA PTY LTD"
```

No join to `salesOrderHeaderEntity` is needed. The Customer hierarchy slot can be filled either way:
- **Synthetic mode** (the test-tenant choice) — `{ kind: "synthetic", strategy: "hash-pool", pool: [...], hashOn: "SalesOrderNo" }`
- **Live mode** — `{ kind: "field", field: "CustomerName" }`

Switching is a one-line edit to the slot's `source` block in the tenant mapping. The originally-planned `SPRINT-workordergroup-customer-live` follow-up is unnecessary and has been dropped.

#### Update 2026-06-05 — JobEntity supersedes the WO source

The 2026-06-03 capture surfaced `JobEntity` as a 5th endpoint, which carries Customer fields directly on the Job record (not just denormalised on each WO):

| Field | Fill rate (558 active jobs) | Distinct |
|---|---|---|
| `CustomerId` | 98.0% (547) | 28 |
| `CustomerName` | 98.0% (547) | 28 |
| `CustomerLink` | 98.0% (547) | 28 — **duplicate of `CustomerId`, do not carry both** |

Sourcing from JobEntity is cleaner than from WO (one value per Job vs N per Job's WOs) once the mapping rewrite ships. Top customers: SEALED AIR (249 jobs, 45%), SUPERIOR ICE CREAM (51), FISHER & PAYKEL HEALTHCARE (50), NUTON LLC (32), GEA AUSTRALIA (32).

#### Auto-marked fallback for the 11 null-customer cases

11 active jobs (2.0%) have null `CustomerId`. They sort cleanly by `JobType`:

| JobType (all 558) | Count | No customer | Pattern |
|---|---|---|---|
| `C` Customer | 496 | 0 | always has customer |
| `I` Internal/inventory | 50 | 7 | stock parts: "SPACER KIPP PIN", "LINKAGE PIVOT BOLT", "GUN DRILLED BLANK", etc. |
| `U` Untyped/utility | 7 | 4 | workshop, training ("BLOCK COURSE #2"), labour ("LABOUR FOR TFD MACHINING") |
| `Q` Quote | 5 | 0 | not yet converted |

`JobType` is already the classifier — no need to invent one. The mapping rule does two things on null-customer cases: (1) emit a clearly-synthetic hierarchy value with an `[Auto]` prefix, and (2) emit a sidecar `customerSource` attribute distinguishing real-vs-derived for filter/query.

**Customer hierarchy rule:**
```jsonc
"customer": {
  "kind": "field",
  "field": "CustomerName",        // 547 → real Genius customer name
  "fallback": {
    "kind": "derive",
    "from": "JobType",
    "lookup": {
      "I": "[Auto] Internal — Stock",
      "U": "[Auto] Internal — Workshop",
      "Q": "[Auto] Quote Pipeline",
      "_default": "[Auto] Unclassified"
    }
  }
}
```

**Sidecar provenance attribute:**
```jsonc
"attributes": [
  {
    "name": "customerSource",
    "source": {
      "kind": "derive",
      "from": "CustomerId",
      "lookup": {
        "_present": "genius-master",   // any non-null value → real Genius customer
        "_default": "auto-from-JobType"
      }
    }
  }
]
```

The `[Auto]` prefix is impossible to confuse with a real Stafford customer code (theirs are short uppercase: `SAC`, `FPH`, `GEA-AU`). UI eyeball-distinguishable everywhere without parsing the prefix at query time — KPIs / filters / Inspector exports split on the `customerSource` attribute.

Stafford can rename the bucket labels later (one-line config edit) but no Stafford ask is required to ship — the rule is honest about what it's doing.

### Decision 5 — Cancelled / superseded WOs (RESOLVED by data inspection)

2026-06-03 capture observes four `Wostatus` values in the open set: `PRINTED` (743), `CANCELLED` (89), `CREATED` (37), `PLANNED` (2). All 89 `CANCELLED` WOs belong to inactive Jobs (not in `JobEntity(Active=true)`) and account for every orphan-parent and headless-job edge case in the dataset.

**Decision:** filter `CANCELLED` at the adapter, same way `CLOSED` is filtered. No `cancelledWorkOrders` counter is needed — they don't enter the system. See "Adapter filter — tighten both sides" in the WO normalization section above.

### Decision 6 — Buffer days value (refines Decision 1)

Decision 1 settled the *mechanism* (buffer days against `sourceEnd`). Decision 6 settles the *value*.

- Currently configured: `bufferDays: 3` in `config/tenants/stafford-engineering-test/integration/workordergroups.json`.
- Stafford carries a `ShippingBufferDays` field on the SO line — observed `2` in the May 8 sample.

Frame to Kaleb:
> *"AT_RISK fires `bufferDays` before sourceEnd. We default to 3 days. Your ShippingBufferDays on the SO line is 2 in the sample — do you want AT_RISK pegged to that, or is 3 the right operational warning window?"*

One-line config change either way. Capture the answer; no design dependency.

### Decision 7 — Hierarchy slot names and count (RESOLVED by data inspection)

Four hierarchy slots, all sourced from JobEntity (post-mapping-rewrite). Verified against the full 2026-06-03 capture (558 active jobs):

| Slot | Name | Source field | Fill rate | Distinct | Notes |
|---|---|---|---|---|---|
| 1 | Customer | `CustomerName` (with `[Auto]` fallback from `JobType` — see Decision 4) | 98.0% real + 2.0% auto = 100% | 28 real + 4 buckets | top: SEALED AIR 45% |
| 2 | Project | `ProjectName` | 89.8% | 95 names / 100 numbers | top: "CL20 & RG20 SPARES" 36% |
| 3 | SalesOrder | `SalesOrder` | (already mapped from WO) | — | unchanged |
| 4 | Family | `FamilyCode` | 92.8% real + 7.2% `NA` | 5 buckets | S-ENG 70%, S-SUB 9%, M-OEM 7%, M-PNE 4%, M-FASN 3% |

**Stafford ask: none.** All four slots resolve from data with no domain decision required. Label choices match Stafford's Genius vocabulary directly (Customer / Project / Sales Order / Family) — no renames needed.

**Things to drop from the mapping that were tentative:**
- `FamilyGroupCode` — 100% `NA` across all jobs, useless, do not map
- `FamilyLink` — duplicate of `FamilyCode`, do not carry both
- `CustomerLink` — duplicate of `CustomerId`, do not carry both

**NA handling for Family:** the 40 jobs (7.2%) with `FamilyCode: "NA"` map to a `null` slot value, not the literal string `"NA"`. They render as "(no Family)" in the hierarchy UI — same treatment as the 11 null-Customer cases handled by Decision 4's `[Auto]` fallback.

**Slot 5 is intentionally unused.** Programme / Division / Business Unit aren't reflected in Stafford's data shape. Adding a 5th slot for a future tenant is a one-line config edit — no schema impact.

### Decision 8 — Inventory-fulfilled SO lines (OI-6 confirmation with Kaleb)

OI-6 already captures the technical fact: `salesOrderDetailEntity.JobCode` is sometimes null because that SO line is fulfilled from existing inventory rather than production. Allan flagged this on the data side. Decision 8 confirms the *acceptable behaviour* side with Kaleb.

Current sprint approach (per OI-6): filter these out at mapping ingest. They don't appear in groups, don't consume scheduling capacity, don't appear in the solver's view of demand.

Frame to Kaleb:
> *"Some SO lines are fulfilled from existing stock — they have no Job, no WO, so they don't show up in the scheduler's view. Is that OK as a near-term behaviour, or do you need visibility into those commitments so the customer- and project-level KPIs are complete?"*

Two outcomes:
- **"Filtering is fine"** → ships as-is.
- **"We need to see those commitments"** → opens the door to introduce the deferred `SPRINT-workordergroup-demand` (inventory commitments as a separate `Demand` or `Commitment` entity, surfaced alongside the scheduler view). This is also the opportunity to flag that sprint as a roadmap item so it isn't a surprise later.

Use this answer to triage the follow-up sprint's priority.

---

## Out of scope (for this doc)

- UI for the Jobs page — separate doc once entity lands.
- Tags as a distinct mechanism from attributes — `CTPTag` exists but isn't wired; not addressing here.
- Project-level rollup entity. Project is a hierarchy level, not an entity in our model. If a future tenant needs project-as-entity, we revisit.
- Material-availability KPIs at group level — parallel track, separate doc.
- Solver scoring rule changes — only relevant if/when we move to Option B.
- Multi-group membership (a WO belonging to more than one group) — assumed not allowed.

---

## Sprint scope

### In scope

- New entity: `CTPWorkOrderGroup`, `CTPWorkOrderGroups` (file: `Models/Entities/workordergroup.ts`)
- `groupKey` and `parentOrderKey` fields added to `CTPOrder`
- `groupKey` field added to `CTPTask`
- `groups: CTPWorkOrderGroups` added to `SchedulingLandscape` (alongside `orders`, `tasks`, `resources` — the natural home for engine-wide collections; `ScheduleContext` is per-task-per-slot and the wrong granularity)
- `RollupEngine` class (file: `Engines/rollupengine.ts`) with `rebuildGroups()` and `refreshRollups()` methods
- Status derivation logic per the table above (buffer-days default 3, tenant-configurable)
- Mapping config schema additions for `workOrderGroups` section
- Stafford tenant mapping rules: derive group membership from `Job` field, populate from WO record fields per the field-sourcing table
- Customer hierarchy slot populated via **synthetic mode for the test tenant** — deterministic hash from a 5-name pool, keyed off `SalesOrderNo`. The real `CustomerName` is available on the WO record; swapping in `{ kind: "field", field: "CustomerName" }` is a one-line tenant-config edit when desired.
- Filter inventory-fulfilled SO lines at the mapping layer (SO lines with null `JobCode`) — they don't have WOs to bundle into groups
- Wire `RollupEngine.rebuildGroups()` into `ctp_service.ts` sync flow (after orders/tasks loaded)
- Wire `RollupEngine.refreshRollups()` into `ctp_service.ts` post-solve flow
- Expose `WorkOrderGroup` records in the API response payload (read-only)
- Expose `groupKey` and `parentOrderKey` on `CTPOrder` in the API response

### Explicitly out of scope

- **Solver-awareness.** Solver continues to respect WO-level `dueDate` / `lateDueDate` only. Group's `promiseDate` is informational. Defer Option B work to a follow-up sprint after Stafford session resolves Decision 3.
- **UI changes.** Orders/Jobs page rebuild deferred to its own sprint.
- **Tag mechanism (`CTPTag`).** Existing `attributes` mechanism covers the use case. Tags class stays dormant.
- **Project-level rollup entity.** Project remains a hierarchy slot, not an entity.
- **Material-availability rollups.** Parallel track.
- **Multi-group membership.** A WO belongs to exactly one group; not enforced in v1, but the design assumes it.
- **Group membership mutation via UI/API.** Membership is reset on each sync; planner overrides deferred.
- **Inventory commitments as a model entity.** Inventory-fulfilled SO lines (null `JobCode`) are filtered at mapping layer for this sprint. Representing them in the model as a separate `Demand` or `Commitment` entity — so customer- and project-level KPIs are complete — deferred to a future sprint. See OI-6.

### Branch & merge plan

- Branch: `main` directly (additive, no engine surface area).
- Performance branch: WorkOrderGroup membership rebuild is O(n) over orders — should not affect performance work in progress. Merge order doesn't matter.
- Staging-architecture branch: API response payload gains optional `workOrderGroups` array. Backward compatible.

### Acceptance criteria

1. Stafford tenant sync produces a populated `CTPWorkOrderGroups` collection. Spot-check Job 15897 populates as expected per the worked example above.
2. Every `CTPOrder` with a `Job` value has a non-null `groupKey` pointing at the matching group.
3. Every `CTPTask` carries a `groupKey` matching its parent order's `groupKey`.
4. Post-solve, each group's `computedStart`/`computedEnd` reflects `min`/`max` over its members' scheduled WO dates.
5. Group `status` derives correctly from the worst-case-wins table.
6. `CTPWorkOrderGroups.lateGroups()` returns the expected set for a deliberately late synthetic case.
7. Performance: rollup engine completes in < 100ms for the full Stafford WORK7 dataset.
8. **(N/A this sprint, deferred)** SO lines with null `JobCode` filter at mapping ingest. The Stafford test tenant pulls only the WO endpoint (`workOrderWithAdvancedInformationViewEntity`) — `salesOrderDetailEntity` records aren't fetched, so no `JobCode IS NULL` records flow through and there's nothing to filter. Activates when SO line ingestion lands in the inventory-commitment sprint (see Follow-ups).
9. Synthetic-customer mode produces a deterministic, stable assignment of synthetic customers to jobs across repeated runs against the same fixture.
10. Group-by-customer rollup yields multiple non-empty buckets — verifies the customer-level rollup mechanic works without depending on the live endpoint.
11. No regression in existing solver behaviour (solver doesn't know groups exist).

### Sequencing inside the sprint

1. Entity classes (`workordergroup.ts`) — standalone, no dependencies.
2. `CTPOrder` and `CTPTask` field additions — adds nullable fields, doesn't break existing code.
3. `SchedulingLandscape` extension — add `groups` collection alongside `orders` and `tasks`.
4. `RollupEngine` — uses the new entity, implements rebuild + refresh logic.
5. Mapping config schema extension.
6. Stafford mapping rules.
7. `ctp_service.ts` wiring.
8. API payload exposure.
9. Stafford WORK7 smoke test against acceptance criteria.

### Follow-up sprints (not in this one)

- `SPRINT-workordergroup-review` — CC reviews May 8 WORK7 fixture against this design, validates field-sourcing assumptions, surfaces data-quality questions for Stafford. Runs *before* implementation begins, in parallel with Stafford session prep.
- `SPRINT-workordergroup-ui` — Jobs page rebuild around groups. Rollup table view, group-by hierarchy, attribute filter chips.
- `SPRINT-workordergroup-so-filter` — adds `salesOrderDetailEntity` ingestion (new endpoint, new IRawDataPayload slot, new entity mapping block) and the generic `dropWhen` filter mechanism that drops records when a configured field is null. Activates AC #8 of this sprint. Likely folds into the inventory-commitment entity work (OI-6 future), since that's where the real motivation for SO line ingestion lives.
- `SPRINT-workordergroup-solver` — only if Decision 3 lands as "Job is the customer-facing commitment." Implements Option B: solver respects group `promiseDate` as a soft constraint. Scoring rule updates.
- `SPRINT-workordergroup-material` — material-availability KPIs at group level.
