# CC Prompt — Mapping Proposal v3: Corrections from Diff Review

The v2 proposal at `docs/Stafford/mapping.proposed.json` is mostly good but has three issues that surfaced during a diff review against the live `config/tenants/stafford-engineering-test/integration/mapping.json`. Produce v3 with these fixed, plus split the apply work into staged sprints we can land independently.

## Inputs

- `docs/Stafford/mapping.proposed.json` (v2 — mostly correct, work-order-driven, has issues below)
- `docs/Stafford/mapping-change-log.md` (v2 change log — carries forward, append v3 changes)
- `config/tenants/stafford-engineering-test/integration/mapping.json` (live, for reference)
- `docs/Stafford/mapping-gap-2026-04-26.md` (audit, authoritative on what's in the data)

## What's wrong with v2

### Issue 1: `resources.class` doesn't need engine derive work

v2 marks `class` as needing `_derive` engine support. But the actual logic is a simple lookup, which is already supported by the existing `lookup` rule type. Compare:

- Live mapping does this for resources.class (working today): `{ "from": "IsLabour", "lookup": {...} }`
- v2 proposal marks the same pattern as TODO/derive: `{ "_TODO": "engine doesn't support derive", "_derive": { "from": "RessourceType", "lookup": {...} } }`

It IS a lookup. Just a lookup on a different field. No engine work needed. v3 should write this as a regular `from + lookup` rule.

### Issue 2: `tasks.linkId.chainKey` is wrong for work-order-centric

v2 carried over `chainKey: JobCode` from v1 unchanged. But `JobCode` is the sales-order reference path. With the architectural shift to work-order-centric scheduling, tasks within a work order form a chain, scoped by `WorkOrderCode`, not `JobCode`. v2 missed this in the rewrite.

v3 should set:
```json
"linkId": {
  "chainKey": "WorkOrderCode",
  "orderKey": "Order",
  "lagHoursField": "LagHours"
}
```

Note: `orderKey` also changes from `SequenceNumber` to `Order`. The audit showed:
- `Order` — 23 distinct values (1, 2, 3...), looks like clean routing position
- `SequenceNumber` — top value is 32767 (signed int max), suggests sentinel/placeholder use

`Order` is the cleaner sequencing field.

### Issue 3: TODO markers used where rules are actually applicable today

v2 marks several rules with `_TODO` placeholders that imply engine work. Most of these don't actually need engine work — they're just lookups or use `_default` syntax that's already supported. v3 should:

- `orders.lateDueDate` → drop the TODO, just write `{ "_default": "@dueDate" }` (or whatever the live mapping uses for cross-field defaults)
- `resources.class` → simple lookup as covered in Issue 1
- `tasks.type` → simple lookup, no derive needed (`from: "Formula"` with lookup table)
- `tasks.wipState` → genuinely needs conditional derive, KEEP TODO
- `tasks.actualStart` → genuinely needs conditional derive, KEEP TODO

Only the last two genuinely need engine work.

## What v3 should produce

Three artifacts in `docs/Stafford/`:

### 1. `mapping.proposed.v3.json`

Complete proposed mapping. Same structure as v2 but with the three corrections applied. The full file should be:

```json
{
  "_comment": "Generated 2026-04-26. v3 — corrections from diff review against live mapping. Fixes: (1) resources.class is a lookup not a derive, (2) tasks.linkId.chainKey is WorkOrderCode not JobCode for work-order-centric scheduling, (3) lookup-pattern rules don't need TODO markers. Only tasks.wipState and tasks.actualStart genuinely need engine derive support. NOT yet applied to live config — see mapping-apply-plan-v3.md for staged rollout.",
  "version": "1.3-proposed",
  "tenantId": "stafford-engineering-test",
  "source": "genius-real",

  "_adapter_note": "Orders are sourced from workOrderWithAdvancedInformationViewEntity. Adapter wiring must be updated alongside applying the orders section.",

  "orders": {
    "mappings": {
      "key":         { "from": "WorkOrder" },
      "name":        { "from": ["WorkOrder", "ItemDescription1"], "sep": " — " },
      "productKey":  { "from": "ItemCode" },
      "demandQty":   { "from": "QuantityPlanned" },
      "dueDate":     { "from": "DeliveryDate", "toUTC": true },
      "lateDueDate": { "_default": "@dueDate" },
      "priority":    {
        "from": "Strategy",
        "lookup": { "JIT": 10, "ASAP": 5, "_default": 50 }
      },

      "customerCode": { "from": "CustomerCode" },
      "customerName": { "from": "CustomerName" },
      "itemFamily":   { "from": "ItemFamily" },
      "wostatus":     { "from": "Wostatus" }
    }
  },

  "resources": {
    "mappings": {
      "key":        { "from": "Code" },
      "name":       { "from": "Description1" },
      "type": {
        "from": "RessourceType",
        "lookup": { "R": "MACHINE", "W": "WORKCENTER", "S": "SUBCONTRACT", "_default": "MACHINE" }
      },
      "class": {
        "from": "RessourceType",
        "lookup": { "R": "MACHINE", "W": "LABOR_POOL", "S": "SUBCONTRACT", "_default": "MACHINE" }
      },
      "hourlyRate":  { "from": "MachineRateCost" },

      "efficiency":       { "from": "Efficiency" },
      "parallelCapacity": { "from": "NumOfAvgResource" },
      "isFinite":         { "from": "IsFinite" },
      "calendarCode":     { "from": "CalendarMspCode" }
    }
  },

  "tasks": {
    "key": { "from": ["JobCode", "OperationCode"], "sep": "-" },
    "mappings": {
      "name":            { "from": ["JobCode", "OperationCode"], "sep": " — " },

      "type": {
        "from": "Formula",
        "lookup": { "HR/UN": "STANDARD", "JR/DY": "DAILY", "_default": "STANDARD" }
      },

      "durationSeconds": { "from": "CycleTime", "factor": 3600 },
      "durationQty":     { "from": "WoPlannedQuantity" },
      "durationType":    { "value": 0 },

      "wipState": {
        "_TODO": "engine does not yet support multi-condition derive. Stafford confirmation needed: are PRINTED/CREATED/PLANNED in WoStatusCode the lifecycle states (which would let this be a simpler lookup), or do we need the IsCompleted-and-TaskStartDate logic below?",
        "_derive": {
          "rules": [
            { "if": { "field": "IsCompleted", "equals": true },                    "then": "COMPLETED" },
            { "if": { "field": "TaskStartDate", "exists": true, "nonNull": true }, "then": "IN_PROCESS" },
            { "else": "NOT_STARTED" }
          ]
        }
      },

      "actualStart": {
        "_TODO": "engine does not yet support conditional source selection. Use TaskStartDate when populated, regardless of IsCompleted state, else null.",
        "_derive": {
          "rules": [
            { "if": { "field": "TaskStartDate", "exists": true, "nonNull": true }, "then": { "from": "TaskStartDate", "toUTC": true } },
            { "else": null }
          ]
        }
      },

      "windowStart":     { "from": "TaskStartDate", "toUTC": true },
      "windowEnd":       { "from": "TaskEndDate",   "toUTC": true }
    },
    "capacityResources": { "from": "MachineCode" },
    "linkId": {
      "chainKey":     "WorkOrderCode",
      "orderKey":     "Order",
      "lagHoursField":"LagHours"
    }
  }
}
```

### 2. `mapping-change-log-v3.md`

Append to v2 change log, don't replace. New section "v3 corrections" explaining:

- The three issues fixed (resources.class, linkId scope, TODO marker overuse)
- For each, what v2 had and what v3 changed
- Why the corrections matter

Then update the "Engine capability gaps" section. v2 listed several derives needing engine work. v3 reduces this to ONE genuine gap: conditional derive (used by `tasks.wipState` and `tasks.actualStart`). Remove the others.

Also update the escalations list. v3 adds:
- "Confirm `WorkOrderCode` is the right scope for `linkId.chainKey` — does Stafford expect tasks in different work orders to ever be in the same chain? If yes, what's the chain identifier?"
- "Confirm `Order` (1, 2, 3...) is the routing-position field, vs `SequenceNumber` (which has 32767 sentinel values)."

### 3. `mapping-apply-plan-v3.md`

A staged rollout plan documenting how to apply v3 in three sprints, in dependency order. Include for each sprint: scope, prerequisites, expected impact on audit metrics, risk, rollback plan. Each sprint should be independently shippable.

**Sprint A — Resources mapping rewrite (apply now)**

- Scope: Replace `resources` section in live mapping with v3 resources section
- Prerequisites: None
- Impact: Resources go from 0% mapped (live) to ~100% mapped (v3)
- Risk: Low — pure data layer change
- Rollback: Revert mapping.json
- Effort: 30 min editing + audit re-run

**Sprint B — Orders rewrite + adapter rewire (coordinated change)**

- Scope: Replace `orders` section + update adapter to fetch orders from `workOrderWithAdvancedInformationViewEntity` instead of `salesOrderDetailEntity`
- Prerequisites: Sprint A complete; adapter source-entity rewiring
- Impact: Orders go from ~30% mapped (live, mostly broken) to ~100% mapped (v3); CTPOrder count shifts from sales-order-driven (474) to work-order-driven (956); 50% more work captured
- Risk: Medium — coupled change with adapter work; sales orders no longer synced
- Rollback: Revert both mapping.json and adapter config
- Effort: ~1 day

**Sprint C — Tasks improvements (after engine derive support)**

- Scope: Update `tasks.linkId` (chainKey + orderKey), `tasks.type`, then `tasks.wipState` and `tasks.actualStart` once engine supports `_derive`
- Prerequisites: Sprints A and B; engine work for conditional derive
- Impact: Tasks go from 10/13 mapped to 13/13; chain semantics correct for work-order-centric
- Risk: Medium — depends on engine work landing
- Rollback: Revert mapping.json
- Effort: 30 min editing + engine work + testing

Sub-sprint C1 (no engine dependency) can ship before C2:
- C1: linkId fix + type lookup → apply with B or right after
- C2: wipState + actualStart derives → apply when engine work lands

## Acceptance criteria

- [ ] `mapping.proposed.v3.json` is well-formed JSON
- [ ] No `_derive` placeholders for rules that should be simple `lookup` (resources.class, tasks.type)
- [ ] `tasks.linkId.chainKey` is `WorkOrderCode`
- [ ] `tasks.linkId.orderKey` is `Order`
- [ ] `orders.lateDueDate` does not have `_TODO` marker
- [ ] Only `tasks.wipState` and `tasks.actualStart` carry `_TODO`/`_derive` placeholders
- [ ] Change log v3 explains corrections clearly
- [ ] Engine capability gaps section in change log lists ONE gap (conditional derive), not multiple
- [ ] Apply plan v3 has three sprints with clear scope, prerequisites, and expected impact
- [ ] Apply plan identifies that Sprint A can ship immediately

## What I'll do with the output

1. Read `mapping.proposed.v3.json` to verify the corrections are correct
2. Read `mapping-apply-plan-v3.md` and confirm the staging makes sense
3. Apply Sprint A immediately (resources rewrite). Re-run audit, confirm resources fields are now mappable
4. Schedule Sprint B for when adapter rewiring can happen
5. Schedule the engine derive sprint separately (~1-2 days) to unblock Sprint C2
6. Add the new escalation items to Stafford meeting prep

The v3 corrections shrink the engine work from "multi-feature derives" to "one specific feature: conditional rules." That's a meaningful reduction.

## What v3 deliberately does NOT change

- `tasks.key` stays as `JobCode-OperationCode` composite. Live and v2 both have this. The audit showed task `Id` has 51 duplicates out of 3,118 records — until that's investigated, don't switch to `Id`.
- All other task rules that already work (windowStart, windowEnd, durationSeconds, etc.) remain untouched.
- Resources structure stays the same — just field names corrected.
