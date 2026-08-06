/**
 * Optimization-specific interfaces shared across sessions 1–4.
 * All types live here to avoid circular imports.
 */

import { DisjunctiveGraph } from './disjunctivegraph';

// ─── Tabu Search ───

/** One sample of convergence state, emitted from inside the tabu loop. */
export interface IterationSample {
  /** 1-indexed pass number. Populated by the caller (pass-agnostic inside tabuSearch). */
  pass: number;
  /** Iteration within this pass (0-indexed). */
  iteration: number;
  /** Monotonic across passes. Populated by the caller. */
  cumulativeIteration: number;
  /** Makespan of the solution at this iteration. */
  makespan: number;
  /** Global best makespan seen so far across all passes. */
  bestSoFar: number;
  /** True when this sample represents a new global best. */
  isNewBest: boolean;
  /** Milliseconds since the current tabu pass started (not job start). */
  elapsedMs: number;
}

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

  /**
   * Optimization objective. 'makespan' (default, behavior-preserving) or
   * 'weightedTardiness': Σ weight × max(0, chainCompletion − chainDue) over
   * chains that carry a customer promise, compared lexicographically with
   * makespan as the tiebreak. Falls back to makespan when the graph has no
   * due dates.
   */
  objective?: 'makespan' | 'weightedTardiness';

  /**
   * weightedTardiness only: how many of the worst tardy chains contribute
   * their own critical blocks to the neighborhood each iteration. Higher =
   * broader search, more move evaluations per iteration. Default 20.
   */
  tardyChainLimit?: number;

  /**
   * Optional per-iteration sampling callback for live convergence charts.
   * Called on every new global best, every `sampleEveryN` iterations as a heartbeat,
   * the first iteration, and the final iteration (on loop exit).
   * Receives iteration-within-pass; caller adds pass/cumulativeIteration.
   */
  onSample?: (sample: Omit<IterationSample, 'pass' | 'cumulativeIteration'>) => void;

  /** Heartbeat interval — emit a sample every N iterations even without improvement. Default 25. */
  sampleEveryN?: number;
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
  /** True when the best found strictly beats the original under the active
   *  objective (lexicographic for weightedTardiness). Callers gate the
   *  translate-back on this rather than re-deriving the comparison. */
  improved: boolean;
  /** Weighted tardiness of original/best orientations; null when the
   *  objective is makespan or the graph carries no due dates. */
  originalTardiness: number | null;
  bestTardiness: number | null;
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
  /** Weighted tardiness under the trial orientation; null unless the search
   *  runs the weightedTardiness objective and the graph has due dates. */
  newTardiness: number | null;
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
