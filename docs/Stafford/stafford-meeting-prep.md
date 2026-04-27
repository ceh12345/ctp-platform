# Stafford Meeting Prep — Open Questions

**Date prepared:** 2026-04-26
**Status:** Single source of truth for outstanding Stafford-side decisions blocking CTP integration. Consolidates `auth-questions-for-stafford.md`, `mapping-change-log.md` (v2), and `mapping-change-log-v3.md`. Update the **Answers** section at the bottom during/after the meeting.

---

## TL;DR

22 open questions across 5 priority tiers. **3 questions block live integration entirely** (Tier 1). **7 questions affect mapping correctness** (Tier 2). The remainder are verification, architecture, and operational items that can be partially deferred to email follow-up.

| Tier | Count | Description | Best handled |
|---|---|---|---|
| 1. Blockers | 3 | Can't ship live integration without answers | Live conversation |
| 2. Mapping semantics | 7 | Affect whether the landscape is correct | Live conversation |
| 3. Verification | 5 | Confirm or refute our reasoned assumptions | Quick yes/no — could be email |
| 4. Architecture | 2 | Long-term scope decisions | Discussion |
| 5. Operational | 5 | SLAs, schedules, infra | Email or quick mention |

---

## Tier 1 — Blockers

### Q1 — Service account for the integration

**Question:** Will you provision a dedicated Genius service account for the CTP integration, or do you want us to use an existing user account (e.g. `allan` in WORK7)?

**Why we need to know:** We're currently running our 2026-04-23 capture using `allan` on `WORK7`. That works for dev testing but is a real human's account. For ongoing automated syncs in any environment beyond WORK7 dev work, we need a non-human account so credentials can rotate independently of any individual.

**What we'll do with the answer:**
- If **dedicated service account** (preferred): you provision (suggest `CTP_INTEGRATION` or similar), share creds via a secure channel; we configure adapter and proceed.
- If **shared user account**: we use it for now and add this to a future security debt item.

**Answer:** _(fill in)_

---

### Q2 — Production environment (STAFFO) access

**Question:** When are you comfortable with us syncing live `STAFFO` (production Stafford Engineering) data, vs. continuing to test against `WORK7` only?

**Why we need to know:** `WORK7` is a frozen test environment. Once our adapter is fully tested against captured WORK7 data, the next milestone is a controlled sync against `STAFFO`. We want to know your gating criteria.

**What we'll do with the answer:**
- Plan our adapter testing with the right cutover point in mind
- Define a "go-live readiness" checklist matching your expectations

**Answer:** _(fill in)_

---

### Q3 — Read scopes / permissions for the service account

**Question:** Confirm the service account is read-only and scoped to: `salesOrderDetailEntity`, `workOrderWithAdvancedInformationViewEntity`, `productionTaskWithAdvancedInfoViewEntity`, `machineAndRessourceEntity`, plus the public `configuration/companies` endpoint we use for health checks.

**Why we need to know:** Defense-in-depth — if our adapter has a bug, account-level scope limits blast radius. Also, your security team will likely want to confirm.

**What we'll do with the answer:** Document the scope; add adapter-side assertions if your account model exposes scope detail in responses (e.g., 403 on write attempts).

**Answer:** _(fill in)_

---

## Tier 2 — Mapping semantics

These questions decide whether the landscape we build correctly represents your operational reality. Wrong answers here = wrong scheduling output.

### Q4 — `RessourceType` enum meanings (R / W / S)

**Question:** On `machineAndRessourceEntity`, the `RessourceType` field has three values: R (44 records), W (31), S (2). What does each represent operationally?

**Our tentative interpretation:** R = Resource (single machine), W = Work center (pooled labor/equipment), S = Subcontract.

**Why we need to know:** Drives both our `resources.type` and `resources.class` mappings. Wrong interpretation means wrong scheduling behavior on subcontracted vs. in-house resources.

**What we'll do with the answer:** Update the lookup tables in the proposed mapping (currently apply tentatively).

**Answer:** _(fill in)_

---

### Q5 — `IsFinite=false` operational meaning

**Question:** On `machineAndRessourceEntity`, 25 of 77 resources have `IsFinite=false`. What does the engine-side behavior expect for these?

