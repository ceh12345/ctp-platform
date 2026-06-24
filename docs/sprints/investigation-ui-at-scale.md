# CC Investigation — UI at Scale (≈2000 tasks)

**Mode:** Investigation only — read, trace, measure. No code changed.
**Date:** 2026-06-21
**Dataset used:** `stafford-slim-2000` — the largest available, built via the parameterized
`scripts/slice-stafford-slim.js`. **1,984 tasks · 68 resources · 562 orders · 262 WO groups ·
546 distinct order-refs.** `stafford-slim-100` (112 tasks, 68 resources) used as the small
baseline. All numbers measured against the running dev servers (engine `solveTimeMs`, payload
sizes, DOM-node counts via the headless browser).

> Bottom line: the Overview and both Gantt views render the **full task array with no
> virtualization and no memoization**. At ~2000 tasks the solve payload is **16.6 MB**, the
> Overview tab builds **~29,500 DOM nodes** and takes **~20 s+ to become interactive**, and the
> app fires the **16.6 MB solve twice on load**. The cost is server-solve + transfer + React
> render of tens of thousands of nodes — not JSON parsing (~90 ms).

---

## A. Overview data path

**A1 — Overview's `GanttChart` receives the FULL task array.** `App.tsx:8192`
`<GanttChart tasks={tasks} resources={resources} … />` in the Overview card. `tasks` comes from
`App.tsx:14741` `const tasks = solveResult?.tasks || [];` — the full unfiltered solve array (new
array identity each render; not memoized). No subset/slice between solve and the Overview Gantt.

**A2 — The rollup is already in the same client state.** `App.tsx:14742`
`const resources = solveResult?.resourceUtilization || [];`. The Overview does **not** render from
it alone today — `GanttChart` consumes `tasks` and uses `resourceUtilization` only to derive the
resource row list, not as an aggregate. An Overview-from-rollup is possible with data already on
the client, but the component isn't built that way. **Caveat (measured):** the rollup is not
light — it serializes to **3.6–3.8 MB** by itself (calendar intervals; see D).

**A3 — One large unified payload.** `/ctp/solve` (`ctp.controller.ts:40`) and `/ctp/solve-and-sync`
(`ctp.controller.ts:67`) return the same object, assembled at `ctp.service.ts:3688–3716`:
`status, summary, stats, tasks, resourceUtilization, orders, materials, workOrderGroups, products,
colors, terminology, locale, criticalPath, capacityWaterfall, costSummary`. Full `tasks` + the
`resourceUtilization` rollup ship together. Read-only endpoints (`GET /ctp/state`
`ctp.service.ts:645`; `GET /ctp/results` cached) return the **same heavy shape**; only
`GET /ctp/critical-path` (`ctp.service.ts:1489`) is genuinely light. **No summary-only endpoint
exists** for the Overview to use instead.

---

## B. GanttChart render cost

**B1 — No virtualization.** Every row and bar is rendered to the DOM. Nested render loops at
`App.tsx:5227–5446` (`workCenters.map → wcResources.map → rTasks.map → blocks.map`) emit a div per
block, no windowing. Same in `CaseGanttChart` (`~6042–6156`).

**B2 — Nothing memoized; recomputed every render.** `App.tsx:4854` `tasks.filter(...)`;
`:5007–5014` `resMap` build (full forEach); `:5020–5037` three chained `.filter()` for
`visibleResources`; `:5017` `new Set(resources.map(...))`. `CaseGanttChart:6113–6156` rebuilds +
sorts case rows every render. OverviewTab derived stats `:8153–8158` also unmemoized.

**B3 — ~1–6 DOM elements per bar** (`App.tsx:5382–5445`: connector + main block + up to 4
overlay/label divs). Measured total **24,186 DOM nodes** for the Resource Gantt at ~1,750
scheduled tasks (≈14 nodes/task including row chrome).

**B4 — Resource vs Work-Order view (measured at slim-2000):**

| View | Rows | DOM nodes |
|---|---:|---:|
| Gantt by Resource | 68 resources | **24,186** |
| Gantt by Work Order | 546 order-refs | **11,068** |

Counter-intuitive but real: the WO view has *more rows* yet *fewer nodes* — Resource view renders
a bar per resource-assignment (tasks on multiple resources repeat), so **bar count, not row count,
drives cost**. The "row-per-WO is heavier" assumption does **not** hold at this scale.

**B5 — "Fit" places all bars across the full horizon at once.** `App.tsx:4915–4921` computes one
start/end spanning all data; no time-windowing. At 2000 tasks over ~9 months bars compress to
sub-pixel but all remain in the DOM.

