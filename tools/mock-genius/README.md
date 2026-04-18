# Mock Genius Server

Standalone Fastify HTTP server that mimics the Stafford Genius ERP API endpoints.
Used to develop and test the CTP RestAdapter without requiring VPN access.

## Quick Start

```bash
cd tools/mock-genius
npm install
npm run dev          # ts-node (no build step)
# or
npm run build && npm start
```

Server starts on port 8080 by default.

```bash
curl http://localhost:8080/_mock/health
curl http://localhost:8080/api/data/fetch/salesOrderDetailEntity
curl http://localhost:8080/api/data/fetch/workOrderWithAdvancedInformationViewEntity
curl http://localhost:8080/api/data/fetch/productionTaskWithAdvancedInfoViewEntity
curl http://localhost:8080/api/data/fetch/machineAndRessourceEntity
```

## Endpoints

### Genius data endpoints

| Method | Path | Entity |
|--------|------|--------|
| GET | `/api/data/fetch/salesOrderDetailEntity` | Sales orders |
| GET | `/api/data/fetch/workOrderWithAdvancedInformationViewEntity` | Work orders |
| GET | `/api/data/fetch/productionTaskWithAdvancedInfoViewEntity` | Production tasks |
| GET | `/api/data/fetch/machineAndRessourceEntity` | Machines and resources |

All endpoints accept `filter`, `limit`, and `pageIndex` query params (logged but not enforced).
All responses are wrapped in the Genius envelope:

```json
{
  "Result": [...],
  "Messages": [],
  "PagingInfos": { "CurrentPageIndex": 1, "PageSize": 100, "TotalElementsFound": 15, "TotalPagesFound": 1, ... },
  "Tag": null
}
```

### Control endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/_mock/health` | Health check — returns `{ status: "ok", scenario: "..." }` |
| GET | `/_mock/state` | Current scenario |
| POST | `/_mock/scenario` | Switch scenario — body: `{ "scenario": "stafford-clean" }` |

## Scenarios

Scenarios live in `fixtures/{scenario}/`. Each scenario is a directory of entity JSON files.
If an entity file is missing, the endpoint returns an empty `Result` array.

| Scenario | Description |
|----------|-------------|
| `stafford-clean` | 15 orders, 15 work orders, 30 production tasks, 28 machines. Default. |
| `empty` | No entity files — all endpoints return empty arrays. |
| `single-order` | PV-001 only — 1 order, 10 tasks (full chain), 12 machines. |

### Adding a scenario

Create a new directory under `fixtures/` and add JSON files for the entities you want to override.
Files must be named exactly as the Genius entity name (e.g. `salesOrderDetailEntity.json`).
Each file is a plain JSON array — no envelope, no metadata. The mock wraps it at request time.

```bash
mkdir fixtures/my-scenario
echo '[{"Id": 9001, "JobCode": "TEST-001", ...}]' > fixtures/my-scenario/salesOrderDetailEntity.json
curl -X POST http://localhost:8080/_mock/scenario -H "Content-Type: application/json" -d '{"scenario":"my-scenario"}'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_PORT` | `8080` | HTTP listen port |
| `MOCK_SCENARIO` | `stafford-clean` | Active scenario on startup |
| `MOCK_FIXTURES_DIR` | `./fixtures` | Override fixtures directory |
| `MOCK_LOG_REQUESTS` | `true` | Log incoming requests to stdout |

## Fixture Field Reference

### salesOrderDetailEntity

| Field | Type | Notes |
|-------|------|-------|
| `Id` | number | Unique record ID |
| `JobCode` | string | Order identifier — joins to `workOrderWithAdvancedInformationViewEntity.Job` |
| `CustomerName` | string | |
| `ItemCode` | string | Product code |
| `ItemDescription` | string | |
| `OrderQty` | number | |
| `DeliveryDate` | string | NZ local time (NZDT +13:00 or NZST +12:00) |
| `LateDeliveryDate` | string | NZ local time |
| `Strategy` | string | Priority: `RUSH`, `HIGH`, `NORMAL`, `LOW` |
| `ItemStatus` | string | `O` = open, `C` = closed |

### workOrderWithAdvancedInformationViewEntity

| Field | Type | Notes |
|-------|------|-------|
| `Id` | number | |
| `Job` | string | Foreign key → `salesOrderDetailEntity.JobCode` |
| `WorkOrderCode` | string | |
| `WoStatusCode` | string | `OPEN`, `RELEASED`, `CLOSED` |
| `WoPlannedQuantity` | number | |
| `Product` | string | Product code |
| `PlannedStart` | string | NZ local time |
| `PlannedEnd` | string | NZ local time |

### productionTaskWithAdvancedInfoViewEntity

| Field | Type | Notes |
|-------|------|-------|
| `Id` | number | |
| `JobCode` | string | Foreign key → `salesOrderDetailEntity.JobCode` |
| `WorkOrderCode` | string | |
| `SequenceNumber` | number | Task order within work order (10, 20, 30…) |
| `OperationCode` | string | Operation abbreviation (CUT, LATHE, WELD, etc.) |
| `TaskType` | string | `SETUP`, `PROCESS`, `TEARDOWN` |
| `MachineCode` | string | Foreign key → `machineAndRessourceEntity.MachineCode` |
| `CycleTime` | number | Hours. Meaning depends on `Formula` |
| `WoPlannedQuantity` | number | |
| `Formula` | string | `HR/OP` = fixed hours per operation; `HR/UN` = hours × qty |
| `IsCompleted` | boolean | |
| `IsSchedulingLocked` | boolean | True if dispatched or in-process |
| `LagHours` | number | Wait time after task ends before successor can start |
| `TaskStartDate` | string \| null | Planned/actual start, NZ local time. null if not yet scheduled |
| `TaskEndDate` | string \| null | Planned/actual end, NZ local time |
| `WipState` | string | `NOT_STARTED`, `IN_PROCESS`, `COMPLETED` |

