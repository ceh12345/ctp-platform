# Sprint: RestAdapter Error-Path Resilience

**Status:** 📋 Ready
**Size:** ~2 hr CC work (single session: code changes + tests + verification)
**Depends on:** Data Adapter Phase 2 (commit `e6d9fb9`) — REST adapter, mapping engine, adapter-aware sync. Commit `0b98bd1` hardens pure-duration + feasibility paths that this sprint does not touch.
**Triggered by:** Mock-genius hardening queue item #3, in preparation for the live Stafford Genius API cutover the week of 2026-04-20. First real external-adapter deployment; live VPN calls will occasionally fail (VPN drops, Genius restarts, credential expiry) and the current failure modes produce either wasted latency or opaque diagnostics. The adapter must fail **cleanly** — no landscape corruption, no mystery logs — so that operational incidents are resolvable without reconstructing network traces.

---

## Problem

`RestAdapter.fetchRawData()` is the single network boundary between the CTP platform and any external system-of-record. It handles the happy path and a narrow subset of failure modes (HTTP 500 + empty arrays + missing endpoints) but leaves several realistic production failures either untested or producing poor diagnostics.

Six gaps, grouped by severity:

**Severity 1 — Wasted time / misleading logs**
- **HTTP 401 / 403**: retried 3× with backoff before throwing. ~6s of wasted latency on a permanent error. The retry produces four identical `HTTP 401` lines, obscuring that it's an auth failure rather than a transient condition.
- **Malformed JSON**: `response.json()` throws `SyntaxError: Unexpected token …`, retried, final error is bare. No endpoint context, no body snippet. Diagnostic dead-end.
- **Network timeout**: `AbortController.abort()` fires; error is generic `AbortError: signal aborted`. No mention of the configured timeout value or the endpoint that hung.

**Severity 2 — Correct but unproven behavior**
- **Empty body `{}`**: returns `[]` via the `data?.Result ?? []` fallback. Works correctly but **has no test**. A regression here would silently zero out tenant data.
- **Pagination mid-failure** (page 1 OK, page 2 fails): partial `results` array is discarded via the thrown exception. Correct, but untested — a refactor could introduce a partial-hydration bug.
- **Landscape integrity on sync failure**: pre-existing landscape is preserved because `StateService.syncFromAdapter()` only calls `applyTransformed()` after `syncService.sync()` resolves. Correct, but no test asserts this. A refactor that moves `landscapes.set(...)` before the await would silently corrupt state on the next failed sync.

**Why it matters for Stafford cutover.** VPN drops, Genius restarts, and credential misconfiguration are the three most likely first-week failure modes. Each of the above gaps turns an operational blip into either (a) confusing logs that slow incident response or (b) silent state corruption invisible until a downstream solve produces nonsense.

---

## Design

### Core principle

The adapter is a **fail-fast, fail-loud, fail-safe** boundary:

- **Fail-fast:** recognize non-retryable errors and skip the retry loop.
- **Fail-loud:** wrap every error with enough context (endpoint URL, HTTP status or timeout value, original cause) that a planner can diagnose without reaching for network traces.
- **Fail-safe:** the in-memory landscape is **never** mutated on fetch failure. A tenant with a prior successful sync continues to serve stale-but-valid data; a tenant with no prior sync returns `null`. This is already true by construction in `StateService.syncFromAdapter()` — the sprint locks it in with a regression test.

### Error propagation path

The adapter sits at the start of a well-defined failure chain. Every change in this sprint preserves the chain unchanged — only the diagnostics at the adapter boundary improve.

```
┌────────────────┐     ┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  fetch() call  │ ──▶ │ RestAdapter │ ──▶ │ SyncService.sync()   │ ──▶ │ syncFrom-    │
│  (network)     │     │ throws      │     │ throws (await        │     │ Adapter()    │
│                │     │ wrapped     │     │  propagates)         │     │ rejects      │
└────────────────┘     └─────────────┘     └──────────────────────┘     └──────────────┘
                                                                                │
                                                                                ▼
                                                                    applyTransformed()
                                                                    is NEVER called
                                                                    → landscape intact
```

