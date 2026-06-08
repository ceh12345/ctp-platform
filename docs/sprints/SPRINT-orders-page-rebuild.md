# SPRINT: Orders Page Rebuild — Excel-style Column Filters

**Status:** Draft for review
**Branch:** main (additive — UI work, no engine surface area)
**Author:** Chris
**Purpose:** Replace the existing Orders page with a filter-and-explore grid that exposes the WorkOrderGroup hierarchy (Customer → Project → Sales Order → Job) and entity attributes to Stafford and future tenants. Visibility-first — proves the mapping works against real data, sets up subsequent solver conversations.

---

## Why this sprint exists

The Orders page is currently a flat list of work orders with no visibility into the hierarchy above the WO level. Stafford's `WorkOrderGroup` data (Customer, Project, Sales Order, Job rollups, attributes) is in the model and exposed via the API, but planners have no UI to see, filter, or explore it. This sprint closes that gap.

Two outcomes this sprint earns:

1. **Stafford can see their own data structure end to end.** Open the page, filter to "Customer = CEM," see every WO under that customer, with full hierarchy and attribute context on every row.
2. **The page becomes the conversation device for the next Stafford meeting.** Once Kaleb can filter to a Project and see which WOs are AT_RISK, conversations about solver behaviour become concrete instead of abstract.

Explicitly *not* the goal of this sprint: assessing solver quality at parent levels (project on-time rollups, AvgScore-weighted feasibility, etc.). Those are real future work, but require the chain-aware solver to land first so the rollups have meaningful data. Defer.

---

## Design principles

1. **Column filters are the primary interaction mode.** Every grid column has a filter affordance in its header — popover with search + multi-select checkboxes against distinct values. Filters compose; the visible row set is the AND of all active column filters. No separate filter pane, no cascading dropdowns, no dedicated hierarchy navigator. The grid with column filters *is* the navigation.

2. **Excel-shaped, because the audience lives in Excel.** Stafford's domain experts (Kaleb, Allan) navigate spreadsheets daily. Column filters with checkbox lists is the interaction pattern they already know. Zero learning curve.

3. **Filter dropdowns scope to currently visible data.** Open the Customer filter after applying Strategy=JIT, and the dropdown shows only Customers that have JIT work. Matches Excel's behaviour, matches user expectation.

4. **Display toggles, not different pages.** Group-by-Job is a display mode of the same grid, not a separate view. Tree view is deferred entirely.

5. **Read-only.** No write actions, no inline editing, no bulk operations.

---

## Backend

Two new endpoints.

### `GET /v1/orders`

Returns work orders matching the active filter set, with full attribute and hierarchy context on each row.

**Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `tenant` | string | Tenant scope, as elsewhere |
| `filter[<name>]` | string (multi-value) | One or more equality filters per attribute/column. Multiple values for the same name → IN semantics. Multiple names → AND across names. |
| `sortBy` | string | Column name. Defaults to `dueDate`. |
| `sortDir` | `asc` \| `desc` | Defaults to `asc` |
| `page` | integer | 1-indexed. Defaults to 1. |
| `pageSize` | integer | Defaults to 100, max 500. |

**Filter examples:**
- `?filter[Customer]=CEM` — single value, one column
- `?filter[Customer]=CEM&filter[Customer]=Pacific Engineering Ltd` — IN on Customer
- `?filter[Customer]=CEM&filter[Strategy]=JIT&filter[Status]=AT_RISK` — AND across columns

**Response shape:**

```json
{
  "totalCount": 714,
  "filteredCount": 47,
  "page": 1,
  "pageSize": 100,
  "rows": [
    {
      "key": "26860",
      "name": "Single Paddle Vacuum Mixer",
      "groupKey": "15912",
      "parentOrderKey": null,
      "isHead": true,
      "dueDate": "2026-11-27T00:00:00+13:00",
      "status": 1,
      "statusLabel": "AT_RISK",
      "completionRatio": 0.42,
      "quantityPlanned": 2,
      "quantityProduced": 0,
      "hierarchies": [
        { "slot": 1, "name": "Customer",    "value": "FISHER & PAYKEL HEALTHCARE" },
        { "slot": 2, "name": "Project",     "value": "DE-REELER & DOSING PARTS" },
        { "slot": 3, "name": "SalesOrder",  "value": "00012387" },
        { "slot": 4, "name": "Family",      "value": "S-ENG" }
      ],
      "attributes": [
        { "name": "Strategy",           "value": "JIT" },
        { "name": "JobType",            "value": "C" },
        { "name": "CustomerSource",     "value": "genius-master" },
        { "name": "ProjectManagerCode", "value": "025" },
        { "name": "ProjectManagerName", "value": "JULIAN FORD" }
      ]
    }
  ]
}
```

