# Sprint — Snapshot as Partitioned Read Surface

**Status:** 📋 Ready to prompt
**Scope (v1):** Background solve writes a **partitioned** snapshot of the mapped, solved schedule state. The UI reads a **KB-scale summary partition** on landing and **lazy-reads heavy detail** only on tab entry. Eliminates the double-solve and the 16.6 MB landing payload.
**Supersedes:** the prior scheduling-snapshot sprint (not retained — redesigned around the scale findings).
**Depends on:** nothing blocking. Builds on the existing solve pipeline + flat-file snapshot architecture.
**Investigation basis:** `ui-scale-investigation.md` (slim-2000: 1,984 tasks · 68 resources · 562 orders).

---

## Why (the findings this is built on)

At slim-2000, the current load path ships the full solve result to the browser and renders the Overview from it:

- Solve payload **16.6 MB** — tasks **12.24 MB (74%)**, resourceUtilization **3.79 MB (23%)**, the latter a **fixed ~3.8 MB floor** of calendar intervals regardless of task count.
- The app fires **two `solve-and-sync` calls on load** (16.6 MB each).
- Overview builds **~29.5 K DOM nodes**, **~20 s+ to interactive**.
- The cost is **server solve + transfer + render**, *not* parsing (~90 ms).

Root cause for the UI: the landing page pays the full solved-state cost to render a 10-second health read it doesn't need the detail for, and there is **no summary-only read** — every read endpoint returns the heavy shape.

The fix is structural and belongs in the snapshot, not the components: **partition the snapshot by read pattern**, derive a light summary at write time, and let each tab pull only what it draws.

---

## Design

### Snapshot = the on-disk, mapped, solved state — written in partitions

The solve produces the snapshot. The snapshot is **not one serialized blob**; it is a set of flat-file partitions written together. Reads are dumb (read latest snapshot, no solving). The **summary projection is computed at write time** over the mapped/solved state — it stays out of the engine read path.

| Partition | Contents | Consumer | Size (slim-2000) |
|---|---|---|---|
| **summary** | headline counts + per-resource bucketed utilization + alert flags | Overview / landing | **target < 100 KB** |
| **detail** | full task array (whole in v1) | Schedule / Orders, on tab entry | ~12 MB (lazy) |
| **calendars** | availability / netAvailable intervals | only calendar-drawing views | ~3.8 MB (rarely) |
| **(others)** | orders, materials, workOrderGroups, conflicts, criticalPath, costSummary | their respective tabs | small |
| **meta** | snapshot id, timestamp, source data version, stale flag | all (cheap) | bytes |

### Summary projection (the landing read)

Computed at snapshot-write time. Shape (illustrative):

```
summary = {
  headline: {
    feasibilityRate, scheduledTasks, includedTasks,
    lateOrders, totalOrders, conflicts, shortages,
    makespan, horizonStart, horizonEnd,
    bottleneck: { resourceKey, name, pct }
  },
  bucketMeta: { granularity: "week", count, horizonStart, horizonEnd },
  resourceLoad: [
    { resourceKey, name, workCenter, overallUtilizationPct,
      buckets: [ { start, end, utilizationPct } ] }   // ~40 weekly buckets
  ],
  alerts: { conflicts: { count, target: "conflicts" },
            materials: { count, target: "materials" } }
}
```

`resourceLoad` drives the Overview utilization heatmap: ~68 resources × ~40 weekly buckets ≈ 2.7 K cells, a few KB. **No raw calendar intervals, no task objects.**

### Read surface

The background solve writes the snapshot; reads serve partitions from the **latest** snapshot — no solving on read.

- `GET /v1/snapshot/summary` — landing read
- `GET /v1/snapshot/detail` — full task detail (lazy; whole in v1)
- `GET /v1/snapshot/calendars` — intervals, only when a calendar view needs them
- `GET /v1/snapshot/meta` — id / timestamp / staleness (cheap; UI shows "as of …")
- `POST /v1/ctp/solve` — **now recomputes + rewrites the snapshot and returns light meta** (status + snapshot id), not the 16.6 MB result. The UI refreshes by re-reading partitions.

### Frontend load-path rewrite

