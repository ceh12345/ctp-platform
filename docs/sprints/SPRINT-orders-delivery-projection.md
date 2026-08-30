# SPRINT: Orders Page — Delivery Projection from CTP's Own Schedule

**Status:** Code complete, tests green, not yet demoed to Stafford
**Branch:** `feature/scheduling-snapshot`
**Date:** 2026-08-11 → 2026-08-12
**Follows:** [`SPRINT-orders-page-rebuild.md`](SPRINT-orders-page-rebuild.md) (the Excel-style grid this builds on)
**Surface area:** API + web only. **No engine changes.**

---

## Why this sprint exists

The Orders grid had a Status column showing ON_TRACK / AT_RISK / LATE. It was answering
the wrong question.

The old rule compared the parent Job's Genius `sourceEnd` against wall-clock now, and
its `promiseDate` against that same Genius date. So the column reported **"is Genius's
plan overdue?"** — it never consulted the schedule CTP had just produced. CTP
reschedules everything; a status derived from the upstream plan is at best stale and at
worst backwards.

Measured on the 16 July book, the old rule put:

- **101 orders in LATE** that CTP projects comfortably on time
- **31 orders in AT_RISK** that CTP actually projects late

That is not a cosmetic defect. Late-delivery penalty avoidance is Stafford's stated
value driver, so the delivery-risk column is the single number the page exists to
show — and it was inverted on a third of the book.

A second, related problem: the page had no way to show *why* a verdict was reached.
A planner seeing "LATE" had no projected dates to check it against.

---

## What shipped

### 1. Projected span becomes a first-class output

An order's **projected span** = earliest scheduled start and latest scheduled end
across all of its tasks. Every scheduled task counts, not just finished goods, so the
window covers the whole order's work.

Computed in two places, deliberately:

- **`ctp.service.ts`** — accumulated during the solve-result walk and emitted on
  `OrderResultDto` as `projectedStart` / `projectedEnd`. This is what the solve
  response and the Solve Results dialog read.
- **`orders.service.ts`** — recomputed from the solved landscape via a new
  `projectedSpans()` helper. The orders grid is otherwise a pure config-data view;
  projections are a solve output, so they are **joined at read time, never stored**.
  Consistent with the snapshot sprint's rule that detail is projected, not persisted.

Before the first solve there is no landscape, `projectedSpans()` returns an empty map,
and the columns render blank rather than misleading.

### 2. Status derives from the projection

```
LATE      projected completion runs past the END of the promised day
AT_RISK   makes it, but with <= AT_RISK_SLACK_DAYS (5) to spare
ON_TRACK  makes it with room
null      no assessable commitment — renders as "—"
```

`COMPLETED` / `CANCELLED` still come from `wostatus` and win over any projection:
those are facts about the work order, not predictions.

`null` covers two distinct cases that both mean "we cannot assess this": the order has
no customer promise (internal / stock / rework work), or nothing is scheduled yet. On
the full Stafford book that is **129 + 9 = 138 of 472 rows** — a large enough share
that showing a fabricated ON_TRACK for them would be actively misleading.

### 3. The promise is a day, not an instant

The customer promise (sales-order `DateCustomer`) is stored as **midnight at the START
of the promised day** — verified: 518 of 519 values are 00:00 NZ. So the commitment
runs to the **end** of that day and the deadline is `promise + 24h`.

Comparing against the raw timestamp called anything finishing during the promised day
late; it marked **8 same-day completions "+1"** before this was fixed. The same rule is
implemented on both sides of the wire — `orderDaysLate()` in the web client and
`deriveStatuses()` / the `daysLate` resolver in the API — and the tests pin the
boundary from both directions.

### 4. Four new grid columns

| Column | Source | Notes |
|---|---|---|
| Customer Promise | `customerDeliveryDate` | Sales-order `DateCustomer`. Filterable + sortable. |
| Projected Start | solved landscape | Sortable. |
| Projected End | solved landscape | Sortable. Compare against the promise for delivery risk. |
| Days Late | derived | `+N` late, `0` on time, blank when unassessable. Numeric sort. |

### 5. Delivery risk stops using `dueDate`

`SolveResultsDialog`'s `lateOrders` now measures against the customer promise instead
of `order.dueDate`. `dueDate` maps from Genius `JobEndDate` — an **internal production
target** that differs from the promise on ~87% of Stafford's orders and is populated
even on internal / stock / rework work that has no customer at all. It is the wrong
yardstick for a late fee.

---

## Bugs found and fixed along the way

Three defects surfaced only because the new columns exercised paths that no populated
column had exercised before. All three are user-visible.

### A. Sort columns with blanks were unusable descending — `orders.service.ts`

`compareValues()` puts empties last for ascending, and `sortRows()` multiplied that
result by the direction sign. Descending therefore flipped every blank to the **top**,
burying all 334 populated rows under 138 empty ones.

No existing column had exposed this: `dueDate` is always set. The CTP date columns are
the first with a large blank population.

**Fix:** empties are handled before the sign is applied, so they sort last in *both*
directions, tie-broken by key ascending for determinism.

### B. `resolveValue()` silently no-op'd on the new columns — `orders.service.ts`

The CTP-derived columns are not fields on `IOrderData` — the promise comes off the
mapped order, the projections off the landscape. Without explicit cases, sort and
filter matched nothing and quietly did nothing, **while the grid still drew a sort
arrow on the header**. Failure that looks like success.

