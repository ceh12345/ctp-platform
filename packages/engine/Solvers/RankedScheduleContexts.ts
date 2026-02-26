import { BestScheduleContext } from '../Models/Entities/schedulecontext';

export interface IRankedEntry {
  rank: number;
  context: BestScheduleContext;
  score: number;
  resourceKeys: string[];
  isNeighborhoodBoundary: boolean;
}

export class RankedScheduleContexts {
  public taskKey: string;
  public ranked: IRankedEntry[];
  private maxN: number;
  private gapThreshold: number;

  constructor(taskKey: string, maxN: number = 5, gapThreshold: number = 0.15) {
    this.taskKey = taskKey;
    this.ranked = [];
    this.maxN = maxN;
    this.gapThreshold = gapThreshold;
  }

  public addCandidate(context: BestScheduleContext): void {
    const score = context.best.blendedScore.score;
    const resourceKeys = this.extractResourceKeys(context);

    const entry: IRankedEntry = {
      rank: 0,
      context,
      score,
      resourceKeys,
      isNeighborhoodBoundary: false,
    };

    // Find insertion index (ascending by score)
    let idx = 0;
    while (idx < this.ranked.length && this.ranked[idx].score <= score) {
      idx++;
    }
    this.ranked.splice(idx, 0, entry);

    // Drop worst if over maxN
    if (this.ranked.length > this.maxN) {
      this.ranked.length = this.maxN;
    }

    this.recompute();
  }

  public best(): BestScheduleContext | null {
    return this.ranked.length > 0 ? this.ranked[0].context : null;
  }

  public alternative(rank: number): BestScheduleContext | null {
    if (rank < 0 || rank >= this.ranked.length) return null;
    return this.ranked[rank].context;
  }

  public hasAlternatives(): boolean {
    return this.ranked.length >= 2;
  }

  public count(): number {
    return this.ranked.length;
  }

  public neighborhoodBoundary(): number {
    for (let i = 0; i < this.ranked.length; i++) {
      if (this.ranked[i].isNeighborhoodBoundary) return i;
    }
    return this.ranked.length;
  }

  public withinNeighborhood(): IRankedEntry[] {
    const boundary = this.neighborhoodBoundary();
    return this.ranked.slice(0, boundary);
  }

  public outsideNeighborhood(): IRankedEntry[] {
    const boundary = this.neighborhoodBoundary();
    return this.ranked.slice(boundary);
  }

  public clear(): void {
    this.ranked = [];
  }

  public removeByResourceKey(resourceKey: string): void {
    this.ranked = this.ranked.filter(
      (entry) => !entry.resourceKeys.includes(resourceKey),
    );
    this.recompute();
  }

  private extractResourceKeys(context: BestScheduleContext): string[] {
    const keys: string[] = [];
    context.best.slot.resources?.forEach((r) => {
      if (r.resource) keys.push(r.resource.key);
    });
    return keys;
  }

  private recompute(): void {
    // Reassign ranks
    for (let i = 0; i < this.ranked.length; i++) {
      this.ranked[i].rank = i;
      this.ranked[i].isNeighborhoodBoundary = false;
    }

    // Detect first neighborhood boundary
    if (this.ranked.length < 2) return;

    const bestScore = this.ranked[0].score;
    const useAbsolute = bestScore === 0;
    const absoluteThreshold = 0.5;

    for (let i = 1; i < this.ranked.length; i++) {
      const gap = this.ranked[i].score - this.ranked[i - 1].score;
      const isGap = useAbsolute
        ? gap > absoluteThreshold
        : gap / bestScore > this.gapThreshold;

      if (isGap) {
        this.ranked[i].isNeighborhoodBoundary = true;
        break; // Only mark the first boundary
      }
    }
  }
}
