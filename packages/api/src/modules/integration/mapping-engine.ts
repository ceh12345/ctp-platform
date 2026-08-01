import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { IMappingProfile, IWorkOrderGroupData } from '../../config/interfaces/config-store.interface';
import {
  AttributeMapping,
  EntityMapping,
  HierarchySlotMapping,
  ValueSource,
  ValueTransform,
} from '../../config/interfaces/hierarchy-mapping.interface';
import { IRawDataPayload } from './adapter.interface';
import { MappingError } from './mapping-error';
import {
  buildDispatchContext,
  buildTaskPreferences,
  DispatchContext,
  DispatchValidationReport,
  IDispatchConfig,
} from './dispatch-preference';

// Detects whether an ISO 8601 string carries a timezone designator — either
// trailing Z or a ±HH:MM offset at the end.
const HAS_TZ_DESIGNATOR = /(Z|[+\-]\d{2}:?\d{2})$/;

export interface MappingResult {
  payload: IRawDataPayload;
  workOrderGroups: IWorkOrderGroupData[];
  attributeSources: AttributeSourceMap;
  errors: MappingError[];
  /** Present only when the profile has a `dispatch` block. Error-severity
   *  findings are a promote gate (spec §4) — enforced by callers
   *  (dump-ctp-shape writes the sidecar and exits non-zero). */
  dispatchReport?: DispatchValidationReport;
}

/**
 * Profile-level provenance map. Keyed entityType → attrName → sourcePath
 * string. Populated once per transform() from the profile's attribute +
 * hierarchy mappings. Consumed by the Excel exporter; not used by the
 * engine itself.
 */
export type AttributeSourceMap = Map<string, Map<string, string>>;

// Per-call context threaded through private methods. MappingEngine is a Nest
// singleton; putting mutable state on `this` would race across concurrent
// requests. The ctx object is created fresh per `transform()` invocation.
interface MappingCtx {
  errors: MappingError[];
  entity: 'orders' | 'resources' | 'tasks' | 'workOrderGroups';
  recordIndex: number;  // updated as the record loop iterates
  targetField: string;  // updated as the rule loop iterates
}

@Injectable()
export class MappingEngine {
  // Named-default values referenced by `fromDefault` rules. Set at the
  // start of each transform() from profile.defaults (per-tenant config in
  // mapping.json). Lifetime is one transform() invocation; safe because
  // transform is synchronous despite MappingEngine being a Nest singleton.
  private defaults: Record<string, unknown> = {};

  transform(raw: IRawDataPayload, profile: IMappingProfile | null): MappingResult {
    const errors: MappingError[] = [];
    if (!profile) return { payload: raw, workOrderGroups: [], attributeSources: new Map(), errors };
    this.defaults = (profile.defaults as Record<string, unknown>) ?? {};
    // Dispatch preference pass (docs/Stafford/operation-group-preference-
    // mapping-spec.md) — opt-in via profile.dispatch. Context is built from
    // RAW operations + resources because group resolution needs source-shape
    // fields the entity mappings collapse away.
    const dispatchCtx: DispatchContext | null = profile.dispatch
      ? buildDispatchContext(raw.operations ?? [], raw.resources, profile.dispatch as IDispatchConfig)
      : null;
    const payload: IRawDataPayload = {
      ...raw,
      orders:    this.mapEntities(raw.orders,    profile['orders'],    'orders',    errors),
      resources: this.mapEntities(raw.resources, profile['resources'], 'resources', errors),
      tasks:     this.mapTasks(raw.tasks,        profile['tasks'],     errors, dispatchCtx),
    };
    // workOrderGroups are derived from the same raw records that feed orders
    // (one group per unique Job). Reads RAW orders, not the mapped output —
    // hierarchy/attribute resolution needs source-shaped fields like
    // ProjectName / ItemDescription1 that the order mapping has collapsed away.
    const workOrderGroups = profile.workOrderGroups
      ? this.mapWorkOrderGroups(raw.orders, profile.workOrderGroups, errors)
      : [];
    const attributeSources = this.buildAttributeSources(profile);
    return {
      payload, workOrderGroups, attributeSources, errors,
      ...(dispatchCtx ? { dispatchReport: dispatchCtx.report } : {}),
    };
  }