### Non-problem (do not change)

- **`StateService.syncFromAdapter()`** — the guard that runs `applyTransformed` only after `syncService.sync()` resolves is **correct** and is exactly what keeps the landscape uncorrupted. Do not restructure. The new isolation test locks it in.
- **`SyncService`** — orchestration layer is unchanged. All resilience lives in the adapter.
- **`FileAdapter`** — file-tenant path has no network boundary; out of scope.
- **Retry backoff math** (`retryDelay * (attempt + 1)`) — linear backoff is fine for the expected Stafford error profile. Exponential or jitter is over-engineering for this sprint.
- **`Promise.all` fan-out** for the three parallel endpoint fetches — fail-fast semantics are correct. Partial data from successful endpoints should not hydrate the landscape.

---

## Deliverables

### 1. Non-retryable HTTP errors

**Location:** `packages/api/src/modules/integration/rest-adapter.ts` (~line 70)

HTTP 4xx responses (except 408 Request Timeout and 429 Too Many Requests) are permanent. Auth failures, malformed requests, missing endpoints — none of these get better by retrying.

**Before:**
```typescript
if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
```

**After:**
```typescript
if (!response.ok) {
  const err: any = new Error(
    `HTTP ${response.status} ${response.statusText} fetching ${url}`
  );
  err.status = response.status;
  // 4xx are permanent — except 408 (timeout) and 429 (rate limit) which are transient.
  err.retryable =
    response.status >= 500 ||
    response.status < 400 ||
    response.status === 408 ||
    response.status === 429;
  throw err;
}
```

And in `fetchWithRetry`'s catch block, short-circuit on non-retryable:

```typescript
} catch (err: any) {
  lastError = err;
  if (err.retryable === false) break;   // ← new
  if (attempt < maxRetries) {
    await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
  }
}
```

### 2. Contextual error wrapping

Two specific error types produce poor diagnostics today. Both are wrapped with endpoint context and the original cause is preserved via `Error.cause`.

**Malformed JSON:**
```typescript
try {
  return await response.json();
} catch (parseErr: any) {
  throw new Error(
    `Invalid JSON from ${url}: ${parseErr.message}`,
    { cause: parseErr }
  );
}
```

**Fetch timeout (AbortError):**
```typescript
} catch (err: any) {
  if (err.name === 'AbortError') {
    lastError = new Error(
      `Timeout after ${timeout}ms fetching ${url}`,
      { cause: err }
    );
  } else {
    lastError = err;
  }
  if (lastError.retryable === false) break;
  if (attempt < maxRetries) {
    await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
  }
}
```

### 3. Zero behavior change for happy paths

Every existing test in `rest-adapter.spec.ts` must pass unmodified. The new tests are additive — they exercise scenarios the current suite doesn't cover.

### 4. Landscape-integrity isolation test

**Location:** `packages/api/src/modules/integration/__tests__/sync-failure-isolation.spec.ts` (**NEW**)

A single new file that exercises the end-to-end failure path through `StateService.syncFromAdapter()` and asserts the landscape is never corrupted by a failed sync.

```typescript
describe('syncFromAdapter failure isolation', () => {
  it('preserves prior landscape when REST sync fails', async () => {
    // 1. Load file-adapter tenant successfully
    const { stateService } = makeServices('stafford-engineering');
    await stateService.syncFromAdapter();
    const original = stateService.getLandscape();
    const originalTaskCount = original!.tasks.size();

    // 2. Switch to a REST tenant pointed at an unreachable URL
    const restServices = makeServices('stafford-engineering-test', {
      fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
    });

    // 3. Sync rejects
    await expect(restServices.stateService.syncFromAdapter()).rejects.toThrow();

    // 4. The file-adapter tenant's landscape is unchanged
    const preserved = stateService.getLandscape();
    expect(preserved).toBe(original);                          // same reference
    expect(preserved!.tasks.size()).toBe(originalTaskCount);   // same content
  });

  it('first-ever sync failure leaves getLandscape() null', async () => {
    const { stateService } = makeServices('stafford-engineering-test', {
      fetch: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
    });

    await expect(stateService.syncFromAdapter()).rejects.toThrow();
    expect(stateService.getLandscape()).toBeNull();
    expect(stateService.isLoaded()).toBe(false);
  });
});
```

