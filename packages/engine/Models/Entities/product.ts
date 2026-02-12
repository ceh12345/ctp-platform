import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";

export interface IProduct extends IKeyEntity {}

export class CTPProduct extends CTPKeyEntity {}

export class CTPProducts extends EntityHashMap<CTPProduct> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }

  public override fromArray(arr: CTPProduct[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }
}
