# Data Integration — Inbound Data + WIP Sync

## Overview

Two phases of data integration, both required for CTP to work in production:

**Phase 1: Inbound Data** — Getting the client's resources, orders, tasks, and constraints into the engine. Two paths: Direct API (published JSON schema) and CSV Upload (column mapper with saved profiles). This is the initial data load and any structural changes (new orders, new resources, routing changes).

**Phase 2: WIP Sync** — Keeping the engine in sync with reality on the floor. Task progress (% complete, actual times), resource status (down, maintenance), and floor commitments (pinned tasks). This is the ongoing reality check that makes CTP promises trustworthy.

Both phases produce data in the same internal model. The engine doesn't know or care how the data arrived.

---

# Phase 1: Inbound Data — API Schema + CSV Upload

Two integration paths, one target model:

1. **Direct API** — client conforms to our published schema, pushes JSON to `POST /v1/state/sync`. Zero transformation, zero maintenance.
2. **CSV Upload** — client exports from their system, uploads a file, maps columns to our schema in a UI. Mapping profile saved for repeat uploads. No developer needed.

---

## Phase 1, Part 1: The Published Schema

### Core entities

These are what the client needs to provide. Each has a required and optional field set.

#### Resources — "What do I have?"

```json
{
  "resources": [
    {
      "key": "CNC-01",                          // REQUIRED — unique identifier
      "name": "DMG Mori 5-Axis Mill",           // REQUIRED — display name
      "type": "CNC",                             // REQUIRED — resource type for grouping
      "workCenter": "Machining",                 // optional — higher-level grouping
      "class": "REUSABLE",                       // optional — REUSABLE (default) or CONSUMABLE
      "capacity": 1,                             // optional — concurrent capacity (default 1)
      "hourlyRate": 150.00,                      // optional — for cost scoring
      "currency": "USD",                         // optional — defaults to tenant locale
      "attributes": [                            // optional — for attribute matching
        { "name": "certifications", "value": "5-axis,high-speed" },
        { "name": "maxRPM", "value": "12000" }
      ],
      "shifts": [                                // optional — defaults to 24/7 if not provided
        {
          "name": "Day Shift",
          "days": ["Mon","Tue","Wed","Thu","Fri"],
          "start": "07:00",
          "end": "17:00",
          "rateMultiplier": 1.0
        },
        {
          "name": "Overtime",
          "days": ["Mon","Tue","Wed","Thu","Fri"],
          "start": "17:00",
          "end": "22:00",
          "rateMultiplier": 1.5
        }
      ]
    }
  ]
}
```

#### Orders — "What do I need to deliver?"

```json
{
  "orders": [
    {
      "key": "WO-1001",                         // REQUIRED
      "name": "Fonterra 2000L Mix Tank",         // REQUIRED
      "priority": 30,                            // REQUIRED — 1 = highest
      "dueDate": "2026-03-23T12:00:00Z",        // REQUIRED
      "lateDueDate": "2026-03-25T12:00:00Z",    // optional — grace period
      "quantity": 1,                             // optional — default 1
      "customer": "Fonterra",                    // optional — for grouping/reporting
      "latenessPenaltyPerDay": 5000.00,          // optional — for cost scoring
      "solveMode": "INCLUDE"                     // optional — INCLUDE (default), EXCLUDE, LOCKED
    }
  ]
}
```

#### Tasks — "What work needs to happen?"

```json
{
  "tasks": [
    {
      "key": "WO-1001-MILL",                    // REQUIRED
      "name": "Mill Frame",                      // REQUIRED
      "orderKey": "WO-1001",                     // REQUIRED — links to order
      "duration": 7200,                          // REQUIRED — seconds
      "windowStart": "2026-03-18T07:00:00Z",    // REQUIRED — earliest possible start
      "windowEnd": "2026-03-23T17:00:00Z",      // REQUIRED — latest possible end
      "priority": 30,                            // optional — inherits from order if not set
      "type": "PROCESS",                         // optional — PROCESS (default), SETUP, TEARDOWN
      "process": "Machining",                    // optional — process category
      "predecessorKey": "WO-1001-CUT",           // optional — must finish before this starts
      "maxGap": null,                            // optional — max seconds between predecessor end and this start
      "resources": [                             // REQUIRED — what this task needs
        {
          "type": "CNC",                         // REQUIRED — resource type or specific key
          "isPrimary": true,                     // optional — default false
          "preferences": [                       // optional — ordered preference list
            { "resourceKey": "CNC-01", "mode": "PREFERRED" },
            { "resourceKey": "CNC-02", "mode": "AVAILABLE" }
          ],
          "requiredAttributes": [                // optional — hard filter
            { "attribute": "certifications", "operator": "contains", "value": "5-axis" }
          ]
        }
      ],
      "outputProduct": "FRAME-7075",             // optional — what this task produces
      "outputQty": 1,                            // optional
      "inputMaterials": [                        // optional — what this task consumes
        { "productKey": "MAT-AL7075", "qty": 25.0 }
      ]
    }
  ]
}
```

