#!/usr/bin/env node
/*
 * scripts/dump-ctp-shape.js
 *
 * Runs the tenant's REST adapter + MappingEngine and writes the post-mapping
 * CTP-shape data to that tenant's config/.../data/ folder. Includes the
 * denormalised hierarchies/attributes/groupKey that the file-tenant hydrator
 * expects to find on disk.
 *
 * Use:
 *   node scripts/dump-ctp-shape.js [tenant]
 *
 * Default tenant: stafford-engineering-test
 *
 * Prereqs:
 *   - packages/api is built (npm run build --workspace=@ctp/api)
 *   - The tenant's adapter is reachable (e.g. mock-genius on :8080 for
 *     stafford-engineering-test)
 *
 * Overwrites: orders.json, tasks.json, resources.json, workordergroups.json.
 * Leaves calendars/processes/products/materials/state-changes/uom-conversions
 * alone — those come from disk, not the adapter.
 */
const path = require('path');
const fs   = require('fs');

const TENANT_ID    = process.argv[2] || 'stafford-engineering-test';
const REPO_ROOT    = path.resolve(__dirname, '..');
const CONFIG_ROOT  = path.join(REPO_ROOT, 'config');
const OUT_DIR      = path.join(CONFIG_ROOT, 'tenants', TENANT_ID, 'data');
const API_DIST     = path.join(REPO_ROOT, 'packages', 'api', 'dist', 'src');

if (!fs.existsSync(API_DIST)) {
  console.error(`API dist not found at ${API_DIST} — run "npm run build --workspace=@ctp/api" first.`);
  process.exit(1);
}
if (!fs.existsSync(OUT_DIR)) {
  console.error(`Output dir not found: ${OUT_DIR}`);
  process.exit(1);
}

const { FileConfigStore } = require(path.join(API_DIST, 'config', 'file-config-store'));
const { ConfigService }   = require(path.join(API_DIST, 'config', 'config.service'));
const { AdapterFactory }  = require(path.join(API_DIST, 'modules', 'integration', 'adapter-factory'));
const { MappingEngine }   = require(path.join(API_DIST, 'modules', 'integration', 'mapping-engine'));
const { SyncService }     = require(path.join(API_DIST, 'modules', 'integration', 'sync.service'));

// Internal scratch fields the mapping engine writes for scalar-merge into
// hierarchies/attributes. Underscore-prefix is the convention. Strip before
// persisting — they're implementation detail of the mapping pass.
const SCRATCH_KEY_PREFIX = '_';

function stripScratchFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith(SCRATCH_KEY_PREFIX)) continue;
    out[k] = v;
  }
  return out;
}

