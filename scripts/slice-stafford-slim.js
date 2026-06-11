#!/usr/bin/env node
/*
 * scripts/slice-stafford-slim.js
 *
 * Builds the stafford-slim-100 dataset from stafford-engineering-test/data/.
 *
 * Selection criteria (all configurable below):
 *   1. Group sourceEnd >= cutoff (covers "starts after" + "crosses cutoff")
 *   2. Group has >= MIN_ORDERS work orders
 *   3. Group has at least one task with a capacityResource
 *
 * Selection strategy: greedy multi-objective scoring per pick.
 *   score(g) = (new resources × W_RES) + (new project × W_PROJ) − (taskCount × P_SIZE)
 *   Highest score wins each round. Continues until totalTasks >= TARGET.
 *
 * Modes:
 *   node scripts/slice-stafford-slim.js                 # preview only — prints report, writes nothing
 *   node scripts/slice-stafford-slim.js --write         # overwrites slim-100/data/orders.json,
 *                                                       # tasks.json, resources.json, workordergroups.json,
 *                                                       # horizon.json
 *   node scripts/slice-stafford-slim.js --copy-calendars
 *                                                       # also copies engineering-test calendars.json
 *                                                       # to slim-100/data/calendars.json
 */
const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_TENANT  = 'stafford-engineering-test';
const DST_TENANT  = 'stafford-slim-100';
const SRC_DIR     = path.join(REPO_ROOT, 'config', 'tenants', SRC_TENANT, 'data');
const DST_DIR     = path.join(REPO_ROOT, 'config', 'tenants', DST_TENANT, 'data');
const SRC_TENANT_ROOT = path.join(REPO_ROOT, 'config', 'tenants', SRC_TENANT);
const DST_TENANT_ROOT = path.join(REPO_ROOT, 'config', 'tenants', DST_TENANT);

// ── Tunables ────────────────────────────────────────────────────────────
const TARGET_TASKS         = 100;
const PHASE1_TARGET        = 85;   // Phase-1 (diversity) target; Phase 2 fills remainder with resource picks
const CUTOFF_DATE          = '2026-04-01';
const MIN_ORDERS           = 2;
const GROUP_MAX_TASKS      = 25;   // hard cap: drop monster groups so no single Job blows the budget
const W_RES                = 5;    // weight: each new resource added
const W_PROJ               = 30;   // weight: new project covered
const W_CUST               = 10;   // weight: new customer covered
const P_SIZE               = 1.0;  // penalty: per task in group
const P_REPEAT_PROJECT     = 40;   // penalty: project already in slice (forces broader coverage)
const HORIZON_BUFFER_DAYS  = 30;   // padding past max(sourceEnd) so long-duration tasks (e.g. 192h on a day-shift resource) have runway past their group's nominal end. See QUESTIONS-slim-100.md Q6.

const WRITE            = process.argv.includes('--write');
const COPY_CALENDARS   = process.argv.includes('--copy-calendars');

// ── Load source ─────────────────────────────────────────────────────────
function load(file) { return JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), 'utf8')); }

const orders    = load('orders.json');
const tasks     = load('tasks.json');
const resources = load('resources.json');
const groups    = load('workordergroups.json');

const cutoff = new Date(CUTOFF_DATE + 'T00:00:00Z');

// ── Build indexes ───────────────────────────────────────────────────────
const orderByKey   = new Map(orders.map(o => [o.key, o]));
const ordersByGroup = new Map();
for (const o of orders) {
  if (!o.groupKey) continue;
  if (!ordersByGroup.has(o.groupKey)) ordersByGroup.set(o.groupKey, []);
  ordersByGroup.get(o.groupKey).push(o);
}

// tasks by group (via linkId.name → order → groupKey)
const tasksByGroup = new Map();
const tasksByOrder = new Map();
let tasksUnlinked = 0;
for (const t of tasks) {
  const orderKey = t.linkId?.name;
  if (!orderKey) { tasksUnlinked++; continue; }
  if (!tasksByOrder.has(orderKey)) tasksByOrder.set(orderKey, []);
  tasksByOrder.get(orderKey).push(t);
  const o = orderByKey.get(orderKey);
  if (!o?.groupKey) continue;
  if (!tasksByGroup.has(o.groupKey)) tasksByGroup.set(o.groupKey, []);
  tasksByGroup.get(o.groupKey).push(t);
}