**Options we can think of:**
- (a) **Skip them** — exclude from scheduling entirely
- (b) **Treat as always-available** — infinite capacity, no contention
- (c) **Capture and ignore** — for visibility only

**Why we need to know:** This is a major scheduling-engine design decision. Today CTP treats every resource as finite-capacity. Wrong treatment for `IsFinite=false` resources produces wrong schedules.

**What we'll do with the answer:** Scope the engine work for handling infinite-capacity resources. Tracked as a separate engine sprint.

**Answer:** _(fill in)_

---

### Q6 — `Efficiency` operational meaning

**Question:** On `machineAndRessourceEntity`, the `Efficiency` field has three values: 90.0% (46 records), 75.0% (27), 100.0% (4). Does this multiply task duration (e.g. 75% efficiency means a task takes 1.33× longer on this resource), or is it informational only?

**Why we need to know:** If it's a duration multiplier, it should feed into the scheduler's task-on-resource cost calculation. If informational, it shouldn't affect scheduling at all.

**What we'll do with the answer:** Either route the value through to the engine's duration calculation, or capture but ignore.

**Answer:** _(fill in)_

---

### Q7 — `Formula` field meaning

**Question:** On `productionTaskWithAdvancedInfoViewEntity`, the `Formula` field has values like `HR/UN` and `JR/DY`. What do these encode?

**Our guess:** Hours per Unit (`HR/UN`) vs Jobs per Day (`JR/DY`) — affects how `CycleTime` should be interpreted into a duration.

**Why we need to know:** Drives our `tasks.type` mapping AND potentially the duration calculation. `CycleTime: 1.5` means very different things if the formula is "hours per unit produced" vs "jobs completed per day."

**What we'll do with the answer:** Update mapping; if it affects duration, fix the `factor: 3600` in the duration rule (which currently assumes hours).

**Answer:** _(fill in)_

---

### Q8 — `WoStatusCode` as wipState source?

**Question:** On `productionTaskWithAdvancedInfoViewEntity`, the `WoStatusCode` field has 3 distinct values. Do these represent task lifecycle states (NOT_STARTED / IN_PROCESS / COMPLETED) directly, or do they represent something else?

**Why we need to know:** If `WoStatusCode` cleanly maps to lifecycle states, our `tasks.wipState` mapping becomes a simple lookup (no engine work needed). If not, we need to derive `wipState` from `IsCompleted` + `TaskStartDate` (requires multi-condition derive engine work, ~1-2 days).

**What we'll do with the answer:**
- If lifecycle states → drop the engine work, use a simple lookup. Asks `Sprint C2` collapses.
- If not → schedule the engine work for multi-condition derive support.

**Answer:** _(fill in)_

---

### Q9 — Late-tolerance concept

**Question:** Does Genius track late-delivery tolerance separately from due date anywhere? Specifically, what's the relationship between:
- `DeliveryDate` (customer-promised date — currently maps to `dueDate`)
- `JobEndDate` (production-end date — currently unused)
- Any other "latest acceptable" or "tolerance" field

**Why we need to know:** Our CTP engine has both `dueDate` and `lateDueDate` concepts (lateness penalties accrue between them). Currently we default `lateDueDate = dueDate` (zero tolerance). If you have a real tolerance signal somewhere, we should use it.

**What we'll do with the answer:**
- If a tolerance field exists → map it directly
- If `JobEndDate` is the answer → map `lateDueDate` to that
- If no concept → keep zero-tolerance default

**Answer:** _(fill in)_

---

### Q10 — Priority signal — what differentiates production priority?

**Question:** The `Strategy` field on work orders has only 2 values in WORK7 (JIT=950, ASAP=6 — 99.4% mono-valued). Is this an artifact of WORK7 being a test environment, or is `Strategy` truly this mono-valued in production STAFFO data? If yes, what other field actually differentiates priority among orders?

**Why we need to know:** Our solver weights orders by priority. With effectively one priority value, the solver has no signal — every order gets default priority 50. Real production must differentiate somehow.

**What we'll do with the answer:**
- If a different field is the real priority → re-source `orders.priority` from there
- If priorities really are this flat → confirm the solver should fall back to dueDate-only ordering

**Answer:** _(fill in)_

