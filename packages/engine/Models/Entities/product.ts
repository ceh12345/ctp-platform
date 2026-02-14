"strict";
import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";
import { List } from "../Core/list";

// Product type constants
export class CTPProductTypeConstants {
  public static RAW = "RAW";
  public static INTERMEDIATE = "INTERMEDIATE";
  public static FINISHED = "FINISHED";
}

// A single input in a bill of materials
export interface IBOMInput {
  productKey: string;       // key of the input product (raw or intermediate)
  qtyPer: number;           // quantity needed per 1 unit of output
  scrapRate: number;        // expected loss rate (0.05 = 5%)
  unitOfMeasure: string;    // UOM for this input
}

export class CTPBOMInput implements IBOMInput {
  public productKey: string;
  public qtyPer: number;
  public scrapRate: number;
  public unitOfMeasure: string;

  constructor(productKey?: string, qtyPer?: number, scrapRate?: number, uom?: string) {
    this.productKey = productKey ?? "";
    this.qtyPer = qtyPer ?? 1.0;
    this.scrapRate = scrapRate ?? 0.0;
    this.unitOfMeasure = uom ?? "pcs";
  }

  // Gross qty needed to produce a given net output qty
  public grossQty(netOutputQty: number): number {
    if (this.scrapRate >= 1.0) return 0;
    return (this.qtyPer * netOutputQty) / (1.0 - this.scrapRate);
  }
}

export class CTPBOMInputList extends List<CTPBOMInput> {
  constructor() {
    super();
  }

  // Compute all gross material requirements for a given output qty
  public grossRequirements(outputQty: number): Map<string, number> {
    const reqs = new Map<string, number>();
    this.forEach((input) => {
      const gross = input.grossQty(outputQty);
      const existing = reqs.get(input.productKey) ?? 0;
      reqs.set(input.productKey, existing + gross);
    });
    return reqs;
  }
}

// The product itself
export interface IProduct extends IKeyEntity {
  productType: string;
  unitOfMeasure: string;
  parentProductKey: string | null;
  bomInputs: CTPBOMInputList;
  outputScrapRate: number;
}

export class CTPProduct extends CTPKeyEntity implements IProduct {
  public productType: string;
  public unitOfMeasure: string;
  public parentProductKey: string | null;
  public bomInputs: CTPBOMInputList;
  public outputScrapRate: number;  // scrap rate when producing THIS product

  constructor(t?: string, n?: string, k?: string, productType?: string, uom?: string) {
    super(t, n, k);
    this.productType = productType ?? CTPProductTypeConstants.FINISHED;
    this.unitOfMeasure = uom ?? "pcs";
    this.parentProductKey = null;
    this.bomInputs = new CTPBOMInputList();
    this.outputScrapRate = 0.0;
  }

  public isRaw(): boolean {
    return this.productType === CTPProductTypeConstants.RAW;
  }

  public isIntermediate(): boolean {
    return this.productType === CTPProductTypeConstants.INTERMEDIATE;
  }

  public isFinished(): boolean {
    return this.productType === CTPProductTypeConstants.FINISHED;
  }

  public hasBOM(): boolean {
    return this.bomInputs.length > 0;
  }

  // How many units to start with to get the desired net output
  public grossOutputQty(netQty: number): number {
    if (this.outputScrapRate >= 1.0) return 0;
    return netQty / (1.0 - this.outputScrapRate);
  }

  // Get all material requirements for producing netQty of this product
  public materialRequirements(netQty: number): Map<string, number> {
    const grossOutput = this.grossOutputQty(netQty);
    return this.bomInputs.grossRequirements(grossOutput);
  }
}

export class CTPProducts extends EntityHashMap<CTPProduct> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }

  public override fromArray(arr: CTPProduct[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }

  // Get all products of a given type
  public byType(productType: string): CTPProduct[] {
    const result: CTPProduct[] = [];
    this.forEach((product) => {
      if (product.productType === productType) {
        result.push(product);
      }
    });
    return result;
  }

  public rawProducts(): CTPProduct[] {
    return this.byType(CTPProductTypeConstants.RAW);
  }

  public intermediateProducts(): CTPProduct[] {
    return this.byType(CTPProductTypeConstants.INTERMEDIATE);
  }

  public finishedProducts(): CTPProduct[] {
    return this.byType(CTPProductTypeConstants.FINISHED);
  }
}
