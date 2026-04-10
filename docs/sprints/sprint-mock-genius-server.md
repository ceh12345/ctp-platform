# Sprint: Mock Genius Server — Test Harness for the Data Adapter

**Status:** 📋 Ready  
**Size:** ~3-4 hours CC work (Session 1: server skeleton + static fixtures, Session 2: failure injection + scenario library, Session 3: recording mode + CI integration)  
**Depends on:** Data Adapter Layer sprint (needs the IDataAdapter interface and SyncService to test against)  
**Triggered by:** Need to test the data adapter against controlled responses before deploying to Stafford. Real Genius API can't easily produce error conditions, isn't reachable from CI, and requires VPN access.

---

## Problem

The data adapter needs to handle a wide range of scenarios that the real Genius API won't reliably produce:

- **Failure modes** — 500 errors, timeouts, malformed JSON, rate limiting, auth failures. The real Genius dev environment is healthy and won't break on demand.
- **Edge case data** — null required fields, chain cycles, orphan references, oversized payloads, empty result sets. The real data is mostly clean.
- **CI testing** — GitHub Actions can't reach Stafford's network. Adapter integration tests need a target that runs in CI.
- **Offline development** — VPN access requires being online and connected. Local development should work without it.
- **Reproducible bug fixes** — when something breaks against real data, the developer needs to capture the response that caused it and replay it indefinitely.
- **Future tenants** — every new ERP we onboard will face the same problems. A mock server pattern is reusable across tenants.

---

## Design

### Core Principle

Build a small standalone HTTP server that mimics Genius API endpoints. Same URLs, same response shapes, same auth model — but the data is files on disk that you control. Package it as a Docker container so it runs identically on a developer's laptop, in CI, and in any other environment.

### Three modes of operation

**Mode 1: Static fixtures** (the default)  
Drop JSON files in a folder, the mock serves them when the corresponding endpoint is hit. Files are either captured from the real Genius API or hand-crafted edge cases. This is the workhorse mode for development and most tests.

**Mode 2: Behavioral overrides** (failure injection)  
Configurable failure injection via headers, query params, or a control endpoint. Tell the mock to return a 500 once, time out for the next request, return malformed JSON, simulate rate limiting, etc. Critical for testing the error handling pipeline.

**Mode 3: Recording mode** (proxy + capture)  
Optional. Point the mock at the real Genius dev API via VPN. As calls pass through, the mock captures the responses to disk as fixture files. Run once to snapshot the real API, then run tests against the mock with those fixtures going forward.

---

## Deliverables

### 1. Mock server skeleton

**Location:** `tools/mock-genius/` (separate from the main CTP repo, or a subfolder)

**Stack:** TypeScript + Fastify (lightweight, fast startup, matches the rest of the stack). Could also use Express — Fastify is just a touch leaner for this use case.

**Project structure:**

```
tools/mock-genius/
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── server.ts                 # Fastify entry point
│   ├── routes/
│   │   ├── salesOrderDetail.ts
│   │   ├── workOrder.ts
│   │   ├── productionTask.ts
│   │   ├── machineAndResource.ts
│   │   └── control.ts            # Failure injection control endpoints
│   ├── fixtures.ts               # Fixture loading + scenario selection
│   ├── failureInjection.ts       # Failure mode logic
│   ├── recording.ts              # Optional proxy mode
│   └── responseFormat.ts         # Genius envelope: { Result, Messages, PagingInfos }
├── fixtures/
│   ├── stafford-clean/           # Default scenario — captured from live dev API
│   ├── empty/                    # All endpoints return empty arrays
│   ├── bad-data-null-machine/    # Tests strict policy on resource field
│   ├── bad-data-missing-priority/# Tests default policy
│   ├── chain-cycle/              # Tests validation
│   ├── large-dataset/            # 1000 orders, 10000 tasks
│   └── ...
├── tests/
│   └── mock.test.ts              # Self-tests for the mock server
└── README.md                     # How to run, how to add fixtures
```

### 2. HTTP routes

