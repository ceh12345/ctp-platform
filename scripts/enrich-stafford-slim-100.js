#!/usr/bin/env node
/**
 * Enrich the stafford-slim-100 tenant's data files with the new
 * WorkOrderGroup + hierarchy + attribute fields derived from a fresh
 * sync of stafford-engineering-test against the WORK7 May 8 fixture.
 *
 * Behaviour:
 *   - ADDITIVE only. Existing fields on orders/tasks are preserved.
 *     New fields (groupKey, parentOrderKey, hierarchies, attributes)
 *     are added only when absent.
 *   - workordergroups.json is created fresh (or overwritten) — it's a
 *     new file with no pre-existing curated data to preserve.
 *   - Tasks not present in the engineering data still get enriched —
 *     they reach hierarchies/attributes via their order's group, not
 *     by direct task-to-task matching.
 *
 * Run from repo root:
 *   npm run build --workspace=@ctp/api
 *   node scripts/enrich-stafford-slim-100.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'packages', 'api', 'dist', 'src');

const { StateService }          = require(path.join(distRoot, 'modules', 'state', 'state.service'));
const { StateHydratorService }  = require(path.join(distRoot, 'modules', 'state', 'state-hydrator.service'));
const { WorkOrderGroupService } = require(path.join(distRoot, 'modules', 'state', 'workordergroup.service'));
const { ConfigService }         = require(path.join(distRoot, 'config', 'config.service'));
const { FileConfigStore }       = require(path.join(distRoot, 'config', 'file-config-store'));
const { AdapterFactory }        = require(path.join(distRoot, 'modules', 'integration', 'adapter-factory'));
const { MappingEngine }         = require(path.join(distRoot, 'modules', 'integration', 'mapping-engine'));
const { SyncService }           = require(path.join(distRoot, 'modules', 'integration', 'sync.service'));

const { CTPDateTime } = require(path.join(repoRoot, 'packages', 'engine', 'dist', 'Models', 'Core', 'date'));

const CONFIG_ROOT = path.join(repoRoot, 'config');
const FIXTURE_DIR = path.join(repoRoot, 'tools', 'mock-genius', 'recorded', 'stafford-work7-2026-05-08');
const SLIM_TENANT_ID = 'stafford-slim-100';
const ENG_TENANT_ID  = 'stafford-engineering-test';

const slim100Dir         = path.join(CONFIG_ROOT, 'tenants', SLIM_TENANT_ID);
const slim100OrdersPath  = path.join(slim100Dir, 'data', 'orders.json');
const slim100TasksPath   = path.join(slim100Dir, 'data', 'tasks.json');
const slim100GroupsPath  = path.join(slim100Dir, 'data', 'workordergroups.json');

// ── Mock fetch for the stafford-engineering-test sync ────────────────

const fixtureCache = new Map();
function loadAllRecords(prefix) {
  if (fixtureCache.has(prefix)) return fixtureCache.get(prefix);
  const files = fs.readdirSync(FIXTURE_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json') && !f.startsWith('_'))
    .sort();
  const all = [];
  for (const f of files) {
    const content = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf-8'));
    if (Array.isArray(content.Result)) all.push(...content.Result);
  }
  fixtureCache.set(prefix, all);
  return all;
}

function envelope(records) {
  return {
    Result: records,
    Messages: [],
    PagingInfos: { CurrentPageIndex: 1, PageSize: records.length, TotalElementsFound: records.length, TotalPagesFound: 1 },
    Tag: null,
  };
}

global.fetch = async (url) => {
  const u = String(url);
  let recs = [];
  if      (u.includes('workOrderWithAdvancedInformationViewEntity')) recs = loadAllRecords('workOrderWithAdvancedInformationViewEntity');
  else if (u.includes('productionTaskWithAdvancedInfoViewEntity'))   recs = loadAllRecords('productionTaskWithAdvancedInfoViewEntity');
  else if (u.includes('machineAndRessourceEntity'))                  recs = loadAllRecords('machineAndRessourceEntity');
  else if (u.includes('salesOrderDetailEntity'))                     recs = loadAllRecords('salesOrderDetailEntity');
  return { ok: true, json: async () => envelope(recs) };
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert epoch seconds → ISO string. Returns null when input is null/0/undefined. */
function toIsoOrNull(seconds) {
  if (seconds == null || seconds === 0) return null;
  const iso = CTPDateTime.toDateTime(seconds).toISO();
  return iso ?? null;
}

/** Populated hierarchy entries on a group as [{slot, name, value}], skipping empties. */
function captureHierarchies(group) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const node = group.hierarchy.index(i);
    if (node?.value && node.value !== '') {
      out.push({ slot: i + 1, name: node.name, value: node.value });
    }
  }
  return out;
}

