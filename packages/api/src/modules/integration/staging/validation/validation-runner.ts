import {
  Rule,
  RuleContext,
  RuleResult,
  ValidationReport,
} from './validation-types';

export class ValidationRunner {
  constructor(private readonly rules: Rule[]) {}

  async run(ctx: RuleContext): Promise<ValidationReport> {
    const results: RuleResult[] = [];
    for (const rule of this.rules) {
      try {
        const r = await rule.check(ctx);
        results.push({
          name: rule.name,
          outcome: r.ok ? 'pass' : rule.severity,
          message: r.message,
          details: r.details,
        });
      } catch (err) {
        results.push({
          name: rule.name,
          outcome: rule.severity,
          message: `rule threw: ${(err as Error).message}`,
        });
      }
    }
    const failedRules = results.filter((r) => r.outcome === 'fail').map((r) => r.name);
    const warningRules = results.filter((r) => r.outcome === 'warn').map((r) => r.name);
    return {
      ranAt: new Date().toISOString(),
      rules: results,
      passed: failedRules.length === 0,
      failedRules,
      warningRules,
    };
  }
}
