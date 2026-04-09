# Sprint: Data Adapter Layer — Pluggable Data Sources for CTP

**Status:** 📋 Ready  
**Size:** ~4-5 hours CC work (Session 1: interface + file adapter refactor, Session 2: REST adapter + Genius implementation, Session 3: sync scheduling + API endpoints)  
**Depends on:** UOM Conversion Table (for duration/qty normalization during ETL)  
**Triggered by:** Stafford has a live Genius REST API. Current flat-file loading won't scale to production. Need a pluggable adapter layer so the engine doesn't care where data comes from.

---

## Problem

CTP currently loads data from flat JSON files via `stateService.syncFromConfig()`. This works for demos and dev but won't survive production:

- **Stale data** — files are a point-in-time snapshot. WIP changes on the floor aren't reflected.
- **Manual process** — someone has to export and copy files. No mid-market manufacturer will do this daily.
- **No standard path** — each tenant's ERP has different APIs, export formats, and conventions. Without an adapter abstraction, every integration is a one-off.

Stafford Engineering has a live Genius REST API with endpoints for sales orders, work orders, production tasks, and machines. We need to pull from it, transform through the mapping profile, and hydrate the engine — all without the engine knowing or caring that the data came from an API instead of a file.

---

## Design

### Core Principle

Separate **where data comes from** (adapter) from **how data is transformed** (mapping profile). The engine consumes a `RawDataSet` — it doesn't know if it came from files, a REST API, a CSV upload, or a database query.

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌────────────┐
│  Data Source     │     │  Data Adapter     │     │  Mapping        │     │  CTP       │
│  (Genius API,   │────▶│  (IDataAdapter)   │────▶│  Profile        │────▶│  Engine     │
│   flat files,   │     │  Fetches raw data │     │  (ETL rules)    │     │  Landscape  │
│   CSV upload)   │     │  per entity type  │     │  Transforms to  │     │            │
└─────────────────┘     └──────────────────┘     │  CTP model      │     └────────────┘
                                                  └─────────────────┘
```

---

## Deliverables

### 1. IDataAdapter Interface

**Location:** `Integration/adapter.ts`

```typescript
// Raw data as received from the source — before any CTP transformation
interface RawRecord {
  [key: string]: any;
}

interface RawDataSet {
  orders: RawRecord[];
  tasks: RawRecord[];
  resources: RawRecord[];
  calendars: RawRecord[];
  processes: RawRecord[];
  products: RawRecord[];
  stateChanges: RawRecord[];
  materials: RawRecord[];
  uomConversions?: {
    globalConversions: RawRecord[];
    productConversions: RawRecord[];
  };
  metadata: {
    adapterType: string;       // "file", "rest", "csv", "push"
    fetchedAt: string;         // ISO 8601 timestamp
    tenantId: string;
    source: string;            // "genius-api", "flat-files", "csv-upload"
    recordCounts: Record<string, number>;  // { orders: 15, tasks: 100, ... }
    errors: AdapterError[];    // non-fatal issues encountered during fetch
  };
}

interface AdapterError {
  entity: string;              // "orders", "tasks", etc.
  message: string;
  severity: "warning" | "error";
  recordIndex?: number;        // which record had the issue
  field?: string;              // which field
}

interface IDataAdapter {
  readonly adapterType: string;

  // Full fetch — all entities at once
  fetchAll(tenantId: string): Promise<RawDataSet>;

  // Individual entity fetch — for incremental/partial sync
  fetchOrders(tenantId: string): Promise<RawRecord[]>;
  fetchTasks(tenantId: string): Promise<RawRecord[]>;
  fetchResources(tenantId: string): Promise<RawRecord[]>;
  fetchCalendars(tenantId: string): Promise<RawRecord[]>;