// resources used by each group's tasks
const groupResources = new Map();
for (const [groupKey, gTasks] of tasksByGroup.entries()) {
  const set = new Set();
  for (const t of gTasks) {
    for (const cr of (t.capacityResources ?? [])) {
      if (cr.resource) set.add(cr.resource);
    }
  }
  groupResources.set(groupKey, set);
}

// project of each group (hierarchy slot 2)
function projectOf(g) {
  const h = (g.hierarchies ?? []).find(h => h.slot === 2);
  return h?.value ?? '(no project)';
}

// ── Filter candidates ───────────────────────────────────────────────────
const candidates = groups.filter(g => {
  if (g.workOrderKeys.length < MIN_ORDERS) return false;
  const gTasks = tasksByGroup.get(g.key) ?? [];
  if (gTasks.length === 0) return false;
  if (gTasks.length > GROUP_MAX_TASKS) return false;
  if (!gTasks.some(t => (t.capacityResources ?? []).length > 0)) return false;
  if (!g.sourceEnd) return false;
  const end = new Date(g.sourceEnd);
  return end >= cutoff;
});

console.log(`Candidates (≥${MIN_ORDERS} orders, ≤${GROUP_MAX_TASKS} tasks, has tasks-with-resources, sourceEnd >= ${CUTOFF_DATE}): ${candidates.length} of ${groups.length}`);

// ── Greedy multi-objective selection ────────────────────────────────────
function customerOf(g) {
  const h = (g.hierarchies ?? []).find(h => h.slot === 1);
  return h?.value ?? '(no customer)';
}

const picked       = [];
const seenResources = new Set();
const seenProjects = new Set();
const seenCustomers = new Set();
let totalTasks = 0;
const pool = [...candidates];

function score(g) {
  const gRes  = groupResources.get(g.key) ?? new Set();
  let newRes = 0;
  for (const r of gRes) if (!seenResources.has(r)) newRes++;
  const projAlready = seenProjects.has(projectOf(g));
  const custAlready = seenCustomers.has(customerOf(g));
  const taskN = (tasksByGroup.get(g.key) ?? []).length;
  return (newRes * W_RES)
       + (projAlready ? 0 : W_PROJ)
       + (custAlready ? 0 : W_CUST)
       - (taskN * P_SIZE)
       - (projAlready ? P_REPEAT_PROJECT : 0);
}

// Phase 1: diversity-weighted greedy
const phase1Picked = [];
while (totalTasks < PHASE1_TARGET && pool.length > 0) {
  let bestIdx = -1, bestScore = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    const s = score(pool[i]);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  if (bestIdx === -1) break;
  const g = pool.splice(bestIdx, 1)[0];
  picked.push(g);
  phase1Picked.push(g);
  for (const r of (groupResources.get(g.key) ?? new Set())) seenResources.add(r);
  seenProjects.add(projectOf(g));
  seenCustomers.add(customerOf(g));
  totalTasks += (tasksByGroup.get(g.key) ?? []).length;
}
const phase1Tasks = totalTasks;
const phase1ResCount = seenResources.size;

// Phase 2: resource-coverage pickup until target reached or no further gains
// Score is purely "new resources added", tie-break by smallest task count
const phase2Picked = [];
while (totalTasks < TARGET_TASKS && pool.length > 0) {
  let bestIdx = -1, bestNewRes = 0, bestSize = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const g = pool[i];
    const gRes = groupResources.get(g.key) ?? new Set();
    let newRes = 0;
    for (const r of gRes) if (!seenResources.has(r)) newRes++;
    if (newRes === 0) continue;
    const taskN = (tasksByGroup.get(g.key) ?? []).length;
    if (newRes > bestNewRes || (newRes === bestNewRes && taskN < bestSize)) {
      bestIdx = i; bestNewRes = newRes; bestSize = taskN;
    }
  }
  if (bestIdx === -1) break;  // no group adds new resources — stop
  const g = pool.splice(bestIdx, 1)[0];
  picked.push(g);
  phase2Picked.push(g);
  for (const r of (groupResources.get(g.key) ?? new Set())) seenResources.add(r);
  seenProjects.add(projectOf(g));
  seenCustomers.add(customerOf(g));
  totalTasks += (tasksByGroup.get(g.key) ?? []).length;
}

