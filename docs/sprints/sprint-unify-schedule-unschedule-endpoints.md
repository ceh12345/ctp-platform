# Sprint: Unify Schedule/Unschedule into List-Shaped Endpoints

**Status:** 📋 Ready
**Size:** ~4-6 hours CC work
**Depends on:** `sprint-setup-teardown-unschedule-fix.md` (engine sweep already in place)
**Triggered by:** UI investigation found that bulk unschedule is implemented as N serial single-task HTTP calls. There is no bulk endpoint at all. The engine has had `unscheduleBulkWithCascade` for a while, but the API never exposed it.

---

## Problem

### What the UI does today

```
handleApiBulkUnschedule(keys[])           App.tsx:13266
  └─ for each key:
       POST /v1/ctp/tasks/:key/unschedule  (one HTTP call per task)
  └─ GET /v1/ctp/state                     (refresh after all done)
```

### Why this is wrong

1. **N round-trips for one logical action.** Unscheduling 50 tasks = 50 HTTP calls. Auth, serialization, network, and engine init pay an N× tax.
2. **Not atomic.** A network blip mid-loop leaves the landscape in a partial state with no clean recovery. The UI has no way to know which calls succeeded.
3. **Solver can't see the batch.** When the user asks "schedule these 20 tasks," the solver currently runs 20 independent passes instead of one pass over the full set. For chains with shared resources, this produces materially worse schedules.
4. **The chain sweep on the single-task path may or may not be firing per call.** Even if it is, sweeping 50 chains 50 times to do the work that one sweep would do is wasteful.
5. **Inconsistent with the rest of the API.** The CTP spec already standardizes on batch shapes (`query-batch`, `find-multi`). Single-task schedule/unschedule are the outliers.

### Why "add a bulk endpoint alongside the single-task one" is the wrong fix

Two endpoints doing almost the same thing is more surface area to document, test, version, and keep behaviorally aligned. Every future change to schedule/unschedule semantics has to be made in two places. Drift is inevitable.

The cleaner answer: **one endpoint per verb, list-shaped input always.** A single task is a list of one. There is no "bulk" mode and no "single" mode — there is just "schedule" and "unschedule," and they take lists.

---

## Design

### Endpoints

Replace:
- `POST /v1/ctp/tasks/:key/schedule` ❌ delete
- `POST /v1/ctp/tasks/:key/unschedule` ❌ delete

With:
- `POST /v1/ctp/tasks/schedule` — body: `{ "taskKeys": [...] }`
- `POST /v1/ctp/tasks/unschedule` — body: `{ "taskKeys": [...] }`

The word "bulk" is intentionally absent from the names. If there's only one endpoint, "bulk" is redundant — the endpoint just *is* the schedule operation.

### Request shape

```typescript
interface ScheduleRequest {
  taskKeys: string[];   // 1..N keys
}

interface UnscheduleRequest {
  taskKeys: string[];   // 1..N keys
}
```

A single-task call is `{ "taskKeys": ["X"] }`. Empty list is a 400.

### Response shape

Per-key results plus a summary. The per-key array is what makes "list of one" feel native — a UI doing a single drag-and-drop just reads `results[0]`.

```typescript
interface TaskResult {
  key: string;
  status: "scheduled" | "unscheduled" | "skipped";
  reason?: string;          // populated when status is "skipped"
  cascadedKeys?: string[];  // unschedule only — route-defined SETUP/TEARDOWN swept with this task's chain
}

interface ScheduleResponse {
  results: TaskResult[];
  summary: {
    requestedCount: number;
    scheduledCount: number;
    skippedCount: number;
  };
}

interface UnscheduleResponse {
  results: TaskResult[];
  summary: {
    requestedCount: number;
    unscheduledCount: number;       // total removed including cascade
    processCount: number;
    cascadedSetupCount: number;
    cascadedTeardownCount: number;
    skippedCount: number;
    affectedChains: string[];
  };
}
```

