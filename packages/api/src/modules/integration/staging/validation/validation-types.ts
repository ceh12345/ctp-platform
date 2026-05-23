export type RuleSeverity = 'fail' | 'warn';
export type RuleOutcome = 'pass' | 'warn' | 'fail';

export interface RuleContext {
  rawDir: string;
  previousRawDir: string | null;
}

export interface RuleCheckResult {
  ok: boolean;
  message?: string;
  details?: unknown;
}

export interface Rule {
  readonly name: string;
  readonly severity: RuleSeverity;
  check(ctx: RuleContext): Promise<RuleCheckResult>;
}

export interface RuleResult {
  name: string;
  outcome: RuleOutcome;
  message?: string;
  details?: unknown;
}

export interface ValidationReport {
  ranAt: string;
  rules: RuleResult[];
  passed: boolean;
  failedRules: string[];
  warningRules: string[];
}
