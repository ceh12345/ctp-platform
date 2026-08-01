#!/usr/bin/env node
/*
 * scripts/capture-to-xlsx.js
 *
 * Builds a review workbook from a raw Genius capture directory: one sheet per
 * captured entity. By default, columns are filtered to the source fields that
 * the tenant's integration/mapping.json actually consumes, and each column is
 * annotated (cell comment) with the CTP field it feeds. A _Mapping sheet lists
 * every source→CTP pair. Entities with no mapping section are kept full-width
 * and flagged. This is the RAW capture (real customer names etc.) — internal
 * review only, not for promotion to fixtures.
 *
 * Use:
 *   node scripts/capture-to-xlsx.js [capture-dir] [out.xlsx] [--all-columns]
 *
 * --all-columns   skip mapping filter; dump every field for every entity.
 *
 * Defaults:
 *   capture-dir = tools/mock-genius/recorded/<newest stafford-work7-*>
 *   out.xlsx    = docs/Stafford/<capture-name>-review.xlsx
 *   mapping     = config/tenants/stafford-engineering-test/integration/mapping.json
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const REPO = path.resolve(__dirname, '..');
const RECORDED = path.join(REPO, 'tools/mock-genius/recorded');
const MAPPING_PATH = path.join(
  REPO, 'config/tenants/stafford-engineering-test/integration/mapping.json');

// Entities to omit from the review workbook. salesOrderDetailEntity is captured
// but unused — the adapter's salesOrders slot sources from the work-order entity
// instead — so it has no mapping and adds noise to a review.
const EXCLUDE_ENTITIES = new Set(['salesOrderDetailEntity']);

// Overhead work orders (Job >= 'SYST': SYST-*, Z* buckets — cleaning, training,
// breaks, admin) are excluded, mirroring the Job<SYST clause now on the adapter's
// work-order filter. We drop those WO rows and any tasks hanging off them so the
// review reflects production-only load. Pass --include-overhead to keep them.
// A missing/empty Job is treated as production (kept), never overhead.
const SYST_BOUNDARY = 'SYST';
const jobCode = (v) => (v == null ? '' : String(v));
const isOverheadJob = (v) => { const j = jobCode(v); return j !== '' && j >= SYST_BOUNDARY; };

// Genius entity → friendly sheet name (Excel caps sheet names at 31 chars).
const SHEET_NAMES = {
  workOrderWithAdvancedInformationViewEntity: 'WorkOrders',
  salesOrderDetailEntity: 'SalesOrders',
  productionTaskWithAdvancedInfoViewEntity: 'Tasks',
  machineAndRessourceEntity: 'Resources',
  JobEntity: 'Jobs',
};

// mapping.json section → { entity it sources from, CTP object label for targets }.
// Both `orders` and `workOrderGroups` source from the work-order entity, so the
// WorkOrders sheet feeds two CTP objects.
const SECTION_TO_ENTITY = {
  orders: { entity: 'workOrderWithAdvancedInformationViewEntity', ctp: 'order' },
  workOrderGroups: { entity: 'workOrderWithAdvancedInformationViewEntity', ctp: 'group' },
  resources: { entity: 'machineAndRessourceEntity', ctp: 'resource' },
  tasks: { entity: 'productionTaskWithAdvancedInfoViewEntity', ctp: 'task' },
};

function newestCaptureDir() {
  const dirs = fs.readdirSync(RECORDED)
    .filter((d) => d.startsWith('stafford-work7-')).sort();
  if (!dirs.length) throw new Error('no stafford-work7-* capture dirs under ' + RECORDED);
  return path.join(RECORDED, dirs[dirs.length - 1]);
}

function loadEntity(dir, entity) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(entity + '_page') && f.endsWith('.json'))
    .sort((a, b) => {
      const n = (s) => parseInt(s.match(/_page(\d+)/)[1], 10);
      return n(a) - n(b);
    });
  const rows = [];
  for (const f of files) {
    const env = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    for (const r of env.Result || []) rows.push(r);
  }
  return rows;
}

// Set of WorkOrder codes whose Job is overhead (>= SYST), so tasks can be
// dropped by their WorkOrderCode link the same way WO rows are dropped by Job.
function overheadWorkOrderCodes(captureDir) {
  const set = new Set();
  for (const w of loadEntity(captureDir, 'workOrderWithAdvancedInformationViewEntity')) {
    if (isOverheadJob(w.Job)) set.add(String(w.WorkOrder));
  }
  return set;
}

function applyOverheadFilter(entity, rows, overheadWOs, includeOverhead) {
  if (includeOverhead) return rows;
  if (entity === 'workOrderWithAdvancedInformationViewEntity') {
    return rows.filter((r) => !isOverheadJob(r.Job));
  }
  if (entity === 'productionTaskWithAdvancedInfoViewEntity') {
    // Mirror the adapter's JobCode<SYST clause; the WorkOrderCode link is a
    // fallback for any overhead task whose JobCode is blank but whose WO is known.
    return rows.filter((r) =>
      !isOverheadJob(r.JobCode) && !overheadWOs.has(String(r.WorkOrderCode)));
  }
  return rows;
}

function unionKeys(rows) {
  const keys = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) {
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  return keys;
}

// Collect (sourceField -> CTP target) pairs a mapping spec references.
// Skips lookup keys (those are source *values*), literals, and synthetic
// fields (names starting with '_', which are computed, not source columns).
function collectFromSpec(spec, targetLabel, out) {
  if (!spec || typeof spec !== 'object') return;
  const addField = (f) => {
    if (typeof f === 'string' && !f.startsWith('_')) out.push([f, targetLabel]);
  };
  if (spec.from !== undefined) {
    if (Array.isArray(spec.from)) spec.from.forEach(addField); else addField(spec.from);
  }
  if (spec.dateRangeSeconds) {
    addField(spec.dateRangeSeconds.from);
    addField(spec.dateRangeSeconds.to);
  }
  if (Array.isArray(spec.cascade)) {
    for (const el of spec.cascade) collectFromSpec(el, targetLabel, out);
  }
  // Deliberately ignore: lookup, value, factor, sep, toUTC, threshold, etc.
}

// Build entity -> Map(sourceField -> Set(ctpTargets)) from mapping.json.
function buildFieldMap(mapping) {
  const perEntity = {};
  const ensure = (entity) => (perEntity[entity] ||= new Map());
  const record = (entity, field, target) => {
    const m = ensure(entity);
    if (!m.has(field)) m.set(field, new Set());
    m.get(field).add(target);
  };

  for (const [section, { entity, ctp }] of Object.entries(SECTION_TO_ENTITY)) {
    const sec = mapping[section];
    if (!sec) continue;
    const pairs = [];

    if (sec.mappings) {
      for (const [target, spec] of Object.entries(sec.mappings)) {
        if (target.startsWith('_')) continue; // synthetic CTP target, skip
        // resources.hierarchy is nested { level1:{from}, level2:{from} }
        if (spec && !spec.from && !spec.cascade && !spec.dateRangeSeconds && !spec.value) {
          for (const [sub, subSpec] of Object.entries(spec)) {
            collectFromSpec(subSpec, `${ctp}.${target}.${sub}`, pairs);
          }
        } else {
          collectFromSpec(spec, `${ctp}.${target}`, pairs);
        }
      }
    }
    // Section-level extras.
    if (sec.key) collectFromSpec(sec.key, `${ctp}.key`, pairs);
    if (sec.capacityResources) collectFromSpec(sec.capacityResources, `${ctp}.capacityResources`, pairs);
    if (sec.linkId) {
      if (sec.linkId.chainKey) pairs.push([sec.linkId.chainKey, `${ctp}.linkId.chain`]);
      if (sec.linkId.orderKey) pairs.push([sec.linkId.orderKey, `${ctp}.linkId.order`]);
      // lagHoursField intentionally points at a disabled/non-existent field — skip.
    }
    for (const src of [sec.hierarchies, sec.attributes]) {
      if (!Array.isArray(src)) continue;
      for (const item of src) {
        const f = item?.source?.field;
        if (typeof f === 'string' && !f.startsWith('_')) {
          pairs.push([f, `${ctp}.${item.name}`]);
        }
      }
    }
    for (const [field, target] of pairs) record(entity, field, target);
  }
  return perEntity;
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// --- Task/resource analysis for the _Summary tab -------------------------

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// A finite, capacity-1 resource is a named individual unit (a fabricator, a
// machinist, or a single machine). Genius types most as 'R' but some named
// people are entered as 'W' (PHIL, WERNER, JIMMY) — so the R/W type is NOT a
// reliable person signal; finite+capacity-1 is. Pools (capacity>1 or infinite)
// are work centers. Type S is subcontract.
const isPerson = (r) =>
  r && r.RessourceType !== 'S' && r.IsFinite === true && (num(r.NumOfAvgResource) || 1) <= 1;

function assignKind(r) {
  if (!r) return 'Unassigned (dangling ID)';
  if (r.RessourceType === 'S') return 'Subcontract';
  if (isPerson(r)) return 'Individual person/unit (finite)';
  return 'Work center (pooled)';
}

function taskStatus(t) {
  if (num(t.CompletionPercentage) > 99.99) return 'Done';
  if (num(t.TotalCumulativeMachineHours) > 0) return 'Running';
  return 'Open';
}

function computeAnalysis(captureDir, overheadWOs, includeOverhead) {
  const res = loadEntity(captureDir, 'machineAndRessourceEntity');
  const tasks = applyOverheadFilter('productionTaskWithAdvancedInfoViewEntity',
    loadEntity(captureDir, 'productionTaskWithAdvancedInfoViewEntity'),
    overheadWOs, includeOverhead);
  if (!res.length || !tasks.length) return null;

  const R = new Map(res.map((r) => [String(r.Id), r]));
  const assign = {}, status = {};
  let locked = 0, lockedOpen = 0;
  const dept = {}; // code -> { people, centers, openTasks, openHours }
  const ensureDept = (c) => (dept[c] ||= { people: 0, centers: 0, openTasks: 0, openHours: 0 });

  for (const r of res) {
    const d = ensureDept(r.DepartmentCode ?? '(none)');
    if (isPerson(r)) d.people += 1;
    else if (r.RessourceType !== 'S') d.centers += 1; // pooled work center
  }
  for (const t of tasks) {
    const r = R.get(String(t.MachineId));
    assign[assignKind(r)] = (assign[assignKind(r)] || 0) + 1;
    const s = taskStatus(t);
    status[s] = (status[s] || 0) + 1;
    if (t.IsSchedulingLocked === true) { locked += 1; if (s === 'Open') lockedOpen += 1; }
    if (s === 'Open' && r) {
      const d = ensureDept(r.DepartmentCode ?? '(none)');
      d.openTasks += 1;
      d.openHours += num(t.TotalPlannedMachineHours);
    }
  }
  return { total: tasks.length, assign, status, locked, lockedOpen, dept };
}

function addSummarySheet(ws, a, captureName) {
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 12;
  ws.getColumn(5).width = 14;
  ws.getColumn(6).width = 20;
  const title = (t) => { const row = ws.addRow([t]); row.font = { bold: true, size: 12 }; return row; };
  const head = (cells) => { const row = ws.addRow(cells); row.font = { bold: true };
    row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; }); return row; };

  title(`Task & resource summary — ${captureName}`);
  ws.addRow([`${a.total} tasks joined to resources on MachineId`]);
  ws.addRow([]);

  title('Assignment: person vs work center');
  head(['Assigned to', 'Tasks', 'Share']);
  for (const [k, v] of Object.entries(a.assign).sort((x, y) => y[1] - x[1])) {
    ws.addRow([k, v, v / a.total]).getCell(3).numFmt = '0.0%';
  }
  ws.addRow([]);

  title('Status');
  head(['Status', 'Tasks', 'Share']);
  for (const k of ['Open', 'Running', 'Done']) {
    const v = a.status[k] || 0;
    ws.addRow([k, v, v / a.total]).getCell(3).numFmt = '0.0%';
  }
  ws.addRow([`Locked (orthogonal flag)`, a.locked, `of which open: ${a.lockedOpen}`]);
  ws.addRow([]);

  title('Open-task load by department');
  head(['Dept', 'People', 'Work centers', 'Open tasks', 'Open hrs', 'Open hrs / person']);
  const rows = Object.entries(a.dept)
    .filter(([, d]) => d.people || d.centers || d.openTasks)
    .sort((x, y) => y[1].openHours - x[1].openHours);
  for (const [code, d] of rows) {
    const r = ws.addRow([code, d.people, d.centers, d.openTasks,
      Math.round(d.openHours), d.people ? d.openHours / d.people : null]);
    if (d.people) r.getCell(6).numFmt = '0';
  }
  ws.addRow([]);
  const note = ws.addRow(['Note: open-task counts include tasks queued on pooled work centers, ' +
    'not only individuals. Open hrs / person is the load that must flow through each named worker.']);
  note.font = { italic: true, size: 9 };
}

// Placement of a task's assigned resource. A "pool" with capacity 1 is really a
// single station (can't float), so it's distinguished from genuine float (cap>=2).
function resourcePlacement(r) {
  if (!r) return 'unassigned';
  if (r.RessourceType === 'S') return 'subcontract';
  if (isPerson(r)) return 'pinned';
  return (num(r.NumOfAvgResource) || 1) >= 2 ? 'float' : 'poolCap1';
}

function computeResourceLoad(captureDir, overheadWOs, includeOverhead) {
  const res = loadEntity(captureDir, 'machineAndRessourceEntity');
  const tasks = applyOverheadFilter('productionTaskWithAdvancedInfoViewEntity',
    loadEntity(captureDir, 'productionTaskWithAdvancedInfoViewEntity'),
    overheadWOs, includeOverhead).filter((t) => taskStatus(t) === 'Open');
  if (!res.length || !tasks.length) return null;

  const R = new Map(res.map((r) => [String(r.Id), r]));
  const place = { pinned: 0, poolCap1: 0, float: 0, subcontract: 0, unassigned: 0 };
  const dept = {}; // code -> { pinned, pool, subcontract, hours }
  const perRes = new Map(); // machineId -> { open, hours }
  const ensureDept = (c) => (dept[c] ||= { pinned: 0, pool: 0, subcontract: 0, hours: 0 });

  for (const t of tasks) {
    const r = R.get(String(t.MachineId));
    const p = resourcePlacement(r);
    place[p] += 1;
    const d = ensureDept((r && r.DepartmentCode) ?? '(none)');
    if (p === 'pinned') d.pinned += 1;
    else if (p === 'subcontract') d.subcontract += 1;
    else if (p !== 'unassigned') d.pool += 1;
    d.hours += num(t.TotalPlannedMachineHours);
    const pr = perRes.get(String(t.MachineId)) || { open: 0, hours: 0 };
    pr.open += 1; pr.hours += num(t.TotalPlannedMachineHours);
    perRes.set(String(t.MachineId), pr);
  }
  const topResources = [...perRes.entries()].map(([mid, v]) => {
    const r = R.get(mid);
    return {
      dept: (r && r.DepartmentCode) ?? '?',
      name: (r && r.Description1) ?? '(unassigned / dangling id)',
      kind: resourcePlacement(r),
      cap: r ? (num(r.NumOfAvgResource) || 1) : 0,
      open: v.open, hours: v.hours,
    };
  }).sort((a, b) => b.open - a.open);

  return { openTotal: tasks.length, place, dept, topResources };
}

function addResourceLoadSheet(ws, a) {
  [34, 12, 12, 10, 8, 8, 10].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const title = (t) => { const r = ws.addRow([t]); r.font = { bold: true, size: 12 }; return r; };
  const head = (cells) => { const r = ws.addRow(cells); r.font = { bold: true };
    r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; }); return r; };
  const pct = (n) => a.openTotal ? n / a.openTotal : 0;

  title('Open-task placement — pinned vs float');
  ws.addRow([`${a.openTotal} open tasks`]);
  head(['Placement', 'Open tasks', 'Share']);
  const p = a.place;
  const lines = [
    ['Pinned to one named individual', p.pinned],
    ['Cap-1 pool (effectively single station)', p.poolCap1],
    ['Genuine float (pool capacity >= 2)', p.float],
    ['Subcontract (OUTWORK)', p.subcontract],
    ['Unassigned', p.unassigned],
  ];
  for (const [label, n] of lines) ws.addRow([label, n, pct(n)]).getCell(3).numFmt = '0.0%';
  ws.addRow([]);
  const bound = p.pinned + p.poolCap1;
  ws.addRow([`Effectively bound to one resource (pinned + cap-1 pool): ${bound} (${(pct(bound) * 100).toFixed(1)}%)`])
    .font = { italic: true };
  ws.addRow([`Can genuinely float across >=2 capacity: ${p.float} (${(pct(p.float) * 100).toFixed(1)}%)`])
    .font = { italic: true };
  ws.addRow([]);

  title('By process area');
  head(['Dept', 'Pinned', 'Pool', 'Subcon', 'Open hrs']);
  for (const [code, d] of Object.entries(a.dept).sort((x, y) =>
    (y[1].pinned + y[1].pool + y[1].subcontract) - (x[1].pinned + x[1].pool + x[1].subcontract))) {
    ws.addRow([code, d.pinned, d.pool, d.subcontract, Math.round(d.hours)]);
  }
  ws.addRow([]);

  title('Top resources by open-task count');
  head(['Dept', 'Resource', 'Kind', 'Cap', 'Open', 'Hrs', 'Open/cap']);
  const KIND = { pinned: 'pinned', poolCap1: 'pool(1)', float: 'pool(>=2)', subcontract: 'subK', unassigned: '?' };
  for (const r of a.topResources.slice(0, 20)) {
    const row = ws.addRow([r.dept, r.name, KIND[r.kind] || r.kind, r.cap, r.open,
      Math.round(r.hours), r.cap ? r.open / r.cap : null]);
    if (r.cap) row.getCell(7).numFmt = '0.0';
  }
  ws.addRow([]);
  ws.addRow(['Note: "pinned" = assigned to a specific resource (not the IsSchedulingLocked flag). ' +
    'A cap-1 pool is a single station, so its tasks cannot float despite the pool label.'])
    .font = { italic: true, size: 9 };
}

async function main() {
  const FLAGS = new Set(['--all-columns', '--include-overhead']);
  const rest = process.argv.slice(2).filter((a) => !FLAGS.has(a));
  const allColumns = process.argv.includes('--all-columns');
  const includeOverhead = process.argv.includes('--include-overhead');
  const captureDir = rest[0] ? path.resolve(rest[0]) : newestCaptureDir();
  const captureName = path.basename(captureDir);
  const outPath = rest[1]
    ? path.resolve(rest[1])
    : path.join(REPO, 'docs/Stafford', `${captureName}-review.xlsx`);

  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8'));
  const fieldMap = allColumns ? {} : buildFieldMap(mapping);
  const overheadWOs = overheadWorkOrderCodes(captureDir);

  const present = Object.keys(SHEET_NAMES).filter((e) =>
    !EXCLUDE_ENTITIES.has(e) &&
    fs.readdirSync(captureDir).some((f) => f.startsWith(e + '_page')));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'capture-to-xlsx';
  wb.created = new Date(fs.statSync(captureDir).mtime);

  const idx = wb.addWorksheet('_Index');
  const summarySheet = wb.addWorksheet('_Summary');
  const resourceLoadSheet = wb.addWorksheet('_ResourceLoad');
  const mapSheet = wb.addWorksheet('_Mapping');
  const summary = [];
  const mapRows = [];

  const analysis = computeAnalysis(captureDir, overheadWOs, includeOverhead);
  if (analysis) addSummarySheet(summarySheet, analysis, captureName);
  else summarySheet.addRow(['(tasks or resources absent from this capture — no summary)']);

  const resourceLoad = computeResourceLoad(captureDir, overheadWOs, includeOverhead);
  if (resourceLoad) addResourceLoadSheet(resourceLoadSheet, resourceLoad);
  else resourceLoadSheet.addRow(['(tasks or resources absent from this capture — no resource load)']);

  for (const entity of present) {
    const rows = applyOverheadFilter(
      entity, loadEntity(captureDir, entity), overheadWOs, includeOverhead);
    const allKeys = unionKeys(rows);
    const fm = fieldMap[entity]; // Map(field -> Set(targets)) or undefined
    const mapped = !!fm && fm.size > 0;

    // Chosen columns: mapped fields (that actually exist in the data), else all.
    let keys, missing = [];
    if (mapped) {
      keys = [...fm.keys()].filter((k) => {
        if (allKeys.includes(k)) return true;
        missing.push(k); // referenced by mapping but absent from this capture
        return false;
      });
    } else {
      keys = allKeys;
    }

    const sheetName = SHEET_NAMES[entity];
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    });
    ws.columns = keys.map((k) => ({
      header: k, key: k, width: Math.min(Math.max(k.length + 2, 12), 40),
    }));
    for (const r of rows) {
      ws.addRow(keys.reduce((a, k) => { a[k] = cellValue(r[k]); return a; }, {}));
    }
    const hdr = ws.getRow(1);
    hdr.font = { bold: true };
    hdr.fill = { type: 'pattern', pattern: 'solid',
      fgColor: { argb: mapped ? 'FFE8EEF7' : 'FFFDECEA' } };
    if (mapped) {
      keys.forEach((k, i) => {
        const targets = [...fm.get(k)].sort();
        hdr.getCell(i + 1).note = 'Feeds CTP: ' + targets.join(', ');
        for (const t of targets) mapRows.push({ sheet: sheetName, field: k, ctp: t });
      });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };

    summary.push({
      sheet: sheetName, entity, rows: rows.length,
      cols: keys.length, totalCols: allKeys.length,
      status: mapped ? 'mapped' : 'UNMAPPED (full columns)',
      missing: missing.join(', '),
    });
  }

  // _Index.
  idx.columns = [
    { header: 'Sheet', key: 'sheet', width: 14 },
    { header: 'Genius entity', key: 'entity', width: 46 },
    { header: 'Rows', key: 'rows', width: 8 },
    { header: 'Cols shown', key: 'cols', width: 11 },
    { header: 'Cols total', key: 'totalCols', width: 11 },
    { header: 'Status', key: 'status', width: 24 },
    { header: 'Mapped-but-absent fields', key: 'missing', width: 40 },
  ];
  idx.addRow({ sheet: 'Capture', entity: captureName });
  idx.addRow({ sheet: 'Columns', entity: allColumns ? 'ALL (mapping filter off)' : 'mapping.json filtered' });
  idx.addRow({ sheet: 'Overhead', entity: includeOverhead
    ? 'INCLUDED (Job>=SYST kept)'
    : `excluded (Job<SYST) — dropped ${overheadWOs.size} overhead work orders + their tasks` });
  idx.addRow({});
  for (const s of summary) idx.addRow(s);
  idx.getRow(1).font = { bold: true };

  // _Mapping.
  mapSheet.columns = [
    { header: 'Sheet', key: 'sheet', width: 14 },
    { header: 'Genius field', key: 'field', width: 30 },
    { header: 'CTP field', key: 'ctp', width: 34 },
  ];
  mapRows.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.field.localeCompare(b.field));
  for (const r of mapRows) mapSheet.addRow(r);
  mapSheet.getRow(1).font = { bold: true };
  mapSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);

  console.log(`Capture:  ${captureName}   (${allColumns ? 'ALL columns' : 'mapping-filtered'})`);
  for (const s of summary) {
    const tag = s.status === 'mapped' ? `${s.cols}/${s.totalCols} cols` : `${s.cols} cols UNMAPPED`;
    console.log(`  ${s.sheet.padEnd(12)} ${String(s.rows).padStart(5)} rows  ${tag}` +
      (s.missing ? `   (absent: ${s.missing})` : ''));
  }
  console.log(`\nWrote: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