#### State Changes — "What happens when switching between products?"

```json
{
  "stateChanges": [
    {
      "resourceKey": "CNC-01",                   // optional — null = applies to all resources of this type
      "resourceType": "CNC",                     // optional — applies to all CNC machines
      "fromProcess": "STAINLESS",
      "toProcess": "ALUMINUM",
      "duration": 2700,                          // seconds
      "cost": 300.00,                            // optional — for cost scoring
      "type": "PROCESS CHANGE"
    }
  ]
}
```

#### Products / Materials — "What do I make and consume?"

```json
{
  "products": [
    {
      "key": "FRAME-7075",
      "name": "Aluminum Frame 7075",
      "type": "INTERMEDIATE",                    // RAW, INTERMEDIATE, FINISHED
      "unitCost": 45.00,                         // optional — per unit
      "unitOfMeasure": "kg"                      // optional
    }
  ]
}
```

### Sync endpoint

```
POST /v1/state/sync
Content-Type: application/json
X-Tenant-Id: stafford-engineering

{
  "resources": [...],
  "orders": [...],
  "tasks": [...],
  "stateChanges": [...],
  "products": [...]
}
```

**Behavior:**
- Full replace — the payload is the complete current state
- Missing arrays are left unchanged (partial sync supported)
- Validation errors return 400 with field-level error messages
- After sync, the landscape is rebuilt from the new data
- Previous schedule is cleared (tasks unscheduled)

**Response:**

```json
{
  "status": "ok",
  "summary": {
    "resources": 25,
    "orders": 15,
    "tasks": 100,
    "stateChanges": 12,
    "products": 8,
    "validationWarnings": [
      "Task WO-1001-MILL references resource CNC-99 which doesn't exist — will use type-based matching"
    ]
  }
}
```

### Validation rules

| Rule | Severity | Description |
|------|----------|-------------|
| Task references nonexistent order | Error | `orderKey` must match an order |
| Task references nonexistent resource | Warning | Falls back to type-based matching |
| Task duration <= 0 | Error | Must be positive |
| Task windowEnd <= windowStart | Error | Window must be valid |
| Predecessor key not found | Warning | Predecessor link ignored |
| Duplicate keys | Error | Keys must be unique within entity type |
| Order dueDate in the past | Warning | May result in all tasks being late |
| Shift start >= end | Error | Invalid shift definition |

---

## Phase 1, Part 2: CSV Upload + Column Mapping

### Upload flow

```
1. Planner clicks "Import Data" in the toolbar
2. Selects a file (CSV, TSV, or Excel .xlsx)
3. Preview shows first 10 rows
4. If a saved mapping profile exists for this file shape → auto-apply and show preview
5. If no mapping → column mapper UI opens
6. Planner maps columns → validates → imports
7. Mapping profile saved for next time
```

### Column Mapper UI

