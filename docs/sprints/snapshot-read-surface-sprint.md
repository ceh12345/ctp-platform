# Sprint — Scheduling Snapshot: Reconstruction Layer + Read Surface

**Status:** 📐 Draft — pending one CC investigation gate (does the engine emit a thin scheduled-state projection? — §10)
**Supersedes:** the prior "Snapshot as Partitioned Read Surface" draft — re-framed around reconstruction, de-coupled from the (not-yet-live) staging architecture, and recast on the thin-overlay / three-layer model.
**Depends on:** nothing blocking. Builds on the existing solve pipeline + flat-file snapshot architecture. **Does not depend on the staging architecture** (not live; this sprint stands alone).
**Investigation basis:** `ui-scale-investigation.md` (slim-2000: 1,984 tasks · 68 resources · 562 orders).

---

## 1. Purpose & model

**The requirement — exact reconstruction.** The in-memory landscape MUST be reconstructable **exactly** from disk — byte-for-byte identical to the landscape that was written — so the engine can rebuild its scheduled state on restart/redeploy without re-solving. This is *the* requirement; everything else (the UI read surface) is a *projection* off that reconstructable state, not a co-equal goal. The prior draft had this inverted (it sold the snapshot as a UI-performance artifact); reconstruction is primary, the read surface is derived.

**The mechanism that guarantees exactness — every field lives in exactly one bucket.** Each field of a landscape entity (task / resource / order) is classified into exactly one of four buckets, and the classification is *total* (nothing falls through, nothing is double-counted):

| Bucket | Persisted? | Reconstructed by | Examples |
|---|---|---|---|
| **base** | in `base/` (static) | load | key, links/precedence, planned hours, durationType, due date, eligible resources, raw calendars |
| **overlay** | in the snapshot | load + apply | placement (status, scheduledStart/End, assignedResource(s), segment) **and planning overrides** (pinned, window-override, priority-override) |
| **derived** | **not persisted** | re-derive on load (no solve) | `preds[]/succs[]` adjacency (`task.ts:212`), cross-WO components (`task.ts:247`), resource consumption / `netAvailable`, WO-group rollups |
| **actuals** | in `actuals/` (sibling) | load + apply (authoritative) | running/dispatched/completed, actualStart/End, percentComplete, holdReason |

Exactness is then **provable, not hopeful**: the round-trip test (`serialize → reconstruct → serialize` is identity) fails the instant a field is neither persisted (base/overlay/actuals) nor deterministically re-derivable (derived). **The §10 investigation gate's real job is to produce this total field classification** — every `CTPTask`/resource/order field assigned to one bucket — before partition shapes are locked. Any field whose bucket is unclear (e.g. `score`: overlay or debug-only? — see §10) is a gate question, because an un-classified field is an exact-reconstruction hole.

**The landscape is three layers, composed:**

```
landscape  =  base  ⋈  snapshot(overlay)  ⋈  actuals
```

- **base** — static tenant data: task/order/resource definitions, routing & precedence, planned hours, due dates, eligible resources, **and raw calendars/availability** (calendars are *input*, not solve output). Changes rarely (a source re-pull). Large; cacheable across solves.
- **snapshot** — the **thin scheduled-state overlay** the solve produces: per task, where it landed. Changes every solve. Small (~300 KB, not 12 MB — see §3).
- **actuals** — sparse floor reality (running/dispatched/completed), authoritative over the plan, convergent (ratified and retired by base re-pulls). A *sibling layer*, modelled here; full implementation is a follow-on (§9). This sprint builds the snapshot layer with the compose hooks for actuals, not the actuals series itself.

This sprint **builds the snapshot (overlay) layer**: written thin, reconstructable (compose with base, later actuals), and projected into the partitioned read surface the UI consumes. Base is the static layer it joins to; actuals are the third compose input, slotted in later.

---

## 2. Why the read surface matters (the performance findings)

The read surface is a projection — and it's the projection that fixes a real problem. At slim-2000 the current load path ships the full solve result to the browser and renders the Overview from it:

