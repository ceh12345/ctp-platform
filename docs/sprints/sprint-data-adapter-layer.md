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

## Pre-Implementation Clarifications

These items came up during spec review and are documented here so the implementation matches the existing codebase conventions.

**1. Module location.** The "Integration" code is a NestJS module under `packages/api/src/modules/integration/`, matching the existing pattern (`modules/ctp/`, `modules/state/`). Inline file paths in the spec that say `Integration/foo.ts` should be read as `packages/api/src/modules/integration/foo.ts`. The integration module is registered in `app.module.ts` like any other.

**2. StateService delegation.** `StateService.syncFromConfig()`, `reload()`, and `reloadConfig()` keep their existing public signatures. Internally they delegate to `SyncService.sync(currentTenantId)`. All existing call sites (CTPService, controllers, tests) work without modification. A new `applyTransformed(transformed)` method on StateService is the seam where SyncService hands the new landscape over for atomic replacement. **Zero behavioral change is the Phase 1 acceptance gate.**

**3. ConfigService extensions.** `getAdapterConfig(tenantId)` and `getMappingProfile(tenantId)` are new methods on `ConfigService`, backed by `adapter.json` and `mapping.json` in the tenant config directory. Both return `null` when the file doesn't exist. The `FileConfigStore` learns about these two new files alongside the existing `scoring.json`, `locale.json`, etc. In Phase 1 with FileAdapter, both can return null and the system falls back to identity mapping — flat-file tenants don't need to write mapping configs to keep working.

**4. SyncScheduler is current-tenant only.** The current API runs as one process per tenant (set via `switchTenant()`). The scheduler operates on `stateService.getCurrentTenantId()`, not on a `getAllTenants()` iteration. Multi-tenant orchestration is a future sprint when the process model supports concurrent tenants. See section 9 for the scoped-down implementation.

**5. UOM table is single-instance on the landscape.** The UOM Conversion Table sprint already populates `landscape.uomTable` during landscape construction. The `MappingEngine` constructor takes that same instance — it does not create its own table or re-load `uom-conversions.json`. There is exactly one UOM table per landscape, loaded once. See the `SyncService.sync()` example in section 7.

---

## Deliverables

### 1. IDataAdapter Interface