The mock implements the same endpoints the real Genius API exposes:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/data/fetch/salesOrderDetailEntity` | Sales orders |
| GET | `/api/data/fetch/workOrderWithAdvancedInformationViewEntity` | Work orders |
| GET | `/api/data/fetch/productionTaskWithAdvancedInfoViewEntity` | Production tasks |
| GET | `/api/data/fetch/machineAndRessourceEntity` | Machines and resources |
| GET | `/_mock/health` | Mock server health check (returns 200 OK) |
| POST | `/_mock/scenario` | Switch active scenario at runtime |
| POST | `/_mock/inject-failure` | Schedule a failure for the next request |
| POST | `/_mock/reset` | Clear all injected failures and reset to default scenario |
| GET | `/_mock/state` | Inspect current scenario, pending failures, request log |

The Genius endpoints accept the same query parameters the real API supports (`filter`, `limit`, `pageIndex`) but the mock honors them only loosely — primarily to verify the adapter is sending them correctly.

### 3. Response envelope format

Every Genius endpoint wraps results in this envelope:

```typescript
interface GeniusResponse<T> {
  Result: T[];
  Messages: GeniusMessage[];
  PagingInfos: {
    CurrentPageIndex: number;
    PageSize: number;
    TotalElementsFound: number;
    TotalPagesFound: number;
    English: string;
    French: string;
  };
  Tag: any | null;
}

interface GeniusMessage {
  English: string;
  French: string;
  Index: number | null;
  InnerException: any | null;
  Key: string;
  MessageType: number;
  ProcessingType: number;
  Source: string;
  Tag: number;
}
```

The mock automatically wraps fixture data in this envelope so fixtures only contain the inner array. This keeps fixtures clean and makes them easy to hand-edit.

### 4. Fixture loading

Fixtures live in `fixtures/{scenario}/{entity}.json`. Each entity file is a plain JSON array of records — no envelope, no metadata. The mock wraps them at request time.

```json
// fixtures/stafford-clean/productionTaskWithAdvancedInfoViewEntity.json
[
  {
    "Id": 55222,
    "JobCode": "15897",
    "WorkOrderCode": "23898",
    "MachineCode": "NT-01",
    "OperationCode": "NT",
    "CycleTime": 1.25,
    "WoPlannedQuantity": 2,
    "Formula": "HR/UN",
    "IsCompleted": true,
    "IsSchedulingLocked": true,
    "LagHours": 4
    // ... rest of the fields
  }
]
```

The active scenario is selected at startup via env var (`MOCK_SCENARIO=stafford-clean`) or at runtime via the control endpoint:

```bash
curl -X POST http://localhost:8080/_mock/scenario -d '{"scenario": "bad-data-null-machine"}'
```

If a scenario directory is missing an entity file, the mock returns an empty `Result` array for that endpoint. This makes it easy to build minimal scenarios that only override one or two endpoints.

### 5. Failure injection

The control endpoint schedules failures for upcoming requests:

```bash
# Next request to /productionTaskWithAdvancedInfoViewEntity returns 500
curl -X POST http://localhost:8080/_mock/inject-failure -d '{
  "endpoint": "/api/data/fetch/productionTaskWithAdvancedInfoViewEntity",
  "failureType": "500",
  "count": 1
}'

