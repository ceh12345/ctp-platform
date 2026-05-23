import { Rule, RuleCheckResult, RuleContext } from '../validation-types';
import { listEntities, readEntity } from './read-entity';

const RATIO_THRESHOLD = 10;

export class RecordCountPlausibilityRule implements Rule {
  readonly name = 'record-count-plausibility';
  readonly severity = 'fail' as const;

  async check(ctx: RuleContext): Promise<RuleCheckResult> {
    const entities = await listEntities(ctx.rawDir);
    if (entities.length === 0) {
      return { ok: false, message: 'no entity files in raw/' };
    }

    const currentCounts: Record<string, number> = {};
    for (const entity of entities) {
      currentCounts[entity] = (await readEntity(ctx.rawDir, entity)).length;
    }

    const zeroNow: string[] = [];
    const drift: { entity: string; previous: number; current: number; ratio: number }[] = [];

    if (ctx.previousRawDir) {
      for (const entity of entities) {
        const prevCount = (await readEntity(ctx.previousRawDir, entity)).length;
        const curCount = currentCounts[entity];
        if (prevCount > 0 && curCount === 0) {
          zeroNow.push(entity);
          continue;
        }
        if (prevCount > 0 && curCount > 0) {
          const ratio = Math.max(curCount / prevCount, prevCount / curCount);
          if (ratio >= RATIO_THRESHOLD) {
            drift.push({ entity, previous: prevCount, current: curCount, ratio });
          }
        }
      }
    } else {
      for (const entity of entities) {
        if (currentCounts[entity] === 0) zeroNow.push(entity);
      }
    }

    if (zeroNow.length > 0) {
      return {
        ok: false,
        message: `zero records in ${zeroNow.join(', ')}`,
        details: { zeroNow, currentCounts },
      };
    }

    return {
      ok: true,
      details: { currentCounts, drift: drift.length > 0 ? drift : undefined },
    };
  }
}
