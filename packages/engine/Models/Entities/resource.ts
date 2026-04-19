import { CTPKeyEntity, IKeyEntity } from "../Core/entity";
import { EntityHashMap } from "../Core/hashmap";
import { IValidationError } from "../Core/error";
import { CTPAvailable, CTPAssignments } from "../Intervals/intervals";
import { CTPPreference, IPreference } from "../Core/preference";
import { List } from "../Core/list";
import { CTPInterval } from "../Core/window";
import { AvailableMatrix } from "../Intervals/availablematrix";
import { CTPResourceConstants, CTPResourcePreferenceModeConstants } from "../Core/constants";

export interface IResource extends IKeyEntity {
  original: CTPAvailable | null;
  assignments: CTPAssignments | null;
  available: AvailableMatrix;
  class: string;
}

export class CTPBaseResource extends CTPKeyEntity {
  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
  }
}

export class CTPResource extends CTPBaseResource implements IResource {
  public original: CTPAvailable | null = null;
  public assignments: CTPAssignments | null = null;
  public available: AvailableMatrix;
  public class: string;
  public hourlyRate: number = 0;
  public validationErrors: IValidationError[] = [];

  constructor(c?: string, t?: string, n?: string, k?: string) {
    super(t, n, k);
    this.available = new AvailableMatrix();
    this.class = c ?? CTPResourceConstants.REUSABLE;
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
}

export class CTPResources extends EntityHashMap<CTPResource> {
  public constructor(t?: string, n?: string, k?: string) {
    super();
  }

  public override fromArray(arr: CTPResource[]): void {
    arr.forEach((r) => {
      this.addEntity(r);
    });
  }
}

export interface IResourcePreference extends IPreference {
  resourceKey: string;
  speedFactor: number;
  mode: string;
}
export class CTPResourcePreference
  extends CTPPreference
  implements IResourcePreference
{
  public resourceKey: string;
  public speedFactor: number;
  public mode: string;

  constructor(k?: string, r?: number, m?: string) {
    super();
    this.resourceKey = k ? k : "";
    this.speedFactor = 1.0;
    this.rank = r ? r : 0;
    this.mode = m ?? CTPResourcePreferenceModeConstants.AVAILABLE;
  }
}
export class CTPResourcePreferences extends List<CTPResourcePreference> {
  constructor() {
    super();
  }
  public sortBySequence() {}
}
