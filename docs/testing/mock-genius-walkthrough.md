# Mock-Genius Stack Walkthrough

End-to-end test scenarios that exercise the full CTP + mock-genius stack
without needing Stafford VPN. Use this as a manual-test checklist after
non-trivial adapter, mapping-engine, or mock changes, and as a demo script
when showing stakeholders "what happens when Genius misbehaves."

**Status:** living document. Update as new scenarios surface.

---

## Prerequisites

- Monorepo cloned + `npm install` run at root and in `tools/mock-genius/`
- Engine + API built: `rm -rf packages/engine/dist && npm run build --workspace=@ctp/engine && npm run build --workspace=@ctp/api`
- Ports free: 3000 (API), 3001 (Web), 8080 (mock)

### Stack startup

Three terminals:

```bash
# Terminal 1 — mock-genius
cd tools/mock-genius && npm run dev

# Terminal 2 — API
npm run start:dev --workspace=@ctp/api

# Terminal 3 — Web
npm run dev --workspace=@ctp/web
```

Sanity-check:

```bash
curl http://localhost:8080/_mock/health              # → {"status":"ok","scenario":"stafford-snapshot-2026-06-03"}
curl http://localhost:3000/v1/health/version          # → version info
curl http://localhost:3001                           # → Vite HTML
```

Open `http://localhost:3001/?tenant=stafford-engineering-test` in the browser.
The UI fires `/ctp/solve-and-sync` on load, which routes through the mock.

### Reset helpers

Between scenarios, reset the mock to a known state:

```bash
curl -X POST http://localhost:8080/_mock/reset
```

This clears all injected failures and restores scenario to the default (`stafford-snapshot-2026-06-03`).

---

## Scenario 1 — Happy-path integration

**Goal:** confirm the entire pipeline works before adding any failures.

```bash
curl -X POST http://localhost:8080/_mock/reset
curl -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test"
curl http://localhost:3000/v1/ctp/state?detailLevel=intermediate | head -40
```

**Expected:**
- Sync returns `201` with summary showing `tasks: 30, resources: 28`
- `/ctp/state` returns tasks with Z-suffixed UTC dates (no `+13:00`)
- UI renders a Gantt with chains for PV-001, EQ-001, MC-001, etc.

**If this fails:** stack is broken. Stop and diagnose before moving on.

---

## Scenario 2 — Failure injection smoke

**Goal:** confirm each error type the adapter must handle produces a clean result.

For each row below: inject → trigger sync → observe API log + response.

```bash
INJECT() { curl -s -X POST http://localhost:8080/_mock/inject-failure \
  -H "Content-Type: application/json" -d "$1" ; echo; }
SYNC() { curl -s -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test" ; echo; }
```

| # | Inject | Sync response | Log should show |
|---|---|---|---|
| 2a | `INJECT '{"endpoint":"*","failureType":"500","count":1}' && SYNC` | Succeeds (retry worked) | `HTTP 500` once, then `200` |
| 2b | `INJECT '{"endpoint":"*","failureType":"500","count":10}'  && SYNC` | 500 after retries exhausted | 3× `HTTP 500` with backoff |
| 2c | `INJECT '{"endpoint":"*","failureType":"401"}' && SYNC` | 500 immediately | `HTTP 401 Unauthorized fetching …` (no retry spam) |
| 2d | `INJECT '{"endpoint":"*","failureType":"403"}' && SYNC` | 500 immediately | `HTTP 403 Forbidden fetching …` |
| 2e | `INJECT '{"endpoint":"*","failureType":"timeout","timeoutMs":500}' && SYNC` | 500 after timeout | `Timeout after <N>ms fetching …` |
| 2f | `INJECT '{"endpoint":"*","failureType":"malformed-json"}' && SYNC` | 500 | `Invalid JSON from …` |
| 2g | `INJECT '{"endpoint":"*","failureType":"429"}' && SYNC` | 500 after retries | Retried as transient |

Cleanup: `curl -X POST http://localhost:8080/_mock/reset`.

---

## Scenario 3 — Bad-data scenarios

**Goal:** probe how the mapping engine handles ugly inputs before Stafford data arrives.

For each: switch scenario → sync → inspect what the mapping produced.

```bash
SWITCH() { curl -s -X POST http://localhost:8080/_mock/scenario \
  -H "Content-Type: application/json" -d "{\"scenario\":\"$1\"}" ; echo; }
STATE() { curl -s http://localhost:3000/v1/ctp/state?detailLevel=diagnostic ; }
```

### 3a — `bad-data-null-machine`

First task has `MachineCode: null`.

```bash
SWITCH bad-data-null-machine
curl -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test"
STATE | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  const first = (r.tasks||[])[0];
  console.log('key:', first?.key);
  console.log('capacityResources:', JSON.stringify(first?.capacityResources || first?.assignedResources));
});"
```

**Look for:** does the task land with empty `capacityResources`? Does it get flagged as infeasible? Does the mapping crash? All three are interesting outcomes — the code's current behavior should be predictable.

### 3b — `bad-data-missing-priority`

First order has `Strategy` field absent.

