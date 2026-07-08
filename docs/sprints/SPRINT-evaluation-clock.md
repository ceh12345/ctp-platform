# Sprint — Evaluation Clock (`asOf`): one mode, one clock

**Status:** 📐 Draft — ready to build; small sprint
**Origin:** Fixed-horizon bug — slim-100 (a frozen June Genius pull) shows work as LATE because `orders.service` compares against `Date.now()` (Jul 6), not the dataset's own time. Proven: pinning the horizon to Jun 7 and re-solving fixed the *schedule* (Clock A), but the grid still said LATE (Clock B) — the two clocks disagree.
**Core reframe:** CTP has two clocks today. **Clock A** (the horizon anchor — fixed date or `NOW`) drives the scheduler and `isPastDue`, and is correct. **Clock B** (`Date.now()`) leaks into evaluation code — LATE/at-risk in `orders.service`, downtime, the UI "today" — and rolls forward regardless of what the data is anchored to. The bug is the diagonal: **fixed data judged by a rolling clock**. This sprint collapses the two clocks into one mode-driven `asOf`, making the diagonal *unrepresentable*, not merely avoided — the same design move as the single named mapping point, applied to time.
**Two-part fix (matters):** unifying the clocks is necessary but not sufficient. The anchor must also carry the **right value** — the data's as-of / WIP frontier, not the earliest included task. See "the anchor's value" in Design; today's value is mis-derived (slim-100 → Apr 25 instead of ~Jun 7).
**Sequencing note (matters):** this pairs with the **dispatch-seam sprint's byte-for-byte parity gate**, but the mechanism is precise: schedule *placements* are driven by **Clock A (`horizonStart`)**, so the direct requirement for schedule parity is that the parity tenant use a **fixed horizon** (no rolling `NOW`). This sprint (Clock B) is additionally a prerequisite **only insofar as that gate's compared output includes evaluation-derived fields** (statusLabel, downtime, gap math). Land a fixed-horizon parity tenant regardless; land this sprint before any eval fields enter the diff.

---

## Why

Snapshot tenants rot in place: as wall time marches past the frozen dates, orders flip LATE one by one with zero input change. That corrupts Kaleb-facing status on slim-100, silently degrades every regression fixture built on frozen data, and undermines the bake-off's premise (a pinned base must come with a pinned clock, or "same inputs" isn't true). One `asOf`, resolved from the same mode flag as the horizon, fixes all three — and for rolling/live tenants it resolves to `Date.now()`, so behavior there is byte-identical. The blast radius is exactly the tenants where the bug lives.

Side effect worth naming: **fixed-tenant solves become fully deterministic** — same inputs, same outputs, forever. Regression fixtures stop rotting; parity gates stop flaking.

---

## Design

- **One anchor, everything derived.** The tenant horizon config stores a single anchor: `'NOW'` (rolling) or an explicit date (fixed). The horizon window and the evaluation clock both derive from it. There is structurally one date — never two values that must be kept in agreement.
- **`ClockService.asOf()`** resolves from that anchor:
  - Rolling (`anchor = 'NOW'`) → `asOf = Date.now()`. Live data, live clock — identity behavior.
  - Fixed (`anchor = date`) → `asOf = anchor`. Frozen data, frozen clock.
- **Anchor semantics — RESOLVED from code (was the flagged risk).** `horizon.start` resolves directly to the window start (`resolveHorizonStart` → `horizonStart`, `ctp.service.ts:2846`/`:188-190`), and `horizonEnd = horizonStart + maxDays`. The window is **forward-only** — there is **no `pastDays` lookback** (`pastDueExtensionDays` extends past-due classification *forward*, not before the start). So **window-start == anchor**, and `asOf = horizon.start` for fixed mode with **no derivation** (the `start + pastDays` branch is moot). The mode flag already exists inline at `ctp.service.ts:453` (`(start||'NOW').startsWith('NOW') ? 'rolling' : 'fixed'`) — this sprint centralizes it in `ClockService`, a lift-and-move, not new logic.
- **The anchor's *value* is the pull/as-of instant, not the oldest task (the second half of the fix).** Today `horizon.start` is set from the **earliest committed task in the slice** (slim-100 → Apr 25, dragged there by a stale April WO whose 15-min op is still flagged `running`), which is ~6 weeks before the data's real as-of. The true as-of is the **WIP frontier = max committed-task end (~Jun 7)**. Unifying the clocks onto one anchor faithfully derives everything — but from the *wrong* instant unless the anchor value is corrected to the frontier. Proven: setting the anchor to Jun 7 moved the drill head from April to June. A fixed tenant must anchor to the pull-date/frontier; ideally stamp a provenance `asOf` at ingest so it's recorded, not re-derived from the oldest task.
- **Evaluation vs. operational `Date.now()`.** Evaluation sites — anything that produces a status, judgment, or display anchored in domain time (LATE/at-risk, downtime windows, UI "today", gap math) — move to `clock.asOf()`. Operational sites — perf timers, ID generation, log stamps, TTLs — stay on `Date.now()`, explicitly.
- **Invariant enforced by tooling, not vigilance.** A lint rule (`no-restricted-properties` on `Date.now` / `DateTime.now` / bare `new Date()` in evaluation modules) with operational sites explicitly excepted or moved behind the service. Without this, the diagonal is reintroduced within months and nothing catches it.
- **Tenant-scoped, not a process singleton.** One tenant can be rolling while another is fixed in the same process; `asOf` resolves per tenant config. (`ClockService` depends on the tenant-aware `ConfigService`, so this is free.)
- **The server owns `asOf`; the UI consumes it.** The landing payload (or a small clock field on existing responses) carries `asOf`; the frontend renders "today" and computes any client-side status from *served* asOf, never the browser clock. This is the same value the bake-off UI already surfaces to Kaleb as "demand as of" — one concept, one name, one source.
- **Composes with the bake-off's pinned base.** A batch pins `asOf` alongside the base reference for its duration — frozen inputs, frozen clock, one invariant. (One-line addition to the harness sprint; noted there, wired there.)

