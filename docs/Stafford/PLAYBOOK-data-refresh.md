# Stafford Data Refresh Playbook

End-to-end procedure for: **pull fresh Genius data → validate → produce committable CTP-shape dataset.** Run this whenever Stafford's WORK7 (or future STAFFO) data has drifted enough to warrant a re-snapshot.

Last validated: 2026-06-07 against the 2026-06-03 WORK7 capture.

---

## When to run

- Stafford data has changed materially (new customers, new operations, new product families)
- Mapping rule changes need verification against real data
- Releasing a new mapping or adapter change that affects entity coverage
- Periodic refresh (~monthly during beta)

## What you need

- **VPN to Stafford** active (only for the capture step — sub-steps that work against the saved fixture are offline)
- **Stafford WORK7 credentials** in env vars: `STAFFORD_COMPANY_CODE`, `STAFFORD_USERNAME`, `STAFFORD_PASSWORD`
- **Packages built:** `npm run build --workspace=@ctp/engine && npm run build --workspace=@ctp/api`
- Ports **8080 (mock-genius), 3000 (API)** free

## What this does NOT do

- **PII sanitization for committing publicly.** The data IS Stafford's; it stays as-is in the private repo. If we ever need a public fixture, that's a separate (currently undesigned) procedure.
- **CTP feature-b staging promotion.** No symlinks, no atomic rename. CTP-shape data overwrites `config/tenants/stafford-engineering-test/data/` directly. Feature-b will replace this with proper staging.

---

## Phase 1 — Capture (VPN required)

Run mock-genius in **recording mode** so it proxies live Genius and saves raw responses to disk. The adapter pulls through mock-genius; mock-genius records everything to `tools/mock-genius/recorded/<timestamp>/`.

```bash
# Start mock-genius in recording mode
cd tools/mock-genius
MOCK_RECORD_FROM=https://genius.stafford.co.nz:53215 \
MOCK_RECORD_AUTH_USER=$STAFFORD_USERNAME \
MOCK_RECORD_AUTH_PASS=$STAFFORD_PASSWORD \
npm start
# Startup banner MUST say "Mode: RECORDING" — stop and fix env if not
```

In another terminal, trigger a sync (this exercises all five endpoints):

```bash
# Start API normally — it'll hit mock-genius which proxies to real Genius
cd packages/api && node dist/src/main.js >> /tmp/api.log 2>&1 &

# Sync — pulls JobEntity + WO + Tasks + Resources + SalesOrders through the chain
curl.exe -X POST -H "X-Tenant-Id: stafford-engineering-test" http://localhost:3000/v1/state/sync
```

Stop mock-genius (Ctrl+C). It writes a session directory under `recorded/`.

## Phase 2 — Strip envelopes + merge paged files

mock-genius records each Genius response with its `{Result, PagingInfos, ...}` envelope and one file per page. The adapter expects flat arrays per entity.

```bash
# Rename the timestamped session dir to a stable date-named one
SESSION=$(ls -1 tools/mock-genius/recorded | tail -1)
DATE=$(date +%Y-%m-%d)
mv tools/mock-genius/recorded/$SESSION tools/mock-genius/recorded/stafford-work7-$DATE

# Strip envelopes + merge pages → one flat array per entity
node tools/mock-genius/scripts/strip-envelope.js \
  tools/mock-genius/recorded/stafford-work7-$DATE

# Optional: promote into a stable fixture-named directory for mock-genius to serve
cp -r tools/mock-genius/recorded/stafford-work7-$DATE \
      tools/mock-genius/fixtures/stafford-snapshot-$DATE
```

Result: `tools/mock-genius/fixtures/stafford-snapshot-<date>/` has 5 flat JSON files plus the `_capture-metadata.json` from capture and a `README.md`.

## Phase 3 — Validate (Phase 1 from feature-b walkthrough)

Quick sanity check before mapping:

```bash
node -e "
const fs = require('fs'); const path = require('path');
const base = 'tools/mock-genius/fixtures/stafford-snapshot-$DATE';
const meta = JSON.parse(fs.readFileSync(path.join(base, '_capture-metadata.json'), 'utf8'));
const expected = Object.fromEntries(meta.entities.map(e => [e.name, e.totalElementsFound]));
const files = {
  JobEntity:                                  'JobEntity.json',
  workOrderWithAdvancedInformationViewEntity: 'workOrderWithAdvancedInformationViewEntity.json',
  productionTaskWithAdvancedInfoViewEntity:   'productionTaskWithAdvancedInfoViewEntity.json',
  salesOrderDetailEntity:                     'salesOrderDetailEntity.json',
  machineAndRessourceEntity:                  'machineAndRessourceEntity.json',
};
let pass = true;
for (const [name, file] of Object.entries(files)) {
  const got = JSON.parse(fs.readFileSync(path.join(base, file), 'utf8')).length;
  const ok = got === expected[name];
  if (!ok) pass = false;
  console.log((ok ? 'OK ' : 'BAD') + ' ' + name.padEnd(46) + ' got=' + got + ' expected=' + expected[name]);
}
process.exit(pass ? 0 : 1);
"
```

Failure here = pagination truncation or capture incomplete. Fix capture before continuing.

## Phase 4 — Map (run sync through the local pipeline)

mock-genius now serves the saved fixture. The adapter pulls from mock-genius; MappingEngine runs in-API.