- Solve payload **16.6 MB** — tasks **12.24 MB (74%)**, resourceUtilization **3.79 MB (23%)** (a fixed ~3.8 MB floor of calendar intervals).
- The app fires **two `solve-and-sync` calls on load**.
- Overview builds **~29.5 K DOM nodes**, **~20 s+ to interactive**.
- The cost is **server solve + transfer + render**, *not* parsing (~90 ms).

The thin-overlay model attacks this at the root: the 12 MB of denormalized tasks and the 3.8 MB calendar floor are **base data, cached once** — only the thin overlay (~300 KB) ships per solve. Plus a KB-scale summary projection for the landing health read. This is a *bigger* win than the prior draft, which still re-shipped 12 MB of fat tasks each solve.

---

## 3. The snapshot as thin overlay (base ⋈ overlay)

The boundary, drawn precisely, is what makes the snapshot small:

- **base (static, not in the snapshot):** definitions, routing/precedence (linkId chains), planned hours, durationType, due dates, eligible resources, **raw calendars/availability**.
- **overlay (the snapshot, per task):** placement **+ planning overrides** —
  `{ taskId, status (scheduled | unscheduled), scheduledStart, scheduledEnd, assignedResource(s), chosenWindow/segment, pinned, windowOverride { startW, endW } | null, priorityOverride | null }` — ~150–250 bytes/row → **~300–400 KB at 2,000 tasks**.
- **schedule = base ⋈ overlay on taskId.**

**Overrides are first-class overlay, not an afterthought.** The non-solve mutations — pin (`tasks/.../pin`), window-extend (`tasks/:key/window` — *"does NOT trigger a re-solve"*, `ctp.controller.ts:223`), priority-override — each change durable schedule state with no solve. They are exactly the edits the 5-step walkthrough showed getting lost. For exact reconstruction the overlay **must** carry `pinned`, `windowOverride`, and `priorityOverride` (base holds the *original* window/priority; the overlay holds the user's delta). Omitting them = pins and manual extends vanish on restart. (Commitment/running/dispatched is **not** here — that's the **actuals** layer, §9.)

**Generated tasks have no base row — the overlay carries them whole.** The solve creates SETUP / TEAR_DOWN / CHANGEOVER tasks that do not exist in base (verified present: slim-100 counted generated tasks among engine edges). `base ⋈ overlay on taskId` has nothing to join for these, so the overlay row for a generated task is a **superset** — it carries the task's full definition (type, subType, linkId/precedence insertion point, duration, parent/anchor task) *plus* its placement, flagged `generated: true`. Reconstruction re-inserts them into the chain from the overlay alone. This is a real shape difference (generated rows are fat, base-backed rows are thin) and a primary §10 gate question.

Two consequences are the point:

