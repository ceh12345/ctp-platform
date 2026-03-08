export type SolveAction =
  | 'schedule'
  | 'infeasible'
  | 'bump'
  | 'bump-remove'
  | 'retry'
  | 'retry-success'
  | 'retry-fail'
  | 'skip'
  | 'chain-start'
  | 'chain-end';

export interface SolveStep {
  sequence: number;
  action: SolveAction;
  taskKey: string;
  chainKey: string | null;
  resourceKey: string | null;
  resourceName: string | null;
  startTime: string | null;
  endTime: string | null;
  score: number | null;
  reason: string | null;
  chainPhase: string | null;
  bumpTarget: string | null;
}