---

## Phases (commit after each)

**Phase 0 — Clock inventory + anchor semantics (CC, read-only).**
(a) Sweep and classify **every** now-site — `Date.now()`, `new Date()` no-arg, Luxon `DateTime.now()`, any date-util wrapper defaults — into *evaluation* vs *operational*, as a written deliverable (file, line, classification, one-line reason). Seed already gathered: **evaluation** — `orders/orders.service.ts:107` (LATE), `ctp/ctp.service.ts:503` (rollup now-arg), `ctp/ctp.service.ts:2533,2578` + downtime cluster (`~2547/2592/3452/3487`), UI relative-time filters (`App.tsx` When: Now→/Next-4h/Today/Tomorrow); **operational** — `ctp.service.ts:170,347,349,436,471` (perf timers), `:1209` (`CTP-${Date.now()}` key). (b) **Resolved** (see Design): window-start == anchor, no `pastDays`, `asOf = horizon.start`. Record it so the derivation is provably right. (c) Confirm where the UI gets "today" and whether any client-side status math reads the browser clock. (d) **Anchor value:** locate where the fixed `horizon.start` value is set today (the earliest-included-task derivation) and specify the correct source = pull-date / WIP frontier (max committed-task end); decide provenance-stamp vs. compute-at-load (stamp preferred).

**Phase 1 — ClockService + replacement + lint.**
Add tenant-scoped `ClockService.asOf()` resolving from the horizon anchor (mode flag read in exactly one place). Replace every Phase 0 *evaluation* site with `clock.asOf()`; leave *operational* sites untouched. Add the lint rule barring raw now-calls in evaluation modules, with the operational exceptions explicit. Migrate tenant horizon config to an explicit `anchor` (or keep `start` as the identity anchor and document it — migration preferred), and set fixed tenants' anchor to the corrected frontier value (slim-100 → ~Jun 7).
*Status — DONE.* `ClockService` (`packages/api/src/config/clock.service.ts`, in `ConfigModule`). Evaluation sites wired to `asOf`: `orders.service` LATE/at-risk; `ctp.service` rollup now-arg, group `isLate`, downtime active / currently-down, downtime add-default; and the WIP action-event stamps (`dispatchedAt`/`actualStart`/`holdStart`/`actualEnd`). Operational now-sites (perf timers, id keys, log/audit stamps, the horizon anchor resolution) left on `Date.now()`, each annotated `// clock:operational`. Invariant enforced by `evaluation-clock-guard.spec.ts` (vitest — the project has no eslint). Config: kept `start` as the identity anchor (Open Decision 2); slim-100 anchor corrected to Jun 7. Rolling tenants unaffected (`asOf ≡ Date.now()`).

**Phase 2 — UI asOf.**
Serve `asOf` to the frontend; "today" line, LATE/at-risk chips, and any client-side date judgment read served asOf. Browser clock is no longer an evaluation input anywhere.

**Phase 3 — Verification.**
- **The bug as a test:** on a fixed tenant, advance the wall clock with fake timers and assert **zero status changes** — the permanent regression guard.
- Rolling tenant: behavior byte-identical to before (asOf ≡ Date.now() path).
- slim-100: LATE/at-risk statuses now reflect the June anchor; the drill-head case reads correctly without re-solving; **the schedule sits in June** (anchor value corrected), not April.
- Determinism: two solves of the same fixed tenant on different days produce identical results.
- Lint rule fires on a deliberately planted raw `Date.now()` in an evaluation module.

