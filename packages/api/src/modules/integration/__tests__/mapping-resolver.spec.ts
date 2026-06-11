import { describe, it, expect, beforeEach } from 'vitest';
import { MappingEngine } from '../mapping-engine';
import {
  EntityMapping,
  ValueSource,
} from '../../../config/interfaces/hierarchy-mapping.interface';

describe('MappingEngine.resolveValue', () => {
  let engine: MappingEngine;
  beforeEach(() => { engine = new MappingEngine(); });

  // ── field ──────────────────────────────────────────────────────────────

  describe('field', () => {
    it('reads a field value as string', () => {
      const src: ValueSource = { kind: 'field', field: 'Name' };
      expect(engine.resolveValue(src, { Name: 'Acme' })).toBe('Acme');
    });

    it('coerces numeric fields to string', () => {
      const src: ValueSource = { kind: 'field', field: 'Id' };
      expect(engine.resolveValue(src, { Id: 12345 })).toBe('12345');
    });

    it('returns null when the field is missing', () => {
      const src: ValueSource = { kind: 'field', field: 'Missing' };
      expect(engine.resolveValue(src, { Name: 'Acme' })).toBeNull();
    });

    it('returns null when the field is explicitly null', () => {
      const src: ValueSource = { kind: 'field', field: 'Name' };
      expect(engine.resolveValue(src, { Name: null })).toBeNull();
    });

    it('applies trim transform', () => {
      const src: ValueSource = { kind: 'field', field: 'Name', transform: 'trim' };
      expect(engine.resolveValue(src, { Name: '  Acme  ' })).toBe('Acme');
    });

    it('applies uppercase transform', () => {
      const src: ValueSource = { kind: 'field', field: 'Name', transform: 'uppercase' };
      expect(engine.resolveValue(src, { Name: 'acme' })).toBe('ACME');
    });

    it('applies lowercase transform', () => {
      const src: ValueSource = { kind: 'field', field: 'Name', transform: 'lowercase' };
      expect(engine.resolveValue(src, { Name: 'ACME' })).toBe('acme');
    });

    it('applies dateToIso transform — normalises a zoned ISO string to UTC Z', () => {
      const src: ValueSource = { kind: 'field', field: 'D', transform: 'dateToIso' };
      const result = engine.resolveValue(src, { D: '2026-11-27T00:00:00+13:00' });
      expect(result).toBe('2026-11-26T11:00:00.000Z');
    });

    it('dateToIso passes through unparseable values unchanged', () => {
      const src: ValueSource = { kind: 'field', field: 'D', transform: 'dateToIso' };
      expect(engine.resolveValue(src, { D: 'garbage' })).toBe('garbage');
    });
  });

  // ── constant ───────────────────────────────────────────────────────────

  describe('constant', () => {
    it('returns the constant value', () => {
      const src: ValueSource = { kind: 'constant', value: 'Stafford' };
      expect(engine.resolveValue(src, {})).toBe('Stafford');
    });
  });

  // ── composite ──────────────────────────────────────────────────────────

  describe('composite', () => {
    it('fills a template with record fields', () => {
      const src: ValueSource = { kind: 'composite', template: '{Num} - {Name}' };
      expect(engine.resolveValue(src, { Num: '15897', Name: 'WEAR SLEEVE' }))
        .toBe('15897 - WEAR SLEEVE');
    });

    it('renders missing tokens as empty string', () => {
      const src: ValueSource = { kind: 'composite', template: '{Num} - {Missing}' };
      expect(engine.resolveValue(src, { Num: '15897' })).toBe('15897 - ');
    });

    it('handles templates with no tokens', () => {
      const src: ValueSource = { kind: 'composite', template: 'static text' };
      expect(engine.resolveValue(src, {})).toBe('static text');
    });
  });

  // ── synthetic ──────────────────────────────────────────────────────────

  describe('synthetic (hash-pool)', () => {
    const pool = ['Customer A', 'Customer B', 'Customer C', 'Customer D', 'Customer E'];

    it('returns a value from the pool', () => {
      const src: ValueSource = { kind: 'synthetic', strategy: 'hash-pool', pool, hashOn: 'SoCode' };
      const result = engine.resolveValue(src, { SoCode: '12345' });
      expect(pool).toContain(result);
    });

    it('is deterministic — same input yields same output', () => {
      const src: ValueSource = { kind: 'synthetic', strategy: 'hash-pool', pool, hashOn: 'SoCode' };
      const r1 = engine.resolveValue(src, { SoCode: '12345' });
      const r2 = engine.resolveValue(src, { SoCode: '12345' });
      expect(r1).toBe(r2);
    });

    it('distributes different keys across pool entries', () => {
      const src: ValueSource = { kind: 'synthetic', strategy: 'hash-pool', pool, hashOn: 'SoCode' };
      const seen = new Set<string | null>();
      for (let i = 0; i < 100; i++) {
        seen.add(engine.resolveValue(src, { SoCode: `KEY${i}` }));
      }
      // With 5 pool entries and 100 keys, expect every pool entry to be hit
      expect(seen.size).toBe(pool.length);
    });

    it('returns null when the pool is empty', () => {
      const src: ValueSource = { kind: 'synthetic', strategy: 'hash-pool', pool: [], hashOn: 'SoCode' };
      expect(engine.resolveValue(src, { SoCode: '12345' })).toBeNull();
    });

    it('still returns a stable bucket when hashOn field is missing', () => {
      const src: ValueSource = { kind: 'synthetic', strategy: 'hash-pool', pool, hashOn: 'Missing' };
      const r1 = engine.resolveValue(src, { Other: 'x' });
      const r2 = engine.resolveValue(src, { Other: 'y' });
      // Both records hash the same (empty string) key → same bucket
      expect(r1).toBe(r2);
      expect(pool).toContain(r1);
    });
  });

  // ── join ───────────────────────────────────────────────────────────────

  describe('join (deferred)', () => {
    it('throws a clear not-implemented error', () => {
      const src: ValueSource = {
        kind: 'join',
        via: 'SalesOrderHeaderCode',
        endpoint: 'salesOrderHeaderEntity',
        field: 'BillToCustomerName',
      };
      expect(() => engine.resolveValue(src, { SalesOrderHeaderCode: '12345' }))
        .toThrowError(/join.*not yet implemented/i);
    });
  });
});

