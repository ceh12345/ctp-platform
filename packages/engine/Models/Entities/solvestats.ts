"strict";

export class SolveStatistics {
  public strategy: string;
  public totalTimeMs: number = 0;
  public propagationTimeMs: number = 0;
  public scoringTimeMs: number = 0;
  public assignmentTimeMs: number = 0;

  public tasksProcessed: number = 0;
  public tasksFeasible: number = 0;
  public tasksInfeasible: number = 0;
  public tasksPinned: number = 0;
  public tasksExcluded: number = 0;

  public backtrackAttempts: number = 0;
  public backtrackSuccesses: number = 0;
  public bumpsPerformed: number = 0;

  public iterations: number = 0;
  public bestIterationFound: number = 0;

  public contextsEvaluated: number = 0;
  public contextsPerTask: number = 0;

  public totalScore: number = 0;
  public scoreBreakdown: Record<string, number> = {};

  public windowsTightened: number = 0;

  constructor(strategy: string = 'quick') {
    this.strategy = strategy;
  }

  public finalize(): void {
    if (this.tasksProcessed > 0) {
      this.contextsPerTask = Math.round(this.contextsEvaluated / this.tasksProcessed);
    }
  }
}
