# Test Sprint: Public API End-to-End Validation

**Status:** 📋 Ready (revised 2026-04-20 — calibrated against actual codebase)
**Size:** ~1-2 hours manual test work (single session — tenant config + sync test + recording test + replay test)
**Depends on:** Data Adapter Layer Phase 2 (RestAdapter, MappingEngine), Mock-Genius Recording Mode sprint, Sprints 1a + 1b scaffolding/fixes (on main).
**Triggered by:** Before the Stafford capture session, we want to know exactly which pieces of the adapter / mapping / recording pipeline are ready for a non-Genius upstream, and which are Genius-shaped. Running against PokeAPI surfaces real network/TLS/pagination behaviour *and* documents the abstractions that are hardcoded to Genius. Every gap found here is one we don't find on VPN day.

**Rule of engagement:** testing only. Any bug or gap is **documented, not fixed** in this session. Real fixes come in a follow-up "RestAdapter config-drivenness" sprint after we know the full gap list.

---

## Honest baseline — what's Genius-shaped in the code today

Before running any tests, capture what's already known from reading `packages/api/src/modules/integration/rest-adapter.ts`. These are expected findings, not surprises:

- **Response envelope is hardcoded.** `rest-adapter.ts:52-54` unwraps `data?.Result` and reads `data?.PagingInfos?.TotalPagesFound`. The `responseEnvelope` block in `adapter.json` is **read by nothing**. PokeAPI's `{count, next, previous, results}` shape won't unwrap — records land empty.
- **Entity slots are hardcoded** to `salesOrders`, `tasks`, `resources` (`rest-adapter.ts:16-20`). An `adapter.json` that only declares `resources` will still cause two extra unwanted fetches against whatever `baseUrl` resolves to for the missing slots.
- **Pagination query params are hardcoded** to `?limit=X&pageIndex=N` (`rest-adapter.ts:50`). PokeAPI uses `?limit=X&offset=Y`. Even "page 1" won't use the right param name, though PokeAPI is forgiving and ignores unknown params.
- **No `/v1/tenants/switch` or `/v1/integration/test-connection` endpoints.** Tenancy is per-request via the `X-Tenant-Id` header. Connection-testing is implicit: try a sync and see what happens.
- **SyncResult shape** (actual, see `sync-result.ts`): `{ status: 'ok' | 'not_loaded', summary: { resources, tasks, horizon, stateChanges, settings }, mappingErrors: MappingError[], validationSummary: {...} }`. No `status: "success"`, no `recordCounts.fetched.*`.

Given all of the above, this test is going to produce findings, not just green checks. That is the goal.

---

## Goal

Stand up a throwaway test tenant pointed at PokeAPI (`https://pokeapi.co/api/v2`). Document what works, what partially works, and what the Genius-shaped abstractions explicitly don't support yet.

Six targets (pass / partial / known-gap):

1. RestAdapter can establish HTTPS, resolve DNS, and get *some* bytes back from a public internet service
2. Response envelope unwrapping — **expected gap** per baseline above
3. Pagination behaviour — **expected gap** per baseline above
4. MappingEngine applies transforms to whatever records do make it through
5. Recording mode proxies and captures real HTTPS traffic
6. `strip-envelope.js` merges captured files + replay from disk produces the same landscape (modulo timestamps)

If 1, 4, and 5 pass and 2/3/6 produce clean gap reports, the session succeeded.

---

## Non-goals

- **Solving a pokemon schedule.** The landscape won't be solvable; don't try to wire data into orders/tasks.
- **Testing error injection against PokeAPI.** Failure handling is tested against the mock's fake upstream.
- **Comprehensive mapping.** One field (name → resource key) is enough. Any more is scope creep.
- **Silently fixing anything.** If something doesn't work, it goes on the findings list. Exception: a one-line config change to keep the test running.

---

## Setup

### 1. Create tenant directory

```
config/tenants/pokeapi-test/
  integration/
    adapter.json
    mapping.json
  locale.json          # copy from stafford-engineering
  scoring.json         # copy from stafford-engineering (or any tenant that has one)
  tenant.json          # minimal — tenantId + name
```

No `uom-conversions.json` needed.

