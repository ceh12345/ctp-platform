import { CTPTask } from '../../Models/Entities/task';
import { CTPStartTime } from '../../Models/Entities/starttime';
import { ScheduleContext } from '../../Models/Entities/schedulecontext';

/**
 * One feasible option for a task: a specific resource combination
 * with a range of possible start/end times.
 */
export interface ChainContextEntry {
  context: ScheduleContext;
  startTimes: CTPStartTime[];   // Same objects as in the linked list (by reference)
  earliestStart: number;         // Min eStartW across all start-time nodes
  latestEnd: number;             // Max lEndW across all start-time nodes
  eliminated: boolean;           // Marked for removal during propagation
}

/**
 * All feasible options for one task in a chain.
 */
export interface ChainTaskFeasibility {
  task: CTPTask;
  entries: ChainContextEntry[];
  chainEarliestStart: number;   // Min earliestStart across all non-eliminated entries
  chainLatestEnd: number;       // Max latestEnd across all non-eliminated entries
}

/**
 * The feasibility set for an entire chain.
 * Tasks are ordered by sequence (e.g. SETUP → PROC → REC).
 */
export class ChainFeasibilitySet {
  public chainName: string;
  public phases: ChainTaskFeasibility[];

  constructor(chainName: string) {
    this.chainName = chainName;
    this.phases = [];
  }

  /**
   * Build from a chain's tasks and their pre-computed contexts/start-times.
   * Call this AFTER the setup phase has exploded contexts and computed start times.
   */
  public build(
    tasks: CTPTask[],
    getContexts: (task: CTPTask) => ScheduleContext[],
    getStartTimes: (context: ScheduleContext) => CTPStartTime[],
  ): void {
    this.phases = [];

    for (const task of tasks) {
      const contexts = getContexts(task);
      const entries: ChainContextEntry[] = [];

      for (const ctx of contexts) {
        if (!ctx.slot.hasStartTimes()) continue;

        const startTimes = getStartTimes(ctx);
        if (startTimes.length === 0) continue;

        let earliest = Number.MAX_VALUE;
        let latest = 0;
        for (const st of startTimes) {
          if (st.eStartW < earliest) earliest = st.eStartW;
          if (st.lEndW > latest) latest = st.lEndW;
        }

        entries.push({
          context: ctx,
          startTimes,
          earliestStart: earliest,
          latestEnd: latest,
          eliminated: false,
        });
      }

      this.phases.push({
        task,
        entries,
        chainEarliestStart: 0,
        chainLatestEnd: 0,
      });
    }

    this.recomputeBounds();
  }

  /**
   * Recompute the aggregate bounds for each phase
   * based on non-eliminated entries.
   */
  public recomputeBounds(): void {
    for (const phase of this.phases) {
      let earliest = Number.MAX_VALUE;
      let latest = 0;
      for (const entry of phase.entries) {
        if (entry.eliminated) continue;
        if (entry.earliestStart < earliest) earliest = entry.earliestStart;
        if (entry.latestEnd > latest) latest = entry.latestEnd;
      }
      phase.chainEarliestStart = earliest === Number.MAX_VALUE ? 0 : earliest;
      phase.chainLatestEnd = latest;
    }
  }

  /**
   * Count non-eliminated entries for a phase.
   */
  public feasibleCount(phaseIndex: number): number {
    return this.phases[phaseIndex].entries.filter(e => !e.eliminated).length;
  }

  /**
   * Total eliminated across all phases.
   */
  public totalEliminated(): number {
    let count = 0;
    for (const phase of this.phases) {
      count += phase.entries.filter(e => e.eliminated).length;
    }
    return count;
  }

  /**
   * Is the chain still feasible? Every phase must have at least one
   * non-eliminated entry.
   */
  public isFeasible(): boolean {
    return this.phases.every(p => p.entries.some(e => !e.eliminated));
  }

  /**
   * Get the phase index for a task key.
   */
  public phaseIndex(taskKey: string): number {
    return this.phases.findIndex(p => p.task.key === taskKey);
  }

  public debug(): void {
    console.log(`Chain ${this.chainName}: ${this.phases.length} phases`);
    for (let i = 0; i < this.phases.length; i++) {
      const p = this.phases[i];
      const feasible = p.entries.filter(e => !e.eliminated).length;
      const total = p.entries.length;
      console.log(
        `  [${i}] ${p.task.name}: ${feasible}/${total} contexts feasible, ` +
        `range [${p.chainEarliestStart} - ${p.chainLatestEnd}]`,
      );
    }
  }
}
