import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { IMappingProfile } from '../../config/interfaces/config-store.interface';
import {
  AttributeMapping,
  EntityMapping,
  HierarchySlotMapping,
  ValueSource,
  ValueTransform,
} from '../../config/interfaces/hierarchy-mapping.interface';
import { IRawDataPayload } from './adapter.interface';
import { MappingError } from './mapping-error';

// Detects whether an ISO 8601 string carries a timezone designator — either
// trailing Z or a ±HH:MM offset at the end.
const HAS_TZ_DESIGNATOR = /(Z|[+\-]\d{2}:?\d{2})$/;

export interface MappingResult {
  payload: IRawDataPayload;
  errors: MappingError[];
}

// Per-call context threaded through private methods. MappingEngine is a Nest
// singleton; putting mutable state on `this` would race across concurrent
// requests. The ctx object is created fresh per `transform()` invocation.
interface MappingCtx {
  errors: MappingError[];
  entity: 'orders' | 'resources' | 'tasks';
  recordIndex: number;  // updated as the record loop iterates
  targetField: string;  // updated as the rule loop iterates
}

@Injectable()
export class MappingEngine {
  transform(raw: IRawDataPayload, profile: IMappingProfile | null): MappingResult {
    const errors: MappingError[] = [];
    if (!profile) return { payload: raw, errors };
    const payload: IRawDataPayload = {
      ...raw,
      orders:    this.mapEntities(raw.orders,    profile['orders'],    'orders',    errors),
      resources: this.mapEntities(raw.resources, profile['resources'], 'resources', errors),
      tasks:     this.mapTasks(raw.tasks,        profile['tasks'],     errors),
    };
    return { payload, errors };
  }

  // ── Generic entity mapping ────────────────────────────────────────────────

  private mapEntities(
    records: unknown[],
    spec: any,
    entity: 'orders' | 'resources' | 'tasks',
    errors: MappingError[],
  ): unknown[] {
    if (!spec?.mappings) return records;
    return (records as Record<string, any>[]).map((r, recordIndex) =>
      this.applyMappings(r, spec.mappings, { errors, entity, recordIndex, targetField: '' }));
  }