### machineAndRessourceEntity

| Field | Type | Notes |
|-------|------|-------|
| `Id` | number | |
| `MachineCode` | string | Resource identifier (note Genius typo: "Ressource") |
| `MachineName` | string | Display name |
| `MachineType` | string | Equipment class |
| `Active` | boolean | False = exclude from scheduling |
| `HourlyRate` | number | NZD per hour |
| `IsLabour` | boolean | True for people resources, false for equipment |

## Recording Mode

When `MOCK_RECORD_FROM` is set at startup, the mock stops serving fixtures and
becomes a transparent proxy: every Genius endpoint request is forwarded to the
upstream URL, the raw response body is saved to disk, and the response is
returned unchanged to the caller. Failure injection and fixture loading are
disabled — the upstream is authoritative.

Use this once per capture session to snapshot the real Stafford Genius API for
offline development.

### Start in recording mode

```bash
cd tools/mock-genius

MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 \
MOCK_RECORD_AUTH_USER=<vpn-user> \
MOCK_RECORD_AUTH_PASS=<vpn-pass> \
npm start
```

The startup banner is loud and explicit — it says `Mode: RECORDING` in big
letters. If you don't see that, you're not in recording mode.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MOCK_RECORD_FROM` | (unset) | Upstream base URL. Setting this enables recording mode. |
| `MOCK_RECORD_DIR` | `./recorded` | Where to save captured responses. |
| `MOCK_RECORD_AUTH_USER` | (unset) | Basic auth username forwarded to upstream. |
| `MOCK_RECORD_AUTH_PASS` | (unset) | Basic auth password forwarded to upstream. |
| `MOCK_RECORD_TIMEOUT` | `60000` | Upstream request timeout in milliseconds. |

### Directory layout

Each mock startup creates one session directory timestamped to the second:

```
recorded/
  2026-04-18T14-30-00/
    salesOrderDetailEntity.json                   # single-page or merged
    workOrderWithAdvancedInformationViewEntity.json
    productionTaskWithAdvancedInfoViewEntity_page1.json   # multi-page saved per page
    productionTaskWithAdvancedInfoViewEntity_page2.json
    machineAndRessourceEntity.json
    _metadata.json                                # capture summary
```

Restart the mock to start a fresh session.

### Capture → promote → serve workflow

```bash
# 1. Record from live upstream (requires VPN)
MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 \
MOCK_RECORD_AUTH_USER=greg MOCK_RECORD_AUTH_PASS=*** \
npm start

# 2. Trigger a sync in another terminal to exercise all four endpoints
curl -X POST http://localhost:3000/v1/state/sync \
  -H "X-Tenant-Id: stafford-engineering-test"

# 3. Review capture — spot errors, unexpected record counts, missing pages
cat recorded/2026-04-18T14-30-00/_metadata.json

# 4. Stop the mock (Ctrl+C). Copy the capture into a named scenario.
cp -r recorded/2026-04-18T14-30-00 fixtures/stafford-snapshot-april-18

# 5. Strip the Genius envelope, merge paged files
node scripts/strip-envelope.js fixtures/stafford-snapshot-april-18

# 6. SANITIZE — replace customer names with CustomerA/B/..., redact prices.
#    Do not git add the scenario until this step is complete.

# 7. Serve the sanitized scenario from the mock
MOCK_SCENARIO=stafford-snapshot-april-18 npm start

# 8. Commit — the scenario is now part of the test corpus
git add fixtures/stafford-snapshot-april-18
```

### Sensitive data — read before committing

Raw recordings contain customer names, pricing, internal codes. **They are
`.gitignore`d** — never commit the contents of `recorded/`. Sanitization is
the gate between a raw capture and a committed fixture scenario. If you skip
it, Stafford's pricing and customer list land on GitHub.

Minimum sanitization pass:
- Replace customer-identifying strings (`CustomerName`, `ShipToName`) with
  sequential aliases `CustomerA`, `CustomerB`, …
- Redact numeric price/cost fields (set to `0` or `999`) — `UnitPrice`,
  `HourlyRate` on labor records, `MaterialCost`
- Keep IDs, codes, dates, quantities, and chain relationships intact — these
  are the interesting shape for CTP and don't leak

### Control endpoints in recording mode

| Endpoint | Behavior |
|---|---|
| `GET /_mock/health` | Returns `{status: "ok", mode: "recording"}` — never proxies |
| `GET /_mock/state` | Returns `{mode, upstreamUrl, sessionDir, capturedEndpoints, errors, requestCount}` |
| `POST /_mock/scenario` | **409** — scenario switching disabled in recording mode |
| `POST /_mock/inject-failure` | **409** — failure injection disabled in recording mode |
| `POST /_mock/reset` | Clears in-memory capture tracking (disk files untouched) |

## Notes

- The `stafford-clean` fixtures are **hand-crafted** based on the Stafford flat-file dataset,
  not captured from the live Genius API. Field shapes reflect expected Genius format based on
  the ETL mapping spec. Replace with VPN-captured data via Recording Mode (above).
- Genius uses `machineAndRessourceEntity` (French spelling "Ressource") — this typo is
  intentional and matches the real API.
- All dates in fixtures use NZ Daylight Time (+13:00, March 2026). The MappingEngine
  (Phase 2) converts these to UTC via the `toUTC` transform.
