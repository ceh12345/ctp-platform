# CC Prompt — Proposed Mapping Update for stafford-engineering-test

The audit at `docs/Stafford/mapping-gap-2026-04-26.md` ran the analytical work — every field in every entity is binned (constant / categorical / high-variance / sparse / dead) with populated counts and distinct values. We don't need to re-derive any of that. We need to translate the audit's findings into a concrete mapping.json patch, plus a change log explaining each decision.

## What to produce

Two files, both in `docs/Stafford/` (do NOT modify the live mapping.json):

1. **`mapping.proposed.json`** — a complete proposed mapping configuration that, if dropped into `config/tenants/stafford-engineering-test/integration/mapping.json`, would produce a coherent landscape from the captured WORK7 data.

2. **`mapping-change-log.md`** — for each rule that's added, removed, or changed: what changed, why, what the audit showed, and any decisions deferred to Stafford.

## Inputs to read

- `docs/Stafford/mapping-gap-2026-04-26.md` — the audit, authoritative on what's in the data
- `config/tenants/stafford-engineering-test/integration/mapping.json` — current mapping
- `tools/mock-genius/recorded/stafford-work7-2026-04-23/` — raw fixtures, only if you need to verify a specific record's shape

You should NOT need to scan all 7,665 records again. The audit summarized them. Trust it.

## Decisions already made (from the audit-driven analysis)

These are not for CC to revisit. Apply them.

### Resources — full rebuild

Current mapping uses 5 fields that don't exist in real Genius. The audit shows what they should be:

- `key` — `Code` (was `MachineCode`). 100% populated, 77 distinct values, primary key.
- `name` — `Description1` (was `MachineName`). 100% populated, 68 distinct values.
- `type` — `RessourceType` (was `MachineType`). 3 values: `R=44, W=31, S=2`. Use a lookup; values mean: R=Resource (machine), W=Work center (pooled labor/equipment), S=Subcontract. *Marked as a Stafford confirmation question — apply tentative mapping but flag.*
- `class` — derive from `RessourceType`. Map `R → MACHINE`, `W → LABOR_POOL`, `S → SUBCONTRACT`. Was `IsLabour` which doesn't exist. *Stafford confirmation question.*
- `hourlyRate` — `MachineRateCost` (was `HourlyRate`). 100% populated, 9 distinct values.

Add the following NEW resource fields surfaced by the audit:

- `efficiency` — `Efficiency` field. 3 distinct values (90.0=46, 75.0=27, 100.0=4). Pass-through. Engine usage: TBD by Stafford — flag as question.
- `parallelCapacity` — `NumOfAvgResource` field. Value range 0-4. Engine has no native concept — for now, map as a passthrough field on the resource for future use.
- `isFinite` — `IsFinite` field. Boolean, 52 true / 25 false. Engine has no native handling — flag as a major design question.
- `calendarCode` — `CalendarMspCode` field. 76 of 77 records have value `Standard`. Effectively constant in WORK7. Map as passthrough; will become meaningful when other tenants or production data has variety.

### Orders — fix field names, retire one rule

Current mapping has 5 broken rules out of 7. Fix them based on audit findings:

- `key` — keep as `JobCode`. Audit shows 90.7% populated (430/474). For the 44 records where it's null, the order has no associated work order yet. Add `onError: "skip"` — these orders won't be schedulable but shouldn't fail the sync.
- `name` — change source from `ItemDescription` to `ItemDescription1`. 100% populated.
- `productKey` — keep as `ItemCode`. Confirmed correct.
- `demandQty` — change source from `OrderQty` to `QtyOrderedNet`. 100% populated, 20 distinct values. Note: `QtyOrderedBase` is identical to `QtyOrderedNet` in 473/474 records — pick `Net` as it represents post-adjustment quantity.
- `dueDate` — change source from `DeliveryDate` to `DateDelivery`. 100% populated, 65 distinct values, with NZ timezone offsets. Keep `toUTC` transform.
- `lateDueDate` — REMOVE this rule's source field entirely. `LatestAcceptableDate` does not exist in the data and no equivalent field was found. Default to `@dueDate` (i.e., late = due date until Stafford specifies a tolerance concept).
- `priority` — change source from sales order's `Strategy` (doesn't exist) to work order's `Strategy` post-join. Update lookup table to reflect actual values: `JIT=10, ASAP=5, _default=50`. Note: 950 of 956 work orders are `JIT`. The lookup table previously contained `RUSH/HIGH/NORMAL/LOW` which are fictional; replace entirely. *Flag as Stafford question — this priority signal is barely differentiating.*

### Tasks — small fixes, mostly OK

10 of 13 rules work as-is. Three need attention:

- `type` — currently sourced from `TaskType` which doesn't exist on tasks (it exists on resources). For now, derive from `Formula`: map `HR/UN → STANDARD`, `JR/DY → DAILY`. *Stafford confirmation question — what does Formula actually represent?*
- `wipState` — currently sourced from `WipState` which doesn't exist. Derive from a combination:
  - If `IsCompleted=true` → `COMPLETED`
  - Else if `TaskStartDate` is populated and within reasonable range → `IN_PROCESS`
  - Else → `NOT_STARTED`
  - This requires a `derive` rule type, not a passthrough. Define it in the proposed mapping and document the logic.
