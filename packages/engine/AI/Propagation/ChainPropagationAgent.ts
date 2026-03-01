import { ChainFeasibilitySet, ChainContextEntry, ChainTaskFeasibility } from './ChainFeasibilitySet';
import { CTPStartTime } from '../../Models/Entities/starttime';

export interface PropagationResult {
  chainName: string;
  feasible: boolean;
  eliminated: number;
  truncated: number;
  passes: number;
  infeasiblePhase?: string;
  infeasibleReason?: string;
}

export class ChainPropagationAgent {
  private readonly maxPasses = 10;

  /**
   * Run constraint propagation on a chain.
   * Alternates forward and backward passes until stable (no more eliminations).
   */
  public propagate(chain: ChainFeasibilitySet): PropagationResult {
    let totalEliminated = 0;
    let totalTruncated = 0;
    let passes = 0;

    let changed = true;
    while (changed && passes < this.maxPasses) {
      changed = false;
      passes++;

      // Forward pass: predecessor constrains successor
      const fwd = this.forwardPass(chain);
      if (fwd.eliminated > 0 || fwd.truncated > 0) {
        changed = true;
        totalEliminated += fwd.eliminated;
        totalTruncated += fwd.truncated;
      }

      if (!chain.isFeasible()) {
        return this.buildInfeasibleResult(chain, totalEliminated, totalTruncated, passes);
      }

      // Backward pass: successor constrains predecessor
      const bwd = this.backwardPass(chain);
      if (bwd.eliminated > 0 || bwd.truncated > 0) {
        changed = true;
        totalEliminated += bwd.eliminated;
        totalTruncated += bwd.truncated;
      }

      if (!chain.isFeasible()) {
        return this.buildInfeasibleResult(chain, totalEliminated, totalTruncated, passes);
      }

      chain.recomputeBounds();
    }

    return {
      chainName: chain.chainName,
      feasible: true,
      eliminated: totalEliminated,
      truncated: totalTruncated,
      passes,
    };
  }

  // ─── Forward Pass ─────────────────────────────────────────────────────────

  private forwardPass(chain: ChainFeasibilitySet): { eliminated: number; truncated: number } {
    let eliminated = 0;
    let truncated = 0;

    for (let i = 1; i < chain.phases.length; i++) {
      const pred = chain.phases[i - 1];
      const succ = chain.phases[i];
      const maxGap = succ.task.linkId?.maxGap ?? Number.MAX_VALUE;
      const hasMG = succ.task.linkId?.hasMaxGap() ?? false;

      const predEarliestEnd = this.earliestEndForPhase(pred);
      const predLatestEnd = this.latestEndForPhase(pred);

      if (predEarliestEnd === null) continue; // predecessor fully eliminated

      for (const entry of succ.entries) {
        if (entry.eliminated) continue;

        // Eliminate: successor's latest possible time is before predecessor can finish
        if (entry.latestEnd < predEarliestEnd) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Eliminate: successor's earliest start is beyond maxGap after predecessor's latest end
        if (hasMG && entry.earliestStart > predLatestEnd + maxGap) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Truncate: successor can't start before predecessor's earliest end
        truncated += this.truncateStartTimesForward(entry, predEarliestEnd);

        // Truncate: with maxGap, successor can't start after pred latest end + maxGap
        if (hasMG) {
          truncated += this.truncateStartTimesLateBound(entry, predLatestEnd + maxGap);
        }
      }

      this.recomputeEntryBounds(succ);
    }

    chain.recomputeBounds();
    return { eliminated, truncated };
  }

  // ─── Backward Pass ────────────────────────────────────────────────────────

