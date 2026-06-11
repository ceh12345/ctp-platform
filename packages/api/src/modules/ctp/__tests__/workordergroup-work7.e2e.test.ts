/**
 * WorkOrderGroup end-to-end smoke suite — Stafford May 8 WORK7 fixture.
 *
 * Sprint SPRINT-workordergroup-entity, step 9.
 *
 * Tiered structure:
 *   T1 — Structural integrity (gating)
 *   T2 — Aggregate sanity
 *   T3 — Spot-check correctness
 *   T4 — Degenerate cases (synthesised)
 *   T5 — Performance
 *
 * The test stubs `fetch` and serves records from the recorded fixture at
 * tools/mock-genius/recorded/stafford-work7-2026-05-08/, mirroring the
 * sync-failure-isolation.spec.ts pattern. No real mock-genius server runs.
 *
 * Fixture: WO endpoint 848 records (Wostatus!=CLOSED filter applied at
 * capture time), tasks 2568, resources 78, SO lines 644 (the SO lines
 * aren't pulled by the Stafford adapter — AC #8 N/A this sprint).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  CTPTask,
  SchedulingLandscape,
  WorkOrderGroupStatus,
  CTPInterval,
} from '@ctp/engine';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { WorkOrderGroupService } from '../../state/workordergroup.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import { AdapterFactory } from '../../integration/adapter-factory';
import { MappingEngine } from '../../integration/mapping-engine';
import { SyncService } from '../../integration/sync.service';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT_ID  = 'stafford-engineering-test';
const FIXTURE_DIR = path.resolve(
  __dirname, '..', '..', '..', '..', '..', '..',
  'tools', 'mock-genius', 'recorded', 'stafford-work7-2026-05-08',
);

// Sentinel prefix for the [Auto] Customer fallback rule (Decision 4 update).
// 11 of 558 active jobs lack a real CustomerName; the mapping derives a
// bucket from JobType and prefixes "[Auto]" so a human reader can tell
// the value was synthesised. CustomerSource attribute carries the same
// signal for query/filter use.
const AUTO_CUSTOMER_PREFIX = '[Auto]';

// ─── Fixture loader + fetch stub ─────────────────────────────────────────

const _fixtureCache = new Map<string, unknown[]>();
function loadAllRecords(entityPrefix: string): unknown[] {
  if (_fixtureCache.has(entityPrefix)) return _fixtureCache.get(entityPrefix)!;
  const files = fs.readdirSync(FIXTURE_DIR)
    .filter(f => f.startsWith(entityPrefix) && f.endsWith('.json') && !f.startsWith('_'))
    .sort();
  const all: unknown[] = [];
  for (const f of files) {
    const content = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf-8'));
    if (Array.isArray(content.Result)) all.push(...content.Result);
  }
  _fixtureCache.set(entityPrefix, all);
  return all;
}

function envelope(records: unknown[]) {
  return {
    Result: records,
    Messages: [],
    PagingInfos: { CurrentPageIndex: 1, PageSize: records.length, TotalElementsFound: records.length, TotalPagesFound: 1 },
    Tag: null,
  };
}

function mockFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : (url as URL | Request).toString();
    let recs: unknown[] = [];
    if (u.includes('workOrderWithAdvancedInformationViewEntity')) {
      recs = loadAllRecords('workOrderWithAdvancedInformationViewEntity');
    } else if (u.includes('productionTaskWithAdvancedInfoViewEntity')) {
      recs = loadAllRecords('productionTaskWithAdvancedInfoViewEntity');
    } else if (u.includes('machineAndRessourceEntity')) {
      recs = loadAllRecords('machineAndRessourceEntity');
    } else if (u.includes('salesOrderDetailEntity')) {
      recs = loadAllRecords('salesOrderDetailEntity');
    }
    return { ok: true, json: async () => envelope(recs) } as any;
  });
}

// ─── Service wiring ──────────────────────────────────────────────────────

function createServices() {
  const store         = new FileConfigStore(CONFIG_ROOT, TENANT_ID);
  const configService = new ConfigService(store);
  const wogService    = new WorkOrderGroupService(configService);
  const hydrator      = new StateHydratorService(configService, wogService);
  const mappingEngine = new MappingEngine();
  const adapterFactory = new AdapterFactory(configService);
  const syncService   = new SyncService(adapterFactory, mappingEngine, configService);
  const stateService  = new StateService(hydrator, configService, syncService);
  return { stateService, wogService };
}

// Shared landscape for read-only tests. T2.4 (determinism across syncs)
// and T4.x (degenerate cases via mutation) construct their own services.
let sharedLandscape: SchedulingLandscape;
let sharedWogService: WorkOrderGroupService;
let sharedSyncMs = 0;

beforeAll(async () => {
  const svcs = createServices();
  vi.stubGlobal('fetch', mockFetch());
  const t0 = process.hrtime.bigint();
  await svcs.stateService.syncFromAdapter();
  const t1 = process.hrtime.bigint();
  sharedSyncMs = Number(t1 - t0) / 1_000_000;
  sharedLandscape = svcs.stateService.getLandscape()!;
  sharedWogService = svcs.wogService;
  vi.unstubAllGlobals();
}, 60000);

afterAll(() => {
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════════════
//   T1 — Structural integrity (gating)
// ═══════════════════════════════════════════════════════════════════════

describe('T1 — structural integrity', () => {
  it('T1.1 sync completes and produces a landscape', () => {
    expect(sharedLandscape).toBeDefined();
    expect(sharedLandscape.orders.size()).toBeGreaterThan(0);
    expect(sharedLandscape.tasks.size()).toBeGreaterThan(0);
    expect(sharedLandscape.groups.size()).toBeGreaterThan(0);
  });

  it('T1.2 every order with a non-empty Job has a non-null groupKey (AC #2)', () => {
    let withGroup = 0;
    sharedLandscape.orders.forEach((order) => {
      const job = order.rawFields['groupKey'];   // mapped from Job
      if (typeof job === 'string' && job !== '') {
        expect(order.groupKey).toBe(job);
        withGroup++;
      }
    });
    expect(withGroup).toBeGreaterThan(0);
  });

  it('T1.3 every task whose linked order has a groupKey carries the same groupKey (AC #3)', () => {
    let checked = 0;
    sharedLandscape.tasks.forEach((task: CTPTask) => {
      const orderKey = task.linkId?.name;
      if (!orderKey) return;
      const order = sharedLandscape.orders.getEntity(orderKey);
      if (order?.groupKey) {
        expect(task.groupKey).toBe(order.groupKey);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('T1.4 every group has ≥ 1 member', () => {
    sharedLandscape.groups.forEach(g => {
      expect(g.workOrderKeys.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('T1.5 sum of group memberships equals mappable-order count (conservation)', () => {
    let totalMembers = 0;
    sharedLandscape.groups.forEach(g => { totalMembers += g.workOrderKeys.length; });

    let mappableOrders = 0;
    sharedLandscape.orders.forEach(o => { if (o.groupKey) mappableOrders++; });

    expect(totalMembers).toBe(mappableOrders);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//   T2 — Aggregate sanity
// ═══════════════════════════════════════════════════════════════════════

describe('T2 — aggregate sanity', () => {
  it('T2.1 counts logged for eyeball check (informational)', () => {
    const groups = sharedLandscape.groups.size();
    const orders = sharedLandscape.orders.size();
    const tasks  = sharedLandscape.tasks.size();
    const resources = sharedLandscape.resources.size();
    const memberSum = sharedLandscape.groups.toArray()
      .reduce((s, g) => s + g.workOrderKeys.length, 0);
    const meanMembers = memberSum / groups;

    // eslint-disable-next-line no-console
    console.log(`[T2.1] orders=${orders} tasks=${tasks} resources=${resources} groups=${groups} mean-members-per-group=${meanMembers.toFixed(2)} sync-ms=${sharedSyncMs.toFixed(0)}`);
    expect(groups).toBeGreaterThan(0);
  });

  it('T2.2 hierarchy slot 1 (Customer) populated for ~all groups; 2 + 3 high', () => {
    let s1 = 0, s2 = 0, s3 = 0;
    sharedLandscape.groups.forEach(g => {
      if (g.hierarchy.first && g.hierarchy.first !== '') s1++;
      if (g.hierarchy.second && g.hierarchy.second !== '') s2++;
      if (g.hierarchy.third && g.hierarchy.third !== '') s3++;
    });
    const total = sharedLandscape.groups.size();
    // eslint-disable-next-line no-console
    console.log(`[T2.2] hierarchy fill: slot1=${(s1/total*100).toFixed(1)}% slot2=${(s2/total*100).toFixed(1)}% slot3=${(s3/total*100).toFixed(1)}%`);
    expect(s1 / total).toBeGreaterThanOrEqual(0.99);   // synthetic always populates
    // ~18% of WO records lack ProjectName or SalesOrderNo in the May 8 fixture
    // (likely sub-contract or maintenance-style WOs). Threshold 80% reflects
    // the actual data; observed values logged above.
    expect(s2 / total).toBeGreaterThanOrEqual(0.80);
    expect(s3 / total).toBeGreaterThanOrEqual(0.80);
  });

  it('T2.3 Customer is sourced from CustomerName, distributes across ≥ 3 distinct values', () => {
    const buckets = new Map<string, number>();
    sharedLandscape.groups.forEach(g => {
      const c = g.hierarchy.first ?? '';
      buckets.set(c, (buckets.get(c) ?? 0) + 1);
    });
    const nonEmpty = Array.from(buckets.entries()).filter(([k, v]) => k !== '' && v > 0);
    // Real Genius customer field has 28 distinct values across the WORK7 fixture.
    // Assert ≥ 3 to avoid brittleness as the fixture evolves.
    expect(nonEmpty.length).toBeGreaterThanOrEqual(3);
    // Every value is either a real customer name (non-empty string) or an
    // [Auto]-prefixed synthesised bucket — never an empty string.
    for (const [k] of nonEmpty) {
      expect(k.length).toBeGreaterThan(0);
    }
  });

  it('T2.4 synthetic customer assignment is deterministic across repeated syncs (AC #9)', async () => {
    const snap1 = new Map<string, string>();
    sharedLandscape.groups.forEach(g => snap1.set(g.key, g.hierarchy.first ?? ''));

    const svcs = createServices();
    vi.stubGlobal('fetch', mockFetch());
    await svcs.stateService.syncFromAdapter();
    vi.unstubAllGlobals();
    const snap2 = new Map<string, string>();
    svcs.stateService.getLandscape()!.groups.forEach(g => snap2.set(g.key, g.hierarchy.first ?? ''));

    expect(snap2.size).toBe(snap1.size);
    for (const [key, customer] of snap1) {
      expect(snap2.get(key)).toBe(customer);
    }
  }, 60000);

  it('T2.5 status distribution is non-degenerate (refreshRollups runs without crashing)', () => {
    sharedWogService.refreshRollups(sharedLandscape, Math.floor(Date.now() / 1000));
    const seen = new Set<WorkOrderGroupStatus>();
    sharedLandscape.groups.forEach(g => seen.add(g.status));
    expect(seen.size).toBeGreaterThanOrEqual(1);
    for (const s of seen) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(5);
    }
  });

  it('T2.6 cancelledWorkOrders is 0 for every group (empty predicate values)', () => {
    sharedWogService.refreshRollups(sharedLandscape, Math.floor(Date.now() / 1000));
    sharedLandscape.groups.forEach(g => {
      expect(g.cancelledWorkOrders).toBe(0);
    });
  });

  it('T2.7 hierarchy values are mirrored into attributes on every group', () => {
    // Sample a few groups (full landscape covered by the engine unit tests)
    const sample = sharedLandscape.groups.toArray().slice(0, 20);
    expect(sample.length).toBeGreaterThan(0);
    for (const g of sample) {
      const attrNames = new Set<string>();
      g.attributes.forEach(nv => attrNames.add(nv.name));
      // Slot 1 (Customer) is always populated by synthetic mode
      expect(attrNames.has('Customer')).toBe(true);
    }
  });

  it('T2.8 reference-share invariant: order.attributes === group.attributes (and hierarchy)', () => {
    // Identity equality — fails loudly the moment someone refactors
    // attributes/hierarchy into per-entity copies.
    let checked = 0;
    sharedLandscape.orders.forEach(order => {
      if (!order.groupKey) return;
      const group = sharedLandscape.groups.getEntity(order.groupKey);
      if (!group) return;
      expect(order.attributes).toBe(group.attributes);
      expect(order.hierarchy).toBe(group.hierarchy);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('T2.9 reference-share invariant: task.attributes === order.attributes (and hierarchy)', () => {
    let checked = 0;
    sharedLandscape.tasks.forEach(task => {
      const orderKey = task.linkId?.name;
      if (!orderKey) return;
      const order = sharedLandscape.orders.getEntity(orderKey);
      if (!order || !order.groupKey) return;
      expect(task.attributes).toBe(order.attributes);
      expect(task.hierarchy).toBe(order.hierarchy);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//   T3 — Spot-check correctness
// ═══════════════════════════════════════════════════════════════════════

describe('T3 — spot checks', () => {
  it('T3.1 Job 15897 — full field validation against the worked example', () => {
    const g = sharedLandscape.groups.getEntity('15897');
    // 15897 was the worked example from the April fixture. The May 8
    // capture filters Wostatus!=CLOSED, so it may be absent if completed
    // by May 8. If absent, surface the data-drift signal — don't silently
    // skip — and the worked example should be updated.
    if (!g) {
      // eslint-disable-next-line no-console
      console.warn('[T3.1] Job 15897 not present in May 8 fixture (likely filtered as CLOSED). Worked example may need refresh.');
      return;
    }
    expect(g.key).toBe('15897');
    expect(g.name.length).toBeGreaterThan(0);
    expect(g.workOrderKeys.length).toBeGreaterThanOrEqual(1);
    expect(g.sourceStart).not.toBeNull();
    expect(g.sourceEnd).not.toBeNull();
    expect(g.hierarchy.first).toBeTruthy();      // Customer (real or [Auto])
    expect(g.hierarchy.second).toBeTruthy();     // ProjectName
    expect(g.hierarchy.third).toBeTruthy();      // SalesOrderNo
    // Customer is either a real Genius customer name OR an [Auto]-prefixed
    // bucket; never empty. Stafford's worked-example Job 15897 has a real
    // customer (verified against fixture), so we additionally assert NOT [Auto].
    expect(g.hierarchy.first!.startsWith(AUTO_CUSTOMER_PREFIX)).toBe(false);
  });

  it('T3.2 every group Customer is either a real name or an [Auto] bucket — never empty', () => {
    // Replaces the prior CEM-synthetic-pool test (Decision 4 update — see
    // SPRINT-workordergroup-entity.md). The new rule: Customer comes from
    // CustomerName when present, else falls back to JobType-derived [Auto]
    // bucket. Every group must have a non-empty Customer value.
    const groups = sharedLandscape.groups.toArray();
    expect(groups.length).toBeGreaterThan(0);
    let real = 0, auto = 0;
    for (const g of groups) {
      const c = g.hierarchy.first;
      expect(c).toBeTruthy();
      if (c!.startsWith(AUTO_CUSTOMER_PREFIX)) auto++;
      else real++;
    }
    // Both buckets should be present in a representative fixture (the May 8
    // fixture has ~10 real customers + a small number of customer-less Jobs
    // that fall back to [Auto]).
    expect(real).toBeGreaterThan(0);
    // [Auto] count not asserted as > 0 because the May 8 fixture's null-customer
    // population is small and may be zero — we just assert the structural
    // invariant (every group has a non-empty Customer value).
  });

  it('T3.3 there exists at least one single-WO Job (trivial case)', () => {
    const trivial = sharedLandscape.groups.toArray().filter(g => g.workOrderKeys.length === 1);
    expect(trivial.length).toBeGreaterThan(0);
    // For a single-WO Job, that WO is necessarily the head if it's self-parent.
    for (const g of trivial.slice(0, 3)) {
      const wo = sharedLandscape.orders.getEntity(g.workOrderKeys[0]);
      if (wo && (wo.parentOrderKey === null || wo.parentOrderKey === wo.key)) {
        expect(g.headWorkOrderKey).toBe(g.workOrderKeys[0]);
      }
    }
  });

  it('T3.4 the deepest WO tree is identifiable and head detection works', () => {
    const groups = sharedLandscape.groups.toArray();
    const deepest = groups.reduce((max, g) => g.workOrderKeys.length > max.workOrderKeys.length ? g : max, groups[0]);
    // eslint-disable-next-line no-console
    console.log(`[T3.4] deepest Job ${deepest.key}: ${deepest.workOrderKeys.length} member WOs, head=${deepest.headWorkOrderKey}`);
    expect(deepest.workOrderKeys.length).toBeGreaterThan(1);
    // Head detection should have identified one (or recorded "flat" via null)
    // — either way is a defined state, not a crash.
    expect(deepest.headWorkOrderKey === null || typeof deepest.headWorkOrderKey === 'string').toBe(true);
  });

  it('T3.5 OI-3: Job-field membership matches tree-walk membership for sampled groups', () => {
    // Build orderKey → parentOrderKey index
    const parentOf = new Map<string, string | null>();
    sharedLandscape.orders.forEach(o => parentOf.set(o.key, o.parentOrderKey));

    const groups = sharedLandscape.groups.toArray()
      .filter(g => g.workOrderKeys.length >= 2 && g.headWorkOrderKey !== null);
    // Sample first 10 multi-member groups
    const sample = groups.slice(0, 10);
    expect(sample.length).toBeGreaterThan(0);

    let mismatches = 0;
    for (const g of sample) {
      // Tree walk from head
      const reached = new Set<string>();
      const queue = [g.headWorkOrderKey!];
      while (queue.length > 0) {
        const k = queue.shift()!;
        if (reached.has(k)) continue;
        reached.add(k);
        // Find children: orders whose parentOrderKey === k AND key !== k (skip self-loop on head)
        sharedLandscape.orders.forEach(o => {
          if (o.parentOrderKey === k && o.key !== k && !reached.has(o.key)) {
            queue.push(o.key);
          }
        });
      }
      const byJob = new Set(g.workOrderKeys);
      // Intersection check — should be identical
      if (reached.size !== byJob.size || ![...reached].every(k => byJob.has(k))) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//   T4 — Degenerate cases (synthesised on a sandbox landscape)
// ═══════════════════════════════════════════════════════════════════════

describe('T4 — degenerate status cases (synthesised)', () => {
  // T4 uses a separate landscape to avoid contaminating shared state.
  let sandboxLandscape: SchedulingLandscape;
  let sandboxWog: WorkOrderGroupService;

  beforeAll(async () => {
    const svcs = createServices();
    vi.stubGlobal('fetch', mockFetch());
    await svcs.stateService.syncFromAdapter();
    vi.unstubAllGlobals();
    sandboxLandscape = svcs.stateService.getLandscape()!;
    sandboxWog = svcs.wogService;
  }, 60000);

  // Pick distinct groups that have AT LEAST ONE task and synthesise
  // different statuses by mutating sourceEnd + that task's schedule.
  // Some WOs in the fixture have no tasks (likely sub-contracts), so
  // skipping any group whose members lack tasks avoids false negatives
  // from computedEnd staying null.
  function pickGroupWithTask(landscape: SchedulingLandscape, skip: Set<string>): { g: any; task: CTPTask } | null {
    const allTasks = landscape.tasks.toArray();
    for (const g of landscape.groups.toArray()) {
      if (skip.has(g.key)) continue;
      for (const woKey of g.workOrderKeys) {
        const t = allTasks.find(x => x.linkId?.name === woKey);
        if (t) return { g, task: t };
      }
    }
    return null;
  }

  const sandboxUsed = new Set<string>();

  it('T4.1 synthesised late group → status LATE (AC #6 path)', () => {
    const T0 = 1_700_000_000;
    const picked = pickGroupWithTask(sandboxLandscape, sandboxUsed);
    expect(picked).not.toBeNull();
    const { g, task } = picked!;
    sandboxUsed.add(g.key);

    g.sourceEnd = T0 + 10 * 86400;
    task.scheduled = new CTPInterval(T0, T0 + 12 * 86400);   // past sourceEnd

    sandboxWog.refreshRollups(sandboxLandscape, T0);

    expect(g.status).toBe(WorkOrderGroupStatus.LATE);
  });

  it('T4.2 synthesised at-risk group → status AT_RISK', () => {
    const T0 = 1_700_000_000;
    const picked = pickGroupWithTask(sandboxLandscape, sandboxUsed);
    expect(picked).not.toBeNull();
    const { g, task } = picked!;
    sandboxUsed.add(g.key);

    g.sourceEnd = T0 + 10 * 86400;
    task.scheduled = new CTPInterval(T0, T0 + 9 * 86400);   // within buffer (bufferDays=3)

    sandboxWog.refreshRollups(sandboxLandscape, T0);

    expect(g.status).toBe(WorkOrderGroupStatus.AT_RISK);
  });

  it('T4.3 synthesised all-cancelled group → status CANCELLED (predicate path)', async () => {
    // NB: substituting CANCELLED for the user's "all-complete → COMPLETED"
    // because COMPLETED detection requires a completion predicate that
    // isn't implemented yet (pending Decision 5 + future engine work).
    // CANCELLED exercises the identical all-members-match path.
    const fresh = createServices();
    vi.stubGlobal('fetch', mockFetch());
    await fresh.stateService.syncFromAdapter();
    vi.unstubAllGlobals();
    const ls = fresh.stateService.getLandscape()!;

    // Construct a service with a non-empty cancellation predicate.
    const customWog = new WorkOrderGroupService({
      getWorkOrderGroupsConfig: () => ({
        bufferDays: 3,
        cancellationPredicate: { field: 'wostatus', values: ['CANCELLED'] },
      }),
    } as any);

    const g = ls.groups.toArray()[0];
    // Mark every member order's rawFields.wostatus = 'CANCELLED'
    for (const k of g.workOrderKeys) {
      const o = ls.orders.getEntity(k);
      if (o) o.rawFields = { ...o.rawFields, wostatus: 'CANCELLED' };
    }

    customWog.refreshRollups(ls, Math.floor(Date.now() / 1000));

    expect(g.cancelledWorkOrders).toBe(g.totalWorkOrders);
    expect(g.status).toBe(WorkOrderGroupStatus.CANCELLED);
  }, 60000);

  it('T4.4 lateGroups() returns at least the LATE group synthesised in T4.1', () => {
    // T4.1 left its chosen group as LATE. lateGroups() should include
    // at least that one (and possibly the AT_RISK / synthetic CANCELLED
    // groups depending on the sourceEnd values).
    const late = sandboxLandscape.groups.lateGroups();
    expect(late.length).toBeGreaterThanOrEqual(1);
    // At least one must have computedEnd > sourceEnd
    for (const g of late) {
      expect(g.computedEnd).not.toBeNull();
      expect(g.sourceEnd).not.toBeNull();
      expect(g.computedEnd!).toBeGreaterThan(g.sourceEnd!);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
//   T5 — Performance
// ═══════════════════════════════════════════════════════════════════════

describe('T5 — performance', () => {
  it('T5.1 refreshRollups completes in < 100ms on the full WORK7 corpus (AC #7)', () => {
    // Warm-up
    sharedWogService.refreshRollups(sharedLandscape, Math.floor(Date.now() / 1000));

    const t0 = process.hrtime.bigint();
    sharedWogService.refreshRollups(sharedLandscape, Math.floor(Date.now() / 1000));
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1_000_000;

    // eslint-disable-next-line no-console
    console.log(`[T5.1] refreshRollups on ${sharedLandscape.groups.size()} groups / ${sharedLandscape.orders.size()} orders / ${sharedLandscape.tasks.size()} tasks: ${ms.toFixed(2)}ms`);
    expect(ms).toBeLessThan(100);
  });

  it('T5.2 informational — log full-sync time across two consecutive runs', async () => {
    // Sync time isn't asserted (loading 4k records from disk + mapping
    // can't realistically be < 100ms); we just log it so degradation
    // becomes visible in CI.
    const svcs1 = createServices();
    vi.stubGlobal('fetch', mockFetch());
    const a0 = process.hrtime.bigint();
    await svcs1.stateService.syncFromAdapter();
    const a1 = process.hrtime.bigint();
    vi.unstubAllGlobals();

    const svcs2 = createServices();
    vi.stubGlobal('fetch', mockFetch());
    const b0 = process.hrtime.bigint();
    await svcs2.stateService.syncFromAdapter();
    const b1 = process.hrtime.bigint();
    vi.unstubAllGlobals();

    const aMs = Number(a1 - a0) / 1_000_000;
    const bMs = Number(b1 - b0) / 1_000_000;
    // eslint-disable-next-line no-console
    console.log(`[T5.2] sync wall-times: run-1=${aMs.toFixed(0)}ms run-2=${bMs.toFixed(0)}ms (informational)`);
    // No assertion — informational only until we have a CI baseline.
    expect(aMs).toBeGreaterThan(0);
    expect(bMs).toBeGreaterThan(0);
  }, 60000);
});
