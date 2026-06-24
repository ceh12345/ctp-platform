import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  SchedulingLandscape,
  CTPHorizon,
  CTPResource,
  CTPResources,
  CTPTask,
  CTPTasks,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPInterval,
  CTPDuration,
  CTPDateTime,
  CTPAppSettings,
  CTPStateChange,
  CTPStateChanges,
  CTPAvailable,
  CTPAssignments,
  CTPLinkId,
  CTPResourcePreference,
  CTPTaskMaterialInput,
  CTPTaskMaterialInputList,
  CTPOrder,
  CTPWorkOrderGroup,
  NameValue,
  IValidationError,
  makeValidationError,
  CTPTaskStateConstants,
} from '@ctp/engine';
import { ConfigService } from '../../config/config.service';
import {
  IHorizonConfig,
  ISettingsConfig,
  IResourceData,
  ITaskData,
  ICalendarData,
  IStateChangeData,
  IOrderData,
  IWorkOrderGroupData,
  IProcessingSequence,
} from '../../config/interfaces/config-store.interface';
import { IRawDataPayload } from '../integration/adapter.interface';
import { WorkOrderGroupService } from './workordergroup.service';

// Small target interface so the helper works with any entity that carries
// validationErrors (CTPTask, CTPOrder, CTPResource all qualify).
interface ValidationTarget {
  addValidationError(err: IValidationError): void;
}

@Injectable()
export class StateHydratorService {
  private readonly logger = new Logger(StateHydratorService.name);
  private readonly workOrderGroupService: WorkOrderGroupService;

  constructor(
    private readonly configService: ConfigService,
    workOrderGroupService?: WorkOrderGroupService,
  ) {
    // Optional injection — Nest supplies it in production; tests that
    // don't touch group rollups can omit. Falls back to a service
    // built from the same configService.
    this.workOrderGroupService = workOrderGroupService ?? new WorkOrderGroupService(configService);
  }

  private isRestTenant(): boolean {
    const cfg = this.configService.getAdapterConfig?.();
    return cfg?.adapterType === 'rest';
  }

  // Entity-data source resolver. The rule: if a REST payload is present and
  // non-empty, use it. If a REST payload is empty AND the tenant is REST-
  // based, an empty result is the REAL answer — do NOT silently fall back
  // to file data (that masks adapter bugs like envelope-unwrap failures and
  // makes a broken REST adapter look identical to a working one). For file-
  // based tenants (no adapter config or adapterType !== 'rest'), empty/
  // missing payload means "no override, read the file" — existing behavior.
  //
  // This was finding #5 from the PokeAPI test session. Before Stafford.
  private resolveEntityData<T>(
    payloadSlot: unknown[] | undefined,
    entityName: string,
    fileFallback: () => T[],
  ): T[] {
    if (payloadSlot && payloadSlot.length > 0) return payloadSlot as T[];
    if (this.isRestTenant()) {
      const tenantId = this.configService.getTenantId();
      this.logger.warn(
        `REST adapter returned empty '${entityName}' for tenant '${tenantId}'. ` +
        `NOT falling back to file data — empty is the real answer. ` +
        `If the adapter should have returned data, check envelope config and endpoint path.`,
      );
      return [];
    }
    return fileFallback();
  }

