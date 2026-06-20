"strict";
import { CTPTask } from "./task";

/** Anything iterable via forEach over tasks — CTPTasks, CTPTaskList, or CTPTask[]. */
type TaskCollection = { forEach(cb: (t: CTPTask) => void): void };

/**
 * Explicit pred/succ edge model — Phase 0 of the edge-list refactor
 * (docs/sprints/sprint-engine-edge-list-refactor.md).
 *
 * `preds[]`/`succs[]` on CTPTask hold task KEYS. They are derived here from
 * `linkId.prevLink` at solve time (in-memory, not serialized). For current
 * linear data every task has `preds.length <= 1`, so anything consuming these
 * via `max(pred)` / `min(succ)` behaves identically to the legacy
 * single-prevLink / sequence-adjacency logic.
 */

/**
 * The single real predecessor key, or null. Mirrors the hydrator's `realPrev`
 * semantics: `prevLink` must be non-empty, not a self-reference, refer to a task
 * in the set, and be in the SAME chain (`linkId.name`). Cross-chain prevLinks
 * are ignored — exactly how the engine treats them today.
 */
function realPrevKey(task: CTPTask, byKey: Map<string, CTPTask>): string | null {
  const prev = task.linkId?.prevLink;
  if (!prev || prev === task.key) return null;
  const pred = byKey.get(prev);
  if (!pred) return null;
  if ((pred.linkId?.name ?? "") !== (task.linkId?.name ?? "")) return null;
  return prev;
}

/**
 * Index a task collection by key. Shared chokepoint so edge resolution always
 * goes through one map (callers resolve once, reuse across the inner loops).
 */
export function indexByKey(tasks: TaskCollection): Map<string, CTPTask> {
  const byKey = new Map<string, CTPTask>();
  tasks.forEach((t) => byKey.set(t.key, t));
  return byKey;
}

/**
 * (Re)build `preds[]`/`succs[]` for every task from `linkId.prevLink`.
 * Idempotent: clears existing edges first. Call once per solve.
 */
export function buildAdjacency(tasks: TaskCollection): void {
  const byKey = indexByKey(tasks);
  tasks.forEach((t) => {
    t.preds = [];
    t.succs = [];
  });
  tasks.forEach((t) => {
    const prev = realPrevKey(t, byKey);
    if (prev) {
      t.preds.push(prev);
      byKey.get(prev)!.succs.push(t.key);
    }
  });
}

/** Resolve `preds[]` keys to tasks (the lookup chokepoint). Skips unresolved keys. */
export function predsOf(task: CTPTask, byKey: Map<string, CTPTask>): CTPTask[] {
  const out: CTPTask[] = [];
  for (const k of task.preds) {
    const t = byKey.get(k);
    if (t) out.push(t);
  }
  return out;
}

/** Resolve `succs[]` keys to tasks. */
export function succsOf(task: CTPTask, byKey: Map<string, CTPTask>): CTPTask[] {
  const out: CTPTask[] = [];
  for (const k of task.succs) {
    const t = byKey.get(k);
    if (t) out.push(t);
  }
  return out;
}

/**
 * Keys transitively reachable from `task` along `succs` ("succ" = descendants) or
 * `preds` ("pred" = ancestors), excluding `task` itself. Replaces the heuristics'
 * legacy use of `sequence` comparison to mean "downstream/upstream of this task":
 * on a single linear chain `reachableKeys(task, ·, "succ")` is exactly the set of
 * higher-sequence tasks, but on a branched (multi-head) process it correctly
 * follows only the actual edges instead of the whole sequence range.
 */
export function reachableKeys(
  task: CTPTask,
  byKey: Map<string, CTPTask>,
  direction: "succ" | "pred",
): Set<string> {
  const out = new Set<string>();
  const stack = [...(direction === "succ" ? task.succs : task.preds)];
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    const t = byKey.get(k);
    if (!t) continue;
    for (const n of direction === "succ" ? t.succs : t.preds) {
      if (!out.has(n)) stack.push(n);
    }
  }
  return out;
}

/**
 * Kahn's topological order over `preds[]`/`succs[]`. Ties broken by `sequence`
 * for determinism. On a cycle, warns and falls back to pure `sequence` order so
 * callers always get a usable ordering (mirrors the hydrator's cycle fallback).
 */
export function topoOrder(tasks: CTPTask[]): CTPTask[] {
  const byKey = new Map<string, CTPTask>();
  tasks.forEach((t) => byKey.set(t.key, t));

  const indeg = new Map<string, number>();
  for (const t of tasks) {
    let d = 0;
    for (const p of t.preds) if (byKey.has(p)) d++;
    indeg.set(t.key, d);
  }

  const bySeq = (a: CTPTask, b: CTPTask) => a.sequence - b.sequence;
  const ready = tasks.filter((t) => (indeg.get(t.key) ?? 0) === 0).sort(bySeq);
  const order: CTPTask[] = [];

  while (ready.length > 0) {
    const t = ready.shift()!;
    order.push(t);
    let pushed = false;
    for (const sk of t.succs) {
      const s = byKey.get(sk);
      if (!s) continue;
      const d = (indeg.get(sk) ?? 0) - 1;
      indeg.set(sk, d);
      if (d === 0) {
        ready.push(s);
        pushed = true;
      }
    }
    if (pushed) ready.sort(bySeq); // keep ties resolving by sequence
  }

  if (order.length !== tasks.length) {
    console.warn(
      `[adjacency] topoOrder: cycle detected (${order.length}/${tasks.length} ordered); ` +
        `falling back to sequence order.`,
    );
    return [...tasks].sort(bySeq);
  }
  return order;
}
