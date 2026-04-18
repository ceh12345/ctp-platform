# Sprint: Mock Genius Server — Recording Mode

**Status:** 📋 Ready
**Size:** ~2-3 hours CC work (Session 1: proxy + capture + metadata, Session 2: strip-envelope helper + tests)
**Depends on:** Mock Genius Server sprint (Phases 1 and 2 — skeleton, fixtures, and failure injection)
**Triggered by:** Stafford Genius dev API access is imminent. Without recording mode, integrating against the real API means developing online over VPN with no way to snapshot reality. With recording mode, one VPN session captures a complete reference dataset that every subsequent debug session can replay against offline.

---

## Problem

We're about to get visibility into the real Stafford Genius API. Without a recording mechanism, the integration workflow looks like this:

- Connect to VPN every development session
- Hit the live API while debugging mapping bugs
- Rely on memory or notes for "what did that response look like yesterday"
- Never reproduce a specific failure more than once, because the data moves
- CI can't test against real data because GitHub Actions can't reach Stafford's network

With recording mode, the workflow becomes:

- One 15-minute VPN session captures every endpoint to disk
- All subsequent development runs offline against the captured snapshot
- Bug reproduction is deterministic — the response that caused the bug is a file
- CI runs against the same snapshots developers use locally
- Re-capture on a schedule (weekly, monthly) to catch real-API drift

This is a standard integration pattern called **consumer-driven contract testing with recorded fixtures**. Similar to what tools like WireMock, Pact, or VCR/Polly provide in other ecosystems — bespoke here because Genius's envelope format benefits from a format-aware recorder, and because a solo developer doesn't need the overhead of a generic contract library.

---

## Design

### Core Principle

When configured with `MOCK_RECORD_FROM=<upstream-url>`, the mock stops serving fixtures and starts acting as a transparent proxy. Every request to a Genius endpoint is forwarded upstream with auth headers added, the response is captured to disk, and the response is returned unchanged to the caller.

The caller (the RestAdapter) has no idea it's talking to a proxy. It sees real Genius responses. Meanwhile, the mock is quietly building a snapshot of every endpoint that gets hit.

### Mode exclusivity

Recording mode and fixture-serving mode are mutually exclusive. If `MOCK_RECORD_FROM` is set at startup, the mock enters recording mode for its entire lifetime. Failure injection is disabled — we're capturing reality, not simulating failures. Fixture loading is skipped — the upstream is authoritative.

This is intentional. Mixing modes (some endpoints proxied, some fixture-served) makes the captured snapshot incomplete in subtle ways. Either record everything or record nothing.

### What gets captured

The **raw upstream response body**, unmodified. This includes the full Genius envelope `{ Result, Messages, PagingInfos, Tag }`, not just the extracted `Result` array. The reason is verification: we want to be able to confirm our envelope unwrapping logic handles what the real API actually sends, not our interpretation of it.

Fixture files in `stafford-clean` contain just the array (the mock wraps them at serve time). Recorded files contain the full envelope. A helper script (`strip-envelope.js`) converts recordings into fixture format when you're ready to promote a capture.

---

## Deliverables

### 1. recording.ts — the proxy and capture logic

**Location:** `tools/mock-genius/src/recording.ts` (**NEW** — this file does not exist yet; the original mock sprint planned a placeholder but we consolidated code into `server.ts`)

```typescript
interface RecordingConfig {
  upstreamUrl: string;        // from MOCK_RECORD_FROM
  recordDir: string;          // from MOCK_RECORD_DIR, default "./recorded"
  authUser?: string;          // from MOCK_RECORD_AUTH_USER
  authPass?: string;          // from MOCK_RECORD_AUTH_PASS
  timeoutMs: number;          // from MOCK_RECORD_TIMEOUT, default 60000
}

interface CaptureMetadata {
  capturedAt: string;
  upstreamUrl: string;
  endpoints: Record<string, EndpointCapture>;
  errors: CaptureError[];
}

interface EndpointCapture {
  status: number;
  recordCount: number;
  pages: number;
  queryParams: Record<string, string>;
  durationMs: number;
}

interface CaptureError {
  endpoint: string;
  message: string;
  status?: number;
}
```

