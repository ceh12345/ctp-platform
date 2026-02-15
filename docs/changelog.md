# CTP Platform — Development Changelog

Audit trail of features, fixes, and design decisions made during development.

---

## Phase 1: Monorepo Scaffold & Engine

**Commit:** `3005b33` — Scaffold TypeScript monorepo with npm workspaces

- Created `packages/engine` and `packages/api` workspace layout
- ES2022 target for both packages
- Engine is a composite TypeScript project with `outDir: dist`

---

## Phase 2: Config Store & State Hydration

**Commits:** `7afaa99`, `4e1a6b6`

- Built `IConfigStore` interface with `FileConfigStore` implementation
- Flat-file tenant config under `config/tenants/<tenantId>/`
- Files: tenant.json, schemas/, scoring.json, settings.json, terminology.json, horizon.json, data/ (resources, tasks, calendars, state-changes)
- State sync endpoint `POST /v1/state/sync` hydrates the scheduling landscape from config files
- Lazy-cached reads with `reload()` support

---

## Phase 3: Type-Safe Attributes & Solve Endpoint

**Commits:** `a2045c2`, `3616f44`

- Added typed attribute system to engine entities (enum, string, number, date types with validation)
- `POST /v1/ctp/solve` endpoint with task filtering (by keys, attribute filter, or all)
- Response includes per-task results, resource utilization, feasibility rate

---

## Phase 4: Product BOM, Orders & Materials

**Commits:** `3c53778`, `f2b3e1b`, `4e01bbd`

- Extended engine with product BOM: output products, input materials, scrap rates
- Order fill tracking: tasks linked to orders via `linkId`, net output quantity accumulation
- Material consumption tracking with gross quantity (including scrap)
- Created "Precision Parts Co." demo dataset with 25 tasks across 5 work orders
- Enriched solve response with `orders[]` (fill rates) and `materials[]` (consumption status)
- Added `DataModule` with CRUD endpoints for config data

---

## Phase 5: React Dashboard

**Commits:** `d0ba810`, `6d0bb47`, `38c4484`, `8512d3d`

- Scaffolded `packages/web` with Vite + React + TypeScript
- Single-file dashboard (`App.tsx`) with dark theme, inline styles
- Tabs: Overview, Schedule (Gantt + Operation List), Resources, Orders, Materials, Conflicts
- Wired all tabs to live API data from solve response
- Fixed: tenant default to demo-manufacturing, empty POST body handling
- Fixed: percentage scale (0-100 not 0-1), product name display, tab badges with counts

---

## Phase 6: Resource Modes & Detail Panels

**Commit:** `f6705df`

- Added resource mode support (ON / OFF / TRACK) to engine and API
- Task detail side panel: click a Gantt bar to see full task info, assigned resources, materials, errors
- Resource detail side panel: click a resource lane to see utilization, task agenda, calendar summary

---

## Phase 7: Color Config, Resource Hierarchy, Gantt Zoom, Feasibility Fix

**Commit:** `0764333`

### Tenant Color Configuration
- Created `config/tenants/demo-manufacturing/colors.json` with task, resource, and status color palettes
- Added `getColors()` to config layer (`IConfigStore` -> `FileConfigStore` -> `ConfigService`)
- Added `GET /v1/data/colors` endpoint
- Colors included in solve response

### Resource Hierarchy Grouping
- Added `hierarchy` field to resource config (level1=workCenter, level2=line)
- Gantt lanes grouped by Work Center with header rows
- Overview utilization bars grouped by Work Center

### Gantt Zoom Controls
- Zoom levels: 3 Hr, Day, 3 Day, Week, 2 Week, Fit
- Prev/Today/Next navigation for scrolling through time
- Sub-day zoom snaps to hour boundaries with 30-min axis ticks

### Feasibility KPI Fix
- Setup/changeover tasks (PROCESS CHANGE, SETUP, TEARDOWN) excluded from feasibility count
- Summary now reports process tasks vs setup tasks separately
- Task `type` and `subType` fields added to API response

---

## Phase 8: Terminology, Locale & UI Polish

**Commit:** `3aa6dcf`

### Configurable Terminology
- Created `terminology.json` — flat `Record<string, string>` with ~40 domain label mappings
- `t(key, fallback)` helper replaces all hardcoded labels (task->Operation, order->Work Order, etc.)
- `GET /v1/data/terminology` endpoint

