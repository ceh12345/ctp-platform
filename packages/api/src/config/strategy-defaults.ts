import { StrategyConfig } from './interfaces/strategy.interface';

export const GLOBAL_STRATEGIES: StrategyConfig[] = [
  {
    key: 'quick',
    label: 'Quick',
    icon: '⚡',
    short: 'Fastest results — single pass, no rescheduling',
    detail:
      'Schedules each task once in priority order, picking the best available slot. ' +
      "Fast but won't resolve conflicts — if two tasks compete for the same resource, the first one wins.",
    bestFor: 'Real-time CTP promises, simple schedules, low resource contention',
    time: '< 1s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 10,
    tier: 'free',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    icon: '🎯',
    short: 'Smart scheduling with conflict resolution',
    detail:
      "Schedules tasks in priority order, then goes back to fix problems. When a task can't be placed, " +
      'the solver identifies the bottleneck resource and bumps a lower-priority task to make room. ' +
      'Keeps the top 5 alternatives for each decision so it can recover quickly.',
    bestFor: 'Daily production scheduling, moderate complexity, most use cases',
    time: '1-5s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 20,
    tier: 'free',
  },
  {
    key: 'thorough',
    label: 'Thorough',
    icon: '🔬',
    short: 'Explores alternatives systematically',
    detail:
      'After the initial schedule, the solver searches for improvements by swapping task assignments ' +
      'across resources and time slots. It maintains a memory of recent moves to avoid going in circles. ' +
      'Evaluates neighboring alternatives before making larger jumps.',
    bestFor: 'Complex changeover environments, tight capacity, many competing resource demands',
    time: '10-30s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 30,
    tier: 'standard',
  },
  {
    key: 'best',
    label: 'Best',
    icon: '🏆',
    short: 'Multiple passes for the best possible schedule',
    detail:
      'Builds a complete schedule, then selectively tears apart the weakest sections and rebuilds them. ' +
      'For smaller problems, it runs several complete schedules with different weightings and keeps the best result. ' +
      'Takes significantly longer but finds solutions other strategies miss.',
    bestFor: 'Weekly planning, what-if analysis, when schedule quality matters more than speed',
    time: '30-60s',
    enabled: true,
    isGlobal: true,
    isPublic: true,
    sortOrder: 40,
    tier: 'premium',
  },
];

export const DEFAULT_STRATEGY_KEY = 'balanced';
