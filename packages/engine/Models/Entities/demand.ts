import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";

export interface IDemand extends IKeyEntity {}

export class CTPDemand extends CTPKeyEntity {
  public productId: string;
  public demandQty: number;

  constructor() {
    super();
    this.productId = "";
    this.demandQty = 0;
  }
}

export class CTPProducts extends EntityHashMap<CTPDemand> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }

  public override fromArray(arr: CTPDemand[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }
}
