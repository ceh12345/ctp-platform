import { Rule, RuleCheckResult, RuleContext } from '../validation-types';
import { readEntity } from './read-entity';

// Entity names match IRawDataPayload top-level keys. Stafford raw shape joins tasks to
// orders via `JobCode`. Configurable per tenant in M4.
const TASKS_ENTITY = 'tasks';
const ORDERS_ENTITY = 'orders';
const TASK_REF_FIELD = 'JobCode';
const ORDER_KEY_FIELD = 'JobCode';

interface DanglingRef {
  recordIdx: number;
  ref: unknown;
}

export class CrossEntityRefsRule implements Rule {
  readonly name = 'cross-entity-refs';
  readonly severity = 'fail' as const;

  async check(ctx: RuleContext): Promise<RuleCheckResult> {
    const tasks = await readEntity(ctx.rawDir, TASKS_ENTITY);
    const orders = await readEntity(ctx.rawDir, ORDERS_ENTITY);

    if (tasks.length === 0 || orders.length === 0) {
      return { ok: true, message: 'no tasks or no orders; skipping cross-entity check' };
    }

    const orderKeys = new Set<string>();
    for (const order of orders) {
      if (order !== null && typeof order === 'object') {
        const key = (order as Record<string, unknown>)[ORDER_KEY_FIELD];
        if (key !== undefined && key !== null) orderKeys.add(String(key));
      }
    }

    const dangling: DanglingRef[] = [];
    tasks.forEach((task, idx) => {
      if (task === null || typeof task !== 'object') return;
      const ref = (task as Record<string, unknown>)[TASK_REF_FIELD];
      if (ref === undefined || ref === null) return;
      if (!orderKeys.has(String(ref))) {
        dangling.push({ recordIdx: idx, ref });
      }
    });

    if (dangling.length > 0) {
      return {
        ok: false,
        message: `${dangling.length} task(s) reference unknown ${TASK_REF_FIELD}`,
        details: { dangling: dangling.slice(0, 50), total: dangling.length },
      };
    }
    return { ok: true };
  }
}
