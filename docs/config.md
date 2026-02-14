# CTP Platform — Configuration Architecture

## Overview

The CTP Platform uses a flat-file JSON configuration system for maximum flexibility during development and demo sessions. All tenant configuration and data lives in the `config/` directory at the monorepo root. The system is designed to be swapped to a database backend later via the `IConfigStore` interface without changing any calling code.

---

## Directory Structure

```
ctp-platform/
├── config/
│   └── tenants/
│       └── {tenantId}/                  ← One folder per tenant
│           ├── tenant.json              ← Tenant metadata
│           ├── horizon.json             ← Scheduling date range
│           ├── settings.json            ← Engine settings
│           ├── scoring.json             ← Scoring rules and weights
│           ├── terminology.json         ← Generic → domain term mapping
│           ├── schemas/
│           │   ├── task.schema.json     ← Task attribute definitions
│           │   ├── resource.schema.json ← Resource attribute definitions
│           │   └── order.schema.json    ← Order attribute definitions
│           ├── kpis/
│           │   └── kpis.json            ← KPI definitions
│           └── data/
│               ├── resources.json       ← Resource entities
│               ├── tasks.json           ← Task/operation entities
│               ├── calendars.json       ← Availability per resource
│               └── state-changes.json   ← Changeover/setup rules
├── packages/
│   ├── engine/                          ← Scheduling engine (pure TypeScript)
│   └── api/                             ← NestJS API (reads config, exposes endpoints)
```

---

## File Descriptions

### tenant.json
Tenant identity and metadata.
```json
{
  "tenantId": "demo-manufacturing",
  "name": "Demo Manufacturing",
  "vertical": "manufacturing",
  "createdAt": "2026-02-12T00:00:00Z",
  "updatedAt": "2026-02-12T00:00:00Z"
}
```

### horizon.json
The scheduling time window. All task windows and calendar intervals should fall within this range.
```json
{
  "startDate": "2026-02-10T00:00:00Z",
  "endDate": "2026-02-24T00:00:00Z"
}
```

### settings.json
Engine behavior settings. Maps directly to CTPAppSettings.
```json
{
  "flowAround": false,
  "maxLateness": 0,
  "tasksPerLoop": 50,
  "topTasksToSchedule": 2,
  "resetUsageAfterProcessChange": true,
  "scheduleDirection": 1,
  "requiresPreds": false
}
```
- `scheduleDirection`: 1 = forward, 2 = backward
- `tasksPerLoop`: how many tasks the solver evaluates per iteration
- `topTasksToSchedule`: how many of the best candidates to commit per loop
- `flowAround`: whether tasks can flow around unavailable gaps

### scoring.json
Scoring rules that determine how the solver evaluates scheduling options.
```json
{
  "name": "Default Manufacturing",
  "key": "default-manufacturing",
  "rules": [
    {
      "ruleName": "EarliestStartTimeScoringRule",
      "weight": 1.0,
      "objective": 0,
      "includeInSolve": true,
      "penaltyFactor": 0
    }
  ]
}
```
- `objective`: 0 = minimize, 1 = maximize
- `weight`: relative importance (higher = more influence)
- Common rules: EarliestStartTimeScoringRule, LatestStartTimeScoringRule

### terminology.json
Maps generic platform terms to the tenant's domain language. Used by the UI and API responses.
```json
{
  "mappings": {
    "resource": "Machine",
    "task": "Operation",
    "order": "Work Order",
    "duration": "Run Time",
    "stateChange": "Changeover",
    "demand": "Customer Order"
  }
}
```

### schemas/task.schema.json
Defines what typed attributes are expected on task entities. Drives validation, engine behavior, and UI rendering.
```json
{
  "entityType": "task",
  "version": 1,
  "attributes": [
    {
      "name": "productType",
      "displayName": "Product Type",
      "dataType": "enum",
      "required": true,
      "validation": {
        "allowedValues": ["Widget-A", "Widget-B", "Widget-C"]
      },
      "category": "product",
      "sequence": 1,
      "searchable": true,
      "sortable": true,
      "useInScheduling": true,
      "useInScoring": true
    }
  ]
}
```
Supported data types: `string`, `number`, `integer`, `boolean`, `date`, `enum`, `list`, `object`