/** Attribute entries on a group as [{name, value}], skipping empties. */
function captureAttributes(group) {
  const out = [];
  group.attributes.forEach((nv) => {
    if (nv.value !== '' && nv.value != null) out.push({ name: nv.name, value: nv.value });
  });
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────

(async () => {
  console.log(`Reading slim-100's existing data files...`);
  const slim100Orders = JSON.parse(fs.readFileSync(slim100OrdersPath, 'utf-8'));
  const slim100Tasks  = JSON.parse(fs.readFileSync(slim100TasksPath,  'utf-8'));
  const slimOrderKeys = new Set(slim100Orders.map((o) => o.key));
  console.log(`  ${slim100Orders.length} orders, ${slim100Tasks.length} tasks`);

  console.log(`Syncing ${ENG_TENANT_ID} from WORK7 May 8 fixture...`);
  const engStore   = new FileConfigStore(CONFIG_ROOT, ENG_TENANT_ID);
  const engConfig  = new ConfigService(engStore);
  const engWog     = new WorkOrderGroupService(engConfig);
  const engHydr    = new StateHydratorService(engConfig, engWog);
  const engMap     = new MappingEngine();
  const engFactory = new AdapterFactory(engConfig);
  const engSync    = new SyncService(engFactory, engMap, engConfig);
  const engState   = new StateService(engHydr, engConfig, engSync);
  await engState.syncFromAdapter();
  const engLs = engState.getLandscape();
  console.log(`  ${engLs.groups.size()} groups, ${engLs.orders.size()} orders, ${engLs.tasks.size()} tasks`);

  // 1-1 verification: every slim-100 order key must resolve in engineering
  const engOrderKeys = new Set();
  engLs.orders.forEach((o) => engOrderKeys.add(o.key));
  const missing = [...slimOrderKeys].filter((k) => !engOrderKeys.has(k));
  if (missing.length > 0) {
    console.error(`ERROR: ${missing.length} slim-100 orders not found in engineering data:`);
    console.error(`  ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`  ✓ all ${slimOrderKeys.size} slim-100 orders match engineering data`);

  // Capture the touched groups from engineering — only those whose members
  // include at least one slim-100 order. Restrict workOrderKeys to just
  // slim-100's members so the file doesn't reference non-existent orders.
  const touchedGroupKeys = new Set();
  for (const slimOrder of slim100Orders) {
    const engOrder = engLs.orders.getEntity(slimOrder.key);
    if (engOrder?.groupKey) touchedGroupKeys.add(engOrder.groupKey);
  }
  console.log(`  ${touchedGroupKeys.size} groups touched by slim-100 WOs`);

  const slim100Groups = [];
  const groupByKey = new Map();
  for (const gKey of [...touchedGroupKeys].sort()) {
    const g = engLs.groups.getEntity(gKey);
    if (!g) continue;
    const slimMembers = g.workOrderKeys.filter((k) => slimOrderKeys.has(k));
    const headInSlim  = g.headWorkOrderKey && slimMembers.includes(g.headWorkOrderKey)
      ? g.headWorkOrderKey
      : null;
    const groupRec = {
      key: g.key,
      name: g.name,
      headWorkOrderKey: headInSlim,
      workOrderKeys: slimMembers,
      sourceStart: toIsoOrNull(g.sourceStart),
      sourceEnd:   toIsoOrNull(g.sourceEnd),
      promiseDate: toIsoOrNull(g.promiseDate),
      hierarchies: captureHierarchies(g),
      attributes:  captureAttributes(g),
    };
    slim100Groups.push(groupRec);
    groupByKey.set(g.key, groupRec);
  }

  // Enrich orders (additive — only add fields when absent)
  let ordersEnriched = 0;
  for (const slimOrder of slim100Orders) {
    const engOrder = engLs.orders.getEntity(slimOrder.key);
    if (!engOrder) continue;
    let changed = false;
    if (slimOrder.groupKey == null && engOrder.groupKey != null) {
      slimOrder.groupKey = engOrder.groupKey; changed = true;
    }
    if (slimOrder.parentOrderKey == null && engOrder.parentOrderKey != null) {
      slimOrder.parentOrderKey = engOrder.parentOrderKey; changed = true;
    }
    const g = groupByKey.get(slimOrder.groupKey);
    if (g) {
      if (slimOrder.hierarchies == null) { slimOrder.hierarchies = g.hierarchies; changed = true; }
      if (slimOrder.attributes  == null) { slimOrder.attributes  = g.attributes;  changed = true; }
    }
    if (changed) ordersEnriched++;
  }
  console.log(`  ${ordersEnriched} orders enriched (of ${slim100Orders.length})`);

  // Enrich tasks — reach hierarchies/attributes through their order's group
  const slimOrderByKey = new Map();
  for (const o of slim100Orders) slimOrderByKey.set(o.key, o);
  let tasksEnriched = 0;
  let tasksUnlinked = 0;
  for (const task of slim100Tasks) {
    const orderKey = task.linkId?.name;
    if (!orderKey) { tasksUnlinked++; continue; }
    const order = slimOrderByKey.get(orderKey);
    if (!order || !order.groupKey) continue;
    const g = groupByKey.get(order.groupKey);
    if (!g) continue;
    let changed = false;
    if (task.groupKey    == null) { task.groupKey    = order.groupKey; changed = true; }
    if (task.hierarchies == null) { task.hierarchies = g.hierarchies;  changed = true; }
    if (task.attributes  == null) { task.attributes  = g.attributes;   changed = true; }
    if (changed) tasksEnriched++;
  }
  console.log(`  ${tasksEnriched} tasks enriched (of ${slim100Tasks.length}; ${tasksUnlinked} unlinked tasks left untouched)`);

  // Write back
  fs.writeFileSync(slim100OrdersPath, JSON.stringify(slim100Orders, null, 2) + '\n');
  fs.writeFileSync(slim100TasksPath,  JSON.stringify(slim100Tasks,  null, 2) + '\n');
  fs.writeFileSync(slim100GroupsPath, JSON.stringify(slim100Groups, null, 2) + '\n');
  console.log(`Wrote:`);
  console.log(`  ${slim100OrdersPath} (enriched)`);
  console.log(`  ${slim100TasksPath} (enriched)`);
  console.log(`  ${slim100GroupsPath} (new)`);
})().catch((err) => { console.error(err); process.exit(1); });