  // Health check — can we reach the source?
  testConnection(tenantId: string): Promise<{
    connected: boolean;
    latencyMs: number;
    error?: string;
  }>;
}
```

### 2. Adapter Configuration (per tenant)

**Location:** `config/tenants/{tenant}/adapter.json`

```json
{
  "adapterType": "rest",
  "source": "genius-api",
  "connection": {
    "baseUrl": "https://genius.stafford.co.nz:53215/api/data/fetch",
    "auth": {
      "type": "basic",
      "credentialsRef": "vault://stafford-genius-api"
    },
    "timeout": 30000,
    "retries": 3,
    "retryDelay": 2000
  },
  "endpoints": {
    "orders": {
      "entities": [
        {
          "name": "salesOrders",
          "path": "/salesOrderDetailEntity",
          "params": { "filter": "ItemStatus!=\"C\"" }
        },
        {
          "name": "workOrders",
          "path": "/workOrderWithAdvancedInformationViewEntity",
          "params": { "filter": "WoStatusCode!=\"CLOSED\"" }
        }
      ],
      "join": {
        "type": "left",
        "on": { "salesOrders": "JobCode", "workOrders": "Job" }
      }
    },
    "tasks": {
      "entities": [
        {
          "name": "productionTasks",
          "path": "/productionTaskWithAdvancedInfoViewEntity",
          "params": {}
        }
      ]
    },
    "resources": {
      "entities": [
        {
          "name": "machines",
          "path": "/machineAndRessourceEntity",
          "params": { "filter": "Active=true" }
        }
      ]
    }
  },
  "schedule": {
    "mode": "interval",
    "intervalMinutes": 15,
    "wipSyncIntervalMinutes": 5,
    "onDemand": true
  }
}
```

For flat files (current behavior):

```json
{
  "adapterType": "file",
  "source": "flat-files",
  "connection": {
    "dataDir": "config/tenants/stafford-engineering/data"
  },
  "schedule": {
    "mode": "manual",
    "onDemand": true
  }
}
```

### 3. Mapping Profile (per tenant)

**Location:** `config/tenants/{tenant}/mapping.json`

The mapping profile defines field-level transformations from raw records to CTP entities. This is the document we've been building for Stafford — now formalized as a config file.

```json
{
  "version": "1.0",
  "tenantId": "stafford-engineering",
  "source": "genius-api",
  
  "orders": {
    "keyField": "WorkOrder",
    "mappings": {
      "key": { "source": "WorkOrder" },
      "name": { "source": ["SalesOrderNo", "ProductDescription1"], "transform": "concat", "separator": " — " },
      "productKey": { "source": "Product" },
      "demandQty": { "source": "QuantityPlanned" },
      "dueDate": { "source": "DeliveryDate", "transform": "toUTC" },
      "lateDueDate": { "source": "DeliveryDate", "transform": "toUTC" },
      "priority": { "source": "Strategy", "transform": "lookup", "lookupTable": {
        "JIT": 30, "MTO": 50, "MTS": 60, "_default": 50
      }}
    }
  },

  "tasks": {
    "keyField": "Id",
    "mappings": {
      "key": { "source": "Id", "transform": "toString" },
      "name": { "source": ["OperationDescription", "ItemDescription1"], "transform": "concat", "separator": " — " },
      "type": { "value": "PROCESS" },
      "process": { "source": "OperationCode" },
      "sequence": { "source": "Order" },
      "durationSeconds": { 
        "source": ["CycleTime", "WoPlannedQuantity"], 
        "transform": "durationCalc",
        "timeUnit": "HR",
        "formula": "multiply_then_convert"
      },
      "durationQty": { "source": "WoPlannedQuantity" },
      "durationType": { "value": 0 },
      "capacityResources": {
        "transform": "buildResourceList",
        "primary": { "source": "MachineCode", "isPrimary": true }
      },
      "linkId": {
        "name": { "source": "WorkOrderCode" },
        "type": { "transform": "chainPosition", "sequenceField": "Order" }
      },
      "wipState": {
        "transform": "deriveWipState",
        "completedField": "IsCompleted",
        "startField": "TaskStartDate",
        "endField": "TaskEndDate"
      },
      "commitmentLevel": {
        "transform": "deriveCommitment",
        "lockedField": "IsSchedulingLocked",
        "completedField": "IsCompleted",
        "startField": "TaskStartDate"
      },
      "lagSeconds": { "source": "LagHours", "transform": "hoursToSeconds" }
    }
  },

  "resources": {
    "keyField": "Code",
    "mappings": {
      "key": { "source": "Code" },
      "name": { "source": "Description1" },
      "type": { "source": "OperationsCode" },
      "class": { "value": "REUSABLE" },
      "hourlyRate": { "source": "MachineRateCost" },
      "hierarchy": { "source": "DepartmentCode", "transform": "toHierarchy", "level": "department" }
    }
  },

  "calendars": {
    "transform": "deriveFromResources",
    "hoursPerDayField": "HourCapacityPerDay",
    "daysPerWeekField": "OperatingDayPerWeek",
    "calendarCodeField": "CalendarMspCode",
    "shiftStartHour": 6,
    "timezone": "Pacific/Auckland"
  },

  "transforms": {
    "toUTC": {
      "type": "dateConvert",
      "fromTimezone": "Pacific/Auckland",
      "toTimezone": "UTC"
    },
    "hoursToSeconds": {
      "type": "multiply",
      "factor": 3600
    },
    "durationCalc": {
      "type": "custom",
      "description": "CycleTime × Qty, then convert time unit to seconds via UOM table"
    }
  }
}
```

### 4. Concrete Adapters

#### 4a. FileAdapter (refactor of current behavior)

```typescript
class FileAdapter implements IDataAdapter {
  readonly adapterType = "file";
  