```
┌─ Import: work_orders_export.csv ─────────────────────────────────────┐
│                                                                       │
│  Entity type: [Orders ▾]                                             │
│                                                                       │
│  ── Column Mapping ──────────────────────────────────────────────    │
│                                                                       │
│  Your Column          →    Our Field           Preview               │
│  ─────────────────────────────────────────────────────────────       │
│  "WO Number"          →    [key ▾]             WO-1001               │
│  "Description"        →    [name ▾]            Fonterra Mix Tank     │
│  "Due Date"           →    [dueDate ▾]         03/23/2026            │
│  "Priority Code"      →    [priority ▾]        A → 10               │
│  "Customer Name"      →    [customer ▾]        Fonterra              │
│  "Qty"                →    [quantity ▾]         1                     │
│  "Status"             →    [— skip — ▾]                              │
│  "Created By"         →    [— skip — ▾]                              │
│                                                                       │
│  ── Value Transforms ────────────────────────────────────────────    │
│                                                                       │
│  Date format: [MM/DD/YYYY ▾]                                        │
│  Priority mapping: [A=10, B=30, C=50, D=75 ▾]                      │
│                                                                       │
│  ── Preview (first 5 rows) ──────────────────────────────────────   │
│                                                                       │
│  key       name                  dueDate              priority       │
│  WO-1001   Fonterra Mix Tank     2026-03-23T12:00:00  10            │
│  WO-1002   F&P Sterilizer       2026-03-25T12:00:00  10            │
│  WO-1003   Dairy Co-op Vat      2026-03-24T12:00:00  30            │
│  ...                                                                  │
│                                                                       │
│  ✓ 15 rows valid, 0 errors                                          │
│                                                                       │
│  [Save Mapping Profile]        [Cancel]  [Import 15 orders]          │
└───────────────────────────────────────────────────────────────────────┘
```

### Mapping profile

Saved per tenant, keyed by entity type + column fingerprint (the set of column names):

```json
{
  "key": "quickbooks-orders",
  "name": "QuickBooks Work Order Export",
  "entityType": "orders",
  "columnFingerprint": ["WO Number", "Description", "Due Date", "Priority Code", "Customer Name", "Qty", "Status", "Created By"],
  "mappings": {
    "WO Number": { "field": "key" },
    "Description": { "field": "name" },
    "Due Date": { "field": "dueDate", "dateFormat": "MM/DD/YYYY", "timezone": "America/Denver" },
    "Priority Code": { "field": "priority", "valueMap": { "A": 10, "B": 30, "C": 50, "D": 75 } },
    "Customer Name": { "field": "customer" },
    "Qty": { "field": "quantity" },
    "Status": { "skip": true },
    "Created By": { "skip": true }
  },
  "createdAt": "2026-03-23T00:00:00Z"
}
```

When the planner uploads a file whose columns match the fingerprint, the profile auto-applies and the preview shows immediately — no re-mapping needed.

### Value transforms

Common transforms the mapper supports:

| Transform | Example | Config |
|-----------|---------|--------|
| Date format | "03/23/2026" → ISO | `dateFormat: "MM/DD/YYYY"` |
| Value mapping | "A" → 10 | `valueMap: { "A": 10 }` |
| Prefix/suffix | "1001" → "WO-1001" | `prefix: "WO-"` |
| Split | "CNC-01, CNC-02" → array | `split: ","` |
| Default | empty → 50 | `default: 50` |
| Timezone | naive date → UTC | `timezone: "America/Denver"` |
| Unit conversion | "2.5h" → 9000 seconds | `unit: "hours", targetUnit: "seconds"` |

### Multi-entity upload

A single CSV might contain multiple entity types. The planner can upload separate files for each:

```
Import Data
├── Resources (machines, people, rooms)     [Upload CSV]  ✓ 25 loaded
├── Orders (work orders, cases, jobs)       [Upload CSV]  ✓ 15 loaded
├── Tasks (operations, steps, activities)   [Upload CSV]  ⬜ not yet
├── State Changes (changeovers, setups)     [Upload CSV]  optional
└── Products / Materials                    [Upload CSV]  optional

[Validate All]  [Sync to Engine]
```

Or a single Excel file with multiple sheets — one sheet per entity type. The mapper detects sheet names and maps accordingly.

### Upload endpoint

```
POST /v1/data/upload
Content-Type: multipart/form-data

file: work_orders.csv
entityType: orders
mappingProfileKey: quickbooks-orders  (optional — auto-detect from columns if not provided)
```

**Response:**

```json
{
  "status": "ok",
  "entityType": "orders",
  "rowsProcessed": 15,
  "rowsValid": 14,
  "rowsSkipped": 1,
  "errors": [
    { "row": 8, "column": "Due Date", "error": "Invalid date format: '3/23'" }
  ],
  "warnings": [
    { "row": 3, "column": "Priority Code", "warning": "Unknown value 'E' — using default 50" }
  ],
  "mappingProfileUsed": "quickbooks-orders",
  "preview": false
}
```

### Preview mode

```
POST /v1/data/upload?preview=true
```

Returns the transformed data without importing — lets the planner verify before committing. The UI shows this in the preview table.

---

## Phase 1, Part 3: Mapping Profile Management

### Endpoints

