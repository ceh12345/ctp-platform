# UI PROMPT — POOLED RESOURCE VISUALIZATION SUITE

## CONTEXT

The CTP scheduling platform shows resource utilization on a Gantt-style timeline. The existing one-task-per-row Gantt works for granular resources (individual operators, single machines, single rooms) where capacity = 1.

It does **not** work for **pooled resources** — workcenters with multiple operators or machines treated as a single capacity pool, or material resources (tanks, raw stock, consumables) where the meaningful question is "how much is on hand" not "is it free or busy."

This prompt covers a new family of visualizations for these pooled resource types, to be added alongside the existing Gantt.

---

## SCOPE

Build three new chart types, sharing a common task-list companion panel:

1. **Stacked-load profile** ("skyscraper")
2. **Capacity histogram** (binned load)
3. **Material/inventory profile** (step-function on-hand)

Plus one aggregation view:

4. **Resource heatmap** (shop-wide overview)

Each chart is paired with a **synchronized task list** showing the assignments that drive the chart.

---

## DATA SHAPE (ALREADY EXISTS — NO MODEL CHANGES)

All charts read from the existing `CTPResource` and its assignments:

- `resource.original` — base capacity profile (intervals with `qty`, time-varying)
- `resource.assignments` — committed tasks (intervals with `qty`, `name`, `type`, `subType`, optional `segments[]` for FLOAT tasks)
- `resource.available` — derived (`original - assignments`), already computed by `CTPAvailableEngine`
- `resource.type` — distinguishes pooled vs. granular vs. material
- `landscape.horizon`, optional `landscape.nowW`, optional segment boundaries (`freezeUntilW`, `midRangeStartW`, `infiniteCapacityW`)

The visualizations are pure renderings of this data. No new persistence, no engine changes.

---

## VIEW 1 — STACKED-LOAD PROFILE ("SKYSCRAPER")