// ── Build slice ─────────────────────────────────────────────────────────
const pickedGroupKeys = new Set(picked.map(g => g.key));
const sliceOrders = [];
for (const g of picked) sliceOrders.push(...(ordersByGroup.get(g.key) ?? []));
const sliceOrderKeys = new Set(sliceOrders.map(o => o.key));
const sliceTasks = [];
for (const g of picked) sliceTasks.push(...(tasksByGroup.get(g.key) ?? []));
const sliceGroups = picked.map(g => ({
  ...g,
  workOrderKeys: g.workOrderKeys.filter(k => sliceOrderKeys.has(k)),
}));

// ── Compute slice horizon ───────────────────────────────────────────────
let minStart = null, maxEnd = null;
for (const g of sliceGroups) {
  if (g.sourceStart) {
    const s = new Date(g.sourceStart);
    if (!minStart || s < minStart) minStart = s;
  }
  if (g.sourceEnd) {
    const e = new Date(g.sourceEnd);
    if (!maxEnd || e > maxEnd) maxEnd = e;
  }
}

let slicedHorizon = null;
if (minStart && maxEnd && maxEnd > minStart) {
  // Preserve pastDueExtensionDays from existing slim-100 horizon if present
  let extension = 5;
  const dstHorizonPath = path.join(DST_TENANT_ROOT, 'horizon.json');
  if (fs.existsSync(dstHorizonPath)) {
    try {
      const cur = JSON.parse(fs.readFileSync(dstHorizonPath, 'utf8'));
      if (typeof cur.pastDueExtensionDays === 'number') extension = cur.pastDueExtensionDays;
    } catch { /* default */ }
  }
  slicedHorizon = {
    start: minStart.toISOString().slice(0, 10),
    maxDays: Math.ceil((maxEnd - minStart) / 86400000) + HORIZON_BUFFER_DAYS,
    pastDueExtensionDays: extension,
  };
}