```
GET    /v1/mappings                    — list all mapping profiles for tenant
GET    /v1/mappings/:key               — get a specific profile
POST   /v1/mappings                    — create a new profile
PUT    /v1/mappings/:key               — update a profile
DELETE /v1/mappings/:key               — delete a profile
POST   /v1/mappings/detect             — auto-detect best profile for a set of columns
```

### Auto-detection

When the planner uploads a file, the system checks column names against saved profiles:

```typescript
function detectMappingProfile(
  columns: string[],
  profiles: MappingProfile[],
): MappingProfile | null {
  // Exact fingerprint match
  const exact = profiles.find(p =>
    p.columnFingerprint.length === columns.length &&
    p.columnFingerprint.every(c => columns.includes(c))
  );
  if (exact) return exact;

  // Fuzzy match — most columns overlap
  let bestMatch: MappingProfile | null = null;
  let bestScore = 0;
  for (const p of profiles) {
    const overlap = p.columnFingerprint.filter(c => columns.includes(c)).length;
    const score = overlap / Math.max(p.columnFingerprint.length, columns.length);
    if (score > 0.8 && score > bestScore) {
      bestMatch = p;
      bestScore = score;
    }
  }

  return bestMatch;
}
```

If detected with >80% column overlap, auto-apply and show preview. If no match, open the column mapper.

---

## Phase 1, Part 4: Import Wizard (UI)

A step-by-step wizard accessible from the toolbar:

### Step 1: Choose source

```
How would you like to import data?

[📄 Upload CSV/Excel]     [🔗 Paste API JSON]     [📋 From Template]

Templates:
  Manufacturing Job Shop (Stafford-like)
  Healthcare Surgery Center (Acme-like)
  Sports League (HRMD-like)
```

Templates provide sample files the client can fill in — pre-formatted CSVs with the right columns and example data.

### Step 2: Map columns (if CSV)

The column mapper UI from Part 2.

### Step 3: Validate

```
Validation Results

✓ 25 resources — all valid
✓ 15 orders — all valid
⚠ 98 of 100 tasks valid — 2 warnings:
    Row 34: Task WO-1005-MILL references resource CNC-99 (not found)
    Row 67: Task WO-1008-ASSM has windowEnd before windowStart
✓ 12 state changes — all valid
✓ 8 products — all valid

[Fix Issues]  [Import Anyway (skip 2 invalid)]  [Cancel]
```

### Step 4: Import & Solve

```
Import complete!

25 resources, 15 orders, 98 tasks loaded.
2 tasks skipped due to validation errors.

[Solve Now]  [Review Data First]
```

---

## Phase 1, Part 5: Downloadable Templates

Pre-formatted CSV templates the client can fill in:

### Manufacturing template

```csv
Task Key,Task Name,Order Key,Duration (hours),Window Start,Window End,Priority,Resource Type,Preferred Resources,Predecessor
WO-001-CUT,Cut Frame,WO-001,1.5,2026-03-18 07:00,2026-03-23 17:00,30,Saw,"SAW-01",
WO-001-MILL,Mill Frame,WO-001,2.0,2026-03-18 07:00,2026-03-23 17:00,30,CNC,"CNC-01,CNC-02",WO-001-CUT
WO-001-WELD,Weld Frame,WO-001,3.0,2026-03-18 07:00,2026-03-23 17:00,30,Welder,"WLD-01,WLD-02",WO-001-MILL
```

### Healthcare template

```csv
Case Key,Case Name,Patient,Procedure,Duration (min),Window Start,Window End,Priority,Surgeon,Anesthesiologist,OR,Nurse
CASE-001,Knee Replacement,Smith J.,Orthopedic,120,2026-03-18 06:00,2026-03-22 18:00,URGENT,DR-SMITH,"AN-JONES,AN-GARCIA","OR-01,OR-02","RN-01,RN-02"
CASE-002,Appendectomy,Johnson A.,General,60,2026-03-18 06:00,2026-03-22 18:00,ELECTIVE,DR-JONES,"AN-JONES,AN-GARCIA","OR-01,OR-02","RN-01,RN-02"
```

Templates available at `GET /v1/data/templates/:templateKey` and downloadable from the Import Wizard.

---

## Security & Validation