**Use when:** the resource is a pooled capacity (workcenter, group of identical machines, group of qualified operators). Capacity is discrete (e.g. 5 units).

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Workcenter: Injection Molding (capacity: 5)                     │
│                                                                  │
│   5 ─────────────────────────────────────────────────────────    │
│   4 ────┤████┌──┐──────┌────────┐──────────────────────────      │
│   3 ────┤████│██├──────│████████├───┌──┐──────────────────       │
│   2 ────┤████│██├──┌─┐─│████████├───│██├──────┌──────┐──         │
│   1 ────┤████│██├──│█│─│████████├───│██├──────│██████├──         │
│   0 ────┴────┴──┴──┴─┴─┴────────┴───┴──┴──────┴──────┴──         │
│         Mon   Tue   Wed   Thu    Fri   Sat    Sun                │
│                                                                  │
│   ▒▒▒ frozen ▒▒▒  ░░░ detailed ░░░  ▓▓▓ mid-range ▓▓▓            │
└──────────────────────────────────────────────────────────────────┘
```

### Required behaviors

1. **X axis:** time, spanning the horizon. Configurable zoom (hours / shifts / days / weeks).
2. **Y axis:** capacity units (integer scale). Maximum is `resource.original.qty` at that time (capacity can vary by shift — the line is not flat).
3. **Capacity line:** drawn at `resource.original.qty(t)`. If the line moves over time (shift changes, planned maintenance reducing capacity), it shows as a step function.
4. **Task blocks:** each `CTPAssignment` renders as a rectangle. Width = duration (envelope for FIXED, segments concatenated for FLOAT). Height = `assignment.qty`.
5. **Stacking:** at any time `t`, the blocks active at `t` stack from bottom to top. Stacking order is user-toggleable:
   - By start time (default)
   - By priority (highest at top)
   - By chain (same-chain tasks stack adjacent)
6. **Overload rendering:** if the stack at any time exceeds the capacity line, the overflow portion renders in red, **above** the line. Do not clip silently. Overload is the planner's most important signal.
7. **Idle rendering:** the gap between the top of the stack and the capacity line is shown in light grey (toggleable). Labeled "available" in a tooltip on hover.
8. **Horizon segment shading:** background bands for frozen / detailed / mid-range / infinite-capacity segments. Subtle (5–10% opacity), labeled at the top.
9. **`now` line:** if `landscape.nowW` is set, a vertical line at that x-position, with a "NOW" label. Bold, prominent.

### Block coloring

- **Default mode: category.** Color by `task.linkId.name` (chain), `task.process`, or `task.priority` — user-toggleable. Use a categorical palette (8–12 distinguishable colors with a "more" bucket).
- **Do NOT color one-task-per-color.** A rainbow chart is unreadable.
- Special types render distinctly:
  - `CHANGE_OVER` subtype: hatched/striped pattern, neutral grey
  - `SETUP`: dotted pattern
  - `UNAVAILABLE`: solid dark grey (not a task — a capacity reduction)

### Interactions

- **Hover a block:** tooltip with task key, task name, chain, start/end time, qty consumed, duration, demand source.
- **Click a block:** selects the task; highlights the row in the companion task list; highlights all same-chain blocks across all resources (cross-resource highlighting via app-level event).
- **Click a time region (drag-select):** filters the task list to tasks active in that window.
- **Right-click a block:** context menu — go to task detail, view chain, view demand, unschedule (with confirmation if not pinned).
- **Drag a block horizontally:** if the task is not pinned and not in the frozen segment, propose a re-schedule. Show a ghost preview; confirm on drop. (Phase 2 — not required for v1.)

### Zoom and density

- At week+ zoom levels, auto-switch to the **histogram view** (View 2). Don't try to render 500 blocks at 3 pixels each.
- At sub-hour zoom, show block labels inline (task key abbreviated to fit).
- Provide a mini-map (full horizon strip) at the top with a draggable viewport selector.

---

## VIEW 2 — CAPACITY HISTOGRAM (BINNED LOAD)

**Use when:** the time range is too wide for per-task stacking, OR the planner is in mid-range planning mode where individual task identity matters less than aggregate load.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Workcenter: Injection Molding — load by day                     │
│                                                                  │
│  150% ─────────────────────────────────────────────────          │
│  100% ════════════════════════════════════════════════           │
│   80% ████ ──── ──── ████ ──── ──── ──── ──── ──── ──── ──       │
│   60% ████ ──── ──── ████ ──── ████ ──── ──── ──── ──── ──       │
│   40% ████ ──── ████ ████ ──── ████ ──── ████ ──── ──── ──       │
│   20% ████ ████ ████ ████ ████ ████ ████ ████ ████ ████ ──       │
│    0% ──── ──── ──── ──── ──── ──── ──── ──── ──── ──── ──       │
│       Mon  Tue  Wed  Thu  Fri  Mon  Tue  Wed  Thu  Fri           │
│       ─── week 34 ───            ─── week 35 ───                 │
└──────────────────────────────────────────────────────────────────┘
```

### Required behaviors

1. **X axis:** time bins. Bin size configurable: shift / day / week. Default: day for detailed segment, week for mid-range.
2. **Y axis:** percentage of capacity (or absolute load — toggleable). 100% line drawn prominently.
3. **Bars:** one bar per bin. Height = sum of `assignment.qty * duration_in_bin` for all assignments overlapping the bin, divided by `bin_capacity`.
4. **Overload bars:** bars exceeding 100% render with the overflow portion in red above the 100% line. The under-100% portion stays in the normal palette.
5. **No stacking by task within a bar.** The point of this view is aggregation. Use the skyscraper for per-task detail.
6. **Optional: stacking by category.** Within a bar, stack by chain or process to show composition without per-task granularity.

### Interactions

- **Hover a bar:** tooltip with bin start/end, total load, % utilization, count of tasks contributing.
- **Click a bar:** drills down — opens the skyscraper view (View 1) zoomed to that bin's time range.
- **Drag-select bars:** filters task list to tasks in that range.

### Segment shading & `now` line

Same as View 1.

---

## VIEW 3 — MATERIAL / INVENTORY PROFILE