---

## Error taxonomy (reference)

A compact reference for what each error looks like after this sprint — useful for log parsers, runbooks, and the UI's error-surface work.

| Error class | Example message | Retryable | `Error.cause` |
|---|---|---|---|
| HTTP 5xx | `HTTP 503 Service Unavailable fetching <url>` | ✅ | none |
| HTTP 4xx (perm) | `HTTP 401 Unauthorized fetching <url>` | ❌ | none |
| HTTP 408 / 429 | `HTTP 429 Too Many Requests fetching <url>` | ✅ | none |
| Timeout | `Timeout after 30000ms fetching <url>` | ✅ | `AbortError` |
| JSON parse | `Invalid JSON from <url>: Unexpected token ...` | ✅ (retry on bad response) | `SyntaxError` |
| Network | `fetch failed` (passed through unchanged) | ✅ | `TypeError` / system error |

Every error carries `.status` (where applicable) and `.retryable` (boolean) for programmatic inspection. Downstream error handlers (API response builder, UI toast) can use these flags without parsing messages.

---

## Testing Scenarios

### RestAdapter unit tests (`rest-adapter.spec.ts`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | HTTP 401 | Throws immediately. `fetch` called exactly **once**. Error message contains `401 Unauthorized` and the URL. |
| 2 | HTTP 403 | Same as #1 but with `403 Forbidden`. |
| 3 | HTTP 404 | Same fail-fast behavior — config error or missing endpoint. |
| 4 | HTTP 408 Request Timeout | **Does** retry (treated as transient). |
| 5 | HTTP 429 Too Many Requests | **Does** retry (treated as transient). |
| 6 | HTTP 500 (existing) | Retries, eventually throws with status 500. Regression guard. |
| 7 | Empty response body `{}` | Returns `[]` for that endpoint; the two other parallel endpoints unaffected. |
| 8 | Response body is `{"Result": null}` | Treated as empty — returns `[]`. No crash. |
| 9 | `response.json()` throws SyntaxError | Error message contains endpoint URL and `Invalid JSON`. Original `SyntaxError` preserved via `Error.cause`. Retried per policy. |
| 10 | Fetch timeout (AbortError) | Error message contains `Timeout after <N>ms` and the URL. Retried per policy. |
| 11 | Pagination mid-failure | Page 1 returns 2 records, page 2 fetch rejects. `fetchAllPages` throws. Returned payload does NOT include the page-1 records. |
| 12 | HTTP 500 first attempt, 200 second | Succeeds on retry. Existing behavior — regression guard. |

### Landscape-integrity isolation test (`sync-failure-isolation.spec.ts`)

| # | Scenario | Expected |
|---|----------|----------|
| 13 | Successful file sync, then REST sync against failing mock | `syncFromAdapter` rejects; `getLandscape()` returns the pre-existing file-adapter landscape unchanged (reference equality + task count assertion). |
| 14 | First-ever sync fails (no prior landscape) | `syncFromAdapter` rejects; `getLandscape()` returns `null`; `isLoaded()` is `false`. |

---

## Files Changed

| File | Change |
|------|--------|
| `packages/api/src/modules/integration/rest-adapter.ts` | **MODIFIED** — Non-retryable HTTP errors short-circuit retry. Timeout and JSON-parse errors wrapped with endpoint context. `.status` and `.retryable` surfaced as error properties. `Error.cause` preserves originals. ~20 LOC net. |
| `packages/api/src/modules/integration/__tests__/rest-adapter.spec.ts` | **MODIFIED** — Add scenarios 1–11. Existing tests (adapterType, envelope extraction, pagination, missing endpoint, HTTP 500, always-empty arrays) remain unchanged. |
| `packages/api/src/modules/integration/__tests__/sync-failure-isolation.spec.ts` | **NEW** — Scenarios 13–14, end-to-end via `StateService.syncFromAdapter()`. |