### 2. adapter.json

```json
{
  "adapterType": "rest",
  "source": "pokeapi-test",
  "description": "Public API pipeline validation tenant. NOT for real integration work. Uses PokeAPI (https://pokeapi.co) as a stand-in for a different RESTful source. Several adapter.json fields below are aspirational — see baseline findings in the test doc.",
  "connection": {
    "baseUrl": "https://pokeapi.co/api/v2",
    "auth": { "type": "none" },
    "timeout": 30000,
    "retries": 3,
    "retryDelay": 2000
  },
  "endpoints": {
    "resources": { "path": "/pokemon", "pageSize": 50 }
  }
}
```

**Notes:**
- `endpoints.salesOrders` and `endpoints.tasks` are intentionally omitted. The adapter will still attempt to fetch from them (falling back to `baseUrl + ''`). Document what that does.
- `responseEnvelope` block (which would describe PokeAPI's `{count, next, previous, results}` shape) is omitted — the adapter doesn't read it anyway.
- `sync.maxRecordErrorsBeforeAbort` / `sync.partialSyncAllowed` — also not read today. Keep the config minimal to what matters.

### 3. mapping.json

Match the actual schema that `MappingEngine.transform()` reads (`orders.mappings` / `resources.mappings` / `tasks.mappings`, with rule types `from`/`value`/`toUTC`/`lookup`/`factor`):

```json
{
  "version": "0.1.0",
  "tenantId": "pokeapi-test",
  "source": "pokeapi",
  "resources": {
    "mappings": {
      "key":   { "from": "name" },
      "name":  { "from": "name" },
      "class": { "value": "REUSABLE" },
      "type":  { "value": "POKEMON" }
    }
  },
  "orders": { "mappings": {} },
  "tasks":  { "mappings": {} }
}
```

If MappingEngine sees empty mappings on `orders`/`tasks`, it no-ops those entities — desired.

### 4. locale.json + scoring.json + tenant.json

Copy `locale.json` and `scoring.json` verbatim from `config/tenants/stafford-engineering-test/`. For `tenant.json`, minimal:

```json
{ "tenantId": "pokeapi-test", "name": "PokeAPI pipeline validation" }
```

---

## Tests

Run in order. If a test fails, capture the exact error and what broke, then **continue** to later tests where possible (unlike the older version of this doc — some findings are independent and worth capturing together).

### Test 1 — Tenant loads

```bash
curl -s -X POST http://localhost:3000/v1/state/sync \
  -H "X-Tenant-Id: pokeapi-test" \
  -o /tmp/sync1.json -w "HTTP %{http_code}\n"
cat /tmp/sync1.json | python -m json.tool 2>/dev/null || cat /tmp/sync1.json
```

**Acceptance:** API doesn't 500 on tenant load. Adapter + mapping configs found. Whatever the sync does, there's a valid JSON response. Record the HTTP code and any error messages verbatim.

### Test 2 — Live connectivity (ad-hoc)

There is no test-connection endpoint. Probe directly:

```bash
curl -s -w "\nHTTP %{http_code}\n" https://pokeapi.co/api/v2/pokemon?limit=5 | tail -10
```

**Acceptance:** HTTP 200 with a JSON body containing `results: [...]`. This isolates "network works" from "our adapter works" — if this fails, it's DNS/TLS/ISP, not our code.

### Test 3 — Inspect what the sync actually retrieved

Regardless of Test 1's outcome, inspect the landscape:

```bash
curl -s http://localhost:3000/v1/ctp/state -H "X-Tenant-Id: pokeapi-test" | python -c "
import json, sys
r = json.load(sys.stdin)
print('resources:', len(r.get('resourceUtilization') or []))
print('tasks:', len(r.get('tasks') or []))
print('orders:', len(r.get('orders') or []))
print('first resource:', (r.get('resourceUtilization') or [{}])[0].get('resourceKey'))
print('first task:', (r.get('tasks') or [{}])[0].get('key'))
"
```

Also check the sync response itself:

```bash
cat /tmp/sync1.json | python -c "
import json, sys
r = json.load(sys.stdin)
print('status:', r.get('status'))
print('summary:', r.get('summary'))
print('mappingErrors count:', len(r.get('mappingErrors') or []))
print('validationSummary:', r.get('validationSummary'))
"
```

**What to expect and document:**
- `summary.resources` count — likely 0 or some unexpected number because the envelope unwrap is hardcoded to look for `data.Result` but PokeAPI returns `data.results`. If 0, confirmed: envelope unwrap is not config-driven.
- `summary.tasks` and the adapter's "unwanted fetches" to `salesOrders`/`tasks` missing paths — document what happened (did they 404? Did they resolve to the API index?).
- `mappingErrors` — likely empty (no `toUTC` rules to trigger).

This is a **finding-documentation test, not a pass/fail**. Record what you see.

### Test 4 — Force a direct extractor to prove the rest of the pipeline works

This confirms the pipeline **downstream** of the broken envelope unwrap works. Temporarily bypass the adapter:

```bash
# Fetch directly, inline the PokeAPI results into a payload shape the hydrator expects.
# Not automated — just proof by construction. Requires a dev to verify with curl + eyeball.
RESULTS=$(curl -s 'https://pokeapi.co/api/v2/pokemon?limit=20' | python -c "
import json, sys
r = json.load(sys.stdin)
payload = {
  'resources': [{'name': p['name'], 'key': p['name'], 'class': 'REUSABLE', 'type': 'POKEMON'} for p in r['results']],
  'tasks': [], 'orders': [], 'calendars': [], 'stateChanges': [],
  'products': [], 'materials': [], 'processes': [], 'cadences': [],
  'uomConversions': None
}
print(json.dumps(payload))
")
# Eyeball — 20 entries, each with key/name/class/type
echo "$RESULTS" | python -m json.tool | head -20
```

**Acceptance:** Shape is correct, 20 pokemon names. This is the "if the envelope unwrap was config-driven, here's what the hydrator would see" proof.

**What to document:** this payload as constructed would load cleanly into the landscape. The gap is specifically at the envelope-unwrap layer, not downstream.

### Test 5 — Recording mode against PokeAPI

Stop the mock if running. Start in recording mode:

```bash
cd tools/mock-genius
MOCK_RECORD_FROM=https://pokeapi.co/api/v2 npm run dev
```

In another terminal:

```bash
curl -s 'http://localhost:8080/api/data/fetch/pokemon?limit=20&pageIndex=1' | head -c 200
echo
ls tools/mock-genius/recorded/*/
cat tools/mock-genius/recorded/*/_metadata.json
```

**Acceptance (with expected gaps noted):**
- The mock forwards the request to `https://pokeapi.co/api/v2/pokemon?limit=20&pageIndex=1` (mock appends `/api/v2` path structure + passes through query params as-is).
- PokeAPI returns 200 with `{count, next, previous, results}`. Mock writes to `recorded/<timestamp>/pokemon.json` (or `pokemon_page1.json` if pagination is detected).
- `_metadata.json` has status 200 and durationMs populated.
- **Known gap:** mock's path routing pattern is `/api/data/fetch/<entity>` (Genius-shaped). We're abusing it here by treating `pokemon` as the entity. Verify the path-forwarding works end-to-end; document if the mock rewrites or passes through.

### Test 6 — Strip + replay from captured snapshot

After Test 5, a `recorded/<timestamp>/` directory exists. Promote it:

```bash
cd tools/mock-genius
cp -r recorded/<timestamp>/ fixtures/pokeapi-snapshot/
node scripts/strip-envelope.js fixtures/pokeapi-snapshot/
ls fixtures/pokeapi-snapshot/
cat fixtures/pokeapi-snapshot/pokemon.json | head -c 500
```

**Acceptance:**
- `strip-envelope.js` runs without throwing.
- **Known gap:** the script strips Genius's `{ Result: [...] }` envelope. PokeAPI's `{ results: [...] }` uses lowercase `results` — the script won't strip it correctly. Document whether the file post-strip is (a) unchanged (script didn't recognize the envelope), (b) broken (script corrupted the file), or (c) miraculously fine because it noticed an array at top level.
- If (a): intentional behavior — document as "strip-envelope is Genius-aware, needs generalization."
- If (b): real bug — file a defect.