**Use when:** the resource is consumable (raw material, work-in-process inventory, tank contents).

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Material: Resin Type A (units: kg)                              │
│                                                                  │
│  1500 ──┐                                                        │
│         │                                                        │
│  1200 ──┴──┐         ┌───┐                                       │
│            │         │   │                                       │
│   900 ─────┴──┐      │   └──┐                                    │
│                │     │      │           ┌──┐                     │
│   600 ─────────┴──┐  │      └──┐        │  └──┐                  │
│                    │ │         │        │     └──                │
│   300 ═══════════════════════════════════════════ safety stock   │
│                     ││         │       ┌┘                        │
│     0 ──────────────┴┴─────────┴───────┘────────────────────     │
│       Mon   Tue   Wed   Thu    Fri   Sat    Sun                  │
│                                                                  │
│       ▼ = consumption (task)       ▲ = receipt (PO)              │
└──────────────────────────────────────────────────────────────────┘
```

### Required behaviors

1. **X axis:** time, same horizon and zoom controls as View 1.
2. **Y axis:** on-hand quantity in the resource's native units (configurable from `resource` metadata).
3. **Step-function line:** starts at initial on-hand. Drops at each consumption event, rises at each receipt event. Color: solid, single color (this is one entity over time, not a stack).
4. **Safety stock line:** horizontal dashed line at the configured safety-stock level. Renders prominently.
5. **Zero line:** prominent. If the line crosses zero, the region below renders in red — this is a stock-out, the planner's most important signal.
6. **Event markers:** small icons on the line at each event:
   - **Triangle down** at consumption events (a task starting that consumes material)
   - **Triangle up** at receipt events (a PO or transfer-in landing)
7. **Optional two-line variant:** primary line is on-hand; secondary lighter line shows "committed but not yet consumed" (material reserved by future scheduled tasks). The gap between lines is the *projected* future on-hand if no further demand is added.

### Interactions

- **Hover an event marker:** tooltip with task or PO key, qty, resulting on-hand level after the event.
- **Click an event marker:** selects the task/PO in the companion list.
- **Hover anywhere on the line:** tooltip with current on-hand at that time.

### Segment shading & `now` line

Same as View 1. Stock-outs in the infinite-capacity segment are less critical (because by then you'd reorder); flag them but don't alarm-red them.

---

## VIEW 4 — RESOURCE HEATMAP (SHOP-WIDE OVERVIEW)

**Use when:** the planner wants a single-screen view of utilization across all resources, to spot bottlenecks before drilling down.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Shop utilization — week of Aug 19                               │
│                                                                  │
│  Resource           Mon   Tue   Wed   Thu   Fri   Sat   Sun      │
│  ─────────────────────────────────────────────────────────────   │
│  Injection-A       [60] [80] [95] [██] [██] [40] [ 0]            │
│  Injection-B       [55] [70] [85] [90] [95] [30] [ 0]            │
│  Assembly-line-1   [40] [45] [50] [50] [45] [ 0] [ 0]            │
│  QC                [30] [35] [40] [45] [50] [10] [ 0]            │
│  Packaging         [██] [██] [██] [85] [70] [40] [ 0]            │
│                                                                  │
│   green: <70%     amber: 70–95%     red: >95% (overload)         │
└──────────────────────────────────────────────────────────────────┘
```

### Required behaviors

1. **Rows:** resources (filterable by type, workcenter group, location).
2. **Columns:** time bins (shift / day / week — same as histogram).
3. **Cell color:** utilization percentage on a continuous scale:
   - 0–40%: cool blue (under-utilized — sales reps might want to know this)
   - 40–70%: green (healthy)
   - 70–95%: amber (busy)
   - 95–100%: orange (tight)
   - >100%: red (overload — the alarm signal)
4. **Cell label:** integer percentage. Hidden at narrow column widths.
5. **Row ordering:** sortable by name, type, peak utilization, average utilization. Default: peak utilization descending (bottlenecks float to the top).

### Interactions

- **Hover a cell:** tooltip with resource name, bin time range, exact utilization, task count.
- **Click a cell:** drills down to that resource's skyscraper or histogram view at that time range.
- **Click a row label:** opens that resource's detail view.
- **Filter controls:** resource type, workcenter, segment of horizon.

