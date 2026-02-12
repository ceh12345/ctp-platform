import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";

export interface IOrder extends IKeyEntity {
  demandQty: number;
  dueDate: number;
  lateDueDate: number;
  fillRate: number;
}

export class CTPOrder extends CTPKeyEntity implements IOrder {
  public demandQty: number = 0;
  public dueDate: number = 0;
  public lateDueDate: number = 0;
  public fillRate: number = 0;

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
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
}
