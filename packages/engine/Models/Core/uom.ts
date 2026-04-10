"strict";

// ═══════════════════════════════════════════════════════════
//  UOM Conversion Table
//  Utility service on the landscape. Not a scheduled entity.
// ═══════════════════════════════════════════════════════════

export interface IGlobalUOMConversion {
  unit: string;         // "HR", "LB", "DZ", "MM"
  family: string;       // "TIME", "WEIGHT", "COUNT", "LENGTH"
  toBaseFactor: number; // multiplier: 1 of this unit → base unit
}

export interface IProductUOMConversion {
  productKey: string;   // which product this applies to
  fromUnit: string;     // "EA" (almost always)
  toUnit: string;       // "kg", "m", etc.
  toUnitFamily: string; // "WEIGHT", "LENGTH", etc.
  factor: number;       // 1 EA = factor × toUnit
}

export interface IUOMConversionsData {
  globalConversions: IGlobalUOMConversion[];
  productConversions: IProductUOMConversion[];
}

export class CTPUOMConversionTable {
  // unit (uppercase) → global conversion entry
  private globals: Map<string, IGlobalUOMConversion> = new Map();
  // "productKey|fromUnit|toUnit" → factor
  private productBridges: Map<string, IProductUOMConversion> = new Map();

  constructor() {
    this.loadDefaults();
  }

  // ─── Registration ────────────────────────────────────────

  addGlobal(conversion: IGlobalUOMConversion): void {
    this.globals.set(conversion.unit.toUpperCase(), {
      ...conversion,
      unit: conversion.unit.toUpperCase(),
      family: conversion.family.toUpperCase(),
    });
  }

  addProductConversion(conversion: IProductUOMConversion): void {
    const key = this.productKey(
      conversion.productKey,
      conversion.fromUnit.toUpperCase(),
      conversion.toUnit.toUpperCase(),
    );
    this.productBridges.set(key, {
      ...conversion,
      fromUnit: conversion.fromUnit.toUpperCase(),
      toUnit: conversion.toUnit.toUpperCase(),
      toUnitFamily: conversion.toUnitFamily.toUpperCase(),
    });
  }

  // ─── Bulk loading from JSON ────────────────────────────────

  fromGlobalArray(arr: IGlobalUOMConversion[]): void {
    for (const entry of arr) this.addGlobal(entry);
  }

  fromProductArray(arr: IProductUOMConversion[]): void {
    for (const entry of arr) this.addProductConversion(entry);
  }

  // ─── Core conversion ──────────────────────────────────────

  /**
   * Convert value from fromUnit to toUnit.
   * Path resolution:
   *   1. Same unit → return value unchanged
   *   2. Both in same global family → value × (fromFactor / toFactor)
   *   3. Product bridge exists → apply bridge, then chain global if needed
   *   4. No path → return null
   */
  convert(
    value: number,
    fromUnit: string,
    toUnit: string,
    productKey?: string,
  ): number | null {
    const from = fromUnit.toUpperCase();
    const to = toUnit.toUpperCase();

    // 1. Same unit
    if (from === to) return value;

    const fromEntry = this.globals.get(from);
    const toEntry = this.globals.get(to);

    // 2. Both in same global family
    if (fromEntry && toEntry && fromEntry.family === toEntry.family) {
      return value * (fromEntry.toBaseFactor / toEntry.toBaseFactor);
    }

    // 3. Product bridge
    if (productKey) {
      // Direct bridge: fromUnit → toUnit
      const directKey = this.productKey(productKey, from, to);
      const direct = this.productBridges.get(directKey);
      if (direct) return value * direct.factor;

      // Reverse bridge: toUnit → fromUnit (invert factor)
      const reverseKey = this.productKey(productKey, to, from);
      const reverse = this.productBridges.get(reverseKey);
      if (reverse) return value / reverse.factor;

      // Chained bridge: fromUnit → bridge base unit → toUnit
      for (const bridge of this.productBridges.values()) {
        if (bridge.productKey !== productKey) continue;
        if (bridge.fromUnit !== from) continue;
        // bridge goes from→bridgeTo; then try bridgeTo→to via global
        const bridgeToEntry = this.globals.get(bridge.toUnit);
        if (bridgeToEntry && toEntry && bridgeToEntry.family === toEntry.family) {
          const inBase = value * bridge.factor; // value in bridge.toUnit
          return inBase * (bridgeToEntry.toBaseFactor / toEntry.toBaseFactor);
        }
      }
    }

    return null;
  }

  // ─── Convenience ──────────────────────────────────────────