- File size limit: 10MB per upload
- Row limit: 10,000 rows per entity type per upload
- Supported formats: CSV (UTF-8), TSV, XLSX (first sheet or named sheets)
- All uploads scoped to tenant (X-Tenant-Id header)
- Mapping profiles scoped to tenant
- No code execution in transforms — value maps and format strings only
- SQL injection impossible — data goes through the typed hydrator, not raw SQL

---

## Verification

### Direct API
- [ ] `POST /v1/state/sync` accepts full payload and rebuilds landscape
- [ ] Partial sync (only orders array) leaves other entities unchanged
- [ ] Validation errors return 400 with field-level messages
- [ ] Validation warnings don't block import
- [ ] Duplicate keys rejected
- [ ] Missing required fields rejected
- [ ] After sync, `POST /ctp/solve` works with the new data

### CSV Upload
- [ ] CSV, TSV, and XLSX files accepted
- [ ] Column mapper shows all columns with dropdown field selectors
- [ ] "Skip" option available for unmapped columns
- [ ] Preview shows first 5-10 rows with transforms applied
- [ ] Date format transform works (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, etc.)
- [ ] Value mapping works (A→10, B→30)
- [ ] Prefix/suffix transforms work
- [ ] Preview mode validates without importing
- [ ] Import creates entities in the engine

### Mapping profiles
- [ ] Profile saved after successful mapping
- [ ] Auto-detection matches on exact column fingerprint
- [ ] Fuzzy detection matches on >80% column overlap
- [ ] Saved profile auto-applies on next upload with same columns
- [ ] Profile CRUD endpoints work
- [ ] Profiles scoped to tenant

### Templates
- [ ] Manufacturing template downloadable and importable
- [ ] Healthcare template downloadable and importable
- [ ] Templates include example data that solves successfully

---

*Phase 1 build order: Published schema + sync endpoint (~2 hours), CSV upload + column mapper UI (~3 hours), mapping profile save/detect (~1 hour), import wizard (~1 hour), templates (~1 hour). The sync endpoint is useful immediately for API clients. The CSV upload is the onboarding story for non-technical clients.*

---
---

# Phase 2: WIP Sync — Actuals & Schedule State Updates

Keeps the engine's landscape in sync with reality on the floor. Clients push task progress, resource assignments, actual start/end times, and state changes. The engine incorporates these as constraints — completed work is fixed, in-progress work has reduced remaining duration, pinned work doesn't move.

**Why it matters:** CTP promises are only as good as the data. If the engine thinks CNC-01 is free at 2pm but it's actually running a job that started late and won't finish until 3pm, every promise based on CNC-01 availability is wrong.

---

## Phase 2, Part 1: What the Client Sends

### Task state updates

```json
{
  "taskUpdates": [
    {
      "key": "WO-1001-MILL",
      "wipState": "IN_PROCESS",
      "actualStart": "2026-03-18T08:15:00Z",
      "actualEnd": null,
      "percentComplete": 60,
      "remainingDuration": 2880,
      "actualResource": "CNC-01",
      "notes": "Running 15min behind due to setup issue"
    },
    {
      "key": "WO-1001-CUT",
      "wipState": "COMPLETED",
      "actualStart": "2026-03-18T07:00:00Z",
      "actualEnd": "2026-03-18T08:10:00Z",
      "percentComplete": 100,
      "actualResource": "SAW-01"
    },
    {
      "key": "WO-1002-WELD",
      "wipState": "ON_HOLD",
      "actualStart": "2026-03-18T09:00:00Z",
      "actualEnd": null,
      "percentComplete": 30,
      "holdReason": "Waiting for material delivery",
      "estimatedResumeTime": "2026-03-19T07:00:00Z"
    }
  ]
}
```

### Pinned tasks (floor commitments)

```json
{
  "pinnedTasks": [
    { "key": "WO-1001-ASSM", "pinned": true, "reason": "Committed to customer for Wednesday AM" },
    { "key": "WO-1003-WELD", "pinned": true, "reason": "Operator already prepped" }
  ]
}
```

### Resource status updates

```json
{
  "resourceUpdates": [
    {
      "key": "CNC-01",
      "status": "ACTIVE",
      "availableFrom": null,
      "note": null
    },
    {
      "key": "CNC-03",
      "status": "DOWN",
      "availableFrom": "2026-03-19T07:00:00Z",
      "note": "Spindle bearing replacement — back online tomorrow morning"
    },
    {
      "key": "FAB-JACK",
      "status": "LIMITED",
      "availableFrom": "2026-03-18T13:00:00Z",
      "note": "Morning meeting until 1pm"
    }
  ]
}
```

