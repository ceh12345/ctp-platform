# Mapping Remediation Report — 2026-04-26

Classified 29 mapping rules against captured WORK7 fixtures (n=7,665 records across 4 entities).

## Summary

| Entity | OK | DIRECT_RENAME | PARTIAL_POPULATION | DERIVE | AMBIGUOUS | UNMAPPABLE |
|---|---|---|---|---|---|---|
| orders | 1 | 0 | 1 | 3 | 2 | 0 |
| resources | 9 | 0 | 0 | 0 | 0 | 0 |
| tasks | 10 | 0 | 0 | 2 | 1 | 0 |

## orders

**1 OK / 6 need attention.**

### orders.key

**Currently:** `{"from": "JobCode"}`
**Status:** ⚠️ PARTIAL — `JobCode` populated 430/474 (90.7%)
**Classification:** PARTIAL POPULATION 

**Concern:** key fields with null values produce broken landscape entities (no addressable identity).

**Recommended action:** Either change to a 100%-populated alternative, OR add null-tolerance handling.

### orders.name

**Currently:** `{"from": "ItemDescription"}`
**Status:** ❌ MISSING — `ItemDescription` not found in `orders` records
**Classification:** DERIVE 

_No direct rename found. These same-entity fields share name fragments and could be candidates for a computed transform. Formula is a human decision._

**Conceptually-related fields in this entity:**
- `BomOptionFactor` — int, 100.0% populated, 1 distinct
- `BomOptionIsManual` — bool, 100.0% populated, 1 distinct
- `BomOptionItemHasOption` — bool, 100.0% populated, 1 distinct
- `BomOptionItemKey` — int, 100.0% populated, 1 distinct
- `BomOptionLevel` — int, 100.0% populated, 1 distinct
- `ConfirmationDate` — null/str, 90.7% populated, 87 distinct
- `CreationDate` — str, 100.0% populated, 474 distinct
- `DateJobProductionEnd` — str, 100.0% populated, 79 distinct

**Recommended action:** Design a transform/computed field. Formula is a human decision (script does not propose).

### orders.demandQty

**Currently:** `{"from": "OrderQty"}`
**Status:** ❌ MISSING — `OrderQty` not found in `orders` records
**Classification:** DERIVE 

_No direct rename found. These same-entity fields share name fragments and could be candidates for a computed transform. Formula is a human decision._

**Conceptually-related fields in this entity:**
- `QtyOrderedBase` — float, 100.0% populated, 20 distinct
- `QtyOrderedNet` — float, 100.0% populated, 20 distinct
- `SalesOrderHeaderCode` — str, 100.0% populated, 79 distinct

**Recommended action:** Design a transform/computed field. Formula is a human decision (script does not propose).

### orders.dueDate

**Currently:** `{"from": "DeliveryDate", "toUTC": true}`
**Status:** ❌ MISSING — `DeliveryDate` not found in `orders` records
**Classification:** AMBIGUOUS (confidence: 0.5)

**Cross-entity candidates** (different entity — semantics may differ; verify before adopting):

◇ `DeliveryDate` in `workOrderWithAdvancedInformationViewEntity`
  - Type: str, Populated: 956/956 (100.0%), Distinct: 92

**Recommended action:** Human decision before applying. Possibly escalate to Stafford if intent unclear.

### orders.lateDueDate

**Currently:** `{"from": "LateDeliveryDate", "toUTC": true}`
**Status:** ❌ MISSING — `LateDeliveryDate` not found in `orders` records
**Classification:** DERIVE 

_No direct rename found. These same-entity fields share name fragments and could be candidates for a computed transform. Formula is a human decision._

**Conceptually-related fields in this entity:**
- `ConfirmationDate` — null/str, 90.7% populated, 87 distinct
- `CreationDate` — str, 100.0% populated, 474 distinct
- `DateCustomer` — str, 100.0% populated, 55 distinct
- `DateDelivery` — str, 100.0% populated, 65 distinct
- `DateJobProductionEnd` — str, 100.0% populated, 79 distinct
- `DateJobProductionStart` — str, 100.0% populated, 428 distinct
- `DbrDateModeId` — int, 100.0% populated, 1 distinct
- `DrumEndDate` — str, 100.0% populated, 160 distinct