---

## Tier 3 — Verification

These confirm or refute reasoned assumptions. Each could be answered with a quick yes/no in email if pressed for time.

### Q11 — `linkId.chainKey = WorkOrderCode` is the right chain scope?

**Question:** We've configured task chains to be scoped per work order (`chainKey: WorkOrderCode`). Does this match your expectation, or should tasks across different work orders ever be in the same chain? If yes, what's the cross-WO chain identifier?

**Why we need to know:** Chain scope affects how the scheduler sequences tasks. Wrong scope = wrong precedence constraints.

**Verified ourselves:** `WorkOrderCode` is 100% populated, 797 distinct values on tasks. Job-level scope (the alternative) was 271 distinct — coarser, multiple WOs share a JobCode.

**Answer:** _(fill in)_

---

### Q12 — `Order` (1, 2, 3...) is the routing-position field, not `SequenceNumber`?

**Question:** We've used the `Order` field (1-22 range, monotonic) for chain ordering instead of `SequenceNumber`. Is `Order` the canonical routing-position field?

**Verified ourselves:** `SequenceNumber` has heavy sentinel use — top values are 32767 (282 records), 9999 (144), 9998 (49). `Order` has clean 1-22 routing values with monotonic decay (645 firsts → 1 twentieth). Looks unambiguous.

**Why we need to know:** Wrong choice produces unstable chain ordering. Want explicit confirmation.

**Answer:** _(fill in)_

---

### Q13 — `Description1` is the canonical resource name?

**Question:** Confirm `Description1` is the right field for resource display name. There's no plain `Name` field; `Description1` is 100% populated with 68 distinct values (some shared across similar machines).

**Why we need to know:** UI display + log/error messages.

**Answer:** _(fill in)_

---

### Q14 — `MachineRateCost` is the right hourly-rate field?

**Question:** Resources have multiple rate fields: `MachineRateCost`, `AverageWorkerRate`, `MinimumRate`, `SellingRate`, `HourCapacityPerDay`. We chose `MachineRateCost` for `resources.hourlyRate`. Confirm or correct.

**Why we need to know:** Affects cost-aware scheduling and the savings KPI.

**Answer:** _(fill in)_

---

### Q15 — `Wostatus` filter — is `PLANNED` ready to schedule?

**Question:** Work orders have status values: `PRINTED`, `CANCELLED`, `CREATED`, `PLANNED`. We're filtering to active ones. Is `PLANNED` ready-to-schedule, or premature (planning still in progress)?

**Why we need to know:** Wrong filter either includes unschedulable WOs or excludes ready ones.

**Our current filter:** `Wostatus IN ('PRINTED', 'CREATED')` — both `CANCELLED` and `PLANNED` excluded. Need to confirm `PLANNED`.

**Answer:** _(fill in)_

---

## Tier 4 — Architecture

### Q16 — Sales-order role in CTP

**Question:** With work orders driving CTP scheduling, is there any role left for sales-order data in the CTP integration? Examples we can think of: customer-name overlay on the UI, demand aggregation across multiple WOs for the same sales line, or contract-term enrichment.

**Why we need to know:** Affects whether we mass-skip the `salesOrderDetailEntity` endpoint or keep syncing it as enrichment data.

**What we'll do with the answer:**
- "Skip it" → drop sales-order fetching entirely; smaller sync, simpler adapter
- "Keep it for X purpose" → maintain a parallel sync path with the appropriate target use

**Answer:** _(fill in)_

---

### Q17 — `ItemStatus="P"` filter scope

**Question:** Our sales-order capture filtered with `ItemStatus!=C` (excluding closed). All 474 records came back with `ItemStatus="P"`. Is `P` the standard pending/production status, or are there other open values we'd see in production STAFFO?

**Why we need to know:** Filter correctness for production sync.

**Answer:** _(fill in)_

---

## Tier 5 — Operational

### Q18 — Token lifetime and refresh policy

**Question:** How long does a Bearer token issued by `POST /api/auth` remain valid? Is there an explicit expiry, or is it session-based? Should we proactively refresh, or wait for 401 and retry?

**Why we need to know:** Determines our adapter's auth caching strategy. Long-lived tokens → cache and reuse; short-lived → always refresh; on-401-only → reactive refresh.

