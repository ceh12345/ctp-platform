import { BumpEvent } from '../../Engines/chaincontextengine';

export interface ISolveResult {
  strategy: string;
  totalTasks: number;
  scheduled: number;
  notScheduled: number;
  infeasible: number;
  contextsEvaluated: number;
  solveTimeMs: number;
  bumps: BumpEvent[];
  totalBumps: number;
  maxBumpsReached: boolean;
}

export class CTPSolveResult implements ISolveResult {
  public strategy: string = "";
  public totalTasks: number = 0;
  public scheduled: number = 0;
  public notScheduled: number = 0;
  public infeasible: number = 0;
  public contextsEvaluated: number = 0;
  public solveTimeMs: number = 0;
  public bumps: BumpEvent[] = [];
  public totalBumps: number = 0;
  public maxBumpsReached: boolean = false;

  public debug(): void {
    console.log("=== Solve Results ===");
    console.log(`Strategy:           ${this.strategy}`);
    console.log(`Total Tasks:        ${this.totalTasks}`);
    console.log(`Scheduled:          ${this.scheduled}`);
    console.log(`Not Scheduled:      ${this.notScheduled}`);
    console.log(`Infeasible:         ${this.infeasible}`);
    console.log(`Contexts Evaluated: ${this.contextsEvaluated}`);
    console.log(`Solve Time:         ${this.solveTimeMs.toFixed(0)}ms`);
    if (this.totalBumps > 0) {
      console.log(`Bumps:              ${this.totalBumps}${this.maxBumpsReached ? ' (max reached)' : ''}`);
      for (const b of this.bumps) {
        console.log(`  ${b.bumpedChainKey} bumped for ${b.beneficiaryChainKey} → ${b.bumpedChainResult}`);
      }
    }
    console.log("=====================");
  }
}
