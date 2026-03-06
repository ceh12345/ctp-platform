"strict";

export interface ILinkId {
  name: string;
  type: string;
  prevLink: string;
  maxGap: number | null;    // max seconds between predecessor end and successor start
                            // null = unconstrained
                            //    0 = back-to-back (no gap)
                            //  900 = up to 15 min gap allowed
}

export class CTPLinkId implements ILinkId {
  public name: string;
  public type: string;
  public prevLink: string;
  public maxGap: number | null;

  constructor(n?: string, t?: string, prev?: string, maxGap?: number | null) {
    this.name = n ?? '';
    this.type = t ?? '';
    this.prevLink = prev ?? '';
    this.maxGap = maxGap ?? null;
  }
}
