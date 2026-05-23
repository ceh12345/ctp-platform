export interface IStagingPointer {
  /** Atomically point at `targetDir`. Replaces any existing pointer. */
  point(targetDir: string): Promise<void>;
  /** Absolute resolved path of the pointer's target, or null if pointer doesn't exist. */
  resolve(): Promise<string | null>;
  exists(): Promise<boolean>;
}