Then attempt replay:

```bash
# Stop the recording-mode mock. Start in playback pointed at the new scenario.
MOCK_SCENARIO=pokeapi-snapshot npm run dev
```

Do NOT expect `/v1/state/sync` against pokeapi-test tenant to pull from this — the tenant's adapter.json points to `https://pokeapi.co` directly, not the mock. Either (a) temporarily swap the adapter's `baseUrl` to `http://localhost:8080/api/v2`, or (b) skip the full replay loop and just verify the mock can serve the stripped fixture:

```bash
curl -s 'http://localhost:8080/api/data/fetch/pokemon' | head -c 300
```

**Acceptance:** mock serves without erroring. Whether the response shape matches what the adapter expects is a separate finding.

### Test 7 — Regression: stafford-engineering-test still works

```bash
curl -s -X POST http://localhost:8080/_mock/reset
curl -s -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test" | python -c "
import json, sys
r = json.load(sys.stdin)
print('status:', r.get('status'))
print('summary:', r.get('summary'))
print('mappingErrors:', len(r.get('mappingErrors') or []))
print('validationSummary:', r.get('validationSummary'))
"
```

**Acceptance:**
- `status: "ok"`, `summary.resources: 28`, `summary.tasks: 30` (stafford-clean defaults).
- `mappingErrors: 0`, `validationSummary.recordsWithErrors: 0`.