# Next 3 requests to any endpoint time out
curl -X POST http://localhost:8080/_mock/inject-failure -d '{
  "endpoint": "*",
  "failureType": "timeout",
  "count": 3,
  "timeoutMs": 35000
}'
```

Failure types:

| Type | Behavior |
|------|----------|
| `500` | Return HTTP 500 with a generic Genius error envelope |
| `503` | Return HTTP 503 (service unavailable) |
| `401` | Return HTTP 401 (auth failed) |
| `429` | Return HTTP 429 (rate limited) with `Retry-After` header |
| `timeout` | Hang the connection until the client times out |
| `slow` | Respond after a configurable delay (test slow networks) |
| `malformed-json` | Return 200 with a syntactically invalid JSON body |
| `truncated` | Return 200 with a partial JSON body (closing brace missing) |
| `wrong-shape` | Return 200 with valid JSON but wrong envelope structure |
| `empty-result` | Return 200 with the envelope but `Result: []` |
| `partial-records` | Return only N records instead of the full fixture |

Injected failures consume themselves — once a failure is used, it's removed from the queue. If `count > 1`, it stays until used `count` times.

The control endpoint also supports query-string injection for one-off testing without setup:

```
GET /api/data/fetch/productionTaskWithAdvancedInfoViewEntity?_mock_fail=500
GET /api/data/fetch/productionTaskWithAdvancedInfoViewEntity?_mock_delay=5000
```

### 6. Scenario library

A set of pre-built scenarios in `fixtures/` that exercise specific code paths. Each scenario is a directory containing JSON files for the entities it overrides. The bare minimum library:

| Scenario | Purpose |
|----------|---------|
| `stafford-clean` | Default. Captured from the real Stafford dev API. Represents the happy path. |
| `empty` | All endpoints return empty `Result` arrays. Tests adapter behavior with no data. |
| `single-order` | One order, one task, one resource. Minimum viable schedule. |
| `bad-data-null-machine` | Production tasks with `MachineCode: null` to test the strict policy. |
| `bad-data-missing-priority` | Sales orders with missing `Strategy` field to test the default policy. |
| `bad-data-unparseable-date` | Tasks with malformed `TaskStartDate` to test date parsing errors. |
| `chain-cycle` | Production tasks where chain references form a cycle. Tests validation. |
| `orphan-resource` | Tasks reference a `MachineCode` that has no entry in the machine endpoint. Tests cross-entity validation. |
| `large-dataset` | 1000 orders, 10000 tasks, 50 machines. Tests pagination and performance. |
| `paginated` | Returns data across multiple pages with `PagingInfos.TotalPagesFound > 1`. Tests pagination handling. |
| `unicode-edge-cases` | Records with special characters, smart quotes, non-ASCII identifiers. Tests encoding. |
| `nz-timezone-boundary` | Dates that cross the NZDT/NZST timezone boundary. Tests UTC conversion. |
| `genius-error-envelope` | Returns a Genius-style error response (Messages with MessageType indicating failure). |

Adding a new scenario is just creating a new directory with the JSON files you need. No code changes.

### 7. Recording mode (optional, Phase 3)

When the mock is configured with `MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215`, every request gets proxied to the real Genius API and the response is saved to `fixtures/recorded/{timestamp}/{endpoint}.json`. After running a sync against the recording mock, you have a captured snapshot of the live API state.

```bash
# Start mock in recording mode (requires VPN access)
MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 \
MOCK_RECORD_AUTH_USER=greg \
MOCK_RECORD_AUTH_PASS=*** \
docker run -p 8080:8080 mock-genius

# Trigger a sync via the CTP API — it hits the mock, mock hits real Genius, saves to disk
curl -X POST http://localhost:3000/v1/integration/sync

# Stop the mock, copy the captured fixtures
docker stop mock-genius
cp -r recorded/2026-04-09T14-30-00/ fixtures/stafford-snapshot-april-9/
```

This is how you keep fixtures fresh as the real Genius schema evolves.

### 8. Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/fixtures ./fixtures
COPY package.json ./
EXPOSE 8080
ENV MOCK_SCENARIO=stafford-clean
CMD ["node", "dist/server.js"]
```

The fixtures are baked into the image so the mock is self-contained. For local development, mount a fixtures volume to override:

```bash
docker run -p 8080:8080 \
  -v ./my-fixtures:/app/fixtures \
  -e MOCK_SCENARIO=my-test \
  mock-genius:latest
```

### 9. Adapter test integration

The data adapter's test suite gets a new file `mock-genius-integration.test.ts` that:

1. Starts the mock server (via testcontainers, or as a child process if running locally)
2. Configures a `RestAdapter` instance pointed at `http://localhost:8080`
3. Runs through scenarios by switching the mock's active scenario between tests
4. Verifies the adapter handles each scenario correctly

Example:

```typescript
describe('RestAdapter against mock Genius', () => {
  let mock: MockGeniusServer;
  let adapter: RestAdapter;
  
  beforeAll(async () => {
    mock = await MockGeniusServer.start({ port: 8080 });
    adapter = new RestAdapter({
      baseUrl: 'http://localhost:8080/api/data/fetch',
      auth: { type: 'none' },
    });
  });
  
  afterAll(async () => {
    await mock.stop();
  });
  
  it('handles the stafford-clean scenario', async () => {
    await mock.setScenario('stafford-clean');
    const result = await adapter.fetchAll('test-tenant');
    expect(result.orders).toHaveLength(15);
    expect(result.tasks).toHaveLength(100);
    expect(result.metadata.errors).toHaveLength(0);
  });
  
  it('retries on transient 500 errors', async () => {
    await mock.setScenario('stafford-clean');
    await mock.injectFailure({ endpoint: '*', failureType: '500', count: 1 });
    const result = await adapter.fetchAll('test-tenant');
    expect(result.orders).toHaveLength(15);  // Succeeded after retry
  });
  
  it('reports auth failures clearly', async () => {
    await mock.injectFailure({ endpoint: '*', failureType: '401' });
    await expect(adapter.fetchAll('test-tenant')).rejects.toThrow(/auth/i);
  });
  
  // ... etc for all 16 error handling test scenarios
});
```

