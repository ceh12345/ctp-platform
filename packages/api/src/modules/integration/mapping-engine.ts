import { Injectable } from '@nestjs/common';
import { IMappingProfile } from '../../config/interfaces/config-store.interface';
import { IRawDataPayload } from './adapter.interface';

@Injectable()
export class MappingEngine {
  transform(raw: IRawDataPayload, profile: IMappingProfile | null): IRawDataPayload {
    if (!profile) return raw;
    return {
      ...raw,
      orders:    this.mapEntities(raw.orders,    profile['orders']),
      resources: this.mapEntities(raw.resources, profile['resources']),
      tasks:     this.mapTasks(raw.tasks,        profile['tasks']),
    };
  }

  // ── Generic entity mapping ────────────────────────────────────────────────

  private mapEntities(records: unknown[], spec: any): unknown[] {
    if (!spec?.mappings) return records;
    return (records as Record<string, any>[]).map(r => this.applyMappings(r, spec.mappings));
  }

  private applyMappings(record: Record<string, any>, mappings: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [targetField, rule] of Object.entries(mappings)) {
      const val = this.applyRule(record, rule);
      if (val !== undefined && val !== null) out[targetField] = val;
    }
    return out;
  }

  private applyRule(record: Record<string, any>, rule: any): any {
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

    // TODO Phase 3: toUTC — convert NZ local time to UTC (stub: return as-is)
    // if (rule.toUTC) return convertToUTC(val, tenantTimezone);

    return val;
  }

  // ── Task mapping (needs chain linkId post-processing) ────────────────────

  private mapTasks(records: unknown[], spec: any): unknown[] {
    if (!spec) return records;
    const recs = records as Record<string, any>[];

    const keySpec   = spec.key;
    const capSpec   = spec.capacityResources;
    const linkSpec  = spec.linkId;
    const mappings  = spec.mappings ?? {};

    // Step 1: resolve key for every task
    const withKeys = recs.map(r => ({
      ...r,
      _key: keySpec ? this.applyRule(r, keySpec) : String(r['Id'] ?? r['id'] ?? ''),
    }));

    // Step 2: group by chain, sort by sequence → build prevLink map
    const prevLinkMap = this.buildPrevLinkMap(withKeys, linkSpec);

    // Step 3: map each task to ITaskData shape
    const chainKeyField = linkSpec?.chainKey ?? 'WorkOrderCode';
    const lagField      = linkSpec?.lagHoursField ?? 'LagHours';
    const capField      = capSpec?.from ?? 'MachineCode';

    return withKeys.map(r => {
      const rec = r as Record<string, any>;
      const base    = this.applyMappings(rec, mappings);
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