  // Defensive ISO-date parse for entity fields. Second-layer defense after
  // MappingEngine.toUTC — catches bad dates on flat-file tenants (no
  // MappingEngine) and fields the profile didn't mark `toUTC`.
  //
  // Returns null for missing (undefined/null/empty) values WITHOUT attaching
  // an error; callers fall back to sensible defaults. For truly unparseable
  // values, attaches an UNPARSEABLE_DATE validation error on `target` and
  // returns null so arithmetic sites never see NaN.
  private parseIsoDateOrRecord(
    raw: unknown,
    target: ValidationTarget | null,
    field: string,
  ): DateTime | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const dt = DateTime.fromISO(String(raw));
    if (dt.isValid) return dt;
    target?.addValidationError(makeValidationError({
      agent:    'Hydrator',
      type:     'UNPARSEABLE_DATE',
      reason:   `Field '${field}' is not a valid ISO date: ${JSON.stringify(raw)} (${dt.invalidReason ?? 'unknown'})`,
      severity: 'error',
      source:   'validation',
      field,
      rawValue: raw,
    }));
    return null;
  }

  buildLandscape(
    data?: IRawDataPayload,
    workOrderGroupsData?: IWorkOrderGroupData[],
  ): SchedulingLandscape {
    const horizonConfig = this.configService.getHorizon();
    const settingsConfig = this.configService.getSettings();
    const resourceData = this.resolveEntityData<IResourceData>(
      data?.resources, 'resources', () => this.configService.getResources(),
    );
    const taskData = this.resolveEntityData<ITaskData>(
      data?.tasks, 'tasks', () => this.configService.getTasks(),
    );
    const calendarData = this.configService.getCalendars();
    const stateChangeData = this.configService.getStateChanges();

    const horizon = this.hydrateHorizon(horizonConfig);
    const settings = this.hydrateSettings(settingsConfig);
    const resources = this.hydrateResources(resourceData);
    const tasks = this.hydrateTasks(taskData, horizon);

    const locale = this.configService.getLocale();
    const tenantTimezone: string = locale?.timezone ?? 'UTC';
    this.hydrateCalendars(calendarData, resources, horizon, tenantTimezone);

    const stateChanges = this.hydrateStateChanges(stateChangeData);

    const landscape = new SchedulingLandscape(
      horizon.startDate,
      horizon.endDate,
      settings,
    );
    landscape.resources = resources;
    landscape.tasks = tasks;
    landscape.stateChanges = stateChanges;
    landscape.buildProcesses();

    // Load orders into landscape for due date hydration. For REST tenants
    // with empty payload.orders, resolveEntityData returns [] (no file
    // fallback) so an adapter bug doesn't silently serve file data.
    const orderData = this.resolveEntityData<IOrderData>(
      data?.orders, 'orders', () => this.configService.getOrders(),
    );
    this.hydrateOrders(landscape, orderData);

    // Resolve cadence profiles per task
    this.hydrateCadences(landscape);

    // Load tenant UOM overrides / product-specific conversions (optional file)
    const uomData = this.configService.getUomConversions();
    if (uomData) {
      if (uomData.globalConversions?.length > 0) {
        landscape.uomTable.fromGlobalArray(uomData.globalConversions);
      }
      if (uomData.productConversions?.length > 0) {
        landscape.uomTable.fromProductArray(uomData.productConversions);
      }
    }

    // WorkOrderGroups — REST-tenant mapping output is in workOrderGroupsData.
    // File-tenants (no mapping pipeline) skip this; groups stay empty.
    if (workOrderGroupsData && workOrderGroupsData.length > 0) {
      this.hydrateWorkOrderGroups(landscape, workOrderGroupsData);
    }

    // Rollup-engine sync hook — rebuilds group membership from order.groupKey
    // and denormalises hierarchy/attributes down to orders and tasks. Safe
    // to call even when groups is empty (no-op).
    this.workOrderGroupService.rebuildGroups(landscape);

    // Cross-WO Linking — derive cross-WO prevLink edges from the BOM tree when
    // the tenant opts in (mapping crossWOLinking: "bomParentChild"). Runs after
    // groups are built (needs membership + groupKey) and after sequence
    // derivation (head/tail identified by sequence). No-op for default `none`.
    this.wireCrossWOLinks(landscape);

    // Processing Sequences — compute per-WO demand-prioritisation ranks from the
    // tenant's processingSequences (or the platform default). No-op-safe.
    this.deriveProcessingRanks(landscape);

    return landscape;
  }

  private static readonly IMPORTANCE_WEIGHT: Record<string, number> = {
    primary: 1.0, secondary: 0.01, tertiary: 0.0001, quaternary: 0.000001,
  };
  // Platform default: order WOs by their own priority (lower = more urgent, per
  // the RUSH/HIGH/NORMAL/LOW tiers). Honours the planner-set work-order priority
  // for tenants without explicit processingSequences.
  private static readonly PLATFORM_DEFAULT_SEQUENCE: IProcessingSequence = {
    name: 'platform-default',
    criteria: [{ field: 'order.priority', direction: 'asc', importance: 'primary' }],
  };

  /**
   * Processing Sequences — compute `order.processingRanks[sequenceName]` for every
   * WO from the tenant's `processingSequences` (composite weighted ranking with
   * min/max normalisation), or the platform default (`order.dueDate asc`) when
   * none are configured. Lower rank = higher priority. Resolves path expressions
   * source-shaped (entity first-class fields, else `order.rawFields`, the
   * `attributes[]`/`hierarchies[]` arrays, and raw group data for `group.*`).
   */
  private deriveProcessingRanks(landscape: SchedulingLandscape): void {
    const profile = this.configService.getMappingProfile?.();
    let sequences: IProcessingSequence[];
    if (profile?.processingSequences && profile.processingSequences.length > 0) {
      StateHydratorService.validateProcessingSequences(profile.processingSequences, profile.defaultSequence);
      sequences = profile.processingSequences;
    } else {
      sequences = [StateHydratorService.PLATFORM_DEFAULT_SEQUENCE];
      console.warn(
        '[StateHydratorService] processingSequences: tenant declares none — applying the ' +
        'platform default (order.priority asc). Add processingSequences + defaultSequence to ' +
        'the tenant mapping to make demand order explicit rather than assumed.',
      );
    }

    const rawGroups = new Map<string, Record<string, unknown>>();
    for (const g of (this.configService.getWorkOrderGroupsData?.() ?? [])) {
      rawGroups.set(g.key, g as unknown as Record<string, unknown>);
    }

    const orders: CTPOrder[] = [];
    landscape.orders.forEach(o => orders.push(o));
    if (orders.length === 0) return;

    StateHydratorService.computeProcessingRanks(orders, rawGroups, sequences);
    console.log(
      `[StateHydratorService] processingSequences: computed ranks [${sequences.map(s => s.name).join(', ')}] ` +
      `over ${orders.length} WOs.`,
    );
  }

  /**
   * Config-load validation (AC#7): unique sequence names, non-empty criteria,
   * each criterion has exactly one of weight|importance with valid enum values,
   * and `defaultSequence` references a defined sequence. Throws loudly at sync.
   */
  static validateProcessingSequences(sequences: IProcessingSequence[], defaultSequence?: string): void {
    const names = new Set<string>();
    for (const seq of sequences) {
      if (!seq.name) throw new Error('[StateHydratorService] processingSequences: a sequence is missing "name".');
      if (names.has(seq.name)) throw new Error(`[StateHydratorService] processingSequences: duplicate sequence name "${seq.name}".`);
      names.add(seq.name);
      if (!seq.criteria || seq.criteria.length === 0) {
        throw new Error(`[StateHydratorService] processingSequences: sequence "${seq.name}" has no criteria.`);
      }
      for (const c of seq.criteria) {
        if (!c.field) throw new Error(`[StateHydratorService] processingSequences: "${seq.name}" has a criterion missing "field".`);
        const hasW = c.weight !== undefined, hasI = c.importance !== undefined;
        if (hasW === hasI) {
          throw new Error(`[StateHydratorService] processingSequences: "${seq.name}" criterion "${c.field}" must set exactly one of weight | importance.`);
        }
        if (hasI && !(c.importance! in StateHydratorService.IMPORTANCE_WEIGHT)) {
          throw new Error(`[StateHydratorService] processingSequences: "${seq.name}" criterion "${c.field}" has invalid importance "${c.importance}".`);
        }
        if (c.direction && c.direction !== 'asc' && c.direction !== 'desc') {
          throw new Error(`[StateHydratorService] processingSequences: "${seq.name}" criterion "${c.field}" has invalid direction "${c.direction}".`);
        }
        if (c.nullsHandling && c.nullsHandling !== 'first' && c.nullsHandling !== 'last') {
          throw new Error(`[StateHydratorService] processingSequences: "${seq.name}" criterion "${c.field}" has invalid nullsHandling "${c.nullsHandling}".`);
        }
      }
    }
    if (defaultSequence && !names.has(defaultSequence)) {
      throw new Error(`[StateHydratorService] processingSequences: defaultSequence "${defaultSequence}" is not a defined sequence.`);
    }
  }

  /**
   * Pure composite-weighted ranking: stamps `order.processingRanks[name]` for each
   * sequence (lower = higher priority). Weights come from explicit `weight` or the
   * importance→weight table; values are min/max normalised across the WO set with
   * direction + nullsHandling applied. Exposed for unit testing.
   */
  static computeProcessingRanks(
    orders: CTPOrder[],
    rawGroups: Map<string, Record<string, unknown>>,
    sequences: IProcessingSequence[],
  ): void {
    for (const seq of sequences) {
      if (!seq.criteria || seq.criteria.length === 0) continue;
      const weights = seq.criteria.map(c =>
        c.weight ?? StateHydratorService.IMPORTANCE_WEIGHT[c.importance ?? 'primary'] ?? 1.0);
      const wSum = weights.reduce((a, b) => a + b, 0) || 1;
      const wNorm = weights.map(w => w / wSum);

      // Resolve each criterion's value per WO, then min/max over non-null values.
      const vals: (number | null)[][] = seq.criteria.map(c =>
        orders.map(o => StateHydratorService.resolveCriterionValue(o, rawGroups, c.field)));
      const bounds = vals.map(col => {
        const nums = col.filter((v): v is number => v != null);
        return { min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0 };
      });

      orders.forEach((o, oi) => {
        let rank = 0;
        seq.criteria.forEach((c, ci) => {
          const { min, max } = bounds[ci];
          const v = vals[ci][oi];
          let norm: number;
          if (v == null) {
            norm = c.nullsHandling === 'first' ? 0 : 1; // 'last' → sorts after (higher rank)
          } else {
            norm = max > min ? (v - min) / (max - min) : 0;
            if (c.direction === 'desc') norm = 1 - norm;
          }
          rank += wNorm[ci] * norm;
        });
        o.processingRanks[seq.name] = rank;
      });
    }
  }

  /** Resolve a path-expression criterion to a sortable number (or null). */
  private static resolveCriterionValue(
    order: CTPOrder,
    rawGroups: Map<string, Record<string, unknown>>,
    field: string,
  ): number | null {
    const parts = field.split('.');
    const raw = (order.rawFields ?? {}) as Record<string, unknown>;
    let val: unknown = null;
    if (parts[0] === 'order') {
      if (parts[1] === 'attributes') val = StateHydratorService.findNamed(raw['attributes'], parts[2]);
      else if (parts[1] === 'dueDate') val = order.dueDate;
      else if (parts[1] === 'priority') val = order.priority;
      else val = raw[parts[1]];
    } else if (parts[0] === 'group') {
      const g = order.groupKey ? rawGroups.get(order.groupKey) : undefined;
      if (g) {
        if (parts[1] === 'attributes') val = StateHydratorService.findNamed(g['attributes'], parts[2]);
        else val = g[parts[1]];
      }
    } else if (parts[0] === 'hierarchy') {
      val = StateHydratorService.findNamed(raw['hierarchies'], parts[1]);
    }
    return StateHydratorService.toSortable(val);
  }

  /** Find {name,value} (or {name} attr/hierarchy) by name in a source array. */
  private static findNamed(arr: unknown, name: string): unknown {
    if (!Array.isArray(arr)) return null;
    const hit = arr.find(e => e && typeof e === 'object' && (e as any).name === name);
    return hit ? (hit as any).value : null;
  }

  /** Coerce a resolved value to a sortable number: numeric, numeric-string, or ISO date. */
  private static toSortable(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (s === '') return null;
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
    const d = Date.parse(s);
    return Number.isNaN(d) ? null : d;
  }

  /**
   * Cross-WO Linking — derive cross-WO precedence from the BOM tree.
   *
   * When the mapping profile sets `crossWOLinking: "bomParentChild"`, for each
   * child WO (`order.parentOrderKey` → a parent order in the SAME
   * WorkOrderGroup) wire the child WO's chain tail as the parent WO's chain
   * head's `prevLink`. The engine then schedules the parent only after the child
   * via the normal preds/succs machinery — adjacency's `realPrevKey` honours the
   * cross-chain edge because both endpoints share `groupKey`. v1 is single-edge:
   * one child tail → one parent head per parent (many-to-many deferred).
   *
   * Default (`none` / unset): no-op. Throws on an unknown mode, or on
   * `bomParentChild` with no WorkOrderGroups (clear config error at sync time).
   */
  private wireCrossWOLinks(landscape: SchedulingLandscape): void {
    const mode = this.configService.getMappingProfile?.()?.crossWOLinking;
    if (!mode || mode === 'none') return;
    // Config-level validation (AC-7): bomParentChild requires the tenant to
    // DEFINE WorkOrderGroups capability — file-tenant group data or a rollup
    // group config. Genuine misconfiguration (neither) is rejected loudly.
    const hasGroupCapability =
      (this.configService.getWorkOrderGroupsData?.()?.length ?? 0) > 0 ||
      this.configService.getWorkOrderGroupsConfig?.() != null;
    const s = StateHydratorService.deriveCrossWOLinks(landscape, mode, hasGroupCapability);
    if (s.skipped === 'empty-groups') {
      console.log(
        `[StateHydratorService] crossWOLinking 'bomParentChild': no WorkOrderGroups in this ` +
        `landscape (empty/partial sync) — nothing to wire.`,
      );
      return;
    }
    console.log(
      `[StateHydratorService] crossWOLinking 'bomParentChild': wired ${s.linksWired} cross-WO ` +
      `link(s) across ${s.groupsTouched} group(s).` +
      (s.parentsAlreadyWired ? ` ${s.parentsAlreadyWired} extra child->parent edge(s) skipped ` +
        `(v1 single-edge; many-to-many deferred).` : '') +
      (s.missingParent ? ` ${s.missingParent} parentOrderKey reference(s) not found.` : '') +
      (s.crossGroup ? ` ${s.crossGroup} child->parent pair(s) skipped (different/no group).` : ''),
    );
    // Derive connected precedence components + WO-topo order + head WO (throws on
    // WO-level cycle or multi-sink). Stamps componentKey/topoPos/anchor on tasks.
    StateHydratorService.deriveComponents(landscape);
  }

  /**
   * Stamp `componentKey` / `componentTopoPos` / `componentAnchorStartW` on every
   * task from the (now cross-WO-wired) `prevLink` graph. componentKey = the
   * component's head WO (its single terminal WO). **Throws at hydrate** on a
   * WO-level cycle or a multi-sink component (no unique head) — both are data
   * errors with no valid schedule order. Single-WO components stamp their own WO
   * (topoPos 0), so non-cross-WO chains are unaffected.
   */
  static deriveComponents(landscape: Pick<SchedulingLandscape, 'tasks'>): void {
    const tasksByWO = new Map<string, CTPTask[]>();
    const byKey = new Map<string, CTPTask>();
    landscape.tasks.forEach(t => {
      byKey.set(t.key, t);
      const wo = t.linkId?.name; if (!wo) return;
      if (!tasksByWO.has(wo)) tasksByWO.set(wo, []);
      tasksByWO.get(wo)!.push(t);
    });

    // WO-level directed edges: predWO -> thisWO (predWO precedes thisWO).
    const woEdges = new Map<string, Set<string>>();
    for (const wo of tasksByWO.keys()) woEdges.set(wo, new Set());
    const uf = new Map<string, string>();
    for (const wo of tasksByWO.keys()) uf.set(wo, wo);
    const find = (x: string): string => { while (uf.get(x) !== x) { uf.set(x, uf.get(uf.get(x)!)!); x = uf.get(x)!; } return x; };
    const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) uf.set(ra, rb); };

    landscape.tasks.forEach(t => {
      const prev = t.linkId?.prevLink; if (!prev) return;
      const pred = byKey.get(prev); if (!pred) return;
      const thisWO = t.linkId?.name, predWO = pred.linkId?.name;
      if (!thisWO || !predWO || predWO === thisWO) return; // intra-WO handled by the chain
      woEdges.get(predWO)!.add(thisWO);
      union(predWO, thisWO);
    });

    // Group WOs into components.
    const compWOs = new Map<string, string[]>();
    for (const wo of tasksByWO.keys()) {
      const r = find(wo);
      if (!compWOs.has(r)) compWOs.set(r, []);
      compWOs.get(r)!.push(wo);
    }

    for (const [root, wos] of compWOs) {
      const set = new Set(wos);
      const outWithin = (w: string) => [...woEdges.get(w)!].filter(x => set.has(x));
      // Single terminal WO (sink = no outgoing edge within the component).
      const sinks = wos.filter(w => outWithin(w).length === 0);
      if (sinks.length > 1) {
        throw new Error(
          `[StateHydratorService] crossWOLinking: component (root ${root}) has ${sinks.length} ` +
          `terminal WOs (no unique head): ${sinks.join(', ')}. Multi-sink BOMs are not supported — ` +
          `fix the data or extend the design (deliberate future sprint).`,
        );
      }
      // Kahn topo (child WOs first); detect cycle.
      const indeg = new Map<string, number>(wos.map(w => [w, 0]));
      for (const w of wos) for (const x of outWithin(w)) indeg.set(x, indeg.get(x)! + 1);
      const pos = new Map<string, number>();
      let i = 0, seen = 0;
      let frontier = wos.filter(w => indeg.get(w)! === 0);
      while (frontier.length) {
        const next: string[] = [];
        for (const w of frontier) {
          pos.set(w, i++); seen++;
          for (const x of outWithin(w)) { indeg.set(x, indeg.get(x)! - 1); if (indeg.get(x)! === 0) next.push(x); }
        }
        frontier = next;
      }
      if (seen < wos.length) {
        throw new Error(
          `[StateHydratorService] crossWOLinking: WO-level cycle in component (root ${root}) among ` +
          `${wos.join(', ')} — no valid schedule order. Fix the data.`,
        );
      }
      const headWO = sinks[0] ?? wos[0];
      let anchor = Number.MAX_SAFE_INTEGER;
      for (const w of wos) for (const t of tasksByWO.get(w)!) {
        const s = t.window?.startW;
        if (typeof s === 'number' && s < anchor) anchor = s;
      }
      if (anchor === Number.MAX_SAFE_INTEGER) anchor = 0;
      for (const w of wos) for (const t of tasksByWO.get(w)!) {
        t.componentKey = headWO;
        t.componentTopoPos = pos.get(w) ?? 0;
        t.componentAnchorStartW = anchor;
      }
    }
  }

  /**
   * Pure cross-WO wiring over a landscape's collections (config already read by
   * the caller). Throws on an unknown mode or missing group capability. Returns
   * a summary; `skipped: 'empty-groups'` when nothing is loaded to wire.
   */
  static deriveCrossWOLinks(
    landscape: Pick<SchedulingLandscape, 'tasks' | 'orders' | 'groups'>,
    mode: string,
    hasGroupCapability: boolean,
  ): {
    skipped?: 'empty-groups';
    linksWired: number;
    parentsAlreadyWired: number;
    missingParent: number;
    crossGroup: number;
    groupsTouched: number;
  } {
    if (mode !== 'bomParentChild') {
      throw new Error(
        `[StateHydratorService] Unrecognised crossWOLinking value ${JSON.stringify(mode)}; ` +
        `expected 'none' or 'bomParentChild'.`,
      );
    }
    if (!hasGroupCapability) {
      throw new Error(
        `[StateHydratorService] crossWOLinking 'bomParentChild' requires WorkOrderGroups ` +
        `to be configured (group data or rollup config), but the tenant defines neither.`,
      );
    }
    let groupCount = 0;
    landscape.groups.forEach(() => { groupCount++; });
    if (groupCount === 0) {
      return { skipped: 'empty-groups', linksWired: 0, parentsAlreadyWired: 0, missingParent: 0, crossGroup: 0, groupsTouched: 0 };
    }

    // Index tasks by chain (linkId.name === order key).
    const tasksByChain = new Map<string, CTPTask[]>();
    landscape.tasks.forEach(t => {
      const name = t.linkId?.name;
      if (!name) return;
      if (!tasksByChain.has(name)) tasksByChain.set(name, []);
      tasksByChain.get(name)!.push(t);
    });

    // Deterministic iteration over child order keys.
    const childKeys: string[] = [];
    landscape.orders.forEach(o => childKeys.push(o.key));
    childKeys.sort();

    let linksWired = 0;
    let parentsAlreadyWired = 0;
    let missingParent = 0;
    let crossGroup = 0;
    const wiredParentHeads = new Set<string>();
    const groupsTouched = new Set<string>();

    for (const childKey of childKeys) {
      const child = landscape.orders.getEntity(childKey);
      if (!child) continue;
      const parentKey = child.parentOrderKey;
      if (!parentKey || parentKey === child.key) continue; // no parent / self
      const parent = landscape.orders.getEntity(parentKey);
      if (!parent) { missingParent++; continue; }
      // BOM precedence is within a Group: both WOs must share a non-null group.
      if (!child.groupKey || child.groupKey !== parent.groupKey) { crossGroup++; continue; }

      const childTasks = tasksByChain.get(child.key) ?? [];
      const parentTasks = tasksByChain.get(parent.key) ?? [];
      if (childTasks.length === 0 || parentTasks.length === 0) continue;

      // Tail = max sequence in child chain; head = min sequence in parent chain.
      const childTail = childTasks.reduce((a, b) => (b.sequence > a.sequence ? b : a));
      const parentHead = parentTasks.reduce((a, b) => (b.sequence < a.sequence ? b : a));

      // v1 single-edge: one cross-WO predecessor per parent head. If a parent
      // already received one (multiple children → one parent), keep the first
      // (deterministic by sorted child key) and skip the rest — counted.
      if (wiredParentHeads.has(parentHead.key)) { parentsAlreadyWired++; continue; }

      if (parentHead.linkId) {
        parentHead.linkId.prevLink = childTail.key;
        // Cross-WO edge is precedence-only — a subassembly may sit in inventory
        // before the parent consumes it. Set maxGap = null EXPLICITLY; never
        // inherit the chain-head's incidental null (so a future chain-head change
        // can't silently introduce a gap constraint on a cross-WO link).
        parentHead.linkId.maxGap = null;
      }
      // Denormalise groupKey onto both endpoints (diagnostics / future grouping).
      childTail.groupKey = child.groupKey;
      parentHead.groupKey = parent.groupKey;

      wiredParentHeads.add(parentHead.key);
      groupsTouched.add(child.groupKey);
      linksWired++;
    }

    return { linksWired, parentsAlreadyWired, missingParent, crossGroup, groupsTouched: groupsTouched.size };
  }

  private hydrateWorkOrderGroups(
    landscape: SchedulingLandscape,
    data: IWorkOrderGroupData[],
  ): void {
    for (const item of data) {
      const group = new CTPWorkOrderGroup('WorkOrderGroup', item.name ?? item.key, item.key);

      if (item.sourceStart) {
        const dt = this.parseIsoDateOrRecord(item.sourceStart, null, 'sourceStart');
        if (dt) group.sourceStart = CTPDateTime.fromDateTime(dt);
      }
      if (item.sourceEnd) {
        const dt = this.parseIsoDateOrRecord(item.sourceEnd, null, 'sourceEnd');
        if (dt) group.sourceEnd = CTPDateTime.fromDateTime(dt);
      }
      if (item.promiseDate) {
        const dt = this.parseIsoDateOrRecord(item.promiseDate, null, 'promiseDate');
        if (dt) group.promiseDate = CTPDateTime.fromDateTime(dt);
      }

      // Hierarchy slots — set value (and update slot name to match the
      // mapping's dimension label). slot is 1-indexed; CTPHierarchies
      // uses 0-indexed list access.
      for (const h of item.hierarchies ?? []) {
        const node = group.hierarchy.index(h.slot - 1);
        if (node) {
          node.name = h.name;
          node.value = h.value ?? '';
        }
      }

      // Attributes — empty-string values are still added (resolver already
      // dropped null/empty unless includeIfEmpty was set).
      for (const a of item.attributes ?? []) {
        group.attributes.add(new NameValue(a.name, a.value));
      }

      landscape.groups.addEntity(group);
    }
  }

  private hydrateCadences(landscape: SchedulingLandscape): void {
    // Build cadence key → intervalMinutes lookup
    const cadences = this.configService.getCadences();
    const cadenceMap = new Map<string, number>();
    for (const c of cadences) {
      cadenceMap.set(c.key, c.intervalMinutes);
    }
    if (cadenceMap.size === 0) return;

    // Build process key → cadence key lookup
    const processConfigs = this.configService.getProcesses();
    const processCadenceMap = new Map<string, string>();
    for (const p of processConfigs) {
      if (p.cadence) processCadenceMap.set(p.key, p.cadence);
    }

    // Build task key → cadence override lookup
    const taskConfigs = this.configService.getTasks();
    const taskCadenceMap = new Map<string, string | null>();
    for (const t of taskConfigs) {
      if (t.cadence !== undefined) taskCadenceMap.set(t.key, t.cadence ?? null);
    }

    // Resolve effective cadence for each task
    landscape.tasks?.forEach(task => {
      // Task-level override takes priority
      if (taskCadenceMap.has(task.key)) {
        const override = taskCadenceMap.get(task.key);
        if (override === null) return; // explicitly disabled
        const interval = cadenceMap.get(override!);
        if (interval) task.cadenceIntervalMinutes = interval;
        return;
      }

      // Fall back to process-level cadence (skip SETUP/TEARDOWN — only PROCESS tasks)
      if (task.process && task.type !== 'SETUP' && task.type !== 'TEARDOWN') {
        const cadenceKey = processCadenceMap.get(task.process);
        if (cadenceKey) {
          const interval = cadenceMap.get(cadenceKey);
          if (interval) task.cadenceIntervalMinutes = interval;
        }
      }
    });
  }

  private hydrateOrders(landscape: SchedulingLandscape, orderData: IOrderData[]): void {
    if (!orderData || orderData.length === 0) return;

    for (const item of orderData) {
      const order = new CTPOrder('Order', item.name, item.key);
      order.productKey = item.productKey;
      order.demandQty = item.demandQty;
      const dueDt = this.parseIsoDateOrRecord(item.dueDate, order, 'dueDate');
      if (dueDt) order.dueDate = CTPDateTime.fromDateTime(dueDt);
      const lateDt = this.parseIsoDateOrRecord(item.lateDueDate, order, 'lateDueDate');
      if (lateDt) order.lateDueDate = CTPDateTime.fromDateTime(lateDt);
      order.priority = item.priority ?? 0;
      if (item.latenessPenaltyPerDay !== undefined) order.latenessPenaltyPerDay = item.latenessPenaltyPerDay;

      // groupKey / parentOrderKey — populated from mapping output when present.
      if (typeof (item as any).groupKey === 'string') order.groupKey = (item as any).groupKey;
      if (typeof (item as any).parentOrderKey === 'string') order.parentOrderKey = (item as any).parentOrderKey;

      // Optional denormalised hierarchies + attributes (file-tenants that
      // pre-derive these per-entity in their JSON; the rollup engine still
      // reference-shares from the group at sync time, so these are the
      // physical source-of-truth read at hydration before rebuildGroups
      // overwrites with the group's instance).
      this.applyDenormalisedHierarchyAttributes(order, item as Record<string, unknown>);

      // Stash mapping-output extras (wostatus, customerName, jobCode, etc.)
      // on rawFields for downstream engines (rollup cancellationPredicate).
      order.rawFields = { ...(item as Record<string, unknown>) };

      landscape.orders.addEntity(order);
    }
  }

  /**
   * Pre-derived hierarchies + attributes optionally present on per-entity
   * source records (file-tenants enrich their JSON with the denormalised
   * values for offline inspectability). Populates entity.hierarchy and
   * entity.attributes from item.hierarchies / item.attributes if present.
   *
   * No-op when fields are absent (REST tenants don't carry these per-record;
   * they flow via the group + rebuildGroups reference-share path instead).
   */
  private applyDenormalisedHierarchyAttributes(
    entity: { hierarchy: { index: (i: number) => any }; attributes: { add: (nv: any) => void } },
    item: Record<string, unknown>,
  ): void {
    const hierarchies = item.hierarchies as Array<{ slot: number; name: string; value: string | null }> | undefined;
    if (Array.isArray(hierarchies)) {
      for (const h of hierarchies) {
        const node = entity.hierarchy.index(h.slot - 1);
        if (node) { node.name = h.name; node.value = h.value ?? ''; }
      }
    }
    const attributes = item.attributes as Array<{ name: string; value: string }> | undefined;
    if (Array.isArray(attributes)) {
      for (const a of attributes) {
        entity.attributes.add(new NameValue(a.name, a.value));
      }
    }
  }

  private hydrateHorizon(config: IHorizonConfig | null): CTPHorizon {
    if (!config) {
      const now = DateTime.now();
      return new CTPHorizon(now, now.plus({ days: 14 }));
    }
    const timezone = this.configService.getLocale()?.timezone || 'UTC';
    const startDt = this.resolveHorizonStart(config.start || 'NOW', timezone);
    const endDt = startDt.plus({ days: config.maxDays ?? 14 });
    return new CTPHorizon(startDt, endDt);
  }

  private resolveHorizonStart(value: string, timezone: string): DateTime {
    const now = DateTime.now().setZone(timezone).startOf('day');
    if (value === 'NOW') return now;
    const offsetMatch = value.match(/^NOW([+-])(\d+)d$/i);
    if (offsetMatch) {
      const sign = offsetMatch[1] === '+' ? 1 : -1;
      const days = parseInt(offsetMatch[2]) * sign;
      return now.plus({ days });
    }
    const parsed = DateTime.fromISO(value, { zone: timezone });
    if (parsed.isValid) return parsed.startOf('day');
    return now;
  }

  private hydrateSettings(config: ISettingsConfig): CTPAppSettings {
    const settings = new CTPAppSettings();
    if (config.scheduleDirection !== undefined)
      settings.scheduleDirection = config.scheduleDirection;
    if (config.flowAround !== undefined)
      settings.flowAround = config.flowAround;
    if (config.maxLateness !== undefined)
      settings.maxLateness = config.maxLateness;
    if (config.tasksPerLoop !== undefined)
      settings.tasksPerLoop = config.tasksPerLoop;
    if (config.topTasksToSchedule !== undefined)
      settings.topTasksToSchedule = config.topTasksToSchedule;
    if (config.resetUsageAfterProcessChange !== undefined)
      settings.resetUageAfterProcessChange = config.resetUsageAfterProcessChange;
    if (config.solverStrategy !== undefined)
      settings.solverStrategy = config.solverStrategy;
    return settings;
  }

  /**
   * Convert typedAttributes from either format:
   * - Array format (manufacturing): [{ name, dataType, value: { type, value }, category, sequence }]
   * - Object format (healthcare): { key: value, key2: [v1, v2] }
   * Returns the array format expected by CTPTypedAttributes.fromArray()
   */
  private normalizeTypedAttributes(attrs: any): any[] | null {
    if (!attrs) return null;
    if (Array.isArray(attrs)) return attrs;
    // Convert plain object to array format
    const result: any[] = [];
    let seq = 0;
    for (const [key, val] of Object.entries(attrs)) {
      let dataType: string;
      let value: any;
      if (Array.isArray(val)) {
        dataType = 'list';
        value = { type: 'list', value: val };
      } else if (typeof val === 'number') {
        dataType = 'number';
        value = { type: 'number', value: val };
      } else {
        dataType = 'enum';
        value = { type: 'enum', value: String(val) };
      }
      result.push({ name: key, dataType, value, category: '', sequence: seq++ });
    }
    return result;
  }

  private hydrateResources(data: IResourceData[]): CTPResources {
    const resources = new CTPResources();
    for (const item of data) {
      const resource = new CTPResource(
        item.class,
        item.type,
        item.name,
        item.key,
      );
      if (item.hierarchy?.level1) resource.hierarchy.first = item.hierarchy.level1;
      if (item.hierarchy?.level2) resource.hierarchy.second = item.hierarchy.level2;
      if (item.hourlyRate !== undefined) resource.hourlyRate = item.hourlyRate;
      const resAttrs = this.normalizeTypedAttributes(item.typedAttributes);
      if (resAttrs) {
        resource.typedAttributes.fromArray(resAttrs);
      }
      resources.addEntity(resource);
    }
    return resources;
  }

  private hydrateTasks(data: ITaskData[], horizon: CTPHorizon): CTPTasks {
    const tasks = new CTPTasks();
    let sawSourceSequence = false;
    for (const item of data) {
      const task = new CTPTask(item.type ?? 'PROCESS', item.name, item.key);

      // Window — solver constraint bounds. Defaults to horizon when source omits them
      // (universal default lives here, not in per-tenant mapping config — mapping translates
      // source fields to CTP fields; the engine layer completes the landscape).
      const window = new CTPInterval();
      const ws = this.parseIsoDateOrRecord(item.windowStart, task, 'windowStart');
      const we = this.parseIsoDateOrRecord(item.windowEnd,   task, 'windowEnd');
      if (ws && we) {
        window.fromDates(ws, we, 1);
      } else {
        window.set(horizon.startW, horizon.endW, 1);
      }
      task.window = window;

      // Pinned — set BEFORE the scheduled block so the scheduled fields
      // can be conditionally honored. Per Stafford v3.2 meeting decision:
      // task.scheduled is only authoritative when the upstream system has
      // explicitly locked the placement (Genius `IsSchedulingLocked=true`,
      // mapped to `pinned`). For non-pinned tasks, scheduled-shaped data
      // from the source represents a non-binding plan; let the solver own
      // placement instead.
      if (item.pinned === true) {
        task.pinned = true;
      }

      // Scheduled — where an upstream planner (Genius, our solver) placed
      // the task. Honor source values only when the task is pinned (locked).
      // Otherwise, leave task.scheduled null so the solver decides.
      const ss = this.parseIsoDateOrRecord(item.scheduledStart, task, 'scheduledStart');
      const se = this.parseIsoDateOrRecord(item.scheduledEnd,   task, 'scheduledEnd');
      if (ss && se && task.pinned) {
        const scheduled = new CTPInterval();
        scheduled.fromDates(ss, se, 1);
        task.scheduled = scheduled;
        // A pinned task is at a placement by definition. Reflect that in
        // task.state so the commitmentLevel deriver classifies the task by
        // its lifecycle (planned / running / completed) rather than treating
        // pinned itself as a status. Pinned is a parallel orthogonal flag.
        task.state = CTPTaskStateConstants.SCHEDULED;
      } else if (task.pinned) {
        // Edge case: pinned=true but no scheduledStart/End. Preserve the
        // pinned flag (source data fidelity) but leave state as default.
        // Doesn't happen in current Stafford data; defensive log for future.
        this.logger.warn(`Task ${task.key} marked pinned but missing scheduledStart/End; state left as default`);
      }

      // Duration
      if (item.durationSeconds !== undefined) {
        task.duration = new CTPDuration(
          item.durationSeconds,
          item.durationQty ?? 1,
          item.durationType ?? 0,
        );
      }

      // Capacity resources — supports two formats:
      // FLAT (manufacturing):   { resource: "CNC-01", isPrimary: true, preferences?: ["CNC-01","CNC-02"] }
      // GROUPED (healthcare):   { isPrimary: true, preferences: [{ resource: "OR-01", rank: 1 }, ...] }
      if (item.capacityResources && item.capacityResources.length > 0) {
        const capList = new CTPTaskResourceList();
        for (let i = 0; i < item.capacityResources.length; i++) {
          const entry: any = item.capacityResources[i];
          const isGrouped = Array.isArray(entry.preferences) &&
            entry.preferences.length > 0 &&
            typeof entry.preferences[0] === 'object';

          if (isGrouped) {
            // Grouped format: preferences are { resource, rank } objects
            const tr = new CTPTaskResource(
              entry.preferences[0].resource,
              entry.isPrimary ?? (i === 0),
              i,
            );
            if (entry.qty !== undefined) tr.qty = entry.qty;
            if (entry.mode) tr.mode = entry.mode;
            for (const pref of entry.preferences) {
              tr.preferences.push(
                new CTPResourcePreference(pref.resource, pref.rank ?? 0, pref.mode),
              );
            }
            capList.add(tr);
          } else {
            // Flat format: resource is a string, preferences are optional string[]
            const tr = new CTPTaskResource(entry.resource, entry.isPrimary, i);
            if (entry.qty !== undefined) tr.qty = entry.qty;
            if (entry.mode) tr.mode = entry.mode;
            const prefs: string[] = entry.preferences ?? [entry.resource];
            for (let p = 0; p < prefs.length; p++) {
              tr.preferences.push(new CTPResourcePreference(prefs[p], p + 1));
            }
            capList.add(tr);
          }
        }
        capList.sortBySequence();
        task.capacityResources = capList;
      }

      // Pinned-or-running → committed resource assignment.
      // For tasks where the upstream system has authoritative assignment
      // info — IsSchedulingLocked=true (pinned) or work is actively
      // happening on the floor (running, classified later from
      // CompletionPercentage / TotalCumulativeMachineHours via wipState) —
      // the requested resource on each capacityResource entry IS the
      // committed assignment. Populate `scheduledResource` from `resource`
      // so the DTO's assignedResources surfaces the binding to the UI's
      // "Capacity Resources" section.
      //
      // Pinned: handled here unconditionally (we know task.pinned by now).
      // Running: handled in the wipState=IN_PROCESS branch below, where
      // we ALSO set actualResources (because the task is on-the-floor).
      if (task.pinned && task.capacityResources) {
        task.capacityResources.forEach((entry: any) => {
          if (entry.resource && !entry.scheduledResource) {
            entry.scheduledResource = entry.resource;
          }
        });
      }

      // Materials resources
      if (item.materialsResources && item.materialsResources.length > 0) {
        const matList = new CTPTaskResourceList();
        for (let i = 0; i < item.materialsResources.length; i++) {
          const entry = item.materialsResources[i];
          const tr = new CTPTaskResource(entry.resource, entry.isPrimary, i);
          if (entry.qty !== undefined) tr.qty = entry.qty;
          if (entry.mode) tr.mode = entry.mode;
          tr.preferences.push(new CTPResourcePreference(entry.resource));
          matList.add(tr);
        }
        matList.sortBySequence();
        task.materialsResources = matList;
      }

      // Sequence is derived from linkId topology in a post-pass below — not
      // honoured from source. See deriveSequencesFromLinkId at end of
      // hydrateTasks. We track whether source attempted to set sequence
      // so we can emit a single warning per sync (Stafford WO 28687 root
      // cause: sequence missing → degenerate sort in ChainContextEngine).
      if (item.sequence !== undefined) sawSourceSequence = true;

      // Process & subType
      if (item.process) task.process = item.process;
      if (item.subType) task.subType = item.subType;

      // Link ID
      if (item.linkId) {
        task.linkId = new CTPLinkId(
          item.linkId.name,
          item.linkId.type ?? '',
          item.linkId.prevLink,
          item.linkId.maxGap ?? null,
        );
      }

      // Product output linkage
      if (item.outputProductKey) task.outputProductKey = item.outputProductKey;
      if (item.outputQty !== undefined) task.outputQty = item.outputQty;
      if (item.outputScrapRate !== undefined) task.outputScrapRate = item.outputScrapRate;

      // Material inputs
      if (item.inputMaterials && Array.isArray(item.inputMaterials)) {
        const matInputs = new CTPTaskMaterialInputList();
        for (const mi of item.inputMaterials) {
          const matInput = new CTPTaskMaterialInput(
            mi.productKey,
            mi.requiredQty,
            mi.scrapRate ?? 0,
            mi.unitOfMeasure ?? 'pcs',
          );
          // Look up unitCost from materials config
          if (mi.unitCost !== undefined) {
            matInput.unitCost = mi.unitCost;
          } else {
            const matData = this.configService.getMaterials().find(m => m.key === mi.productKey);
            if (matData?.unitCost !== undefined) matInput.unitCost = matData.unitCost;
          }
          matInputs.add(matInput);
        }
        task.inputMaterials = matInputs;
      }

      // Commitment stack fields from config (for testing without WIP sync)
      if (item.dispatched) {
        task.dispatched = true;
        task.dispatchedAt = (item as any).dispatchedAt || null;
        task.materialsPulled = (item as any).materialsPulled ?? true;
        // Don't pin here — applyCommitmentStack handles pinning after first solve
        // Surface the resource assignment for UI's "Capacity Resources"
        // section — dispatched tasks have been formally released to the
        // floor, so the assignment IS committed.
        if (task.capacityResources) {
          task.capacityResources.forEach((entry: any) => {
            if (entry.resource && !entry.scheduledResource) {
              entry.scheduledResource = entry.resource;
            }
          });
        }
      }
      if ((item as any).wipState === 'IN_PROCESS') {
        task.wipstate = 1; // CTPWipStateConstants.IN_PROCESS
        task.actualStart = (item as any).actualStart || null;
        // actualResources: prefer source-supplied values, otherwise derive
        // from capacityResources (the requested resource IS where work is
        // actively happening for an in-process task per Stafford's signal).
        let actuals: string[] = (item as any).actualResources ?? [];
        if (actuals.length === 0 && task.capacityResources) {
          actuals = [];
          task.capacityResources.forEach((entry: any) => {
            if (entry.resource) actuals.push(entry.resource);
          });
        }
        task.actualResources = actuals;
        // Also commit the resource assignment to scheduledResource so the
        // UI's "Capacity Resources" section renders for running tasks.
        if (task.capacityResources) {
          task.capacityResources.forEach((entry: any) => {
            if (entry.resource && !entry.scheduledResource) {
              entry.scheduledResource = entry.resource;
            }
          });
        }
        task.percentComplete = (item as any).percentComplete ?? 0;
        task.remainingDuration = (item as any).remainingDuration ?? null;
      }
      if ((item as any).wipState === 'ON_HOLD') {
        task.wipstate = 3; // CTPWipStateConstants.ON_HOLD
        task.holdReason = (item as any).holdReason || null;
        task.estimatedResumeTime = (item as any).estimatedResumeTime || null;
        task.actualStart = (item as any).actualStart || null;
        task.actualResources = (item as any).actualResources ?? [];
        task.percentComplete = (item as any).percentComplete ?? 0;
      }
      if ((item as any).wipState === 'COMPLETED') {
        task.wipstate = 5; // CTPWipStateConstants.COMPLETED
        task.actualStart = (item as any).actualStart || null;
        task.actualEnd = (item as any).actualEnd || null;
        // actualResources: prefer source-supplied; else derive from
        // capacityResources (the requested resource IS where the
        // completed work was done).
        let actuals: string[] = (item as any).actualResources ?? [];
        if (actuals.length === 0 && task.capacityResources) {
          actuals = [];
          task.capacityResources.forEach((entry: any) => {
            if (entry.resource) actuals.push(entry.resource);
          });
        }
        task.actualResources = actuals;
        // Also surface the assignment for UI's "Capacity Resources" section.
        if (task.capacityResources) {
          task.capacityResources.forEach((entry: any) => {
            if (entry.resource && !entry.scheduledResource) {
              entry.scheduledResource = entry.resource;
            }
          });
        }
        task.percentComplete = 100;
      }

      // Typed attributes
      const taskAttrs = this.normalizeTypedAttributes(item.typedAttributes);
      if (taskAttrs) {
        task.typedAttributes.fromArray(taskAttrs);
      }

      // Map typedAttributes.priority → task.priority for scheduling order
      if (item.typedAttributes) {
        const attrs: any = item.typedAttributes;
        const rawPriority = Array.isArray(attrs)
          ? attrs.find((a: any) => a.name === 'priority')?.value?.value
          : attrs.priority;
        if (rawPriority) {
          if (typeof rawPriority === 'number') {
            // Numeric priority: use directly (1-10 RUSH, 11-30 HIGH, 31-70 NORMAL, 71-100 LOW)
            task.priority = rawPriority;
          } else {
            // Text priority: map to numeric tier (1-10 RUSH, 11-30 HIGH, 31-70 NORMAL, 71-100 LOW)
            const priorityRank: Record<string, number> = { URGENT: 5, 'ADD-ON': 20, ELECTIVE: 50 };
            task.priority = priorityRank[String(rawPriority).toUpperCase()] ?? 50;
          }
        }
      }

      // Numeric priority from numericPriority attribute overrides above
      if (item.typedAttributes) {
        const attrs: any = item.typedAttributes;
        const numPri = Array.isArray(attrs)
          ? attrs.find((a: any) => a.name === 'numericPriority')?.value?.value
          : attrs.numericPriority;
        if (typeof numPri === 'number') task.priority = numPri;
      }
      task.originalPriority = task.priority;

      // Optional denormalised hierarchies + attributes + groupKey (file-tenants
      // that pre-derive these per-entity in tasks.json). See applyDenormalised…
      // for shape. Rollup engine still reference-shares from group at sync time.
      this.applyDenormalisedHierarchyAttributes(task, item as Record<string, unknown>);
      if (typeof (item as any).groupKey === 'string') task.groupKey = (item as any).groupKey;

      tasks.addEntity(task);
    }

    // Cascade COMPLETED backward through chains. Per Stafford v3.2 meeting:
    // when a task is COMPLETED, all its predecessors are assumed COMPLETED
    // even if their own source data doesn't carry the signal. This handles
    // the typical ERP pattern where only the latest-completed task is flagged
    // and earlier ops in the chain are implicitly done.
    //
    // We iterate until no more changes — a single backward pass would miss
    // multi-hop chains where the cascade reveals a new COMPLETED that itself
    // has predecessors. In practice convergence is fast (chain depth bounded).
    const tasksByKey = new Map<string, CTPTask>();
    tasks.forEach((t) => tasksByKey.set(t.key, t));
    let changed = true;
    while (changed) {
      changed = false;
      tasks.forEach((t) => {
        if (t.wipstate === 5 /* COMPLETED */ && t.linkId?.prevLink) {
          const prev = tasksByKey.get(t.linkId.prevLink);
          if (prev && prev.wipstate !== 5) {
            prev.wipstate = 5;
            prev.percentComplete = 100;
            // Surface the predecessor's resource assignment too — the
            // work was done on its capacityResources by the time the
            // successor completed.
            if (prev.capacityResources) {
              const actuals: string[] = [];
              prev.capacityResources.forEach((entry: any) => {
                if (entry.resource) {
                  actuals.push(entry.resource);
                  if (!entry.scheduledResource) entry.scheduledResource = entry.resource;
                }
              });
              if (prev.actualResources?.length === 0) prev.actualResources = actuals;
            }
            changed = true;
          }
        }
      });
    }

    // ── Derive task.sequence from linkId topology ───────────────────────────
    // linkId.prevLink is the single source of truth for chain order. We
    // unconditionally walk it and assign sequence positions per chain. Any
    // source-supplied sequence is ignored (warned about once per sync).
    //
    // Without this pass, tenants whose mappings don't emit sequence end up
    // with all tasks at the default value; ChainContextEngine sorts by
    // sequence and gets a degenerate (file-order) sort, processing chain
    // tasks out of order. Stafford WO 28687 QC-6 was the canonical repro
    // (chain order T-1→F-2→NT-3→P-4→M-5→QC-6, disk-file order
    // F-2,NT-3,P-4,QC-6,M-5,T-1 → engine bailed at QC-6's chain evaluation).
    if (sawSourceSequence) {
      console.warn(
        '[StateHydratorService] task.sequence is derived from linkId topology; ' +
        'source-supplied sequence values were observed in the input but ignored. ' +
        'Remove the sequence field from tenant mapping to silence this warning.',
      );
    }
    StateHydratorService.deriveSequencesFromLinkId(tasks);
    StateHydratorService.assertSequenceMatchesLinkId(tasks);

    return tasks;
  }

  /**
   * For each chain (grouped by linkId.name), walk prevLink topologically and
   * assign sequence 1..N in chain order. Tasks not in any chain (no linkId.name)
   * keep their default sequence. Logs warnings for multi-head chains or cycles
   * — these indicate malformed linkId data that the engine wouldn't schedule
   * correctly even with sequence correct.
   */
  static deriveSequencesFromLinkId(tasks: CTPTasks): void {
    const byChain = new Map<string, CTPTask[]>();
    tasks.forEach(t => {
      const chainKey = t.linkId?.name;
      if (!chainKey) return;
      if (!byChain.has(chainKey)) byChain.set(chainKey, []);
      byChain.get(chainKey)!.push(t);
    });

    for (const [chainKey, chainTasks] of byChain) {
      const inChain = new Set(chainTasks.map(t => t.key));
      // A "real" predecessor exists when the prevLink is non-empty, refers
      // to a task in this chain, and is not the task itself (self-references
      // appear in some Stafford WORK7 captures — treat as if no predecessor).
      const realPrev = (t: CTPTask): string | null => {
        const prev = t.linkId?.prevLink;
        if (!prev || prev === t.key || !inChain.has(prev)) return null;
        return prev;
      };
      const successorOf = new Map<string, CTPTask>();
      for (const t of chainTasks) {
        const prev = realPrev(t);
        if (prev) successorOf.set(prev, t);
      }
      const heads = chainTasks.filter(t => realPrev(t) === null);

      if (heads.length === 0) {
        // No head found = all tasks point to in-chain predecessors → cycle.
        // Fall back to chainTasks insertion order so the chain still gets
        // sequence values (strictly increasing within the chain so the
        // assertion's invariant holds along whatever edges DO exist).
        console.warn(
          `[StateHydratorService] chain ${chainKey}: no head found (cycle in linkId.prevLink); ` +
          `assigning sequences in disk order as fallback.`,
        );
        let seq = 1;
        for (const t of chainTasks) t.sequence = seq++;
        continue;
      }
      if (heads.length > 1) {
        console.warn(
          `[StateHydratorService] chain ${chainKey}: expected 1 head, found ` +
          `${heads.length} (${heads.map(h => h.key).join(', ')}). ` +
          `Sequence assignment will start from each head independently.`,
        );
      }

      let seq = 1;
      const placed = new Set<string>();
      for (const head of heads) {
        let cur: CTPTask | undefined = head;
        while (cur) {
          if (placed.has(cur.key)) {
            console.warn(`[StateHydratorService] chain ${chainKey}: revisited ${cur.key} during walk; stopping.`);
            break;
          }
          placed.add(cur.key);
          cur.sequence = seq++;
          cur = successorOf.get(cur.key);
        }
      }
      // Any chain tasks not reached by walking from heads (e.g. orphans in a
      // weird shape) still get a sequence so the assertion passes.
      for (const t of chainTasks) {
        if (!placed.has(t.key)) t.sequence = seq++;
      }
    }
  }

  /**
   * Producer-side invariant check. Runs once per sync immediately after
   * deriveSequencesFromLinkId. The engine trusts this and doesn't re-check on
   * every solve cycle (CTPBaseScheduler has an opt-in dev-mode variant gated
   * by CTP_VALIDATE_SEQUENCE for debugging).
   *
   * Fails loudly here at the sync boundary so any future regression in
   * derivation surfaces immediately in the sync output, not as a mystery
   * scheduling infeasibility later.
   */
  static assertSequenceMatchesLinkId(tasks: CTPTasks): void {
    const byKey = new Map<string, CTPTask>();
    tasks.forEach(t => byKey.set(t.key, t));
    tasks.forEach(t => {
      const prev = t.linkId?.prevLink;
      if (!prev) return;
      if (prev === t.key) return; // self-reference; not a real predecessor
      const predecessor = byKey.get(prev);
      if (!predecessor) return; // orphan; warned during derivation
      // Cross-chain (cross-WO) prevLinks have independent per-chain sequence
      // numbering, so the strictly-increasing invariant only applies within a
      // chain. Precedence for cross-WO edges rides on preds/succs, not sequence.
      if ((predecessor.linkId?.name ?? '') !== (t.linkId?.name ?? '')) return;
      if (predecessor.sequence >= t.sequence) {
        throw new Error(
          `[StateHydratorService] task.sequence inconsistent with linkId topology ` +
          `after derivation: task ${t.key} (seq=${t.sequence}) follows ` +
          `${predecessor.key} (seq=${predecessor.sequence}) per linkId.prevLink, ` +
          `but sequence does not strictly increase. deriveSequencesFromLinkId ` +
          `has a bug.`,
        );
      }
    });
  }

  private static readonly DAY_MAP: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };

  private hydrateCalendars(
    data: ICalendarData[],
    resources: CTPResources,
    horizon: CTPHorizon,
    tenantTimezone: string = 'UTC',
  ): void {
    for (const cal of data) {
      const resource = resources.getEntity(cal.resourceKey);
      if (!resource) continue;

      const available = new CTPAvailable();

      // Explicit intervals format
      if (cal.intervals) {
        for (const iv of cal.intervals) {
          const startW = CTPDateTime.fromDateTime(DateTime.fromISO(iv.start));
          const endW = CTPDateTime.fromDateTime(DateTime.fromISO(iv.end));
          const interval = new CTPInterval(startW, endW, iv.qty);
          if (iv.runRate !== undefined) interval.runRate = iv.runRate;
          available.add(interval);
        }
      }

      // Shift-based format — expand across horizon
      // Shift times are in tenant-local time; convert to UTC for the engine
      if (cal.shifts) {
        const hStart = horizon.startDate.setZone(tenantTimezone);
        const hEnd = horizon.endDate.setZone(tenantTimezone);
        for (const shift of cal.shifts) {
          const dayNums = shift.days.map(d => StateHydratorService.DAY_MAP[d]).filter(Boolean);
          const [startH, startM] = shift.start.split(':').map(Number);
          const [endH, endM] = shift.end.split(':').map(Number);

          let day = hStart.startOf('day');
          while (day < hEnd) {
            if (dayNums.includes(day.weekday)) {
              const intervalStart = day.set({ hour: startH, minute: startM, second: 0 }).toUTC();
              const intervalEnd = day.set({ hour: endH, minute: endM, second: 0 }).toUTC();
              const startW = CTPDateTime.fromDateTime(intervalStart);
              const endW = CTPDateTime.fromDateTime(intervalEnd);
              available.add(new CTPInterval(startW, endW, 1));
            }
            day = day.plus({ days: 1 });
          }
        }
      }

      resource.original = available;
      resource.assignments = new CTPAssignments();
      resource.available.setLists(resource.original, resource.assignments);
    }
  }

  private hydrateStateChanges(data: IStateChangeData[]): CTPStateChanges {
    const stateChanges = new CTPStateChanges();
    for (const item of data) {
      const sc = new CTPStateChange(
        item.resourceType,
        item.type,
        item.fromState,
        item.toState,
      );
      if (item.duration !== undefined) sc.duration = item.duration;
      if (item.penalty !== undefined) sc.penalty = item.penalty;
      if (item.cost !== undefined) sc.cost = item.cost;
      stateChanges.addEntity(sc);
    }
    return stateChanges;
  }
}
