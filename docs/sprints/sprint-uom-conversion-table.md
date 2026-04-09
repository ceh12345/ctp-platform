# Sprint: UOM Conversion Table & Data Model Foundations

**Status:** 📋 Ready  
**Size:** ~3-4 hours CC work  
**Depends on:** Nothing (new entity, no existing dependencies)  
**Triggered by:** Stafford ETL mapping — need UOM conversion for duration calculations and BOM material rollups

---

## What It Does

Adds a Unit of Measure (UOM) conversion system to the CTP engine. Two tiers:

1. **Global conversions** — universal unit relationships (HR→seconds, LB→kg, DZ→EA). Ship with defaults, tenants can add custom units.
2. **Product-specific conversions** — bridge EA to measurable units per product (1 EA of Product X = 2.5 kg).

### Storage Rules

- **COUNT family** (EA, DZ, PR, GROSS): normalize to EA on ingest. Database always stores eaches. Product `unitOfMeasure` is the display unit. UI divides stored value by conversion factor for display (12 EA → "1 DZ").
- **TIME**: CTP already works in seconds. ETL converts on ingest using the table (HR→s, MIN→s). `durationSeconds` on tasks is always seconds.
- **All other families** (WEIGHT, LENGTH, VOLUME, AREA): store in source units. Convert at runtime only when needed (BOM rollups, cross-entity comparisons).

---

## Deliverables

### 1. New Entity: `uom.ts`

**Location:** `Core/uom.ts` (utility, not a scheduled entity)

#### Constants

```typescript
CTPUnitFamilyConstants
  TIME, WEIGHT, LENGTH, VOLUME, COUNT, AREA

CTPBaseUnitConstants
  TIME = "s", WEIGHT = "kg", LENGTH = "m", VOLUME = "L", COUNT = "EA", AREA = "m2"
```

#### Global Conversion Entry

```typescript
interface IGlobalUOMConversion {
  unit: string;          // "HR", "LB", "DZ", "MM"
  family: string;        // "TIME", "WEIGHT", "COUNT", "LENGTH"
  toBaseFactor: number;  // multiplier to convert 1 of this unit to the base unit
}
```

#### Product-Specific Conversion Entry

```typescript
interface IProductUOMConversion {
  productKey: string;    // which product this applies to
  fromUnit: string;      // "EA" (almost always)
  toUnit: string;        // "kg", "m", etc.
  toUnitFamily: string;  // "WEIGHT", "LENGTH", etc.
  factor: number;        // 1 EA = factor × toUnit
}
```

#### Conversion Table (Main Service)

```typescript
class CTPUOMConversionTable {
  // Registration
  addGlobal(conversion: IGlobalUOMConversion): void
  addProductConversion(conversion: IProductUOMConversion): void

  // Core conversion — chains through global + product-specific as needed
  convert(value: number, fromUnit: string, toUnit: string, productKey?: string): number | null

  // Convenience
  toSeconds(value: number, fromUnit: string): number
  convertProductQty(qty: number, fromUnit: string, toUnit: string, productKey: string): number | null

  // JSON loading
  fromGlobalArray(arr: IGlobalUOMConversion[]): void
  fromProductArray(arr: IProductUOMConversion[]): void

  // Ships with defaults (called in constructor)
  private loadDefaults(): void
}
```

#### Default Global Conversions (loaded automatically)

| Family | Units | Factor to Base |
|--------|-------|----------------|
| TIME (base: s) | S=1, SEC=1, MIN=60, HR=3600, DAY=86400, WK=604800 | |
| WEIGHT (base: kg) | KG=1, G=0.001, MG=0.000001, LB=0.4536, OZ=0.02835, T=1000, STON=907.185 | |
| LENGTH (base: m) | M=1, MM=0.001, CM=0.01, KM=1000, IN=0.0254, FT=0.3048, YD=0.9144 | |
| VOLUME (base: L) | L=1, ML=0.001, GAL=3.78541, QT=0.946353, FLOZ=0.029574, PT=0.473176, M3=1000 | |
| COUNT (base: EA) | EA=1, PCS=1, UN=1, SET=1, DZ=12, PR=2, GROSS=144 | |
| AREA (base: m²) | M2=1, CM2=0.0001, MM2=0.000001, FT2=0.092903, IN2=0.00064516 | |

