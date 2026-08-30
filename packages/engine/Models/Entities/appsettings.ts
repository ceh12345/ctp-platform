"strict";

import { CTPScheduleDirectionConstants } from "../Core/constants";

export interface IAppSettings {
  flowAround: boolean;
  maxLateness: number;
  tasksPerLoop: number;
  resetUageAfterProcessChange: boolean;
  scheduleDirection: number,
  solverStrategy: string;
  maxBacktrackAttempts: number;
  topNContexts: number;
  maxChainCombos: number;
  debugLogging: boolean;
  recordSolveSteps: boolean;
  maxSolveSteps: number;
  // Tabu search settings
  tabuIterations?: number;
  tabuStagnation?: number;
  tabuTimeBudgetMs?: number;
  freezeHorizon?: number;
  optimizeObjective?: 'makespan' | 'weightedTardiness';
  // ILS settings
  ilsPasses?: number;
  ilsPerturbStrength?: number;
  ilsTimeBudgetMs?: number;
}

export class CTPAppSettings implements IAppSettings {
  public flowAround: boolean = false;
  public maxLateness: number = 0;
  public tasksPerLoop: number = 50;
  public topTasksToSchedule: number = 2;
  public resetUageAfterProcessChange: boolean = true;
  public scheduleDirection: number = CTPScheduleDirectionConstants.FORWARD;
  public solverStrategy: string = 'Chain';
  public activeSequence: string | null = null;  // Processing Sequences: demand-priority sequence name for this solve
  /** Computed at solve time — true when any task has a linkId (chain). Not a config setting. */
  public hasChains: boolean = false;
  public maxBacktrackAttempts: number = 3;
  public topNContexts: number = 5;
  public maxChainCombos: number = 500;
  public debugLogging: boolean = false;
  public recordSolveSteps: boolean = false;
  public maxSolveSteps: number = 500;
  // Tabu search settings (optional — defaults applied in buildTabuConfig)
  public tabuIterations?: number;
  public tabuStagnation?: number;
  public tabuTimeBudgetMs?: number;
  public freezeHorizon?: number;
  // Optimizer objective: 'makespan' (default) or 'weightedTardiness'
  // (rank moves by customer-promise tardiness, makespan as tiebreak)
  public optimizeObjective?: 'makespan' | 'weightedTardiness';
  // ILS settings (optional — defaults applied in ILSScheduler)
  public ilsPasses?: number;
  public ilsPerturbStrength?: number;
  public ilsTimeBudgetMs?: number;
}

export interface ITimingSetting {
  fromTiming: string;
  toTiming: string;
}

export const StartToStartTiming = {
  fromTiming: "START",
  toTiming: "START",
};

export const EndToStartTiming = {
  fromTiming: "END",
  toTiming: "START",
};

export const CTPAppColors = {
  unavailable: "red",
  process: "blue",
  setup: "yellow",
  available: "green",
  teardown: "yellow",
  maintenance: "red",
};
