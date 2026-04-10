"strict";
import { CTPDuration, CTPInterval } from "../Core/window";
import { List } from "../Core/list";
import { IResourcePreference } from "../Entities/resource";
import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import {
  CTPResourceModeConstants,
  CTPResourcePreferenceModeConstants,
  CTPStateChangeConstants,
  CTPTaskStateConstants,
  CTPTaskTypeConstants,
  CTPWipStateConstants,
} from "../Core/constants";
import { EntityHashMap } from "../Core/hashmap";
import { CTPStateChange } from "./statechange";
import { CTPLinkId } from "../Core/linkid";
import { CTPError, IError } from "../Core/error";
import { InfeasibilityReport } from "./infeasibilityreport";

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
    this.mode = mode ?? CTPResourceModeConstants.REQUIRED;
  }

  public isRequired(): boolean {
    return this.mode === CTPResourceModeConstants.REQUIRED;
  }

  public isMonitored(): boolean {
    return this.mode === CTPResourceModeConstants.MONITORED;
  }

  public isIgnored(): boolean {
    return this.mode === CTPResourceModeConstants.IGNORED;
  }

  /**
   * Return the effective preference list after applying preference modes.
   * EXCLUDED preferences are removed. If any REQUIRED exist, keep only those.
   * Sort: REQUIRED > PREFERRED > AVAILABLE, then by original rank.
   */
  public getEffectivePreferences(): IResourcePreference[] {
    // Remove EXCLUDED
    let prefs = this.preferences.filter(
      p => p.mode !== CTPResourcePreferenceModeConstants.EXCLUDED
    );
    // If any REQUIRED exist, keep ONLY required (hard constraint)
    const required = prefs.filter(
      p => p.mode === CTPResourcePreferenceModeConstants.REQUIRED
    );
    if (required.length > 0) prefs = required;
    // Sort: REQUIRED > PREFERRED > AVAILABLE, then by original rank
    prefs.sort((a, b) => {
      const order = (m: string) =>
        m === CTPResourcePreferenceModeConstants.REQUIRED ? 0 :
        m === CTPResourcePreferenceModeConstants.PREFERRED ? 1 : 2;
      const d = order(a.mode) - order(b.mode);
      return d !== 0 ? d : a.rank - b.rank;
    });
    return prefs;
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
  public unitCost: number;

  constructor(productKey?: string, qty?: number, scrapRate?: number, uom?: string) {
    this.productKey = productKey ?? "";
    this.requiredQty = qty ?? 0;
    this.scrapRate = scrapRate ?? 0.0;
    this.unitOfMeasure = uom ?? "EA";
    this.unitCost = 0;
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
  pinned: boolean;

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
  public pinned: boolean;

  public errors: IError[];

  // Product output — what does this task produce?
  public outputProductKey: string | null;
  public outputQty: number;
  public outputScrapRate: number;   // task-level scrap rate on output (0.05 = 5%)

  // Material inputs — what does this task consume?
  public inputMaterials: CTPTaskMaterialInputList | null;

  // Batching
  public batchRuleKey: string | null = null;  // References a CTPBatchRule by key
  public batchQty: number = 1;                // How many units this task contributes to the batch

  // Cadence — resolved interval in minutes (null = no cadence, tasks start whenever)
  public cadenceIntervalMinutes: number | null = null;

  // Infeasibility report — set when engine cannot place this task
  public infeasibilityReport: InfeasibilityReport | null = null;

  // Manual priority override (0 = no override)
  public manualPriority: number = 0;

  // Planner-facing priority (1 = highest, 100 = lowest)
  public priority: number = 100;
  public originalPriority: number = 100;  // snapshot at hydration time

  /** Transient: true if this task was temporarily pinned by protectOthers. Never serialized. */
  public _tempPinned: boolean = false;

  // Due date fields — hydrated from order at solve time, not persisted
  public dueDate: number = 0;         // epoch seconds, from order
  public lateDueDate: number = 0;     // epoch seconds, from order
  public orderPriority: number = 0;   // from order priority
  public latenessPenaltyPerDay: number = 0;  // dollar cost per day late, from order

  // ─── Commitment Stack Fields ───
  public commitmentLevel: 'completed' | 'running' | 'on_hold' | 'dispatched' | 'pinned' | 'planned' | 'unscheduled' = 'unscheduled';
  public dispatched: boolean = false;
  public dispatchedAt: string | null = null;
  public materialsPulled: boolean = false;
  public percentComplete: number = 0;
  public remainingDuration: number | null = null;
  public actualStart: string | null = null;
  public actualEnd: string | null = null;
  public actualResources: string[] = [];
  public holdReason: string | null = null;
  public estimatedResumeTime: string | null = null;
  public holdStart: string | null = null;

  // ─── Horizon Bucketing Fields ───
  public isPastDue: boolean = false;
  public pastDueDays: number = 0;
  public originalWindowEnd: number = 0;
  public horizonBucket: 'past_due' | 'active' | 'near_horizon' | 'beyond' | '' = '';

  public effectiveRemainingDuration(): number {
    if (this.remainingDuration != null) return this.remainingDuration;
    const totalDuration = this.duration?.duration() ?? 0;
    if (this.percentComplete > 0) {
      return Math.max(0, totalDuration * (1 - this.percentComplete / 100));
    }
    return totalDuration;
  }

  public resetScore() {
    this.score = Number.MAX_VALUE;
    this.feasible = null;
  }

  public canMove(): boolean {
    return this.wipstate == CTPWipStateConstants.NOT_STARTED;
  }

  public canSolve(): boolean {
    if (this.pinned) return false;
    if (!this.includeInSolve) return false;
    if (this.wipstate !== CTPWipStateConstants.NOT_STARTED) return false;
    return true;
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
    this.infeasibilityReport = null;
  }

  public addError(a: string, r: string) {
    if (!this.errors.some(e => e.agent === a && e.reason === r)) {
      this.errors.push({ agent: a, reason: r, type: "" });
    }
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
    this.pinned = false;

    // Product linkage defaults
    this.outputProductKey = null;
    this.outputQty = 0;
    this.outputScrapRate = 0.0;
    this.inputMaterials = null;

    // Batching
    this.batchRuleKey = null;
    this.batchQty = 1;
    this.manualPriority = 0;
    this.priority = 100;
    this.originalPriority = 100;

    // Commitment stack
    this.commitmentLevel = 'unscheduled';
    this.dispatched = false;
    this.dispatchedAt = null;
    this.materialsPulled = false;
    this.percentComplete = 0;
    this.remainingDuration = null;
    this.actualStart = null;
    this.actualEnd = null;
    this.actualResources = [];
    this.holdReason = null;
    this.estimatedResumeTime = null;
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
