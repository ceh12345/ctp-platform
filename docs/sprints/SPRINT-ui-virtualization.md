# Sprint — UI Scalability: Virtualization (Gantt + Task page)

**Status:** 📐 Draft — pending Phase 0 CC investigation of the current Gantt/Task DOM + scroll structure
**Scope (v1):** Make the Gantt and the Task page render the full slim-2000 set smoothly by adding **row virtualization** via the **TanStack Virtual** headless library to the *existing* components. Keep the current Gantt — this is plumbing added to it, not a replacement.
**Depends on:** complementary to the snapshot sprint, not blocked by it. Snapshot fixed the **payload** axis (~300 KB overlay); this fixes the **rendering** axis (DOM nodes / time-to-interactive). They are independent — a small payload still paints all rows without virtualization.
**Investigation basis:** `ui-scale-investigation.md` (slim-2000: 1,984 tasks · 68 resources · 562 orders; Overview built ~29.5 K DOM nodes, ~20 s+ to interactive).

---

## Why

At slim-2000 the cost was **server solve + transfer + render**. The snapshot sprint removed the solve/transfer cost. The **render** cost remains: painting ~2,000 task rows (and their bars) as live DOM is what produces ~29.5 K nodes and ~20 s to interactive. No payload change touches this — it's a rendering-structure problem, and the fix is **virtualization** (windowing): mount only the rows in the viewport plus a small buffer, and swap them as the user scrolls.

This is the deferred UI-scalability work. The genuine open gaps it closes (from the investigation): Gantt **scroll-container structure**, **row-height** handling, **zoom vs. timeline** mechanics, and the **div-vs-canvas** question.

---

## Design

### Add a headless virtualizer — plumbing, not a new chart

**TanStack Virtual** (`@tanstack/react-virtual`, the current dominant headless virtualizer, formerly react-virtual) renders **nothing** itself. Its `useVirtualizer` hook returns which row indices to render and where to position them; the existing Gantt/Task components keep all their own rendering, bars, styling, and zoom. So this is additive — the chart is unchanged; only its row mounting changes.

**The library is the small part. The restructure is the work.** To drive the virtualizer the components need three structural prerequisites:
1. A **fixed-height scroll container** (an explicit pixel-height viewport), not a div that grows to fit all rows.
2. **Uniform row height** fed in as `estimateSize` (rows are uniform today — keep them so; see Out of Scope).
3. Rows rendered **absolutely positioned** (`transform: translateY(...)`) inside a full-height spacer, not in normal document flow.

If the current components render rows in document flow with an unbounded container, that restructure is the actual change. Phase 0 confirms the current structure before the approach is locked.

### Parent-child orders: virtualize the flattened visible tree

Orders-as-parents / tasks-as-children does **not** force the harder variable-height path. Keep the tree in data; derive `visibleRows = flatten(tree, expandedState)` and virtualize *that flat array*. Expand a parent → the flat list grows → the virtualizer sees a larger count. Row height stays uniform (indentation is visual, not height-changing). Default the Task page **collapsed by order** (562 rows, not 2,000) so the tree is itself a navigation aid.

> **Virtualization gotcha:** off-screen rows aren't mounted, so **expand-all / collapse-all / select-all must operate on the data model, not rendered DOM.** At 2,000 in-memory this is a non-issue if those actions are wired to state — but they must be.

### Gantt-specific: grid and timeline scroll as one

The left task grid and the right timeline area share vertical scroll, so they must be virtualized against the **same** scroll position and row window — one virtualizer, both columns reading the same `getVirtualItems()` — or they drift apart on scroll. This is the Gantt wrinkle a flat table doesn't have, and it's the thing to get right in the restructure.

### Task page: virtualize the full set; filter is navigation, not a performance gate

At 2,000 tasks the Task page renders the **full set virtualized** — no mandatory filter required for performance, and all of it held client-side. **Do not gate rendering behind a required filter** ("pick an order to see tasks") — that's an anti-pattern treating the filter as a crutch it isn't. Instead:
- Render full, virtualized, grouped-by-order (collapsed default).
- **Client-side** filter / search / sort / group over the in-memory overlay — instant, no round-trips.
- A sensible **default scope** you can clear (e.g. collapsed-by-order, or active/incomplete) — *not* a filter you must set before anything renders.

The rule: a default scope you can clear is good; a filter you must set first is the thing to avoid.

### Scale calibration: DOM virtualization is sufficient — canvas is a 10k+ decision

At 2,000 rows, DOM virtualization is comfortably enough. Canvas/WebGL rendering (the path full-scale fab Gantts use) matters past ~10k tasks and brings real costs (no native DOM events, hand-rolled hit-testing/text/accessibility). It's out of scope — and out of the 0–3K thesis. (The full-height spacer hits the browser's max element height only at extreme scale; 2,000 × ~36 px ≈ 72 K px is nowhere near it.)

---

## Phases (commit after each)

