import { describe, expect, it } from 'vitest';
import { Rule, RuleContext } from '../../validation/validation-types';
import { ValidationRunner } from '../../validation/validation-runner';

class PassRule implements Rule {
  readonly name = 'pass-rule';
  readonly severity = 'fail' as const;
  check = async () => ({ ok: true });
}

class WarnRule implements Rule {
  readonly name = 'warn-rule';
  readonly severity = 'warn' as const;
  check = async () => ({ ok: false, message: 'warning detected' });
}

class FailRule implements Rule {
  readonly name = 'fail-rule';
  readonly severity = 'fail' as const;
  check = async () => ({ ok: false, message: 'failure detected', details: { offenders: 3 } });
}

class ThrowRule implements Rule {
  readonly name = 'throw-rule';
  readonly severity = 'fail' as const;
  check = async () => {
    throw new Error('boom');
  };
}

const CTX: RuleContext = { rawDir: '/nowhere', previousRawDir: null };

describe('ValidationRunner', () => {
  it('passes when all rules pass', async () => {
    const runner = new ValidationRunner([new PassRule()]);
    const report = await runner.run(CTX);
    expect(report.passed).toBe(true);
    expect(report.failedRules).toEqual([]);
    expect(report.warningRules).toEqual([]);
  });

  it('classifies failures by rule severity', async () => {
    const runner = new ValidationRunner([new PassRule(), new WarnRule(), new FailRule()]);
    const report = await runner.run(CTX);
    expect(report.passed).toBe(false);
    expect(report.failedRules).toEqual(['fail-rule']);
    expect(report.warningRules).toEqual(['warn-rule']);
    expect(report.rules.find((r) => r.name === 'fail-rule')?.details).toEqual({ offenders: 3 });
  });

  it('thrown errors map to the rule severity', async () => {
    const runner = new ValidationRunner([new ThrowRule()]);
    const report = await runner.run(CTX);
    expect(report.passed).toBe(false);
    expect(report.failedRules).toEqual(['throw-rule']);
    expect(report.rules[0].message).toContain('boom');
  });

  it('warns do not cause overall failure', async () => {
    const runner = new ValidationRunner([new WarnRule()]);
    const report = await runner.run(CTX);
    expect(report.passed).toBe(true);
    expect(report.warningRules).toEqual(['warn-rule']);
  });
});
