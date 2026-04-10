import { describe, it, expect, beforeEach } from 'vitest';
import { CTPUOMConversionTable } from '../../Models/Core/uom';

describe('CTPUOMConversionTable', () => {
  let table: CTPUOMConversionTable;

  beforeEach(() => {
    table = new CTPUOMConversionTable();
    // Register a product-specific conversion for test scenarios 9 & 10
    table.addProductConversion({
      productKey: 'PROD-X',
      fromUnit: 'EA',
      toUnit: 'KG',
      toUnitFamily: 'WEIGHT',
      factor: 2.5,
    });
  });

  it('1 — same unit returns value unchanged', () => {
    expect(table.convert(5, 'KG', 'KG')).toBe(5);
  });

  it('2 — within-family metric (G → KG)', () => {
    expect(table.convert(2500, 'G', 'KG')).toBeCloseTo(2.5);
  });

  it('3 — within-family imperial (LB → OZ)', () => {
    // 10 LB → OZ: 10 × (0.4536 / 0.02835) ≈ 160
    expect(table.convert(10, 'LB', 'OZ')).toBeCloseTo(160, 0);
  });

  it('4 — cross-system weight (LB → KG)', () => {
    expect(table.convert(1, 'LB', 'KG')).toBeCloseTo(0.4536);
  });

  it('5 — toSeconds (1.25 HR)', () => {
    expect(table.toSeconds(1.25, 'HR')).toBeCloseTo(4500);
  });

  it('6 — duration formula (2.5 HR → s)', () => {
    expect(table.toSeconds(2.5, 'HR')).toBeCloseTo(9000);
  });

  it('7 — count normalization (DZ → EA)', () => {
    expect(table.convert(3, 'DZ', 'EA')).toBe(36);
  });

  it('8 — count reverse display (EA → DZ)', () => {
    expect(table.convert(36, 'EA', 'DZ')).toBe(3);
  });

  it('9 — product EA → KG (direct bridge)', () => {
    // 1 EA of PROD-X = 2.5 kg  →  2 EA = 5.0 kg
    expect(table.convertProductQty(2, 'EA', 'KG', 'PROD-X')).toBeCloseTo(5.0);
  });

  it('10 — product EA → LB (chained: EA→KG via bridge, KG→LB via global)', () => {
    // 2 EA → 5 kg → 5 / 0.4536 ≈ 11.02 LB
    const result = table.convertProductQty(2, 'EA', 'LB', 'PROD-X');
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(11.02, 1);
  });

  it('11 — no path (KG → HR)', () => {
    expect(table.convert(5, 'KG', 'HR')).toBeNull();
  });

  it('12 — unknown unit', () => {
    expect(table.convert(5, 'FOOBAR', 'KG')).toBeNull();
  });
});
