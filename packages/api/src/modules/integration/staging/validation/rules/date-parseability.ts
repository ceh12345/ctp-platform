import { Rule, RuleCheckResult, RuleContext } from '../validation-types';
import { listEntities, readEntity } from './read-entity';

const DATE_KEY_PATTERN = /(Date|Time)$/;

interface Unparseable {
  entity: string;
  recordIdx: number;
  field: string;
  value: unknown;
}

export class DateParseabilityRule implements Rule {
  readonly name = 'date-parseability';
  readonly severity = 'warn' as const;

  async check(ctx: RuleContext): Promise<RuleCheckResult> {
    const entities = await listEntities(ctx.rawDir);
    const unparseable: Unparseable[] = [];

    for (const entity of entities) {
      const records = await readEntity(ctx.rawDir, entity);
      records.forEach((record, idx) => {
        if (record === null || typeof record !== 'object') return;
        for (const [field, value] of Object.entries(record as Record<string, unknown>)) {
          if (!DATE_KEY_PATTERN.test(field)) continue;
          if (value === null || value === undefined || value === '') continue;
          // Only check string values. Numbers (e.g., CycleTime hours-per-unit) are
          // not date-like even if their field name happens to end in "Time".
          if (typeof value !== 'string') continue;
          const parsed = Date.parse(value);
          if (Number.isNaN(parsed)) {
            unparseable.push({ entity, recordIdx: idx, field, value });
          }
        }
      });
    }

    if (unparseable.length > 0) {
      return {
        ok: false,
        message: `${unparseable.length} unparseable date value(s)`,
        details: { unparseable: unparseable.slice(0, 50), total: unparseable.length },
      };
    }
    return { ok: true };
  }
}