// ─── resolveHierarchies / resolveAttributes ──────────────────────────────

describe('MappingEngine.resolveHierarchies', () => {
  const engine = new MappingEngine();

  it('returns populated slots in declaration order', () => {
    const entity: EntityMapping = {
      entityType: 'workOrderGroup',
      hierarchies: [
        { slot: 1, name: 'Customer', source: { kind: 'constant', value: 'CEM' } },
        { slot: 2, name: 'Project',  source: { kind: 'field', field: 'ProjectName' } },
        { slot: 3, name: 'SalesOrder', source: { kind: 'field', field: 'SalesOrderNo' } },
      ],
    };
    const record = { ProjectName: 'MI 252208', SalesOrderNo: '12118' };
    expect(engine.resolveHierarchies(entity, record)).toEqual([
      { slot: 1, name: 'Customer',   value: 'CEM' },
      { slot: 2, name: 'Project',    value: 'MI 252208' },
      { slot: 3, name: 'SalesOrder', value: '12118' },
    ]);
  });

  it('emits null values when a source resolves to null (caller decides what to do)', () => {
    const entity: EntityMapping = {
      hierarchies: [{ slot: 1, name: 'Customer', source: { kind: 'field', field: 'Missing' } }],
    };
    expect(engine.resolveHierarchies(entity, {})).toEqual([
      { slot: 1, name: 'Customer', value: null },
    ]);
  });

  it('returns empty array when no hierarchies are defined', () => {
    expect(engine.resolveHierarchies({}, {})).toEqual([]);
  });
});

describe('MappingEngine.buildAttributeSources (sidecar)', () => {
  const engine = new MappingEngine();

  it('derives sourcePath strings from each ValueSource kind', () => {
    const profile = {
      version: '1.0', tenantId: 't', source: 's',
      workOrderGroups: {
        sourceEndpoint: 'wo',
        mappings: { key: { from: 'Job' } },
        hierarchies: [
          { slot: 1 as const, name: 'Customer', source: { kind: 'synthetic' as const, strategy: 'hash-pool' as const, pool: ['A','B'], hashOn: 'SalesOrderNo' } },
          { slot: 2 as const, name: 'Project',  source: { kind: 'field' as const, field: 'ProjectName' } },
        ],
        attributes: [
          { name: 'Strategy',           source: { kind: 'field' as const, field: 'Strategy' } },
          { name: 'ProjectManagerName', source: { kind: 'field' as const, field: 'ProjectManagerName', transform: 'trim' as const } },
          { name: 'Unit',               source: { kind: 'constant' as const, value: 'EA' } },
          { name: 'Composite',          source: { kind: 'composite' as const, template: '{A} - {B}' } },
        ],
      },
    };
    const map = engine.buildAttributeSources(profile as any);

    const wog = map.get('workOrderGroups')!;
    expect(wog).toBeDefined();
    expect(wog.get('Customer')).toBe('synthetic:hash-pool(SalesOrderNo)');
    expect(wog.get('Project')).toBe('ProjectName');
    expect(wog.get('Strategy')).toBe('Strategy');
    expect(wog.get('ProjectManagerName')).toBe('ProjectManagerName.trim()');
    expect(wog.get('Unit')).toBe('const:EA');
    expect(wog.get('Composite')).toBe('template:{A} - {B}');
  });

  it('derives sourcePath for the join kind', () => {
    const profile = {
      version: '1.0', tenantId: 't', source: 's',
      workOrderGroups: {
        sourceEndpoint: 'wo',
        mappings: { key: { from: 'Job' } },
        hierarchies: [
          { slot: 1 as const, name: 'Customer', source: {
            kind: 'join' as const, via: 'SalesOrderHeaderCode',
            endpoint: 'salesOrderHeaderEntity', field: 'BillToCustomerName',
          } },
        ],
      },
    };
    const map = engine.buildAttributeSources(profile as any);
    expect(map.get('workOrderGroups')!.get('Customer'))
      .toBe('salesOrderHeaderEntity.BillToCustomerName via SalesOrderHeaderCode');
  });

  it('returns an empty map when the profile has no entity mappings with attributes/hierarchies', () => {
    const profile = { version: '1.0', tenantId: 't', source: 's' };
    const map = engine.buildAttributeSources(profile as any);
    expect(map.size).toBe(0);
  });

  it('transform() returns attributeSources alongside payload + workOrderGroups + errors', () => {
    const profile = {
      version: '1.0', tenantId: 't', source: 's',
      workOrderGroups: {
        sourceEndpoint: 'wo',
        mappings: { key: { from: 'Job' } },
        attributes: [
          { name: 'Strategy', source: { kind: 'field' as const, field: 'Strategy' } },
        ],
      },
    };
    const rawPayload = {
      orders: [{ Job: '1', Strategy: 'JIT' }],
      resources: [], tasks: [], calendars: [], stateChanges: [],
      products: [], materials: [], processes: [], cadences: [], uomConversions: null,
    };
    const result = engine.transform(rawPayload as any, profile as any);
    expect(result.attributeSources.get('workOrderGroups')!.get('Strategy')).toBe('Strategy');
  });
});

