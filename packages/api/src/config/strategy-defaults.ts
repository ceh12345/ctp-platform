import { StrategyConfig, SolverTierConfig } from './interfaces/strategy.interface';

// ── Dispatching strategies (which task next) ─────────────────────────
export const DISPATCHING_STRATEGIES: StrategyConfig[] = [
  {
    key: 'Chain',
    label: 'Chain',
    icon: '🔗',
    short: 'Chain-by-chain in priority order',
    detail:
      'Processes one task per chain at a time, chains sorted by priority rank. ' +
      'Each chain completes its current phase before moving to the next chain. ' +
      'Good balance between chain integrity and resource utilization.',
    bestFor: 'Healthcare scheduling, job shops, linked activity chains',
    time: '1-5s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 10,
    tier: 'free',
  },
  {
    key: 'ChainFirstFit',
    label: 'First Fit',
    icon: '⚡',
    short: 'First chain, full sequence — fastest',
    detail:
      'Finds the first chain with unscheduled tasks and schedules the entire remaining chain ' +
      'in sequence order. No ranking across chains — first available wins. ' +
      'Fastest strategy, ideal for CTP (Capable to Promise) queries.',
    bestFor: 'CTP promises, WhereTo queries, fast feasibility checks',
    time: '< 1s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 20,
    tier: 'free',
  },
  {
    key: 'DueDate',
    label: 'Due Date',
    icon: '📅',
    short: 'Earliest due date first',
    detail:
      'Schedules tasks with the earliest due date first. Ensures urgent deadlines ' +
      'are addressed before later ones. Works well with chain-aware window tightening.',
    bestFor: 'Make-to-order, firm delivery commitments, deadline-driven environments',
    time: '1-5s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 30,
    tier: 'free',
  },
  {
    key: 'Greedy',
    label: 'Greedy',
    icon: '🎯',
    short: 'Best individual placement, ignores chains',
    detail:
      'Multi-factor sort: earliest end time, best score, priority rank, window start, shortest duration. ' +
      'Optimizes each task individually but may break chain order. ' +
      'Not recommended for datasets with linked tasks.',
    bestFor: 'Independent tasks, no chain dependencies, maximum resource utilization',
    time: '1-5s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 40,
    tier: 'free',
  },
  {
    key: 'ShortestFirst',
    label: 'Shortest First',
    icon: '⏱️',
    short: 'Shortest tasks first (SPT)',
    detail:
      'Classic Shortest Processing Time heuristic. Minimizes average flow time ' +
      'and maximizes the number of tasks completed early. Long tasks get pushed to the end. ' +
      'Not recommended for datasets with linked tasks.',
    bestFor: 'High-volume, many small tasks, minimizing average wait time',
    time: '1-5s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 50,
    tier: 'free',
  },
];

// ── Solver tiers (how hard should the solver try?) ──────────────────
export const SOLVER_TIERS: SolverTierConfig[] = [
  {
    key: 'quick',
    label: 'Quick',
    icon: '⚡',
    short: 'Fast feasibility check',
    detail:
      'First-fit assignment with no optimization. Ideal for CTP queries ' +
      'and quick feasibility checks.',
    defaultStrategy: 'ChainFirstFit',
    time: '< 1s',
    sortOrder: 10,
    enabled: true,
  },
  {
    key: 'balanced',
    label: 'Balanced',
    icon: '🎯',
    short: 'Good balance of speed and quality',
    detail:
      'Chain-aware scheduling with priority ordering. Processes chains in ' +
      'priority rank order. Good trade-off between solution quality and speed.',
    defaultStrategy: 'Chain',
    time: '1-5s',
    sortOrder: 20,
    enabled: true,
  },
  {
    key: 'thorough',
    label: 'Thorough',
    icon: '🔬',
    short: 'Deeper search with conflict resolution',
    detail:
      'Chain-aware scheduling with local search neighborhoods to improve ' +
      'solution quality beyond the initial dispatch.',
    defaultStrategy: 'Chain',
    time: '5-30s',
    sortOrder: 30,
    enabled: true,
    solverDepth: { bumpLimit: 10, tabuTenure: 5, iterationCount: 100 },
  },
  {
    key: 'best',
    label: 'Best',
    icon: '🏆',
    short: 'Maximum quality, multiple passes',
    detail:
      'Iterated local search and multi-start heuristics for the best ' +
      'possible solution. Takes significantly longer but finds solutions ' +
      'other tiers miss.',
    defaultStrategy: 'Chain',
    time: '30s-5m',
    sortOrder: 40,
    enabled: true,
    solverDepth: { bumpLimit: 50, tabuTenure: 10, iterationCount: 1000 },
  },
];

export const GLOBAL_STRATEGIES = DISPATCHING_STRATEGIES;

export const DEFAULT_STRATEGY_KEY = 'Chain';
export const DEFAULT_TIER_KEY = 'balanced';
