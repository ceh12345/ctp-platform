import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";
import { IValidationError } from "../Core/error";

export interface IOrder extends IKeyEntity {
  productKey: string;
  demandQty: number;
  dueDate: number;
  lateDueDate: number;
  fillRate: number;
  priority: number;
}

export class CTPOrder extends CTPKeyEntity implements IOrder {
  public productKey: string = "";
  public demandQty: number = 0;
  public dueDate: number = 0;
  public lateDueDate: number = 0;
  public fillRate: number = 0;
  public priority: number = 0;
  public scheduledQty: number = 0;
  public latenessPenaltyPerDay: number = 0;
  public validationErrors: IValidationError[] = [];

  public groupKey: string | null = null;       // → CTPWorkOrderGroup.key
  public parentOrderKey: string | null = null; // → another CTPOrder.key, for the WO tree

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
  }

  public addValidationError(err: IValidationError): void {
    if (!this.validationErrors.some(e =>
      e.agent === err.agent && e.reason === err.reason && e.field === err.field
    )) {
      this.validationErrors.push(err);
    }
  }

  public clearValidationErrors(): void {
    this.validationErrors = [];
  }

  public hasErrors(): boolean {
    return this.validationErrors.some(e => e.severity === "error");
  }

  public hasWarnings(): boolean {
    return this.validationErrors.some(e => e.severity === "warning");
  }

  // How much of the order is fulfilled
  public computeFillRate(): number {
    if (this.demandQty === 0) return 100;
    this.fillRate = Math.min(100, (this.scheduledQty / this.demandQty) * 100);
    return this.fillRate;
  }

  public isFullyFilled(): boolean {
    return this.scheduledQty >= this.demandQty;
  }

  public shortfall(): number {
    return Math.max(0, this.demandQty - this.scheduledQty);
  }
}

export class CTPOrders extends EntityHashMap<CTPOrder> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }

  public override fromArray(arr: CTPOrder[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }

  // Get all orders for a given product
  public ordersByProduct(productKey: string): CTPOrder[] {
    const result: CTPOrder[] = [];
    this.forEach((order) => {
      if (order.productKey === productKey) {
        result.push(order);
      }
    });
    return result;
  }

  // Total demand for a product across all orders
  public totalDemand(productKey: string): number {
    let total = 0;
    this.forEach((order) => {
      if (order.productKey === productKey) {
        total += order.demandQty;
      }
    });
    return total;
  }
}
