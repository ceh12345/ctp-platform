"strict";
export interface IList<T> {
  add(value: T): void;
  remove(value: T): void;
  contains(key: T): boolean;
  clear(): void;
}

export class List<T> extends Array<T> implements IList<T> {
  public constructor() {
    super();
  }
  public add(value: T) {
    this.push(value);
  }

  public insertAfter(value: T, index: number)
  {
    this.splice(index, 0, value);
  }
  public remove(value: T) {
    let i = this.indexOf(value);
    if (i !== -1) this.splice(i, 1);
  }
  public contains(key: T): boolean {
    return this.includes(key);
  }
  public clear(): void {
    this.splice(0, this.length);
  }
  public index(i: number): T | undefined {
    return this.at(i);
  }
}

export interface IList1<T> {
  add(value: T): void;
  remove(value: T): void;
  contains(key: T): boolean;
  clear(): void;
  length(): number;
  forEach(
    callbackfn: (value: T, key: number, map: Array<T>) => void,
    thisArg?: any,
  ): void;
}

export class List1<T> implements IList1<T> {
  protected map: Array<T> | null;

  public constructor() {
    this.map = new Array<T>();
  }
  public add(value: T) {
    this.map?.push(value);
  }

  public remove(value: T) {
    let i = this.map?.indexOf(value);
    if (i !== undefined && i !== -1) this.map?.splice(i, 1);
  }
  public contains(key: T): boolean {
    if (!this.map) return false;
    return this.map.includes(key);
  }
  public clear(): void {
    if (this.map) this.map = [];
  }
  public index(i: number): T | undefined {
    if (this.map) return this.map.at(i);
    else return undefined;
  }

  public length(): number {
    if (!this.map) return 0;
    return this.map!.length;
  }

  public forEach(
    callbackfn: (value: T, key: number, map: Array<T>) => void,
    thisArg?: any,
  ) {
    this.map?.forEach(callbackfn);
  }
  public toArray(): Array<T> {
    if (!this.map) return [];
    return this.map;
  }
}