### 10. CI integration

GitHub Actions workflow runs the mock as a sidecar service:

```yaml
name: Adapter integration tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      mock-genius:
        image: ghcr.io/yourorg/mock-genius:latest
        ports:
          - 8080:8080
        env:
          MOCK_SCENARIO: stafford-clean
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:integration
        env:
          MOCK_GENIUS_URL: http://localhost:8080
```

This runs the full adapter test suite on every push, against the mock, in CI. No VPN required, no external dependencies.

---

## Migration Path

### Phase 1: Server skeleton + fixtures

- Set up the Fastify project with the four Genius endpoints
- Implement the response envelope wrapping
- Build the fixture loader with scenario directory support
- Capture `stafford-clean` from a live Genius API call (one-time, via VPN)
- Add `empty` and `single-order` as the simplest test scenarios
- Build the Dockerfile and verify it runs locally

### Phase 2: Failure injection + scenario library

- Implement the control endpoints (`/_mock/scenario`, `/_mock/inject-failure`, `/_mock/reset`, `/_mock/state`)
- Implement all failure types (500, 503, 401, 429, timeout, slow, malformed, etc.)
- Build out the bad-data scenarios
- Build the chain-cycle and orphan-resource validation scenarios
- Write the adapter integration tests against the mock
- Verify all 16 error handling scenarios from the data adapter sprint pass

### Phase 3: Recording mode + CI integration

- Implement the proxy/recording mode
- Use it to capture a fresh `stafford-snapshot` fixture
- Add the GitHub Actions workflow for CI integration
- Publish the mock image to ghcr.io as `mock-genius:latest`
- Document the workflow in the README so other developers can run it

