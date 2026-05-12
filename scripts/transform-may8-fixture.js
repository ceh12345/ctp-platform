#!/usr/bin/env node
/*
 * One-off transform: raw May 8 Genius fixture → flat-file CTP shape.
 *
 * Reads the four mock-genius fixture files for the stafford-work7-100tasks-may8
 * scenario, runs them through the API's MappingEngine using the existing
 * stafford-engineering-test mapping profile, and writes payload.{orders,tasks,
 * resources} into the target tenant's data/ directory.
 *
 * Run from repo root:
 *   node scripts/transform-may8-fixture.js
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tools/mock-genius/fixtures/stafford-work7-100tasks-may8');
const MAPPING_FILE = path.join(REPO_ROOT, 'config/tenants/stafford-engineering-test/integration/mapping.json');
const TARGET_TENANT_DIR = path.join(REPO_ROOT, 'config/tenants/stafford-slim-100');
const TARGET_DATA_DIR = path.join(TARGET_TENANT_DIR, 'data');

const { MappingEngine } = require(path.join(REPO_ROOT, 'packages/api/dist/src/modules/integration/mapping-engine'));

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}
function unwrap(j) {
  return j && Array.isArray(j.Result) ? j.Result : (Array.isArray(j) ? j : []);
}

const rawOrders    = unwrap(readJson(path.join(FIXTURE_DIR, 'workOrderWithAdvancedInformationViewEntity.json')));
const rawTasks     = unwrap(readJson(path.join(FIXTURE_DIR, 'productionTaskWithAdvancedInfoViewEntity.json')));
const rawResources = unwrap(readJson(path.join(FIXTURE_DIR, 'machineAndRessourceEntity.json')));

console.log(`[transform] raw counts — orders: ${rawOrders.length}, tasks: ${rawTasks.length}, resources: ${rawResources.length}`);

const rawPayload = {
  orders:         rawOrders,
  tasks:          rawTasks,
  resources:      rawResources,
  calendars:      [],
  stateChanges:   [],
  products:       [],
  materials:      [],
  processes:      [],
  cadences:       [],
  uomConversions: null,
};

const profile = readJson(MAPPING_FILE);
const engine = new MappingEngine();
const { payload, errors } = engine.transform(rawPayload, profile);

console.log(`[transform] mapping errors: ${errors.length}`);
if (errors.length > 0) {
  const grouped = errors.reduce((acc, e) => {
    const k = `${e.entity}.${e.field}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  for (const [k, n] of Object.entries(grouped)) console.log(`  - ${k}: ${n}`);
}

writeJson(path.join(TARGET_DATA_DIR, 'orders.json'), payload.orders);
writeJson(path.join(TARGET_DATA_DIR, 'tasks.json'), payload.tasks);
writeJson(path.join(TARGET_DATA_DIR, 'resources.json'), payload.resources);

console.log(`[transform] wrote orders.json (${payload.orders.length} records)`);
console.log(`[transform] wrote tasks.json (${payload.tasks.length} records)`);
console.log(`[transform] wrote resources.json (${payload.resources.length} records)`);
console.log(`[transform] target: ${TARGET_DATA_DIR}`);
