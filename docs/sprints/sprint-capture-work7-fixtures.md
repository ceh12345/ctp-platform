# Sprint — Capture Full WORK7 Fixture Data from Genius

**Status:** ✅ Capture completed 2026-04-23 via direct curl path (Path C from session notes). Sprint now refocused on the adapter-side prereqs that were deferred so the captured fixture can drive end-to-end integration testing.
**Estimated effort:** 2.5-3 days (prereqs ~15-20h of dev, capture + verification ~1-2h operational — capture portion DONE)
**Prerequisites:** VPN access to Stafford, valid `WORK7` credentials (CompanyCode + Username + Password), service account preferred but not required for this capture
**Output:** Gitignored fixture set at `tools/mock-genius/recorded/stafford-work7-2026-04-23/` — 48 files, 15 MB, 4 endpoints, records exactly match Stafford-provided expected counts (77/474/956/3118)

---

## Goal

Capture one complete snapshot of all four Genius data endpoints from Stafford's WORK7 test environment, save as local fixtures for offline iteration and testing. Enables running the CTP adapter, mapping engine, and scheduling engine against real-scale, real-shape data without requiring VPN for every test cycle.

WORK7 is a frozen test environment. One capture is sufficient; no refresh strategy required.

---

## Findings surfaced during the 2026-04-23 capture

Three things the capture established that weren't previously known:

1. **Adapter pagination params are wrong for live Genius** (critical). `rest-adapter.ts:50`
   sends `?limit=X&pageIndex=N`; live Genius wants `?pageSize=X&pageNumber=N`. On Genius,
   `limit` is a *total-results cap* — so `limit=100` returns exactly 100 records with
   `TotalPagesFound=1`, and our adapter's pagination loop exits thinking it got everything.
   **The current RestAdapter would silently truncate every filtered endpoint's data to
   100 records against real Stafford.** Must be fixed in Prereq 1b (below) — previously
   scoped as just "filter params support," now expanded to include pagination param rename.

2. **Mock-genius wasn't catching this** because it accepts both param naming conventions
   (or ignores unrecognized ones and defaults to page 1). Consider adding a strict-mode
   flag to the mock that rejects unrecognized query params, so adapter bugs surface in
   CI rather than on first live call.

3. **Token format:** 36-char UUID with dashes (`8-4-4-4-12` hex), not the 32-char
   no-dash hex from the Swagger inline example. Privacy-grep patterns in recording-mode
   sanitization (Prereq 2) need to match UUID format specifically.

## Why this sprint exists

Today's mock fixtures are 10-40× smaller than real Stafford data. Real-scale data exposes bugs the mock can't:

- Pagination correctness across 30+ page fetches
- Memory pressure during full landscape construction
- Combinatorial explosion in the scheduler against realistic data
- Edge cases in real records (cancelled tasks with partial completion, cross-WO chains, etc.)

Without a local fixture, every test iteration requires VPN access — slow, constrained, outside our control.

---

## Scope — in

- Bearer-session auth support in RestAdapter
- Per-endpoint filter query parameter support in RestAdapter
- Mock-genius Bearer-auth simulation mode (for offline smoke test)
- Recording mode integration with Bearer auth + sanitization
- Capture playbook executed once on VPN
- Documentation of the resulting fixture set
- Verification of privacy hygiene (no tokens or passwords in saved files)

## Scope — out

- Any STAFFO (production) data capture — different rules apply
- Continuous / ongoing recording of live syncs — future observability work
- Full sanitization of captured data for public redistribution — derivative, not this sprint
- Delta-sync support — separate future sprint
- UI for browsing recorded fixtures — not needed
- Additional Genius endpoints beyond the four already in `stafford-engineering-test/integration/adapter.json`

---

## Prerequisites

Four prereqs, each independently testable. Total dev effort: 14-19h.

### Prereq 1: Bearer-session auth in RestAdapter

**Current state:** `adapter.json` accepts `auth: { type: "none" }`. `rest-adapter.ts` never sets an `Authorization` header.
**Target state:** Adapter supports `auth: { type: "bearer-session" }` with full login/logout lifecycle.

**Behavior:**

