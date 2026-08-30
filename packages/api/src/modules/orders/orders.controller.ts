import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import {
  OrdersListResponseDto,
  DistinctResponseDto,
} from './dto/orders-row.dto';

const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 100;
const MAX_DISTINCT_LIMIT = 500;
const DEFAULT_DISTINCT_LIMIT = 100;

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'List work orders with filter / sort / pagination' })
  @ApiQuery({ name: 'sortBy',   required: false, type: String })
  @ApiQuery({ name: 'sortDir',  required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'page',     required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, type: OrdersListResponseDto })
  list(@Query() query: Record<string, string | string[]>): OrdersListResponseDto {
    const filters  = extractFilters(query);
    const sortBy   = (asString(query['sortBy'])  || 'dueDate');
    const sortDir  = asString(query['sortDir']) === 'desc' ? 'desc' : 'asc';
    // No upper bound on the page number — the third argument is a MAX, and
    // passing 1 here pinned every request to page 1, so Next/Prev in the grid
    // silently re-served the first slice. Out-of-range pages fall out as an
    // empty rows array, which is what the client already expects.
    const page     = clampPositiveInt(query['page'], 1, Number.MAX_SAFE_INTEGER);
    const pageSize = clampPositiveInt(query['pageSize'], DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    return this.ordersService.listOrders({ filters, sortBy, sortDir, page, pageSize });
  }

  @Get('distinct')
  @ApiOperation({ summary: 'Distinct values for a column under the current filter scope' })
  @ApiQuery({ name: 'column', required: true,  type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'limit',  required: false, type: Number })
  @ApiResponse({ status: 200, type: DistinctResponseDto })
  distinct(@Query() query: Record<string, string | string[]>): DistinctResponseDto {
    const column = asString(query['column']);
    if (!column) throw new BadRequestException('column query parameter is required');
    const filters = extractFilters(query);
    const search  = asString(query['search']) || undefined;
    const limit   = clampPositiveInt(query['limit'], DEFAULT_DISTINCT_LIMIT, MAX_DISTINCT_LIMIT);
    return this.ordersService.distinct({ column, filters, search, limit });
  }
}

// ── Query parsing helpers ────────────────────────────────────────────────────

function extractFilters(query: Record<string, string | string[]>): Record<string, string[]> {
  // Supports both Nest's parsed `filter[Customer]=X` (key already "filter[Customer]")
  // and the comma-list shorthand `filter.Customer=X,Y` (URL-friendly).
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(query)) {
    const bracket = /^filter\[(.+)\]$/.exec(k);
    const dot     = /^filter\.(.+)$/.exec(k);
    const col = bracket?.[1] ?? dot?.[1];
    if (!col) continue;
    const values = Array.isArray(v) ? v : [v];
    const flat: string[] = [];
    for (const item of values) {
      if (typeof item !== 'string') continue;
      // Comma-split the dot form; keep the bracket form intact (one value per key).
      if (dot) flat.push(...item.split(',').map((s) => s.trim()).filter(Boolean));
      else flat.push(item);
    }
    if (flat.length > 0) {
      out[col] = (out[col] ?? []).concat(flat);
    }
  }
  return out;
}

function asString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

function clampPositiveInt(v: string | string[] | undefined, fallback: number, max: number): number {
  const s = asString(v);
  if (!s) return fallback;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