1. **The two heavy partitions largely leave the snapshot.** `detail` collapses to the thin overlay; `calendars` (3.8 MB) is *base* (input), loaded once — `netAvailable` is computed from base ⋈ overlay, not stored. The fat 6.5 KB/task objects (score breakdowns + propagation diagnostics) become an **optional debug projection**, loaded only when debugging — this promotes the old out-of-scope "task list-shape projection" to a first-class, lazy debug surface.
2. **The transfer win depends on a client-side join.** The client loads **base once and caches it across solves** (it's static), and each solve ships only the thin overlay. A server-side join that re-materializes fat tasks would re-inflate the wire to ~12 MB and lose the win — so the design is **client-side join, base cached, overlay per-solve.**

> **Investigation gate (§10):** this assumes the solve emits (or can cheaply project) a thin scheduled-state overlay. If the engine only emits the fat task objects, the overlay is projected from them at write time, and the base/overlay field boundary is drawn against what the engine actually populates. Confirm before locking partition shapes.

---

## 4. Reconstruction (the primary path)

The landscape rebuilds from disk by composing the current layers:

- **Cold start / redeploy:** `load base → apply snapshot(overlay) → re-derive → (later) apply actuals` = the in-memory landscape. **No re-solve needed**; the snapshot *is* the durable scheduled state. The **re-derive** step rebuilds the *derived* bucket deterministically — `buildAdjacency()` from base precedence (`task.ts:212`), `deriveComponents()` for cross-WO (`task.ts:247`), resource consumption / `netAvailable` from the applied assignments, WO-group rollups (`refreshRollups`) — none of which is a scheduling decision. The result must equal the in-memory landscape **exactly**; the round-trip assertion (P2, below) is what proves it, and it is the gate on "done."
- **Steady state, the other direction:** the live in-memory landscape is the working truth; each solve writes the overlay out (memory → disk). So the snapshot is the durable bridge both ways — written from memory each solve, read back into memory on restart.
- **Carry-forward (partial solves):** a partial solve recomputes only the movable tasks; unchanged tasks are carried forward **from the in-memory landscape**, not round-tripped through disk. Memory is the source of truth during uptime; the snapshot is pure output.

### Base ⋈ overlay reconciliation — overlay wins *within a version*

When composing, **the overlay overwrites base for every field it owns, for every task present in the overlay.** Base supplies a field only as the seed for tasks *not* in the overlay (e.g. a newly-synced work order never solved). Worked example — the **window**: it is overlay-owned because the solve *tightens* it (`startW/endW`) and `setTaskWindow` *overrides* it (and resets `origStartW/origEndW` to the new bound — `ctp.service.ts:1463-1467`). On reconstruction the overlay's full window (`startW/endW` working bound + `origStartW/origEndW` outer bound) **replaces** base's config window. The config window isn't lost — it remains in immutable `base/` for a future "reset to original" — but the live landscape uses the overlay.

**The guard: overlay-overwrites-base is valid only when `overlay.sourceDataVersion == base.version`.** Otherwise overlaying resurrects stale state over changed inputs — e.g. a source re-pull moves a due date so base's config window becomes `[A,C]`, but the pre-pull overlay still carries `[A,B]`; blindly applying it would silently restore the old window. So reconstruction is **version-pinned**: it joins the overlay to the *exact* base version the overlay names, never "latest base." On a base-version bump the overlay is stale-by-construction → `staleFlag` → **re-solve** (which regenerates a fresh overlay against the new base), rather than reconstructing from the stale overlay. Same version → exact reconstruction (the normal restart/reload case); base advanced → re-solve, don't overlay. This version check *is* the reconciliation; it is not optional polish.

---

## 5. Read surface (projections off the overlay)

Reads serve projections of the **current** snapshot — no solving on read. Every read takes an optional `?id=<snapshotId>` defaulting to `current` (the multi-solve seam), and every response carries its resolved `snapshotId` so a session can pin to one solve.

| Partition / projection | Contents | Consumer | Size (slim-2000) |
|---|---|---|---|
| **summary** | headline counts + per-resource bucketed utilization + alert flags | Overview / landing | **< 100 KB** |
| **overlay** | thin scheduled-state rows (the snapshot itself) | Schedule / Orders (joined to cached base) | **~300 KB** |
| **debug detail** | fat per-task score/propagation diagnostics | debugging only, lazy | ~12 MB (rare) |
| **meta** | snapshotId, timestamp, sourceDataVersion, staleFlag | all (cheap) | bytes |

*(base + calendars are loaded/cached client-side, not per-solve partitions.)*

**Where the other projections live.** Orders, materials, and WO-group rollups are **derivable from overlay ⋈ base** — the client computes order spans (`min/max` of member task placements), fill rates, and group rollups from the join; no extra partition. **Conflicts and criticalPath are solve-derived analyses, not recoverable from a thin placement row** — they ride as **small server-projected partitions written at solve time** (`conflicts.json`, `criticalPath.json`, KB-scale), refreshed with the overlay. costSummary likewise if enabled. They are *projections*, not part of the exact-reconstruction set (the engine recomputes them on the next solve; they exist only to spare the UI a recompute).

Endpoints:
- `GET /v1/snapshot/summary[?id=]` — landing read
- `GET /v1/snapshot/overlay[?id=]` — thin scheduled state (joined client-side to cached base)
- `GET /v1/snapshot/meta[?id=]` — id / timestamp / staleness
- `GET /v1/snapshot/debug[?id=]` — fat diagnostics, on demand only
- `POST /v1/ctp/solve` — recomputes, rewrites the overlay snapshot, returns **light meta** (status + snapshotId), not the full result.

**Summary projection** (computed at write time, illustrative): `headline { feasibilityRate, scheduledTasks, includedTasks, lateOrders, totalOrders, conflicts, shortages, makespan, horizon, bottleneck{…} }`, `bucketMeta { granularity:"week", … }`, `resourceLoad[ { resourceKey, name, overallUtilizationPct, buckets[…] } ]` (~68×40 ≈ 2.7 K cells, a few KB), `alerts{…}`. No raw intervals, no task objects.

**Client id-threading / consistency:** landing captures `snapshotId`; subsequent reads this session pass it, so the overlay always matches the summary on screen. Two staleness signals drive refresh, and they differ in cost:
- **solve-supersession** (new `snapshotId`, *same* base) → light refresh: re-fetch ~300 KB overlay only.
- **base-version bump** (`sourceDataVersion` moved) → heavy refresh: re-fetch base too (cached base is now stale).

---

## 6. On-disk layout, atomic promotion & retention (this sprint's own mechanism)

> Note: the symlink-promotion mechanism below is **this sprint's decision**, defined natively — *not* inherited from the staging architecture (which isn't live). It's standard and self-contained.