---

## Phase 2, Part 2: API Endpoints

### Full WIP sync

```
POST /v1/state/wip-sync
Content-Type: application/json
X-Tenant-Id: stafford-engineering

{
  "taskUpdates": [...],
  "pinnedTasks": [...],
  "resourceUpdates": [...],
  "timestamp": "2026-03-18T10:30:00Z"
}
```

All arrays are optional — send only what changed. The timestamp is used for staleness detection.

**Response:**

```json
{
  "status": "ok",
  "applied": {
    "taskUpdates": 3,
    "pinnedTasks": 2,
    "resourceUpdates": 2
  },
  "landscapeImpact": {
    "tasksNowFixed": 5,
    "remainingCapacityFreed": 7200,
    "resourcesUnavailable": 1,
    "rescheduleRecommended": true
  },
  "warnings": [
    "Task WO-1002-WELD is ON_HOLD — downstream tasks may need rescheduling",
    "CNC-03 DOWN — 4 tasks assigned to CNC-03 may need redirection"
  ]
}
```

### Single task update (lightweight)

```
PATCH /v1/state/tasks/:taskKey/wip
Content-Type: application/json

{
  "wipState": "IN_PROCESS",
  "actualStart": "2026-03-18T08:15:00Z",
  "percentComplete": 60,
  "actualResource": "CNC-01"
}
```

For shop floor terminals or barcode scan integrations — update one task at a time without a full sync.

---

## Phase 2, Part 3: How the Engine Uses WIP Data

### Task state mapping

| WIP State | Engine behavior |
|-----------|----------------|
| NOT_STARTED | Normal — solver can schedule, move, or unschedule |
| IN_PROCESS | Fixed — solver cannot move. Remaining duration = `remainingDuration` or `duration × (1 - percentComplete/100)`. Resource assignment locked to `actualResource`. Consumes capacity from `actualStart` to `actualStart + remainingDuration`. |
| ON_HOLD | Partially fixed — task stays assigned to its resource but doesn't consume capacity during the hold. Window adjusts: `windowStart = estimatedResumeTime` if provided. Solver can reschedule the remaining work after the hold lifts. |
| COMPLETED | Fully fixed — removed from solve. Resource capacity freed from `actualEnd` onward. Predecessor constraints satisfied for downstream tasks. |
| WAITING_NEXT | Between chain steps — predecessor complete, this task ready to start. Treated like NOT_STARTED but with a tightened window (start >= predecessor actualEnd). |
| MAINTENANCE | Resource-level — not a task state. Resource unavailable until `availableFrom`. |

### Remaining duration calculation

```typescript
function computeRemainingDuration(task: CTPTask, update: TaskWipUpdate): number {
  if (update.remainingDuration != null) return update.remainingDuration;
  const totalDuration = task.duration?.duration() ?? 0;
  const pctComplete = update.percentComplete ?? 0;
  return Math.max(0, totalDuration * (1 - pctComplete / 100));
}
```

### Window adjustment for in-progress tasks

```typescript
if (update.wipState === 'IN_PROCESS' && update.actualStart) {
  const actualStartW = CTPDateTime.fromDateTime(update.actualStart);
  const remaining = computeRemainingDuration(task, update);

  task.window.startW = actualStartW;
  task.window.endW = actualStartW + remaining + 60;

  task.capacityResources?.forEach(tr => {
    if (update.actualResource && tr.isPrimary) {
      tr.scheduledResource = update.actualResource;
    }
  });

  task.pinned = true;
  task.wipstate = CTPWipStateConstants.IN_PROCESS;
}
```

### Resource status handling

```typescript
if (update.status === 'DOWN') {
  const blockStart = CTPDateTime.fromDateTime(update.timestamp || DateTime.now().toISO());
  const blockEnd = update.availableFrom
    ? CTPDateTime.fromDateTime(update.availableFrom)
    : landscape.horizon.endW;

  resource.addUnavailableWindow(blockStart, blockEnd, 'MAINTENANCE');
}
```

---

## Phase 2, Part 4: CSV Format for WIP Updates

For clients who update via file upload rather than API:

```csv
Task Key,Status,Actual Start,Actual End,% Complete,Remaining Hours,Actual Resource,Notes
WO-1001-CUT,COMPLETED,2026-03-18 07:00,2026-03-18 08:10,100,,SAW-01,
WO-1001-MILL,IN_PROCESS,2026-03-18 08:15,,60,0.8,CNC-01,Running 15min behind
WO-1002-WELD,ON_HOLD,2026-03-18 09:00,,30,,FAB-JACK,Waiting for material
WO-1003-CUT,NOT_STARTED,,,,,,
```

Uses the same column mapper and mapping profile infrastructure from Phase 1.

---

## Phase 2, Part 5: Sync Frequency

| Client type | Recommended pattern | Mechanism |
|-------------|-------------------|-----------|
| Manual (spreadsheet shops) | Once per shift — morning update | CSV upload or UI manual entry |
| Semi-automated (barcode/scan) | Per task state change | `PATCH /state/tasks/:key/wip` |
| Automated (MES/ERP connected) | Every 5-15 minutes | `POST /state/wip-sync` on a timer |
| Real-time (IoT/PLC) | On event | Webhook or `PATCH` per event |

The engine doesn't poll — the client pushes.

---

## Phase 2, Part 6: Re-solve After WIP Sync

The response includes `rescheduleRecommended: true` when actuals differ significantly from the plan:

- A task that was scheduled at 8:00 actually started at 9:30 (>1 hour drift)
- A resource went down with tasks assigned to it
- A task went ON_HOLD, blocking downstream chain tasks
- Completed tasks freed significant capacity (>4 hours on a bottleneck resource)

The client calls `POST /ctp/solve` with `preserveLandscape: true` to reschedule only NOT_STARTED tasks while respecting all WIP constraints.

---

## Phase 2 Verification

### Task state updates
- [ ] COMPLETED tasks excluded from solve, capacity freed
- [ ] IN_PROCESS tasks pinned with remaining duration and locked resource
- [ ] ON_HOLD tasks have adjusted windows based on estimatedResumeTime
- [ ] WAITING_NEXT tasks have tightened windows from predecessor actuals
- [ ] Percent complete correctly reduces remaining duration
- [ ] Explicit remainingDuration overrides calculated value

### Resource updates
- [ ] DOWN resource blocks availability in the correct time range
- [ ] LIMITED resource adjusts availability start
- [ ] Tasks on DOWN resources flagged in warnings (not auto-unscheduled)
- [ ] ACTIVE resource restores normal availability

### Solve integration
- [ ] `solve()` after WIP sync respects all fixed tasks (COMPLETED, IN_PROCESS)
- [ ] Solver only schedules NOT_STARTED tasks
- [ ] Remaining duration used for in-progress tasks (not original duration)
- [ ] Downstream chain tasks have correct windows from predecessor actuals
- [ ] `rescheduleRecommended` flag set correctly

### CSV upload
- [ ] WIP CSV accepted through the column mapper
- [ ] Status values map correctly (case-insensitive)
- [ ] Actual times parsed with tenant timezone
- [ ] Remaining hours converted to seconds

### Edge cases
- [ ] Task updated to COMPLETED that was never scheduled
- [ ] Task updated to IN_PROCESS on a different resource than scheduled
- [ ] Multiple tasks IN_PROCESS on the same resource (handle gracefully)
- [ ] WIP sync with empty arrays (no-op, no error)
- [ ] WIP sync for a task key that doesn't exist (warning, not error)

---

*Phase 2 build order: Task state mapping + WIP constants (~1 hour), `POST /state/wip-sync` endpoint (~1.5 hours), `PATCH /state/tasks/:key/wip` single-task endpoint (~30 min), resource status handling (~1 hour), remaining duration + window adjustment (~1 hour), solve integration testing (~30 min). CSV format uses the Phase 1 upload/mapper infrastructure.*

---
---

# Summary

| Phase | What | Effort | Endpoint |
|-------|------|--------|----------|
| Phase 1 | Inbound data — schema + sync + CSV upload + column mapper + templates | ~8 hours | `POST /v1/state/sync`, `POST /v1/data/upload` |
| Phase 2 | WIP sync — task actuals + resource status + re-solve trigger | ~5.5 hours | `POST /v1/state/wip-sync`, `PATCH /v1/state/tasks/:key/wip` |
| **Total** | | **~13.5 hours** | |

Phase 1 is useful alone — API clients can push data and solve. Phase 2 makes the schedule trustworthy over time. Build Phase 1 first, Phase 2 when clients start running in production.
