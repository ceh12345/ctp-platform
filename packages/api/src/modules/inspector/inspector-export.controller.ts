import { Controller, Get, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InspectorExportService } from './inspector-export.service';

@ApiTags('inspector')
@Controller('inspector')
export class InspectorExportController {
  constructor(private readonly inspectorExportService: InspectorExportService) {}

  @Get('export')
  @ApiOperation({
    summary: 'Download the data-inspector Excel workbook for the current tenant',
    description: 'Generates a multi-sheet XLSX file (Index + per-entity sheets + Attributes + Unattached) from the current in-memory snapshot. Synchronous response; does NOT trigger a sync.',
  })
  @ApiResponse({ status: 200, description: 'XLSX file as attachment' })
  @ApiResponse({ status: 503, description: 'No snapshot loaded for the tenant — sync first' })
  async export(): Promise<StreamableFile> {
    const { buffer, filename } = await this.inspectorExportService.buildWorkbook();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
