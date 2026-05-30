import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { SchedulingLandscape } from '@ctp/engine';
import * as ExcelJS from 'exceljs';
import { StateService } from '../state/state.service';
import { ConfigService } from '../../config/config.service';

/**
 * Builds the data-inspector Excel workbook for the current tenant.
 *
 * Phase 2: minimum-viable response — `_Index` sheet only, proves the
 * endpoint + content-type + library path end-to-end. Phase 3+ adds
 * per-entity sheets (Projects, SalesOrders, SOLines, Jobs, WorkOrders,
 * Tasks, Materials, Attributes, Unattached).
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

    this.addIndexSheet(workbook, landscape);
    // Phase 3+: per-entity sheets land here.

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

  private addIndexSheet(workbook: ExcelJS.Workbook, landscape: SchedulingLandscape): void {
    const sheet = workbook.addWorksheet('_Index');
    sheet.columns = [
      { header: '', key: 'label', width: 32 },
      { header: '', key: 'value', width: 56 },
    ];

    const tenant = this.configService.getTenantConfig();
    const sources = this.stateService.getAttributeSources();
    const wogSources = sources.get('workOrderGroups');

    sheet.addRows([
      ['Tenant key',          this.configService.getTenantId()],
      ['Tenant display name', tenant?.name ?? ''],
      ['Snapshot timestamp',  new Date().toISOString()],
      ['Export generated at', new Date().toISOString()],
      [],
      ['ENTITY COUNTS', ''],
      ['Jobs',         landscape.groups.size()],
      ['WorkOrders',   landscape.orders.size()],
      ['Tasks',        landscape.tasks.size()],
      ['Resources',    landscape.resources.size()],
      [],
      ['ATTRIBUTE SOURCE COVERAGE', ''],
      ['workOrderGroups (declared attribute names)', wogSources ? wogSources.size : 0],
    ]);

    // Bold section headers (rows 6 and 12 above)
    sheet.getRow(6).font  = { bold: true };
    sheet.getRow(12).font = { bold: true };
  }
}