**Location:** `packages/api/src/modules/integration/adapters/adapter.interface.ts`

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
  category: "connectivity" | "fetch" | "mapping" | "validation";
  severity: "fatal" | "error" | "warning" | "info";
  entity?: string;             // "orders", "tasks", etc.
  recordIndex?: number;        // which record in the array
  recordKey?: string;          // the source record's identifier
  field?: string;              // which field caused the issue
  message: string;
  policy?: "strict" | "skip" | "default";  // how the error was handled
  // Note: never include the full raw record \u2014 may contain sensitive data
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
  },
  "errorPolicy": {
    "partialSyncAllowed": false,
    "requiredEntities": ["orders", "tasks", "resources"],
    "abortOnValidationError": true,
    "maxRecordErrorsBeforeAbort": 100
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
      "key": { "source": "WorkOrder", "onError": "strict" },
      "name": { "source": ["SalesOrderNo", "ProductDescription1"], "transform": "concat", "separator": " — ", "onError": "default", "default": "Unnamed Order" },
      "productKey": { "source": "Product", "onError": "strict" },
      "demandQty": { "source": "QuantityPlanned", "onError": "skip" },
      "dueDate": { "source": "DeliveryDate", "transform": "toUTC", "onError": "skip" },
      "lateDueDate": { "source": "DeliveryDate", "transform": "toUTC", "onError": "default", "default": "@dueDate" },
      "priority": { "source": "Strategy", "transform": "lookup", "lookupTable": {
        "JIT": 30, "MTO": 50, "MTS": 60, "_default": 50
      }, "onError": "default", "default": 50 }
    }
  },

  "tasks": {
    "keyField": "Id",
    "mappings": {
      "key": { "source": "Id", "transform": "toString", "onError": "strict" },
      "name": { "source": ["OperationDescription", "ItemDescription1"], "transform": "concat", "separator": " — ", "onError": "default", "default": "Unnamed Task" },
      "type": { "value": "PROCESS" },
      "process": { "source": "OperationCode", "onError": "skip" },
      "sequence": { "source": "Order", "onError": "skip" },
      "durationSeconds": { 
        "source": ["CycleTime", "WoPlannedQuantity"], 
        "transform": "durationCalc",
        "timeUnit": "HR",
        "formula": "multiply_then_convert",
        "onError": "strict"
      },
      "durationQty": { "source": "WoPlannedQuantity", "onError": "skip" },
      "durationType": { "value": 0 },
      "capacityResources": {
        "transform": "buildResourceList",
        "primary": { "source": "MachineCode", "isPrimary": true, "onError": "strict" }
      },
      "linkId": {
        "name": { "source": "WorkOrderCode", "onError": "strict" },
        "type": { "transform": "chainPosition", "sequenceField": "Order" }
      },
      "wipState": {
        "transform": "deriveWipState",
        "completedField": "IsCompleted",
        "startField": "TaskStartDate",
        "endField": "TaskEndDate",
        "onError": "default", "default": "NOT_STARTED"
      },
      "commitmentLevel": {
        "transform": "deriveCommitment",
        "lockedField": "IsSchedulingLocked",
        "completedField": "IsCompleted",
        "startField": "TaskStartDate",
        "onError": "default", "default": "PLANNED"
      },
      "lagSeconds": { "source": "LagHours", "transform": "hoursToSeconds", "onError": "default", "default": 0 }
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
    //    Use the landscape's existing UOM table — it was populated during
    //    landscape construction by the UOM sprint. Single source of truth.
    const landscape = this.stateService.getLandscape();
    const mappingEngine = new MappingEngine(mappingProfile, landscape.uomTable);
    const transformed = mappingEngine.transform(raw);
    
    // 3. Hydrate landscape (replaces in-place; never partial overwrite)
    this.stateService.applyTransformed(transformed);
    
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

The current CTP API runs as one process per tenant — the active tenant is set via `switchTenant()` and there's no concept of iterating across all tenants in a single process. The scheduler operates on the **current tenant only**. Multi-tenant orchestration is deferred to a future sprint when the process model supports it (likely when CTP moves to a true multi-tenant API gateway in Azure).

```typescript
// Cron-based sync for the current tenant
@Injectable()
class SyncScheduler {
  constructor(
    private readonly stateService: StateService,
    private readonly configService: ConfigService,
    private readonly syncService: SyncService,
  ) {}

  @Cron('*/5 * * * *')  // Check every 5 minutes
  async checkSyncSchedule() {
    const tenantId = this.stateService.getCurrentTenantId();
    if (!tenantId) return;  // No tenant active, nothing to sync

    const config = this.configService.getAdapterConfig(tenantId);
    if (!config || config.schedule?.mode !== "interval") return;

    const lastSync = this.syncService.getLastSync(tenantId);
    const intervalMs = config.schedule.intervalMinutes * 60 * 1000;

    if (!lastSync || Date.now() - new Date(lastSync.syncedAt).getTime() > intervalMs) {
      await this.syncService.sync(tenantId);
    }
  }
}
```

**Multi-tenant deferred:** A `getAllTenants()` iteration loop is intentionally not in scope. When the architecture moves to true multi-tenant (one process serving many tenants concurrently), the scheduler will need to be redesigned with per-tenant scheduling state, fairness, and concurrency limits. That's a separate sprint.

### 10. Error Handling

The adapter and mapping pipeline encounters failures at five distinct levels. Each level has its own response policy. The overarching principle is **never partially overwrite the landscape** \u2014 if a sync cannot complete successfully, the previous landscape state is preserved and the planner sees stale-but-valid data rather than a half-updated mess.

#### Failure modes

**Level 1 \u2014 Source unreachable.** Network down, VPN dropped, Genius API offline, auth failed. Nothing to transform. The sync fails entirely. The landscape is unchanged. The result reports `status: "failed"` with a fatal connectivity error.

**Level 2 \u2014 Bad response from one or more endpoints.** 5xx errors, timeouts, rate limits, malformed JSON. The adapter retries internally (3 attempts with exponential backoff per the existing config). After exhausting retries, the entity fetch contributes a fetch error to the metadata. Whether this aborts the whole sync depends on the tenant\u2019s `errorPolicy.partialSyncAllowed` setting.

**Level 3 \u2014 Bad data in a record.** The endpoint returned 200, JSON parsed, but record #47 has a null `MachineCode` and the mapping requires it. Per-field policy applies (strict / skip / default \u2014 see below).

**Level 4 \u2014 Validation errors.** Mapping succeeded but produced data that violates a CTP invariant: a task references a resource that doesn\u2019t exist, a chain has a cycle, `lateDueDate` precedes `dueDate`, duration is zero or negative. These mean the source data is internally inconsistent or the mapping is wrong. Default behavior: abort the sync. Configurable via `errorPolicy.abortOnValidationError`.

**Level 5 \u2014 Sync succeeded but the schedule is wrong.** Not technically an error in the pipeline, but worth mentioning. A transform produced 9 seconds instead of 9000 because the unit was misidentified. There\u2019s no automated detection \u2014 the defense is observability (every sync stored, every transform logged) and the existing diagnostic tools (bottleneck display, AI diagnose).

#### Per-field error policies

The mapping profile attaches an `onError` policy to every field. Three options:

| Policy | Behavior | When to Use |
|--------|----------|-------------|
| **strict** | Record fails to map \u2192 entire sync aborts. Landscape unchanged. | Structurally critical fields where the record is meaningless without them. |
| **skip** | Record fails to map \u2192 record is dropped, error logged, sync continues with the remaining records. | Default for most fields. Bad rows shouldn\u2019t kill the whole sync. |
| **default** | Field fails to obtain or transform \u2192 substitute a configured default value, log a warning, continue processing the record. | Fields with a clear business default (priority, scrap rate, lag). |

**Recommended distribution: Skip is the default. Strict and default are exceptions.**

The bar for **strict** is high: only fields where the record cannot exist in the model without them. There\u2019s no sensible "skip and continue" because the record has no identity or no schedulability.

| Strict fields | Why |
|---------------|-----|
| `key` (any entity) | No key = no way to reference the record |
| `productKey` (orders) | Orphan order \u2014 nothing to schedule |
| `resource` (task primary capacityResource) | Can\u2019t schedule a task with no resource |
| `linkId.name` (when chained) | Broken chain integrity |
| `durationSeconds` (tasks) | Solver breaks on zero or missing duration |

The bar for **default** is also high: only fields with a clear, defensible business default. Defaults make missing data invisible \u2014 use them sparingly so problems get surfaced rather than silently masked.

| Default fields | Default value | Reasoning |
|----------------|---------------|-----------|
| `name` (any entity) | "Unnamed" | Display-only, not schedule-affecting |
| `priority` | 50 (normal) | Sensible neutral for unprioritized work |
| `lateDueDate` | equals `dueDate` | "No late tolerance" is the safe default |
| `outputScrapRate` | 0 | "No scrap" is the assumption when unspecified |
| `lagSeconds` | 0 | "No inter-task gap" is the default |
| `wipState` | "NOT_STARTED" | New tasks default to not started |
| `commitmentLevel` | "PLANNED" | New tasks default to planned, not committed |

**Everything else is skip.** The dropped record shows up in the result\u2019s `recordCounts.skipped` and the planner can investigate.

The test for "is this a good default field": would a reasonable person looking at the missing data say "yeah, that means normal priority" or would they say "wait, why is this missing"? If it\u2019s the second one, use skip not default.

#### Per-tenant error policy

The `adapter.json` file defines tenant-level policies that apply across all entities:

```json
"errorPolicy": {
  "partialSyncAllowed": false,
  "requiredEntities": ["orders", "tasks", "resources"],
  "abortOnValidationError": true,
  "maxRecordErrorsBeforeAbort": 100
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `partialSyncAllowed` | `false` | If `false`, any entity-level fetch failure aborts the entire sync. If `true`, the sync proceeds with whatever entities loaded successfully \u2014 but only if all `requiredEntities` are present. |
| `requiredEntities` | `["orders", "tasks", "resources"]` | Entities that must be present for the sync to be considered usable. A sync without resources can\u2019t produce a schedule. |
| `abortOnValidationError` | `true` | If `true`, any post-mapping validation failure aborts the sync. If `false`, validation errors become warnings and the partial landscape is applied. Recommended: keep `true`. |
| `maxRecordErrorsBeforeAbort` | `100` | If more than this many records fail mapping with skip policy, abort the entire sync. Protects against scenarios where a schema change causes everything to fail silently. |

**For Stafford and most beta clients, use the defaults.** Defaults favor consistency (no half-baked schedules) over availability. High-volume production tenants with separate WIP and master-data feeds may want to enable `partialSyncAllowed` so a temporary master-data outage doesn\u2019t block WIP updates.

#### SyncResult structure

Every sync produces a structured result that captures what happened:

```typescript
interface SyncResult {
  tenantId: string;
  syncedAt: string;
  durationMs: number;
  
  status: "success" | "partial" | "failed";
  
  recordCounts: {
    fetched: Record<string, number>;     // { orders: 15, tasks: 100, resources: 28 }
    transformed: Record<string, number>; // { orders: 15, tasks: 98, resources: 28 }
    skipped: Record<string, number>;     // { orders: 0, tasks: 2, resources: 0 }
  };
  
  errors: AdapterError[];   // Fatal and error-severity issues
  warnings: AdapterError[]; // Warning and info-severity issues
  
  landscapeApplied: boolean;     // Did the new state actually replace the old?
  previousSyncAt: string | null; // When was the last successful sync?
}
```

The `landscapeApplied` flag is critical. If `true`, the landscape was updated and the planner is looking at fresh data. If `false`, the landscape is unchanged from the previous sync \u2014 the planner is looking at stale data and the UI should show how stale it is.

Status values:
- **success** \u2014 all entities loaded, all records mapped (or skipped within tolerance), validation passed, landscape applied.
- **partial** \u2014 only possible when `partialSyncAllowed: true`. Some entities failed but `requiredEntities` were present and the partial landscape was applied.
- **failed** \u2014 sync did not complete. Landscape unchanged. Errors describe why.

#### Sensitive data in error logs

Records may contain customer names, prices, internal codes, and other sensitive data. **Never log entire raw records.** Log identifiers and field names, not values:

```typescript
// \u274c WRONG \u2014 leaks customer data into logs
logger.warn(`Failed to map task: ${JSON.stringify(rawTask)}`);

// \u2705 RIGHT \u2014 actionable without leaking
logger.warn(`Failed to map task ${rawTask.Id}: field 'CycleTime' is null`);
```

The `AdapterError` type includes `recordKey` (the source identifier) and `field` (the failing field) but **not** the field value or the full record. If a debugger needs to see the raw record, they fetch it from the source directly using the record key.

For sensitive fields specifically, the mapping profile can mark them as such:

```json
"customerName": { "source": "CustomerName", "sensitive": true }
```

When a sensitive field fails, the error log records "field failed" without including the field name in case the field name itself reveals sensitive context.

#### Recovery and retry

The adapter\u2019s built-in retry policy handles transient network failures during fetch. Beyond that, the sync layer does not retry automatically \u2014 retries at the sync level just compound latency without adding value. The scheduled sync will try again on the next interval.

For tenants on a 15-minute sync schedule, a transient failure means at most 30 minutes of stale data (the failed sync plus waiting for the next one). For on-demand syncs, the planner sees the failure immediately and can retry manually.

If a tenant needs more aggressive retry behavior (financial systems with strict freshness SLAs, for example), it can be added later with a separate retry queue and dead-letter handling. Not needed for the initial implementation.

#### Error visibility in the UI

The UI surfaces sync errors prominently:

- **Last sync timestamp** \u2014 always shown ("Synced 4 minutes ago" or "Last sync: 2 hours ago, failed")
- **Stale data warning** \u2014 banner when `landscapeApplied: false`, showing how old the current landscape is
- **Error drill-down** \u2014 click the sync status to see the full error list with record-level detail
- **Skipped record count** \u2014 visible in the sync history so planners notice when records start being dropped consistently

The first question a planner asks when something looks wrong is "when did we last sync?" The second is "did anything fail in the last sync?" Both should be answerable from the UI in two clicks.

---

## Migration Path

### Phase 1 (this sprint): Interface + FileAdapter refactor

**Goal: zero behavioral change.** Existing tenants and existing call sites work identically after the refactor.

- Create the `integration` NestJS module under `packages/api/src/modules/integration/`
- Define `IDataAdapter` interface, `RawDataSet`, `AdapterError` types
- Implement `FileAdapter` reading the same JSON files `stateService.syncFromConfig()` reads today
- Implement `MappingEngine` with **identity mapping** for Phase 1 — when no `mapping.json` exists, pass raw records straight through to CTP entity constructors. This is what makes flat-file tenants keep working without writing mapping configs.
- Implement `SyncService.sync(tenantId)` orchestrating fetch → identity map → hydrate
- Add `applyTransformed(transformed)` to `StateService` — it replaces the landscape atomically (never partial). The new landscape replaces the old one only after a fully successful build.
- Refactor `StateService.syncFromConfig()`, `reload()`, `reloadConfig()` to delegate internally to `SyncService.sync()`. **Public signatures unchanged.** All existing callers (CTPService, controllers, tests) continue to work without modification.
- Add `getAdapterConfig(tenantId)` and `getMappingProfile(tenantId)` to `ConfigService`. Both return `null` if the file doesn't exist. `FileConfigStore` learns about `adapter.json` and `mapping.json`.
- **Verification gate:** all 5 existing tenants (Willoughby, Acme, HRMD, Stafford, Summit) load identically. All existing engine and API tests pass with no changes. `ctpService.solve()` produces identical results pre- and post-refactor.

### Phase 2: REST adapter + Genius connector
- Implement `RestAdapter` with retry, timeout, auth
- Build Genius-specific response parsing (`{ "Result": [...] }` unwrapping)
- Create Stafford's `adapter.json` and `mapping.json` configs
- Implement mapping transforms: `toUTC`, `concat`, `lookup`, `durationCalc`, `deriveWipState`, `deriveCommitment`, `hoursToSeconds`
- Implement the per-field error policies (strict / skip / default)
- Test with live Genius API via VPN, then via the mock-genius server for CI

### Phase 3: Sync scheduling + API endpoints
- Integration controller with sync/test/status/mapping endpoints
- `SyncScheduler` for **current-tenant** interval-based background sync (multi-tenant scheduling deferred — see section 9)
- Sync status in UI (last synced timestamp, next sync, errors, `landscapeApplied` flag)
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

All new files live under `packages/api/src/modules/integration/` as a NestJS module, matching the existing structure (`modules/ctp/`, `modules/state/`, etc.). The integration module is registered in `app.module.ts` like any other.

| File | Change |
|------|--------|
| `packages/api/src/modules/integration/integration.module.ts` | **NEW** — NestJS module registering services + controller |
| `packages/api/src/modules/integration/integration.controller.ts` | **NEW** — API endpoints for sync, test, mapping |
| `packages/api/src/modules/integration/sync.service.ts` | **NEW** — SyncService (orchestrates fetch → transform → hydrate) |
| `packages/api/src/modules/integration/sync.scheduler.ts` | **NEW** — SyncScheduler (current-tenant cron) |
| `packages/api/src/modules/integration/adapters/adapter.interface.ts` | **NEW** — IDataAdapter interface, RawDataSet, AdapterError types |
| `packages/api/src/modules/integration/adapters/file.adapter.ts` | **NEW** — FileAdapter (refactor of current file loading) |
| `packages/api/src/modules/integration/adapters/rest.adapter.ts` | **NEW** — RestAdapter (generic, config-driven REST client) |
| `packages/api/src/modules/integration/adapters/adapter.factory.ts` | **NEW** — DataAdapterFactory + registry |
| `packages/api/src/modules/integration/mapping/mapping-engine.ts` | **NEW** — MappingEngine (applies mapping profile to raw data) |
| `packages/api/src/modules/integration/mapping/mapping-profile.types.ts` | **NEW** — Type definitions for mapping profile config |
| `packages/api/src/modules/state/state.service.ts` | **MODIFIED** — `syncFromConfig()`, `reload()`, `reloadConfig()` keep their public signatures but internally delegate to `SyncService.sync(currentTenantId)`. New `applyTransformed()` method that the SyncService calls to replace the landscape atomically (never partial overwrite). |
| `packages/api/src/config/config.service.ts` | **MODIFIED** — Add `getAdapterConfig(tenantId)` and `getMappingProfile(tenantId)` methods. Both read from the tenant config directory using the same pattern as existing config readers. Return `null` if the file doesn't exist. |
| `packages/api/src/config/file-config-store.ts` | **MODIFIED** — Add `adapter.json` and `mapping.json` to the list of files loaded for each tenant. |
| `packages/api/src/modules/ctp/ctp.service.ts` | **MODIFIED** — No direct changes if StateService delegates internally; double-check `solve()` still calls `stateService.syncFromConfig()` and gets the same behavior. |
| `packages/api/src/app.module.ts` | **MODIFIED** — Register IntegrationModule. |
| `config/tenants/{tenant}/adapter.json` | **NEW** — per-tenant adapter configuration. Optional for FileAdapter tenants (sensible defaults if missing). |
| `config/tenants/{tenant}/mapping.json` | **NEW** — per-tenant field mapping profile. Optional for FileAdapter tenants in Phase 1 (identity mapping if missing). |

### Key principle: zero behavioral change in Phase 1

After Phase 1 lands, all existing tests must pass and all 5 existing tenants must load identically. The refactor is a structural change, not a behavioral one. Specifically verify:

- `stateService.syncFromConfig()` returns the same landscape as before
- `stateService.reload()` and `reloadConfig()` work unchanged
- `ctpService.solve()` produces identical solve results
- All existing call sites from controllers, scheduled jobs, and tests work without modification
- The `MappingEngine` in Phase 1 uses an identity-mapping profile when no `mapping.json` exists, so flat-file tenants don't need a mapping config to keep working


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

### Error handling tests

| # | Scenario | What to verify |
|---|----------|----------------|
| 21 | Connectivity failure | Source unreachable → status `failed`, `landscapeApplied: false`, previous landscape preserved |
| 22 | Strict policy | Field with `onError: "strict"` is null → entire sync aborts, landscape unchanged |
| 23 | Skip policy | Field with `onError: "skip"` is null → record dropped, sync continues, count in `skipped` |
| 24 | Default policy | Field with `onError: "default"` is null → default substituted, warning logged |
| 25 | Default `@dueDate` reference | `lateDueDate` missing → falls back to `dueDate` value from same record |
| 26 | maxRecordErrorsBeforeAbort | More than configured threshold of skip errors → sync aborts |
| 27 | Validation error — orphan resource | Task references non-existent resource → sync fails with validation error |
| 28 | Validation error — chain cycle | Tasks form a cycle in linkId graph → sync fails with validation error |
| 29 | Validation error — late before due | `lateDueDate < dueDate` → sync fails with validation error |
| 30 | partialSyncAllowed: false | Tasks endpoint fails, orders/resources succeed → sync aborts (default behavior) |
| 31 | partialSyncAllowed: true with required missing | Resources endpoint fails (required) → sync still aborts |
| 32 | partialSyncAllowed: true with non-required missing | Calendars endpoint fails (not required) → sync proceeds, status `partial` |
| 33 | Sensitive data not in logs | Failed mapping for record with sensitive fields → log contains record key only, not field values |
| 34 | landscapeApplied flag accuracy | Failed sync → flag is `false`. Successful sync → flag is `true`. UI shows stale-data banner correctly. |
| 35 | Error count caps | Skipped record errors → only first N stored in result (avoid unbounded growth on bad data dumps) |
| 36 | Previous sync timestamp | After failed sync → `previousSyncAt` reflects last successful sync, not the failed attempt |

---

*This sprint bridges the gap between "demo-ready flat files" and "production-ready API integration." The adapter abstraction means we build the infrastructure once and every future ERP connector is just a new adapter config + mapping profile — not new code.*