  constructor(private config: FileAdapterConfig) {}
  
  async fetchAll(tenantId: string): Promise<RawDataSet> {
    const dataDir = this.config.connection.dataDir;
    return {
      orders: JSON.parse(fs.readFileSync(`${dataDir}/orders.json`, 'utf8')),
      tasks: JSON.parse(fs.readFileSync(`${dataDir}/tasks.json`, 'utf8')),
      resources: JSON.parse(fs.readFileSync(`${dataDir}/resources.json`, 'utf8')),
      calendars: JSON.parse(fs.readFileSync(`${dataDir}/calendars.json`, 'utf8')),
      processes: JSON.parse(fs.readFileSync(`${dataDir}/processes.json`, 'utf8')),
      products: JSON.parse(fs.readFileSync(`${dataDir}/products.json`, 'utf8')),
      stateChanges: JSON.parse(fs.readFileSync(`${dataDir}/state-changes.json`, 'utf8')),
      materials: this.safeRead(`${dataDir}/materials.json`, []),
      metadata: {
        adapterType: "file",
        fetchedAt: new Date().toISOString(),
        tenantId,
        source: "flat-files",
        recordCounts: {},
        errors: [],
      },
    };
  }
  
  async testConnection(tenantId: string): Promise<{ connected: boolean; latencyMs: number }> {
    const start = Date.now();
    const exists = fs.existsSync(this.config.connection.dataDir);
    return { connected: exists, latencyMs: Date.now() - start };
  }
  
  // Individual entity methods delegate to fetchAll + pick
  async fetchOrders(tenantId: string) { return (await this.fetchAll(tenantId)).orders; }
  async fetchTasks(tenantId: string) { return (await this.fetchAll(tenantId)).tasks; }
  async fetchResources(tenantId: string) { return (await this.fetchAll(tenantId)).resources; }
  async fetchCalendars(tenantId: string) { return (await this.fetchAll(tenantId)).calendars; }
}
```

#### 4b. RestAdapter (generic, config-driven)

```typescript
class RestAdapter implements IDataAdapter {
  readonly adapterType = "rest";
  
  constructor(
    private config: RestAdapterConfig,
    private httpClient: HttpService,
  ) {}
  