---

## C. Filter infrastructure coverage

**C1 — All generic / reusable.** `useFilter<T>` (`:625`), `ColumnFilter` (`:831`), `SortHeader`
(`:733`), `FilterBar` (`:970`), `ActiveFilters` (`:937`) are parameterized over arbitrary
data/columns — not table-specific.

**C2 — Coverage is partial:**

| Table | Uses filter infra? | Evidence |
|---|---|---|
| Schedule Task Table | ✅ | `useFilter` `:7238`, SortHeader+colFilter `:7674` |
| Materials (MatTable) | ✅ | `useFilter` `:7870`, FilterBar `:7892` |
| Orders / Work Orders | ❌ custom + server pagination | own state `:8722`, `ColumnFilterPopover` `:9120` |
| Conflicts | ❌ | ad-hoc `cfSearch/severity/reason` `:9264` |
| Analytics | ❌ | no table filtering `:11764` |

**C3 — Non-filter tables render the full list, no virtualization.** Orders maps all section
members (`:9073`; has pagination but no windowing); Conflicts renders all grouped cards
(`:9044–9055`); Analytics maps all infeasible tasks (`:11906`). No `react-window`/virtual anywhere.

---

## D. Scale measurement (slim-2000)

**D1 — Fixture available:** yes, `stafford-slim-2000` (counts in header). Real numbers below.

**D2 — Measured:**

| | slim-100 | slim-2000 |
|---|---:|---:|
| Solve payload | **4.0 MB** | **16.6 MB** |
| └ tasks | 0.35 MB (9%) | **12.24 MB (74%)**, ~6.5 KB/task |
| └ resourceUtilization | **3.62 MB (90%)** | 3.79 MB (23%) |
| Engine `solveTimeMs` (UI number) | 331 ms | **9,224 ms** |
| Full HTTP request (curl) | 1.8 s | 11.6 s |
| JSON.parse (V8) | 19 ms | **89 ms** (negligible) |
| Overview DOM nodes | — | **~29,527** |
| Time-to-interactive on load | — | **~20 s+** (network-idle not reached within 15 s) |
| Gantt by Resource DOM nodes / settle | — | 24,186 / ~3 s |
| Gantt by Work Order DOM nodes | — | 11,068 |

`resourceUtilization` is dominated by **availability (1.8 MB) + netAvailable (1.8 MB)** calendar
intervals (68 resources × 261 intervals × `{start,end,durationSec,qty}`) — a **fixed ~3.8 MB
floor regardless of task count** (it's 90% of the small payload).

**Where the time goes:** *not* parsing (~90 ms). It is (1) **server solve ~9.2 s**, (2)
**16.6 MB transfer**, (3) **React render of ~24–29 K un-virtualized DOM nodes**. On initial load
the app fires **two `solve-and-sync` calls** (measured round-trips 20 s and 40 s, **16.6 MB each**)
— a double-solve. The React-reconciliation-vs-layout split is **not separately measurable
headlessly** (no React DevTools profiler); DOM-node counts + render-settle (~3 s for the Gantt once
data is present) are used as proxies.

---

## E. Constraints & quick wins (reported, not fixed)

**E1 — `GanttChart` is reused identically** in Overview (`:8192`) and Schedule (`:8538`), same
props shape, tightly coupled to per-task bar rendering (uses `resourceUtilization` only for the row
list, not aggregation). Swapping the Overview to a rollup/heatmap needs a different prop shape +
render path — the component won't flex into it as-is.

**E2 — Cheap wins spotted (NOT implemented):**
- Memoize in `GanttChart`: `scheduled` filter (`:4854`), `resMap` (`:5007`), `visibleResources`
  chain (`:5020`), `allWorkCenters` Set (`:5017`).
- `CaseGanttChart`: memoize `caseMap`/row sort (`:6113`).
- OverviewTab derived stats (`:8153`); memoize `tasks`/`resources` off `solveResult` (`:14741`).

**Bigger structural levers (design call, per the brief — not quick wins):**
- The **double `solve-and-sync` on load** (two 16.6 MB round trips).
- The **~3.8 MB `resourceUtilization` always shipped** (90% of the small payload; calendar
  intervals the Overview card doesn't need).
- **~6.5 KB per task** payload → tasks dominate (12.2 MB) at scale.
- **No windowing** on any Gantt view or long table.

---

*Reproduce: solve each tenant via `POST /v1/ctp/solve` (payload sizes + `solveResult.solveTimeMs`);
DOM-node counts via the headless browser on `http://localhost:3001/?tenant=stafford-slim-2000`.
No source files were modified during this investigation.*
