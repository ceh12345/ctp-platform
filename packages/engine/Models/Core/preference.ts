"strict";

export interface IPreference {
  rank: number;
  include: boolean;
  isPrimary(): boolean;
}
export class CTPPreference implements IPreference {
  public rank: number = 1;
  public include: boolean = true;

  public isPrimary(): boolean {
    return this.rank == 1;
  }
}
