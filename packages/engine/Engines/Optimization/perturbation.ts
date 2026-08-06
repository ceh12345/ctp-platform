import { DisjunctiveGraph } from './disjunctivegraph';
import { RandomSource, defaultRandom } from '../../Models/Core/rng';

// ═══════════════════════════════════════════════════════════════
//  ILS Perturbation
// ═══════════════════════════════════════════════════════════════

/**
 * Perturb a graph by randomly reversing a fraction of non-frozen disjunctive arcs.
 * Used by ILSScheduler to escape the basin of attraction between tabu passes.
 *
 * The graph is mutated in place and returned for chaining convenience.
 * Caller should clone before calling if the original must be preserved.
 *
 * Cycle-safe: each swap is individually checked and reversed if it creates a cycle.
 * The critical path is recomputed once at the end (not after each swap).
 *
 * @param graph     The graph to perturb (mutated).
 * @param strength  Fraction of swappable arcs to reverse. 0.07 = 7% (ILS default).
 *                  Higher values = more disruption = wider exploration but slower convergence.
 * @param rng       Random source. Defaults to `Math.random`; pass a seeded source
 *                  when the run must be reproducible (comparison harness).
 * @returns         The same graph reference (mutated).
 */
export function perturbGraph(
  graph: DisjunctiveGraph,
  strength: number,
  rng: RandomSource = defaultRandom,
): DisjunctiveGraph {
  // ─── 1. Collect all non-frozen adjacent pairs across all resources ───
  const swappableArcs: { resourceKey: string; nodeA: number; nodeB: number }[] = [];

  for (const [resourceKey, seq] of graph.resourceSequences) {
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      if (!graph.nodes[a].isFrozen && !graph.nodes[b].isFrozen) {
        swappableArcs.push({ resourceKey, nodeA: a, nodeB: b });
      }
    }
  }

  if (swappableArcs.length === 0) return graph;

  // ─── 2. Shuffle (Fisher-Yates, unbiased O(n)) and pick a fraction ───
  // Deliberately NOT using .sort(() => Math.random() - 0.5) — that's biased and O(n log n).
  fisherYatesShuffle(swappableArcs, rng);
  const count = Math.max(1, Math.ceil(swappableArcs.length * strength));

  // ─── 3. Apply swaps, reverting any that create cycles ───
  for (let i = 0; i < count && i < swappableArcs.length; i++) {
    const arc = swappableArcs[i];

    // Verify arc is still valid — a previous swap in this batch may have
    // reordered the resource sequence so nodeA is no longer before nodeB.
    const seq = graph.resourceSequences.get(arc.resourceKey);
    if (!seq) continue;
    const posA = seq.indexOf(arc.nodeA);
    const posB = seq.indexOf(arc.nodeB);
    if (posA < 0 || posB < 0 || posA >= posB) continue;

    graph.swapOnResource(arc.resourceKey, arc.nodeA, arc.nodeB);

    if (graph.hasCycle()) {
      graph.reverseSwap({
        resourceKey: arc.resourceKey,
        nodeIdxA: arc.nodeA,
        nodeIdxB: arc.nodeB,
      });
    }
  }

  // ─── 4. Recompute critical path once after all perturbations ───
  graph.recomputeCriticalPath();

  return graph;
}

// ─── Helpers ───

/**
 * Fisher-Yates in-place shuffle. Uniform random, O(n).
 */
function fisherYatesShuffle<T>(arr: T[], rng: RandomSource): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