**Our current plan:** Reactive — on first 401 mid-sync, re-login and retry once. If the second call also 401s, fail loudly.

**Answer:** _(fill in)_

---

### Q19 — Rate limits / throttling

**Question:** Are there any rate limits, throttles, or anomaly-detection rules we should know about before running paginated syncs? Our 2026-04-23 capture made 48 sequential page requests over ~2 minutes without issue, but we want to know the ceiling.

**Why we need to know:** Adapter retry/backoff strategy + sync cadence planning.

**Answer:** _(fill in)_

---

### Q20 — Port `:53215` stability

**Question:** Is the custom port `:53215` permanent, or could it change with a Genius upgrade or environment refresh?

**Why we need to know:** If unstable, we want a way to discover the current port (DNS SRV record? environment-variable-driven config? manual notification?) rather than hardcoding.

**Answer:** _(fill in)_

---

### Q21 — Preferred sync cadence

**Question:** What's your preferred sync cadence for live production data? Hourly? Daily? On-demand triggered by your team?

**Why we need to know:** Drives our scheduler-side cadence config and the operations runbook.

**Our default plan:** Daily for STAFFO, on-demand for WORK7 dev testing.

**Answer:** _(fill in)_

---

### Q22 — Password encryption (HMAC-SHA256) status

**Question:** The Genius Swagger documents an optional HMAC-SHA256 password encryption mode controlled by web.config. Is this enabled in your environment? If yes, share the encryption key.

**Why we need to know:** If enabled, our adapter must HMAC-encode passwords before login. Currently we send plaintext, which works for WORK7 but may fail in production.

**Answer:** _(fill in)_

---

## Answers received (fill during/after meeting)

| Q | Answer | Source / signed-off-by | Date | Action item |
|---|---|---|---|---|
| 1 | _(blank)_ | | | |
| 2 | _(blank)_ | | | |
| 3 | _(blank)_ | | | |
| 4 | _(blank)_ | | | |
| 5 | _(blank)_ | | | |
| 6 | _(blank)_ | | | |
| 7 | _(blank)_ | | | |
| 8 | _(blank)_ | | | |
| 9 | _(blank)_ | | | |
| 10 | _(blank)_ | | | |
| 11 | _(blank)_ | | | |
| 12 | _(blank)_ | | | |
| 13 | _(blank)_ | | | |
| 14 | _(blank)_ | | | |
| 15 | _(blank)_ | | | |
| 16 | _(blank)_ | | | |
| 17 | _(blank)_ | | | |
| 18 | _(blank)_ | | | |
| 19 | _(blank)_ | | | |
| 20 | _(blank)_ | | | |
| 21 | _(blank)_ | | | |
| 22 | _(blank)_ | | | |

---

## Post-meeting actions (fill after answers received)

For each answered question, document:
1. The answer
2. The code/config changes triggered (`mapping.proposed.v3.json`, `adapter.json`, engine sprints, etc.)
3. Whether the answer creates new questions
4. Whether the answer changes our priority sequencing

Once all Tier 1 + Tier 2 questions are answered, the next sprint is straightforward:
- Bearer-auth adapter implementation (~12-15 hours dev) — see `sprint-capture-work7-fixtures.md`
- Apply `mapping.proposed.v3.json` Sprint B + C1 (~2 hours)
- Engine work for `_derive` (only if Q8 is no — `WoStatusCode` doesn't map cleanly)

Total path-to-live-integration: **2-3 days of dev** post-answers.

---

## Reference docs (technical detail behind these questions)

- `auth-questions-for-stafford.md` — original auth-flow narrative (now mostly resolved)
- `mapping-change-log.md` (v2) — work-orders-as-orders architectural shift rationale
- `mapping-change-log-v3.md` — corrections + the 13 mapping escalations
- `mapping-apply-plan-v3.md` — three-sprint staged rollout plan
- `mapping.proposed.v3.json` — concrete proposed mapping (depends on these answers)
- `genius-swagger-v17.1.6.3.json` — Genius API spec (`/swagger/docs/v17.1.6.3` snapshot)
- `tools/mock-genius/recorded/stafford-work7-2026-04-23/` — captured fixture (gitignored)