### 2. Proxy behavior

For each request to a Genius endpoint:

1. Construct the upstream URL: `{upstreamUrl}{request.path}?{request.query}`
2. Add basic auth header if `authUser` and `authPass` are configured
3. Copy the original request method and query parameters through
4. Send with timeout
5. On response: save body to disk, write metadata, return to caller with same status, headers, and body
6. On upstream failure (network, timeout, 5xx): save the error response if there is one, return 502 to caller with a clear error message

The proxy is **stateless across requests** — each request is an independent operation. If the upstream returns an error for one endpoint, the other endpoints can still succeed.

### 3. Directory structure

Captured responses go to `MOCK_RECORD_DIR` (default `./recorded/`), organized by capture session:

```
recorded/
  2026-04-18T14-30-00/                      # timestamp at mock startup, not per-request
    salesOrderDetailEntity.json             # full envelope
    workOrderWithAdvancedInformationViewEntity.json
    productionTaskWithAdvancedInfoViewEntity.json
    machineAndRessourceEntity.json
    _metadata.json                          # capture metadata
```

The timestamp is fixed at mock startup, not per-request. This means **one session = one recording directory**. If you want a fresh capture, restart the mock.

Pagination: if an endpoint returns `TotalPagesFound > 1`, save each page as `{entity}_page{N}.json`. The metadata records which pages were captured and the total record count across pages.

