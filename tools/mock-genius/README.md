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

## Notes

- The `stafford-clean` fixtures are **hand-crafted** based on the Stafford flat-file dataset,
  not captured from the live Genius API. Field shapes reflect expected Genius format based on
  the ETL mapping spec. Replace with VPN-captured data when available (use recording mode —
  see sprint-mock-genius-server.md Phase 3).
- Genius uses `machineAndRessourceEntity` (French spelling "Ressource") — this typo is
  intentional and matches the real API.
- All dates in fixtures use NZ Daylight Time (+13:00, March 2026). The MappingEngine
  (Phase 2) converts these to UTC via the `toUTC` transform.