1. At adapter load, read credentials from **environment variables** resolved via config placeholder syntax (e.g., `${env:STAFFORD_PASSWORD}`). Fail startup loudly if any required env var is unset.
2. On first sync call, POST to `loginPath` with the credentials; extract token from the configured `tokenPath`.
3. Cache the token on the adapter instance for session duration.
4. Send `Authorization: Bearer <token>` on every subsequent data request.
5. On clean shutdown (NestJS `onModuleDestroy`), DELETE `logoutPath` with the current token. Best-effort only — crashes or `kill -9` won't fire this; Genius tokens expire server-side so a leaked in-memory token is low-risk.
6. On 401 mid-session: attempt one re-login and retry the original request; if the retry also 401s, fail loudly.

**Config shape (proposed):**

```json
{
  "auth": {
    "type": "bearer-session",
    "loginPath": "/api/auth",
    "logoutPath": "/api/auth",
    "credentials": {
      "CompanyCode": "${env:STAFFORD_COMPANY_CODE}",
      "Username": "${env:STAFFORD_USERNAME}",
      "Password": "${env:STAFFORD_PASSWORD}"
    },
    "tokenPath": "Result"
  }
}
```

**`tokenPath` verification step (important — must be done early in Prereq 1 dev):**
The Swagger at `/swagger/docs/v17.1.6.3` shows POST `/api/auth` returning a `RestResponse` wrapper. We don't yet know whether `Result` is the token string directly or `Result = { Token: "...", ... }`. The first live probe (a test login against WORK7) will reveal the actual shape. If it's nested, either the config extends to `tokenPath: "Result.Token"` with dotted-path resolution, or the default is a two-level `{ Result: { Token } }` assumption with a fallback to `Result` itself. Write the code to handle both by probing once.

**Security:**

- Credentials resolve from env vars at adapter-load time. Never from config file literal values. Never logged.
- If env var is unset, adapter startup fails with a clear error naming the missing var.
- Token is in-memory only, never persisted, never logged (scrub from error messages too).

**Tests:**

- Happy path: login, data fetch with Bearer header, logout. Mock-genius in bearer-auth mode (Prereq 3).
- Env var missing → startup fails with clear message naming the variable.
- Login 401 → startup fails with clear message, no token cached.
- Data fetch 401 mid-session → re-login attempted once; retry succeeds.
- Data fetch 401 twice → fails with clear message.
- Backwards compat: `auth: { type: "none" }` tenants continue to work unchanged.
- Token does not appear in any log output or error message.

**Estimated effort:** 6-8 hours.

### Prereq 1b: Pagination param rename + per-endpoint filter query parameters

**Current state:** `rest-adapter.ts:50` builds URLs as `?limit=X&pageIndex=N`. On live Genius:
- `limit` is a *total-results cap*, not a page size. Setting `limit=100` returns only 100
  records regardless of how many match the filter.
- `pageIndex` is not a recognized query param; Genius expects `pageNumber`.
- No filter support at all; adapter can't send `filter=...`.

**Target state:** Adapter builds URLs as `?pageSize=X&pageNumber=N[&filter=<encoded>]`.

**Config shape:**

```json
{
  "endpoints": {
    "workOrders":  { "path": "/workOrderWithAdvancedInformationViewEntity", "pageSize": 100, "filter": "Wostatus!=CLOSED" },
    "tasks":       { "path": "/productionTaskWithAdvancedInfoViewEntity",   "pageSize": 100, "filter": "IsCompleted=false" }
  }
}
```

**Behavior:**

1. URL construction swaps `limit` → `pageSize`, `pageIndex` → `pageNumber`
2. If an endpoint has a `filter` field, adapter URL-encodes it and appends as `&filter=<encoded>`
3. Filter applies to every page of that endpoint's pagination sweep
4. No filter → no `filter` query param sent (not an empty string)
5. Existing `pageSize` parameter in `adapter.json` is already named `pageSize` in the
   config — only the URL param name it generates needs to change

**Tests:**