  async fetchAll(tenantId: string): Promise<RawDataSet> {
    const errors: AdapterError[] = [];
    const startTime = Date.now();
    
    // Fetch all entity types in parallel
    const [orders, tasks, resources, calendars] = await Promise.allSettled([
      this.fetchEntityGroup("orders", tenantId),
      this.fetchEntityGroup("tasks", tenantId),
      this.fetchEntityGroup("resources", tenantId),
      this.fetchEntityGroup("calendars", tenantId),
    ]);
    
    // Handle partial failures — some entities might fail while others succeed
    const extract = (result: PromiseSettledResult<RawRecord[]>, entity: string): RawRecord[] => {
      if (result.status === "fulfilled") return result.value;
      errors.push({ entity, message: result.reason?.message || "Fetch failed", severity: "error" });
      return [];
    };
    
    return {
      orders: extract(orders, "orders"),
      tasks: extract(tasks, "tasks"),
      resources: extract(resources, "resources"),
      calendars: extract(calendars, "calendars"),
      processes: [],   // derived from tasks during mapping
      products: [],    // derived from orders during mapping
      stateChanges: [],
      materials: [],
      metadata: {
        adapterType: "rest",
        fetchedAt: new Date().toISOString(),
        tenantId,
        source: this.config.source,
        recordCounts: {
          orders: (orders as any).value?.length || 0,
          tasks: (tasks as any).value?.length || 0,
          resources: (resources as any).value?.length || 0,
        },
        errors,
      },
    };
  }
  
  // Fetch one entity group (may involve multiple API calls + join)
  private async fetchEntityGroup(entityType: string, tenantId: string): Promise<RawRecord[]> {
    const endpointConfig = this.config.endpoints[entityType];
    if (!endpointConfig) return [];
    
    // Fetch all sub-entities for this group
    const results = new Map<string, RawRecord[]>();
    for (const entity of endpointConfig.entities) {
      const url = `${this.config.connection.baseUrl}${entity.path}`;
      const data = await this.fetchWithRetry(url, entity.params);
      results.set(entity.name, this.extractResults(data));
    }
    
    // If multiple sub-entities, join them
    if (endpointConfig.join && results.size > 1) {
      return this.joinResults(results, endpointConfig.join);
    }
    
    // Single entity — return directly
    return results.values().next().value || [];
  }
  
  // Extract results from Genius API response format: { "Result": [...] }
  private extractResults(response: any): RawRecord[] {
    if (Array.isArray(response)) return response;
    if (response?.Result && Array.isArray(response.Result)) return response.Result;
    return [response];
  }
  