**Location.** Per-tenant, on a persistent mounted volume, config-driven, outside the image:
```
$CTP_DATA_ROOT/tenants/<tenant>/
  base/<baseVersion>/                  ← static; re-pull bumps version
  snapshots/<snapshotId>/              ← thin overlay + summary + meta (+ debug)
  snapshots/current -> <snapshotId>
  (actuals/ …                          ← sibling layer, follow-on §9)
```

**Atomic promotion.** Write the snapshot set into `snapshots/<snapshotId>.tmp/`, fsync, `rename` to seal `<snapshotId>/`, then repoint `current` via `current.new` → `mv -T current.new current`. **POSIX symlink** (Linux/Docker beta — no pointer-file fallback). Pointer and targets on one filesystem. A read concurrent with a solve resolves entirely to old or new — never a mix.

**Bounded retention.** Heavy/overlay partitions for `current` (+prior, for in-flight readers); `meta`+`summary` for the last **N** solves (default 50) or **D** days (default 30); prune on promote. Yields a free solve-history list + KPI timeline and the v2 pin/what-if hook at bounded cost.

**Version-pinning across layers.** The overlay records the **base version it solved against** (`sourceDataVersion`). The landscape is valid only when the composed layers agree on their pins; a base swap and an overlay must be promoted as a consistent set (when base ingestion exists — §9), and the client joins the overlay to the base version the overlay names, never "latest base."

---

## 7. Solve trigger & cold-start (de-staged)

**Trigger: every schedule-state mutation writes a new overlay snapshot; load reads it. Load never solves.** The writer is *not* just the Solve action — it is **any mutation that changes durable schedule state**: full solve, partial solve, bulk schedule/unschedule, **pin**, **window-extend**, **priority-override**, and (composed at the actuals layer later) dispatch/hold/complete. Each mutates the in-memory landscape, then re-serializes + atomically promotes the overlay. This is *required* by exact reconstruction: a mutation that touches memory without writing the overlay is lost on restart — the precise failure the walkthrough exposed. The thin overlay (~300 KB) makes per-mutation writes trivially cheap, so there is no cost reason to batch or defer them. *(The promote-on-new-base trigger is a separate **forward-compatible seam** that activates when base ingestion exists; it is not the only writer.)*

**Bootstrap:** a one-time **seed → solve → verify-snapshot** step in the deploy checklist (including `stafford-slim-100` — static JSON still needs its one bootstrap solve) so a snapshot exists before first load. Not a promote hook — a step you run.

**Cold-start:** if no snapshot exists, the UI shows a **"Not yet solved · Solve"** empty state — **never auto-solve on load** (avoids the stampede + single-flight-lock that beta posture forbids).