**Fix:** explicit resolver cases for both the column id and the UI label
(`projectedEnd` and `Projected End`), since the grid can send either. `daysLate`
returns a **number** so the sort orders by magnitude — as a string, `+10` sorts before
`+2`.

### C. Pagination was pinned to page 1 — `orders.controller.ts`

```ts
const page = clampPositiveInt(query['page'], 1, 1);
//                                           ↑  ↑
//                                    fallback  MAX
```

The third argument is the **maximum**. Passing `1` meant `Math.min(n, 1)` — every
request served page 1 regardless of what was asked, and the API honestly echoed
`"page": 1` back. The grid's Next/Prev updated the local page counter and the header
text while the rows never moved, so **only the first 100 of 472 orders were ever
reachable**.

Pre-existing, not introduced here; found while investigating a report that the page
"doesn't page correctly or show all the orders."

**Fix:** `Number.MAX_SAFE_INTEGER` as the max. Out-of-range pages return an empty
`rows` array, which the client already handles.

**Compounding cosmetic issue (`App.tsx`):** the footer read `Showing 472 of 472 work
orders` while the grid held one 100-row page — which reads as data loss rather than
paging, and would have masked the real bug even after it was fixed. Now reports the
rendered slice: `Showing 1–100 of 472 work orders`, and
`Showing 1–100 of 53 filtered work orders (472 total)` when a filter is active.

---

## Files touched

**API**
- `modules/ctp/ctp.service.ts` — accumulate `orderProjectedStart` / `orderProjectedEnd`; emit on the order DTO
- `modules/ctp/dto/solve-result.dto.ts` — `projectedStart` / `projectedEnd` on `OrderResultDto`
- `modules/orders/orders.service.ts` — `StateService` injection, `projectedSpans()`, rewritten `deriveStatuses()`, CTP column resolution, empties-last sort
- `modules/orders/orders.controller.ts` — page clamp fix
- `modules/orders/orders.module.ts` — import `StateModule`
- `modules/orders/dto/orders-row.dto.ts` — promise + projection fields on the row
- `modules/orders/__tests__/orders.service.spec.ts` — **new**, 45 tests

**Web**
- `packages/web/src/App.tsx` — `orderDaysLate()` helper, four grid columns + cell rendering, `lateOrders` re-based on the promise, footer count label

---

## Verification

- **45 tests** in the new spec — span rollup, status boundaries, CTP column resolution, empties-last sort, controller query clamping.
- **Mutation-tested, not just green.** Reverting the empties-last block and the `+24h`
  deadline rule fails **8** tests; reverting the page clamp fails **4**. The tests bite.
- Fixtures are timezone- and DST-independent: every instant derives from engine seconds
  off `CTPDateTime.baseDate` and the promise ISO is round-tripped back out of the same
  number, so `Date.parse` and `CTPDateTime.toDateTime` cannot disagree on a machine in
  another zone.
- `npx tsc --noEmit -p packages/api/tsconfig.json` — clean (the CI-strict gate).
- `npx vitest run` — **94 files, 1393 passed, 10 skipped, 0 failed**.
- All three packages build clean (engine clean-built first).

**End-to-end on `stafford-all`** (472 WOs, 229 Jobs, 1,660 tasks, solve 70s, 1,636 scheduled, 0 infeasible):

| Status | Count |
|---|---|
| ON_TRACK | 174 |
| LATE | 107 |
| AT_RISK | 53 |
| — (unassessable) | 138 |

Worst offenders by Days Late: `28482` +203d, `28468` +115d, `26756` +86d, `28450` +84d,
`25760` +78d. Pagination verified across pages 1/2/3/5 (final page 72 rows; 4×100+72=472)
with the blanks-last ordering holding across page boundaries.

---

## Open issues / follow-ups

1. **`AT_RISK_SLACK_DAYS = 5` is a hardcoded constant.** It should almost certainly be
   per-tenant config — 5 days of slack means something different for a 2-day job than a
   3-month vessel build. Deliberately left hardcoded until Stafford tells us what the
   threshold should be; it is the kind of number worth asking about rather than guessing.

2. **Span rules diverge between the two implementations.** `ctp.service.ts` folds each
   end in independently (`if (st > 0)` / `if (en > 0)` separately); `orders.service.ts`
   requires **both** ends positive for a task to contribute. A half-scheduled task
   therefore contributes its start in the solve response but nothing in the grid.
   Immaterial on current data, now pinned by a test so it cannot drift silently. Worth
   collapsing to one helper.

3. **Columns are blank until a solve runs in the current process.** `getLandscape()`
   returns null on a cold API start, so the grid shows "—" everywhere until Sync + Solve.
   The snapshot sprint's reconstruct-on-load does not currently repopulate the orders
   grid's projections. Decide whether the grid should read the snapshot rather than
   live state.

4. **WO 28482 is +203 days late** and dominates the tail. Same work order that
   dominated the unscheduled tail in the June slim-100 debugging session. Now visible as
   a delivery-risk number instead of a scheduling failure — worth a root-cause pass.

5. **Two unexplained task-count gaps:** 1,722 tasks in the source file vs 1,660 in the
   landscape, and 24 of 1,660 feasible-but-unplaced after the solve. Neither
   investigated.

6. **No web-side tests.** `orderDaysLate()` duplicates the API's deadline rule in a
   second language with no test around it. The two can drift.

7. **Not demoed to Stafford.** The LATE count moved by roughly a third of the book;
   Kaleb should see the new numbers with the reasoning before they land in a client
   conversation.