```bash
# Start mock-genius NOT in recording mode, pointing at the new fixture
cd tools/mock-genius
MOCK_SCENARIO=stafford-snapshot-$DATE npm start

# Verify it serves all 5 endpoints
curl.exe -s http://localhost:8080/_mock/health
for e in JobEntity workOrderWithAdvancedInformationViewEntity productionTaskWithAdvancedInfoViewEntity machineAndRessourceEntity salesOrderDetailEntity; do
  curl.exe -s "http://localhost:8080/api/data/fetch/$e?pageSize=1&pageNumber=1" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('  $e total='+j.PagingInfos?.TotalElementsFound);});"
done
```

If `JobEntity` is missing from mock-genius's served list, add it to `GENIUS_ENTITIES` in `tools/mock-genius/src/server.ts` and rebuild — JobEntity was added 2026-06-07; future entities may need the same.

## Phase 5 — Dump CTP-shape data

Now the meat. The dump script runs the full mapping pipeline against mock-genius and writes the result to `config/tenants/stafford-engineering-test/data/`:

```bash
# From repo root
node scripts/dump-ctp-shape.js stafford-engineering-test
```

This:
1. Loads `FileConfigStore` for stafford-engineering-test
2. Constructs the same services the API uses (no Nest DI needed)
3. Runs `SyncService.sync()` → RestAdapter pulls from mock-genius → cross-filter drops inactive-Job records → MappingEngine produces CTP-shape data + WorkOrderGroups
4. Strips internal scratch fields (`_customerLabel`, `_customerSource`, `_familyLabel`) from groups
5. Derives `headWorkOrderKey` (self-referential WO) + `workOrderKeys` (member orders) per group
6. Stamps `hierarchies`+`attributes` from each group onto its member orders
7. Stamps `groupKey`+`hierarchies`+`attributes` from each order onto its member tasks
8. Writes 4 entity files: `orders.json`, `tasks.json`, `resources.json`, `workordergroups.json`
9. Computes + writes `horizon.json` (sibling to `data/`, not inside it): `start` = earliest group `sourceStart`, `maxDays` covers the latest group `sourceEnd`. `pastDueExtensionDays` is preserved from the prior config (it's operational tuning, not data-derived).

**Output shape parity:** matches `config/tenants/stafford-slim-100/data/*.json` exactly, so slim-100 (or any other file-tenant slicer) can derive from these without shape gymnastics. Slicers should re-derive their own `horizon.json` against the sliced dataset.

**Does NOT touch:** `calendars.json`, `state-changes.json`, `processes.json`, `products.json`, `materials.json`, `uom-conversions.json` — these come from disk (curated), not the adapter.

## Phase 6 — Validate via Inspector Excel

The inspector export is the human-readable verification layer:

```bash
curl.exe -H "X-Tenant-Id: stafford-engineering-test" \
  -o inspector-stafford-$DATE.xlsx \
  http://localhost:3000/v1/inspector/export
```

Open in Excel. The Jobs sheet should show `attr.Customer`, `attr.Family`, etc. populated. CustomerSource attribute should split ~98% `genius-master` / ~2% `auto-from-JobType` (the latter being JobType=I/U/Q overhead jobs that lack real customers).

## Phase 7 — Commit

```bash
# Stage entity files + auto-derived horizon (NOT the working-tree fixture
# in tools/mock-genius/fixtures/)
git add config/tenants/stafford-engineering-test/data/orders.json
git add config/tenants/stafford-engineering-test/data/tasks.json
git add config/tenants/stafford-engineering-test/data/resources.json
git add config/tenants/stafford-engineering-test/data/workordergroups.json
git add config/tenants/stafford-engineering-test/horizon.json

git commit -m "data(stafford): refresh CTP-shape from WORK7 $DATE capture"
```

The `tools/mock-genius/recorded/` and `tools/mock-genius/fixtures/stafford-snapshot-*/` directories stay gitignored — they contain real customer/employee names. Locally they live alongside; on push they don't go.

If you need teammates to reproduce, share the captured fixture out-of-band (Slack, secure file transfer) or have them re-capture via VPN.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Pagination counts off | Adapter pagination param names — should be `pageSize`/`pageNumber`, not `limit`/`pageIndex` (fixed in PR `f544c6d`) |
| Cross-filter drops everything | mock-genius isn't serving JobEntity (active-Job set empty); add to `GENIUS_ENTITIES` and rebuild |
| Mapping errors during dump | Check `result.errors` — usually a mapping rule references a field that's not in the new capture |
| File shape mismatch with slim-100 | Did the dump script's enrichment step run? Check console output for the "Enriching..." lines |
| Excel `attr.*` columns empty on Jobs sheet | `workordergroups.json` is missing or the rollup engine hasn't run — check that workordergroups.json has 279 records |
| `JobEntity total=0` from mock-genius probe | mock-genius `GENIUS_ENTITIES` list doesn't include JobEntity; edit `tools/mock-genius/src/server.ts` |

## What's deliberately deferred to feature-b

These show up in the walkthrough findings (`SPRINT-feature-b-{validation,normalization,enrichment}.md` on the `feature/staging-architecture` branch) and are NOT addressed by this playbook today:

- Per-Job `ShippingBufferDays` (currently a tenant constant: `bufferDays: 3` in `workordergroups.json`)
- Cross-filter at runtime → move to staging Phase 3 enrichment
- WO topological sequence + CTPLinkId precompute at staging time (engine does it at load today)
- Sanitization for publicly-committable fixtures
- Validation + normalization + enrichment as formal Phase-1/2/3 with reports
- `_validation-report.json`, `_normalization-report.json`, `_enrichment-report.json` sidecar artifacts
- Symlink-based atomic snapshot promotion with rollback

When feature-b ships, most of this playbook collapses into "run the staging pipeline; check the reports."