### Locale-Aware Formatting
- Created `locale.json` with locale, timezone, date/number formats, and action labels
- `fmtDate`, `fmtDateShort`, `fmtNum` use tenant locale and timezone
- `act(key, fallback)` helper for action button labels (solve->Run Schedule, etc.)
- `GET /v1/data/locale` endpoint

### Task Coloring Fix
- Engine produces `type="PROCESS CHANGE"` (with space) — updated `getTaskColor()` to handle this
- Changed from `byProcess` (keys didn't match task process values) to `byNamePattern` matching on task name substrings (Machine, Deburr, Assemble, QC, Pack)

### Material Shortage Tooltips
- `HoverTooltip` component with cursor-following tooltip
- Shortage detail on Material Status badge and Remaining column (date, quantity, triggering task)
- Incoming stock tooltip on Incoming column

### Bug Fixes
- Material/Order status columns now sort correctly (pre-computed `_status` and `_net` sort keys)
- "Operation List" sub-tab crash: variable shadowing (`t` used as both terminology function and `.map()` loop variable) — renamed loop var to `tk`
- API restart required after colors.json change (FileConfigStore caches on first read)

### Gantt Improvements
- Added 3-hour zoom level with 30-min axis ticks
- Default view changed from Fit to Day
- Day view: clean hour labels with am/pm only at 6-hour marks (12am, 6am, 12pm, 6pm)
- Time scale text changed from `textDim` to `textMuted` for readability

---

## Phase 9: Table Filtering — Search, Status Toggles, and Column Filters

**Commit:** *(pending)*

### useFilter Hook
- Reusable client-side filter hook that pairs with the existing `useSort` hook
- Free text search across all string/number fields in a row
- Status toggle filtering via configurable `statusDeriver` function
- Per-column dropdown filters with distinct value checkboxes (multi-select)
- `activeFilterCount` and `clearAll` for UX feedback
- Returns `filtered` array that feeds into `useSort.sorted()`

### Filter UI Components
- `SearchBox` — text input with search icon, clear button, dark theme styling
- `StatusToggles` — row of toggle buttons with optional counts and color coding
- `ColumnFilter` — dropdown triggered from column header, shows distinct values with checkboxes, backdrop-close, clear button
- `FilterBar` — combines SearchBox + StatusToggles + active filter count + "Clear all" button + result count
- `SortHeader` updated to accept optional `filterProps` for inline column filter dropdowns

### TaskTable (Operation List)
- Search across all task fields (key, name, order, product, resource)
- Status toggles: All / Scheduled / Infeasible (with counts)
- Column filters on: Order, Product, Resource
- Pre-computed `_resource` and `_status` fields for filtering/sorting

### OrderTable
- Search across order fields
- Status toggles: All / On Track / At Risk / Late (with counts)
- Column filters on: Product, Priority

### MatTable (Materials)
- Search across material fields
- Status toggles: All / Covered / At Risk / Shortage (with counts)
- Column filter on: Unit

### GanttChart
- Resource search box (filter by resource name or key)
- Work Center toggle buttons (click to show/hide entire work centers, strike-through styling)
- "Hide empty" checkbox (hides resources with no scheduled tasks in current view)
- Resource count indicator ("3 of 5 resources")

### ConflictsTab
- Search conflicts (task name, key, order ref, detail text)
- Severity toggles: All / Critical / Warning (with counts)
- Reason toggles: All Reasons / Capacity / Dependency / Material
- Result count ("4 of 7")

---

## Phase 10: Quick Fixes & Conflict Severity

**Commits:** `232cf9d`, `6b4a8a4`, `6ed3fd9`

### Color & Scale Fixes
- Removed old `getProductColor()` — all task coloring now uses `getTaskColor()` from tenant colors config
- Ring component auto-detects 0-1 vs 0-100 scale (`pct > 1 ? pct / 100 : pct`)
- `deriveOrderStatus` normalizes fillRate to handle both scales
- Gantt time axis uses tenant locale/timezone instead of hardcoded `'en-US'`/`'UTC'`

### Gantt Info Tooltip
- Added `HoverTooltip` info icon next to "Hide empty" checkbox explaining its behavior

### Material Conflict Severity Refinement
- Conflict severity now driven by material resource mode (ON vs TRACK)
- Material mode ON + shortage → **Critical**: "Cannot execute: short X of Material for Task"
- Material mode TRACK + shortage → **Warning**: "Inventory alert: Material will be short..."
- At-risk materials → **Warning** with stock details (on hand, net after incoming)
- Trigger task identified via `firstNeedTaskKey` or first affected task
- `materialMode` field added to conflict objects for UI filtering
