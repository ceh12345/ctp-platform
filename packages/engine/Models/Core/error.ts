"strict";

export interface IError {
  agent: string;
  type: string;
  reason: string;

}

export class CTPError implements IError {
  public agent: string = '';
  public type: string  = '';
  public reason: string  = '';

  constructor()
  {

  }


}

// ─── Validation errors ──────────────────────────────────────────────────────
//
// IValidationError extends IError with structured fields for data-quality
// reporting. Entities (CTPTask, CTPOrder, CTPResource) carry arrays of these
// to explain why a record is suspect or unschedulable.
//
// Backward-compatible with IError — every IValidationError IS an IError.
// Legacy call sites that populate `errors` via addError(agent, reason) keep
// working; they produce IValidationError values with legacy-shape defaults
// (severity: "error", source: "engine").

export type ValidationSeverity = "error" | "warning" | "info";
export type ValidationSource   = "mapping" | "validation" | "engine" | "adapter";
export type ValidationPolicy   = "strict" | "skip" | "default" | "annotate";

export interface IValidationError extends IError {
  severity: ValidationSeverity;
  field?: string;
  source: ValidationSource;
  policy?: ValidationPolicy;
  detectedAt: string;   // ISO 8601
  rawValue?: unknown;
}

export interface MakeValidationErrorParams {
  agent: string;
  type: string;
  severity: ValidationSeverity;
  reason: string;
  field?: string;
  source: ValidationSource;
  policy?: ValidationPolicy;
  rawValue?: unknown;
}

export function makeValidationError(p: MakeValidationErrorParams): IValidationError {
  return {
    agent:      p.agent,
    type:       p.type,
    reason:     p.reason,
    severity:   p.severity,
    field:      p.field,
    source:     p.source,
    policy:     p.policy,
    rawValue:   p.rawValue,
    detectedAt: new Date().toISOString(),
  };
}