### schemas/resource.schema.json
Same structure as task schema, but for resource entities.

### kpis/kpis.json
KPI definitions for the tenant's dashboard.
```json
[
  {
    "name": "Makespan",
    "displayName": "Makespan",
    "description": "Total time from first task start to last task end",
    "computationType": "built-in",
    "sourceEntity": "schedule",
    "objective": "minimize",
    "unit": "hours",
    "format": "0.1",
    "visualizationType": "number",
    "category": "efficiency",
    "sequence": 1
  }
]
```
- `computationType`: `built-in` (pre-coded), `attribute-agg` (aggregate a typed attribute), `expression` (formula), `custom` (plugin)
- `objective`: `minimize`, `maximize`, or `target`
- `warningThreshold` / `criticalThreshold`: for gauge/number coloring

### data/resources.json
Resource entity data with typed attributes.
```json
[
  {
    "key": "CNC-01",
    "name": "CNC Machine 01",
    "class": "REUSABLE",
    "typedAttributes": [
      {
        "name": "machineType",
        "dataType": "enum",
        "value": { "type": "enum", "value": "CNC" },
        "category": "equipment",
        "sequence": 1
      },
      {
        "name": "maxSpeed",
        "dataType": "number",
        "value": { "type": "number", "value": 100 },
        "category": "performance",
        "sequence": 2
      }
    ]
  }
]
```

### data/tasks.json
Task/operation entity data.
```json
[
  {
    "key": "OP-001",
    "name": "Machine Widget-A Batch 1",
    "windowStart": "2026-02-10T08:00:00Z",
    "windowEnd": "2026-02-17T18:00:00Z",
    "durationSeconds": 3600,
    "capacityResources": [
      { "resource": "CNC-01", "isPrimary": true }
    ],
    "typedAttributes": [
      {
        "name": "productType",
        "dataType": "enum",
        "value": { "type": "enum", "value": "Widget-A" },
        "category": "product",
        "sequence": 1
      },
      {
        "name": "batchSize",
        "dataType": "integer",
        "value": { "type": "integer", "value": 100 },
        "category": "production",
        "sequence": 2
      }
    ]
  }
]
```
- `windowStart`/`windowEnd`: ISO 8601 date strings defining the feasible scheduling window
- `durationSeconds`: how long the task takes in seconds
- `durationType`: 0=fixed duration, 1=float duration, 2=untracked, 3=static, 4=fixed run rate, 5=float run rate
- `capacityResources`: array of resource requirements (key reference, isPrimary flag)
- `linkId`: for multi-step jobs, links tasks into a process chain (name=process, prevLink=predecessor task key)

### data/calendars.json
Resource availability windows. Each entry defines when a resource is available.
```json
[
  {
    "resourceKey": "CNC-01",
    "intervals": [
      {
        "start": "2026-02-10T00:00:00Z",
        "end": "2026-02-10T23:59:59Z",
        "qty": 1,
        "runRate": null
      }
    ]
  }
]
```
- `qty`: capacity (1 = one unit available during this interval)
- `runRate`: optional, units per second produced during this interval

### data/state-changes.json
Changeover/setup rules between product states on resources.
```json
[
  {
    "resourceType": "CNC",
    "type": "PROCESS CHANGE",
    "fromState": "Widget-A",
    "toState": "Widget-B",
    "duration": 1800,
    "penalty": 0
  }
]
```
- `duration`: changeover time in seconds
- `penalty`: additional cost penalty for this changeover
- The engine looks up state changes by hash: `{resourceType}-{type}-{fromState}-{toState}`
- A `DEFAULT CHANGE` to `DEFAULT CHANGE` entry serves as the fallback rule

---

## Runtime Data Flow