  private async fetchWithRetry(url: string, params: Record<string, string>): Promise<any> {
    const maxRetries = this.config.connection.retries || 3;
    const delay = this.config.connection.retryDelay || 2000;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.httpClient.get(url, {
          params,
          timeout: this.config.connection.timeout || 30000,
          headers: this.buildAuthHeaders(),
        }).toPromise();
        return response.data;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, delay * (attempt + 1)));
      }
    }
  }
  
  async testConnection(tenantId: string): Promise<{ connected: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      // Hit the first configured endpoint with limit=1
      const firstEntity = Object.values(this.config.endpoints)[0]?.entities[0];
      if (!firstEntity) return { connected: false, latencyMs: 0, error: "No endpoints configured" };
      const url = `${this.config.connection.baseUrl}${firstEntity.path}`;
      await this.httpClient.get(url, {
        params: { limit: "1" },
        timeout: 10000,
        headers: this.buildAuthHeaders(),
      }).toPromise();
      return { connected: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { connected: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
```

#### 4c. CsvUploadAdapter (future, for import wizard)

```typescript
class CsvUploadAdapter implements IDataAdapter {
  readonly adapterType = "csv";
  // Accepts uploaded CSV/XLSX files, parses to RawRecord[]
  // Uses column mapper config to identify which columns map to which entity
  // Validates on parse, reports errors in metadata
}
```

#### 4d. PushAdapter (future, for webhook/event-driven)

```typescript
class PushAdapter implements IDataAdapter {
  readonly adapterType = "push";
  // Receives data via POST /v1/state/sync with raw payload
  // Stores in a buffer, mapping profile applied on read
  // Supports incremental updates (partial entity sets)
}
```

### 5. Mapping Engine

**Location:** `Integration/mapping-engine.ts`

Applies the mapping profile to a `RawDataSet` and produces CTP model entities.

```typescript
class MappingEngine {
  constructor(
    private profile: MappingProfile,
    private uomTable: CTPUOMConversionTable,
  ) {}
  
  // Transform raw data into CTP landscape entities
  transform(raw: RawDataSet): TransformedDataSet {
    return {
      orders: raw.orders.map(r => this.transformOrder(r)),
      tasks: raw.tasks.map(r => this.transformTask(r)),
      resources: raw.resources.map(r => this.transformResource(r)),
      calendars: this.transformCalendars(raw.resources, raw.calendars),
      // ... other entities
      errors: this.validationErrors,
    };
  }
  
  private transformOrder(raw: RawRecord): CTPOrder { ... }
  private transformTask(raw: RawRecord): CTPTask { ... }
  private transformResource(raw: RawRecord): CTPResource { ... }
  
  // Apply a single field mapping rule
  private applyMapping(raw: RawRecord, mapping: FieldMapping): any {
    switch (mapping.transform) {
      case undefined:    return raw[mapping.source];                    // direct
      case "concat":     return mapping.source.map(f => raw[f]).join(mapping.separator);
      case "toUTC":      return this.convertToUTC(raw[mapping.source]);
      case "lookup":     return mapping.lookupTable[raw[mapping.source]] ?? mapping.lookupTable["_default"];
      case "hoursToSeconds": return this.uomTable.toSeconds(raw[mapping.source], "HR");
      case "durationCalc":   return this.calcDuration(raw, mapping);
      case "deriveWipState": return this.deriveWipState(raw, mapping);
      case "deriveCommitment": return this.deriveCommitment(raw, mapping);
      case "chainPosition":  return this.deriveChainPosition(raw, mapping);
      // ... extensible
    }
  }
  
  // Duration: CycleTime × Qty → convert time unit to seconds
  private calcDuration(raw: RawRecord, mapping: FieldMapping): number {
    const [timeField, qtyField] = mapping.source;
    const totalTime = (raw[timeField] || 0) * (raw[qtyField] || 1);
    return this.uomTable.toSeconds(totalTime, mapping.timeUnit || "HR");
  }
}
```

### 6. Adapter Factory + Registry

**Location:** `Integration/adapter-factory.ts`

```typescript
class DataAdapterFactory {
  private adapters = new Map<string, new (...args: any[]) => IDataAdapter>();
  
  register(type: string, adapterClass: new (...args: any[]) => IDataAdapter): void {
    this.adapters.set(type, adapterClass);
  }
  
  create(config: AdapterConfig): IDataAdapter {
    const AdapterClass = this.adapters.get(config.adapterType);
    if (!AdapterClass) throw new Error(`Unknown adapter type: ${config.adapterType}`);
    return new AdapterClass(config);
  }
}

// Registration at startup
const factory = new DataAdapterFactory();
factory.register("file", FileAdapter);
factory.register("rest", RestAdapter);
factory.register("csv", CsvUploadAdapter);
```

### 7. Sync Service (replaces direct file loading)

**Location:** `Integration/sync.service.ts`

Orchestrates: adapter fetch → mapping transform → landscape hydration.

```typescript
@Injectable()
class SyncService {
  private lastSync = new Map<string, SyncResult>();
  
  constructor(
    private adapterFactory: DataAdapterFactory,
    private configService: ConfigService,
  ) {}
  
  // Full sync — fetch all, transform, hydrate
  async sync(tenantId: string): Promise<SyncResult> {
    const adapterConfig = this.configService.getAdapterConfig(tenantId);
    const mappingProfile = this.configService.getMappingProfile(tenantId);
    const adapter = this.adapterFactory.create(adapterConfig);
    
    // 1. Fetch raw data from source
    const raw = await adapter.fetchAll(tenantId);
    
    // 2. Transform through mapping profile
    const uomTable = new CTPUOMConversionTable();
    if (raw.uomConversions) {
      uomTable.fromGlobalArray(raw.uomConversions.globalConversions || []);
      uomTable.fromProductArray(raw.uomConversions.productConversions || []);
    }
    const mappingEngine = new MappingEngine(mappingProfile, uomTable);
    const transformed = mappingEngine.transform(raw);
    
    // 3. Hydrate landscape
    const landscape = this.hydrateLandscape(transformed);
    
    const result: SyncResult = {
      tenantId,
      syncedAt: new Date().toISOString(),
      adapterType: adapterConfig.adapterType,
      source: adapterConfig.source,
      recordCounts: raw.metadata.recordCounts,
      transformErrors: transformed.errors,
      fetchErrors: raw.metadata.errors,
      success: transformed.errors.filter(e => e.severity === "error").length === 0,
    };
    
    this.lastSync.set(tenantId, result);
    return result;
  }
  
  // Test connectivity without syncing
  async testConnection(tenantId: string): Promise<any> {
    const config = this.configService.getAdapterConfig(tenantId);
    const adapter = this.adapterFactory.create(config);
    return adapter.testConnection(tenantId);
  }
  
  // Get last sync status
  getLastSync(tenantId: string): SyncResult | null {
    return this.lastSync.get(tenantId) || null;
  }
}
```

### 8. API Endpoints

```typescript
// Integration controller
@Controller('v1/integration')
class IntegrationController {
  
  @Post('sync')                    // Trigger full sync now
  sync(@Headers('X-Tenant-Id') tenantId: string) { ... }
  
  @Post('sync/partial')            // Sync specific entities only
  syncPartial(@Body() body: { entities: string[] }) { ... }
  
  @Get('sync/status')              // Last sync result + next scheduled
  syncStatus(@Headers('X-Tenant-Id') tenantId: string) { ... }
  
  @Post('connection/test')         // Test adapter connectivity
  testConnection(@Headers('X-Tenant-Id') tenantId: string) { ... }
  
  @Post('mapping/test')            // Transform sample data, return preview
  testMapping(@Body() body: { sampleData: RawRecord[], entity: string }) { ... }
  
  @Get('mapping/profile')          // Get current mapping profile
  getMappingProfile(@Headers('X-Tenant-Id') tenantId: string) { ... }
  
  @Put('mapping/profile')          // Update mapping profile
  updateMappingProfile(@Body() profile: MappingProfile) { ... }
}
```

### 9. Scheduled Sync (background)

```typescript
// Cron-based sync for tenants with interval schedules
@Injectable()
class SyncScheduler {
  @Cron('*/5 * * * *')  // Check every 5 minutes
  async checkSyncSchedules() {
    for (const tenant of this.configService.getAllTenants()) {
      const config = this.configService.getAdapterConfig(tenant.id);
      if (config.schedule.mode !== "interval") continue;
      
      const lastSync = this.syncService.getLastSync(tenant.id);
      const intervalMs = config.schedule.intervalMinutes * 60 * 1000;
      
      if (!lastSync || Date.now() - new Date(lastSync.syncedAt).getTime() > intervalMs) {
        await this.syncService.sync(tenant.id);
      }
    }
  }
}
```

---

## Migration Path

### Phase 1 (this sprint): Interface + FileAdapter refactor
- Define `IDataAdapter` interface and `RawDataSet` type
- Refactor current `stateService.syncFromConfig()` into a `FileAdapter`
- Introduce `MappingEngine` with identity mapping (pass-through for current flat files)
- Wire `SyncService` into `CTPService` — `syncFromConfig()` delegates to `SyncService.sync()`
- **Zero behavioral change** — existing tenants keep working exactly as before
- All 5 existing tenants verified (Willoughby, Acme, HRMD, Stafford, Summit)

### Phase 2: REST adapter + Genius connector
- Implement `RestAdapter` with retry, timeout, auth
- Build Genius-specific response parsing (`{ "Result": [...] }` unwrapping)
- Create Stafford's `adapter.json` and `mapping.json` configs
- Implement mapping transforms: `toUTC`, `concat`, `lookup`, `durationCalc`, `deriveWipState`, `deriveCommitment`, `hoursToSeconds`
- Test with live Genius API

### Phase 3: Sync scheduling + API endpoints
- Integration controller with sync/test/status/mapping endpoints
- `SyncScheduler` for interval-based background sync
- Sync status in UI (last synced timestamp, next sync, errors)
- `POST /v1/integration/mapping/test` for validating mappings with sample data

### Future phases
- CSV upload adapter (import wizard UI)
- Push adapter (webhook receiver for real-time events)
- Incremental sync (diff-based, only changed records)
- WIP-specific sync (lighter weight, more frequent — just task progress + resource status)
- Bi-directional results mapping (CTP results → tenant's ERP terms)

---

## Stafford-Specific Implementation Notes

### Genius API Response Format
All Genius endpoints return: `{ "Result": [...], "Messages": [...], "PagingInfos": { ... } }`
The adapter must unwrap `Result` and handle pagination if `TotalPagesFound > 1`.

### Endpoint Filters
- Open orders only: `filter=WoStatusCode!="CLOSED"`
- Active machines only: `filter=Active=true`
- Tasks for specific work order: `filter=WorkOrderCode="23898"`
- Pagination: `limit=100&pageIndex=1`

### Authentication
Genius uses basic auth or API key. Store credentials in Azure Key Vault, reference via `credentialsRef` in adapter config.

### Join Logic
Orders require joining `salesOrderDetailEntity` (delivery dates, customer info) with `workOrderWithAdvancedInformationViewEntity` (planned qty, product) on `JobCode = Job`.

### Timezone
All Genius dates are NZ local time (+12:00 or +13:00 NZST/NZDT). Mapping profile converts to UTC via the `toUTC` transform.

---

## Files Changed

| File | Change |
|------|--------|
| `Integration/adapter.ts` | **NEW** — IDataAdapter interface, RawDataSet type, AdapterError |
| `Integration/file-adapter.ts` | **NEW** — FileAdapter (refactor of current file loading) |
| `Integration/rest-adapter.ts` | **NEW** — RestAdapter (generic, config-driven REST client) |
| `Integration/mapping-engine.ts` | **NEW** — MappingEngine (applies mapping profile to raw data) |
| `Integration/adapter-factory.ts` | **NEW** — DataAdapterFactory + registry |
| `Integration/sync.service.ts` | **NEW** — SyncService (orchestrates fetch → transform → hydrate) |
| `Integration/sync.scheduler.ts` | **NEW** — SyncScheduler (cron-based background sync) |
| `Integration/integration.controller.ts` | **NEW** — API endpoints for sync, test, mapping |
| `state/state.service.ts` | **MODIFIED** — `syncFromConfig()` delegates to SyncService |
| `ctp/ctp.service.ts` | **MODIFIED** — inject SyncService, use for data refresh |
| `config/tenants/{tenant}/adapter.json` | **NEW** — per-tenant adapter configuration |
| `config/tenants/{tenant}/mapping.json` | **NEW** — per-tenant field mapping profile |

---

## Testing Scenarios

| # | Scenario | What to verify |
|---|----------|----------------|
| 1 | FileAdapter round-trip | Existing tenants load identically through new adapter path |
| 2 | RestAdapter connection test | `testConnection()` reaches Genius API, returns latency |
| 3 | RestAdapter fetch | Full fetch from Genius API, correct record counts |
| 4 | Genius response unwrap | `{ "Result": [...] }` correctly extracted |
| 5 | Pagination handling | Endpoints with >1 page fetch all pages |
| 6 | Join logic | Sales orders + work orders joined correctly on JobCode |
| 7 | Mapping — direct fields | `Code` → `key`, `Description1` → `name` |
| 8 | Mapping — concat | `SalesOrderNo + ProductDescription1` → `name` |
| 9 | Mapping — lookup | `Strategy: "JIT"` → `priority: 30` |
| 10 | Mapping — duration calc | CycleTime × Qty via UOM table → seconds |
| 11 | Mapping — date conversion | NZ local time → UTC |
| 12 | Mapping — wipState derivation | IsCompleted + dates → correct state |
| 13 | Mapping — commitment level | IsSchedulingLocked → Pinned/Dispatched |
| 14 | Partial failure | One entity endpoint fails, others still load |
| 15 | Retry logic | Transient failure → retry → success on attempt 2 |
| 16 | Auth failure | Bad credentials → clear error, no data loss |
| 17 | Mapping validation | Missing required field → AdapterError in metadata |
| 18 | Scheduled sync | Interval-based sync fires on schedule |
| 19 | On-demand sync | `POST /v1/integration/sync` triggers immediate sync |
| 20 | Mapping test endpoint | Sample data + mapping → preview of transformed output |

---

*This sprint bridges the gap between "demo-ready flat files" and "production-ready API integration." The adapter abstraction means we build the infrastructure once and every future ERP connector is just a new adapter config + mapping profile — not new code.*