async function main() {
  console.log(`Tenant: ${TENANT_ID}`);
  console.log(`Output: ${OUT_DIR}`);
  console.log('Running sync (RestAdapter → MappingEngine)...');

  const store          = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService  = new ConfigService(store);
  const mappingEngine  = new MappingEngine();
  const adapterFactory = new AdapterFactory(configService);
  const syncService    = new SyncService(adapterFactory, mappingEngine, configService);

  const t0 = Date.now();
  const result = await syncService.sync();
  const syncMs = Date.now() - t0;

  if (result.errors && result.errors.length > 0) {
    console.error(`Mapping produced ${result.errors.length} errors:`);
    for (const e of result.errors.slice(0, 5)) console.error(' ', e);
    process.exit(1);
  }

  console.log(`  sync+map ${syncMs}ms — ${result.payload.orders.length} orders / ${result.payload.tasks.length} tasks / ${result.payload.resources.length} resources / ${result.workOrderGroups.length} groups`);

  // ── Enrich groups: strip scratch fields, derive head+memberKeys ──────
  console.log('Enriching groups (headWorkOrderKey, workOrderKeys)...');
  const orders    = result.payload.orders;
  const tasks     = result.payload.tasks;
  const resources = result.payload.resources;
  const rawGroups = result.workOrderGroups;

  // Build group → member-order index
  const ordersByGroup = new Map();
  for (const o of orders) {
    if (!o.groupKey) continue;
    if (!ordersByGroup.has(o.groupKey)) ordersByGroup.set(o.groupKey, []);
    ordersByGroup.get(o.groupKey).push(o);
  }

  const enrichedGroups = [];
  const groupByKey = new Map();
  for (const rawG of rawGroups) {
    const g = stripScratchFields(rawG);
    const members = ordersByGroup.get(g.key) || [];
    g.workOrderKeys = members.map(o => o.key).sort();
    // Head WO = the member order whose parentOrderKey === self (Stafford
    // convention; matches WO normalization design in SPRINT-workordergroup-entity).
    const head = members.find(o => o.parentOrderKey === o.key);
    g.headWorkOrderKey = head ? head.key : null;
    enrichedGroups.push(g);
    groupByKey.set(g.key, g);
  }

  // ── Enrich orders: stamp hierarchies + attributes from group ─────────
  console.log('Enriching orders (hierarchies, attributes from group)...');
  let ordersStamped = 0;
  for (const o of orders) {
    const g = groupByKey.get(o.groupKey);
    if (!g) continue;
    o.hierarchies = g.hierarchies;
    o.attributes  = g.attributes;
    ordersStamped++;
  }

  // ── Enrich tasks: stamp groupKey + hierarchies + attributes via order ──
  console.log('Enriching tasks (groupKey, hierarchies, attributes via linkId)...');
  const orderByKey = new Map();
  for (const o of orders) orderByKey.set(o.key, o);
  let tasksStamped = 0;
  let tasksUnlinked = 0;
  for (const t of tasks) {
    const orderKey = t.linkId?.name;
    if (!orderKey) { tasksUnlinked++; continue; }
    const o = orderByKey.get(orderKey);
    if (!o || !o.groupKey) continue;
    const g = groupByKey.get(o.groupKey);
    if (!g) continue;
    t.groupKey   = o.groupKey;
    t.hierarchies = g.hierarchies;
    t.attributes  = g.attributes;
    tasksStamped++;
  }

  console.log(`  ${ordersStamped}/${orders.length} orders enriched, ${tasksStamped}/${tasks.length} tasks enriched (${tasksUnlinked} unlinked)`);

  // ── State-coherence pass ───────────────────────────────────────────────
  // Chain-precedence invariant: if task X precedes task Y, and Y is
  // IN_PROCESS or COMPLETED, then X is COMPLETED. There is no other possible
  // state — Y cannot run/finish without X having finished. The platform
  // enforces this derivation from the model; source ERPs typically don't.
  // See docs/Stafford/QUESTIONS-slim-100.md Q5.
  console.log('State-coherence pass (chain-precedence invariant)...');
  const taskByKey = new Map(tasks.map(t => [t.key, t]));
  const COHERENT_DOWNSTREAM_STATES = new Set(['IN_PROCESS', 'COMPLETED']);
  let upgraded = 0;
  const visit = (key, seen) => {
    if (seen.has(key)) return;
    seen.add(key);
    const t = taskByKey.get(key);
    if (!t) return;
    if (t.wipState !== 'COMPLETED') {
      t.wipState = 'COMPLETED';
      upgraded++;
    }
    const prev = t.linkId?.prevLink;
    if (prev) visit(prev, seen);
  };
  for (const t of tasks) {
    if (!COHERENT_DOWNSTREAM_STATES.has(t.wipState)) continue;
    const prev = t.linkId?.prevLink;
    if (prev) visit(prev, new Set());
  }
  console.log(`  ${upgraded} NOT_STARTED/IN_PROCESS predecessors upgraded to COMPLETED`);

  // ── Compute horizon from group date range ────────────────────────────
  // start = earliest sourceStart, maxDays = ceil(latest sourceEnd - start).
  // pastDueExtensionDays is preserved from the existing horizon.json (operational
  // tuning, not data-derived). Lives at tenants/<tenant>/horizon.json, sibling
  // to data/. Sliced tenants (e.g. stafford-slim-100) get their own horizon
  // re-derived by their own slicer.
  let minStart = null, maxEnd = null;
  for (const g of enrichedGroups) {
    if (g.sourceStart) {
      const s = new Date(g.sourceStart);
      if (!minStart || s < minStart) minStart = s;
    }
    if (g.sourceEnd) {
      const e = new Date(g.sourceEnd);
      if (!maxEnd || e > maxEnd) maxEnd = e;
    }
  }

  let horizonOut = null;
  if (minStart && maxEnd && maxEnd > minStart) {
    const horizonPath = path.join(CONFIG_ROOT, 'tenants', TENANT_ID, 'horizon.json');
    let existingExtension = 5;
    if (fs.existsSync(horizonPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(horizonPath, 'utf8'));
        if (typeof existing.pastDueExtensionDays === 'number') existingExtension = existing.pastDueExtensionDays;
      } catch { /* fall back to default */ }
    }
    const maxDays = Math.ceil((maxEnd - minStart) / (1000 * 60 * 60 * 24));
    horizonOut = {
      start:                minStart.toISOString().slice(0, 10),
      maxDays:              maxDays,
      pastDueExtensionDays: existingExtension,
    };
    fs.writeFileSync(horizonPath, JSON.stringify(horizonOut, null, 2) + '\n');
  }

  // ── Write ──────────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(OUT_DIR, 'orders.json'),          JSON.stringify(orders,          null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'tasks.json'),           JSON.stringify(tasks,           null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'resources.json'),       JSON.stringify(resources,       null, 2) + '\n');
  fs.writeFileSync(path.join(OUT_DIR, 'workordergroups.json'), JSON.stringify(enrichedGroups,  null, 2) + '\n');

  console.log('OK — wrote 4 files:');
  console.log(`  orders.json          ${orders.length}`);
  console.log(`  tasks.json           ${tasks.length}`);
  console.log(`  resources.json       ${resources.length}`);
  console.log(`  workordergroups.json ${enrichedGroups.length}`);
  if (horizonOut) {
    console.log(`  horizon.json         start=${horizonOut.start} maxDays=${horizonOut.maxDays} (pastDueExtensionDays=${horizonOut.pastDueExtensionDays} preserved)`);
  } else {
    console.log(`  horizon.json         skipped (no group sourceStart/sourceEnd available)`);
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