```bash
SWITCH bad-data-missing-priority
curl -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test"
STATE | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  const first = (r.orders||[])[0];
  console.log('first order key:', first?.key);
  console.log('first order priority:', first?.priority, '← should be 50 (_default fallback)');
});"
```

**Look for:** priority is `50` (the `_default` in the lookup table). If it's `undefined`, the lookup fallback is broken.

### 3c — `bad-data-unparseable-date`

Fixture has three bad-date variants across the first three tasks: `"not-a-date"` (garbage string), `"2026-02-31"` (valid shape, invalid calendar), `""` (empty string). Plus the usual `null`s downstream.

```bash
SWITCH bad-data-unparseable-date
SYNC=$(curl -s -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test")
echo "$SYNC" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  console.log('mappingErrors:', r.mappingErrors?.length, 'rawValues:', JSON.stringify(r.mappingErrors?.map(e=>e.rawValue)));
  console.log('validationSummary:', JSON.stringify(r.validationSummary));
});"
STATE | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  (r.tasks||[]).slice(0,3).forEach(t => {
    console.log(t.key, 'schedulable:', t.schedulable, 'validationErrors:', t.validationErrors?.length);
  });
});"
```

**Look for (post-Sprint 1b):**
- `/v1/state/sync` returns 201 (never 500). `mappingErrors` contains entries for `"not-a-date"` and `"2026-02-31"` (the two that reach `toUTC`). Empty string is silently skipped — correct semantic (opt-out of validation when the profile doesn't set `fromTimezone` or the input is truly empty).
- `/v1/ctp/state` returns 200. The first two tasks have `validationErrors: [{type: UNPARSEABLE_DATE, field: 'windowStart', rawValue: ...}]` and `schedulable: false`. Third task (empty-string variant) has no validation error and `schedulable: true` — falls back to the horizon window silently.
- `validationSummary` shows `recordsWithErrors: 2, unschedulableTasks: 2, byCode: {UNPARSEABLE_DATE: 2}`.
- Sprint 1b's defense-in-depth: even if `toUTC` passed a garbage string through (e.g. bare-garbage with no `fromTimezone`), the hydrator's `parseIsoDateOrRecord` helper still catches it and attaches the entity-level error before arithmetic can fire.

### 3d — `chain-cycle`

Two tasks in same `WorkOrderCode` share the same `SequenceNumber`.

```bash
SWITCH chain-cycle
curl -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test"
STATE | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  const pv = (r.tasks||[]).filter(t => t.linkId?.name === 'PV-001');
  pv.forEach(t => console.log(t.key, '→ prev:', t.linkId?.prevLink, 'type:', t.linkId?.type));
});"
```

**Look for:** do both duplicate-sequence tasks end up with the same `prevLink`? That's technically wrong (would mean the chain branches) but won't crash. The real question is whether it produces a schedulable chain or triggers a cycle in the solver.

### 3e — `orphan-resource`

Active task `PV-001-FLANGE` references `MachineCode: "MACHINE-DOES-NOT-EXIST-999"` — moved off the completed setup task in Sprint 1b so the symptom actually manifests on a schedulable task.

```bash
SWITCH orphan-resource
curl -s -X POST http://localhost:3000/v1/state/sync -H "X-Tenant-Id: stafford-engineering-test" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  console.log('validationSummary:', JSON.stringify(r.validationSummary));
});"
curl -s -X POST http://localhost:3000/v1/ctp/solve-and-sync -H "X-Tenant-Id: stafford-engineering-test" \
  -H "Content-Type: application/json" -d '{}' | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  const t = (r.tasks||[]).find(x => x.key === 'PV-001-FLANGE');
  console.log('state:', t?.state, '(0=not-scheduled)');
  console.log('schedulable:', t?.schedulable);
  console.log('validationErrors:', JSON.stringify(t?.validationErrors));
});"
# Where-To should refuse placement
curl -s -X POST 'http://localhost:3000/v1/ctp/tasks/PV-001-FLANGE/where-to' \
  -H "X-Tenant-Id: stafford-engineering-test" -H "Content-Type: application/json" -d '{}' | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);
  console.log('options:', r.options?.length, 'reason:', r.reason);
  console.log('validationErrors on Where-To response:', r.validationErrors?.length);
});"
```

**Look for (post-Sprint 1b):**
- `validationSummary.byCode: {ORPHAN_RESOURCE: 1}`, `unschedulableTasks: 1`
- `PV-001-FLANGE`: `state: 0, schedulable: false, validationErrors: [{type: ORPHAN_RESOURCE, field: 'capacityResources[0].resource', rawValue: 'MACHINE-DOES-NOT-EXIST-999'}]`
- Where-To: `options: []`, `reason: "Task has unresolved validation errors (ORPHAN_RESOURCE) — fix the source data and re-sync"`, `validationErrors` populated with structured context. Move-To on the same task returns `{success: false, suggestRefresh: true, validationErrors: [...]}`.
- UI (reload `http://localhost:3001/?tenant=stafford-engineering-test` with the scenario active): right-click PV-001-FLANGE on the Gantt → "Where to?" → red card showing `ORPHAN_RESOURCE` + field path + raw value + reason, instead of a false placement or a generic "No feasible options found".

Historical note: `0b98bd1`'s all-filtered guard already prevented the silent-SCHEDULED-with-empty-assignedResources symptom before Sprint 1b; what Sprint 1b added is the operator-visible diagnostic signal (previously the task just failed to schedule with no hint why).

Cleanup: `curl -X POST http://localhost:8080/_mock/reset`.

---

## Scenario 4 — Pagination

**Goal:** confirm the adapter loops through multiple pages and stitches results.

The adapter's pageSize is set in the tenant's `adapter.json`. To force pagination without editing config, hit the mock directly:

```bash
SWITCH stafford-clean
curl -s "http://localhost:8080/api/data/fetch/productionTaskWithAdvancedInfoViewEntity?limit=5&pageIndex=1" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const r=JSON.parse(d);
      console.log('page 1:', r.Result.length, 'records');
      console.log('TotalPagesFound:', r.PagingInfos.TotalPagesFound);
    });"
```

**Look for:** page 1 returns ≤5 records, `TotalPagesFound` > 1 (stafford-clean has 30 tasks so at `limit=5` → 6 pages).

For a full adapter pagination test, temporarily edit `config/tenants/stafford-engineering-test/integration/adapter.json` setting `tasks.pageSize` to `5`, then re-sync. Revert after.

---

## Scenario 5 — Recording mode dry-run (no VPN)

**Goal:** exercise the capture path against a public HTTP echo service before committing VPN time.

```bash
# Stop the playback-mode mock (Terminal 1, Ctrl+C). Restart in record mode:
cd tools/mock-genius
MOCK_RECORD_FROM=https://httpbin.org/anything npm run dev
# Banner must say "Mode: RECORDING"

# Hit a Genius endpoint — mock proxies to httpbin, httpbin echoes, mock saves
curl "http://localhost:8080/api/data/fetch/salesOrderDetailEntity?limit=5&pageIndex=1"

# Inspect state + metadata
curl http://localhost:8080/_mock/state | node -e "..."
cat recorded/*/_metadata.json

# Confirm control endpoints are gated
curl -X POST http://localhost:8080/_mock/scenario -H "Content-Type: application/json" -d '{"scenario":"empty"}' -w "\n%{http_code}\n"
# → 409
```

**Look for:**
- File at `recorded/<timestamp>/salesOrderDetailEntity.json` with the full httpbin response
- `_metadata.json` populated with `status`, `durationMs`, `queryParams`
- `/_mock/scenario` returns 409
- Banner clearly said `Mode: RECORDING`

Cleanup: Ctrl+C the mock, `rm -rf tools/mock-genius/recorded`, restart in normal mode.

---

## Scenario 6 — Sanitization + promotion dry-run

**Goal:** rehearse the capture→promote→serve loop so the real Stafford VPN session is muscle memory.

Starting from the Scenario 5 recording:

```bash
cd tools/mock-genius

# Copy the raw capture into a throwaway scenario
cp -r recorded/* fixtures/dry-run-snapshot

# Strip envelopes + merge paged files
node scripts/strip-envelope.js fixtures/dry-run-snapshot

# Fixture should now contain just arrays, not {Result:...} envelopes
cat fixtures/dry-run-snapshot/salesOrderDetailEntity.json | head

# Serve from the promoted scenario
MOCK_SCENARIO=dry-run-snapshot npm run dev
curl http://localhost:8080/_mock/state

# Cleanup
# Ctrl+C mock, then:
rm -rf fixtures/dry-run-snapshot recorded/*
```

**Look for:**
- `strip-envelope.js` logs what it did per file
- Promoted scenario serves without errors
- `/_mock/state` shows `scenario: dry-run-snapshot`

When this works end-to-end without surprises, the real VPN session will be smooth.

---

## Out of scope (not yet testable)

- **Real Stafford data shape discovery.** Only hand-crafted fixtures exist until the first VPN capture.
- **`toUTC` with bare dates.** Stafford data has `+13:00` offsets — we haven't exercised the `fromTimezone` config option in a live tenant yet. Can force-test by removing offsets from a fixture.
- **Large-payload performance.** No synthetic large dataset yet; queue item #4 is deferred.
- **UI behavior under REST errors.** Trigger a failure, see how the React UI renders the error banner/toast.
- **Cold-start timing.** How fast does the full sync→solve→render take against a real Stafford dataset? Can't measure until we have real data.

---

## When something breaks

- **Adapter-level bug** → look at `packages/api/src/modules/integration/rest-adapter.ts` and check the API log for the full stack trace. Error messages now include endpoint URL + cause.
- **Mapping bug** → `packages/api/src/modules/integration/mapping-engine.ts`. 49 unit tests cover common cases; add a new scenario if you find a gap.
- **Solver infeasibility** → `packages/engine/AI/Schedulers/basescheduler.ts`. Check `task.errors` in the `/ctp/state` response.
- **Mock itself** → `tools/mock-genius/src/`. 41 tests cover playback + recording. `cd tools/mock-genius && npm test`.
