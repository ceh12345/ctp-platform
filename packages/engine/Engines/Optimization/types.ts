/**
 * Optimization-specific interfaces shared across sessions 1–4.
 * All types live here to avoid circular imports.
 */

import { DisjunctiveGraph } from './disjunctivegraph';

// ─── Tabu Search ───

/** Configuration parameters for a tabu search pass. */
export interface TabuConfig {
  /** Tabu list tenure. Typical: 15–25, or sqrt(N). */
  tenure: number;
  /** Maximum iterations before stopping. Typical: 1000–3000. */
  maxIterations: number;
  /** Stop if no improvement for this many iterations. Typical: 200–500. */
  stagnationLimit: number;
  /** Wall-clock time budget in milliseconds. */
  timeBudgetMs: number;
  /** Epoch seconds — tasks starting before this are frozen (0 = no freeze). */
  freezeHorizon: number;
}

/** Output of a completed tabu search pass. */
export interface TabuSearchResult {
  bestGraph: DisjunctiveGraph;
  bestMakespan: number;
  originalMakespan: number;
  improvementPercent: number;
  totalIterations: number;
  totalMovesEvaluated: number;
  convergenceReason: 'stagnation' | 'time_budget' | 'max_iterations';
}

// ─── Neighborhoods ───

/** A candidate swap move between two adjacent tasks on a resource. */
export interface NeighborhoodMove {
  resourceKey: string;
  /** Node index of task currently before nodeIdxB. */
  nodeIdxA: number;
  /** Node index of task currently after nodeIdxA. */
  nodeIdxB: number;
  blockId: number;
  moveType: 'block_first' | 'block_last' | 'internal';
}

/** Result of evaluating a candidate move. */
export interface MoveEvaluation {
  move: NeighborhoodMove;
  feasible: boolean;
  /** Infinity if infeasible. */
  newMakespan: number;
  changeoverDelta: number;
}

// ─── Graph Structures ───

/** A group of ≥2 consecutive critical-path tasks on one resource. */
export interface CriticalBlock {
  id: number;
  resourceKey: string;
  resourceName: string;
  /** Node indices in resource sequence order. */
  nodeIndices: number[];
  firstIdx: number;
  lastIdx: number;
  totalDuration: number;
  percentOfMakespan: number;
}

/** Undo token for a swap operation. */
export interface SwapRecord {
  resourceKey: string;
  /** nodeIdxA was originally before nodeIdxB. */
  nodeIdxA: number;
  nodeIdxB: number;
}

// ─── Translation ───

/** Output of translating an optimized graph back to the landscape (Session 3). */
export interface TranslationResult {
  tasksRescheduled: number;
  tasksFailed: number;
  failedTaskKeys: string[];
}

/** Before/after comparison for one task. */
export interface TaskDiff {
  taskKey: string;
  taskName: string;
  orderKey: string | null;
  originalStart: number;
  originalEnd: number;
  originalResource: string;
  optimizedStart: number;
  optimizedEnd: number;
  optimizedResource: string;
  /** Positive = moved later, negative = moved earlier (seconds). */
  startDelta: number;
  movedResource: boolean;
}