describe('MappingEngine — slot/attribute name collision validation', () => {
  // The rollup engine mirrors hierarchy values into attributes
  // automatically. A mapping that authors an attribute with the same
  // name as a hierarchy slot would have that attribute silently
  // overwritten on each rebuild — so MappingEngine.transform() rejects
  // the config at the start of the workOrderGroups path.

  it('throws when an AttributeMapping name collides with a HierarchySlotMapping name', () => {
    const engine = new MappingEngine();
    const profile = {
      version: '1.0',
      tenantId: 'test',
      source: 'test',
      workOrderGroups: {
        sourceEndpoint: 'wo',
        mappings: { key: { from: 'Job' } },
        hierarchies: [
          { slot: 1 as const, name: 'Customer', source: { kind: 'field' as const, field: 'CustomerName' } },
        ],
        attributes: [
          // Authored attribute collides with the slot name above
          { name: 'Customer', source: { kind: 'field' as const, field: 'CustomerCode' } },
        ],
      },
    };
    const rawPayload = {
      orders: [{ Job: '1', CustomerName: 'X', CustomerCode: 'XCODE' }],
      resources: [], tasks: [], calendars: [], stateChanges: [],
      products: [], materials: [], processes: [], cadences: [], uomConversions: null,
    };
    expect(() => engine.transform(rawPayload as any, profile as any))
      .toThrowError(/collides with hierarchy slot name/);
  });

  it('accepts a profile where attribute names do not collide', () => {
    const engine = new MappingEngine();
    const profile = {
      version: '1.0',
      tenantId: 'test',
      source: 'test',
      workOrderGroups: {
        sourceEndpoint: 'wo',
        mappings: { key: { from: 'Job' } },
        hierarchies: [
          { slot: 1 as const, name: 'Customer', source: { kind: 'field' as const, field: 'CustomerName' } },
        ],
        attributes: [
          { name: 'Strategy', source: { kind: 'field' as const, field: 'Strategy' } },
        ],
      },
    };
    const rawPayload = {
      orders: [{ Job: '1', CustomerName: 'X', Strategy: 'JIT' }],
      resources: [], tasks: [], calendars: [], stateChanges: [],
      products: [], materials: [], processes: [], cadences: [], uomConversions: null,
    };
    expect(() => engine.transform(rawPayload as any, profile as any)).not.toThrow();
  });
});

describe('MappingEngine.resolveAttributes', () => {
  const engine = new MappingEngine();

  it('returns populated attribute entries', () => {
    const entity: EntityMapping = {
      attributes: [
        { name: 'Strategy', source: { kind: 'field', field: 'Strategy' } },
        { name: 'JobType',  source: { kind: 'field', field: 'JobType' } },
      ],
    };
    expect(engine.resolveAttributes(entity, { Strategy: 'JIT', JobType: 'C' })).toEqual([
      { name: 'Strategy', value: 'JIT' },
      { name: 'JobType',  value: 'C' },
    ]);
  });

  it('omits empty attributes by default', () => {
    const entity: EntityMapping = {
      attributes: [
        { name: 'Strategy',     source: { kind: 'field', field: 'Strategy' } },
        { name: 'OptionalNote', source: { kind: 'field', field: 'Missing' } },
      ],
    };
    expect(engine.resolveAttributes(entity, { Strategy: 'JIT' })).toEqual([
      { name: 'Strategy', value: 'JIT' },
    ]);
  });

  it('includes empty attributes when includeIfEmpty: true', () => {
    const entity: EntityMapping = {
      attributes: [
        { name: 'OptionalNote', source: { kind: 'field', field: 'Missing' }, includeIfEmpty: true },
      ],
    };
    expect(engine.resolveAttributes(entity, {})).toEqual([
      { name: 'OptionalNote', value: '' },
    ]);
  });

  it('returns empty array when no attributes are defined', () => {
    expect(engine.resolveAttributes({}, {})).toEqual([]);
  });
});