---

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_PORT` | `8080` | HTTP listen port |
| `MOCK_SCENARIO` | `stafford-clean` | Active scenario directory under `fixtures/` |
| `MOCK_FIXTURES_DIR` | `./fixtures` | Override fixture directory (for volume mounts) |
| `MOCK_LOG_REQUESTS` | `true` | Log every incoming request to stdout |
| `MOCK_REQUIRE_AUTH` | `false` | If `true`, requires basic auth on all endpoints (matches real Genius) |
| `MOCK_AUTH_USER` | `mock` | Username when auth is required |
| `MOCK_AUTH_PASS` | `mock` | Password when auth is required |
| `MOCK_RECORD_FROM` | (none) | If set, proxies all requests to this URL and records responses |
| `MOCK_RECORD_DIR` | `./recorded` | Where to write captured responses in recording mode |
| `MOCK_LATENCY_MS` | `0` | Add baseline latency to every response (simulate network) |

### Adapter pointed at the mock

Stafford's `adapter.json` for development can point to the mock:

```json
{
  "adapterType": "rest",
  "source": "genius-api-mock",
  "connection": {
    "baseUrl": "http://localhost:8080/api/data/fetch",
    "auth": { "type": "none" },
    "timeout": 30000,
    "retries": 3,
    "retryDelay": 2000
  },
  "endpoints": {
    "// same as production": ""
  }
}
```

Switch between mock and real Genius by swapping `adapter.json` files. The rest of the config (mapping, UOM, scoring) is identical.

---

## Files Created

| File | Purpose |
|------|---------|
| `tools/mock-genius/package.json` | Project manifest |
| `tools/mock-genius/Dockerfile` | Container build |
| `tools/mock-genius/src/server.ts` | Fastify entry point |
| `tools/mock-genius/src/routes/*.ts` | Endpoint handlers |
| `tools/mock-genius/src/fixtures.ts` | Fixture loading and scenario switching |
| `tools/mock-genius/src/failureInjection.ts` | Failure injection logic |
| `tools/mock-genius/src/recording.ts` | Optional proxy/recording mode |
| `tools/mock-genius/src/responseFormat.ts` | Genius envelope wrapping |
| `tools/mock-genius/fixtures/stafford-clean/*.json` | Default scenario (captured from live) |
| `tools/mock-genius/fixtures/empty/` | Empty result scenario |
| `tools/mock-genius/fixtures/single-order/` | Minimum viable scenario |
| `tools/mock-genius/fixtures/bad-data-*/` | Error policy scenarios |
| `tools/mock-genius/fixtures/chain-cycle/` | Validation scenario |
| `tools/mock-genius/fixtures/orphan-resource/` | Cross-entity validation |
| `tools/mock-genius/fixtures/large-dataset/` | Performance scenario |
| `tools/mock-genius/fixtures/paginated/` | Pagination scenario |
| `tools/mock-genius/README.md` | Usage documentation |
| `tests/integration/mock-genius-integration.test.ts` | Adapter test suite against mock |
| `.github/workflows/integration-tests.yml` | CI integration |

## Files Modified

| File | Change |
|------|--------|
| `Stafford-CTP-ETL-Mapping-Specification.docx` | Add note about mock server in development workflow |
| Sprint dependency map | Add Mock Genius Server as dependency for first deployment |

---

## Testing the Mock Itself

The mock server has its own test suite (`tools/mock-genius/tests/mock.test.ts`) that verifies:

| # | Test | What to verify |
|---|------|----------------|
| 1 | Health check | `GET /_mock/health` returns 200 |
| 2 | Default scenario serves | `GET /api/data/fetch/machineAndRessourceEntity` returns expected fixture data wrapped in envelope |
| 3 | Empty scenario | After switching to `empty`, all endpoints return `{ "Result": [], ... }` |
| 4 | Scenario switching | `POST /_mock/scenario` changes active scenario without restart |
| 5 | Failure injection — 500 | After injecting 500, next request returns 500 |
| 6 | Failure injection — count | After injecting count=3, three requests fail then fourth succeeds |
| 7 | Failure injection — endpoint specificity | Failure on `/tasks` doesn't affect `/orders` |
| 8 | Failure injection — wildcard | `endpoint: "*"` affects all endpoints |
| 9 | Timeout simulation | `timeout` failure causes connection to hang past adapter timeout |
| 10 | Malformed JSON | `malformed-json` returns syntactically invalid body |
| 11 | Auth required mode | With `MOCK_REQUIRE_AUTH=true`, requests without credentials get 401 |
| 12 | Pagination | `paginated` scenario returns multi-page data with correct `PagingInfos` |
| 13 | Reset | `POST /_mock/reset` clears all injected failures and resets scenario |
| 14 | State inspection | `GET /_mock/state` returns current scenario, pending failures, request count |
| 15 | Recording mode | When `MOCK_RECORD_FROM` is set, requests proxy to upstream and save to disk |

---

## Key Design Decisions

**Why a separate process, not a test mock library?**  
A real HTTP server tests the actual network code in the adapter — TLS handling, timeout behavior, connection reuse, error parsing. A library mock would only test the parsing logic, missing whole categories of bugs. The separate process also makes the mock reusable across languages, environments, and CI systems.

**Why Fastify, not Express?**  
Faster startup (matters for CI), lighter memory footprint, better TypeScript support. The differences are small but they all favor Fastify for this use case. Either works.

**Why bake fixtures into the image?**  
Self-contained and reproducible. The published `mock-genius:v1.0.0` image always serves the same data unless explicitly overridden. This is critical for CI test stability — you don't want the test suite breaking because someone updated a fixture file in main.

**Why scenario switching at runtime?**  
Tests can iterate through scenarios without restarting the server, which would be slow. Each test switches to its needed scenario, runs the assertions, and the next test switches again.

**Why not Docker Compose?**  
The mock can run alongside a Compose setup but the mock itself is a single container. Compose is about orchestrating multiple services. The mock is one service.

**Why include recording mode at all?**  
Because hand-crafting fixtures is tedious and error-prone. Recording mode lets you snapshot reality with one command, then iterate against the snapshot. It's the difference between writing 200 lines of fake JSON and running `curl` once.

---

## What This Sprint Does NOT Do

- **Mock anything other than Genius.** Future ERPs (SAP, Epicor, Infor) will need their own mock servers. The pattern is reusable but the implementation is per-ERP.
- **Replace integration testing against the real Genius API.** The mock is for fast iteration and edge cases. A periodic CI job (weekly?) should still run against the real Genius dev API to catch reality drift.
- **Provide UI for managing scenarios.** Scenarios are directories on disk. Adding one is `mkdir + cp`. A UI is unnecessary.
- **Implement Genius-side write operations.** CTP only reads from Genius. The mock doesn't need to handle POST, PUT, DELETE.
- **Persist state between runs.** The mock is stateless. Each run starts fresh with the configured scenario. Recording mode is the exception — it writes to disk.

---

*This sprint provides the test harness needed to validate the data adapter against controlled responses before exposing it to a real client. It also becomes a permanent part of the development workflow — every future tenant onboarding gets faster because you can iterate against a mock before connecting to the real ERP.*