- Overview renders a **utilization heatmap from the summary partition only** — it must **not** import or reference the tasks array.
- Schedule / Orders **lazy-read the detail partition on tab entry**, not on landing.
- Calendar views read the calendars partition on demand.
- **Eliminate the second `solve-and-sync` on load.** Initial load issues a snapshot read, not a solve. An explicit Solve issues exactly one solve.
- Show an "as of {timestamp}" indicator from meta.

> **Assumption to confirm:** this sprint treats the snapshot as written by the **explicit Solve action** (recompute → rewrite snapshot → light response), with **load always reading the latest snapshot and never solving**. If the prior sprint defined a specific background/offline trigger (scheduled, on-sync, queued), load it in and reconcile — the partition design is independent of the trigger mechanism.

---

## Phases (commit after each)

**Phase 1 — Snapshot write (backend pipeline)**
Solve writes partitioned snapshot artifacts: summary, detail, calendars, others, meta. Implement the summary projection (bucketed utilization + headline + alerts) at write time. Engine read path untouched.

**Phase 2 — Read endpoints**
Partition GETs from the latest snapshot. Cheap meta endpoint. `POST /ctp/solve` rewrites the snapshot and returns light meta instead of the full result.

**Phase 3 — Frontend load-path rewrite**
Overview reads `summary` and renders a basic utilization heatmap (no tasks array). Other tabs lazy-read detail on entry. Eliminate the double-solve. "As of {timestamp}" indicator.

**Phase 4 — Verification**
Measure against the `ui-scale-investigation.md` baseline (below).

---

## DO / DON'T

**DO**
- Compute the **summary projection at snapshot-write time**, derived over the mapped/solved state.
- Keep the **engine read path untouched** — partitioning is a write-side pipeline concern.
- Write partitions as **separate flat-file artifacts** (flat-file snapshot architecture).
- Make reads **dumb**: read the latest snapshot, never solve on read.
- Make the **Overview render purely from `summary`** — no reference to the tasks array.
- **Eliminate the second `solve-and-sync` on load.**
- Use the **deferred-population pattern**: ship the correct partition shapes now; populate fields as available, no backfill migrations.

**DON'T**
- Don't **slice** the detail partition by resource/time/status yet — whole-detail lazy load is fine for v1.
- Don't add **Gantt or table virtualization** here — separate sprint.
- Don't put **calendar intervals in `summary`** — bucketed % only.
- Don't build **async queue / concurrency orchestration** beyond flat-file write/read (beta posture).
- Don't change **solver strategies or engine logic**.

---

## Acceptance Criteria (vs slim-2000 baseline)

- [ ] Landing fetch is the **summary partition only**; payload **< 100 KB** (was 16.6 MB).
- [ ] **No live solve** triggered on initial load — load reads the latest snapshot.
- [ ] The **double `solve-and-sync` is gone** — initial load issues no solve; explicit Solve issues exactly one.
- [ ] Overview renders the utilization heatmap with **zero reference to the tasks array**.
- [ ] Schedule / Orders fetch **detail only on tab entry**.
- [ ] Calendar intervals fetched **only** by views that draw calendars.
- [ ] Snapshot exposes **meta (id + timestamp)**; UI shows "as of {time}".
- [ ] **Engine read path unchanged** — no transformation added to engine reads.

---

## Out of Scope (named follow-ons)

- **Sliceable detail** partition (by resource / order / time / status) — the payload analog of virtualization; design *after* the Gantt's query pattern is known.
- **Task list-shape projection** vs full per-task detail (6.5 KB/task is mostly score breakdowns + propagation diagnostics).
- **Gantt + long-table virtualization** (render cost; independent track).
- **Adaptive bucket granularity** (daily near-term, weekly beyond).
- **Async solve orchestration** (background trigger, queue, concurrency, multi-tenant solve scheduling).
- **Filter infra extension** to Conflicts / Analytics.

---

## Open Decisions

1. **Bucket granularity** — recommend **weekly** for v1 (legible, few KB across a ~9-month horizon). Adaptive is a follow-on.
2. **Solve trigger** — see the assumption above; confirm against the prior sprint's intent before Phase 1.
