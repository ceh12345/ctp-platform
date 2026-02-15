"strict";
import { CTPDuration, CTPInterval } from "../Core/window";
import { List } from "../Core/list";
import { IResourcePreference } from "../Entities/resource";
import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import {
  CTPStateChangeConstants,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  CTPWipStateConstants,
} from "../Core/constants";
import { EntityHashMap } from "../Core/hashmap";
import { CTPStateChange } from "./statechange";
import { CTPLinkId } from "../Core/linkid";
import { CTPError, IError } from "../Core/error";

export interface ITaskResource {
  // resource can be only the key value when reading from the flat files
  // Will need to build the resource from the resources hash
  resource: string | undefined;
  isPrimary: boolean;
  scheduledResource: string | undefined;
  preferences: Array<IResourcePreference>;
  mode: string;
}
export class CTPTaskResource implements ITaskResource {
  public resource: string | undefined;
  public isPrimary: boolean = false;
  public scheduledResource: string | undefined;
  public preferences: Array<IResourcePreference>;
  public index: number;
  public qty: number;
  public mode: string;

  constructor(r?: string, prim?: boolean, i?: number, schedResource?: string, mode?: string) {
    this.resource = r ?? undefined;
    this.scheduledResource = schedResource ?? undefined;
    this.preferences = [];
    this.index = i ?? 0;
    this.isPrimary = prim ?? false;
    this.qty = 1.0;
    this.mode = mode ?? "ON";
  }
}

export class CTPTaskResourceList extends List<CTPTaskResource> {
  public sortBySequence() {
    let i = 0;
    this.forEach((r: CTPTaskResource) => {
      r.index = i;
      i += 1;
    });
  }
  public primaryResourceIndex: number | undefined = -1;
}

// Material input consumed by a task
export interface ITaskMaterialInput {
  productKey: string;       // key of the input product (raw or intermediate)
  requiredQty: number;      // quantity needed for this task
  scrapRate: number;        // task-level scrap rate for this input
  unitOfMeasure: string;
}

export class CTPTaskMaterialInput implements ITaskMaterialInput {
  public productKey: string;
  public requiredQty: number;
  public scrapRate: number;
  public unitOfMeasure: string;

  constructor(productKey?: string, qty?: number, scrapRate?: number, uom?: string) {
    this.productKey = productKey ?? "";
    this.requiredQty = qty ?? 0;
    this.scrapRate = scrapRate ?? 0.0;
    this.unitOfMeasure = uom ?? "pcs";
  }

  // Gross qty needed accounting for scrap
  public grossQty(): number {
    if (this.scrapRate >= 1.0) return 0;
    return this.requiredQty / (1.0 - this.scrapRate);
  }
}

export class CTPTaskMaterialInputList extends List<CTPTaskMaterialInput> {
  constructor() {
    super();
  }

  // Sum up all gross requirements by product key
  public grossRequirements(): Map<string, number> {
    const reqs = new Map<string, number>();
    this.forEach((input) => {
      const gross = input.grossQty();
      const existing = reqs.get(input.productKey) ?? 0;
      reqs.set(input.productKey, existing + gross);
    });
    return reqs;
  }
}

export interface ITask extends IKeyEntity {
  processed: boolean;
  window: CTPInterval | null;
  state: number;
  wipstate: number;
  scheduled: CTPInterval | null;
  duration: CTPDuration | null;
  capacityResources: CTPTaskResourceList | null;
  materialsResources: CTPTaskResourceList | null;
  score: number;
  requiresSetup: boolean;

  // Product linkage
  outputProductKey: string | null;
  outputQty: number;
  outputScrapRate: number;
  inputMaterials: CTPTaskMaterialInputList | null;
}

export class CTPTask extends CTPKeyEntity implements ITask {
  public window: CTPInterval | null;
  public state: number = 0;
  public wipstate: number = 0;
  public scheduled: CTPInterval | null;
  public duration: CTPDuration | null;
  public feasible: CTPInterval | null;

