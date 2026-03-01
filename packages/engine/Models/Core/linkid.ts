"strict";

export interface ILinkId {
  name: string;
  type: string;
  prevLink: string;
  maxGap: number;
}

export class CTPLinkId implements ILinkId {
  public name: string;
  public type: string;
  public prevLink: string;
  public maxGap: number;

  constructor(n?: string, t?: string, prev?: string, maxGap?: number) {
    this.name = n ?? '';
    this.type = t ?? '';
    this.prevLink = prev ?? '';
    this.maxGap = maxGap ?? Number.MAX_VALUE;
  }

  public hasMaxGap(): boolean {
    return this.maxGap < Number.MAX_VALUE;
  }
}
