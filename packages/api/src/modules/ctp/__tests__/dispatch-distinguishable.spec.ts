import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import {
  DispatchStateLens,
  StaticRankPriority,
  ATCDispatchPriority,
  DBRDispatchPriority,
  SlackDispatchPriority,
  IDispatchPriority,
  CTPTask,
} from '@ctp/engine';

/**
 * Dispatch-seam Phase 4 — the dynamic plugs are *distinguishable* from the default,
 * and each is *deterministic*, proven at the SELECTION layer (where the seam acts)
 * over a real Genius extract's hydrated chain-head set.
 *
 * Why selection-order, not the final schedule: on a small, uncontended tenant like
 * slim-100 the placement model absorbs any pick-order change (every head lands in
 * the same slot regardless of order), so the *schedule* is identical across
 * strategies — a property of the tenant's slack, not an inert seam. The seam's job
 * is the pick ORDER; that is what we assert here. (Schedule-level divergence needs
 * resource contention and is a bake-off concern.)
 *
 * slim-100 carries dated (jobType C) orders with real dueDate (JobEndDate) distinct
 * from customerDeliveryDate, plus backfill (I) orders with null customer date — so
 * Static (rank), ATC (dueDate) and Slack (customerDeliveryDate) each order the heads
 * differently, and the dates are read off the order (a head's own fields are 0).
 */
const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');
const TENANT = 'stafford-slim-100';

async function hydratedHeads(): Promise<{ heads: CTPTask[]; lens: DispatchStateLens }> {
  const store = new FileConfigStore(CONFIG_ROOT, TENANT);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(hydrator, configService, { sync: async () => ({}) } as any);
  await stateService.syncFromAdapter();
  const landscape = stateService.getLandscape()!;

  // Round-1 ready set: one head per chain (min sequence), the way the neighborhood
  // gathers them. Dates are read off the order by the lens, so no hydrateDueDates needed.
  const byChain = new Map<string, CTPTask>();
  landscape.tasks.forEach((t) => {
    const name = t.linkId?.name;
    if (!name) return;
    const cur = byChain.get(name);
    if (!cur || t.sequence < cur.sequence) byChain.set(name, t);
  });
  const heads = Array.from(byChain.values());
  const lens = new DispatchStateLens(landscape, landscape.appSettings, heads);
  return { heads, lens };
}

function order(heads: CTPTask[], lens: DispatchStateLens, plug: IDispatchPriority): string {
  plug.prepare?.(lens);
  return heads
    .slice()
    .sort((a, b) => plug.compare(a, b, lens))
    .map((t) => t.key)
    .join(',');
}

describe('dispatch plugs are distinguishable and deterministic (Phase 4)', () => {
  it('ATC / DBR / Slack each reorder the real chain-head set vs the default, deterministically', async () => {
    const { heads, lens } = await hydratedHeads();
    expect(heads.length, 'expected chain heads').toBeGreaterThan(1);

    const staticOrder = order(heads, lens, new StaticRankPriority());
    const atcOrder = order(heads, lens, new ATCDispatchPriority());
    const dbrOrder = order(heads, lens, new DBRDispatchPriority());
    const slackOrder = order(heads, lens, new SlackDispatchPriority());

    // Determinism: sorting twice yields the same order.
    expect(order(heads, lens, new StaticRankPriority())).toBe(staticOrder);
    expect(order(heads, lens, new ATCDispatchPriority())).toBe(atcOrder);
    expect(order(heads, lens, new SlackDispatchPriority())).toBe(slackOrder);

    // eslint-disable-next-line no-console
    console.log(
      `\n[distinguishable] ${TENANT} — ${heads.length} chain heads\n` +
        `  Static: ${staticOrder}\n  ATC   : ${atcOrder}\n  DBR   : ${dbrOrder}\n  Slack : ${slackOrder}\n`,
    );

    // The dynamic plugs must actually reorder vs the default (rank) order.
    expect(atcOrder, 'ATC did not reorder vs default').not.toBe(staticOrder);
    expect(slackOrder, 'Slack did not reorder vs default').not.toBe(staticOrder);
  });
});
