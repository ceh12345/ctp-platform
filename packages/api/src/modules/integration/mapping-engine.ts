import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { IMappingProfile } from '../../config/interfaces/config-store.interface';
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
      const val = this.applyRule(record, rule, { ...ctx, targetField });
      if (val !== undefined && val !== null) out[targetField] = val;
    }
    return out;
  }

  private applyRule(record: Record<string, any>, rule: any, ctx: MappingCtx): any {
    // const — static value
    if (rule.value !== undefined) return rule.value;

    // concat — join multiple source fields
    if (Array.isArray(rule.from)) {
      const parts = (rule.from as string[]).map(f => record[f] ?? '').filter(Boolean);
      return parts.join(rule.sep ?? ' ');
    }

    const val = record[rule.from];

    // lookup — value map with optional _default
    if (rule.lookup) {
      const key = String(val);
      return rule.lookup[key] ?? rule.lookup['_default'] ?? val;
    }

    // multiply — e.g. hours → seconds
    if (rule.factor !== undefined && val !== undefined && val !== null) {
      return Number(val) * rule.factor;
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
        return val;  // pass-through preserved; hydrator's defensive parse is second layer
      }

      // Valid shape, but only convert if we know the zone.
      if (!hasEmbeddedZone && !rule.fromTimezone) return val;
      return dt.toUTC().toISO();
    }

    return val;
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

      // capacityResources
      const machineCode = rec[capField];
      if (machineCode) {
        result['capacityResources'] = [{ resource: machineCode, isPrimary: true, qty: 1, mode: 'ON' }];
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
}