  /** Convert any time value to seconds. */
  toSeconds(value: number, fromUnit: string): number {
    return this.convert(value, fromUnit, 'S') ?? 0;
  }

  /** Convert a product quantity from one unit to another using product-specific bridge. */
  convertProductQty(
    qty: number,
    fromUnit: string,
    toUnit: string,
    productKey: string,
  ): number | null {
    return this.convert(qty, fromUnit, toUnit, productKey);
  }

  // ─── Defaults ─────────────────────────────────────────────

  private loadDefaults(): void {
    const defaults: IGlobalUOMConversion[] = [
      // TIME (base: s)
      { unit: 'S',     family: 'TIME',   toBaseFactor: 1 },
      { unit: 'SEC',   family: 'TIME',   toBaseFactor: 1 },
      { unit: 'MIN',   family: 'TIME',   toBaseFactor: 60 },
      { unit: 'HR',    family: 'TIME',   toBaseFactor: 3600 },
      { unit: 'DAY',   family: 'TIME',   toBaseFactor: 86400 },
      { unit: 'WK',    family: 'TIME',   toBaseFactor: 604800 },
      // WEIGHT (base: kg)
      { unit: 'KG',    family: 'WEIGHT', toBaseFactor: 1 },
      { unit: 'G',     family: 'WEIGHT', toBaseFactor: 0.001 },
      { unit: 'MG',    family: 'WEIGHT', toBaseFactor: 0.000001 },
      { unit: 'LB',    family: 'WEIGHT', toBaseFactor: 0.4536 },
      { unit: 'OZ',    family: 'WEIGHT', toBaseFactor: 0.02835 },
      { unit: 'T',     family: 'WEIGHT', toBaseFactor: 1000 },
      { unit: 'STON',  family: 'WEIGHT', toBaseFactor: 907.185 },
      // LENGTH (base: m)
      { unit: 'M',     family: 'LENGTH', toBaseFactor: 1 },
      { unit: 'MM',    family: 'LENGTH', toBaseFactor: 0.001 },
      { unit: 'CM',    family: 'LENGTH', toBaseFactor: 0.01 },
      { unit: 'KM',    family: 'LENGTH', toBaseFactor: 1000 },
      { unit: 'IN',    family: 'LENGTH', toBaseFactor: 0.0254 },
      { unit: 'FT',    family: 'LENGTH', toBaseFactor: 0.3048 },
      { unit: 'YD',    family: 'LENGTH', toBaseFactor: 0.9144 },
      // VOLUME (base: L)
      { unit: 'L',     family: 'VOLUME', toBaseFactor: 1 },
      { unit: 'ML',    family: 'VOLUME', toBaseFactor: 0.001 },
      { unit: 'GAL',   family: 'VOLUME', toBaseFactor: 3.78541 },
      { unit: 'QT',    family: 'VOLUME', toBaseFactor: 0.946353 },
      { unit: 'FLOZ',  family: 'VOLUME', toBaseFactor: 0.029574 },
      { unit: 'PT',    family: 'VOLUME', toBaseFactor: 0.473176 },
      { unit: 'M3',    family: 'VOLUME', toBaseFactor: 1000 },
      // COUNT (base: EA)
      { unit: 'EA',    family: 'COUNT',  toBaseFactor: 1 },
      { unit: 'PCS',   family: 'COUNT',  toBaseFactor: 1 },
      { unit: 'UN',    family: 'COUNT',  toBaseFactor: 1 },
      { unit: 'SET',   family: 'COUNT',  toBaseFactor: 1 },
      { unit: 'DZ',    family: 'COUNT',  toBaseFactor: 12 },
      { unit: 'PR',    family: 'COUNT',  toBaseFactor: 2 },
      { unit: 'GROSS', family: 'COUNT',  toBaseFactor: 144 },
      // AREA (base: m²)
      { unit: 'M2',    family: 'AREA',   toBaseFactor: 1 },
      { unit: 'CM2',   family: 'AREA',   toBaseFactor: 0.0001 },
      { unit: 'MM2',   family: 'AREA',   toBaseFactor: 0.000001 },
      { unit: 'FT2',   family: 'AREA',   toBaseFactor: 0.092903 },
      { unit: 'IN2',   family: 'AREA',   toBaseFactor: 0.00064516 },
    ];
    for (const entry of defaults) this.addGlobal(entry);
  }

  // ─── Helpers ──────────────────────────────────────────────

  private productKey(productKey: string, from: string, to: string): string {
    return `${productKey}|${from}|${to}`;
  }
}