- URL construction matches `?pageSize=X&pageNumber=N` (regression target)
- Endpoint with filter → fetch URL contains the encoded filter on every page
- Endpoint without filter → fetch URL omits filter param
- Filter special characters encode correctly (`!=`, spaces, quotes)
- Mock-genius tests pass against new URL shape (mock accepts both old and new;
  consider adding strict-mode check so any future param drift fails loudly)
- Verification against captured fixture: pointing adapter at a local replay should
  fetch the full 3,118-task dataset, not the old 100-record cap

**Estimated effort:** 3-4 hours (unchanged; slightly smaller if pagination param
change lands first as a two-line edit).

**Regression risk:** Every currently-passing REST adapter test exercises the old URL
shape (`?limit=X&pageIndex=N`). Mock-genius is tolerant, so tests will pass after the
param rename too — but any test asserting on the *exact* URL string in
`rest-adapter.spec.ts` needs updating. Grep for `pageIndex` and `limit=` before merging.

### Prereq 2: Recording mode supports Bearer-authed upstream with sanitization

**Current state:** Recording mode in `tools/mock-genius/src/recording.ts` forwards requests transparently. No auth handling, no response-body sanitization.
**Target state:** Recording mode forwards Bearer credentials to upstream, and sanitizes sensitive fields in the saved artifacts.

**Behavior:**

1. Recording proxy accepts the adapter's `Authorization: Bearer <token>` header and forwards to upstream unchanged
2. When saving the recorded response to disk, **strip** the `Authorization` header from any saved request metadata
3. When saving the recorded **request body for login calls** (POST to `/api/auth`): replace the `Password` field value with `"[REDACTED]"`
4. When saving the recorded **response body for login calls**: replace the token value (wherever it sits in `Result`) with `"[REDACTED-TOKEN]"`
5. All other data (request bodies to data endpoints, response bodies of data endpoints) passes through unchanged
6. `_metadata.json` documents which fields were sanitized, for audit

**Routing to save locations:**
- Data endpoints (the four Genius entities) save per the existing layout: `{entity}.json` or `{entity}_pageN.json` flat in the session dir
- Auth endpoint saves to a distinct path: `api-auth-login.json` and `api-auth-logout.json` at the session dir root (flat — no `/auth/` subdir)

**Tests:**

- Authorization header is forwarded upstream but not saved to disk
- Password is redacted in saved login request body
- Token is redacted in saved auth response body
- Data request/response bodies unchanged after recording
- Backwards compat: existing recording tests (no-auth upstreams) still pass

**Estimated effort:** 3-4 hours.

### Prereq 3: Mock-genius Bearer-auth simulation mode

**Current state:** Mock-genius has no auth layer. All endpoints open.
**Target state:** Optional Bearer-auth mode for smoke-testing Prereq 1 + 2 offline.

**Behavior:**

1. Env var `MOCK_REQUIRE_AUTH=bearer` enables auth mode
2. When enabled, mock exposes `POST /api/auth` (returns a fake token in `Result`) and `DELETE /api/auth` (returns `{Result: true}`)
3. When enabled, all data endpoints require `Authorization: Bearer <token>` — missing or invalid token returns Genius-shape 401 `InvalidSession`
4. Token value is accepted if it matches what mock handed out during login
5. Existing `auth: none` default mode is unchanged

**Tests:**

- Default mode: data endpoints accessible without auth (existing behavior)
- Bearer mode: data endpoints without token return 401 with Genius envelope
- Bearer mode: login returns a token that's accepted on subsequent data requests
- Bearer mode: logout invalidates the token; subsequent requests 401

**Estimated effort:** 2-3 hours.

---

## The capture playbook

Run when all prereqs complete and VPN is available. **This is the actual data capture — do it once, carefully.**

### Step 0: Pre-flight (offline, ~10 min)

