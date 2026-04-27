# Mapping Apply Plan — v3 staged rollout

How to apply `docs/Stafford/mapping.proposed.v3.json` to the live `config/tenants/stafford-engineering-test/integration/mapping.json` in three independently-shippable sprints.

**Why staged:** the three sections (resources / orders / tasks) have different prerequisites and risk profiles. Resources can ship today with zero dependencies. Orders requires adapter coordination. Tasks splits into a no-engine-work part (linkId + type lookup) and an engine-blocked part (wipState multi-condition derive).

---

## Sprint A — Resources rewrite (apply now, ~30 min)

**Scope:**
- Replace the entire `resources.mappings` section in live mapping with v3's resources block
- Includes 5 corrected rules + 4 new attribute fields (efficiency, parallelCapacity, isFinite, calendarCode)

**Prerequisites:**
- None. Every rule in v3's resources section uses engine features that already work (`from`, `from + lookup`).

**Expected impact on audit metrics:**

| Metric | Before Sprint A | After Sprint A |
|---|---|---|
| `resources` rules referencing real fields | 1 of 5 | 9 of 9 (5 fixed + 4 new) |
| `resources` "MISSING" classifications | 4 | 0 |
| Live landscape resource population | broken (no key, no name, no class) | full (77 resources, all properly identified) |

**Risk:** Low. Pure data-layer change in a config file. No code changes. Adapter doesn't change. Mock-genius and live tests unaffected.

**Rollback:** Revert the file edit. No coordinated rollback needed.

**Effort:** ~30 min — apply the edit, run `python scripts/mapping-remediation.py`, verify resources show 0 MISSING classifications.

**Acceptance:**
- [ ] `mapping-remediation` script reports `resources: 0 MISSING / 0 PARTIAL / 0 DERIVE / 0 AMBIGUOUS / 0 UNMAPPABLE`
- [ ] All 9 rules report OK in the cross-reference section
- [ ] No regression in `tasks` or `orders` reporting
- [ ] Engine + API still build clean (`rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine && npm run build --workspace=@ctp/api`)
- [ ] Existing test suite green (`npx vitest run`)

---

## Sprint B — Orders rewrite + adapter rewire (coordinated change, ~1 day)

**Scope:**
- Replace `orders.mappings` section with v3's orders block (sourced from work orders)
- Update adapter source-entity wiring so the `orders` payload slot is fed from `workOrderWithAdvancedInformationViewEntity` instead of `salesOrderDetailEntity`