  private backwardPass(chain: ChainFeasibilitySet): { eliminated: number; truncated: number } {
    let eliminated = 0;
    let truncated = 0;

    for (let i = chain.phases.length - 2; i >= 0; i--) {
      const pred = chain.phases[i];
      const succ = chain.phases[i + 1];
      const maxGap = succ.task.linkId?.maxGap ?? Number.MAX_VALUE;
      const hasMG = succ.task.linkId?.hasMaxGap() ?? false;

      const succEarliestStart = this.earliestStartForPhase(succ);
      const succLatestStart = this.latestStartForPhase(succ);

      if (succEarliestStart === null) continue; // successor fully eliminated

      for (const entry of pred.entries) {
        if (entry.eliminated) continue;

        // Eliminate: predecessor starts after successor's latest possible start
        if (succLatestStart !== null && entry.earliestStart > succLatestStart) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Eliminate: predecessor's latest end + maxGap can't reach successor's earliest start
        if (hasMG && entry.latestEnd + maxGap < succEarliestStart) {
          entry.eliminated = true;
          eliminated++;
          continue;
        }

        // Truncate: predecessor's end can't exceed successor's latest start
        if (succLatestStart !== null) {
          truncated += this.truncateEndTimesBackward(entry, succLatestStart);
        }

        // Truncate: with maxGap, predecessor must end late enough to reach successor
        // pred.end >= succEarliestStart - maxGap
        if (hasMG) {
          const minPredEnd = succEarliestStart - maxGap;
          truncated += this.truncateEndTimesFloor(entry, minPredEnd);
        }
      }

      this.recomputeEntryBounds(pred);
    }

    chain.recomputeBounds();
    return { eliminated, truncated };
  }

  // ─── Truncation Helpers ───────────────────────────────────────────────────

  /**
   * Tighten successor start times: eStartW can't be before boundary.
   */
  private truncateStartTimesForward(entry: ChainContextEntry, minStart: number): number {
    let count = 0;
    for (const st of entry.startTimes) {
      if (st.eStartW < minStart) {
        const newStart = Math.min(minStart, st.lStartW);
        if (newStart !== st.eStartW) {
          st.eStartW = newStart;
          st.eEndW = st.eStartW + st.duration;
          count++;
        }
      }
    }
    count += this.removeCollapsedStartTimes(entry);
    return count;
  }

  /**
   * Tighten successor start times: lStartW can't be after boundary.
   */
  private truncateStartTimesLateBound(entry: ChainContextEntry, maxStart: number): number {
    let count = 0;
    for (const st of entry.startTimes) {
      if (st.lStartW > maxStart) {
        const newLStart = Math.max(maxStart, st.eStartW);
        if (newLStart !== st.lStartW) {
          st.lStartW = newLStart;
          st.lEndW = st.lStartW + st.duration;
          count++;
        }
      }
    }
    count += this.removeCollapsedStartTimes(entry);
    return count;
  }

  /**
   * Tighten predecessor end times: lEndW can't exceed boundary.
   */
  private truncateEndTimesBackward(entry: ChainContextEntry, maxEnd: number): number {
    let count = 0;
    for (const st of entry.startTimes) {
      if (st.lEndW > maxEnd) {
        const newLEnd = Math.max(maxEnd, st.eEndW);
        if (newLEnd !== st.lEndW) {
          st.lEndW = newLEnd;
          st.lStartW = st.lEndW - st.duration;
          if (st.lStartW < st.eStartW) st.lStartW = st.eStartW;
          count++;
        }
      }
    }
    count += this.removeCollapsedStartTimes(entry);
    return count;
  }

  /**
   * Raise predecessor's end-time floor: eEndW can't be before minEnd.
   * Each start-time node has its own duration, so eStartW = max(eStartW, minEnd - duration).
   */
  private truncateEndTimesFloor(entry: ChainContextEntry, minEnd: number): number {
    let count = 0;
    for (const st of entry.startTimes) {
      if (st.eEndW < minEnd) {
        const minStart = minEnd - st.duration;
        const newStart = Math.min(Math.max(minStart, st.eStartW), st.lStartW);
        if (newStart !== st.eStartW) {
          st.eStartW = newStart;
          st.eEndW = st.eStartW + st.duration;
          count++;
        }
      }
    }
    count += this.removeCollapsedStartTimes(entry);
    return count;
  }

