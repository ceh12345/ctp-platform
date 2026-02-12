"strict";
import { CTPEntityHashed, CTPKeyEntity } from "../Core/entity";
export interface IHashMap<kT, T> {
  add(key: kT, value: T): void;
  remove(key: kT, value: T): void;
  contains(key: kT): boolean;
  clear(): void;
  set(key: kT, value: T): void;
  get(key: kT): T | undefined;
  values(): IterableIterator<T>;
  keys(): IterableIterator<kT>;
  size(): number;
  forEach(
    callbackfn: (value: T, key: kT, map: Map<kT, T>) => void,
    thisArg?: any,
  ): void;
  filterMap(predicate: (key: kT, value: T) => boolean): Map<kT, T>;
}

export class HashMap<kT, T> implements IHashMap<kT, T> {
  private map: Map<kT, T> | null;

  public constructor() {
    this.map = new Map<kT, T>();
  }
  public add(key: kT, value: T) {
    this.map?.set(key, value);
  }
  public set(key: kT, value: T) {
    this.map?.set(key, value);
  }
  public get(key: kT) {
    return this.map?.get(key);
  }
  public remove(key: kT, value: T) {
    this.map?.delete(key);
  }
  public contains(key: kT): boolean {
    if (!this.map) return false;
    return this.map.has(key);
  }
  public clear(): void {
    this.map?.clear();
  }

  public values(): IterableIterator<T> {
    return this.map!.values();
  }
  public keys(): IterableIterator<kT> {
    return this.map!.keys();
  }

  public size(): number {
    if (!this.map) return 0;
    return this.map!.size;
  }
  public forEach(
    callbackfn: (value: T, key: kT, map: Map<kT, T>) => void,
    thisArg?: any,
  ) {
    this.map?.forEach(callbackfn);
  }
  //const filteredMap = filterMap( (key, value) => value > 1);
  public filterMap(predicate: (key: kT, value: T) => boolean): Map<kT, T> {
    const filteredMap = new Map<kT, T>();
    if (!this.map) return filteredMap;

    for (const [key, value] of this.map) {
      if (predicate(key, value)) {
        filteredMap.set(key, value);
      }
    }
    return filteredMap;
  }
  public toArray(): T[] {
    let arr: T[] = [];
    for (const value of this.values()) arr.push(value);
    return arr;
  }
}
export class EntityHashMap<T extends CTPEntityHashed> extends HashMap<
  string,
  T
> {
  public constructor() {
    super();
  }
  public addEntity(value: T) {
    super.set(value.hashKey, value);
  }
  public setEntity(value: T) {
    super.set(value.hashKey, value);
  }
  public getEntity(value: string) {
    return super.get(value);
  }
  public removeEntity(value: T) {
    super.remove(value.hashKey, value);
  }
  public fromArray(arr: T[]) {
    this.clear();
    arr.forEach((res) => {
      this.add(res.hashKey, res);
    });
  }
}