**Prerequisites:**
- Sprint A complete (clean baseline; failures in this sprint can't be confused with resources problems)
- Adapter wiring decision made — two paths:
  - **(a) Config-driven slots** — change `rest-adapter.ts:16-20` to read endpoint slot names from `adapter.json` rather than hardcoding `salesOrders/tasks/resources`. Right long-term fix; aligns with broader Sprint 2 config-drivenness work. ~3-4h.
  - **(b) Quick hack** — in `adapter.json`, change the `salesOrders` endpoint path from `/salesOrderDetailEntity` to `/workOrderWithAdvancedInformationViewEntity` and update the filter to `Wostatus IN ('PRINTED', 'CREATED')`. Zero adapter code; ugly internal naming; works for offline replay. ~10 min.

**Expected impact:**

| Metric | Before Sprint B | After Sprint B |
|---|---|---|
| `orders` rules referencing real fields | 2 of 7 | 11 of 11 (7 fixed + 4 new enrichment) |
| `orders` "MISSING" classifications | 5 | 0 |
| `orders.lateDueDate` | TODO (declarative only) | TODO unchanged (engine gap; live falls to default 0) |
| CTPOrder count in landscape | 474 (sales-order-driven, mostly broken fields) | 956 (work-order-driven, fully populated) |
| Strategy distribution available | none (field absent) | JIT=950, ASAP=6 |
| Customer name / customer code on orders | absent | populated (95% of records) |

**Risk:** Medium. Coupled change with adapter work. Sales orders no longer enter the landscape — if anything downstream queried sales-order-specific fields (sales-order line ID, contract terms), those queries now produce nothing. Audit downstream code before shipping.

**Rollback:** Revert both `mapping.json` and `adapter.json`. Two-file rollback.

**Effort:**
- Path (a): ~1 day (adapter refactor + tests + apply mapping + audit)
- Path (b): ~2 hours (adapter.json edit + apply mapping + audit + verify behavior)

**Acceptance:**
- [ ] Sync against captured fixture replay produces 956 orders (not 474)
- [ ] All 7 v3 orders rules + 4 new enrichment rules report OK
- [ ] `orders.lateDueDate` continues to TODO-flag with the existing message (or is replaced with a sensible alternative — see escalation #6)
- [ ] `orders.priority` lookup table reflects actual values (`JIT: 10, ASAP: 5`)
- [ ] No regression in `resources` or `tasks` reporting
- [ ] Existing tests still green; no `state-hydrator.spec.ts` failures from the order-source change

**Open question:** does any existing Sprint 1a/1b validation care that orders now have a different population? Should be safe — the validation framework is field-agnostic — but verify.

---

## Sprint C — Tasks improvements (split into C1 + C2)

### Sprint C1 — linkId fix + tasks.type lookup (no engine dependency, ~30 min)

**Scope:**
- Update `tasks.linkId.chainKey` from `JobCode` to `WorkOrderCode`
- Update `tasks.linkId.orderKey` from `SequenceNumber` to `Order`
- Update `tasks.type` from broken `from: "TaskType"` to `from + lookup` on `Formula`
- Update `tasks.actualStart` to simplified `from + toUTC` form

**Prerequisites:**
- Sprint A and Sprint B applied (so we're working in a clean tasks-only context)

**Expected impact:**

| Metric | Before C1 | After C1 |
|---|---|---|
| `tasks` rules referencing real fields | 10 of 13 | 12 of 13 |
| Chain ordering correctness | broken (sentinel-laden SequenceNumber) | correct (clean 1-22 Order positions) |
| Chain scope | wrong (job-level — multiple WOs share a job) | correct (work-order-level) |
| `tasks.type` produces a value | no (TaskType field doesn't exist) | yes (lookup on Formula) |
| `tasks.actualStart` produces a value | no (ActualStartDate field doesn't exist) | yes (TaskStartDate, null when missing) |
| Remaining MISSING/DERIVE classifications in tasks | 3 | 1 (only wipState) |

**Risk:** Low. Schedule chains may behave differently — chains are now scoped to work orders rather than jobs, which is the right behavior but a behavior change. Verify no downstream code assumes job-level chain scope.

**Rollback:** Revert `mapping.json`.

**Effort:** ~30 min — apply the edit, run audit, run engine tests, smoke-test a sync.

**Acceptance:**
- [ ] Audit reports 12 of 13 tasks rules OK; only `wipState` remains in MISSING/DERIVE
- [ ] Sample work order's tasks chain together correctly (Order=1 → Order=2 → ...) instead of sentinel-disrupted
- [ ] `tasks.type` produces values from the `Formula` field (HR/UN → STANDARD, etc.)
- [ ] `tasks.actualStart` is populated for tasks with non-null `TaskStartDate`
- [ ] Existing engine tests still pass
- [ ] No regression in chain solver behavior on demo-manufacturing tenant (regression gate)

---

### Sprint C2 — wipState (waits on engine work, ~1-2 days)

**Scope:**
- Implement multi-condition `_derive` rule type in MappingEngine
- Apply v3's `tasks.wipState` rule

**Prerequisites:**
- Sprint C1 complete
- Engine work to support `_derive` with `if/elif/else` logic
- *(Optional shortcut)*: confirmation from Stafford on escalation #13 — if `WoStatusCode` cleanly maps to lifecycle states, this becomes a regular `lookup` and Sprint C2 is no engine work, just a mapping edit

**Expected impact:**

| Metric | Before C2 | After C2 |
|---|---|---|
| `tasks` rules referencing real fields | 12 of 13 | 13 of 13 |
| Engine capability gaps remaining | 1 (multi-condition derive) | 0 |

**Risk:** Medium. New engine rule type — design/implement/test. Get the derive semantics right (null handling, partial-match behavior, recursive derives).

**Rollback:** Revert mapping.json (tasks.wipState back to TODO state) + revert engine code.

**Effort:**
- Engine work: ~1-2 days (new rule type + tests + integration)
- Apply mapping: ~30 min after engine ships
- Total: ~2 days

**Open: Stafford-side shortcut.** If escalation #13 reveals `WoStatusCode` already represents lifecycle states (NOT_STARTED / IN_PROCESS / COMPLETED), the engine work can be skipped entirely — `wipState` becomes `{ from: "WoStatusCode", lookup: { ... } }` and Sprint C2 collapses into Sprint C1. Worth asking before building.

---

## Cross-sprint dependencies summary

```
Sprint A (resources)         independent
    ↓
Sprint B (orders + adapter)  blocked on adapter wiring decision
    ↓
Sprint C1 (linkId + type)    independent post-B
    ↓
Sprint C2 (wipState)         blocked on engine work OR Stafford answer
```

Total ship-the-non-blocked work: **A + B(b) + C1 = ~3 hours of editing + ~30 min of audit + verification** (plus the adapter Sprint 2 work for B(a) when scheduled).

Total complete-v3 work including engine: **~3-4 days** with Stafford answers in hand.

---

## What this plan deliberately leaves for later

- **Engine `@dueDate` cross-field reference** — `orders.lateDueDate` stays TODO. Defer until Stafford clarifies the late-tolerance concept (escalation #6).
- **Sanitization of customer data** — required before promoting `tools/mock-genius/recorded/stafford-work7-2026-04-23/` to a committable `fixtures/` scenario. Separate sprint.
- **Bearer-token auth for live integration** — `sprint-capture-work7-fixtures.md`. Required for live syncs but not for offline replay against captured fixtures.
- **Mock-genius config-driven entity routing** — finding #6 from the PokeAPI session. Only matters if a non-Genius tenant lands; deferred.

---

## Apply order recommendation

If we want to make progress today without waiting on anything:

1. **Sprint A right now** (~30 min) — pure win, low risk, unblocks meaningful resources data flowing through the pipeline
2. **Sprint B path (b)** (~2 hours) — quick adapter.json hack, validate end-to-end against fixture
3. **Sprint C1** (~30 min) — apply linkId fix and type/actualStart simplifications
4. **Stop and prep for Stafford meeting** — bring 13 escalations
5. **After Stafford meeting:** decide on Sprint B path (a) refactor vs leave (b) in place; decide whether C2 needs engine work or collapses to a lookup