`cascadedKeys` on a per-key result is useful for the UI but isn't required for correctness — the `summary` carries the totals the engine already returns from `BulkUnscheduleResult`. If attributing each cascaded key back to "the task that caused its chain to empty out" is awkward (e.g. when 3 process tasks in the same chain are unscheduled in one batch, which one "caused" the cascade?), it's fine to leave `cascadedKeys` empty on the per-key results and rely on the summary. Pick whichever is simpler to implement; the UI can work with either.

### Partial-failure semantics: best-effort

Process every key the engine can. Skip the ones it can't (committed, running, already in target state, missing). Return the per-key status for every requested key. Never roll the whole batch back because of one bad key.

This matches what `unscheduleBulkWithCascade` already does and matches what a planner expects: "most of those went through, here's the one that didn't and why."

### Engine layer

**Unschedule:** already done. `unscheduleBulkWithCascade(taskKeys)` exists, returns `BulkUnscheduleResult`, and runs the chain sweep correctly. The API just needs to call it.

**Schedule:** the engine needs a `scheduleBulk(taskKeys)` sibling if one doesn't already exist. **CC should check first** — there may already be a method that does this (search for `scheduleBulk`, `scheduleTasks`, anything that takes a list). If there isn't, build one with this contract:

- Takes `taskKeys: string[]`
- Runs the solver **once** over the full input set, not N independent passes
- Returns a result shape parallel to `BulkUnscheduleResult`: per-key status plus a summary
- Skips (rather than throws) on keys that can't be scheduled — already scheduled, missing, blocked by unmet predecessors, etc.

This is the meaningful engine win: one solver pass over 20 tasks produces better schedules than 20 passes over 1 task each, because the solver can see the full set when making placement decisions.

### Single-task convenience in the SDK, not the API

The TypeScript client SDK exposes both shapes so developers calling from code get ergonomic single-task calls without the server having to maintain a second endpoint:

```typescript
// SDK
class CTPClient {
  async unschedule(keys: string[]): Promise<UnscheduleResponse> {
    return this.post("/v1/ctp/tasks/unschedule", { taskKeys: keys });
  }
  async unscheduleOne(key: string): Promise<TaskResult> {
    const res = await this.unschedule([key]);
    return res.results[0];
  }
  // ...same for schedule
}
```

Server: one endpoint. SDK: two methods. Best of both.

---

## Deliverables

### 1. Engine — verify or build `scheduleBulk` ⏳

**Location:** `basescheduler.ts` (or wherever schedule operations live)

- Search for an existing bulk schedule method. If one exists and runs a single solver pass, document its signature and skip to deliverable 2.
- If it doesn't exist, build one that mirrors `unscheduleBulkWithCascade` in shape: takes `taskKeys: string[]`, returns a `BulkScheduleResult` with `requested`, `scheduled`, `skipped`, plus per-key reasons for skips.
- The single solver pass is the important part. Looping `scheduleTaskWithStateChanges` N times defeats the purpose.
- Add a `BulkScheduleResult` type next to `BulkUnscheduleResult` in `unschedule-result.ts` (or rename the file to `bulk-result.ts`).
- Tests: bulk schedule of 5 tasks across 2 chains, mix of schedulable and skippable, partial-batch behavior, single-pass solver verification (e.g. compare result to looping N times and confirm the bulk version is at least as good).

### 2. API — new endpoints, delete old ones ⏳

**Location:** `packages/api/src/modules/ctp/`

- **New:** `POST /v1/ctp/tasks/schedule` → `CTPController.schedule()` → `CTPService.schedule(taskKeys)` → engine `scheduleBulk`.
- **New:** `POST /v1/ctp/tasks/unschedule` → `CTPController.unschedule()` → `CTPService.unschedule(taskKeys)` → engine `unscheduleBulkWithCascade`.
- **Delete:** the existing `POST /v1/ctp/tasks/:key/schedule` and `POST /v1/ctp/tasks/:key/unschedule` controllers, service methods, and route registrations. Don't leave them as deprecated wrappers — clean removal.
- **DTOs:** `schedule-request.dto.ts`, `schedule-response.dto.ts`, `unschedule-request.dto.ts`, `unschedule-response.dto.ts` matching the shapes in the Design section. Validation: `taskKeys` is a non-empty array of strings.
- **OpenAPI:** swagger annotations on the new endpoints so the auto-generated docs are accurate.
- **Tenant scoping:** the new endpoints must respect the same `tenant_id` isolation as everything else in `/v1/ctp/`.
- **Best-effort semantics:** never throw because one key in the list is bad. Return 200 with the skipped key in `results`. Throw only on auth failures, malformed bodies, or genuine engine errors.
- Tests: list of one, list of many, list with all-skip, list with mix, empty list (400), unknown keys, cross-tenant key (skipped, not leaked), large list (smoke test for performance).

