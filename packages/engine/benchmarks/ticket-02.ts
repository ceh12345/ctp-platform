/**
 * ticket-02.ts — CODE-OPTIMIZATION-SPRINT Ticket 2 (INVESTIGATED, DISMISSED)
 *
 * This file is intentionally inert. T2 (replace `for (let a of ranges)` linear
 * scan in `addToFloat` with `Map<qty, CTPRange>`) was prototyped with a sibling-
 * method A/B harness, measured against two fixtures, and reverted in the same
 * investigation cycle. The engine no longer carries the sibling method, the
 * `useFloatRangeMap` flag, or the dispatch in `processPtrs` that this bench
 * originally drove. Re-introducing them is not recommended; see the evidence
 * before proposing otherwise.
 *
 * EVIDENCE
 * --------
 *   - results/ticket-02.json        (1000 nodes × 40 distinct qtys,  ×1.02)
 *   - results/ticket-02-stress.json (3000 nodes × 300 distinct qtys, ×0.978)
 *   - docs/sprints/CODE-OPTIMIZATION-SPRINT.md — see "TICKET 2 — INVESTIGATED,
 *     DISMISSED" entry for the full structural-ceiling + constant-factor
 *     analysis and the production-scale rationale (Stafford-class: ~50-500
 *     intervals × 1-5 distinct qtys per resource, where Map.get loses to a
 *     JIT'd 5-element array scan on constant factors alone).
 *
 * SUBSIDIARY FINDINGS (not pursued in this sprint)
 * ------------------------------------------------
 *   - The original addToFloat has a latent foot-gun where `r` stays as
 *     last-created-range when `found===true` (works by accident via the
 *     `r.processed` gate). Pure refactor, no perf benefit.
 *   - addToFixed/addToUntracked together dominate calculate() wall-clock.
 *     CTPIntervals.add is already O(1)-per-call on sorted input via the
 *     atOrAfterStartTime tail-check (intervals.ts:26), so the actual win in
 *     this area would require a different shape (batching, or eliding the
 *     index when matrix.recalc===false).
 */

export {}; // module marker; nothing to run.
