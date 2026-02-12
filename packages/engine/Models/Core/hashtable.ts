const hash = (key: string, size: number): number => {
  let hashedKey = 0;
  for (let i = 0; i < key.length; i++) {
    hashedKey += key.charCodeAt(i);
  }

  return hashedKey % size;
};

export interface IHashTable<T> {
  add(key: string, value: T): void;
  remove(key: string): T | undefined;
  contains(key: string): boolean;
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

export class HashTable<T> implements IHashTable<T> {
  size: number;
  buckets: Map<string, T>[];

  constructor() {
    this.size = 127;
    this.buckets = Array(this.size);

    for (let i = 0; i < this.buckets.length; i++) {
      this.buckets[i] = new Map();
    }
  }

  public add(key: string, value: T) {
    const idx = hash(key, this.size);
    this.buckets[idx].set(key, value);
  }

  public remove(key: string): T | undefined {
    const idx = hash(key, this.size);
    const deleted = this.buckets[idx].get(key);
    this.buckets[idx].delete(key);
    return deleted;
  }

  public contains(key: string): boolean {
    const idx = hash(key, this.size);
    return this.buckets[idx].has(key);
  }

  public get(key: string): T | undefined {
    const idx = hash(key, this.size);
    return this.buckets[idx].get(key);
  }

  public set(key: string, value: T): void {
    const idx = hash(key, this.size);
    this.buckets[idx].set(key, value);
  }
}