1. Confirm `tools/mock-genius/.gitignore` includes `recorded/` (it already does; verify).
2. Confirm the target output subdirectory will land under `tools/mock-genius/recorded/stafford-work7-{YYYY-MM-DD}/` (the default path when `MOCK_RECORD_DIR` is unset; a custom value also lands under the same gitignore if it's a relative path inside the mock-genius tree).
3. Set env vars in the capture terminal session:
   ```bash
   export STAFFORD_COMPANY_CODE=WORK7
   export STAFFORD_USERNAME={genius-username-from-stafford}
   export STAFFORD_PASSWORD={password}
   export MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215
   # MOCK_RECORD_DIR can be left unset — defaults to tools/mock-genius/recorded
   ```
4. Courtesy email to the Stafford contact: "Doing a one-time fixture capture from WORK7 today around {time}. About 15 minutes of VPN traffic, no writes, just paginated reads. Let me know if any concerns."
5. Have the capture metadata template ready in a scratch file to fill in during Step 5.

### Step 1: Smoke test against bearer-mode mock (offline, ~5 min)

Before pointing at real Genius, confirm the full stack (Prereqs 1, 1b, 2, 3) works against a local mock in Bearer mode:

1. Start mock-genius with `MOCK_REQUIRE_AUTH=bearer npm run dev`
2. Configure a test tenant pointed at `http://localhost:8080` with `auth.type: "bearer-session"` and dummy env var values
3. Run a sync
4. Verify:
   - Login recorded under `tools/mock-genius/recorded/{timestamp}/api-auth-login.json` with `[REDACTED]` password
   - Data fetches succeeded with Bearer token attached
   - Logout recorded under `api-auth-logout.json`
   - `grep -r "Bearer " tools/mock-genius/recorded/{timestamp}/` returns nothing
   - `grep -r "12345" tools/mock-genius/recorded/{timestamp}/` (or whatever the dummy password was) returns nothing
5. If any verification fails, fix before going to VPN.

### Step 2: Connect and authenticate against live Genius (on VPN, ~5 min)

1. Connect VPN. Confirm `curl -s https://genius.stafford.co.nz:53215/api/configuration/companies` returns 200 (host reachable, TLS fine, unauth endpoint responsive).
2. Stop and restart mock-genius in recording mode pointed at live Genius: `MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 npm run dev` (no `MOCK_REQUIRE_AUTH` — we're now proxying, not simulating).
3. Trigger adapter sync with `auth: bearer-session` — just the login step, no data fetches yet. The cleanest invocation is a dedicated CLI command (say, a `npm run capture-login --workspace=@ctp/api -- --tenant=work7-capture`) that logs in, records the response, and exits without a full sync. Until such a command exists, trigger by calling `/v1/state/sync` against a tenant whose adapter.json has all four endpoint paths commented out — login will still fire.
4. Verify:
   - `api-auth-login.json` exists in the recording session dir
   - Token field is `[REDACTED-TOKEN]` (not the actual hex token)
   - Response status 200, `Result` populated (with redacted content)
   - **Inspect the upstream response shape** to confirm `tokenPath` assumed in Prereq 1 is correct. If the actual shape differs from what was coded, adjust config and re-test before proceeding.
5. If anything looks wrong, stop and debug. Don't proceed to data fetches on a misconfigured login.

### Step 3: Capture each endpoint (on VPN, ~10 min)

For each of the four endpoints, trigger the adapter sync with the specified filter. Adapter walks pagination automatically; recording proxy saves each page.

| Endpoint | Filter | Approximate records (verify live) |
|---|---|---|
| `machineAndRessourceEntity` | (none) | small, ~1 page |
| `salesOrderDetailEntity` | `ItemStatus!=C` | a few hundred, ~5 pages |
| `workOrderWithAdvancedInformationViewEntity` | `Wostatus!=CLOSED` | ~1k, ~10 pages |
| `productionTaskWithAdvancedInfoViewEntity` | `IsCompleted=false` | several thousand, ~30+ pages |

Expected counts above are rough estimates provided for sanity-check, not hard targets. **Trust `PagingInfos.TotalElementsFound` in the first page of each endpoint as the authoritative count; verification in Step 7 compares against that, not against the numbers in this table.**

Filter field names must match Genius's exact expected casing — verify against Swagger's per-endpoint query param definitions before running. For example, `Wostatus` (lowercase `s`) and `WoStatusCode` (Pascal) are different fields on different entities; don't assume consistency.

### Step 4: Capture status-variety samples (on VPN, ~5 min, optional)

Also capture a small sample per endpoint with a different filter to get status variety for edge-case testing:

| Endpoint | Filter | Purpose |
|---|---|---|
| `machineAndRessourceEntity` | `Active=false` (pageSize=50) | inactive resources, if any |
| `salesOrderDetailEntity` | `ItemStatus=C` (pageSize=50) | closed lines |
| `workOrderWithAdvancedInformationViewEntity` | `Wostatus=CLOSED` (pageSize=50) | closed WOs |
| `productionTaskWithAdvancedInfoViewEntity` | `WoStatusCode=CANCELLED` (pageSize=50) | cancelled tasks |

Save these to a separate recording session so they don't mix with the primary fixture. These exist for "what happens when a closed WO hits the scheduler" style tests. **Skip this step if time-constrained** — the primary fixtures are the must-have; variety samples are nice-to-have.

### Step 5: Write capture metadata (on VPN or right after, ~15 min)

Create `{output}/_capture-metadata.json`:

```json
{
  "capturedAt": "2026-04-XX",
  "capturedBy": "{your-name}",
  "environment": "WORK7 (Stafford Engineering development test environment)",
  "baseUrl": "https://genius.stafford.co.nz:53215",
  "geniusVersion": "17.1.6.3",
  "captureTool": "mock-genius recording mode",
  "primaryFixtures": {
    "machineAndRessourceEntity": {
      "filter": null,
      "recordsAsReportedByPagingInfos": "{fill in}",
      "recordsInSavedFiles": "{fill in}",
      "pages": "{fill in}"
    },
    "salesOrderDetailEntity": {
      "filter": "ItemStatus!=C",
      "recordsAsReportedByPagingInfos": "{fill in}",
      "recordsInSavedFiles": "{fill in}",
      "pages": "{fill in}"
    },
    "workOrderWithAdvancedInformationViewEntity": {
      "filter": "Wostatus!=CLOSED",
      "recordsAsReportedByPagingInfos": "{fill in}",
      "recordsInSavedFiles": "{fill in}",
      "pages": "{fill in}"
    },
    "productionTaskWithAdvancedInfoViewEntity": {
      "filter": "IsCompleted=false",
      "recordsAsReportedByPagingInfos": "{fill in}",
      "recordsInSavedFiles": "{fill in}",
      "pages": "{fill in}"
    }
  },
  "anomaliesObserved": [
    "{free-form notes on anything surprising — unexpected field values, null fields you weren't expecting, records with strange shapes, etc.}"
  ],
  "sanitization": {
    "authorizationHeaders": "stripped from all saved files",
    "passwords": "redacted in login request body",
    "tokens": "redacted in auth response body",
    "auditTrail": "see _metadata.json produced by recording mode"
  }
}
```

### Step 6: Logout (on VPN, ~2 min)

1. Trigger adapter clean shutdown (ideally via the capture CLI command mentioned in Step 2, which ends with a logout call). If no CLI exists yet, issue a `DELETE /api/auth` manually via curl with the active Bearer token.
2. Verify `api-auth-logout.json` saved with redacted token
3. Verify response `Result: true` indicating successful invalidation server-side
4. Disconnect VPN

### Step 7: Verify the capture (offline, ~10 min)

Before trusting the capture:

1. **Record counts match PagingInfos:**
   ```bash
   # First page shows total
   jq '.PagingInfos.TotalElementsFound' tools/mock-genius/recorded/.../salesOrderDetailEntity_page1.json
   # Sum across pages
   find tools/mock-genius/recorded/.../ -name 'salesOrderDetailEntity*.json' -exec jq '.Result | length' {} \; | awk '{s+=$1} END {print s}'
   ```
   Compare. Repeat for each endpoint.

2. **Envelope structure intact:**
   ```bash
   jq '{ResultType: (.Result | type), ResultLen: (.Result | length), Messages, PagingInfos}' tools/mock-genius/recorded/.../{some-file}.json
   ```
   Should show Array / non-zero length / empty Messages / valid PagingInfos.

3. **Privacy hygiene — all three must return zero matches:**
   ```bash
   CAPTURE=tools/mock-genius/recorded/stafford-work7-{date}

   # Any Authorization: Bearer headers accidentally saved?
   grep -r "Bearer " $CAPTURE

   # Any password material saved?
   grep -r "${STAFFORD_PASSWORD}" $CAPTURE

   # Any hex tokens saved? (Genius tokens are 32-char hex like eaa61c7241bd4cc9449fa25bb4e57ff1)
   grep -rE '"Result"\s*:\s*"[a-f0-9]{32}"' $CAPTURE
   ```
   If any of these returns matches, **sanitization failed** — delete the capture, fix the bug in Prereq 2, re-run.

### Step 8: Document the fixture (offline, ~15 min)

Create `tools/mock-genius/recorded/stafford-work7-{date}/README.md` (same directory as the capture):

```markdown
# Stafford WORK7 Fixture Capture — {date}

## What this is

One-time snapshot of all four Genius data endpoints from Stafford's WORK7 dev environment.
Captured via mock-genius recording mode + RestAdapter with Bearer-session auth.

WORK7 is a frozen test environment. This snapshot represents its state on the capture
date; no future updates expected.

## Scale (actual, not estimated)

| Endpoint | Filter | Records | Pages |
|---|---|---|---|
| machineAndRessourceEntity | (none) | {actual} | {actual} |
| salesOrderDetailEntity | ItemStatus!=C | {actual} | {actual} |
| workOrderWithAdvancedInformationViewEntity | Wostatus!=CLOSED | {actual} | {actual} |
| productionTaskWithAdvancedInfoViewEntity | IsCompleted=false | {actual} | {actual} |

## Known interesting records (populate during verification)

{e.g., "Task Id 5585: cancelled task with IsCompleted=true and 75% hours consumed — good edge case for testing cancellation handling"}

## How to use

Point RestAdapter (or mock-genius replay mode) at this directory for offline development.
For mock-genius replay: `MOCK_SCENARIO=stafford-work7-{date} npm run dev` (after promoting
via `strip-envelope.js` if envelope stripping is needed for your use case).

## What's NOT captured

- STAFFO (production) data — different rules, not this sprint
- Genius endpoints beyond the four in adapter.json (strategies, calendars, customers) — not needed yet
- Optimized field selection — we pulled all fields (future adapter-level optimization)

## Sanitization status

- Authorization headers: stripped
- Passwords: redacted in login body
- Tokens: redacted in auth response body
- Real customer data: **present**. WORK7 is a test environment but uses real historical
  customer names. **Do not commit. Do not share publicly.**
```

---

## Acceptance criteria

### Prereq 1: Bearer-session auth
- [ ] `auth: { type: "bearer-session" }` tenant logs in, fetches data, logs out against mock-genius in Bearer mode
- [ ] Token never appears in logs, disk files, or error messages
- [ ] Missing env var causes clean startup failure with clear error naming the var
- [ ] Mid-session 401 triggers one re-login retry; second 401 fails cleanly
- [ ] `auth: { type: "none" }` tenants unchanged (regression gate)

### Prereq 1b: Filter params
- [ ] Endpoint with `filter` config sends `&filter=<encoded>` on every page
- [ ] Endpoint without filter sends no filter param (regression gate)
- [ ] Special characters (`!=`, spaces, `=`) encode correctly

### Prereq 2: Recording mode
- [ ] Bearer token forwarded upstream correctly
- [ ] Authorization header stripped from all saved files
- [ ] Password redacted in saved login request body
- [ ] Token redacted in saved auth response body
- [ ] Existing no-auth recording tests unchanged

### Prereq 3: Mock Bearer mode
- [ ] `MOCK_REQUIRE_AUTH=bearer` blocks unauthenticated data requests
- [ ] `POST /api/auth` returns usable token; subsequent requests with that token succeed
- [ ] Existing default-mode tests unchanged

### Capture execution
- [ ] Smoke test against mock Bearer mode passes end-to-end
- [ ] Courtesy email sent to Stafford contact
- [ ] All four primary endpoints captured with correct filters
- [ ] Token shape assumption (`tokenPath`) verified against real response in Step 2
- [ ] Capture metadata file populated with real numbers (not estimates)
- [ ] Logout completed cleanly; VPN disconnected

### Verification
- [ ] Record counts match `PagingInfos.TotalElementsFound` for each endpoint
- [ ] Envelope structure intact on random samples
- [ ] All three privacy-hygiene greps return zero matches
- [ ] README.md present and accurate with actual numbers

### Integration follow-up
- [ ] RestAdapter pointed at the fixture directory produces the same landscape shape as live
- [ ] At least one end-to-end test (adapter → mapping → landscape → solve) runs successfully against the fixture
- [ ] Any bugs surfaced by real-scale data are logged as tickets (not fixed in this sprint)

---

## Risks and mitigations

### Network hiccup mid-capture
~40 pages total is a lot of requests. If page 23 fails, capture is partial.

**Mitigation:** Adapter retries individual page requests with exponential backoff (existing behavior in `rest-adapter.ts:fetchWithRetry`). Full re-capture preferred over manual resume — 10 minutes of VPN time is cheap vs. debugging partial state.

### Token expiration mid-capture
If Genius tokens expire quickly and capture runs long, 401 mid-sweep.

**Mitigation:** Prereq 1 includes one automatic re-login on 401. Tested explicitly.

### `tokenPath` assumption wrong
We haven't seen a real 200 response from `/api/auth` yet. Swagger shows a `RestResponse` wrapper; the Bearer token could be at `Result` (string) or `Result.Token` (nested object).

**Mitigation:** Step 2 verifies the actual shape before Step 3 data fetches. If wrong, adjust config and re-test login-only before burning VPN time on data capture. Adapter should log the response structure (not the token value) to aid debugging.

### Stafford blocks or throttles the traffic pattern
Unusual for small ERP but possible with rate limits or anomaly detection.

**Mitigation:** Courtesy email (Step 0.4). Cap `pageSize` at 100. Don't parallelize endpoint fetches during capture — serial is fine given 10-15 min total duration.

### Captured data leaks via commit or log
Real customer names in WORK7 (Fisher & Paykel etc.) shouldn't appear in public repos or chat.

**Mitigation:**
- `tools/mock-genius/recorded/` gitignored (verified in Step 0)
- Privacy-grep in Step 7 catches accidental Bearer/password/token inclusion
- README.md in capture directory explicitly states "don't commit or share"
- For any future public-fixture derivative: separate sanitization sprint

### Recording proxy + Bearer auth first use
Prereq 2 is exercised for the first time during this capture. Bugs possible.

**Mitigation:** Step 1 smoke test against mock-Bearer-mode catches most issues. If the live capture fails in a non-obvious way, disconnect VPN, debug offline, re-run. Don't burn VPN time debugging.

### No service account yet (using `chrish` or a human account)
Best practice is a dedicated `CTP_INTEGRATION` service account. If Stafford hasn't provisioned one, we may use a human login for initial capture.

**Mitigation:** Capture is read-only, low-volume, and happens once. Using a human login for one 15-minute capture is acceptable. **Do not ship** with human credentials wired into production adapter config — block that until service account lands.

---

## Definition of done

1. Prereqs 1, 1b, 2, 3 merged and tested
2. Capture executed against WORK7, all four endpoints recorded with correct filters
3. All seven verification checks pass (3 data checks + 3 privacy greps + README populated)
4. At least one adapter end-to-end test runs successfully against the captured fixtures
5. Bugs surfaced by real-scale data logged (not fixed) in the bug tracker

---

## Out of scope — flagged for future sprints

- **Delta sync** — separate design work, not yet specced
- **STAFFO (production) capture discipline** — different retention + sanitization rules
- **Sanitized public fixtures** — derivative artifact, not primary goal
- **Additional Genius endpoints** (strategies, calendars, customers) — as-needed basis
- **Field selection / payload optimization** — future adapter work
- **RestAdapter full config-drivenness** (envelope + pagination shape) — separate sprint only relevant for non-Genius tenants; not blocking Stafford

---

*Revised 2026-04-21 after codebase calibration. The four prereqs reflect what's actually missing in the current adapter + mock code, not aspirational abstractions. Execute when fresh; don't start the VPN-on portion at end of day.*
