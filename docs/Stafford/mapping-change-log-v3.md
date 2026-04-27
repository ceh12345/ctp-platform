# Mapping Change Log — v3 (corrections from diff review)

Builds on `mapping-change-log.md` (v2). The v2 work-orders-as-orders architecture is preserved; v3 is a tightening pass that:

1. Removes false TODO markers where the engine already supports the rule pattern
2. Corrects `tasks.linkId` scope to be work-order-centric (not job-centric)
3. Simplifies `tasks.actualStart` to use the engine's existing null-handling
4. Adjusts `orders.name` to a more identifying display string

**Net effect on engine capability gaps:** v2 listed 5 gaps; v3 lists 2.

---

## v3 corrections (changes from v2)

### 1. `resources.class` is a regular `lookup`, not `_derive`

**v2 had:**
```json
"class": {
  "_TODO": "engine doesn't support derive yet; intent: derive class from RessourceType...",
  "_derive": {
    "from": "RessourceType",
    "lookup": { "R": "MACHINE", "W": "LABOR_POOL", "S": "SUBCONTRACT", "_default": "MACHINE" }
  }
}
```

**v3 simplifies to:**
```json
"class": {
  "from": "RessourceType",
  "lookup": { "R": "MACHINE", "W": "LABOR_POOL", "S": "SUBCONTRACT", "_default": "MACHINE" }
}
```

**Why this works without engine changes:** the existing `from + lookup` rule pattern already maps an input value to a different output value via the lookup table — that's literally what `lookup` does. v2 was over-cautious. The same pattern is already used by `resources.type` (with a different lookup table), so we know the engine supports it. No `_derive` placeholder needed.

**Same correction applies to `tasks.type`** — was wrapped in `_derive`/`_TODO` in v2; v3 writes it as a regular `from + lookup` from the `Formula` field.

### 2. `tasks.linkId` corrected to work-order scope

**v2 carried over from v1 unchanged:**
```json
"linkId": {
  "chainKey":     "JobCode",
  "orderKey":     "SequenceNumber",
  "lagHoursField":"LagHours"
}
```

**v3 corrects to:**
```json
"linkId": {
  "chainKey":     "WorkOrderCode",
  "orderKey":     "Order",
  "lagHoursField":"LagHours"
}
```

**Why this matters:** with the v2 architectural shift to work-order-centric scheduling, tasks within a single work order form a chain. v2 missed this in `linkId` and was still using sales-order-style identifiers.

**Verification (against captured tasks data, n=3,118):**

| Field | Population | Distinct | Verdict |
|---|---|---|---|
| `WorkOrderCode` | 100% | 797 | Right scope — every task knows which WO it belongs to |
| `Order` | 100% | 23 (values 1-22) | Clean routing positions (645 records at Order=1, monotonic decay through 1 record at Order=20). Perfect for chain ordering. |
| `SequenceNumber` | 100% | 703 | **Polluted by sentinels** — top values are 32767 (282 records, INT16 max), 9999 (144), 9998 (49). Clearly used for "no sequence" / "skip ordering" markers. Unsuitable for chain ordering. |
| `JobCode` (v2 chainKey) | 100% | 271 | Coarser granularity — multiple WOs share a JobCode. Wrong scope for "tasks-within-a-chain" semantics. |

`Order` is unambiguously the right field. v2 silently inheriting `SequenceNumber` would have produced unstable chain ordering (sentinel-laden tasks would be sorted unpredictably).

### 3. `tasks.actualStart` simplified — no engine work needed

**v2 had:**
```json
"actualStart": {
  "_TODO": "engine does not yet support conditional source selection",
  "_derive": {
    "rules": [
      { "if": { "field": "IsCompleted", "equals": true },                    "then": { "from": "TaskStartDate", "toUTC": true } },
      { "if": { "field": "TaskStartDate", "exists": true, "nonNull": true }, "then": { "from": "TaskStartDate", "toUTC": true } },
      { "else": null }
    ]
  }
}
```

**v3 simplifies to:**
```json
"actualStart": { "from": "TaskStartDate", "toUTC": true }
```

**Why this works:** the engine's `applyMappings` (`mapping-engine.ts:33`) already does:

```ts
if (val !== undefined && val !== null) out[targetField] = val;
```

So a `from: "TaskStartDate"` rule that resolves to null/empty simply doesn't set the field at all — which is exactly what v2's elaborate `_derive` produces. The two `if` branches in v2 both produced `{ from: "TaskStartDate", toUTC: true }` (the same expression), differing only in their conditions — and the conditions don't change the output. The simpler form is semantically equivalent.

**Caveat:** if Stafford eventually wants `actualStart=null` only when `IsCompleted=false AND TaskStartDate=null` (i.e., suppress historical actuals on completed-but-no-startdate edge cases), the conditional logic comes back. Until then, the simpler rule is right.

### 4. `orders.name` — note new concat behavior (not in original "what's wrong" list)

**v2 had:** `"name": { "from": "ItemDescription1" }` (just the item description)