  private applyMappings(
    record: Record<string, any>,
    mappings: Record<string, any>,
    ctx: MappingCtx,
  ): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [targetField, rule] of Object.entries(mappings)) {
      // Nested rule object — recurse. A rule is "nested" when it's a plain
      // object that carries none of the known rule keys (value/from/lookup/
      // factor/toUTC). This lets mappings target nested CTP fields like
      // `hierarchy: { level1: { from: ... } }`.
      if (this.isNestedRule(rule)) {
        const nested = this.applyMappings(record, rule, { ...ctx, targetField });
        if (Object.keys(nested).length > 0) out[targetField] = nested;
        continue;
      }
      const val = this.applyRule(record, rule, { ...ctx, targetField });
      if (val !== undefined && val !== null) out[targetField] = val;
    }
    return out;
  }

  private isNestedRule(rule: any): boolean {
    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) return false;
    // Use own-property checks because `toString` is inherited from
    // Object.prototype and would always test truthy with `!==undefined`.
    const RULE_KEYS = [
      'value', 'from', 'lookup', 'factor', 'toUTC', 'toString',
      'threshold', 'cascade',
    ] as const;
    return !RULE_KEYS.some(k => Object.prototype.hasOwnProperty.call(rule, k));
  }

  private applyRule(record: Record<string, any>, rule: any, ctx: MappingCtx): any {
    // toString flag — coerce final value to string. Useful when source is
    // numeric (e.g., Genius's `Id` field) but target is a CTP key (string).
    const coerce = (v: any) =>
      rule.toString === true && v !== null && v !== undefined ? String(v) : v;

    // cascade — try a list of sub-rules in order. First sub-rule that returns
    // a non-null/non-undefined value wins. If all return null/undefined, use
    // the rule's `default`. Useful for tiered classifications where multiple
    // signals can produce a result (e.g., wipState from CompletionPercentage
    // OR TotalCumulativeMachineHours, with NOT_STARTED as the default).
    if (Array.isArray(rule.cascade)) {
      for (const sub of rule.cascade) {
        const sv = this.applyRule(record, sub, ctx);
        if (sv !== null && sv !== undefined) return coerce(sv);
      }
      return coerce(rule.default);
    }

    // const — static value
    if (rule.value !== undefined) return coerce(rule.value);

    // concat — join multiple source fields (already produces a string)
    if (Array.isArray(rule.from)) {
      const parts = (rule.from as string[]).map(f => record[f] ?? '').filter(Boolean);
      return parts.join(rule.sep ?? ' ');
    }

    const val = record[rule.from];

    // threshold — numeric comparison. Returns `above` if val > threshold,
    // `below` if val ≤ threshold. Either side can be omitted; an omitted
    // side returns undefined for that branch (lets cascade move on to the
    // next sub-rule). Non-numeric / null vals are treated as "below".
    if (rule.threshold !== undefined) {
      const n = Number(val);
      if (!isNaN(n) && n > rule.threshold) return coerce(rule.above);
      return coerce(rule.below);
    }

    // lookup — value map with optional _default
    if (rule.lookup) {
      const key = String(val);
      return coerce(rule.lookup[key] ?? rule.lookup['_default'] ?? val);
    }

    // multiply — e.g. hours → seconds
    if (rule.factor !== undefined && val !== undefined && val !== null) {
      return coerce(Number(val) * rule.factor);
    }

    // toUTC — normalize an ISO date to UTC Z form.
    // Two-step logic:
    //  1. Always attempt a parse to validate the shape. Garbage strings
    //     emit UNPARSEABLE_DATE regardless of whether a zone is known.
    //  2. Only convert to UTC when a zone is available (embedded offset/Z,
    //     or profile-level fromTimezone). Bare-valid dates without zone
    //     information pass through unchanged — we never silently interpret
    //     as server-local time.
    if (rule.toUTC && val !== undefined && val !== null && val !== '') {
      const s = String(val);
      const hasEmbeddedZone = HAS_TZ_DESIGNATOR.test(s);
      const dt = DateTime.fromISO(s, {
        zone: hasEmbeddedZone ? undefined : (rule.fromTimezone ?? undefined),
      });

      if (!dt.isValid) {
        ctx.errors.push({
          code:        'UNPARSEABLE_DATE',
          entity:      ctx.entity,
          targetField: ctx.targetField,
          sourceField: typeof rule.from === 'string' ? rule.from : undefined,
          rawValue:    val,
          message:     `Field '${ctx.targetField}' value ${JSON.stringify(val)} is not a valid ISO date (${dt.invalidReason ?? 'unknown'})`,
          recordIndex: ctx.recordIndex,
          severity:    'error',
        });
        return coerce(val);  // pass-through preserved; hydrator's defensive parse is second layer
      }

      // Valid shape, but only convert if we know the zone.
      if (!hasEmbeddedZone && !rule.fromTimezone) return coerce(val);
      return dt.toUTC().toISO();
    }

    return coerce(val);
  }

  // ── Task mapping (needs chain linkId post-processing) ────────────────────

  private mapTasks(records: unknown[], spec: any, errors: MappingError[]): unknown[] {
    if (!spec) return records;
    const recs = records as Record<string, any>[];

    const keySpec   = spec.key;
    const capSpec   = spec.capacityResources;
    const linkSpec  = spec.linkId;
    const mappings  = spec.mappings ?? {};

    // Step 1: resolve key for every task. Key resolution doesn't benefit from
    // the error pipe (no toUTC on keys in any known profile), but we thread
    // ctx for symmetry and future-proofing.
    const withKeys = recs.map((r, recordIndex) => ({
      ...r,
      _key: keySpec
        ? this.applyRule(r, keySpec, { errors, entity: 'tasks', recordIndex, targetField: 'key' })
        : String(r['Id'] ?? r['id'] ?? ''),
    }));

    // Step 2: group by chain, sort by sequence → build prevLink map
    const prevLinkMap = this.buildPrevLinkMap(withKeys, linkSpec);

    // Step 3: map each task to ITaskData shape
    const chainKeyField = linkSpec?.chainKey ?? 'WorkOrderCode';
    const lagField      = linkSpec?.lagHoursField ?? 'LagHours';
    const capField      = capSpec?.from ?? 'MachineCode';

    return withKeys.map((r, recordIndex) => {
      const rec = r as Record<string, any>;
      const base = this.applyMappings(rec, mappings,
        { errors, entity: 'tasks', recordIndex, targetField: '' });
      const taskKey = r._key as string;
      const chainKey = rec[chainKeyField] as string | undefined;
      const prevKey  = prevLinkMap.get(taskKey);
      const lagHours = rec[lagField];

      const result: Record<string, any> = {
        ...base,
        key: taskKey,
      };

      // capacityResources — always coerce to string. Resource keys must
      // be strings to match CTPResource.key (engine uses string keys for
      // Map lookups). Source field may be numeric (e.g., MachineId).
      const machineCode = rec[capField];
      if (machineCode !== undefined && machineCode !== null && machineCode !== '') {
        result['capacityResources'] = [{
          resource: String(machineCode), isPrimary: true, qty: 1, mode: 'ON',
        }];
      }

      // linkId
      if (chainKey) {
        result['linkId'] = {
          name:     chainKey,
          type:     prevKey ? 'LINK' : 'START',
          prevLink: prevKey ?? '',
          maxGap:   lagHours ? Number(lagHours) * 3600 : null,
        };
      }

      return result;
    });
  }

  private buildPrevLinkMap(
    recs: (Record<string, any> & { _key: string })[],
    linkSpec: any,
  ): Map<string, string> {
    if (!linkSpec) return new Map();

    const chainKeyField = linkSpec.chainKey ?? 'WorkOrderCode';
    const orderField    = linkSpec.orderKey ?? 'SequenceNumber';

    // Group tasks by chain key
    const chains = new Map<string, { key: string; seq: number }[]>();
    for (const r of recs) {
      const chainKey = r[chainKeyField] as string;
      if (!chainKey) continue;
      if (!chains.has(chainKey)) chains.set(chainKey, []);
      chains.get(chainKey)!.push({ key: r._key, seq: Number(r[orderField] ?? 0) });
    }

    // Sort each chain by sequence number
    for (const tasks of chains.values()) {
      tasks.sort((a, b) => a.seq - b.seq);
    }

    // Build taskKey → prevKey lookup
    const prevLinkMap = new Map<string, string>();
    for (const tasks of chains.values()) {
      for (let i = 1; i < tasks.length; i++) {
        prevLinkMap.set(tasks[i].key, tasks[i - 1].key);
      }
    }

    return prevLinkMap;
  }

  // ── Hierarchy + attribute resolution (SPRINT-workordergroup step 5) ──────
  //
  // Generic resolver dispatched on ValueSource.kind. Four kinds live this
  // sprint (field/constant/composite/synthetic); `join` is schema-present
  // but throws — wired in the live-customer sprint. Per design choice (a)
  // the resolver has no knowledge of tenant-level configs like
  // customerSource — step 6's mapping rules inject pool/hashOn into the
  // synthetic source at config-load time.

  /** Resolve a single ValueSource against a raw record. Returns null when the source has no value (e.g. missing field, empty pool). */
  public resolveValue(source: ValueSource, record: Record<string, any>): string | null {
    switch (source.kind) {
      case 'field': {
        const raw = record[source.field];
        if (raw === undefined || raw === null) return null;
        const str = String(raw);
        return source.transform ? this.applyValueTransform(str, source.transform) : str;
      }
      case 'constant':
        return source.value;
      case 'composite':
        return this.fillTemplate(source.template, record);
      case 'synthetic':
        if (source.pool.length === 0) return null;
        return this.hashToPool(record[source.hashOn], source.pool);
      case 'join':
        throw new Error(
          `ValueSource kind 'join' resolver not yet implemented — wired in the live-customer sprint (via=${source.via}, endpoint=${source.endpoint}, field=${source.field})`,
        );
    }
  }

  /** Resolve every hierarchy mapping on an entity, returning the populated slots. Step 7 maps these onto CTPHierarchies. */
  public resolveHierarchies(
    entity: EntityMapping,
    record: Record<string, any>,
  ): { slot: HierarchySlotMapping['slot']; name: string; value: string | null }[] {
    if (!entity.hierarchies) return [];
    return entity.hierarchies.map((h) => ({
      slot: h.slot,
      name: h.name,
      value: this.resolveValue(h.source, record),
    }));
  }

  /** Resolve every attribute mapping on an entity, returning the populated entries. Respects includeIfEmpty per mapping. */
  public resolveAttributes(
    entity: EntityMapping,
    record: Record<string, any>,
  ): { name: string; value: string }[] {
    if (!entity.attributes) return [];
    const out: { name: string; value: string }[] = [];
    for (const a of entity.attributes) {
      const v = this.resolveValue(a.source, record);
      if (v === null || v === '') {
        if (a.includeIfEmpty) out.push({ name: a.name, value: '' });
        continue;
      }
      out.push({ name: a.name, value: v });
    }
    return out;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private applyValueTransform(v: string, t: ValueTransform): string {
    switch (t) {
      case 'trim':      return v.trim();
      case 'uppercase': return v.toUpperCase();
      case 'lowercase': return v.toLowerCase();
      case 'dateToIso': {
        const dt = DateTime.fromISO(v);
        return dt.isValid ? (dt.toUTC().toISO() ?? v) : v;
      }
    }
  }

  /** Replace {field} tokens in a template with values from the record. Missing fields render as empty string. */
  private fillTemplate(template: string, record: Record<string, any>): string {
    return template.replace(/\{(\w+)\}/g, (_, key: string) => {
      const v = record[key];
      return v === undefined || v === null ? '' : String(v);
    });
  }

  /** DJB2 hash modulo pool length — stable across runs, gives even distribution for typical key strings. */
  private hashToPool(raw: unknown, pool: string[]): string {
    const s = raw === undefined || raw === null ? '' : String(raw);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;   // h * 33 + c, kept unsigned
    }
    return pool[h % pool.length];
  }
}
