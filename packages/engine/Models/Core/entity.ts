"strict";
import { DateTime, Interval } from "luxon";
import { CTPPersist } from "./date";
import { CTPAttribute, CTPHierarchy } from "./namevalue";
import { CTPAttributes, CTPHierarchies } from "../Lists/lists";
import { CTPAssignmentConstants, CTPDurationConstants } from "./constants";
export interface IEntity {
  id: number;
  key: string;
  type: string;
  name: string;
  createHash: boolean;
  rank: number;
  sequence: number;
  recompute: boolean;
}

export class CTPEntity implements IEntity {
  public id: number;
  public key: string;
  public type: string;
  public name: string;
  public createHash: boolean;
  public rank: number = 0;
  public sequence: number = 0;
  public recompute: boolean;
  public includeInSolve: boolean;

  constructor(t?: string, n?: string, k?: string) {
    this.id = 0;
    this.type = "";
    if (t) this.type = t;
    this.name = "";
    if (n) this.name = n;
    this.key = "";
    if (k) this.key = k;
    this.createHash = false;
    this.recompute = true;
    this.includeInSolve = true;
  }
}

export interface IKeyEntity extends IEntity {
  hierarchy: CTPHierarchies;
  attributes: CTPAttributes;
  get activateTimeStamp(): CTPPersist;
}

export class CTPEntityHashed extends CTPEntity {
  public hashKey: string;

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
    this.createHash = true;
    this.hashKey = this.createhash();
  }

  public createhash() {
    return this.key;
  }
}

export class CTPKeyEntity extends CTPEntityHashed implements IKeyEntity {
  public hierarchy: CTPHierarchies;
  public attributes: CTPAttributes;
  public timeStamp: CTPPersist | null;
  public solverSequence: number = 0;
  public cost: number;

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
    this.hierarchy = new CTPHierarchies();
    this.attributes = new CTPAttributes();
    this.timeStamp = null;
    this.cost = 0;
  }

  public get activateTimeStamp(): CTPPersist {
    if (!this.timeStamp) this.timeStamp = new CTPPersist();
    return this.timeStamp;
  }
}

/*
export class CTPKeyEntity extends CTPKeyEntity {
  public hashKey: string;

  constructor(t?: string, n?: string, k?: string) {
    super(t, n, k);
    this.createHash = true;
    this.hashKey = this.createhash();
  }

  public createhash() {
    return this.key;
  }
}*/