**v3 has:** `"name": { "from": ["WorkOrder", "ItemDescription1"], "sep": " — " }` (work order code prefixed)

**Why included in v3:** with work-orders-as-orders, the display name benefits from including the WorkOrder code (`27187 — 40MM X M16 S/S H/D SQU INSERT`) so the operator immediately sees which WO they're looking at. Item description alone would lose work-order identity in the UI — multiple WOs may share the same item description.

**Tradeoff flagged:** if Stafford prefers the item description alone (cleaner), revert to v2's form. UI cosmetic decision.

### 5. `orders.lateDueDate` — TODO marker REINSTATED (v3 prompt was wrong here)

**v3 prompt claimed:** drop the TODO from `lateDueDate`, just write `{ "_default": "@dueDate" }`.

**Reality:** the engine does NOT support `_default: "@dueDate"` cross-field reference syntax. Reading `mapping-engine.ts:38-79`, the engine knows `value`, `from` (string and array), `lookup`, `factor`, `toUTC`. There is no `_default` top-level handling — that key only works inside a `lookup` table. Treating `_default: "@dueDate"` as a real rule would silently produce no `lateDueDate` field on the output, falling to the engine's default 0 (epoch).

**v3 keeps the TODO** with explicit messaging. Until the engine supports cross-field references, this rule is declarative documentation of intent.

**Possible alternatives** that would work today without engine changes:
- (a) Source from `JobEndDate` if Stafford confirms that's the late-tolerance signal (would become a regular `from`)
- (b) Remove the rule entirely and let `lateDueDate` be undefined (engine falls to 0; downstream lateness math behaves predictably)
- (c) Compute in the hydrator (engine work, but a different sprint than mapping)

Recommend (a) once Stafford clarifies the late-tolerance concept (escalation #6).

---

## Engine capability gaps after v3

v2 listed 5 gaps; v3 reduces this to **2 genuine gaps**:

| # | Gap | Used in | Sprint |
|---|---|---|---|
| 1 | Cross-field reference (`@dueDate` syntax) | `orders.lateDueDate` | Could be deferred — alternatives (a) and (b) above sidestep it |
| 2 | Multi-condition derive (`if/elif/else`) | `tasks.wipState` only (after `actualStart` simplification) | One specific feature, one place |

Removed from v2's list (false alarms):
- ~~`onError: skip`~~ — not needed (WorkOrder 100% populated)
- ~~`_join` cross-entity lookup~~ — not needed (Strategy native to WO)
- ~~`_derive` single-source with lookup~~ — not needed (regular `from + lookup` works for `resources.class` and `tasks.type`)

If Stafford confirms `WoStatusCode` is the right wipState source (escalation #5b below), gap #2 also reduces to a regular `lookup` — and the engine work scope drops to just gap #1, which itself has alternative-source workarounds.

**Realistic engine work needed: zero to one feature.** Significantly smaller than v2 implied.

---

## New escalations to Stafford (added in v3)

11. **`linkId.chainKey` scope.** v3 uses `WorkOrderCode` (one chain per WO). Confirm: does Stafford expect tasks across different work orders to ever participate in the same chain? If yes, what's the cross-WO chain identifier?

12. **`Order` vs `SequenceNumber`.** v3 uses `Order` (clean 1-22 routing positions) for chain ordering. Confirm `Order` is the right field; confirm `SequenceNumber` is intentionally sentinel-laden (32767, 9999, 9998 patterns) and not just a different kind of sequence we should also handle.

13. **`WoStatusCode` as wipState source?** Engine work for multi-condition derive could be avoided if `WoStatusCode` cleanly maps to lifecycle states (NOT_STARTED / IN_PROCESS / COMPLETED). Audit shows 3 distinct values — confirm the meaning.

(Renumbered from v2's 10 escalations — see master list at bottom.)

---

## Master Stafford escalations list (consolidated v2 + v3)

1. **`RessourceType` enum meanings** — R / W / S operational meaning
2. **`IsFinite=false` semantics** — what does the engine do with infinite-capacity resources?
3. **`Efficiency` operational meaning** — multiplier on duration, or informational?
4. **Priority signal weakness** — `Strategy` is 99.4% JIT; how is priority differentiated in production?
5. **`Formula` field meaning** — HR/UN vs JR/DY duration calculation encoding
6. **Late tolerance** — relationship between `DeliveryDate`, `JobEndDate`, and any tolerance concept
7. **Resource name field** — confirm `Description1` is canonical
8. **`Wostatus` operational filter** — PRINTED/CREATED active; CANCELLED excluded; PLANNED ready or premature?
9. **Hourly rate selection** — confirm `MachineRateCost` over alternatives
10. **Sales-order role** — with WO as scheduling driver, is sales-order data needed in CTP?
11. **`linkId.chainKey` scope** *(v3 new)* — confirm `WorkOrderCode` is the right chain scope
12. **`Order` vs `SequenceNumber`** *(v3 new)* — confirm routing-position field choice
13. **`WoStatusCode` as wipState** *(v3 new)* — could this be a direct lookup, eliminating engine work?