  /**
   * Remove start-time nodes where the range collapsed below the required duration.
   * Works on both the entry's array AND the context's linked list (same objects by ref).
   */
  private removeCollapsedStartTimes(entry: ChainContextEntry): number {
    let removed = 0;
    const surviving: CTPStartTime[] = [];

    for (const st of entry.startTimes) {
      const eRange = st.eEndW - st.eStartW;
      const lRange = st.lEndW - st.lStartW;
      if (eRange >= st.duration || lRange >= st.duration) {
        surviving.push(st);
      } else {
        removed++;
      }
    }

    if (removed > 0) {
      entry.startTimes = surviving;
      // Sync the linked list: rebuild from surviving nodes
      if (entry.context.slot.startTimes) {
        entry.context.slot.startTimes.clear();
        for (const st of surviving) {
          entry.context.slot.startTimes.insertAtEnd(st);
        }
      }
    }

    // If no start times left, eliminate the entry
    if (entry.startTimes.length === 0) {
      entry.eliminated = true;
    }

    return removed;
  }

  // ─── Phase Bound Helpers ──────────────────────────────────────────────────

  private earliestEndForPhase(phase: ChainTaskFeasibility): number | null {
    let earliest = Number.MAX_VALUE;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      for (const st of entry.startTimes) {
        const end = st.eStartW + st.duration;
        if (end < earliest) earliest = end;
      }
    }
    return earliest === Number.MAX_VALUE ? null : earliest;
  }

  private latestEndForPhase(phase: ChainTaskFeasibility): number {
    let latest = 0;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      if (entry.latestEnd > latest) latest = entry.latestEnd;
    }
    return latest;
  }

  private earliestStartForPhase(phase: ChainTaskFeasibility): number | null {
    let earliest = Number.MAX_VALUE;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      if (entry.earliestStart < earliest) earliest = entry.earliestStart;
    }
    return earliest === Number.MAX_VALUE ? null : earliest;
  }

  private latestStartForPhase(phase: ChainTaskFeasibility): number | null {
    let latest = 0;
    let found = false;
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      for (const st of entry.startTimes) {
        if (st.lStartW > latest) { latest = st.lStartW; found = true; }
      }
    }
    return found ? latest : null;
  }

  // ─── Entry Recomputation ──────────────────────────────────────────────────

  private recomputeEntryBounds(phase: ChainTaskFeasibility): void {
    for (const entry of phase.entries) {
      if (entry.eliminated) continue;
      if (entry.startTimes.length === 0) {
        entry.eliminated = true;
        continue;
      }
      let earliest = Number.MAX_VALUE;
      let latest = 0;
      for (const st of entry.startTimes) {
        if (st.eStartW < earliest) earliest = st.eStartW;
        if (st.lEndW > latest) latest = st.lEndW;
      }
      entry.earliestStart = earliest;
      entry.latestEnd = latest;
    }
  }

  // ─── Infeasible Result ────────────────────────────────────────────────────

  private buildInfeasibleResult(
    chain: ChainFeasibilitySet,
    eliminated: number,
    truncated: number,
    passes: number,
  ): PropagationResult {
    let infeasiblePhase: string | undefined;
    let infeasibleReason: string | undefined;

    for (const phase of chain.phases) {
      if (!phase.entries.some(e => !e.eliminated)) {
        infeasiblePhase = phase.task.name;
        if (phase.entries.length === 0) {
          infeasibleReason = 'No feasible resource combinations';
        } else {
          infeasibleReason = 'All contexts eliminated by chain constraints (maxGap violation)';
        }
        break;
      }
    }

    return {
      chainName: chain.chainName,
      feasible: false,
      eliminated,
      truncated,
      passes,
      infeasiblePhase,
      infeasibleReason,
    };
  }
}
