# Mapping Change Log — 2026-04-26 (revised)

Translation of audit findings (`mapping-gap-2026-04-26.md`, `mapping-remediation-2026-04-26.md`) into concrete proposed edits to `config/tenants/stafford-engineering-test/integration/mapping.json`.

**Source data:** `tools/mock-genius/recorded/stafford-work7-2026-04-23/` — 7,665 records across 4 entities, captured 2026-04-23.

**Output:** `docs/Stafford/mapping.proposed.json` (sibling file, not yet applied).

---

## Architectural decision: orders sourced from work orders, not sales orders

**The biggest change in this revision.** Original proposal mapped `orders` from `salesOrderDetailEntity`. After verification, all 6 broken `orders` rules referenced fields that don't exist on sales orders — they exist on `workOrderWithAdvancedInformationViewEntity`.

**Why work orders are the natural CTP `orders` source:**

- Sales Order Detail = customer-facing line items (relationship, pricing, intake)
- Work Order = production execution units (scheduling, capacity, completion)

CTP's engine concerns (priority, due date, scheduled qty, fill rate) all map cleanly to work-order semantics. Sales orders are a layer above and have no direct scheduling role.

**Verification (against captured data):**

| CTP field | Source on WO | Population | Distinct |
|---|---|---|---|
| key | `WorkOrder` | 100% | 956 unique |
| name | `ItemDescription1` | 99% | 846 |
| productKey | `ItemCode` | 100% | 836 |
| demandQty | `QuantityPlanned` | 99% | 31 |
| dueDate | `DeliveryDate` | 100% | 92 |
| priority | `Strategy` | 100% | 2 (`JIT`/`ASAP`) |

**Wins from this shift:**

- `_join` placeholder for cross-entity priority lookup → eliminated. Direct `from: "Strategy"` works.
- `onError: skip` placeholder for null keys → eliminated. `WorkOrder` is 100% populated.
- 47% of orders no longer fall to `_default` priority — every WO has a Strategy.
- Customer enrichment data still available natively (`CustomerCode`, `CustomerName` on the WO entity).
- Record counts now match scheduling reality: 956 work orders are 956 distinct things to schedule, not 474 sales lines that fan out into 1+ work orders each.

**Adapter wiring change required:**

Current adapter has hardcoded slot mapping `salesOrders → orders`. Must change to `workOrders → orders`. Two paths:

- **(a)** Update `rest-adapter.ts` to read endpoint slot names from `adapter.json` rather than hardcoding `salesOrders`/`tasks`/`resources`. (The right long-term fix; aligns with Sprint 2 config-drivenness work.)
- **(b)** Quick: in `adapter.json`, change the `salesOrders` endpoint path from `/salesOrderDetailEntity` to `/workOrderWithAdvancedInformationViewEntity` and update the filter to `Wostatus!=CLOSED && Wostatus!=CANCELLED`. No adapter code changes; ugly naming inside `adapter.json` but functional.

Recommend (a). Until that ships, (b) is acceptable for offline replay testing.

**Filter recommendation:** capture used `Wostatus!=CLOSED`, retaining 86 `CANCELLED` and 2 `PLANNED` records. Tighten to `Wostatus IN ('PRINTED', 'CREATED')` — only active WOs that should be scheduled.

---

## Scope summary

- 1 OK rule unchanged (was `productKey: ItemCode`, still works on WO side)
- 1 already-applied edit (`resources.key: MachineCode → Code`)
- 12 rules edited
- 8 new rules added (4 resource attributes, 4 enrichment fields on orders)
- 5 `_TODO` placeholders for engine capability gaps (down from 8 in v1.1)

---

## orders (now sourced from workOrderWithAdvancedInformationViewEntity)

7 rules in current mapping. All re-sourced from work orders. Plus 4 new enrichment fields.

### orders.key

**Before:** `{ "from": "JobCode" }` (90.7% populated on sales orders)

**After:** `{ "from": "WorkOrder" }` (100% populated on work orders, 956 unique values)