Notes:
- `totalCount` is total in the tenant (unfiltered), `filteredCount` is matching the current filter. UI uses both for "Showing N of M work orders" (M tracks the current data refresh; ~714 for engineering-test).
- Hierarchy values are also present in `attributes` per the mirror — fine, expected, consistent with the design principle.
- All filterable columns must be resolvable to a single value per row (either a direct field, a hierarchy slot value, or an attribute). The endpoint doesn't filter on computed fields.

### `GET /v1/orders/distinct`

Returns distinct values for a single column, scoped to the current filter set.

**Query parameters:**

| Param | Type | Notes |
|---|---|---|
| `tenant` | string | Tenant scope |
| `column` | string | The column to enumerate distinct values for. Required. |
| `filter[<name>]` | string (multi-value) | Filters *other than* the requested column. Excel-style scoping. |
| `search` | string | Optional substring filter on the values returned. Used for the filter dropdown's search box. |
| `limit` | integer | Defaults to 100, max 500. |

**Response shape:**

```json
{
  "column": "Customer",
  "values": [
    { "value": "CEM International P/L (NZ A/C)", "count": 142 },
    { "value": "Pacific Engineering Ltd", "count": 188 },
    { "value": "Tasman Industries", "count": 201 },
    ...
  ],
  "truncated": false
}
```

Notes:
- `count` is the number of rows with this value *under the current filter set*. Lets the UI show counts in the checkbox list — useful context.
- `truncated: true` indicates more values exist; UI can show a "showing first N — refine search to narrow" hint.
- The `filter` params exclude the requested column. If the user has filtered Customer=CEM and opens the Customer dropdown, they should see all Customers (not just CEM) — that's how Excel works. The implementation strips the requested column's filter when computing distincts for that column.

### Backend performance considerations

Both endpoints are read-only attribute queries against the entity store. Should be sub-100ms for Stafford's current scale (~714 orders / 279 groups). The attribute mirror keeps queries flat — no joins, no recursion. If performance is an issue at larger scale, indexing on commonly filtered columns (Customer, Project, Status) is the obvious lever.

---

## UI

A single grid component replacing the existing Orders page. Toolbar above, grid below, pagination at the bottom.

### Toolbar

Left-to-right:

- **View toggle:** `List` | `Grouped by Job`. Single-select segmented control.
- **Active filter summary:** "3 filters active" with a "Clear all" button. Hidden when no filters.
- **Row count:** "Showing N of M work orders." Updates as filters change.

No search box on the toolbar. Per-column filters handle search via their own dropdown search.

### Grid columns

Default column set, in order:

| Column | Source | Filterable | Sortable | Notes |
|---|---|---|---|---|
| Customer | hierarchy slot 1 | ✓ | ✓ | Real Genius `CustomerName`; `[Auto] …` prefix marks synthesised values (the 11 null-customer Jobs that fall back to JobType-derived buckets — see notes below) |
| Project | hierarchy slot 2 | ✓ | ✓ | |
| Sales Order | hierarchy slot 3 | ✓ | ✓ | |
| Family | hierarchy slot 4 | ✓ | ✓ | Product family (e.g. `S-ENG`, `S-SUB`, `M-OEM`); `null` = "(no Family)" |
| Job | `groupKey` (or group `name`) | ✓ | ✓ | Display shows group name; sort/filter uses key |
| WO | `key` | — | ✓ | High cardinality (~700 distinct in WORK7) — filtering by exact WO key isn't a useful column-filter mode; use sort + search if needed. See OI-7. |
| Description | `name` | — | ✓ | Free text, no filter |
| Status | `statusLabel` | ✓ | ✓ | Numeric `status` underlies sort order |
| Due Date | `dueDate` | ✓ | ✓ | Filter is multi-select on date values for v1; date-range picker is post-v1 |
| Completion | `completionRatio` | — | ✓ | Display as % |
| Qty Planned | `quantityPlanned` | — | ✓ | |
| Qty Produced | `quantityProduced` | — | ✓ | |
| Strategy | attribute `Strategy` | ✓ | ✓ | |
| Customer Source | attribute `CustomerSource` | ✓ | ✓ | `genius-master` (real) vs `auto-from-JobType` (synthesised) — filter to isolate the auto-assigned customer cases |
| Project Manager | attribute `ProjectManagerName` | ✓ | ✓ | |
| Job Type | attribute `JobType` | ✓ | ✓ | |

Column visibility is fixed for v1. Tenant-configurable column sets, user-toggleable hidden columns — deferred.

### Filter dropdown behaviour

Click the filter icon (▾ or funnel) in a column header → popover opens.

Popover layout:

```
┌──────────────────────────────────────────┐
│  [search...]                          [×] │
├──────────────────────────────────────────┤
│  ☑ CEM International P/L (NZ A/C)  142  │
│  ☑ Pacific Engineering Ltd         188  │
│  ☐ Tasman Industries               201  │
│  ☐ Bayside Manufacturing            89  │
│  ☐ Southern Cross Machining        336  │
├──────────────────────────────────────────┤
│  [Select all]  [Clear]    [Cancel] [Apply]│
└──────────────────────────────────────────┘
```

- Search box at top filters the value list as the user types.
- Each value shows its count under the current other-column filter set.
- Checkbox list — multi-select.
- Select all / Clear shortcuts.
- Cancel discards changes; Apply commits the filter and closes the popover.
- Active filter is visually indicated on the column header (filter icon highlighted, or column header in accent colour).

### Group-by-Job mode

When `Grouped by Job` is selected, the grid inserts a summary row above each Job's work orders:

```
▾ Job 15912: MI 252208 - 2 x CHDV3500 / Single Paddle Vacuum Mixer    AT_RISK  Due Nov 27   42%
    26860  Single Paddle Vacuum Mixer    AT_RISK   Nov 27  ...
    26861  Rotor Assembly                ON_TRACK  Nov 20  ...
    26862  Shaft Assembly                ON_TRACK  Nov 18  ...
▾ Job 16996: Coffee Roaster Assy Jack R                              ON_TRACK Due Dec 15   18%
    25508  Coffee Roaster Body           ON_TRACK  Dec 15  ...
```