// ── Compare against current slim-100 ───────────────────────────────────
function safeLoad(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const curOrders = safeLoad(path.join(DST_DIR, 'orders.json'));
const curTasks  = safeLoad(path.join(DST_DIR, 'tasks.json'));
const curRes    = safeLoad(path.join(DST_DIR, 'resources.json'));
const curGroups = safeLoad(path.join(DST_DIR, 'workordergroups.json'));

// ── Report ──────────────────────────────────────────────────────────────
console.log();
console.log('═══ SLICE PREVIEW ═══════════════════════════════════════════');
console.log();
console.log('Groups picked:    ', picked.length, '(Phase 1: ' + phase1Picked.length + ', Phase 2: ' + phase2Picked.length + ')');
console.log('Orders:           ', sliceOrders.length);
console.log('Tasks:            ', sliceTasks.length, '(Phase 1: ' + phase1Tasks + ', Phase 2 added: ' + (sliceTasks.length - phase1Tasks) + ')');
console.log('Resources copied: ', resources.length, '(all)');
console.log();

// Resource coverage in slice
const allResourceKeys = new Set(resources.map(r => r.key));
const usedResources = seenResources;
const uncoveredResources = [...allResourceKeys].filter(k => !usedResources.has(k));
console.log('Resource coverage:', usedResources.size, '/', allResourceKeys.size, 'have ≥1 task in slice  (after Phase 1: ' + phase1ResCount + ')');

// By resource type
const resByKey = new Map(resources.map(r => [r.key, r]));
const typeUsed = {};
for (const k of usedResources) {
  const r = resByKey.get(k);
  if (r) typeUsed[r.type ?? '?'] = (typeUsed[r.type ?? '?'] ?? 0) + 1;
}
console.log('  by type used:   ', JSON.stringify(typeUsed));

// Top 10 resources by task count
const tasksPerRes = new Map();
for (const t of sliceTasks) {
  for (const cr of (t.capacityResources ?? [])) {
    if (cr.resource) tasksPerRes.set(cr.resource, (tasksPerRes.get(cr.resource) ?? 0) + 1);
  }
}
console.log();
console.log('Top 10 resources by task count in slice:');
for (const [k, c] of [...tasksPerRes.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10)) {
  const r = resByKey.get(k);
  console.log('  ' + String(k).padEnd(14) + ' (' + (r?.type ?? '?') + ') ' + String(c).padStart(3) + ' tasks   ' + (r?.name ?? ''));
}

// Uncovered (resources with no slim tasks)
console.log();
console.log('Uncovered resources (' + uncoveredResources.length + '):');
const uncoveredByType = {};
for (const k of uncoveredResources) {
  const r = resByKey.get(k);
  const t = r?.type ?? '?';
  if (!uncoveredByType[t]) uncoveredByType[t] = [];
  uncoveredByType[t].push(k);
}
for (const [t, ks] of Object.entries(uncoveredByType)) {
  console.log('  ' + t + ' (' + ks.length + '): ' + ks.slice(0, 10).join(', ') + (ks.length > 10 ? ', ...' : ''));
}

// Project diversity
console.log();
console.log('Project diversity (' + seenProjects.size + ' distinct):');
const projectCounts = new Map();
for (const g of picked) {
  const p = projectOf(g);
  projectCounts.set(p, (projectCounts.get(p) ?? 0) + 1);
}
for (const [p, c] of [...projectCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 15)) {
  console.log('  ' + String(p).padEnd(40).slice(0, 40) + ' ' + c + ' group(s)');
}

// Customer diversity
console.log();
console.log('Customer diversity:');
const customerCounts = new Map();
for (const g of picked) {
  const c = (g.hierarchies ?? []).find(h => h.slot === 1)?.value ?? '(none)';
  customerCounts.set(c, (customerCounts.get(c) ?? 0) + 1);
}
for (const [c, cnt] of [...customerCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 10)) {
  console.log('  ' + String(c).padEnd(40).slice(0, 40) + ' ' + cnt + ' group(s)');
}

// Date range
console.log();
console.log('Slice date range:');
console.log('  earliest sourceStart:', minStart?.toISOString().slice(0, 10) ?? 'n/a');
console.log('  latest   sourceEnd:  ', maxEnd?.toISOString().slice(0, 10) ?? 'n/a');
console.log('  slice horizon would be:', slicedHorizon ? `start=${slicedHorizon.start} maxDays=${slicedHorizon.maxDays}` : '(insufficient data)');

// Diff vs current slim-100
console.log();
console.log('═══ DIFF vs current slim-100 ════════════════════════════════');
if (curOrders) {
  console.log('orders:           current=' + curOrders.length + ' → new=' + sliceOrders.length);
} else {
  console.log('orders:           current=(missing) → new=' + sliceOrders.length);
}
if (curTasks)  console.log('tasks:            current=' + curTasks.length + ' → new=' + sliceTasks.length);
if (curRes)    console.log('resources:        current=' + curRes.length + ' → new=' + resources.length);
if (curGroups) console.log('workordergroups:  current=' + curGroups.length + ' → new=' + sliceGroups.length);

// Write if --write
console.log();
if (WRITE) {
  console.log('═══ WRITING ═════════════════════════════════════════════════');
  fs.writeFileSync(path.join(DST_DIR, 'orders.json'),          JSON.stringify(sliceOrders,  null, 2) + '\n');
  fs.writeFileSync(path.join(DST_DIR, 'tasks.json'),           JSON.stringify(sliceTasks,   null, 2) + '\n');
  fs.writeFileSync(path.join(DST_DIR, 'resources.json'),       JSON.stringify(resources,    null, 2) + '\n');
  fs.writeFileSync(path.join(DST_DIR, 'workordergroups.json'), JSON.stringify(sliceGroups,  null, 2) + '\n');
  console.log('  orders.json          ' + sliceOrders.length);
  console.log('  tasks.json           ' + sliceTasks.length);
  console.log('  resources.json       ' + resources.length);
  console.log('  workordergroups.json ' + sliceGroups.length);
  if (slicedHorizon) {
    fs.writeFileSync(path.join(DST_TENANT_ROOT, 'horizon.json'), JSON.stringify(slicedHorizon, null, 2) + '\n');
    console.log('  horizon.json         start=' + slicedHorizon.start + ' maxDays=' + slicedHorizon.maxDays);
  }
  if (COPY_CALENDARS) {
    fs.copyFileSync(path.join(SRC_DIR, 'calendars.json'), path.join(DST_DIR, 'calendars.json'));
    console.log('  calendars.json       copied from ' + SRC_TENANT);
  }
} else {
  console.log('PREVIEW MODE — pass --write to overwrite slim-100/data/');
  if (!COPY_CALENDARS) console.log('                pass --copy-calendars to also copy engineering-test calendars.json');
}
