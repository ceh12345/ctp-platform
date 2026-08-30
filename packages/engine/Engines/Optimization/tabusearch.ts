import { DisjunctiveGraph } from './disjunctivegraph';
import {
  TabuConfig,
  TabuSearchResult,
  NeighborhoodMove,
  MoveEvaluation,
} from './types';
import { CTPStateChanges } from '../../Models/Entities/statechange';

// ═══════════════════════════════════════════════════════════════
//  Tabu List
// ═══════════════════════════════════════════════════════════════

interface TabuEntry {
  nodeA: number;
  nodeB: number;
  resourceKey: string;
  iteration: number;
}

export class TabuList {
  private entries: TabuEntry[] = [];
  private readonly tenure: number;

  constructor(tenure: number) {
    this.tenure = tenure;
  }

  /**
   * A move is tabu if its REVERSE was recently performed.
   * Swapping A,B means the reverse is swapping B,A — so we check
   * if (nodeB, nodeA) was recorded within the tenure window.
   */
  isTabu(move: NeighborhoodMove, currentIter: number): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      // Entries are ordered oldest-first; iterating backwards = newest-first.
      // Once we hit an expired entry, all earlier ones are also expired — break.
      if (currentIter - e.iteration >= this.tenure) break;

      if (
        e.nodeA === move.nodeIdxB &&
        e.nodeB === move.nodeIdxA &&
        e.resourceKey === move.resourceKey
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Record a move that was performed at the given iteration.
   * Periodically prunes expired entries to bound memory.
   */
  add(move: NeighborhoodMove, iteration: number): void {
    this.entries.push({
      nodeA: move.nodeIdxA,
      nodeB: move.nodeIdxB,
      resourceKey: move.resourceKey,
      iteration,
    });

    // Prune when entries exceed 3× tenure (amortized O(1))
    if (this.entries.length > this.tenure * 3) {
      this.entries = this.entries.filter(
        e => (iteration - e.iteration) < this.tenure,
      );
    }
  }

  /** Current number of active (non-expired) entries. Useful for diagnostics. */
  get size(): number {
    return this.entries.length;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Neighborhood Generation (Taillard N7)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate candidate swap moves from critical blocks.
 *
 * For each critical block (≥2 consecutive critical-path tasks on one resource):
 *   - block_first: swap the first task in the block with its resource predecessor
 *   - block_last:  swap the last task in the block with its resource successor
 *   - internal:    swap each pair of adjacent tasks within the block
 *
 * Frozen tasks are excluded from all moves.
 *
 * At 1000 tasks with 8–15 critical blocks of 3–12 tasks each, expect 20–80 moves.
 */
export function generateNeighborhood(
  graph: DisjunctiveGraph,
  tardyChainLimit = 0,
): NeighborhoodMove[] {
  const moves: NeighborhoodMove[] = [];
  // Makespan-critical blocks always; under the weightedTardiness objective
  // also blocks along the worst tardy chains' own paths (tardyChainLimit > 0),
  // so late chains off the global critical path actually get moves proposed.
  const blocks = graph.identifyCriticalBlocks();
  if (tardyChainLimit > 0) blocks.push(...graph.identifyTardyChainBlocks(tardyChainLimit));

  // Blocks from the two sources overlap; dedupe so the same swap isn't
  // evaluated twice (each evaluation is a full critical-path recompute).
  const seen = new Set<string>();
  const push = (m: NeighborhoodMove): void => {
    const a = Math.min(m.nodeIdxA, m.nodeIdxB), b = Math.max(m.nodeIdxA, m.nodeIdxB);
    const k = `${m.resourceKey}:${a}:${b}`;
    if (seen.has(k)) return;
    seen.add(k);
    moves.push(m);
  };

  for (const block of blocks) {
    const seq = graph.resourceSequences.get(block.resourceKey);
    if (!seq) continue;

    const firstNodeIdx = block.nodeIndices[0];
    const lastNodeIdx = block.nodeIndices[block.nodeIndices.length - 1];

    // ─── Move 1: Swap first in block with its resource predecessor ───
    const firstPosInSeq = seq.indexOf(firstNodeIdx);
    if (firstPosInSeq > 0) {
      const predIdx = seq[firstPosInSeq - 1];
      if (!graph.nodes[predIdx].isFrozen && !graph.nodes[firstNodeIdx].isFrozen) {
        push({
          resourceKey: block.resourceKey,
          nodeIdxA: predIdx,
          nodeIdxB: firstNodeIdx,
          blockId: block.id,
          moveType: 'block_first',
        });
      }
    }

    // ─── Move 2: Swap last in block with its resource successor ───
    const lastPosInSeq = seq.indexOf(lastNodeIdx);
    if (lastPosInSeq < seq.length - 1) {
      const succIdx = seq[lastPosInSeq + 1];
      if (!graph.nodes[lastNodeIdx].isFrozen && !graph.nodes[succIdx].isFrozen) {
        push({
          resourceKey: block.resourceKey,
          nodeIdxA: lastNodeIdx,
          nodeIdxB: succIdx,
          blockId: block.id,
          moveType: 'block_last',
        });
      }
    }

    // ─── Move 3: Internal adjacent swaps within block ───
    for (let i = 0; i < block.nodeIndices.length - 1; i++) {
      const a = block.nodeIndices[i];
      const b = block.nodeIndices[i + 1];
      if (!graph.nodes[a].isFrozen && !graph.nodes[b].isFrozen) {
        push({
          resourceKey: block.resourceKey,
          nodeIdxA: a,
          nodeIdxB: b,
          blockId: block.id,
          moveType: 'internal',
        });
      }
    }
  }

  return moves;
}

// ═══════════════════════════════════════════════════════════════
//  Move Evaluation
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate a candidate move without committing it.
 *
 * Sequence: swap → changeover → cycle check → critical path → reverse all.
 * If the swap creates a cycle, it's immediately reversed and marked infeasible.
 *
 * At 1000 nodes: 5–12ms per evaluation (dominated by cycle check + critical path).
 */
export function evaluateMove(
  graph: DisjunctiveGraph,
  move: NeighborhoodMove,
  stateChanges?: CTPStateChanges,
  wantTardiness = false,
): MoveEvaluation {
  // Capture pre-swap makespan for changeover delta calc
  const preMakespan = graph.criticalPath?.makespan ?? 0;

  // 1. Apply the swap
  graph.swapOnResource(move.resourceKey, move.nodeIdxA, move.nodeIdxB);

  // 2. Recompute changeovers for affected tasks
  graph.recomputeChangeovers(move.resourceKey, move.nodeIdxA, move.nodeIdxB, stateChanges);

  // 3. Check for cycles — if cyclic, reverse immediately
  if (graph.hasCycle()) {
    graph.reverseSwap({ resourceKey: move.resourceKey, nodeIdxA: move.nodeIdxA, nodeIdxB: move.nodeIdxB });
    graph.recomputeChangeovers(move.resourceKey, move.nodeIdxB, move.nodeIdxA, stateChanges);
    return { move, feasible: false, newMakespan: Infinity, changeoverDelta: 0, newTardiness: null };
  }

  // 4. Recompute critical path to get new makespan (and, when the search
  //    runs the weightedTardiness objective, the trial tardiness — computed
  //    here because it needs the trial orientation's earliestStart values)
  graph.recomputeCriticalPath();
  const newMakespan = graph.criticalPath?.makespan ?? Infinity;
  const newTardiness = wantTardiness ? graph.computeWeightedTardiness() : null;

  // 5. Reverse everything — we're only evaluating, not committing
  graph.reverseSwap({ resourceKey: move.resourceKey, nodeIdxA: move.nodeIdxA, nodeIdxB: move.nodeIdxB });
  graph.recomputeChangeovers(move.resourceKey, move.nodeIdxB, move.nodeIdxA, stateChanges);
  graph.recomputeCriticalPath();

  return {
    move,
    feasible: true,
    newMakespan,
    newTardiness,
    changeoverDelta: newMakespan - preMakespan,
  };
}

// ═══════════════════════════════════════════════════════════════
//  Main Tabu Search Loop
// ═══════════════════════════════════════════════════════════════

/**
 * Run tabu search on a disjunctive graph to minimize makespan.
 *
 * The algorithm:
 * 1. Generate neighborhood moves from critical blocks (Taillard N7).
 * 2. Evaluate each move: swap → cycle check → critical path → reverse.
 * 3. Select the best non-tabu move (or a tabu move if it beats the global best — aspiration).
 * 4. Apply the selected move (even if it worsens current — this escapes local optima).
 * 5. If the new solution is a global best, snapshot it.
 * 6. Repeat until stagnation, time budget, or max iterations.
 *
 * @param graph       Working graph — will be mutated. Clone before calling if you need the original.
 * @param config      Tabu search parameters.
 * @param stateChanges  Changeover definitions (optional — pass undefined if no changeovers).
 * @returns           Best graph found, stats, and convergence reason.
 */
export function tabuSearch(
  graph: DisjunctiveGraph,
  config: TabuConfig,
  stateChanges?: CTPStateChanges,
): TabuSearchResult {
  const startMs = Date.now();
  const tabu = new TabuList(config.tenure);

  // Ensure critical path is current
  graph.recomputeCriticalPath();
  if (!graph.criticalPath) {
    // Degenerate case: no critical path (empty or cyclic graph)
    return {
      bestGraph: graph.clone(),
      bestMakespan: 0,
      originalMakespan: 0,
      improvementPercent: 0,
      totalIterations: 0,
      totalMovesEvaluated: 0,
      convergenceReason: 'stagnation',
      improved: false,
      originalTardiness: null,
      bestTardiness: null,
    };
  }

  // Objective: 'weightedTardiness' compares (tardiness, makespan)
  // lexicographically — makespan alone when the graph has no due dates or
  // the objective is 'makespan' (tardiness slot stays null).
  const useTardiness =
    config.objective === 'weightedTardiness' && graph.chainDues.size > 0;
  // (tA, mA) strictly better than (tB, mB)?
  const better = (tA: number | null, mA: number, tB: number | null, mB: number): boolean => {
    if (useTardiness && tA !== null && tB !== null && tA !== tB) return tA < tB;
    return mA < mB;
  };

  const originalMakespan = graph.criticalPath.makespan;
  const originalTardiness = useTardiness ? graph.computeWeightedTardiness() : null;
  let bestMakespan = originalMakespan;
  let bestTardiness = originalTardiness;
  let bestGraph = graph.clone();
  let noImproveCount = 0;
  let totalMoves = 0;
  let iter = 0;
  let lastEmittedIter = -1;

  const heartbeat = config.sampleEveryN ?? 25;

  for (iter = 0; iter < config.maxIterations; iter++) {
    // ─── Time budget check ───
    if (Date.now() - startMs > config.timeBudgetMs) break;

    // ─── 1. Generate neighborhood from critical blocks ───
    const moves = generateNeighborhood(graph, useTardiness ? (config.tardyChainLimit ?? 20) : 0);
    if (moves.length === 0) break;

    // ─── 2. Evaluate all candidate moves ───
    let bestMove: NeighborhoodMove | null = null;
    let bestMoveMakespan = Infinity;
    let bestMoveTardiness: number | null = null;

    for (const move of moves) {
      const evaluation = evaluateMove(graph, move, stateChanges, useTardiness);
      totalMoves++;

      if (!evaluation.feasible) continue;

      const isTabu = tabu.isTabu(move, iter);
      const aspirationMet = better(
        evaluation.newTardiness, evaluation.newMakespan, bestTardiness, bestMakespan);

      // Accept if not tabu, OR if aspiration criterion met (global best override)
      if (!isTabu || aspirationMet) {
        if (bestMove === null || better(
          evaluation.newTardiness, evaluation.newMakespan, bestMoveTardiness, bestMoveMakespan)) {
          bestMoveMakespan = evaluation.newMakespan;
          bestMoveTardiness = evaluation.newTardiness;
          bestMove = move;
        }
      }
    }

    let currentMakespan = graph.criticalPath?.makespan ?? Infinity;
    let isNewBest = false;

    // ─── 3. Apply the best move (even if it worsens current — escaping local optima) ───
    if (bestMove) {
      graph.swapOnResource(bestMove.resourceKey, bestMove.nodeIdxA, bestMove.nodeIdxB);
      graph.recomputeChangeovers(
        bestMove.resourceKey, bestMove.nodeIdxA, bestMove.nodeIdxB, stateChanges,
      );
      graph.recomputeCriticalPath();
      tabu.add(bestMove, iter);

      // ─── 4. Check for new global best ───
      currentMakespan = graph.criticalPath?.makespan ?? Infinity;
      const currentTardiness = useTardiness ? graph.computeWeightedTardiness() : null;
      isNewBest = better(currentTardiness, currentMakespan, bestTardiness, bestMakespan);
      if (isNewBest) {
        bestMakespan = currentMakespan;
        bestTardiness = currentTardiness;
        bestGraph = graph.clone();
        noImproveCount = 0;
      } else {
        noImproveCount++;
      }
    } else {
      // No feasible non-tabu move found this iteration
      noImproveCount++;
    }

    // ─── Sample emission (no-op when onSample is unset) ───
    if (config.onSample) {
      const isHeartbeat = (iter % heartbeat) === 0;
      const isFirst = iter === 0;
      if (isNewBest || isHeartbeat || isFirst) {
        config.onSample({
          iteration: iter,
          makespan: currentMakespan,
          bestSoFar: bestMakespan,
          isNewBest,
          elapsedMs: Date.now() - startMs,
        });
        lastEmittedIter = iter;
      }
    }

    // ─── 5. Stagnation check ───
    if (noImproveCount >= config.stagnationLimit) break;
  }

  // Final sample on exit so the curve closes at the real stopping point,
  // regardless of where the heartbeat cadence happened to land.
  if (config.onSample && iter > 0 && lastEmittedIter !== iter - 1) {
    const finalIter = Math.max(0, iter - 1);
    config.onSample({
      iteration: finalIter,
      makespan: graph.criticalPath?.makespan ?? bestMakespan,
      bestSoFar: bestMakespan,
      isNewBest: false,
      elapsedMs: Date.now() - startMs,
    });
  }

  // ─── Determine convergence reason ───
  let convergenceReason: TabuSearchResult['convergenceReason'] = 'max_iterations';
  if (noImproveCount >= config.stagnationLimit) {
    convergenceReason = 'stagnation';
  } else if (Date.now() - startMs > config.timeBudgetMs) {
    convergenceReason = 'time_budget';
  }

  return {
    bestGraph,
    bestMakespan,
    originalMakespan,
    improvementPercent: originalMakespan > 0
      ? ((originalMakespan - bestMakespan) / originalMakespan) * 100
      : 0,
    totalIterations: iter,
    totalMovesEvaluated: totalMoves,
    convergenceReason,
    improved: better(bestTardiness, bestMakespan, originalTardiness, originalMakespan),
    originalTardiness,
    bestTardiness,
  };
}
