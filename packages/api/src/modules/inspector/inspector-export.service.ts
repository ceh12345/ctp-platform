import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import {
  CTPDateTime,
  CTPOrder,
  CTPTask,
  CTPWorkOrderGroup,
  SchedulingLandscape,
  WorkOrderGroupStatus,
} from '@ctp/engine';
import * as ExcelJS from 'exceljs';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';

/**
 * Builds the data-inspector Excel workbook for the current tenant.
 *
 * Phase 3 status: per-entity sheets are in (Jobs, WorkOrders, Tasks,
 * Materials) plus the synthesized parent levels (Projects, SalesOrders,
 * SOLines). Phase 4 adds the flat Attributes sheet and Unattached.
 *
 * Reads the same in-memory snapshot the rest of the app uses
 * (StateService.getLandscape + getAttributeSources). Generating the
 * export does not trigger a snapshot reload.
 */
@Injectable()
export class InspectorExportService {
  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
  ) {}

  async buildWorkbook(): Promise<{ buffer: Uint8Array; filename: string }> {
    const landscape = this.stateService.getLandscape();
    if (!landscape) {
      throw new HttpException(
        { error: 'snapshot_unavailable', detail: 'No landscape loaded for this tenant. Sync first via /state/sync or /ctp/solve.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CTP Data Inspector';
    workbook.created = new Date();

    // Build counts up-front so the _Index reflects every sheet that follows.
    const projects     = this.synthesizeParents(landscape, 1);
    const salesOrders  = this.synthesizeParents(landscape, 2);
    const soLines      = this.synthesizeParents(landscape, 3);

    this.addIndexSheet(workbook, landscape, {
      projectCount: projects.length,
      salesOrderCount: salesOrders.length,
      soLineCount: soLines.length,
    });
    this.addProjectsSheet(workbook, projects);
    this.addSalesOrdersSheet(workbook, salesOrders);
    this.addSOLinesSheet(workbook, soLines);
    this.addJobsSheet(workbook, landscape);
    this.addWorkOrdersSheet(workbook, landscape);
    this.addTasksSheet(workbook, landscape);
    this.addMaterialsSheet(workbook, landscape);
    // Phase 4: Attributes + Unattached sheets.

    // exceljs's writeBuffer() returns a Buffer, but Node's evolving Buffer
    // type signature (Buffer<ArrayBufferLike> in newer Node @types) makes
    // a direct cast a TS strict-mode mismatch. Route via unknown — the
    // runtime value IS a Uint8Array (Buffer extends Uint8Array), TS just
    // can't prove it.
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Uint8Array;
    const tenantId = this.configService.getTenantId();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `inspector-${tenantId}-${ts}.xlsx`;
    return { buffer, filename };
  }

  // ── _Index sheet ─────────────────────────────────────────────────────

  private addIndexSheet(
    workbook: ExcelJS.Workbook,
    landscape: SchedulingLandscape,
    synth: { projectCount: number; salesOrderCount: number; soLineCount: number },
  ): void {
    const sheet = workbook.addWorksheet('_Index');
    sheet.columns = [
      { header: '', key: 'label', width: 36 },
      { header: '', key: 'value', width: 56 },
    ];

    const tenant = this.configService.getTenantConfig();
    const sources = this.stateService.getAttributeSources();
    const wogSources = sources.get('workOrderGroups');

    let materialCount = 0;
    landscape.tasks.forEach((t) => {
      if (t.inputMaterials) materialCount += t.inputMaterials.length;
    });

    sheet.addRows([
      ['Tenant key',          this.configService.getTenantId()],
      ['Tenant display name', tenant?.name ?? ''],
      ['Snapshot timestamp',  new Date().toISOString()],
      ['Export generated at', new Date().toISOString()],
      [],
      ['ENTITY COUNTS', ''],
      ['Projects',                        synth.projectCount,    '(synthesized from hierarchy slot 2)'],
      ['SalesOrders',                     synth.salesOrderCount, '(synthesized from hierarchy slot 3)'],
      ['SOLines',                         synth.soLineCount,     '(synthesized from hierarchy slot 4 — empty if slot not configured)'],
      ['Jobs',                            landscape.groups.size()],
      ['WorkOrders',                      landscape.orders.size()],
      ['Tasks',                           landscape.tasks.size()],
      ['Materials (task-input pairs)',    materialCount],
      ['Resources',                       landscape.resources.size()],
      [],
      ['ATTRIBUTE SOURCE COVERAGE', ''],
      ['workOrderGroups (declared names)', wogSources ? wogSources.size : 0],
    ]);

    // Bold the two section headers
    sheet.getRow(6).font  = { bold: true };
    sheet.getRow(16).font = { bold: true };
  }

  // ── Synthesized parent sheets (Projects / SalesOrders / SOLines) ────

  /**
   * Group CTPWorkOrderGroup records by a hierarchy slot's value.
   * One row per distinct value. slotIndex is 1-based to match
   * HierarchySlotMapping conventions; the engine's CTPHierarchies uses
   * 0-based indices, so we subtract one.
   */
  private synthesizeParents(
    landscape: SchedulingLandscape,
    slotIndex: 1 | 2 | 3 | 4 | 5,
  ): SynthesizedParent[] {
    const buckets = new Map<string, { name: string; jobs: CTPWorkOrderGroup[] }>();
    let slotName = '';
    landscape.groups.forEach((g) => {
      const node = g.hierarchy.index(slotIndex - 1);
      const value = node?.value ?? '';
      if (!value) return;
      slotName = node?.name ?? slotName;
      if (!buckets.has(value)) buckets.set(value, { name: node!.name, jobs: [] });
      buckets.get(value)!.jobs.push(g);
    });
    const out: SynthesizedParent[] = [];
    for (const [key, { name, jobs }] of buckets) {
      out.push({ key, dimensionName: name, jobs, slotIndex });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    void slotName;   // referenced via node.name above; kept for clarity
    return out;
  }

  private addProjectsSheet(workbook: ExcelJS.Workbook, parents: SynthesizedParent[]): void {
    this.addSynthSheet(workbook, 'Projects', parents);
  }

  private addSalesOrdersSheet(workbook: ExcelJS.Workbook, parents: SynthesizedParent[]): void {
    this.addSynthSheet(workbook, 'SalesOrders', parents);
  }

  private addSOLinesSheet(workbook: ExcelJS.Workbook, parents: SynthesizedParent[]): void {
    this.addSynthSheet(workbook, 'SOLines', parents);
  }

  private addSynthSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    parents: SynthesizedParent[],
  ): void {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = [
      { header: 'key',                     key: 'key',         width: 24 },
      { header: 'dimensionName',           key: 'dim',         width: 18 },
      { header: 'jobCount',                key: 'jobCount',    width: 10 },
      { header: 'workOrderCount',          key: 'woCount',     width: 14 },
      { header: 'synthesizedFromAttribute',key: 'synth',       width: 26 },
    ];
    for (const p of parents) {
      const woCount = p.jobs.reduce((s, j) => s + j.workOrderKeys.length, 0);
      sheet.addRow({
        key: p.key,
        dim: p.dimensionName,
        jobCount: p.jobs.length,
        woCount,
        synth: `hierarchy.slot${p.slotIndex}`,
      });
    }
    this.applyTableConventions(sheet);
  }

  // ── Jobs sheet (CTPWorkOrderGroups) ─────────────────────────────────

  private addJobsSheet(workbook: ExcelJS.Workbook, landscape: SchedulingLandscape): void {
    const groups = landscape.groups.toArray();
    const attrNames = this.unionAttributeNames(groups.map((g) => this.attributesOf(g)));

    const sheet = workbook.addWorksheet('Jobs');
    sheet.columns = [
      { header: 'key',                     key: 'key',          width: 14 },
      { header: 'name',                    key: 'name',         width: 60 },
      { header: 'headWorkOrderKey',        key: 'head',         width: 18 },
      { header: 'sourceStart',             key: 'srcStart',     width: 24 },
      { header: 'sourceEnd',               key: 'srcEnd',       width: 24 },
      { header: 'promiseDate',             key: 'promise',      width: 24 },
      { header: 'computedStart',           key: 'compStart',    width: 24 },
      { header: 'computedEnd',             key: 'compEnd',      width: 24 },
      { header: 'status',                  key: 'status',       width: 10 },
      { header: 'statusLabel',             key: 'statusLabel',  width: 14 },
      { header: 'totalWorkOrders',         key: 'twoCount',     width: 14 },
      { header: 'cancelledWorkOrders',     key: 'cancelled',    width: 18 },
      { header: 'totalDemandQty',          key: 'demandQty',    width: 16 },
      { header: 'totalScheduledQty',       key: 'schedQty',     width: 18 },
      { header: 'workOrderKeys',           key: 'woKeys',       width: 50 },
      ...attrNames.map((n) => ({ header: `attr.${n}`, key: `attr_${n}`, width: 24 })),
    ];

    for (const g of groups) {
      const attrs = this.attributesOf(g);
      const row: Record<string, unknown> = {
        key: g.key,
        name: g.name,
        head: g.headWorkOrderKey ?? '',
        srcStart: toIsoOrNull(g.sourceStart),
        srcEnd: toIsoOrNull(g.sourceEnd),
        promise: toIsoOrNull(g.promiseDate),
        compStart: toIsoOrNull(g.computedStart),
        compEnd: toIsoOrNull(g.computedEnd),
        status: g.status,
        statusLabel: WorkOrderGroupStatus[g.status] ?? '',
        twoCount: g.totalWorkOrders,
        cancelled: g.cancelledWorkOrders,
        demandQty: g.totalDemandQty,
        schedQty: g.totalScheduledQty,
        woKeys: g.workOrderKeys.join(', '),
      };
      for (const n of attrNames) row[`attr_${n}`] = attrs[n] ?? '';
      sheet.addRow(row);
    }
    this.applyTableConventions(sheet);
  }

  // ── WorkOrders sheet (CTPOrders) ────────────────────────────────────

  private addWorkOrdersSheet(workbook: ExcelJS.Workbook, landscape: SchedulingLandscape): void {
    // Build a taskCount map: orderKey → count
    const taskCount = new Map<string, number>();
    landscape.tasks.forEach((t) => {
      const k = t.linkId?.name;
      if (!k) return;
      taskCount.set(k, (taskCount.get(k) ?? 0) + 1);
    });

    const orders = landscape.orders.toArray();
    const attrNames = this.unionAttributeNames(orders.map((o) => this.attributesOf(o)));

    const sheet = workbook.addWorksheet('WorkOrders');
    sheet.columns = [
      { header: 'key',                key: 'key',           width: 14 },
      { header: 'name',               key: 'name',          width: 60 },
      { header: 'groupKey',           key: 'groupKey',      width: 12 },
      { header: 'parentWorkOrderKey', key: 'parent',        width: 18 },
      { header: 'isHead',             key: 'isHead',        width: 8 },
      { header: 'dueDate',            key: 'dueDate',       width: 24 },
      { header: 'lateDueDate',        key: 'lateDueDate',   width: 24 },
      { header: 'productKey',         key: 'productKey',    width: 24 },
      { header: 'demandQty',          key: 'demandQty',     width: 12 },
      { header: 'scheduledQty',       key: 'schedQty',      width: 14 },
      { header: 'priority',           key: 'priority',      width: 10 },
      { header: 'taskCount',          key: 'taskCount',     width: 11 },
      ...attrNames.map((n) => ({ header: `attr.${n}`, key: `attr_${n}`, width: 24 })),
    ];

    for (const o of orders) {
      const attrs = this.attributesOf(o);
      const isHead = o.parentOrderKey === null || o.parentOrderKey === o.key;
      const row: Record<string, unknown> = {
        key: o.key,
        name: o.name ?? '',
        groupKey: o.groupKey ?? '',
        parent: o.parentOrderKey ?? '',
        isHead,
        dueDate: o.dueDate > 0 ? CTPDateTime.toDateTime(o.dueDate).toISO() : '',
        lateDueDate: o.lateDueDate > 0 ? CTPDateTime.toDateTime(o.lateDueDate).toISO() : '',
        productKey: o.productKey,
        demandQty: o.demandQty,
        schedQty: o.scheduledQty,
        priority: o.priority,
        taskCount: taskCount.get(o.key) ?? 0,
      };
      for (const n of attrNames) row[`attr_${n}`] = attrs[n] ?? '';
      sheet.addRow(row);
    }
    this.applyTableConventions(sheet);
  }

  // ── Tasks sheet (CTPTasks) ──────────────────────────────────────────

  private addTasksSheet(workbook: ExcelJS.Workbook, landscape: SchedulingLandscape): void {
    const tasks = landscape.tasks.toArray();
    const attrNames = this.unionAttributeNames(tasks.map((t) => this.attributesOf(t)));

    const sheet = workbook.addWorksheet('Tasks');
    sheet.columns = [
      { header: 'key',                  key: 'key',         width: 24 },
      { header: 'name',                 key: 'name',        width: 50 },
      { header: 'orderKey',             key: 'orderKey',    width: 14 },
      { header: 'groupKey',             key: 'groupKey',    width: 12 },
      { header: 'process',              key: 'process',     width: 24 },
      { header: 'type',                 key: 'type',        width: 14 },
      { header: 'subType',              key: 'subType',     width: 14 },
      { header: 'durationSeconds',      key: 'durSec',      width: 16 },
      { header: 'windowStart',          key: 'windowStart', width: 24 },
      { header: 'windowEnd',            key: 'windowEnd',   width: 24 },
      { header: 'scheduledStart',       key: 'schedStart',  width: 24 },
      { header: 'scheduledEnd',         key: 'schedEnd',    width: 24 },
      { header: 'state',                key: 'state',       width: 8 },
      { header: 'wipState',             key: 'wipState',    width: 10 },
      { header: 'pinned',               key: 'pinned',      width: 8 },
      { header: 'capacityResourceKeys', key: 'resKeys',     width: 40 },
      ...attrNames.map((n) => ({ header: `attr.${n}`, key: `attr_${n}`, width: 24 })),
    ];

    for (const t of tasks) {
      const attrs = this.attributesOf(t);
      const capKeys: string[] = [];
      t.capacityResources?.forEach((tr) => {
        const k = tr.scheduledResource || tr.resource;
        if (k) capKeys.push(k);
      });
      const row: Record<string, unknown> = {
        key: t.key,
        name: t.name ?? '',
        orderKey: t.linkId?.name ?? '',
        groupKey: t.groupKey ?? '',
        process: t.process ?? '',
        type: t.type ?? '',
        subType: t.subType ?? '',
        durSec: t.duration?.duration() ?? '',
        windowStart: t.window ? toIsoOrNull(t.window.startW) : '',
        windowEnd:   t.window ? toIsoOrNull(t.window.endW)   : '',
        schedStart:  t.scheduled ? toIsoOrNull(t.scheduled.startW) : '',
        schedEnd:    t.scheduled ? toIsoOrNull(t.scheduled.endW)   : '',
        state: t.state,
        wipState: t.wipstate,
        pinned: t.pinned,
        resKeys: capKeys.join(', '),
      };
      for (const n of attrNames) row[`attr_${n}`] = attrs[n] ?? '';
      sheet.addRow(row);
    }
    this.applyTableConventions(sheet);
  }

  // ── Materials sheet (one row per (task, inputMaterial) pair) ────────

  private addMaterialsSheet(workbook: ExcelJS.Workbook, landscape: SchedulingLandscape): void {
    const sheet = workbook.addWorksheet('Materials');
    sheet.columns = [
      { header: 'taskKey',        key: 'taskKey',      width: 24 },
      { header: 'taskName',       key: 'taskName',     width: 40 },
      { header: 'orderKey',       key: 'orderKey',     width: 14 },
      { header: 'groupKey',       key: 'groupKey',     width: 12 },
      { header: 'productKey',     key: 'productKey',   width: 24 },
      { header: 'requiredQty',    key: 'requiredQty',  width: 14 },
      { header: 'scrapRate',      key: 'scrapRate',    width: 12 },
      { header: 'grossQty',       key: 'grossQty',     width: 12 },
      { header: 'unitOfMeasure',  key: 'unit',         width: 12 },
    ];

    landscape.tasks.forEach((t) => {
      if (!t.inputMaterials) return;
      t.inputMaterials.forEach((m) => {
        sheet.addRow({
          taskKey: t.key,
          taskName: t.name ?? '',
          orderKey: t.linkId?.name ?? '',
          groupKey: t.groupKey ?? '',
          productKey: m.productKey,
          requiredQty: m.requiredQty,
          scrapRate: m.scrapRate,
          grossQty: m.grossQty(),
          unit: m.unitOfMeasure,
        });
      });
    });
    this.applyTableConventions(sheet);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Extract {attributeName → value} from an entity's CTPAttributes.
   * Works uniformly across CTPWorkOrderGroup, CTPOrder, CTPTask because
   * all three carry `attributes: CTPAttributes` (and the rollup engine
   * reference-shares the group's instance to its members + their tasks).
   */
  private attributesOf(entity: CTPWorkOrderGroup | CTPOrder | CTPTask): Record<string, string> {
    const out: Record<string, string> = {};
    entity.attributes.forEach((nv) => {
      if (nv.value !== undefined && nv.value !== null && nv.value !== '') {
        out[nv.name] = nv.value;
      }
    });
    return out;
  }

  /** Union of attribute keys across a collection. Used to size the `attr.*` columns. */
  private unionAttributeNames(records: Record<string, string>[]): string[] {
    const set = new Set<string>();
    for (const r of records) for (const k of Object.keys(r)) set.add(k);
    return Array.from(set).sort();
  }

  /**
   * Standard table styling: bold header row, frozen first row, auto-filter
   * on the full data range. Applied to every entity-level sheet so the
   * working session has filterable headers everywhere.
   */
  private applyTableConventions(sheet: ExcelJS.Worksheet): void {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (sheet.rowCount > 1 && sheet.columnCount > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to:   { row: sheet.rowCount, column: sheet.columnCount },
      };
    }
  }
}

// ── Module-private types ──────────────────────────────────────────────

interface SynthesizedParent {
  key: string;
  dimensionName: string;
  jobs: CTPWorkOrderGroup[];
  slotIndex: number;
}

function toIsoOrNull(epochSeconds: number | null): string {
  if (epochSeconds === null || epochSeconds === undefined || epochSeconds === 0) return '';
  return CTPDateTime.toDateTime(epochSeconds).toISO() ?? '';
}
