# Sprint 11: Process Category

**What it does:** Adds a `category` field to processes that flows through to the task table as a filterable column. Replaces the current low-value "Process Type" column with a meaningful grouping: Sport (HRMD), Specialty (Healthcare), Work Center (Manufacturing). Small engine change + UI column update.

**Prompt files:** `ui-11.1-process-category.md` (this file covers both engine and frontend — it's small enough for one prompt)

**Scenarios:** All — this is a cross-cutting filter/display improvement  
**Depends on:** Nothing (Sprint 3 filter infrastructure already exists)

---

## Why

The task table currently has a "Process Type" column showing the raw `process` key (e.g. `baseball-majors`, `cnc-rough`). This is too granular to be useful as a filter — there are 8-15 distinct values. What users want is a higher-level grouping:

| Vertical | Category values | User question |
|----------|----------------|---------------|
| Sports | Baseball, Flag Football, Pickleball | "Show me just baseball games" |
| Healthcare | Orthopedic, Ophthalmology, Neurology, Cardiology | "Show me just ortho cases" |
| Manufacturing | Machining, Assembly, Quality, Packaging | "Show me just machining tasks" |

The `category` field on processes provides this. Each process belongs to exactly one category. The UI column becomes a 3-5 value dropdown filter instead of 15+ raw process keys.

---

## Part 1: Engine Changes

### 1a. Add `category` to CTPProcess

In `process.ts`, add a `category` field:

```typescript
export class CTPProcess extends CTPKeyEntity implements IProcess {
  tasks: CTPTaskList | undefined;
  category: string | undefined;  // NEW

  constructor(n: string) {
    super('', n, n);
    this.tasks = new CTPTaskList();
    this.category = undefined;
  }
}
```

### 1b. Populate category from processes.json in config loader

Wherever processes.json is loaded (likely in `ConfigService` or `StateService`), read the `category` field:

```typescript
// When loading process config
const process = new CTPProcess(p.name);
process.key = p.key;
process.category = p.category ?? null;  // NEW
```

### 1c. Include processCategory in task response

In `ctp.service.ts` → `extractResults()`, look up the task's process to get its category. Add it to the task result object.

Find the line where `process` is set on the task result:

```typescript
const process = task.process ?? null;
```

After it, add:

```typescript
// Look up process category
let processCategory: string | null = null;
if (task.process && landscape.processes) {
  const proc = landscape.processes.getEntity(task.process);
  if (proc) {
    processCategory = (proc as any).category ?? null;
  }
}
```

Then add `processCategory` to the `taskResult` object:

```typescript
const taskResult: any = {
  key: task.key,
  name: task.name,
  // ... existing fields ...
  process,
  processCategory,  // NEW — "Baseball", "Orthopedic", "Machining", etc.
  type: task.type || CTPTaskTypeConstants.PROCESS,
  subType: task.subType ?? null,
  // ...
};
```

### 1d. Update processes.json for all tenants

**Manufacturing tenant** — update existing processes.json to add category:

```json
[
  { "key": "cnc-rough", "name": "CNC Rough Cut", "category": "Machining" },
  { "key": "cnc-finish", "name": "CNC Finish", "category": "Machining" },
  { "key": "assembly-main", "name": "Main Assembly", "category": "Assembly" },
  { "key": "assembly-sub", "name": "Sub Assembly", "category": "Assembly" },
  { "key": "qc-visual", "name": "Visual Inspection", "category": "Quality" },
  { "key": "qc-dimensional", "name": "Dimensional Check", "category": "Quality" },
  { "key": "packaging", "name": "Packaging", "category": "Packaging" }
]
```

If the manufacturing tenant has different process keys, just add `"category"` to each existing entry. Group logically by work center type.

**Healthcare tenant** — same pattern:

```json
[
  { "key": "knee-replacement", "name": "Knee Replacement", "category": "Orthopedic" },
  { "key": "hip-replacement", "name": "Hip Replacement", "category": "Orthopedic" },
  { "key": "rotator-cuff", "name": "Rotator Cuff Repair", "category": "Orthopedic" },
  { "key": "cataract", "name": "Cataract Surgery", "category": "Ophthalmology" },
  { "key": "lasik", "name": "LASIK", "category": "Ophthalmology" },
  { "key": "spinal-fusion", "name": "Spinal Fusion", "category": "Neurology" },
  { "key": "carpal-tunnel", "name": "Carpal Tunnel Release", "category": "Neurology" }
]
```

**HRMD Sports tenant** — already has categories in the prompt:

```json
[
  { "key": "baseball-tball", "name": "T-Ball Game", "category": "Baseball" },
  { "key": "baseball-coachpitch", "name": "Coach Pitch Game", "category": "Baseball" },
  { "key": "baseball-minors", "name": "Minors Game", "category": "Baseball" },
  { "key": "baseball-majors", "name": "Majors Game", "category": "Baseball" },
  { "key": "flag-football-k2", "name": "Flag Football K-2", "category": "Flag Football" },
  { "key": "flag-football-35", "name": "Flag Football 3-5", "category": "Flag Football" },
  { "key": "flag-football-68", "name": "Flag Football 6-8", "category": "Flag Football" },
  { "key": "pickleball-open", "name": "Pickleball Open Doubles", "category": "Pickleball" },
  { "key": "pickleball-dropin", "name": "Pickleball Drop-In Reservation", "category": "Pickleball" }
]
```

---

## Part 2: Terminology

Add a `processCategory` entry to the terminology mappings so the UI column header adapts per tenant.

**Manufacturing terminology.json** — add:
```json
"processCategory": "Work Center"
```

**Healthcare terminology.json** — add:
```json
"processCategory": "Specialty"
```

**HRMD Sports terminology.json** — add:
```json
"processCategory": "Sport"
```

The UI reads `terminology.processCategory` for the column header. Falls back to "Category" if not set.

---

## Part 3: Frontend Changes

### 3a. Replace "Process Type" column with "Category" column

In the task table component, find the column that currently displays the raw `process` field. Replace it:

**Before:**
```tsx
{ header: 'Process Type', accessor: 'process' }
```

**After:**
```tsx
{ 
  header: terminology?.processCategory || 'Category', 
  accessor: 'processCategory',
  filterable: true 
}
```

### 3b. Add dropdown filter on the Category column

This column should use the same Sprint 3 column filter pattern already in place for Resource, Order, etc. Build the distinct values from the solve response:

```typescript
const categories = [...new Set(
  tasks.map(t => t.processCategory).filter(Boolean)
)].sort();
```

Render as a multi-select dropdown filter. For the HRMD tenant this shows:
- ☑ Baseball
- ☑ Flag Football  
- ☑ Pickleball

For healthcare:
- ☑ Orthopedic
- ☑ Ophthalmology
- ☑ Neurology

### 3c. Gantt color coding (optional enhancement)

If the Gantt currently colors by process, consider coloring by `processCategory` instead (or offering a toggle). This makes the Gantt much more readable — all baseball games one color, all pickleball another — rather than 8+ colors for individual process types.

---

## Part 4: Verification

After implementing:

- [ ] `processCategory` appears on every task in the solve response JSON
- [ ] Manufacturing tenant: tasks show "Machining", "Assembly", "Quality", etc.
- [ ] Healthcare tenant: tasks show "Orthopedic", "Ophthalmology", etc.
- [ ] HRMD Sports tenant: tasks show "Baseball", "Flag Football", "Pickleball"
- [ ] Task table column header reads from terminology (e.g. "Sport" for HRMD)
- [ ] Column filter dropdown shows 3-5 distinct category values
- [ ] Filtering by category correctly filters the task table
- [ ] Tasks with no process or no category show blank/null gracefully
- [ ] Existing process field still available in task detail panel for drill-down

---

## Size Estimate

- Engine: ~15 lines changed across 2-3 files
- Config: Add `category` to each tenant's processes.json + terminology
- Frontend: Replace one column definition, reuse existing filter pattern
- Total: ~30 minutes CC work