  public capacityResources: CTPTaskResourceList | null;
  public materialsResources: CTPTaskResourceList | null;

  public linkId: CTPLinkId | undefined;

  public score: number;

  public process: string | undefined;
  public requiresSetup: boolean;

  public subType: string | null;
  public processed: boolean;

  public errors: IError[];

  // Product output — what does this task produce?
  public outputProductKey: string | null;
  public outputQty: number;
  public outputScrapRate: number;   // task-level scrap rate on output (0.05 = 5%)

  // Material inputs — what does this task consume?
  public inputMaterials: CTPTaskMaterialInputList | null;

  public resetScore() {
    this.score = Number.MAX_VALUE;
    this.feasible = null;
  }

  public canMove(): boolean {
    return this.wipstate == CTPWipStateConstants.NOT_STARTED;
  }

  public hasLinkId() {
    return this.linkId != undefined;
  }

  public hasScore() {
    return this.score != undefined && this.score != Number.MAX_VALUE;
  }

  public hasOutput(): boolean {
    return this.outputProductKey != null && this.outputProductKey !== "";
  }

  public hasInputMaterials(): boolean {
    return this.inputMaterials != null && this.inputMaterials.length > 0;
  }

  // Net good output after scrap
  public netOutputQty(): number {
    return this.outputQty * (1.0 - this.outputScrapRate);
  }

  // Gross input requirements for all materials on this task
  public grossInputRequirements(): Map<string, number> {
    if (!this.inputMaterials) return new Map();
    return this.inputMaterials.grossRequirements();
  }

  public clearErrors() {
    this.errors = [];
  }

  public addError(a: string, r: string) {
    this.errors.push({ agent: a, reason: r, type: "" });
  }

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
    this.window = new CTPInterval();
    this.scheduled = null;
    this.duration = null;
    this.capacityResources = null;
    this.materialsResources = null;
    this.state = CTPTaskStateConstants.NOT_SCHEDULED;
    this.wipstate = CTPWipStateConstants.NOT_STARTED;
    this.processed = false;
    this.score = Number.MAX_VALUE;
    this.cost = 0;
    this.type = this.type ?? CTPTaskTypeConstants.PROCESS;
    this.requiresSetup = true;
    this.subType = null;
    this.process = undefined;
    this.linkId = undefined;
    this.errors = [];
    this.feasible = null;

    // Product linkage defaults
    this.outputProductKey = null;
    this.outputQty = 0;
    this.outputScrapRate = 0.0;
    this.inputMaterials = null;
  }
}

export class CTPTaskList extends List<CTPTask> {
  public sortBySequence(): void {
    this.sort((n1, n2) => {
      if (n1.sequence > n2.sequence) return 1;
      if (n1.sequence < n2.sequence) return -1;
      return 0;
    });
  }
}

export class CTPTasks extends EntityHashMap<CTPTask> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }
  public override fromArray(arr: CTPTask[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }

  // Get all tasks that produce a given product
  public tasksByOutputProduct(productKey: string): CTPTask[] {
    const result: CTPTask[] = [];
    this.forEach((task) => {
      if (task.outputProductKey === productKey) {
        result.push(task);
      }
    });
    return result;
  }

  // Get all tasks that consume a given product as input
  public tasksByInputProduct(productKey: string): CTPTask[] {
    const result: CTPTask[] = [];
    this.forEach((task) => {
      if (task.inputMaterials) {
        task.inputMaterials.forEach((input) => {
          if (input.productKey === productKey) {
            result.push(task);
          }
        });
      }
    });
    return result;
  }

  // Total gross material requirements across all tasks for a given product
  public totalMaterialRequirement(productKey: string): number {
    let total = 0;
    this.forEach((task) => {
      const reqs = task.grossInputRequirements();
      total += reqs.get(productKey) ?? 0;
    });
    return total;
  }
}
