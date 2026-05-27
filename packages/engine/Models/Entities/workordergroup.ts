import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";

export enum WorkOrderGroupStatus {
  ON_TRACK = 0,
  AT_RISK = 1,
  LATE = 2,
  BLOCKED = 3,
  COMPLETED = 4,
  CANCELLED = 5,
}

export interface IWorkOrderGroup extends IKeyEntity {
  // Membership
  workOrderKeys: string[];
  headWorkOrderKey: string | null;

  // Source-of-truth timing (from ERP at sync time)
  sourceStart: number | null;
  sourceEnd: number | null;
  promiseDate: number | null;

  // Computed timing (recomputed by rollup engine after each solve)
  computedStart: number | null;
  computedEnd: number | null;

  // Rolled-up counts
  totalWorkOrders: number;
  completedWorkOrders: number;
  inProcessWorkOrders: number;
  notStartedWorkOrders: number;
  cancelledWorkOrders: number;

  // Rolled-up qty
  totalDemandQty: number;
  totalScheduledQty: number;
  totalProducedQty: number;

  // Status (derived)
  status: WorkOrderGroupStatus;

  // Convenience
  completionRatio(): number;
  isFullyComplete(): boolean;
  isLate(now: number): boolean;
}

export class CTPWorkOrderGroup extends CTPKeyEntity implements IWorkOrderGroup {
  public workOrderKeys: string[] = [];
  public headWorkOrderKey: string | null = null;

  public sourceStart: number | null = null;
  public sourceEnd: number | null = null;
  public promiseDate: number | null = null;

  public computedStart: number | null = null;
  public computedEnd: number | null = null;

  public totalWorkOrders: number = 0;
  public completedWorkOrders: number = 0;
  public inProcessWorkOrders: number = 0;
  public notStartedWorkOrders: number = 0;
  public cancelledWorkOrders: number = 0;

  public totalDemandQty: number = 0;
  public totalScheduledQty: number = 0;
  public totalProducedQty: number = 0;

  public status: WorkOrderGroupStatus = WorkOrderGroupStatus.ON_TRACK;

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
  }

  public completionRatio(): number {
    if (this.totalWorkOrders === 0) return 0;
    return this.completedWorkOrders / this.totalWorkOrders;
  }

  public isFullyComplete(): boolean {
    return this.totalWorkOrders > 0 &&
           this.completedWorkOrders === this.totalWorkOrders;
  }

  // `now` reserved for a future variant that treats "late" as past-now-and-not-complete
  public isLate(_now: number): boolean {
    if (this.computedEnd === null) return false;
    if (this.sourceEnd === null) return false;
    return this.computedEnd > this.sourceEnd;
  }
}

export class CTPWorkOrderGroups extends EntityHashMap<CTPWorkOrderGroup> {
  public constructor(_t?: string, _n?: string, _k?: string) {
    super();
  }

  public override fromArray(arr: CTPWorkOrderGroup[]): void {
    arr.forEach((g) => this.addEntity(g));
  }

  // Find all groups whose computed end exceeds source end
  public lateGroups(): CTPWorkOrderGroup[] {
    const result: CTPWorkOrderGroup[] = [];
    this.forEach((g) => {
      if (g.computedEnd !== null && g.sourceEnd !== null &&
          g.computedEnd > g.sourceEnd) {
        result.push(g);
      }
    });
    return result;
  }

  // Find the group containing a given work order
  public groupForWorkOrder(workOrderKey: string): CTPWorkOrderGroup | null {
    let found: CTPWorkOrderGroup | null = null;
    this.forEach((g) => {
      if (g.workOrderKeys.includes(workOrderKey)) found = g;
    });
    return found;
  }
}