**Why:** The work-order primary key is the natural identity for a scheduling unit. Sales-order JobCode was 90.7% populated — `WorkOrder` is fully populated and unique by definition.

**Eliminates:** `onError: skip` placeholder (engine gap closed without engine work).

---

### orders.name

**Before:** `{ "from": "ItemDescription" }` (doesn't exist)

**After:** `{ "from": "ItemDescription1" }` (99% populated, 846 distinct)

**Why:** Work orders carry the same numbered-description convention as sales orders. The 1% missing is from records about to be cancelled — acceptable for display.

---

### orders.productKey

**Before:** `{ "from": "ItemCode" }` (was correct on sales orders)

**After:** `{ "from": "ItemCode" }` (also exists on work orders, 100% populated, 836 distinct)

**Why:** Both entities have `ItemCode`. Same semantic.

---

### orders.demandQty

**Before:** `{ "from": "OrderQty" }` (doesn't exist)

**After:** `{ "from": "QuantityPlanned" }` (99% populated on work orders, 31 distinct values)

**Why:** Work orders track planned production quantity, which is exactly what CTP wants. The 1% missing is the same edge cases as `ItemDescription1`.

**Note:** Work orders also have `QuantityProduced` (so far) — not relevant to demand input.

---

### orders.dueDate

**Before:** `{ "from": "DeliveryDate", "toUTC": true }` (doesn't exist on sales orders)

**After:** `{ "from": "DeliveryDate", "toUTC": true }` (does exist on work orders, 100% populated, 92 distinct dates)

**Why:** Same field name, but on the entity where it actually exists. Customer-promise date.

---

### orders.lateDueDate

**Before:** `{ "from": "LateDeliveryDate", "toUTC": true }` (doesn't exist anywhere)

**After:** `{ "_default": "@dueDate" }` *(`_TODO`: engine doesn't support cross-field references)*

**Why:** No late-tolerance field exists on either sales orders or work orders. Defaulting to dueDate (zero tolerance) keeps math sound. **Open question:** Stafford may track tolerance on a different entity, OR `JobEndDate` (the production-side end target, distinct from customer-promise `DeliveryDate`) might be the right late-tolerance signal.

**Caveat:** **Escalated to Stafford** — what's the relationship between `DeliveryDate`, `JobEndDate`, and any late-tolerance concept?

---

### orders.priority

**Before:** `{ "from": "Strategy", "lookup": { "RUSH": 10, "HIGH": 20, "NORMAL": 50, "LOW": 75, "_default": 50 } }`

**After:** `{ "from": "Strategy", "lookup": { "JIT": 10, "ASAP": 5, "_default": 50 } }`

**Why:** `Strategy` exists natively on work orders. Direct `from`, no cross-entity join. Lookup table updated to reflect actual values found in WORK7 capture.

**Eliminates:** the `_join` cross-entity-lookup placeholder from v1.1 (engine gap closed without engine work).

**Caveat:** **Escalated to Stafford** — `Strategy` is mono-valued in WORK7 (99.4% `JIT`, 0.6% `ASAP`). This priority signal is barely differentiating. Real production probably uses different fields for priority.

---

### NEW: orders.customerCode, customerName, itemFamily, wostatus

Four new fields available natively on work orders, useful for UI / future scheduler awareness:

- `customerCode` (95% populated, 33 distinct) — customer FK
- `customerName` (95% populated, 33 distinct) — customer-facing name (e.g., `'FISHER & PAYKEL HEALTHCARE'`)
- `itemFamily` (100% populated, 4 distinct) — categorical grouping
- `wostatus` (100% populated, values `PRINTED`/`CANCELLED`/`CREATED`/`PLANNED`) — work-order state

**Why:** These provide UI enrichment (customer name on Gantt) and filter metadata (workorder status, item family) without the cost of a cross-entity join. Engine doesn't currently consume them; data layer captures everything.

---

## resources

5 rules. None unchanged. 5 edited (1 already applied: key). 4 new rules added. **No change from v1.1 — copied here for completeness.**

### resources.key

**Before:** `{ "from": "MachineCode" }`

**After:** `{ "from": "Code" }` ✓ already applied to live config

100% populated, 77 distinct, perfect primary key.

### resources.name

**Before:** `{ "from": "MachineName" }`

**After:** `{ "from": "Description1" }`

99-100% populated, 68 distinct values. Stafford uses numbered description fields rather than `Name`.

### resources.type

**Before:** `{ "from": "MachineType" }`

**After:**
```json
{
  "from": "RessourceType",
  "lookup": { "R": "MACHINE", "W": "WORKCENTER", "S": "SUBCONTRACT", "_default": "MACHINE" }
}
```

`RessourceType` is the resource-side field, 100% populated, 3 distinct (R=44, W=31, S=2). Tentative R/W/S meaning. **Escalated to Stafford.**

(Note: "Ressource" double-s spelling is preserved — French-influenced field naming throughout Genius.)

### resources.class

**Before:** `{ "from": "IsLabour", "lookup": { "true": "LABOUR", "false": "REUSABLE", "_default": "REUSABLE" } }`

**After:**
```json
{
  "_derive": {
    "from": "RessourceType",
    "lookup": { "R": "MACHINE", "W": "LABOR_POOL", "S": "SUBCONTRACT", "_default": "MACHINE" }
  }
}
```
*(`_TODO`: engine doesn't support derive yet)*

No `IsLabour` field exists. Recasting class from a missing boolean to a derivation off the existing type. Single source of truth with `resources.type`. **Escalated to Stafford.**

### resources.hourlyRate

**Before:** `{ "from": "HourlyRate" }`

**After:** `{ "from": "MachineRateCost" }`

100% populated, 9 distinct values. Multiple rate fields exist; `MachineRateCost` semantically aligned. **Escalated to Stafford** for confirmation.

### NEW: resources.efficiency, parallelCapacity, isFinite, calendarCode

Four new resource attributes from the audit:

- `efficiency` (100% populated, 3 values: 90.0/75.0/100.0)
- `parallelCapacity` (`NumOfAvgResource`, values 0-4)
- `isFinite` (boolean, 52 true / 25 false — flags infinite-capacity resources)
- `calendarCode` (`CalendarMspCode`, 76/77 are `Standard`)

Engine doesn't currently consume these. Data-layer captures everything. **`isFinite` and `efficiency` semantics escalated to Stafford** (major design questions for future engine work).

---

## tasks

13 rules. 10 unchanged. 3 edited. **No change from v1.1.**

### tasks.key, name, durationSeconds, durationQty, durationType, windowStart, windowEnd, capacityResources, linkId

**Unchanged.** All 10 rules audit-confirmed working as designed.

### tasks.type

**Before:** `{ "from": "TaskType" }` (doesn't exist on tasks)

**After:**
```json
{
  "_derive": {
    "from": "Formula",
    "lookup": { "HR/UN": "STANDARD", "JR/DY": "DAILY", "_default": "STANDARD" }
  }
}
```
*(`_TODO`: engine doesn't support derive yet; this could be a regular `from + lookup` since it's single-source)*

Tentative interpretation of `Formula` field values. **Escalated to Stafford.**

### tasks.wipState

**Before:** `{ "from": "WipState" }` (doesn't exist)

**After:**
```json
{
  "_derive": {
    "rules": [
      { "if": { "field": "IsCompleted", "equals": true },                    "then": "COMPLETED" },
      { "if": { "field": "TaskStartDate", "exists": true, "nonNull": true }, "then": "IN_PROCESS" },
      { "else": "NOT_STARTED" }
    ]
  }
}
```
*(`_TODO`: multi-condition derive not yet supported)*

Multi-condition derive. **Open question:** `WoStatusCode` (3 distinct values) might be a simpler direct rename — worth checking against engine semantics during implementation.

### tasks.actualStart

**Before:** `{ "from": "ActualStartDate", "toUTC": true }` (doesn't exist)

**After:**
```json
{
  "_derive": {
    "rules": [
      { "if": { "field": "IsCompleted", "equals": true },                    "then": { "from": "TaskStartDate", "toUTC": true } },
      { "if": { "field": "TaskStartDate", "exists": true, "nonNull": true }, "then": { "from": "TaskStartDate", "toUTC": true } },
      { "else": null }
    ]
  }
}
```
*(`_TODO`: conditional source selection not yet supported)*

Synthesizes actualStart from `TaskStartDate` based on completion state.

---

## Engine capability gaps (down from 8 in v1.1)

The work-order-as-orders shift eliminated 3 of the original 8 engine gaps:
- ~~`onError: skip`~~ — no longer needed (WorkOrder 100% populated)
- ~~`_join` cross-entity lookup~~ — no longer needed (Strategy direct from WO)
- ~~Cross-field reference for orders.priority~~ — no longer needed

Remaining gaps for future "MappingEngine v2" sprint:

1. **`@dueDate` cross-field reference** — `orders.lateDueDate`. Read another already-mapped field as default.
2. **`_derive` single-source with lookup** — `resources.class`, `tasks.type`. Could be expressed as regular `from + lookup`; using `_derive` for parity with multi-condition derives.
3. **`_derive` multi-condition** — `tasks.wipState`, `tasks.actualStart`. If/elif/else logic with field existence and equality checks.

Until these land, the live engine ignores `_TODO`/`_derive` rules and produces a degraded (but coherent) landscape.

---

## Adapter wiring change required (one new dependency for this proposal)

The proposed mapping assumes the adapter feeds work-order data into the `orders` payload slot. Current adapter hardcodes `salesOrders → orders` slot mapping at `rest-adapter.ts:16-20`. Two paths:

- **(a)** Make adapter slot mapping config-driven (right long-term fix; adapter Sprint 2 work)
- **(b)** Hack `adapter.json` to point the `salesOrders` slot at `/workOrderWithAdvancedInformationViewEntity` (zero adapter code; misleading config name; works)

Recommend (a). Until that ships, (b) is acceptable for offline replay testing.

---

## Escalated to Stafford (refined list)

Items needing domain input:

1. **`RessourceType` enum meanings.** R / W / S — what does each represent?
2. **`IsFinite=false` semantics.** What does the engine do with infinite-capacity resources?
3. **`Efficiency` operational meaning.** Multiplier on duration, or informational?
4. **Priority signal weakness.** Strategy is 99.4% JIT in WORK7 — how is priority actually differentiated in production?
5. **`Formula` field meaning.** HR/UN vs JR/DY — duration calculation encoding?
6. **Late tolerance.** Relationship between `DeliveryDate` and `JobEndDate`? Is there a late-tolerance concept?
7. **Resource name field.** Confirm `Description1` is canonical resource name.
8. **`Wostatus` operational filter.** PRINTED/CREATED are clearly active. CANCELLED definitely excluded. Is PLANNED ready-to-schedule or premature?
9. **Hourly rate selection.** Confirm `MachineRateCost` is the right resource cost field for CTP.
10. **Sales-order data needed?** With work orders as the scheduling driver, is there any role left for sales-order data in CTP, or is it purely a customer-relationship concern outside CTP's scope?

---

## What happens after review

1. Diff `mapping.proposed.json` against the live `mapping.json`
2. Decide on adapter wiring approach (a) vs (b) above
3. Apply non-`_TODO` changes immediately (most renames, lookups, new enrichment fields)
4. Capture `_TODO`-flagged rules separately — declarative until engine catches up
5. Re-run `python scripts/mapping-remediation.py` to confirm references resolve
6. Add 10 escalations above to Stafford meeting prep
7. Sprint planning: scope MappingEngine v2 (3 remaining capability gaps) and adapter slot config-drivenness