**Phase 0 — Investigation gate (CC, read-only).**
Map the **current** Gantt and Task page: scroll-container structure (bounded vs. document-flow), confirmed uniform row height, the grid↔timeline scroll coupling, and — critically — **how wide the timeline DOM gets at the finest zoom** (this decides whether Phase 2 is needed; see below). Don't lock the approach until this is in.

**Phase 1 — Row/table virtualization (the bigger DOM win).**
Restructure the scroll container (fixed height, absolute-positioned rows in a spacer); drive with `useVirtualizer` (fixed `estimateSize`, tuned `overscan`). Virtualize the **flattened visible-rows array** (tree-aware). Apply to **both** the Task page table and the Gantt's row axis (same pattern). Gantt: single virtualizer shared across grid + timeline columns. Wire expand/collapse/select-all to the data model. This removes off-screen rows *and their bars* — the dominant DOM win.

**Phase 2 — Timeline (horizontal) virtualization + zoom (conditional).**
Window the time axis: render ~2–3× viewport width, load more on horizontal scroll, **coupled to zoom** (zoom changes px-per-day → changes what's in the horizontal viewport). **Likely deferrable:** at a ~9-month weekly horizon the time axis is ~40 columns — not a DOM problem; row virtualization (which already drops off-screen bars) is the whole win. Horizontal virtualization earns its place only if Phase 0 finds the timeline DOM gets wide at fine zoom (e.g. daily/hourly over months). Decide from the Phase 0 measurement; don't build it speculatively.

**Phase 3 — Verification.**
Measure vs the `ui-scale-investigation.md` baseline: DOM node count and time-to-interactive at slim-2000, scroll smoothness (no jank/blank rows at the overscan edge), grid↔timeline stay aligned on scroll, expand/collapse correctness.

---

## DO / DON'T

**DO**
- Add **TanStack Virtual as a headless helper** to the existing components; keep the current Gantt.
- Restructure to a **fixed-height container + absolute-positioned rows in a spacer**.
- Virtualize the **flattened visible tree**; keep rows **uniform height**.
- Drive the Gantt grid + timeline from **one virtualizer / one scroll position**.
- Wire **expand/collapse/select-all to the data model**, not rendered rows.
- Render the **full Task set virtualized**; make filter/sort/group **client-side navigation**.
- Start with **row virtualization**; treat timeline virtualization as conditional on Phase 0.

**DON'T**
- Don't **replace the Gantt** with a full third-party component (Bryntum/DHTMLX/SVAR/Syncfusion) — wrong-sized swap for a working chart.
- Don't reach for **canvas/WebGL** — a 10k+ concern, out of scope.
- Don't **gate rendering behind a required filter** — filter is usability, not a performance mechanism.
- Don't introduce **variable row heights** (would force the measuring path) — keep uniform.
- Don't build **server-side pagination/filtering** — client-side is sufficient at 0–3K.
- Don't build **timeline virtualization speculatively** — only if Phase 0 shows a wide timeline DOM.

---

## Acceptance Criteria (vs slim-2000 baseline)

- [ ] Gantt and Task page render the **full 1,984 tasks** with **DOM nodes proportional to the viewport (~tens of rows), not ~29.5 K**.
- [ ] **Time-to-interactive** at slim-2000 drops substantially from the ~20 s baseline (set the target against Phase 0's measured number).
- [ ] Scrolling is smooth — no blank rows at the overscan edge, no jank.
- [ ] Gantt **grid and timeline stay aligned** across vertical scroll (shared virtualizer).
- [ ] **Expand/collapse** of orders is correct under virtualization; **select-all / expand-all** operate on the full model, not the rendered window.
- [ ] Task page renders the **full set with no mandatory filter**; filter/sort/group are client-side and instant.
- [ ] Rows remain **uniform height**; the virtualizer uses fixed `estimateSize`.
- [ ] **No Gantt replacement** and **no canvas** introduced.

---

## Out of Scope (named follow-ons)

- **Canvas/WebGL rendering** — the 10k+ path; not the 0–3K thesis.
- **Replacing the Gantt** with a full third-party component.
- **Variable-height rows / measuring virtualizer** — only if a future feature (lane stacking, multi-line rows) breaks uniformity.
- **Server-side pagination / filtering** — client-side suffices at target scale.
- **Timeline virtualization** *if* Phase 0 shows it unneeded at the current horizon/zoom.

---

## Open Decisions

1. **Task page default scope** — collapsed-by-order (recommended) vs. active/incomplete-only. A clearable default, never a mandatory filter.
2. **`estimateSize` (row height)** — confirm the uniform row height in px from the current Gantt/Task DOM (Phase 0).
3. **`overscan` count** — buffer rows above/below the viewport; tune for smooth scroll (start ~5–10).
4. **Phase 2 needed?** — decide from Phase 0's finest-zoom timeline-DOM measurement. Row virtualization may be the entire win.
