#!/usr/bin/env node
/**
 * One-shot generator for the Data Inspector Excel workbook against the
 * Stafford WORK7 May 8 fixture. Same in-process flow as the e2e test —
 * stubs global.fetch with the recorded JSON, syncs the landscape, builds
 * the workbook, writes the bytes to disk.
 *
 * Run from repo root:
 *   node scripts/generate-inspector-export.js
 *
 * Requires:
 *   - packages/api/dist/ built (npm run build --workspace=@ctp/api)
 *   - config/tenants/stafford-engineering-test/ present
 *   - tools/mock-genius/recorded/stafford-work7-2026-05-08/ present
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'packages', 'api', 'dist', 'src');

const { InspectorExportService } = require(path.join(distRoot, 'modules', 'inspector', 'inspector-export.service'));
const { StateService }           = require(path.join(distRoot, 'modules', 'state', 'state.service'));
const { StateHydratorService }   = require(path.join(distRoot, 'modules', 'state', 'state-hydrator.service'));
const { WorkOrderGroupService }  = require(path.join(distRoot, 'modules', 'state', 'workordergroup.service'));
const { ConfigService }          = require(path.join(distRoot, 'config', 'config.service'));
const { FileConfigStore }        = require(path.join(distRoot, 'config', 'file-config-store'));
const { AdapterFactory }         = require(path.join(distRoot, 'modules', 'integration', 'adapter-factory'));
const { MappingEngine }          = require(path.join(distRoot, 'modules', 'integration', 'mapping-engine'));
const { SyncService }            = require(path.join(distRoot, 'modules', 'integration', 'sync.service'));

const CONFIG_ROOT = path.join(repoRoot, 'config');
const FIXTURE_DIR = path.join(repoRoot, 'tools', 'mock-genius', 'recorded', 'stafford-work7-2026-05-08');
const TENANT_ID   = process.argv[2] || 'stafford-engineering-test';

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

(async () => {
  const store          = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService  = new ConfigService(store);
  const wogService     = new WorkOrderGroupService(configService);
  const hydrator       = new StateHydratorService(configService, wogService);
  const mappingEngine  = new MappingEngine();
  const adapterFactory = new AdapterFactory(configService);
  const syncService    = new SyncService(adapterFactory, mappingEngine, configService);
  const stateService   = new StateService(hydrator, configService, syncService);
  const inspector      = new InspectorExportService(stateService, configService);

  console.log(`Syncing ${TENANT_ID}...`);
  await stateService.syncFromAdapter();
  const ls = stateService.getLandscape();
  console.log(`  ${ls.groups.size()} groups / ${ls.orders.size()} orders / ${ls.tasks.size()} tasks / ${ls.resources.size()} resources`);

  console.log('Building workbook...');
  const t0 = process.hrtime.bigint();
  const { buffer, filename } = await inspector.buildWorkbook();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${ms.toFixed(0)}ms`);

  const outPath = path.join(repoRoot, filename);
  fs.writeFileSync(outPath, buffer);
  const kb = (buffer.length / 1024).toFixed(1);
  console.log(`Wrote ${outPath} (${kb} KB)`);
})().catch((err) => { console.error(err); process.exit(1); });