### 3. UI — replace the loops ⏳

**Location:** `App.tsx` (currently around line 13266) and any sibling action handlers for schedule/unschedule.

- Replace the `for each key` loop in `handleApiBulkUnschedule` with a single `POST /v1/ctp/tasks/unschedule` call passing the full `keys[]` array.
- Same for whatever the equivalent schedule handler looks like — replace the loop with a single call.
- Read the response `summary` for the toast (use the field names from the new DTOs — `unscheduledCount`, `processCount`, `cascadedSetupCount`, `cascadedTeardownCount`).
- Drop the post-loop `GET /v1/ctp/state` refresh if the new endpoint can return enough state in its response, or keep it if a full refresh is still needed. CC's call based on what the response contains.
- The cascade-aware toast and confirmation dialog work from the parent sprint is **still out of scope** per that sprint's "Why no UI work" decision. The UI just calls the new endpoint and shows whatever toast it shows today, but using the new response shape. No new dialogs, no new filter chips.

### 4. SDK convenience methods (optional, nice-to-have) ⏳

**Location:** wherever the TypeScript client SDK lives (if there is one yet — if not, skip this deliverable).

- `unschedule(keys: string[])` and `unscheduleOne(key: string)`.
- `schedule(keys: string[])` and `scheduleOne(key: string)`.
- The `*One` methods are thin wrappers that call the list version with a single-element array and return `results[0]`.

If there's no SDK package yet, defer this to whenever one is created. The server-side work is what matters.

---

## Testing Scenarios

| # | Scenario | What to verify |
|---|----------|----------------|
| 1 | Unschedule list of 1 | Response has 1 result, summary counts match |
| 2 | Unschedule list of 50 | Single HTTP call, single engine call, single chain sweep |
| 3 | Unschedule list with cascade | `summary.cascadedSetupCount` and `cascadedTeardownCount` are non-zero, `affectedChains` populated |
| 4 | Unschedule list with mix of valid + committed | Valid ones are unscheduled, committed ones in `results` with `status: "skipped"` and a `reason`. HTTP 200, not 400. |
| 5 | Unschedule empty list | HTTP 400 |
| 6 | Unschedule unknown key | `results` has the key with `status: "skipped"`, `reason: "not found"`. Other keys in the list still process normally. |
| 7 | Schedule list of 1 | Mirror of #1 |
| 8 | Schedule list of N tasks across shared resources | Solver runs once, result is at least as good as looping (capture this in a test that compares both paths) |
| 9 | Schedule list with mix of schedulable and blocked | Schedulable ones go through, blocked ones in `results` with reason |
| 10 | UI bulk unschedule of 20 process tasks | Network tab shows ONE request, not 20. Toast reports accurate counts including cascade. |
| 11 | UI bulk schedule | Same — one request, not N |
| 12 | UI single drag-and-drop unschedule | Goes through the same endpoint with a one-element list. Works identically to bulk. |
| 13 | Cross-tenant isolation | Tenant A cannot unschedule tenant B's tasks even if it knows the key |
| 14 | Old endpoint URLs | Return 404 (not 405). The routes are gone, not just methods on a different verb. |
| 15 | OpenAPI docs | New endpoints appear in swagger, old ones don't |

---

## Files Changed

