import { Rule, RuleCheckResult, RuleContext } from '../validation-types';
import { readEntity } from './read-entity';

const TASKS_ENTITY = 'productionTaskWithAdvancedInfoViewEntity';
const WORK_ORDERS_ENTITY = 'workOrderWithAdvancedInformationViewEntity';
const TASK_REF_FIELD = 'WorkOrderCode';
const WO_KEY_FIELD = 'WorkOrderCode';

interface DanglingRef {
  recordIdx: number;
  workOrderCode: unknown;
}

export class CrossEntityRefsRule implements Rule {
  readonly name = 'cross-entity-refs';
  readonly severity = 'fail' as const;

  async check(ctx: RuleContext): Promise<RuleCheckResult> {
    const tasks = await readEntity(ctx.rawDir, TASKS_ENTITY);
    const workOrders = await readEntity(ctx.rawDir, WORK_ORDERS_ENTITY);

    if (tasks.length === 0 || workOrders.length === 0) {
      return { ok: true, message: 'no tasks or no work-orders; skipping cross-entity check' };
    }

    const woKeys = new Set<string>();
    for (const wo of workOrders) {
      if (wo !== null && typeof wo === 'object') {
        const key = (wo as Record<string, unknown>)[WO_KEY_FIELD];
        if (key !== undefined && key !== null) woKeys.add(String(key));
      }
    }

    const dangling: DanglingRef[] = [];
    tasks.forEach((task, idx) => {
      if (task === null || typeof task !== 'object') return;
      const ref = (task as Record<string, unknown>)[TASK_REF_FIELD];
      if (ref === undefined || ref === null) return;
      if (!woKeys.has(String(ref))) {
        dangling.push({ recordIdx: idx, workOrderCode: ref });
      }
    });

    if (dangling.length > 0) {
      return {
        ok: false,
        message: `${dangling.length} task(s) reference unknown WorkOrderCode`,
        details: { dangling: dangling.slice(0, 50), total: dangling.length },
      };
    }
    return { ok: true };
  }
}
