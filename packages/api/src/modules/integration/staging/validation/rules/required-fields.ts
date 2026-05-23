import { Rule, RuleCheckResult, RuleContext } from '../validation-types';
import { readEntity } from './read-entity';

// Entity names match IRawDataPayload top-level keys (what SyncOrchestrator writes to staging).
// Field names are Stafford WORK7 raw-shape defaults, verified against a real Genius capture
// (`tools/mock-genius/fixtures/stafford-work7-100tasks-may8/`). Tunable per-tenant in a
// future sprint by promoting REQUIRED_KEYS into staging.json overrides.
const REQUIRED_KEYS: Record<string, string[]> = {
  tasks: ['WorkOrderCode', 'OperationCode'],
  orders: ['JobCode'],
  resources: ['Code'],
};

interface Violation {
  entity: string;
  recordIdx: number;
  missing: string[];
}

export class RequiredFieldsRule implements Rule {
  readonly name = 'required-fields';
  readonly severity = 'fail' as const;

  async check(ctx: RuleContext): Promise<RuleCheckResult> {
    const violations: Violation[] = [];

    for (const [entity, keys] of Object.entries(REQUIRED_KEYS)) {
      const records = await readEntity(ctx.rawDir, entity);
      records.forEach((record, idx) => {
        if (record === null || typeof record !== 'object') {
          violations.push({ entity, recordIdx: idx, missing: keys });
          return;
        }
        const missing = keys.filter((k) => !(k in (record as Record<string, unknown>)));
        if (missing.length > 0) {
          violations.push({ entity, recordIdx: idx, missing });
        }
      });
    }

    if (violations.length > 0) {
      return {
        ok: false,
        message: `${violations.length} record(s) missing required fields`,
        details: { violations: violations.slice(0, 50), totalViolations: violations.length },
      };
    }
    return { ok: true };
  }
}