**Staleness:** `meta.staleFlag` is wired to whatever versions the **fixture inputs** today (fixture file hash/mtime, or a manual version in tenant config) — `staleFlag = currentInputVersion > snapshot.sourceDataVersion`. It's dormant while fixtures are constant and lights up properly when a real data feed (Genius sync) exists — deferred-population, same as everywhere. *(Not keyed on a staging `current`, which doesn't exist.)*

---

## 8. Every mutation → whole-overlay write

Every schedule-state mutation — full solve, partial solve, or a non-solve override — **rewrites the whole overlay** as a new immutable snapshot and promotes it. Immutability forbids editing `current` in place; "partial" describes what the *engine* did, not what the *writer* does — the writer always emits the full overlay. At ~300 KB this is trivially cheap.

- **Full solve:** recompute the whole overlay from base + demand.
- **Partial solve** (schedule/unschedule a subset): mutate the touched rows in the in-memory landscape, carry the rest forward **from memory**, write the full overlay.
- **Non-solve override** (pin, window-extend, priority-override): mutate the one/few rows' override fields in memory, carry the rest forward from memory, write the full overlay. No engine solve runs; the overlay still advances and `current` is repointed.
- Base is never carried forward (it doesn't change between solves) — there's nothing to carry, only the overlay to recompute or patch.
- **Memory is the source of truth during uptime**; the overlay is pure output written on each mutation. Carry-forward reads from memory, never round-trips through disk.

---

## 9. Sibling layers & extension points (modelled, not built here)

- **actuals (third layer).** A time-series of immutable, sparse, recorded-task-only snapshots, composed last (authoritative over the plan), **convergent**: a base re-pull ratifies actuals it covers (retire), keeps the unconfirmed tail, and **flags contradictions** rather than silently resolving. Genius is the system of record; CTP's actuals are the short-lived unratified leading edge. v1 establishes the compose order and version-pinning; the actuals series itself is a follow-on.
- **what-if.** base + an **override layer** → solved into a **non-promoted named scenario** (its own addressable overlay, pinned to the real base), compared to baseline, never written to `current`. Uses the multi-solve addressing seam; the override composes at the same join as everything else. Parked.
- **planning-lens boundary.** CTP is read-only of authoritative state and advisory in output. Nothing CTP stores is authoritative — the overlay is derived (recomputable), actuals are borrowed (the client's record). The whole landscape is reconstructable from the client's data + a re-solve.

---

## 10. CC investigation gate (confirm before locking shapes)

**The gate's deliverable is the total field classification (§1) — every `CTPTask` / resource / order field assigned to exactly one of base / overlay / derived / actuals.** That classification *is* the proof of exact reconstruction; locking partition shapes before it is done risks an un-classified field = a reconstruction hole. Specific questions to answer:

1. **Does the solve emit a thin scheduled-state projection, or only the fat ~6.5 KB denormalized task objects?** Sets the overlay shape. If thin → project directly. If fat-only → project the thin overlay at write time against what the engine actually populates.
2. **Overrides:** confirm `pinned`, window-override (current vs original window), and priority-override (`priority` vs `originalPriority`) are the complete set of non-solve mutable fields — grep the mutation endpoints; if any other endpoint writes a durable task field without solving, it joins the overlay.
3. **Generated tasks:** confirm what the engine needs to *re-insert* a SETUP/TEAR_DOWN/CHANGEOVER task on reconstruction (definition + precedence anchor), so the fat generated-row shape is complete.
4. **`score` (and other solve-computed task fields):** classify explicitly — **overlay** (must be byte-exact for reconstruction) or **debug-only** (not part of the landscape's reconstructed identity). If the in-memory landscape carries `score` and a later partial solve reads it, it's overlay; if it's display-only, it's debug. This is the canonical "un-classified field" risk.

Same investigate-before-design discipline that's overturned assumptions before. Run read-only first; don't lock partition shapes until the classification is complete.

---

## Phases (commit after each — each has one test gate)

Ordered to **de-risk the requirement first**: the make-or-break (can the landscape serialize and reconstruct *exactly*?) is proven in pure unit tests before any disk, HTTP, or UI exists. If exact reconstruction is impossible for some field, it surfaces at **P2** — cheap — not after the plumbing is built. **P2** (reconstruct exactly?) and **P5** (survive restart with overrides?) are the two go/no-go gates: everything through P5 is the durability requirement; everything after P7 is the performance win.

### Contract

**P0 — Investigation & field classification** *(read-only, no code)*
- Deliver: the total base / overlay / derived / actuals table (§1) — every `CTPTask` / resource / order field in exactly one bucket; answers to the §10 questions (thin vs fat emit, override set via endpoint grep, generated-task needs, `score` classification).
- **Gate:** review checklist — every field assigned, no holes. This *is* the reconstruction contract; nothing downstream locks until it's signed off.

### Engine core — prove exactness in memory (the de-risk)

**P1 — Overlay serialize** `serializeOverlay(landscape) → OverlayDoc` *(pure function, no I/O)*
- Deliver: thin rows (placement + `pinned` / `windowOverride` / `priorityOverride`) + fat generated-task rows, per P0.
- **Test:** solve slim-100, assert the overlay carries every overlay-bucket field, includes generated rows, excludes base/derived. Golden-file it.

**P2 — Reconstruct + round-trip identity** `reconstruct(base, overlay) → landscape` *(pure, no I/O)* ← **gate**
- Deliver: apply placements + overrides, re-insert generated tasks, re-derive adjacency / components / consumption / rollups — **no solve** (§4).
- **Test:** `serialize(reconstruct(base, serialize(L))) === serialize(L)` across all tenant fixtures incl. pinned / window-extended / generated; plus behavioral — the reconstructed landscape accepts a mutation identically. Validate against the *written* landscape, **never** a fresh solve. **This proves "recreate exactly from disk" with zero plumbing.** If it can't pass, stop and rethink.

### Persistence

**P3 — Snapshot store: persist + atomic promote + retention** *(filesystem, temp-dir tests)*
- Deliver: write `OverlayDoc` → `<id>.tmp/` → seal by rename → `current` symlink swap (§6); resolve `current`/`?id`; bounded prune (overlay: current+prior; meta+summary: last N/D).
- **Test:** write/read-back; a read interleaved with a promote never sees a partition mix; retention prunes correctly; files survive a simulated restart. No engine/HTTP needed.

### Wire-up & load

**P4 — Write the overlay on every mutation** *(service integration)*
- Deliver: solve, schedule/unschedule, pin, window-extend, priority-override each call serialize → persist → promote (§7, §8). **Stamp `meta.sourceDataVersion` with a real base-input version** at promote time — a content hash / mtime of the tenant's base inputs (tasks/resources/calendars/orders) — so the overlay records the exact base it was written against (deferred-population: a stable token now, the Genius feed's version later). *(Endpoint return-shape change to light meta is folded into P7 with the lockstep caller updates.)*
- **Test:** per endpoint — hit it, assert a new snapshotId promoted, `current` repointed, overlay reflects the change, and `meta.sourceDataVersion` is populated (and stable across mutations that don't change base).

**P5 — Reconstruct on load + restart durability (version-pinned)** *(integration)* ← **gate**
- Deliver: server load rehydrates from `current` via P2 instead of solving; the API-level re-derive (cross-WO components, consumption replay, WO-group rollups) wraps the engine reconstruct. **Version-pinned reconciliation (the reconciliation guard, §4):** before applying the overlay, compare `overlay.sourceDataVersion` to the *current* base version. **Match → reconstruct (overlay overwrites base, exact). Mismatch → do NOT overlay stale state**: set `meta.staleFlag`, surface "newer data available · Solve to refresh," and serve the snapshot read-only until a re-solve regenerates a fresh overlay against the new base. Cold-start (no snapshot) → "not solved" signal; seed → solve → verify in the deploy checklist (incl. file-tenant seed CLI for `stafford-slim-100`).
- **Test:** (1) seed → mutate (pin a task, extend a window) → restart `ctp-api` → landscape == pre-restart, **still pinned, extension preserved**. (2) **Version-bump guard:** reconstruct with a base whose version ≠ the overlay's → reconstruction refuses to overlay the stale window, `staleFlag` set; after a re-solve the new overlay reconstructs exactly. (3) Cold-start with no snapshot → "not solved" signal. (The walkthrough's lost-edit failure, now a passing test.)

### Read surface

**P6 — Summary projection + consistency assertion** *(write-time, unit)*
- Deliver: bucketed-utilization + headline + alerts computed at write time; bucket array is a bare `utilizationPct[]` indexed to `bucketMeta`.
- **Test:** `summary` < 100 KB; headline == recomputed from overlay + base + calendars for the same snapshot.

**P7 — Read endpoints** *(HTTP contract)*
- Deliver: GET `summary` / `overlay` / `meta` / `debug` / `conflicts` / `criticalPath` with `?id` defaulting to `current`, resolved `snapshotId` in every response; small server-projected `conflicts`/`criticalPath` partitions (§5). Update **all** callers of the old heavy `solve`/`solve-and-sync` contract in lockstep.
- **Test:** contract tests per endpoint; `?id` pins; supersession returns a newer id.

### Frontend (split so each is testable)

**P8 — Data path: base cache + client join, kill the double-solve** *(no visual change yet)*
- Deliver: client loads + caches base, lazy-reads the ~300 KB overlay on Schedule entry and joins client-side; capture + thread `snapshotId`; initial load issues a snapshot read, not a solve.
- **Test:** landing fires **zero** solves and **one** summary read; Schedule renders from overlay ⋈ base; light vs heavy refresh fires by staleness signal.

**P9 — Overview heatmap + cold-start + stale indicator** *(the visible UX change)*
- Deliver: Overview renders the heatmap from `summary` only — **remove the landing `GanttChart`** (`App.tsx:8236`); Schedule keeps its own Gantt; "Not yet solved · Solve" empty state; "as of {ts}" + stale banner.
- **Test:** Overview makes zero reference to a tasks array; cold-start shows the empty state and issues no auto-solve.

### Verify

**P10 — Measure vs slim-2000 baseline**
- **Test:** landing payload < 100 KB (was 16.6 MB); overlay ~300–400 KB; time-to-interactive vs the `ui-scale-investigation.md` numbers; all prior assertions green in CI.

> **Parallelism:** straight line except **P6** (summary) is independent of P2–P5 and can be built against P1's overlay by a second person once P0 lands.

---

## DO / DON'T

**DO**
- Hold **exact reconstruction** as the requirement: the in-memory landscape must rebuild **byte-identically** from disk; the round-trip test is the gate on "done."
- **Classify every field** into base / overlay / derived / actuals — totally, no field unassigned (§1, §10).
- Treat **reconstruction as the primary purpose**; the read surface is a projection off the overlay.
- Keep the snapshot a **thin scheduled-state overlay** — placement **+ overrides (pinned, window, priority)** — join to **cached base** client-side; carry **fat rows for generated tasks** (no base to join).
- **Write the overlay on every schedule-state mutation** (solve, schedule/unschedule, pin, window-extend, priority-override) — carry unchanged tasks forward **from memory**.
- Compute the **summary projection at write time**; keep the **engine read/solve logic untouched** (serialize/reconstruct is a construction path, not a read-path change).
- Write **staged dir → seal by rename → atomic symlink swap**; never edit `current` in place.
- Store under `$CTP_DATA_ROOT/tenants/<tenant>/...` on a **persistent mounted volume**, config-driven.
- **Return the resolved `snapshotId`** on every read and **thread it** through the session.
- Use **deferred-population**: ship the shapes now (incl. version pins for actuals), populate as feeds exist.

**DON'T**
- Don't treat **solve as the only overlay writer** — pin / window-extend / priority-override are writes too; an unwritten override is a lost edit and an exact-reconstruction hole.
- Don't leave any field **un-classified** — if it's neither persisted nor deterministically re-derivable, reconstruction isn't exact.
- Don't validate reconstruction against a **fresh solve** — overrides are meant to diverge from one.
- Don't **depend on the staging architecture** — it isn't live; this sprint is self-contained.
- Don't ship the **fat 12 MB task array** per solve — that's base (cached) + thin overlay.
- Don't do a **server-side join** that re-materializes fat tasks (re-inflates the wire).
- Don't put **calendar intervals** in the snapshot — they're base.
- Don't **edit a snapshot in place** or split the pointer and its targets across filesystems.
- Don't **auto-solve on load**; cold-start shows an empty "Solve" state.
- Don't **bake "exactly one snapshot"** into endpoints/UI — `?id` + id-threading from day one.
- Don't build **actuals convergence, what-if, single-flight locking, or async orchestration** here (named follow-ons).
- Don't change **solver strategies or engine solve/read logic**.

---

## Acceptance Criteria (vs slim-2000 baseline)

- [ ] **Exact reconstruction (the requirement):** landscape rebuilt from disk (base ⋈ overlay, re-derived) == the in-memory landscape it was written from, **byte-for-byte**. Round-trip `serialize → reconstruct → serialize` is identity; validated against the written landscape, never a fresh solve.
- [ ] **Total field classification:** every `CTPTask`/resource/order field is assigned to exactly one of base / overlay / derived / actuals; no field unassigned. (The round-trip test fails loudly on any hole.)
- [ ] **Overrides are durable:** pin → write → reconstruct = still pinned; window-extend → write → reconstruct = extension preserved; priority-override survives. (The walkthrough's lost-edit failure is gone.)
- [ ] **Every mutation writes the overlay:** after schedule/unschedule/pin/window/priority — not just Solve — `current` reflects the change and a reload/second client sees it; **no path solves on a read**.
- [ ] **Generated tasks reconstruct:** SETUP/TEAR_DOWN/CHANGEOVER tasks (no base row) rebuild from their fat overlay rows into the correct chain positions.
- [ ] Snapshot is the **thin overlay** (~300–400 KB), not the 12 MB task array; base is cached client-side.
- [ ] Landing fetch is **summary only**, **< 100 KB**.
- [ ] **No solve on load**; **double `solve-and-sync` gone**; explicit Solve issues exactly one.
- [ ] Overview heatmap renders with **zero reference to the task array**.
- [ ] **Promotion is atomic** (staged → seal → single symlink swap); concurrent read never mixes snapshots.
- [ ] Snapshots persist under `$CTP_DATA_ROOT/...` on a mounted volume — **survive `ctp-api` redeploy**.
- [ ] All GETs accept `?id=` (default `current`) and **responses carry the resolved `snapshotId`**; session threads it.
- [ ] **Bounded retention** holds (overlay for `current`+prior; meta+summary for last N/D).
- [ ] **No staging dependency** anywhere in the implementation.
- [ ] **Solve trigger:** a *full* solve runs only on explicit Solve (or seed); load never solves; seed→solve→verify in deploy checklist. (Overlay writes, however, happen on every mutation — see above.)
- [ ] **Cold-start:** no snapshot → "Not yet solved · Solve" empty state, no auto-solve.
- [ ] **Staleness:** `meta.staleFlag` wired to the fixture-input version; load serves anyway and flags.
- [ ] **Consistency:** `summary` headline == recomputed from the overlay.

---

## Open Decisions

1. **Bucket granularity** — recommend **weekly** for v1. Adaptive is a follow-on.
2. **Retention N/D** — recommend last **50** solves or **30** days for meta+summary; overlay for `current`+prior. Confirm before P3.
3. **Overlay field set (the exact-reconstruction set)** — placement + overrides (`pinned`, `windowOverride`, `priorityOverride`) is the proposed set; confirm completeness against the §10 gate by grepping every mutation endpoint, and classify `score`/solve-computed fields as overlay vs debug. Generated tasks carry fat rows. This list *is* the reconstruction contract — anything missing is a reconstruction hole.
4. **Base caching/versioning on the client** — how the client detects a base-version bump and re-fetches (driven by `sourceDataVersion` in meta); confirm the base is independently addressable by version.
5. **`score` classification** — overlay (byte-exact, if a later partial solve reads it) or debug-only (not part of reconstructed identity). The canonical un-classified-field decision; resolve in the §10 gate before locking the overlay shape.