- Summary row shows: Job key, Job name, rolled-up status (from `WorkOrderGroup.statusLabel`), Job `sourceEnd` (due date), Job `completionRatio`.
- Triangle (▾ / ▸) toggles expand/collapse for that Job.
- Filters apply at the WO level; if all WOs in a Job are filtered out, the Job summary row is also hidden.
- Default state: all Jobs collapsed. Performance and scanning win at this default.
- Sort order: in grouped mode, the primary sort applies to Job summary rows (sort by Job's Due Date sorts the Jobs by their `sourceEnd`). Within a Job's WO rows underneath, the secondary sort is `key` ascending — chain order isn't a sort key for v1 because head→tail ordering belongs to the Schedule tab, not the read-only Orders grid.

### Empty states

- **No data:** "No work orders in this tenant."
- **No matches:** "No work orders match these filters." with a "Clear all filters" button.
- **Loading:** standard skeleton.

### Error states

The app already has a shared API layer (`api()` + `ApiError` carrying `code` / `category` / `status` / a friendly `message`, from `ui-14-error-handling`). There is **no global error toast yet** — errors are shown per-component inline (the `setErrorMsg` convention used by the Optimize tab et al.). The grid reuses `ApiError.message` verbatim; it does **not** author its own error copy.

- **List load failure (`GET /v1/orders`):** inline error banner above the grid showing `ApiError.message`, with a **[Retry]** that re-fires the current URL query (filters / sort / page preserved). Visually distinct from the "No matches" empty state — a failure is not zero results.
- **Keep last-good on filter change:** if a filter / sort / page change request fails, keep the previously loaded rows visible beneath the banner instead of clearing to blank. The planner keeps context and can retry or adjust.
- **First-load failure (no prior rows):** banner replaces the grid body (nothing good to keep); [Retry] re-fires.
- **Distinct load failure (`GET /v1/orders/distinct`):** the affected filter popover shows an inline "Couldn't load values. [Retry]" *inside the popover*; the rest of the grid and other popovers are unaffected.

**Coordination with `ui-22-error-handling`:** that sprint introduces standardised frontend error presentation (shared toasts / banners). If it lands, the grid's inline banner adopts the shared component. The grid-specific behaviours here — retry re-firing URL state, keep-last-good on filter change, popover-local distinct errors — are presentation-independent and remain either way.

### Row interaction

Click any row → existing work order detail panel/route (no change to existing detail UX). Click on a Job summary row → existing job detail panel if one exists, otherwise a no-op for v1 (deferred — see out-of-scope).

### Pagination

Standard. Page size 100, configurable up to 500 via dropdown. Page numbers + prev/next.

### Filter / sort / page state — URL search params

All grid state lives in the URL search params, so the view is the URL:

| Param | Shape | Notes |
|---|---|---|
| `filter.<Column>` | comma-joined value list | E.g. `?filter.Customer=FISHER%20%26%20PAYKEL%20HEALTHCARE,CEM` |
| `sortBy` | column name | Defaults to `dueDate` |
| `sortDir` | `asc` \| `desc` | Defaults to `asc` |
| `page` | integer | 1-indexed; defaults to 1 |
| `pageSize` | integer | Defaults to 100 |
| `view` | `list` \| `grouped` | Defaults to `list` |

Implications:
- Browser back/forward step through filter changes.
- Sharing a view is `copy URL`. Recreates exactly.
- Page reload preserves state. No localStorage needed.
- Named "saved views" remain out of scope — the URL is the saved view.
- Pushing state to history is debounced on filter dropdown Apply, not on every checkbox toggle, to avoid history pollution.

### Synthesised customer note

The `synthetic-customer mode` is gone (replaced in the mapping rewrite by real Genius `CustomerName` for jobs that have it, plus a deterministic `[Auto] …` fallback for jobs where source `CustomerName` is null). Each order carries an attribute `CustomerSource` with one of:

- `genius-master` — real Genius customer
- `auto-from-JobType` — fallback bucket derived from `JobType` (e.g. `[Auto] Internal — Stock` for stock-build jobs)

When any rows in the current filtered set have `CustomerSource = auto-from-JobType`, render a small inline notice above the grid:

> *N of M visible work orders show synthesised customer labels prefixed with `[Auto]`. Their source records had no Customer field, so they were bucketed by JobType. Filter Customer Source = `auto-from-JobType` to isolate them.*

Counts update with the filter set. Hides when zero auto rows are visible.

### Keyboard & accessibility

Keyboard operability, focus management, and ARIA conventions are an **app-wide design decision, not a per-page one** — the same way error *presentation* defers to `ui-22-error-handling`. This sprint does **not** define a bespoke a11y model; the filter popover and grouped rows inherit whatever global keyboard/focus/ARIA convention the app adopts. If no such convention exists yet, that is its own decision/sprint (recommend one) and should not be improvised here. The only page-specific note: the new interactive surfaces this convention will apply to are the column-header filter popover and the grouped ▾/▸ summary rows.

### Visual spec (reuse existing vocabulary)

Extend the app's existing visual language; do not introduce a new one.

**Status column — the page's primary scannable signal:**
- Render via the existing status-chip component and `statusColor()` (`App.tsx:388`), using the `C` palette.
- Extend `statusColor()` to cover the six `WorkOrderGroupStatus` values with deliberate semantics:

  | Status | Treatment |
  |---|---|
  | `ON_TRACK` | green (existing "ok") |
  | `AT_RISK` | amber / "warn" |
  | `LATE` | red (`C.red`) |
  | `BLOCKED` | red, distinct from LATE (e.g. `C.redDim` outline + block glyph) |
  | `COMPLETED` | muted grey — de-emphasised (done, not urgent) |
  | `CANCELLED` | muted grey, lower opacity |

- The same chip is reused for the Job summary row's rolled-up status in grouped mode.

**Accent / active-filter indication:**
- "accent colour" resolves to an **existing** `C` accent token, not a new colour. Active filter = accent on the header filter glyph **plus** a non-colour cue (filled vs outline funnel) so it reads without colour (a11y, Issue 3).

**Density:**
- Inherit `tableStyle` and the app's 12px table type; row height matches the existing dense tables. No new spacing scale. Zebra striping: match whatever the current Orders table does (default: off).

---

## Sprint scope

### In scope

- New endpoints `GET /v1/orders` (filter + paginated list) and `GET /v1/orders/distinct` (column distinct values with scoped filters)
- New Orders page UI replacing the current Orders table
- Per-column filter popovers with search and multi-select checkboxes
- Filter scope semantics: dropdown values scope to current filters on *other* columns
- Sort on any sortable column (single-column sort for v1)
- Pagination (page size + page number)
- "Showing N of M" row count
- View toggle: List | Grouped by Job
- Job summary rows in grouped mode, with status/due/completion rollups from `WorkOrderGroup`
- Synthetic-customer notice when applicable
- Empty / no-match / loading states

### Explicitly out of scope

- **Computed rollup KPIs at parent levels** (project on-time, customer-level feasibility, AvgScore). Deferred until chain-aware solver lands and rollups have meaningful data. Plain counts and direct group fields only for v1.
- **Solver-quality columns** (AvgScore, infeasibility flags, slack). Same reason.
- **Tree-grid view** (one row per hierarchy level with expand/collapse). Column-filter design replaces it; revisit only if Kaleb specifically asks.
- **Drill-through to Schedule tab.** Click a row → opens existing WO detail. Filter doesn't propagate to other tabs in this sprint.
- **Hierarchical Gantt** (per-order rows with parent/child relationships).
- **Saved filter views** / named filter sets / share-via-URL.
- **Date-range picker** on Due Date filter. Multi-select on individual dates for v1.
- **Multi-column sort** (sort by Status then Due Date). Single-column sort only.
- **Inline editing**, bulk actions, row selection, export. Read-only grid.
- **User-toggleable hidden columns** / column reordering. Fixed column set for v1.
- **Tenant-configurable column sets.** Whatever columns are in the spec, all tenants get them.
- **Job summary row drill-down** to a dedicated job detail view (if one doesn't already exist). No-op for v1.
- **Performance optimisation beyond what's needed for Stafford's scale.** No indexing strategy work, no caching layer.

### Branch & merge plan

- Branch: `main` directly. UI work is self-contained; new endpoints are additive.
- No conflicts with `performance` or `staging-architecture` branches.
- New Orders page replaces the existing Orders page route — clean swap, no parallel versions.

### Acceptance criteria

1. Opening the Orders page in the Stafford tenant shows the full set of orders returned by `GET /v1/orders` (paginated). The exact count tracks the current data refresh; for the present `stafford-engineering-test` capture it's ~714 orders / 279 groups, for `stafford-slim-100` it's 29 / 10.
2. "Showing N of M" reflects the correct counts; updates on every filter change.
3. Each filterable column shows a filter icon in its header. Clicking opens the popover.
4. Filter popover lists distinct values for the column, with per-value counts under the current other-column filters.
5. Applying a filter narrows the visible rows; clearing returns them.
6. Filters compose with AND across columns, IN within a column.
7. Sort works on every sortable column, asc/desc.
8. View toggle switches between List and Grouped by Job; filters and sort persist across toggles.
9. Grouped mode shows Job summary rows with status, due date, and completion ratio from the `WorkOrderGroup`.
10. `[Auto]` customer-source notice renders when any visible row has `CustomerSource = auto-from-JobType`; absent when no auto rows are visible. Counts update with the filter set.
11. No regression in the existing WO detail panel (clicking a row navigates as today).
12. URL search params reflect filter / sort / page / view state; reload restores the view; back/forward step through filter changes.
13. Both endpoints return in < 200ms against the current Stafford fixtures (engineering-test scale).
14. On a list-load failure, an inline banner shows `ApiError.message` with a working [Retry]; a filter-change failure keeps the last-good rows visible; a distinct-load failure shows an inline error inside that popover only. Error state is visually distinct from the "No matches" empty state.
15. The filter popover and grouped rows conform to the app-wide keyboard / a11y convention (see Keyboard & accessibility) once it exists; this sprint adds no bespoke a11y model of its own.
16. Status renders via the existing status-chip / `statusColor()` with the six WG-status semantics (ON_TRACK green, AT_RISK amber, LATE/BLOCKED red, COMPLETED/CANCELLED muted); active-filter indication uses an existing accent token plus a non-colour cue; grid density matches the existing `tableStyle`.

### Sequencing inside the sprint

1. `GET /v1/orders` endpoint — filter + sort + pagination
2. `GET /v1/orders/distinct` endpoint — scoped distincts with search
3. UI grid component shell — replaces existing Orders page
4. Column filter popover component
5. Wire filter popovers to distinct endpoint
6. Wire grid to list endpoint with filter/sort/pagination state
7. View toggle + grouped-mode rendering with Job summary rows
8. Empty states, loading skeleton, synthetic-customer notice
9. Smoke test against Stafford WORK7 fixture

---

## Open issues

### OI-1: Date filter UX

Multi-select on individual ISO date values is correct for v1 but will be unwieldy with many distinct dates (every WO has its own due date, so the dropdown could have hundreds of values). Two mitigations for v1:

- Search box on the dropdown handles "find a specific date."
- Default sort on Due Date means scanning the column is fast.

If Kaleb finds the date filter unusable in practice, **date-range picker** becomes a follow-up sprint (`SPRINT-orders-page-date-range-filter`).

### OI-2: Distinct counts under filter scope — backend cost

`GET /v1/orders/distinct` with per-value counts requires running the filter query and aggregating per distinct value. For Stafford's current scale (~714 orders, ~6 hierarchy columns + handful of attributes) this is trivial. For a 100k-WO tenant with complex filters, it might warrant materialisation or indexed counts. Don't optimise now; flag if it becomes a hot spot.

### OI-3: What "Job" means in the Job column

The grid currently shows `groupKey` for Job, but the user-facing column should display the group's `name` (e.g. "MI 252208 - 2 x CHDV3500 / Single Paddle Vacuum Mixer"). That's potentially long. Two options:

- Show name with truncation + tooltip
- Show key, with name in detail panel

Lean: name with truncation, since users navigate by name. Settle in implementation; not a blocker.

### OI-4: Empty hierarchy slots

Some Jobs in the slim sample have a Project but no Sales Order populated. Filter dropdown should show "(none)" or "(unassigned)" as an explicit value rather than silently excluding rows with empty values. Be explicit about which it is — picking "(unassigned)" in the Sales Order filter should return rows where Sales Order is empty.

### OI-5: Job summary row when Job has only one WO

If a Job has a single WO (common in the slim — all 12 Jobs were single-WO), the Job summary row in grouped mode is largely redundant — the WO row underneath is the same record. Two options:

- Always show summary row (consistency)
- Skip summary row when Job has 1 WO (less visual noise)

Lean: always show, for consistency. The visual cost is minor and the regularity helps scanning.

### OI-6: User-facing label for the Family column

The mapping calls hierarchy slot 4 `Family` (from JobEntity `FamilyCode`, ~93% populated, NA → null). User-facing column header could be `Family`, `Product Family`, or `Job Family`. Lean: `Family` — matches the source and the mapping name, shortest header, planners already know the term from Genius. Settle in implementation; trivial to change.

### OI-7: Cardinality cap on `distinct` for high-cardinality columns

Some columns are effectively per-row identifiers (WO `key` is one per order, ~700 distinct in engineering-test). For these, an Excel-style checkbox dropdown is the wrong UX — the list is just a wall of values. Two mitigations:

- Mark such columns as non-filterable in the column table (current spec already does this for WO).
- For the remaining filterable columns, the `distinct` endpoint enforces `max 500` already. If `truncated: true`, the popover shows a "Refine search to narrow this list" hint.

If a planner asks "I want to find WO 27851 fast," the answer is sort + search, not a filter dropdown.

---

## Out of scope (for this sprint, possibly later)

- **Computed parent-level rollups.** Project on-time = `min(child onTime)` etc. Deferred until chain-aware solver lands.
- **Hierarchical Gantt** (per-order rows in Gantt, parent/child structure visible).
- **Tree-grid view** (one row per hierarchy level). Column filters cover the same need with less UI investment.
- **Attribute filter chips** (pills above the grid for common attributes). Column filters do the same job; revisit if Kaleb finds the dropdown UX awkward for high-cardinality attributes.
- **Saved filter views / share via URL.** Wait for Kaleb to ask.
- **Export to Excel.** Has its own product/permissions conversation per the earlier data-inspector-export sprint.

---

## Next sprints (informed by this one)

- `SPRINT-chain-due-date-propagation` — solver respects head WO's due date as a chain constraint, denormalised onto descendants. Sets up meaningful rollup KPIs.
- `SPRINT-in-process-forward-roll` — engine computes effective completion for IN_PROCESS orders from `now + remainingWork`. Fixes the 27851-A-1 class of issue.
- `SPRINT-workordergroup-customer-live` — replaces synthetic-customer mode with live `salesOrderHeaderEntity.BillToCustomerName` lookup. Removes the synthetic notice from the UI.
- `SPRINT-orders-page-rollups` — adds parent-level computed KPIs (project on-time, customer at-risk count) once chain-aware solver lands.
- `SPRINT-orders-page-attribute-chips` — only if Kaleb asks for filter-chip UX in addition to column filters.

---

## Notes for Chris (not for CC)

- The list of columns is opinionated. If you want different defaults (e.g. show `ProjectManagerCode` instead of name, or hide Job Type), adjust the column table before sending to CC.
- OI-5 (single-WO Job summary rows) interacts with the Unattached jobs problem we just discovered. In grouped mode, all 12 Stafford slim Jobs would show as Job summary rows with one WO underneath — including the 6 Unattached ones with no `headWorkOrderKey`. That's fine for v1, but worth knowing the visual will be a bit repetitive on small datasets.
- The Synthetic-customer notice is a small but real bit of honesty in the UI. Don't strip it; the Kaleb walkthrough goes better when the tool is upfront about what's real vs. synthetic.
- Sprint deliberately doesn't include drill-through to other tabs. That's because the filter state model for cross-tab propagation is a real design conversation in its own right — what state survives, what resets, what URLs look like — and shouldn't be improvised mid-sprint.

---

## Design review summary (plan-design-review, 2026-06-08)

Focused review of the original draft. **Design completeness ~8.5/10 — one real _local_ gap.** The draft was already strong on information architecture, happy-path states, and slop-resistance (App UI matching the existing dense tables).

**Local gap, fixed:**
1. **Error states** (`### Error states`, AC 14) — the grid is 100% API-driven and failure UX was unspecified. Reuses the existing `api()` / `ApiError` layer; banner + `[Retry]` (re-fires URL query) + keep-last-good rows on filter-change failure + popover-local distinct error. Defers shared presentation to `ui-22-error-handling`.

**Surfaced a global gap (not local — its own sprint):**
- **No app-wide keyboard support.** Keyboard operability / focus / ARIA is a cross-cutting decision the app hasn't made. This page *inherits* it, doesn't define it (see `### Keyboard & accessibility`). Tracked for a dedicated `SPRINT-app-keyboard-support`, not bolted onto the Orders page.

**Not gaps:**
- **Visual spec** (`### Visual spec`, AC 16) — minor polish: the app already has `statusColor()` (`App.tsx:388`) + a status-chip; this only pins the six new `WorkOrderGroupStatus` colour semantics so they aren't improvised. Keep or cut freely.
- **Responsive / mobile** — intentional omission; desktop workstation tool. Revisit only if planners use tablets, or when this goes customer-facing.