**This is the hard regression gate.** If this fails, something in the pokeapi-test session polluted stafford state — stop and investigate immediately.

### Test 8 — Full test suite still green

```bash
npx vitest run 2>&1 | tail -5
npx tsc --noEmit -p packages/api/tsconfig.json; echo "tsc=$?"
```

**Acceptance:** 1029 tests pass, tsc exits 0. Zero changes committed — this verifies the session didn't accidentally leave uncommitted code in a broken state.

---

## What to report back

A short findings document with these sections:

### 1. What works end-to-end
- Tests that passed cleanly
- Total wall-clock time for network operations (baseline data)

### 2. Confirmed gaps (expected)
For each baseline finding that manifested, one line: "envelope unwrap hardcoded — PokeAPI returned `results`, adapter looked for `Result`, got 0 records."

### 3. Unexpected findings
Anything surprising: a PokeAPI field that caused a crash, an unexpected error path, a log message that indicates a deeper bug.

### 4. Network / TLS / latency observations
- DNS resolution time (first request vs. subsequent)
- TLS handshake latency
- Did any retries fire? Which status codes?
- Did timeouts behave as configured?

### 5. Prerequisite list for a "RestAdapter config-drivenness" follow-up sprint
In priority order, the specific refactors needed to make PokeAPI (or any non-Genius upstream) actually work:
1. Envelope unwrap config-driven (read from `responseEnvelope.resultPath`)
2. Entity slots config-driven (not hardcoded to salesOrders/tasks/resources)
3. Pagination style config-driven (query-param names, offset-vs-page, `next`-URL support)
4. `strip-envelope.js` takes an envelope shape config or accepts pluggable strippers
5. Path routing in mock-genius for non-Genius layouts
6. Any `/v1/tenants/switch` / `/v1/integration/test-connection` endpoints deemed worth adding

If this list is short, Stafford's next step is the actual fix sprint. If it's long, Stafford needs a phased approach.

---

## Cleanup

- Leave `config/tenants/pokeapi-test/` in place — useful for regression testing next time someone touches the adapter.
- Do NOT commit the tenant unless we decide it's valuable as a permanent regression fixture.
- Delete `tools/mock-genius/recorded/<timestamp>/` and `tools/mock-genius/fixtures/pokeapi-snapshot/` when done — both throwaways, both gitignored (`recorded/` is; the promoted `pokeapi-snapshot` fixture should be deleted manually since fixtures are committed by default).
- Kill any `MOCK_RECORD_FROM` mock sessions before the next mock-genius restart — recording mode refuses control endpoints, which would confuse future tests.

---

*This test isn't about PokeAPI — it's about producing a precise, accurate gap list before Stafford VPN day. Running against a real public API is the cheapest way to see exactly which of our abstractions are actually generic and which are Genius-shaped. Findings are the deliverable.*