**Recommended action:** Design a transform/computed field. Formula is a human decision (script does not propose).

### orders.priority

**Currently:** `{"from": "Strategy", "lookup": {"RUSH": 10, "HIGH": 20, "NORMAL": 50, "LOW": 75, "_default": 50}}`
**Status:** ❌ MISSING — `Strategy` not found in `orders` records
**Classification:** AMBIGUOUS (confidence: 0.5)

**Cross-entity candidates** (different entity — semantics may differ; verify before adopting):

◇ `Strategy` in `workOrderWithAdvancedInformationViewEntity`
  - Type: str, Populated: 956/956 (100.0%), Distinct: 2

**Recommended action:** Human decision before applying. Possibly escalate to Stafford if intent unclear.

## resources

_All 9 rules OK._

## tasks

**10 OK / 3 need attention.**

### tasks.type

**Currently:** `{"from": "TaskType"}`
**Status:** ❌ MISSING — `TaskType` not found in `tasks` records
**Classification:** AMBIGUOUS (confidence: 0.5)

**Cross-entity candidates** (different entity — semantics may differ; verify before adopting):

◇ `TaskType` in `machineAndRessourceEntity`
  - Type: str, Populated: 77/77 (100.0%), Distinct: 2

**Recommended action:** Human decision before applying. Possibly escalate to Stafford if intent unclear.

### tasks.wipState

**Currently:** `{"from": "WipState"}`
**Status:** ❌ MISSING — `WipState` not found in `tasks` records
**Classification:** DERIVE 

_No direct rename found. These same-entity fields share name fragments and could be candidates for a computed transform. Formula is a human decision._

**Conceptually-related fields in this entity:**
- `WoStatusCode` — str, 100.0% populated, 3 distinct
- `WoStatusId` — int, 100.0% populated, 3 distinct

**Recommended action:** Design a transform/computed field. Formula is a human decision (script does not propose).

### tasks.actualStart

**Currently:** `{"from": "ActualStartDate", "toUTC": true}`
**Status:** ❌ MISSING — `ActualStartDate` not found in `tasks` records
**Classification:** DERIVE 

_No direct rename found. These same-entity fields share name fragments and could be candidates for a computed transform. Formula is a human decision._

**Conceptually-related fields in this entity:**
- `CompletionDate` — str, 100.0% populated, 1 distinct
- `JobClosingDate` — str, 100.0% populated, 1 distinct
- `JobProductionEndDate` — str, 100.0% populated, 79 distinct
- `JobProductionStartDate` — str, 100.0% populated, 248 distinct
- `MaterialAvailabilityDate` — str, 100.0% populated, 125 distinct
- `TaskEndDate` — null/str, 99.7% populated, 1497 distinct
- `TaskStartDate` — null/str, 99.7% populated, 1873 distinct
- `WorkOrderClosingDate` — str, 100.0% populated, 1 distinct

**Recommended action:** Design a transform/computed field. Formula is a human decision (script does not propose).

## Prioritized action plan

**Decide null-handling strategy (PARTIAL_POPULATION)** (1)
- `orders.key` (`JobCode`) 

**Design transform logic (DERIVE)** (5)
- `orders.name` (`ItemDescription`) 
- `orders.demandQty` (`OrderQty`) 
- `orders.lateDueDate` (`LateDeliveryDate`) 
- `tasks.wipState` (`WipState`) 
- `tasks.actualStart` (`ActualStartDate`) 

**Pick option or escalate (AMBIGUOUS)** (3)
- `orders.dueDate` (`DeliveryDate`) 
- `orders.priority` (`Strategy`) 
- `tasks.type` (`TaskType`) 