Colons in the timestamp are replaced with dashes so the directory works on all filesystems (Windows doesn't allow `:` in filenames).

### 4. _metadata.json shape

```json
{
  "capturedAt": "2026-04-18T14:30:00.000Z",
  "upstreamUrl": "https://genius.stafford.co.nz:53215",
  "endpoints": {
    "salesOrderDetailEntity": {
      "status": 200,
      "recordCount": 15,
      "pages": 1,
      "queryParams": { "filter": "WoStatusCode!=\"CLOSED\"" },
      "durationMs": 412
    },
    "machineAndRessourceEntity": {
      "status": 200,
      "recordCount": 28,
      "pages": 1,
      "queryParams": { "filter": "Active=true" },
      "durationMs": 187
    }
  },
  "errors": []
}
```

Written at mock shutdown, or updated incrementally as each endpoint completes. Incremental is safer — if the mock crashes mid-capture, you still have partial metadata for the endpoints that finished.

### 5. Error handling during recording

| Condition | Behavior |
|-----------|----------|
| Upstream unreachable (DNS, connection refused) | Return 502 to caller with message "Recording mode: upstream unreachable at {url}. Check VPN connection and MOCK_RECORD_FROM." Record the error in `_metadata.json`. |
| Upstream returns error (401, 500, etc.) | Save the error response body to disk. Return the same status and body to the caller. Record status and recordCount: 0 in metadata. |
| Upstream timeout (exceeds `MOCK_RECORD_TIMEOUT`) | Return 504 to caller. Record error in metadata. Do not write a response file. |
| Disk write fails (permissions, full disk) | Log the error but return the upstream response to caller. Recording failure should never block the proxy. Record the error in metadata if possible. |
| Upstream returns malformed JSON | Save the raw body as-is. Record the parse failure in metadata but don't fail the request — the caller may still want to see what came back. |

**The guiding principle:** capture as much of reality as possible. Errors are part of reality. The whole point of recording is to be able to replay production failures, so don't swallow them.

### 6. Interaction with control endpoints

| Endpoint | Recording mode behavior |
|----------|------------------------|
| `/_mock/health` | Returns 200 from the mock itself. Does NOT proxy. This is the mock's own health, not the upstream's. |
| `/_mock/state` | Returns `{ mode: "recording", upstreamUrl, recordDir, capturedEndpoints: [...], errors: [...] }`. Useful for checking what's been captured so far. |
| `/_mock/scenario` | Returns 409 Conflict with message "Scenario switching is disabled in recording mode." |
| `/_mock/inject-failure` | Returns 409 Conflict with message "Failure injection is disabled in recording mode." |
| `/_mock/reset` | Clears the in-memory capture tracking but does not delete disk files. Useful if you want fresh metadata without restarting. |

### 7. Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_RECORD_FROM` | (unset) | Upstream URL. If set, enables recording mode for the whole session. |
| `MOCK_RECORD_DIR` | `./recorded` | Where to save captured responses. |
| `MOCK_RECORD_AUTH_USER` | (unset) | Basic auth username for upstream. |
| `MOCK_RECORD_AUTH_PASS` | (unset) | Basic auth password for upstream. |
| `MOCK_RECORD_TIMEOUT` | `60000` | Upstream request timeout in milliseconds. Real Genius can be slow — 60s is the floor, not the ceiling. |

All other `MOCK_*` variables (scenario, fixtures dir, auth for the mock itself) are ignored when recording mode is active.

### 8. strip-envelope.js helper script

**Location:** `tools/mock-genius/scripts/strip-envelope.js`

After capturing, the developer manually promotes a recording into a fixture scenario:

```bash
# Copy the raw capture into a named scenario
cp -r recorded/2026-04-18T14-30-00/ fixtures/stafford-snapshot-april-18/

# Extract the Result arrays (strip the envelope)
node tools/mock-genius/scripts/strip-envelope.js fixtures/stafford-snapshot-april-18/

# Now the scenario is ready to serve
MOCK_SCENARIO=stafford-snapshot-april-18 npm start
```

The script:

1. Reads each `.json` file in the target directory (skip `_metadata.json`)
2. If the content is `{ Result: [...], ... }`, replace the file content with just the `Result` array
3. If the content is already an array (e.g. a hand-edited fixture), leave it alone
4. Log what it did: `"salesOrderDetailEntity.json: 15 records extracted"`
5. Preserve `_metadata.json` — it stays as reference for what was captured

Idempotent: running it twice on the same directory does nothing the second time.

### 9. Startup logging

When the mock starts in recording mode, log clearly and loudly:

```
Mock Genius Server
Mode: RECORDING
Upstream: https://genius.stafford.co.nz:53215
Record dir: ./recorded/2026-04-18T14-30-00/
Auth: basic (user: greg)
Timeout: 60000ms

Failure injection: DISABLED
Fixture loading: DISABLED

Listening on :8080
```

The developer should have zero ambiguity about what mode they're in. "Wait, am I recording or serving fixtures?" has to be answerable in one glance at the terminal.

---

## Migration Path

### Phase A: Proxy + capture

- Implement the HTTP proxy logic in `recording.ts`
- Integrate it into the four Genius route handlers — when recording mode is active, delegate to the proxy instead of the fixture server
- Handle auth header injection
- Handle timeouts and upstream errors
- Write captured response bodies to disk as raw files (no metadata yet)
- Verify locally against any public HTTP API (e.g., `https://httpbin.org`) without needing real Genius access

### Phase B: Metadata and pagination

- Build `_metadata.json` construction, updating it incrementally as each endpoint completes
- Add pagination handling — multi-page responses saved as `_page1.json`, `_page2.json`, etc.
- Update `/_mock/state` to include recording mode status

### Phase C: strip-envelope helper and tests

- Write `strip-envelope.js`
- Write the test suite (see section below)
- Verify end-to-end: start a tiny canned-response HTTP server in the test, point `MOCK_RECORD_FROM` at it, trigger requests, verify files land on disk correctly

---

## Testing

The mock's existing test suite (`tools/mock-genius/tests/mock.test.ts`) gets new cases for recording mode. Proxy tests cannot hit real Genius from CI, so use a canned-response test server spun up inside the test itself.

| # | Test | What to verify |
|---|------|----------------|
| 1 | Recording mode enables | With `MOCK_RECORD_FROM` set, the mock logs recording mode and skips fixture loading |
| 2 | Request is proxied | A request to the mock triggers a request to the test upstream |
| 3 | Auth headers added | Upstream receives basic auth header when `MOCK_RECORD_AUTH_USER/PASS` are set |
| 4 | Response body saved | After the request, the response body exists at `{recordDir}/{endpoint}.json` |
| 5 | Full envelope captured | The saved file contains `{ Result, Messages, PagingInfos }`, not just the array |
| 6 | Metadata written | `_metadata.json` exists with correct status, recordCount, queryParams |
| 7 | Upstream 500 captured | A 500 response from upstream is saved to disk AND returned to caller |
| 8 | Upstream 401 captured | A 401 is saved AND returned (auth errors are real data) |
| 9 | Upstream unreachable | Caller gets 502 with a clear error message, metadata records the error |
| 10 | Upstream timeout | Caller gets 504 after `MOCK_RECORD_TIMEOUT` expires |
| 11 | Disk write failure tolerated | If disk write fails, caller still gets the upstream response |
| 12 | Pagination | Multi-page upstream responses saved as separate `_pageN.json` files |
| 13 | `/_mock/health` doesn't proxy | Returns the mock's own health, never hits upstream |
| 14 | `/_mock/inject-failure` rejected | Returns 409 in recording mode |
| 15 | `/_mock/state` reports recording mode | Includes `mode: "recording"`, upstream URL, captured endpoints |
| 16 | strip-envelope extracts correctly | Running the script on a captured directory produces fixture-format files |
| 17 | strip-envelope is idempotent | Running twice produces the same result as running once |
| 18 | strip-envelope preserves non-envelope files | Hand-edited arrays are left alone |

---

## Sensitive Data and Committed Fixtures

Raw recordings from Stafford will contain customer names, pricing, internal codes, WIP notes — all potentially sensitive. Raw captures must never land in version control.

### Gitignore the raw capture directory

Add to `tools/mock-genius/.gitignore`:

```
# Raw recordings contain customer-identifying data; promoted/sanitized
# derivatives live under fixtures/ and are committed, not these.
recorded/
```

### Promotion is the sanitization gate

The workflow has four distinct stages, each with a different privacy posture:

| Stage | Location | In git? | Sensitive data? |
|---|---|---|---|
| Raw capture | `recorded/{session}/` | **No** (gitignored) | Yes — as-is from Genius |
| Copy for promotion | `fixtures/stafford-snapshot-{date}/` | **No** until sanitized | Yes — identical to raw |
| Sanitize in place | same path | **No** during this step | Partially — being scrubbed |
| Committed fixture | same path | **Yes** | No — customer data replaced with `CustomerA`/`CustomerB`, prices redacted |

**Do not `git add` a promoted scenario until sanitization is complete.** A pre-commit hook that grep-blocks common sensitive patterns (known customer names, price fields) is a future enhancement.

### What sanitization actually does

Out of scope for this sprint — but the minimum viable pass is:

- Replace customer names (`CustomerName`, `ShipToName`, etc.) with sequential aliases `CustomerA`, `CustomerB`, …
- Redact numeric price/cost fields (`UnitPrice`, `HourlyRate` on labor records, `MaterialCost`) with obvious placeholder values like `0` or `999`
- Keep all IDs, codes, dates, quantities, chain relationships intact — these are the interesting shape for CTP and do not leak
- Leave `_metadata.json` alone — it's derived and doesn't contain sensitive field values

A dedicated sanitization helper script is a separate sprint. For the first Stafford capture, hand-editing the four JSON files is acceptable.

### Why this matters for beta specifically

Stafford is a beta partner, not a production customer yet. They will forgive a bug; they will not forgive their pricing or customer list landing on GitHub. Treat every raw capture as radioactive until reviewed.

---

## Configuration

### Example: local recording session

```bash
cd tools/mock-genius

# Start in recording mode pointed at Stafford's dev API
MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 \
MOCK_RECORD_AUTH_USER=greg \
MOCK_RECORD_AUTH_PASS=*** \
npm start

# In another terminal, trigger a sync through the CTP API
# The RestAdapter hits the mock, mock hits real Genius, responses land on disk
curl -X POST http://localhost:3000/v1/integration/sync \
  -H "X-Tenant-Id: stafford-engineering-test"

# Verify capture completed
cat tools/mock-genius/recorded/2026-04-18T14-30-00/_metadata.json

# Stop the mock (Ctrl+C or SIGTERM)
```

### Example: promote a capture to a fixture

```bash
# Copy captured session into fixtures
cp -r tools/mock-genius/recorded/2026-04-18T14-30-00 \
      tools/mock-genius/fixtures/stafford-snapshot-april-18

# Strip envelopes to fixture format
node tools/mock-genius/scripts/strip-envelope.js \
     tools/mock-genius/fixtures/stafford-snapshot-april-18

# Sanitize (out of scope for this sprint — do not skip)

# Serve the new scenario
MOCK_SCENARIO=stafford-snapshot-april-18 \
  npm start
```

### Example: CI usage (not typical for recording mode)

Recording mode is inherently an online-only operation — CI can't reach Stafford's VPN. So recording never runs in CI. CI always uses fixture-served mode with pre-promoted, sanitized scenarios.

The workflow is: developer records locally → sanitizes → commits the promoted fixture scenario → CI runs tests against the committed scenario.

---

## Files Created

| File | Purpose |
|------|---------|
| `tools/mock-genius/src/recording.ts` | **NEW** — Proxy and capture implementation. Original mock sprint planned a placeholder at this path but it was never created; this sprint creates it from scratch. |
| `tools/mock-genius/scripts/strip-envelope.js` | Post-capture helper to extract Result arrays for fixture use |
| `tools/mock-genius/tests/recording.test.ts` | Test suite for recording mode (separate from `mock.test.ts` for clarity) |

## Files Modified

| File | Change |
|------|--------|
| `tools/mock-genius/src/server.ts` | Detect recording mode at startup. Route the four Genius entity handlers (currently a `for (entity of GENIUS_ENTITIES)` loop in `server.ts`, not split into per-file route modules) to the recorder instead of the fixture loader when active. Log mode clearly at startup. Disable `/_mock/scenario` and `/_mock/inject-failure` in recording mode (return 409). Extend `/_mock/state` to report recording mode status including upstream URL, record dir, captured endpoints, and errors. |
| `tools/mock-genius/.gitignore` | Add `recorded/` so raw captures never reach version control. |
| `tools/mock-genius/README.md` | Document the recording workflow: capture, promote, sanitize, serve. Call out the sensitive-data posture explicitly. |

---

## Key Design Decisions

**Why mutually exclusive modes rather than per-endpoint proxying?**
Incomplete snapshots are worse than no snapshots. If half the endpoints are real and half are fixtures, debugging becomes "which mode was I in for this request" and the captured data has hidden gaps. Either record everything or record nothing.

**Why save the full envelope, not just Result?**
We want to validate our envelope-unwrapping logic against real data. If Genius ever changes the envelope structure (adds a field, renames something), our captured files show the change. Fixtures are derived from captures, not the other way around.

**Why timestamp at mock startup, not per-request?**
One session = one recording. If you want a fresh capture, restart the mock. This prevents accidental mixing of captures from different times (schema might differ, data might have changed). It also means the metadata file is a coherent record of one specific session.

**Why a helper script rather than building envelope-stripping into the proxy?**
Separation of concerns. The proxy's job is "capture reality faithfully." Fixture promotion is a separate, manual step — it's when the developer decides "this capture is good, I want to use it as a reference going forward." Mixing these would make it harder to re-examine the raw capture later when debugging.

**Why disable failure injection during recording?**
Failure injection is for testing how the adapter handles bad responses. Recording is for capturing what the real API actually sends. Mixing them would record fake failures as if they were real, which defeats the purpose.

**Why return 502 on upstream unreachable, not 500?**
502 (Bad Gateway) is the correct HTTP status for "I'm a proxy and my upstream is broken." This lets the RestAdapter distinguish "the mock itself failed" (500) from "the mock's upstream failed" (502). During a recording session, 502 means "check your VPN."

---

## What This Sprint Does NOT Do

- **Replay of captured recordings** — that's fixture-serving mode, which already works. Captured recordings just become the fixture sources.
- **Sanitization tooling** — a helper that replaces customer names and redacts prices is a separate sprint. This sprint captures raw data and `.gitignore`s it; the manual sanitize-before-commit workflow gates what reaches git.
- **Diff two recordings** — comparing snapshots over time to detect schema drift is useful but not blocking. Future sprint.
- **Incremental / selective recording** — you can't re-record just the tasks endpoint while keeping yesterday's resources. Every session records all endpoints that get hit. Future sprint if the workflow demands it.
- **Automatic promotion from `recorded/` to `fixtures/`** — manual `cp` is intentional. Promotion is when the developer reviews the capture and decides it's good. Automating it invites promoting bad captures.
- **Authentication other than basic auth** — Genius uses basic auth, so that's what we support. OAuth, API keys, and client certificates are future work for other ERPs.
- **Recording of POST/PUT/DELETE** — CTP only reads from Genius. The mock only proxies GET. Write operations are out of scope.

---

## Operator Workflow Notes

For a solo developer doing the first Stafford recording:

1. **Before connecting VPN** — make sure the mock runs locally in a sanity-check mode (`MOCK_SCENARIO=empty` or similar). If it crashes on startup without upstream access, that's a bug to fix first.
2. **Connect VPN** — verify you can hit Genius directly with curl before trusting the mock.
3. **Start mock in recording mode** — watch the startup banner, confirm it says RECORDING in big letters.
4. **Trigger a sync from the CTP API** — this exercises all four endpoints naturally. Don't handcraft curl calls unless you know exactly which endpoints the adapter will hit.
5. **Check the recording directory immediately** — don't wait until the sync finishes to notice that nothing's being written.
6. **Save the raw capture before editing** — `cp -r recorded/{session}/ recorded-backups/stafford-first-capture/`. If you mess up the promotion, the raw capture is still there. (The backup directory is also gitignored — anything under `recorded/` is off-limits to git.)
7. **Review `_metadata.json`** — any errors? Unexpected record counts? Missing pages?
8. **Promote to fixture scenario** — copy to `fixtures/stafford-snapshot-{date}/` and run `strip-envelope.js`.
9. **Sanitize** — replace customer names with aliases, redact pricing, leave IDs/dates/structure alone. Do NOT `git add` until this step is complete.
10. **Verify the promoted scenario loads** — restart the mock with `MOCK_SCENARIO=stafford-snapshot-{date}` and run a sync. Should produce the same landscape as the original capture did.
11. **Commit the sanitized scenario** — now it's available to CI and to future-you-without-VPN.

The whole workflow should take 15-30 minutes once you've done it once.

---

## Variety Over Single-Shot

One 15-minute recording captures one moment in time. Plan for at least three sessions before relying on fixtures as comprehensive:

- **A quiet day** — low order count, simple chains, minimal WIP. Tests the happy path at its simplest.
- **A busy day** — many active orders, long multi-step chains, many resources in play, mixed WIP states. Stresses pagination, mapping throughput, and chain propagation logic.
- **An edge-case day** — rush orders, completed-but-locked tasks, known gnarly data if Stafford has flagged a specific case. Targets the corners our mapping might get wrong.

Each becomes its own `fixtures/stafford-snapshot-{slug}-{date}/` scenario; developers switch via `POST /_mock/scenario` to iterate against the relevant variety. The three together are a far better test corpus than any single session.

Sessions don't have to be contiguous or on the same day — record as opportunities arise. The goal is coverage of data shapes, not exhaustive capture of any one moment.

### Cadence for re-capture

Once the three baseline captures exist, re-capture monthly or when Stafford says "we changed X." A drift-detection helper (diff today's capture against the committed snapshot, flag new/missing fields) is a future sprint; for now the re-capture cadence is manual discipline.

---

*This sprint closes the loop between "mock works but has no real data" and "mock has a permanent, offline reference capture of the real API." After this lands, the Stafford integration becomes a series of small, debuggable, offline iterations against captured data, rather than a series of VPN sessions hoping the right data is in the right state at the right time.*
