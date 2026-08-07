/**
 * Precedence-violation regression gate.
 *
 * A successor must not start before its predecessor's work is complete. This
 * counts the cases where that is violated on the chain baseline and holds the
 * line at the current known count, so the FLOAT backward-walk fix in
 * `findLatestFeasibleStartForPred` cannot silently regress.
 *
 * Two classes, deliberately counted separately:
 *
 *  - SELF-LOOP — `linkId.prevLink === task.key`. A task is its own
 *    predecessor, so it "starts before it ends" by definition. These are
 *    SOURCE DATA defects (8 exist in slim-500) and no scheduler change can
 *    fix them; nothing in hydration currently rejects a length-1 cycle.
 *
 *  - GENUINE — a real predecessor finishing after its successor starts. Every
 *    one observed had a FLOAT predecessor whose scheduled span exceeded its
 *    work content, because the backward walk inverted a calendar walk with
 *    flat arithmetic (`succStart - duration`). Fixed for most; a residue
 *    remains, hence the threshold rather than zero.
 *
 * Anchored pairs (pinned, or already started) are excluded: Pass 1 places
 * committed work at its ACTUAL position and real shop floors do start
 * operations out of order, so those overlaps are history rather than a
 * scheduling decision.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { existsSync } from 'fs';
import { StateService } from '../../state/state.service';
import { StateHydratorService } from '../../state/state-hydrator.service';
import { ConfigService } from '../../../config/config.service';
import { FileConfigStore } from '../../../config/file-config-store';
import {
  CTPScheduler, CTPScoring, CTPScoringConfiguration, List, CTPTask,
  CTPTaskStateConstants,
} from '@ctp/engine';

const CONFIG_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');

interface Violation {
  succ: string; pred: string; chain: string;
  selfLoop: boolean; overlapSec: number;
  predWorkSec: number; predSpanSec: number;
}

async function findViolations(tenantId: string): Promise<Violation[]> {
  const store = new FileConfigStore(CONFIG_ROOT, tenantId);
  const configService = new ConfigService(store);
  const hydrator = new StateHydratorService(configService);
  const stateService = new StateService(
    hydrator, configService, { sync: async () => ({}) } as any,
  );
  await stateService.syncFromAdapter();
  const landscape: any = stateService.getLandscape()!;

  const sc = configService.getScoring()!;
  const scoring = new CTPScoring(sc.name, sc.key);
  for (const r of sc.rules) {
    const c = new CTPScoringConfiguration(r.ruleName, r.weight, r.objective);
    c.includeInSolve = r.includeInSolve;
    c.penaltyFactor = r.penaltyFactor;
    scoring.addConfig(c);
  }
  landscape.appSettings.solverStrategy = 'Chain';

  const scheduler = new CTPScheduler();
  scheduler.initLandscape(
    landscape.horizon, landscape.tasks, landscape.resources,
    landscape.stateChanges, landscape.processes,
  );
  scheduler.initSettings(landscape.appSettings);
  scheduler.initScoring(scoring);

  const list = new List<CTPTask>();
  landscape.tasks.forEach((t: any) => list.add(t));
  scheduler.schedule(list);

  const byKey = new Map<string, any>();
  landscape.tasks.forEach((t: any) => byKey.set(t.key, t));

  const anchored = (x: any) =>
    !!x.pinned || (x.wipstate !== undefined && x.wipstate !== 0);

  const out: Violation[] = [];
  landscape.tasks.forEach((t: any) => {
    if (t.state !== CTPTaskStateConstants.SCHEDULED || !t.scheduled) return;
    const pk = t.linkId?.prevLink;
    if (!pk) return;
    const p = byKey.get(pk);
    if (!p || p.state !== CTPTaskStateConstants.SCHEDULED || !p.scheduled) return;
    if (anchored(t) || anchored(p)) return;
    if (t.scheduled.startW >= p.scheduled.endW) return;

    out.push({
      succ: t.key, pred: p.key, chain: t.linkId?.name,
      selfLoop: pk === t.key,
      overlapSec: p.scheduled.endW - t.scheduled.startW,
      predWorkSec: p.duration?.duration?.() ?? 0,
      predSpanSec: p.scheduled.endW - p.scheduled.startW,
    });
  });
  return out;
}

describe('precedence violations — chain baseline', () => {
  /**
   * Thresholds record the state AFTER the FLOAT backward-walk fix. They are a
   * ratchet, not a target: if a change drives either number down, tighten them.
   * A rise means a regression and should be investigated, not accommodated.
   */
  const KNOWN_SELF_LOOPS = 3;
  const KNOWN_GENUINE = 4;

  /**
   * stafford-slim-500 has ZERO tracked files — it is a local-only slice, unlike
   * stafford-slim-100 which is committed. Guard rather than assume, so a fresh
   * clone does not fail on a tenant that was never in the repo. Announced, not
   * silent: a skipped gate that looks like a pass is worse than a red one.
   */
  const hasTenant = (t: string) =>
    existsSync(path.join(CONFIG_ROOT, 'tenants', t, 'data', 'tasks.json'));

  it('stafford-slim-100 has no genuine violations', async () => {
    const v = await findViolations('stafford-slim-100');
    const genuine = v.filter(x => !x.selfLoop);
    if (genuine.length > 0) {
      console.log('genuine violations:', JSON.stringify(genuine, null, 2));
    }
    expect(genuine.length).toBe(0);
  }, 600_000);

  it('stafford-slim-500 stays at or below the known violation counts', async () => {
    if (!hasTenant('stafford-slim-500')) {
      console.log(
        '\n[precedence] SKIPPED stafford-slim-500 — tenant not present. It is a ' +
        'local-only slice with no tracked files, so this gate does not run on a ' +
        'fresh clone.\n',
      );
      return;
    }
    const v = await findViolations('stafford-slim-500');
    const selfLoops = v.filter(x => x.selfLoop);
    const genuine = v.filter(x => !x.selfLoop);

    console.log(
      `\n[precedence] slim-500: ${v.length} total — ` +
      `${selfLoops.length} self-loop (source data), ${genuine.length} genuine`,
    );
    for (const g of genuine) {
      console.log(
        `  ${g.chain}: ${g.succ} starts ${(g.overlapSec / 3600).toFixed(2)}h ` +
        `before ${g.pred} ends (pred work ${(g.predWorkSec / 3600).toFixed(1)}h ` +
        `over ${(g.predSpanSec / 3600).toFixed(1)}h span)`,
      );
    }

    // Self-loops are a DATA defect — a scheduler change must not alter them.
    expect(selfLoops.length).toBe(KNOWN_SELF_LOOPS);
    expect(genuine.length).toBeLessThanOrEqual(KNOWN_GENUINE);
  }, 600_000);
});