  /**
   * Build the profile-level sidecar map from the mapping profile's
   * attribute + hierarchy declarations. Entity-keyed; attribute-name-keyed
   * within each entity. Consumed by the Excel exporter; not used by the
   * engine itself.
   *
   * Hierarchy slot names go in alongside authored attributes because the
   * rollup engine mirrors hierarchy values into the attributes list —
   * the mirror entries should trace back to the slot's source, not be
   * flagged as engine-computed.
   */
  public buildAttributeSources(profile: IMappingProfile): AttributeSourceMap {
    const out: AttributeSourceMap = new Map();
    if (profile.workOrderGroups) {
      out.set('workOrderGroups', this.entityAttributeSources(profile.workOrderGroups));
    }
    // Dispatch traceability attributes stamped on tasks (spec §3). Registered
    // here so the inspector's Attributes sheet traces them to their source
    // instead of flagging them engine-computed.
    if (profile.dispatch) {
      const opField = (profile.dispatch['operationCodeField'] as string) ?? 'OperationCode';
      out.set('tasks', new Map([
        ['OperationCode', opField],
        ['GroupCode', `operations.GroupCode via ${opField}`],
      ]));
    }
    return out;
  }

  private entityAttributeSources(entity: EntityMapping): Map<string, string> {
    const out = new Map<string, string>();
    for (const h of entity.hierarchies ?? []) {
      out.set(h.name, this.describeSource(h.source));
    }
    for (const a of entity.attributes ?? []) {
      out.set(a.name, this.describeSource(a.source));
    }
    return out;
  }