- `actualStart` — change source from `ActualStartDate` (doesn't exist) to `TaskStartDate` when `IsCompleted=false` and date is non-null. Keep `toUTC` transform. Logic: if task is in process, the start date is the actual start; if completed, the start date is the historical actual; if not started, leave null.

### Constants worth converting from `from` to `value`

Audit shows several fields with one distinct value across all records. If our current mapping pulls these via `from`, they should be `value` rules instead (or omitted entirely if not actually used). For the proposed mapping:

- Resources: don't add rules for the 18 constant fields unless engine needs them.
- Sales orders: same — `WarehouseCode`, `XmDevise`, `TaxesGroupHeaderCode` etc. are constants. Don't pull them.

### Dead fields — never map them

The audit lists per-entity dead fields. Don't add any rules referencing dead fields. If the current mapping references one, remove it.

## Stratification: what to flag for Stafford

Some decisions require domain input. List these in the change log under "Escalated to Stafford" with the specific question to ask:

1. **`RessourceType` enum meanings.** R/W/S — what does each represent operationally?
2. **`IsFinite=false` semantics.** What does the engine do with infinite-capacity resources? Skip them? Treat as always-available? Capture and ignore?
3. **`Efficiency` operational meaning.** Does 75% efficiency multiply task duration by 1.33×, or is it informational?
4. **Priority signal weakness.** WORK7 shows `Strategy=JIT` 99.4% of the time and `PriorityLevel=5` 100% of the time. How is priority actually differentiated in real production?
5. **`Formula` field meaning.** HR/UN vs JR/DY — what do these encode? Hours per unit vs Jobs per day? Affects duration calculation logic.
6. **`LatestAcceptableDate` / late tolerance.** Does Stafford track tolerance separately from due date anywhere?
7. **`PriorityLevel` is constant 5.** Is this a field they don't use, or is WORK7 simplified?
8. **`ItemStatus="P"` is constant in open data.** Is `P` the standard "Pending/Production" status, or are there other values we're not seeing because of the filter?

## File format requirements

### `mapping.proposed.json`

Same JSON schema as the existing mapping.json. Should be a complete file, not a patch. Include all entity sections (orders, resources, tasks). For new rules introduced by the audit findings (efficiency, isFinite, parallelCapacity, etc.), add them with appropriate types even if the engine doesn't currently use the fields — the data layer captures everything; engine work to use them is separate.

For derived fields like `wipState`, define the derivation logic clearly. If our existing mapping config doesn't support a `derive` rule type, propose it as a placeholder with TODO comments inline AND note the gap in the change log.

Pretty-print with 2-space indentation. Include a top-level comment block (as a `_comment` field if the schema accepts it, or as a sibling JSON file) that says "Generated 2026-04-XX from audit findings. See mapping-change-log.md for rationale."

### `mapping-change-log.md`

One section per entity (orders, resources, tasks). Within each section, one entry per rule that changed. Entry format:

```markdown
### orders.priority

**Before:** `{"from": "Strategy", "lookup": {"RUSH": 10, "HIGH": 30, "NORMAL": 50, "LOW": 70, "_default": 50}}`

**After:** `{"from": "Strategy", "lookup": {"JIT": 10, "ASAP": 5, "_default": 50}}`

**Source:** Audit confirmed Strategy field exists on workOrderWithAdvancedInformationViewEntity post-join, not on salesOrderDetailEntity directly. Real values: JIT=950, ASAP=6.

**Why this change:** Existing lookup table contained fictional values (RUSH/HIGH/NORMAL/LOW) that don't exist in real data. Replaced with actual values.

**Caveat:** Strategy is essentially mono-valued in WORK7 (99.4% JIT). This priority signal is barely differentiating. Real priority logic at Stafford likely uses different fields. **Escalated to Stafford** — see questions list.
```

Then a final section "Escalated to Stafford" listing the 8 questions above with brief context.

## Acceptance criteria

- [ ] `mapping.proposed.json` exists and is well-formed JSON
- [ ] Every rule in the proposed mapping references a field that the audit shows as populated (no broken references)
- [ ] Where a rule represents a derived/computed field (wipState, type, actualStart), the derivation logic is explicit
- [ ] `mapping-change-log.md` has an entry for every rule that changed
- [ ] All 8 escalation items appear in the change log's "Escalated to Stafford" section
- [ ] No changes made to the live `config/tenants/stafford-engineering-test/integration/mapping.json` — only proposed files in `docs/Stafford/`
- [ ] Proposed mapping is small enough to read in one sitting (probably ~150-300 lines of JSON)
- [ ] Change log is small enough to read in one sitting (probably ~10-15 entries)

## What I'll do with the output

1. Diff the proposed mapping against current
2. Read the change log to understand each change
3. For escalated items, add to my Stafford meeting questions
4. Apply the mapping changes to the live config (with the escalated decisions still pending Stafford)
5. Re-run the data audit to confirm the new mapping references real fields end-to-end
6. Run the adapter against the recorded fixtures and see what bugs surface

This is the foundation for the Stafford meeting and the next round of adapter testing. Get it right.

## What this prompt deliberately does NOT ask for

- No re-deriving of field statistics (audit already did this)
- No "closest match" suggestions (audit + decisions above provide direct mappings)
- No engine code changes (just data-layer config)
- No automated testing (manual review and audit re-run is enough at this stage)
- No new derive infrastructure if it doesn't exist (use TODO placeholders, flag the gap)