---

## COMPANION TASK LIST (SHARED ACROSS ALL VIEWS)

Every chart view has a paired task list panel beside or beneath it.

### Required columns

- Task key
- Task name
- Chain key (linkId)
- Start time
- End time
- Duration
- Qty (capacity consumed)
- Customer / demand source
- Priority
- State (scheduled / in-progress / completed)

### Required behaviors

1. **Bidirectional selection sync:** clicking a chart element selects the list row, and vice versa.
2. **Sort:** by any column. Default: start time ascending.
3. **Filter:** free-text search on key/name; faceted filters for chain, customer, priority, state.
4. **Group:** optional grouping by chain, customer, or process.
5. **Row context menu:** view task detail, view chain, view demand, unschedule.

---

## DEFAULTS AND ROUTING

When the user navigates to a resource, the system auto-selects the right view:

| Resource type | Default view | Fallback |
|---|---|---|
| Single operator / single machine | Existing one-row Gantt | — |
| Workcenter (pooled, discrete capacity) | **View 1 — Skyscraper** | View 2 if zoom is wide |
| Workcenter (pooled, in mid-range segment) | **View 2 — Histogram** | View 1 on drill-down |
| Material / consumable | **View 3 — Material profile** | — |
| Shop-wide entry point | **View 4 — Heatmap** | drill to View 1/2/3 |

Zoom thresholds auto-switch between View 1 and View 2. The user can override.

---

## NON-FUNCTIONAL REQUIREMENTS

- **Performance:** rendering must remain interactive (60fps pan/zoom) for resources with up to 1000 assignments visible. Use virtualization or canvas rendering if SVG/DOM falls behind.
- **Responsiveness:** the heatmap must fit a typical laptop screen (1440×900) showing 20+ resources × 14+ bins without scrolling.
- **Accessibility:** color is never the sole signal. Overload also shows a textual indicator ("⚠ over"). Patterns supplement color for changeovers/setup/unavailable.
- **No fabricated data:** every visual element corresponds to a real assignment or capacity record. No mock or placeholder blocks.
- **Theming:** all colors via CSS variables so light/dark mode and tenant theming work without code changes.

---

## OUT OF SCOPE FOR V1

- Drag-to-reschedule (Phase 2)
- Cross-resource chain highlighting at the engine level (the UI can emit the event; full propagation comes later)
- What-if overlays (show what the chart *would* look like if a proposed change committed)
- Comparison mode (two horizons side-by-side)
- Export to image / PDF / Excel
- Real-time updates via websocket (sandbox is request/response; production tier later)

---

## ACCEPTANCE CRITERIA

1. A planner can open a workcenter and see a stacked-load profile with the capacity line, overload regions in red, and a synchronized task list — within 500ms of selecting the resource.
2. A planner can zoom out to a quarter-long horizon on the same workcenter and see a binned histogram automatically, with overload bars in red.
3. A planner can open a material resource and see a step-function on-hand profile with safety stock, zero line, and event markers.
4. A planner can open the shop heatmap, sort by peak utilization, see bottlenecks at the top, click into a hot cell, and land in the right detailed view for that resource.
5. All four views show horizon segment shading (frozen / detailed / mid-range / infinite) and a `now` line when `landscape.nowW` is set.
6. Every chart element is clickable and selects the corresponding row in the task list. Every task list row is clickable and highlights the corresponding chart element.
7. No view requires modifying the engine, data model, or assignment structure. All views read from existing `CTPResource` data.

---

## DELIVERABLES

- React component library: `<StackedLoadProfile>`, `<CapacityHistogram>`, `<MaterialProfile>`, `<ResourceHeatmap>`, `<ResourceTaskList>`.
- Storybook entries with synthetic data for each view, including edge cases (empty, overloaded, stock-out, mixed FLOAT/FIXED, segment-spanning).
- Integration into the demo-sandbox: route `/sandbox/resource/:id` auto-selects the correct view based on resource type.
- Brief planner-facing documentation (one page per view) explaining what each chart shows and how to read it.