| File | Change |
|------|--------|
| `basescheduler.ts` | **MAYBE MODIFIED** — add `scheduleBulk` if it doesn't exist; otherwise no change |
| `unschedule-result.ts` (or rename to `bulk-result.ts`) | **MODIFIED** — add `BulkScheduleResult` type alongside `BulkUnscheduleResult` |
| `basescheduler.test.ts` | **MODIFIED** — add `scheduleBulk` tests if a new method was built |
| `packages/api/src/modules/ctp/ctp.controller.ts` | **MODIFIED** — delete two single-task routes, add two list-shaped routes |
| `packages/api/src/modules/ctp/ctp.service.ts` | **MODIFIED** — delete `unscheduleTask`, add `schedule(taskKeys)` and `unschedule(taskKeys)` |
| `packages/api/src/modules/ctp/dto/schedule-request.dto.ts` | **NEW** |
| `packages/api/src/modules/ctp/dto/schedule-response.dto.ts` | **NEW** |
| `packages/api/src/modules/ctp/dto/unschedule-request.dto.ts` | **NEW** |
| `packages/api/src/modules/ctp/dto/unschedule-response.dto.ts` | **NEW** |
| `packages/api/src/modules/ctp/ctp.controller.spec.ts` | **MODIFIED** — rewrite single-task tests against the new endpoints |
| `App.tsx` | **MODIFIED** — replace `handleApiBulkUnschedule` loop with single call; same for the schedule handler |
| Client SDK (if it exists) | **MODIFIED** — add `schedule`/`unschedule` list methods plus `*One` convenience wrappers |

Adjust file paths to match the actual codebase structure.

---

## Verification

1. Run engine tests — `scheduleBulk` tests pass (if added), `unscheduleBulkWithCascade` tests still pass
2. Run API tests — new endpoint tests pass, old endpoint tests deleted (not skipped)
3. OpenAPI / swagger — old routes gone, new routes documented
4. Manual smoke test on Stafford tenant:
   - Select 20 tasks in the UI, click Unschedule, confirm network tab shows ONE request
   - Confirm the resource agenda is free of orphaned setup/teardown afterward (parent sprint invariant still holds)
   - Select 5 unscheduled tasks, click Schedule, confirm one request and reasonable placement
   - Try to hit an old `POST /v1/ctp/tasks/:key/unschedule` URL directly with curl — confirm 404
5. Performance: 50-task unschedule should complete in well under a second of API time (the engine does the real work; the API layer adds negligible overhead with one call vs fifty)

---

## Out of Scope

- Cascade-aware UI dialogs and toasts (parent sprint decided no UI surfacing of the cascade — see `sprint-setup-teardown-unschedule-fix.md` "Why no UI work")
- API versioning to v2 — `/v1/` is pre-GA, breaking changes inside it are acceptable now and would not be after launch
- Authentication, rate limiting, or billing changes — the new endpoints inherit whatever the existing CTP endpoints use
- Migrating other single-task CTP endpoints to list shape (e.g. `query`, `what-if`) — those already have `*-batch` siblings and aren't part of this cleanup
- Building the client SDK from scratch if it doesn't already exist — defer to a separate sprint if needed

---

## Notes for CC

- **Check before building.** Search the engine for any existing bulk schedule method before assuming you need to write one. The unschedule side already has `unscheduleBulkWithCascade`; there may be a sibling.
- **One solver pass is the point.** If you do build `scheduleBulk` and find yourself writing `for (const key of taskKeys) { this.scheduleTaskWithStateChanges(key); }`, stop — that's exactly what the API layer is doing today and the whole reason for this sprint. The bulk method needs to push the full set into the solver and let it solve once.
- **Best-effort, not all-or-nothing.** A bad key in the list is a skip, not a 400. 400 is for malformed requests (empty list, missing field, wrong shape), not for engine-level "can't do that right now."
- **Delete the old routes, don't deprecate.** Pre-GA, no consumers yet, this is the cheapest moment to do it. Leaving deprecated wrappers around just creates the same maintenance problem this sprint is trying to solve.
- **Per-key `cascadedKeys` is optional.** If attributing cascaded keys to specific request keys is awkward, leave the field empty on the per-key results and rely on the summary. The UI has what it needs from the summary.

---

*The engine has been ready for this for a while. The API layer just hasn't caught up. Two new routes, two old routes gone, one solver pass instead of N. Small sprint, real cleanup.*