---

## Implementation Path

Single session, three checkpoints:

**Checkpoint 1 — Unit tests first (TDD).** Add scenarios 1–11 to `rest-adapter.spec.ts` against the unmodified adapter. Run the suite; note which new tests fail and how. This fixes the acceptance criteria in code before touching the implementation.

**Checkpoint 2 — Adapter changes.** Apply deliverables 1 and 2 to `rest-adapter.ts`. Rerun the suite. All 12 tests pass (11 new + 1 pre-existing HTTP 500). All other existing tests still pass.

**Checkpoint 3 — Isolation test.** Add `sync-failure-isolation.spec.ts`. This requires wiring up two tenants (one file-adapter, one REST-adapter) in the test harness — follow the existing pattern from `commitment-stack.spec.ts` + `sync-adapter.e2e.ts`. Verify both scenarios pass.

Verification gate before commit:

1. `rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine && npm run build --workspace=@ctp/api`
2. `npx vitest run` — all 917+ tests still pass; 13 new tests pass.
3. Manually: point a local tenant's `adapter.json` at a non-existent URL, hit `POST /v1/state/sync`, confirm the API response contains the endpoint URL and that the API log has a clean `cause`-chain stack.
4. Start the stack, trigger a sync with a mock returning `{}`, confirm the UI loads with no tasks/orders/resources and no uncaught client-side error.

---

## Stafford-Specific Notes

### First-week failure profile (predicted)

These are the three most likely live-API failures during the Stafford cutover week and how each is diagnosed post-sprint:

| Failure | Log line (post-sprint) | Planner action |
|---|---|---|
| VPN drops | `Timeout after 30000ms fetching https://genius.stafford.../salesOrderDetailEntity` | Reconnect VPN, retry sync |
| Genius credentials wrong | `HTTP 401 Unauthorized fetching https://genius.stafford.../salesOrderDetailEntity` (no retry spam) | Rotate credentials, retry |
| Genius restart / 5xx | `HTTP 503 Service Unavailable fetching ...` (after 3 retries) | Wait for Genius operator, retry |

### Log parsing

If Stafford operations stand up centralized log aggregation (Azure Log Analytics, Datadog), the error-class taxonomy above makes it trivial to build a dashboard: group by `.status`, show retries per attempt, alert when `retryable === false` count exceeds a threshold.

---

## Out of Scope

- **Fixture realism (hardening queue #1)** — separate sprint. Requires Stafford-provided payloads; will drive `mock-genius` fixture updates.
- **Mapping-engine edge cases (queue #2)** — separate sprint. Touches `mapping-engine.ts`, not the adapter. Specifically: NZ→UTC timezone handling, which is a stub today.
- **Large-payload perf (queue #4)** — separate sprint. Profiling + potential streaming changes.
- **Retry backoff strategy** — linear-with-multiplier stays. No exponential, no jitter.
- **Auth/credential plumbing** — how the REST adapter picks up tokens from the adapter config (or a vault reference) is a separate concern. The HTTP-401 test uses a stub regardless of how credentials are injected.
- **Circuit breaker / quarantine on repeated failures** — deferred until we have real operational data from Stafford.
- **Partial-success sync (`partialSyncAllowed: true`)** — adapter config schema (from the original Data Adapter design) mentions this, but it's not wired up in Phase 2 and this sprint doesn't add it. Today's behavior: any endpoint failure aborts the whole sync.

---

*This is the first of four planned sprints under the mock-genius hardening queue. Scope is deliberately narrow: surface the right errors at the right boundary, assert landscape integrity on failure, and add test coverage that a future maintainer would have to actively break to regress. No schema changes, no new code paths outside the adapter, no refactor of surrounding services.*
