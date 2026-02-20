import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";

export interface IBatchRule extends IKeyEntity {
  batchKey: string;           // Grouping key — tasks with same batchKey are candidates
  resourceType: string;       // Which resource type this batch runs on (e.g., "Oven", "PaintBooth")
  minBatchSize: number;       // Don't run until you have at least this many
  maxBatchSize: number;       // Resource can't hold more than this
  fixedDuration: number;      // Duration in seconds regardless of batch size (0 = not fixed)
  minDuration: number;        // Minimum duration in seconds
  batchWindow: number;        // Max time to wait for batch to fill (seconds, 0 = no limit)
}

export class CTPBatchRule extends CTPKeyEntity implements IBatchRule {
  public batchKey: string;
  public resourceType: string;
  public minBatchSize: number;
  public maxBatchSize: number;
  public fixedDuration: number;
  public minDuration: number;
  public batchWindow: number;

  constructor(k?: string) {
    super("BatchRule", k, k);
    this.batchKey = k ?? "";
    this.resourceType = "";
    this.minBatchSize = 1;
    this.maxBatchSize = Number.MAX_VALUE;
    this.fixedDuration = 0;
    this.minDuration = 0;
    this.batchWindow = 0;
  }
}

export class CTPBatchRules extends EntityHashMap<CTPBatchRule> {
  public constructor() {
    super();
  }

  public override fromArray(arr: CTPBatchRule[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }

  public findByBatchKey(batchKey: string): CTPBatchRule[] {
    let results: CTPBatchRule[] = [];
    this.forEach((rule) => {
      if (rule.batchKey === batchKey) results.push(rule);
    });
    return results;
  }
}
