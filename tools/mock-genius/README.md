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

One VPN session captures a complete Genius snapshot. Every subsequent dev session runs
offline against the capture. Re-record when Stafford data drifts.

### TL;DR — full capture-to-commit workflow

```bash
# ── 1. Start mock in recording mode (VPN must be up) ─────────────────────────
cd tools/mock-genius
MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 \
MOCK_RECORD_AUTH_USER=<vpn-user> \
MOCK_RECORD_AUTH_PASS=<vpn-pass> \
npm start
# Startup banner MUST say "Mode: RECORDING" — stop and fix env if not.

# ── 2. Trigger a sync (in another terminal) — exercises all four endpoints ──
curl -X POST http://localhost:3000/v1/state/sync \
  -H "X-Tenant-Id: stafford-engineering-test"

# ── 3. Review what landed ─────────────────────────────────────────────────────
cat recorded/*/_metadata.json
# Check: all 4 endpoints present? Expected record counts? Any errors?

# ── 4. Stop the mock (Ctrl+C). Copy the raw capture into a named scenario ───
SESSION=$(ls -1 recorded | tail -1)
DATE=$(date +%Y-%m-%d)
cp -r recorded/$SESSION fixtures/stafford-snapshot-$DATE

# ── 5. Strip Genius envelopes + merge paged files ────────────────────────────
node scripts/strip-envelope.js fixtures/stafford-snapshot-$DATE

# ── 6. SANITIZE ── see checklist below. Do NOT skip this step. ──────────────
#     Hand-edit the JSON files in fixtures/stafford-snapshot-$DATE.

# ── 7. Verify the sanitized scenario serves identically ──────────────────────
MOCK_SCENARIO=stafford-snapshot-$DATE npm start
curl -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test"
# Record counts should match the original capture.

# ── 8. Commit the sanitized scenario ─────────────────────────────────────────
git add fixtures/stafford-snapshot-$DATE
git commit -m "data: Stafford Genius capture $DATE"
```

### Sanitization checklist (step 6 — do not skip)

Raw captures are `.gitignore`d because they contain customer names, pricing,
and internal codes. **Sanitize before `git add`.** If you skip this step,
Stafford's pricing and customer list land on GitHub.

- [ ] Customer names: replace `CustomerName`, `ShipToName`, etc. with sequential aliases `CustomerA`, `CustomerB`, …
- [ ] Prices: set `UnitPrice`, `HourlyRate`, `MaterialCost` and similar numeric cost fields to `0` or `999`
- [ ] Any other obviously-sensitive strings (vendor contacts, internal URLs, emails) — redact
- [ ] Keep: IDs, codes, dates, quantities, chain relationships. These are what CTP cares about and don't leak.
- [ ] **Verify no leakage:** `grep -ri "<real-customer-name>" fixtures/stafford-snapshot-$DATE` returns nothing
- [ ] **Verify diff is plausible:** `git diff --stat` — number of changed lines matches what you sanitized

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
    salesOrderDetailEntity.json                          # single-page or post-strip merged
    workOrderWithAdvancedInformationViewEntity.json
    productionTaskWithAdvancedInfoViewEntity_page1.json  # multi-page saved per page
    productionTaskWithAdvancedInfoViewEntity_page2.json
    machineAndRessourceEntity.json
    _metadata.json                                       # capture summary
```

Restart the mock to start a fresh session.

### Control endpoints in recording mode

| Endpoint | Behavior |
|---|---|
| `GET /_mock/health` | Returns `{status:"ok", mode:"recording"}` — never proxies |
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