```
Flat JSON files on disk
        │
        ▼
FileConfigStore              Reads JSON, caches in memory
        │                    Returns raw data shapes (IResourceData, ITaskData, etc.)
        ▼
ConfigService                NestJS injectable wrapper
        │                    Supports tenant switching via switchTenant(tenantId)
        ▼
StateHydratorService         Converts raw JSON → engine objects:
        │                      IResourceData     → CTPResource + AvailableMatrix
        │                      ITaskData         → CTPTask + window + duration
        │                      ICalendarData     → CTPAvailable intervals
        │                      IStateChangeData  → CTPStateChange with hash keys
        │                    Assembles into SchedulingLandscape
        ▼
StateService                 Holds live SchedulingLandscape in memory
        │                    Injected by other modules (CTP query, slot finder)
        ▼
API Endpoints
  POST /v1/state/sync        Build landscape from flat files
  POST /v1/state/reload      Re-read files + rebuild (demo hot-reload)
  GET  /v1/state/summary     Check what's loaded
```

---

## Key Interfaces

### IConfigStore
The abstraction layer. `FileConfigStore` implements it today. `DatabaseConfigStore` replaces it later with zero changes upstream.

```typescript
interface IConfigStore {
  getTenant(): ITenantConfig | null;
  getSchema(entityType: string): IEntitySchema | null;
  getKPIs(): IKPIDefinition[];
  getTerminology(): ITerminologyMap;
  getScoring(): IScoringConfig | null;
  getSettings(): ISettingsConfig;
  getHorizon(): IHorizonConfig | null;
  getResources(): IResourceData[];
  getTasks(): ITaskData[];
  getCalendars(): ICalendarData[];
  getStateChanges(): IStateChangeData[];
  // ... save methods and reload()
}
```

### ITypedAttribute
Phase 1 typed attribute system. Stored on every entity alongside legacy NameValue attributes.

```typescript
interface ITypedAttribute {
  name: string;
  dataType: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'enum' | 'list' | 'object';
  value: AttributeValue;   // Discriminated union: { type: "number", value: 42 }
  category: string;
  sequence: number;
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TENANT_ID` | `demo-manufacturing` | Which tenant folder to load at startup |
| `CONFIG_ROOT` | `./config` | Path to the config directory (relative to monorepo root) |

---

## Demo Workflow

### Live editing (during a sales call)
1. Edit any JSON file under `config/tenants/{tenantId}/`
2. Hit `POST /v1/state/reload`
3. Config store clears cache, re-reads from disk
4. Hydrator rebuilds the SchedulingLandscape
5. New landscape is live, ready for the scheduler

### Switching tenants
1. Create a new tenant folder under `config/tenants/`
2. Call `switchTenant(newTenantId)` via the API or ConfigService
3. Full reload of the new tenant's configuration

### Adding a new tenant
1. Copy an existing tenant folder (or a template)
2. Edit tenant.json, schemas, data files
3. Set `TENANT_ID` env var or call switchTenant()

---

## What Gets Hydrated

| JSON File | Engine Object | Key Wiring |
|-----------|--------------|------------|
| resources.json | CTPResource | typedAttributes.fromArray(), added to CTPResources |
| tasks.json | CTPTask | window (CTPInterval), duration (CTPDuration), capacityResources (CTPTaskResourceList), typedAttributes |
| calendars.json | CTPAvailable + CTPAssignments | Intervals added to resource.original, wired to resource.available (AvailableMatrix) |
| state-changes.json | CTPStateChange | Hash key generated for lookup, added to CTPStateChanges |
| horizon.json | CTPHorizon | Parsed dates, startW/endW computed |
| settings.json | CTPAppSettings | Direct field mapping |
| scoring.json | CTPScoring + CTPScoringConfiguration | Rules added to scoring object |

---

## Migration Path

When the platform scales to production with multiple concurrent tenants:

1. Implement `DatabaseConfigStore` with the same `IConfigStore` interface
2. Store schemas, KPIs, terminology in PostgreSQL as JSONB
3. Cache active tenant config in Redis
4. Swap the provider in `ConfigModule` — no other code changes needed
