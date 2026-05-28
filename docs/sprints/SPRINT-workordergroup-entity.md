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

## Field sourcing — Stafford / WORK7

Mapping rules to populate each field from Genius data. All from `workOrderWithAdvancedInformationViewEntity` unless noted.

| Field | Source | Notes |
|---|---|---|
| `key` | `Job` | `"15897"` — primary group key |
| `name` | `ProjectName` + ` / ` + head WO `ItemDescription1`? | Best guess; confirm format with Kaleb |
| `headWorkOrderKey` | Member WO where `ParentWorkOrder = null` | Derived; one expected per group |
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
| `hierarchy.first` (Customer) | **Live mode:** `BillToCustomerName` from `salesOrderHeaderEntity`, joined via `SalesOrderHeaderCode`. **Synthetic mode:** deterministic assignment from a fixed pool, hashed off `SalesOrderHeaderCode`. | Mode controlled by tenant config `customerSource.mode`. Live mode deferred to follow-up sprint (requires VPN); this sprint ships synthetic. |
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

Customer value `"CEM INTERNATIONAL P/L (NZ A/C)"` shown for illustration. In practice, the Stafford test tenant runs in **synthetic-customer mode** for this sprint (offline-friendly, no VPN required): customer values come from a small fixed pool, deterministically assigned by hash of `SalesOrderHeaderCode`. Live mode — calling `salesOrderHeaderEntity` to retrieve real `BillToCustomerName` — is wired in a follow-up sprint that runs against the live Genius server. CEM happens to be a real Stafford customer (visible in the original tree screenshot), so it's included in the synthetic pool as a plausible-looking name.

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

### OI-2: Head WO identification

We've assumed the head is the WO with `ParentWorkOrder = null`. The CEM screenshot shows what looks like a single-rooted tree per Job. But:
- What if a Job has multiple WOs with `ParentWorkOrder = null`? (Flat structure, no head.)
- What if `ParentWorkOrder` is empty string rather than null?
- Is there an explicit "head WO" flag in Genius we haven't seen?

Decision: confirm with Allan against the data. Fall back rule if no single head: `headWorkOrderKey = null`, group is "flat."

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

### Decision 2 — Head WO identification

Confirm:
- Is `ParentWorkOrder = null` the only signal?
- Are there cases where a Job has no clear head?
- Behaviour if multiple head candidates exist?

### Decision 3 — Customer-facing promise date: Job or WO?

The structural one. Frame to Kaleb:

> *"When you tell a customer 'your order ships by X', is X based on the Job-level end date, or on the individual work order end dates?"*

If Job: we plan toward Option B for the solver. If WO: Option A is sufficient.

### Decision 4 — Customer endpoint (resolved for this sprint, deferred for live)

Allan has confirmed the live path: `salesOrderHeaderEntity.BillToCustomerName`, joined via `SalesOrderHeaderCode` (which we already pull on `salesOrderDetailEntity`).

**Decision for this sprint:** ship with synthetic-customer mode only. The Customer hierarchy slot is populated by deterministic assignment from a small fixed pool, hashed off `SalesOrderHeaderCode`. This decouples the sprint from VPN/live-Genius access and lets the full feature path (mapping → entity → rollup → KPI) be exercised offline against the May 8 fixture.

**Deferred to follow-up sprint** (`SPRINT-workordergroup-customer-live`, or folded into whichever sprint next exercises a live sync): wire the `salesOrderHeaderEntity` call into the live sync path. The mapping config slot exists from this sprint; only the live-mode implementation is deferred.

Open sub-questions for the Stafford session (relevant to the live wire-up, not blocking this sprint):
- Walk through a real `salesOrderHeaderEntity` payload to confirm field shape.
- Confirm `BillToCustomerName` is the right field for the hierarchy slot, vs. ship-to or parent customer.
- Decide whether the extra endpoint call runs in the main sync flow or on demand.

### Decision 5 — Cancelled / superseded WOs

The CEM screenshot shows at least one strikethrough WO (`26864 SEAL HOUSING`). Confirm:
- Which `Wostatus` values indicate cancellation vs. completion?
- Are cancelled WOs included in member counts, or excluded?
- Recommendation: exclude from `totalWorkOrders`, count separately in `cancelledWorkOrders`.

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
- Customer hierarchy slot populated via **synthetic-customer mode** — deterministic hash-based assignment from a small fixed pool (5 names, including "CEM International P/L (NZ A/C)" as a plausible-looking entry, hashed off `SalesOrderHeaderCode`). Lets the full feature path be exercised offline against the May 8 fixture without VPN access.
- Tenant config schema gains `customerSource: { mode: "synthetic" | "live", syntheticPool?: string[], endpoint?: ..., field?: ..., joinKey?: ... }` — both modes specified in schema; only synthetic implemented this sprint.
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
- **Live customer endpoint wire-up.** Calling `salesOrderHeaderEntity` for real `BillToCustomerName` is deferred to a follow-up sprint that runs against the live Genius server (requires VPN). This sprint ships synthetic-customer mode only. Config schema accommodates both modes; switching mode is a tenant config change, not a code change. See Decision 4.

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
8. SO lines with null `JobCode` are filtered at mapping ingest — confirm count of filtered records against May 8 fixture.
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
- `SPRINT-workordergroup-customer-live` — wire `salesOrderHeaderEntity` into live sync flow to replace synthetic-customer mode with real `BillToCustomerName`. Requires VPN/live Genius access. May fold into whichever sprint next exercises a live sync.
- `SPRINT-workordergroup-ui` — Jobs page rebuild around groups. Rollup table view, group-by hierarchy, attribute filter chips.
- `SPRINT-workordergroup-solver` — only if Decision 3 lands as "Job is the customer-facing commitment." Implements Option B: solver respects group `promiseDate` as a soft constraint. Scoring rule updates.
- `SPRINT-workordergroup-material` — material-availability KPIs at group level.