  private describeSource(source: ValueSource): string {
    switch (source.kind) {
      case 'field':
        return source.transform ? `${source.field}.${source.transform}()` : source.field;
      case 'constant':
        return `const:${source.value}`;
      case 'composite':
        return `template:${source.template}`;
      case 'synthetic':
        return `synthetic:hash-pool(${source.hashOn})`;
      case 'join':
        return `${source.endpoint}.${source.field} via ${source.via}`;
    }
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
      'threshold', 'cascade', 'ifPresent', 'ifAbsent', 'dateRangeSeconds',
      'fromDefault',
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

    // ifPresent / ifAbsent — presence check, the string-shaped analogue of
    // threshold. val is "present" when not null, not undefined, and not the
    // empty string. Either branch can be omitted; an omitted branch returns
    // undefined, letting cascade fall through to the next sub-rule.
    if (rule.ifPresent !== undefined || rule.ifAbsent !== undefined) {
      const present = val !== null && val !== undefined && val !== '';
      return coerce(present ? rule.ifPresent : rule.ifAbsent);
    }

    // lookup — value map with optional _default. Uses `in` checks rather
    // than `??` chaining so an explicit null mapping (e.g. { "NA": null })
    // resolves to null instead of falling through to _default. Lets a
    // lookup express "this value drops to absent" cleanly.
    if (rule.lookup) {
      const key = String(val);
      if (Object.prototype.hasOwnProperty.call(rule.lookup, key)) return coerce(rule.lookup[key]);
      if (Object.prototype.hasOwnProperty.call(rule.lookup, '_default')) return coerce(rule.lookup['_default']);
      return coerce(val);
    }

    // multiply — e.g. hours → seconds. Optional `skipIfZero: true` modifier:
    // when val is 0, return undefined so a surrounding cascade can fall
    // through to a fallback. Used when "0 from this field" actually means
    // "this field doesn't apply" (e.g. JR/DY subcontract tasks have
    // TotalPlannedMachineHours = 0 because they're calendar-day work).
    if (rule.factor !== undefined && val !== undefined && val !== null) {
      const n = Number(val);
      if (n === 0 && rule.skipIfZero === true) return coerce(undefined);
      return coerce(n * rule.factor);
    }

    // dateRangeSeconds — { from: "fieldStart", to: "fieldEnd" } — returns the
    // number of seconds between two date fields on the record. Used as a
    // duration fallback for subcontract / day-rate tasks where machine-hour
    // fields are zero. Returns undefined if either field is missing or
    // unparseable; clamps to ≥ 0 to avoid negative durations.
    // Optional `skipIfZero: true` modifier: when the computed range is 0
    // (e.g. TaskStartDate == TaskEndDate in the source), return undefined
    // so a surrounding cascade can fall through to a default.
    if (rule.dateRangeSeconds) {
      const drs = rule.dateRangeSeconds;
      const startVal = record[drs.from];
      const endVal   = record[drs.to];
      if (startVal == null || endVal == null) return coerce(undefined);
      const startMs = new Date(String(startVal)).getTime();
      const endMs   = new Date(String(endVal)).getTime();
      if (isNaN(startMs) || isNaN(endMs)) return coerce(undefined);
      const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
      if (seconds === 0 && rule.skipIfZero === true) return coerce(undefined);
      return coerce(seconds);
    }

    // fromDefault — { fromDefault: "namedConstant", factor?: number }
    // Reads a named value from profile.defaults (set per-tenant in
    // mapping.json's top-level `defaults` block). Used to pull tenant-
    // configurable constants into rules without burying literals in cascade
    // tails — e.g. `subcontractDefaultLeadTimeHours` for OUT tasks whose
    // source duration is zero. Returns undefined if the name isn't defined.
    if (rule.fromDefault !== undefined) {
      const dval = this.defaults[rule.fromDefault];
      if (dval === undefined || dval === null) return coerce(undefined);
      if (rule.factor !== undefined) return coerce(Number(dval) * rule.factor);
      return coerce(dval);
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

  private mapTasks(
    records: unknown[],
    spec: any,
    errors: MappingError[],
    dispatchCtx: DispatchContext | null = null,
  ): unknown[] {
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
      //
      // With a dispatch context (profile.dispatch), the flat single-resource
      // emit is replaced by the grouped preference build (R1–R4). A null slot
      // means the task didn't resolve (op code / group miss — already
      // reported as an error on the dispatch report); fall back to the flat
      // emit so the payload stays loadable while the report blocks promote.
      const machineCode = rec[capField];
      const dispatchBuilt = dispatchCtx
        ? buildTaskPreferences(dispatchCtx, rec, taskKey)
        : null;
      if (dispatchBuilt?.slot) {
        result['capacityResources'] = [dispatchBuilt.slot];
      } else if (machineCode !== undefined && machineCode !== null && machineCode !== '') {
        result['capacityResources'] = [{
          resource: String(machineCode), isPrimary: true, qty: 1, mode: 'ON',
        }];
      }
      if (dispatchBuilt && dispatchBuilt.attributes.length > 0) {
        result['attributes'] = dispatchBuilt.attributes;
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

  // ── WorkOrderGroup mapping (SPRINT-workordergroup step 7) ────────────────
  //
  // Derives one CTPWorkOrderGroup per unique key from the raw orders payload
  // (the WO endpoint records). Dedup is first-write-wins — subsequent records
  // with the same key are skipped, so scalar fields come from whichever WO
  // record appears first in the payload. Hierarchies/attributes resolve from
  // that same first record.
  //
  // Reads RAW orders rather than the mapped output because hierarchy /
  // attribute resolution often references source-shape fields (ProjectName,
  // ItemDescription1) that the per-order mapping has collapsed away.

  private mapWorkOrderGroups(
    rawOrders: unknown[],
    spec: EntityMapping,
    errors: MappingError[],
  ): IWorkOrderGroupData[] {
    this.validateEntityMapping(spec, 'workOrderGroups');

    const keyRule = spec.mappings?.key;
    if (!keyRule) return [];

    const seen = new Set<string>();
    const out: IWorkOrderGroupData[] = [];

    (rawOrders as Record<string, any>[]).forEach((record, recordIndex) => {
      const ctx: MappingCtx = {
        errors,
        entity: 'workOrderGroups',
        recordIndex,
        targetField: 'key',
      };
      const keyValRaw = this.applyRule(record, keyRule, ctx);
      if (keyValRaw === undefined || keyValRaw === null || keyValRaw === '') return;
      const key = String(keyValRaw);
      if (seen.has(key)) return;
      seen.add(key);

      const scalars = spec.mappings
        ? this.applyMappings(record, spec.mappings, { ...ctx, targetField: '' })
        : {};
      // Make resolved scalars visible to hierarchy/attribute resolution so a
      // scalar rule using cascade/lookup/ifPresent can synthesize a value and
      // the slot/attribute reads it via { kind: "field", field: "_synthetic" }.
      // Scalars override raw fields on name collision — they're the
      // mapping's intentional output. Use a leading "_" for synthesized
      // fields by convention so they don't shadow real source fields.
      const recordForSlots = { ...record, ...scalars };
      const hierarchies = this.resolveHierarchies(spec, recordForSlots);
      const attributes  = this.resolveAttributes(spec, recordForSlots);

      out.push({
        ...scalars,
        key,
        hierarchies,
        attributes,
      } as IWorkOrderGroupData);
    });

    return out;
  }

  /**
   * Reject configs where an AttributeMapping name collides with a
   * HierarchySlotMapping name on the same entity. The rollup engine
   * mirrors hierarchy values into attributes automatically; a slot-
   * named authored attribute would be silently overwritten on each
   * rebuild, surfacing as "my attribute keeps disappearing." Fail at
   * config-load (start of transform) so the failure is obvious.
   */
  private validateEntityMapping(entity: EntityMapping, entityName: string): void {
    if (!entity.hierarchies || !entity.attributes) return;
    const slotNames = new Set(entity.hierarchies.map((h) => h.name));
    for (const a of entity.attributes) {
      if (slotNames.has(a.name)) {
        throw new Error(
          `Mapping config error on entity '${entityName}': attribute '${a.name}' ` +
          `collides with hierarchy slot name '${a.name}'. Hierarchy slot names are ` +
          `reserved — the rollup engine mirrors hierarchy values into attributes ` +
          `automatically. Rename the attribute or the slot.`
        );
      }
    }
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