---

## DO / DON'T

**DO**
- Store **one anchor** in horizon config; derive window edges and `asOf` from it.
- Set the fixed anchor's **value to the pull-date / WIP frontier**, not the earliest included task.
- Resolve the mode flag in **exactly one place** (`ClockService`); every evaluation consumer reads `asOf`.
- Classify every now-site in Phase 0 **before** touching any of them; keep the inventory as the diff baseline.
- Enforce the invariant with a **lint rule**, operational exceptions explicit.
- Keep `ClockService` **tenant-scoped**; make it pinnable per batch (the bake-off pins asOf with the base).
- Serve `asOf` to the UI; render "today" from the server's clock.

**DON'T**
- Don't touch **operational** `Date.now()` (perf timers, IDs, log stamps, TTLs).
- Don't let the UI compute any status from the **browser clock**.
- Don't keep `horizon.start` and `asOf` as **two config values** that must agree — one anchor, derived everything.
- Don't assume unifying the clocks is enough — if the anchor **value** is still the oldest task, a fixed tenant stays broken.
- Don't change **scheduler/isPastDue** behavior — Clock A is already correct; this sprint aligns Clock B to it.
- Don't fold in horizon redesign, calendar changes, or timezone work — clock resolution only.

---

## Out of Scope (named follow-ons)

- **Bake-off harness wiring** — the batch pinning `asOf` alongside the base reference is one line in the harness sprint, noted here, implemented there.
- **Stale WIP reconciliation** — some tasks are flagged `running` weeks before the frontier (slim-100 `28987-QC-5` ends Apr 24 but is `running`); these both drag the oldest-task anchor and misreport WIP. Correcting the anchor *value* to the frontier sidesteps them for this sprint, but reconciling `running`→`completed` at ingest is a separate data-quality fix.
- **Timezone normalization** — separate concern; this sprint changes *which instant* is the reference, not how instants are represented.
- **Simulated-time / replay mode** (stepping asOf through a snapshot for what-if playback) — the ClockService seam enables it; not built here.

---

## Acceptance Criteria

- [ ] `ClockService.asOf()` exists, tenant-scoped, resolving rolling → `Date.now()`, fixed → the pinned anchor; the mode flag is read in exactly one place.
- [ ] Phase 0 inventory delivered: every now-site classified evaluation/operational; anchor semantics recorded (window-start == anchor, `asOf = horizon.start`); the anchor-*value* source specified (pull-date/frontier).
- [ ] Fixed anchor **value** = the data's as-of/WIP frontier (slim-100 anchors to ~Jun 7, not Apr 25); the drill head schedules in June.
- [ ] All evaluation sites (LATE/at-risk, downtime, UI "today", gap math) read `asOf`; all operational sites unchanged.
- [x] Invariant guard bars raw now-calls in evaluation modules — vitest `config/__tests__/evaluation-clock-guard.spec.ts` (no eslint in project); operational sites annotated `// clock:operational`.
- [ ] Fixed tenant + fake-timer clock advance ⇒ **zero status changes** (the bug, as a test).
- [ ] Rolling tenant behavior is byte-identical to before.
- [ ] Fixed-tenant solves are deterministic across days (same inputs → identical outputs).
- [ ] UI renders "today" and all client-side status from **served** asOf.
- [ ] No changes to scheduler/`isPastDue` (Clock A) behavior.

---

## Open Decisions

1. **`horizon.start` semantics** — *Resolved from code (Phase 0b):* window-start == anchor, forward-only window, no `pastDays` → `asOf = horizon.start` (identity). Recommended end state still an explicit `anchor` field for clarity, but the derivation is trivial.
2. **Config migration vs. derivation** — *Resolved:* kept `start` as the **identity anchor** (Phase 0b proved `asOf = horizon.start`). No `start`→`anchor` migration: renaming across 15 tenant configs + `IHorizonConfig` + every reader carries real test risk for zero behavioral gain. An explicit `anchor` field remains an optional clarity refinement, not a blocker.
3. **Anchor value source** — the fixed anchor must be the **pull-date / WIP frontier (max committed-task end)**, not the earliest included task (today's mis-derivation). Decide: (a) stamp a provenance `asOf` at ingest, or (b) compute the frontier at load. Provenance-stamp preferred; back-compat fallback to `horizon.start` if absent.
4. **How the UI receives asOf** — field on the landing payload vs. a small clock endpoint. Landing-payload field recommended (no extra round trip; it's per-tenant state the landing read already carries).
