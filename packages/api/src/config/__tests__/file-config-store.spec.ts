import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileConfigStore } from '../file-config-store';
import {
  IEntitySchema,
  IResourceData,
  ITaskData,
  ITenantConfig,
  IScoringConfig,
  ISettingsConfig,
  IKPIDefinition,
  ITerminologyMap,
  ICalendarData,
  IStateChangeData,
  IHorizonConfig,
} from '../interfaces/config-store.interface';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctp-config-test-'));
}

function writeSampleTenant(tenantDir: string): void {
  fs.mkdirSync(tenantDir, { recursive: true });

  const tenant: ITenantConfig = {
    tenantId: 'test-tenant',
    name: 'Test Tenant',
    vertical: 'manufacturing',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  fs.writeFileSync(path.join(tenantDir, 'tenant.json'), JSON.stringify(tenant));

  // Schema
  const schemasDir = path.join(tenantDir, 'schemas');
  fs.mkdirSync(schemasDir, { recursive: true });
  const taskSchema: IEntitySchema = {
    entityType: 'task',
    version: 1,
    attributes: [
      {
        name: 'priority',
        displayName: 'Priority',
        dataType: 'enum',
        required: true,
        validation: { allowedValues: ['LOW', 'HIGH'] },
        category: 'scheduling',
        sequence: 1,
        searchable: true,
        sortable: true,
        useInScheduling: true,
        useInScoring: false,
      },
    ],
  };
  fs.writeFileSync(
    path.join(schemasDir, 'task.schema.json'),
    JSON.stringify(taskSchema),
  );

  // Horizon
  const horizon: IHorizonConfig = {
    startDate: '2026-02-10T00:00:00Z',
    endDate: '2026-02-24T00:00:00Z',
  };
  fs.writeFileSync(path.join(tenantDir, 'horizon.json'), JSON.stringify(horizon));

  // Scoring
  const scoring: IScoringConfig = {
    name: 'Default',
    key: 'default',
    rules: [{ ruleName: 'EST', weight: 1.0, objective: 0, includeInSolve: true, penaltyFactor: 0 }],
  };
  fs.writeFileSync(path.join(tenantDir, 'scoring.json'), JSON.stringify(scoring));

  // Settings
  const settings: ISettingsConfig = {
    flowAround: false,
    maxLateness: 0,
    tasksPerLoop: 50,
    topTasksToSchedule: 2,
    resetUsageAfterProcessChange: true,
    scheduleDirection: 1,
    requiresPreds: false,
  };
  fs.writeFileSync(path.join(tenantDir, 'settings.json'), JSON.stringify(settings));

  // Terminology
  const terminology: ITerminologyMap = { mappings: { resource: 'Machine' } };
  fs.writeFileSync(path.join(tenantDir, 'terminology.json'), JSON.stringify(terminology));

  // KPIs
  const kpisDir = path.join(tenantDir, 'kpis');
  fs.mkdirSync(kpisDir, { recursive: true });
  const kpis: IKPIDefinition[] = [
    {
      name: 'makespan',
      displayName: 'Makespan',
      description: 'Total time',
      computationType: 'built-in',
      sourceEntity: 'schedule',
      objective: 'minimize',
      unit: 'hours',
      format: '0.1f',
      visualizationType: 'gauge',
      category: 'efficiency',
      sequence: 1,
    },
  ];
  fs.writeFileSync(path.join(kpisDir, 'kpis.json'), JSON.stringify(kpis));

  // Data
  const dataDir = path.join(tenantDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const resources: IResourceData[] = [
    { key: 'R1', name: 'Resource 1', type: 'CNC', class: 'REUSABLE' },
    { key: 'R2', name: 'Resource 2', type: 'Assembly', class: 'REUSABLE' },
  ];
  fs.writeFileSync(path.join(dataDir, 'resources.json'), JSON.stringify(resources));

  const tasks: ITaskData[] = [
    { key: 'T1', name: 'Task 1', durationSeconds: 3600 },
    { key: 'T2', name: 'Task 2', durationSeconds: 7200 },
  ];
  fs.writeFileSync(path.join(dataDir, 'tasks.json'), JSON.stringify(tasks));

  const calendars: ICalendarData[] = [
    { resourceKey: 'R1', intervals: [{ start: '2026-02-10T00:00:00Z', end: '2026-02-11T00:00:00Z', qty: 1 }] },
  ];
  fs.writeFileSync(path.join(dataDir, 'calendars.json'), JSON.stringify(calendars));

  const stateChanges: IStateChangeData[] = [
    { resourceType: 'CNC', type: 'PROCESS CHANGE', fromState: 'A', toState: 'B', duration: 1800 },
  ];
  fs.writeFileSync(path.join(dataDir, 'state-changes.json'), JSON.stringify(stateChanges));
}

function rmDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

describe('FileConfigStore', () => {
  let tmpDir: string;
  let tenantDir: string;
  let store: FileConfigStore;

  beforeEach(() => {
    tmpDir = createTempDir();
    tenantDir = path.join(tmpDir, 'tenants', 'test-tenant');
    writeSampleTenant(tenantDir);
    store = new FileConfigStore(tmpDir, 'test-tenant');
  });

  afterEach(() => {
    rmDir(tmpDir);
  });

  // ── Tenant ──────────────────────────────────────────────────────────

  it('getTenant() returns tenant config', () => {
    const tenant = store.getTenant();
    expect(tenant).not.toBeNull();
    expect(tenant!.tenantId).toBe('test-tenant');
    expect(tenant!.name).toBe('Test Tenant');
    expect(tenant!.vertical).toBe('manufacturing');
  });

  // ── Schema ──────────────────────────────────────────────────────────

  it('getSchema("task") returns task schema with correct attributes', () => {
    const schema = store.getSchema('task');
    expect(schema).not.toBeNull();
    expect(schema!.entityType).toBe('task');
    expect(schema!.version).toBe(1);
    expect(schema!.attributes).toHaveLength(1);
    expect(schema!.attributes[0].name).toBe('priority');
    expect(schema!.attributes[0].dataType).toBe('enum');
  });

  it('getSchema("nonexistent") returns null', () => {
    const schema = store.getSchema('nonexistent');
    expect(schema).toBeNull();
  });

  // ── Resources ───────────────────────────────────────────────────────

  it('getResources() returns array of resources', () => {
    const resources = store.getResources();
    expect(resources).toHaveLength(2);
    expect(resources[0].key).toBe('R1');
    expect(resources[1].key).toBe('R2');
  });

  // ── Tasks ───────────────────────────────────────────────────────────

  it('getTasks() returns array of tasks', () => {
    const tasks = store.getTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0].key).toBe('T1');
    expect(tasks[0].durationSeconds).toBe(3600);
  });

  // ── Save and re-read ───────────────────────────────────────────────

  it('saveResources() writes to disk and re-reading returns saved data', () => {
    const newResources: IResourceData[] = [
      { key: 'R3', name: 'Resource 3', type: 'QC', class: 'REUSABLE' },
    ];
    store.saveResources(newResources);
    store.reload();

    const resources = store.getResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].key).toBe('R3');
    expect(resources[0].name).toBe('Resource 3');
  });

  it('saveSchema() writes and creates directories if needed', () => {
    // Save a new schema type that doesn't exist yet
    const orderSchema: IEntitySchema = {
      entityType: 'order',
      version: 1,
      attributes: [
        {
          name: 'customer',
          displayName: 'Customer',
          dataType: 'string',
          required: true,
          category: 'general',
          sequence: 1,
          searchable: true,
          sortable: true,
          useInScheduling: false,
          useInScoring: false,
        },
      ],
    };
    store.saveSchema('order', orderSchema);
    store.reload();

    const loaded = store.getSchema('order');
    expect(loaded).not.toBeNull();
    expect(loaded!.entityType).toBe('order');
    expect(loaded!.attributes[0].name).toBe('customer');
  });

  // ── Reload ──────────────────────────────────────────────────────────

  it('reload() picks up changes written directly to files', () => {
    // Read initial tasks
    expect(store.getTasks()).toHaveLength(2);

    // Write directly to disk
    const newTasks: ITaskData[] = [
      { key: 'T1', name: 'Task 1', durationSeconds: 3600 },
      { key: 'T2', name: 'Task 2', durationSeconds: 7200 },
      { key: 'T3', name: 'Task 3', durationSeconds: 1800 },
    ];
    fs.writeFileSync(
      path.join(tenantDir, 'data', 'tasks.json'),
      JSON.stringify(newTasks),
    );

    // Before reload, should still return cached (2 tasks)
    expect(store.getTasks()).toHaveLength(2);

    // After reload, should return updated (3 tasks)
    store.reload();
    expect(store.getTasks()).toHaveLength(3);
    expect(store.getTasks()[2].key).toBe('T3');
  });

  // ── Non-existent tenant ─────────────────────────────────────────────

  it('reading from non-existent tenant returns null/empty gracefully', () => {
    const emptyStore = new FileConfigStore(tmpDir, 'nonexistent-tenant');
    expect(emptyStore.getTenant()).toBeNull();
    expect(emptyStore.getSchema('task')).toBeNull();
    expect(emptyStore.getResources()).toEqual([]);
    expect(emptyStore.getTasks()).toEqual([]);
    expect(emptyStore.getCalendars()).toEqual([]);
    expect(emptyStore.getStateChanges()).toEqual([]);
    expect(emptyStore.getKPIs()).toEqual([]);
    expect(emptyStore.getTerminology()).toEqual({ mappings: {} });
    expect(emptyStore.getScoring()).toBeNull();
    expect(emptyStore.getHorizon()).toBeNull();
  });

  // ── Other data accessors ────────────────────────────────────────────

  it('getCalendars() returns array', () => {
    const calendars = store.getCalendars();
    expect(calendars).toHaveLength(1);
    expect(calendars[0].resourceKey).toBe('R1');
  });

  it('getStateChanges() returns array', () => {
    const changes = store.getStateChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].fromState).toBe('A');
    expect(changes[0].duration).toBe(1800);
  });

  it('getKPIs() returns array', () => {
    const kpis = store.getKPIs();
    expect(kpis).toHaveLength(1);
    expect(kpis[0].name).toBe('makespan');
  });

  it('getTerminology() returns terminology map', () => {
    const term = store.getTerminology();
    expect(term.mappings.resource).toBe('Machine');
  });

  it('getScoring() returns scoring config', () => {
    const scoring = store.getScoring();
    expect(scoring).not.toBeNull();
    expect(scoring!.name).toBe('Default');
    expect(scoring!.rules).toHaveLength(1);
  });

  it('getSettings() returns settings', () => {
    const settings = store.getSettings();
    expect(settings.scheduleDirection).toBe(1);
    expect(settings.tasksPerLoop).toBe(50);
  });

  it('getHorizon() returns horizon config', () => {
    const horizon = store.getHorizon();
    expect(horizon).not.toBeNull();
    expect(horizon!.startDate).toBe('2026-02-10T00:00:00Z');
    expect(horizon!.endDate).toBe('2026-02-24T00:00:00Z');
  });

  it('getSettings() returns defaults when file missing', () => {
    const emptyStore = new FileConfigStore(tmpDir, 'nonexistent');
    const settings = emptyStore.getSettings();
    expect(settings.scheduleDirection).toBe(1);
    expect(settings.flowAround).toBe(false);
  });

  // ── Save other data types ────────────────────────────────────────────

  it('saveTasks() writes and re-reads correctly', () => {
    const newTasks: ITaskData[] = [{ key: 'TX', name: 'New Task', durationSeconds: 999 }];
    store.saveTasks(newTasks);
    store.reload();
    expect(store.getTasks()).toHaveLength(1);
    expect(store.getTasks()[0].key).toBe('TX');
  });

  it('saveCalendars() writes and re-reads correctly', () => {
    const cals: ICalendarData[] = [
      { resourceKey: 'R9', intervals: [{ start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z', qty: 1 }] },
    ];
    store.saveCalendars(cals);
    store.reload();
    expect(store.getCalendars()[0].resourceKey).toBe('R9');
  });

  it('saveStateChanges() writes and re-reads correctly', () => {
    const sc: IStateChangeData[] = [
      { resourceType: 'X', type: 'PROCESS CHANGE', fromState: 'C', toState: 'D', duration: 500 },
    ];
    store.saveStateChanges(sc);
    store.reload();
    expect(store.getStateChanges()[0].fromState).toBe('C');
  });

  it('saveKPIs() writes and re-reads correctly', () => {
    const kpis: IKPIDefinition[] = [
      {
        name: 'util',
        displayName: 'Util',
        description: 'Resource utilization',
        computationType: 'built-in',
        sourceEntity: 'resource',
        objective: 'maximize',
        unit: '%',
        format: '0.1f',
        visualizationType: 'bar',
        category: 'efficiency',
        sequence: 1,
      },
    ];
    store.saveKPIs(kpis);
    store.reload();
    expect(store.getKPIs()[0].name).toBe('util');
  });

  it('saveTerminology() writes and re-reads correctly', () => {
    const term: ITerminologyMap = { mappings: { task: 'Job' } };
    store.saveTerminology(term);
    store.reload();
    expect(store.getTerminology().mappings.task).toBe('Job');
  });

  it('saveScoring() writes and re-reads correctly', () => {
    const scoring: IScoringConfig = {
      name: 'Custom',
      key: 'custom',
      rules: [{ ruleName: 'WS', weight: 0.5, objective: 0, includeInSolve: true, penaltyFactor: 0 }],
    };
    store.saveScoring(scoring);
    store.reload();
    expect(store.getScoring()!.name).toBe('Custom');
  });

  it('saveSettings() writes and re-reads correctly', () => {
    const settings: ISettingsConfig = {
      flowAround: true,
      maxLateness: 100,
      tasksPerLoop: 25,
      topTasksToSchedule: 5,
      resetUsageAfterProcessChange: false,
      scheduleDirection: 2,
      requiresPreds: true,
    };
    store.saveSettings(settings);
    store.reload();
    const loaded = store.getSettings();
    expect(loaded.flowAround).toBe(true);
    expect(loaded.scheduleDirection).toBe(2);
    expect(loaded.requiresPreds).toBe(true);
  });
});
