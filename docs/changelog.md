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
