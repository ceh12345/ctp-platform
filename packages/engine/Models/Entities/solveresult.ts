export interface ISolveResult {
  strategy: string;
  totalTasks: number;
  scheduled: number;
  notScheduled: number;
  infeasible: number;
  contextsEvaluated: number;
  solveTimeMs: number;
}

export class CTPSolveResult implements ISolveResult {
  public strategy: string = "";
  public totalTasks: number = 0;
  public scheduled: number = 0;
  public notScheduled: number = 0;
  public infeasible: number = 0;
  public contextsEvaluated: number = 0;
  public solveTimeMs: number = 0;

  public debug(): void {
    console.log("=== Solve Results ===");
    console.log(`Strategy:           ${this.strategy}`);
    console.log(`Total Tasks:        ${this.totalTasks}`);
    console.log(`Scheduled:          ${this.scheduled}`);
    console.log(`Not Scheduled:      ${this.notScheduled}`);
    console.log(`Infeasible:         ${this.infeasible}`);
    console.log(`Contexts Evaluated: ${this.contextsEvaluated}`);
    console.log(`Solve Time:         ${this.solveTimeMs.toFixed(0)}ms`);
    console.log("=====================");
  }
}