---

### 2. New Data File: `uom-conversions.json`

9th data file in the CTP model. Structure:

```json
{
  "globalConversions": [
    { "unit": "BATCH", "family": "COUNT", "toBaseFactor": 50 }
  ],
  "productConversions": [
    {
      "productKey": "CEM 36074_F",
      "fromUnit": "EA",
      "toUnit": "kg",
      "toUnitFamily": "WEIGHT",
      "factor": 2.5
    }
  ]
}
```

- `globalConversions` — only overrides/additions. Defaults ship with the engine.
- `productConversions` — per-product EA-to-measurable-unit bridges.
- Empty file is valid: `{ "globalConversions": [], "productConversions": [] }`

---

### 3. Integration Points

#### 3a. Landscape — add UOM table

```typescript
// landscape.ts
import { CTPUOMConversionTable } from '../Core/uom';

export interface ILandscape {
  // ... existing ...
  uomTable: CTPUOMConversionTable | null;
}

export class SchedulingLandscape implements ILandscape {
  public uomTable: CTPUOMConversionTable;
  
  constructor(/* ... */) {
    // ... existing ...
    this.uomTable = new CTPUOMConversionTable();
  }
}
```

#### 3b. CTP Service — load UOM data during state sync

In `ctp_service.ts`, when processing `/v1/state/sync`:

```typescript
// After loading other entities
if (syncData.uomConversions) {
  if (syncData.uomConversions.globalConversions) {
    landscape.uomTable.fromGlobalArray(syncData.uomConversions.globalConversions);
  }
  if (syncData.uomConversions.productConversions) {
    landscape.uomTable.fromProductArray(syncData.uomConversions.productConversions);
  }
}
```

#### 3c. ETL Layer — duration conversion example (Stafford)

```typescript
// Genius Formula field: "HR/UN" → time unit = HR, rate basis = per unit
const timeUnit = parseFormulaTimeUnit(task.Formula);   // "HR"
const totalTime = task.CycleTime * task.WoPlannedQuantity;  // 1.25 * 2 = 2.5
const durationSeconds = landscape.uomTable.toSeconds(totalTime, timeUnit);  // 9000
```

#### 3d. ETL Layer — count normalization example

```typescript
// Inbound: order says 3 DZ of product
const rawQty = 3;
const productUOM = "DZ";
const demandQtyInEA = landscape.uomTable.convert(rawQty, productUOM, "EA");  // 36

// Outbound (UI display): database has 36 EA, product UOM is DZ
const displayQty = landscape.uomTable.convert(36, "EA", productUOM);  // 3
```

#### 3e. BOM Rollup — material conversion example

```typescript
// Order: 5 EA of CEM 36074_F, BOM input: steel in kg
// Product conversion: 1 EA of CEM 36074_F = 2.5 kg
const materialQtyKg = landscape.uomTable.convertProductQty(5, "EA", "kg", "CEM 36074_F");  // 12.5

// If material inventory tracked in LB:
const materialQtyLb = landscape.uomTable.convert(12.5, "KG", "LB");  // 27.56
```

---

### 4. Update Data Model Reference Doc

Add UOM section to `CTP-Data-Model-Reference.docx`:

- New file entry in the overview table (9th file)
- Field definitions for both global and product-specific entries
- Examples showing duration conversion (Stafford HR/UN), count normalization (DZ→EA), and BOM rollup
- Note: global conversions have defaults — tenants only send overrides
- Note: COUNT and TIME normalize on ingest; everything else stores in source units

---

### 5. Update Stafford ETL Mapping Doc

Add to the mapping specification:

- Duration conversion now uses UOM table instead of hardcoded ×3600
- Formula field parsing: extract time unit from Genius `Formula` (e.g. "HR/UN" → HR)
- Count normalization rule: if Stafford sends quantities in non-EA units
- Product-specific conversions needed from Stafford (weight per EA for BOM materials)

---

## Conversion Logic — Path Resolution

```
convert(value, fromUnit, toUnit, productKey?)
  │
  ├─ Same unit? → return value
  │
  ├─ Both in same global family? → value × (fromFactor / toFactor)
  │   e.g. 5 LB → KG = 5 × (0.4536 / 1) = 2.268 kg
  │   e.g. 2.5 HR → S = 2.5 × (3600 / 1) = 9000 s
  │
  ├─ Product bridge exists? → apply bridge, then chain global if needed
  │   e.g. 3 EA of PROD-X → KG: bridge says 1 EA = 2.5 kg → 7.5 kg
  │   e.g. 3 EA of PROD-X → LB: bridge to kg (7.5), then global kg→LB (16.53)
  │
  └─ No path? → return null
```

---

## Testing Scenarios

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | Same unit | convert(5, "KG", "KG") | 5 |
| 2 | Within-family metric | convert(2500, "G", "KG") | 2.5 |
| 3 | Within-family imperial | convert(10, "LB", "OZ") | 160 |
| 4 | Cross-system weight | convert(1, "LB", "KG") | 0.4536 |
| 5 | Time to seconds | toSeconds(1.25, "HR") | 4500 |
| 6 | Duration formula | toSeconds(2.5, "HR") | 9000 |
| 7 | Count normalization | convert(3, "DZ", "EA") | 36 |
| 8 | Count reverse (display) | convert(36, "EA", "DZ") | 3 |
| 9 | Product EA→kg | convertProductQty(2, "EA", "KG", "PROD-X") | 5.0 (if 1 EA=2.5kg) |
| 10 | Product EA→LB (chained) | convertProductQty(2, "EA", "LB", "PROD-X") | 11.02 (2.5kg×2 / 0.4536) |
| 11 | No path exists | convert(5, "KG", "HR") | null |
| 12 | Unknown unit | convert(5, "FOOBAR", "KG") | null |

---

## Files Changed

| File | Change |
|------|--------|
| `Core/uom.ts` | **NEW** — UOM conversion table entity |
| `Core/constants.ts` | Add `CTPUnitFamilyConstants`, `CTPBaseUnitConstants` |
| `Entities/product.ts` | Change `unitOfMeasure` default from `"pcs"` to `"EA"` on CTPProduct and CTPBOMInput |
| `Entities/task.ts` | Change `unitOfMeasure` default from `"pcs"` to `"EA"` on CTPTaskMaterialInput |
| `Entities/landscape.ts` | Add `uomTable: CTPUOMConversionTable` to interface and class |
| `ctp_service.ts` | Load UOM data during state sync |
| `CTP-Data-Model-Reference.docx` | Add UOM section (9th data file) |
| `Stafford-CTP-ETL-Mapping-Specification.docx` | Update duration conversion, add UOM notes |

### Existing UOM Fields (cleanup)

Three entities already carry a `unitOfMeasure` field. All default to `"pcs"` — change to `"EA"`:

- **CTPProduct** (`product.ts`) — the source of truth. The product's UOM tells you how to interpret every quantity associated with it (demandQty, durationQty, outputQty, inventory). Default: `"EA"`.
- **CTPBOMInput** (`product.ts`) — the BOM input's UOM. May differ from the parent product (parent is EA, input is KG of steel). The conversion table bridges them at runtime. Default: `"EA"`.
- **CTPTaskMaterialInput** (`task.ts`) — same as BOM input but at the task level. Default: `"EA"`.

**No UOM field needed on:** CTPOrder (inherits from product via `productKey`), CTPTask (inherits from product via `outputProductKey`), CTPResource (no quantity concept).

---

## Open Design Decisions

1. **SET handling** — Currently `SET=1` (same as EA). Should SET be product-specific (1 SET = N EA depending on product)? Could use product conversion table for this.

2. **Tenant-level unit aliases** — Some ERPs use non-standard abbreviations ("HOURS" instead of "HR", "EACH" instead of "EA"). Add an alias layer, or require tenants to normalize in their ETL mapping?

3. **Precision / rounding** — Floating point drift on chained conversions (EA→kg→LB). Store a precision field per family, or let consumers handle rounding?

---

*Sprint follows existing patterns: CTPKeyEntity base, EntityHashMap collections, List generics, constants classes. UOM table is a utility service on the landscape, not a scheduled entity.*
