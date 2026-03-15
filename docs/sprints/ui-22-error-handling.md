# UI Sprint 14: Error Handling + Structured Logging

**What it does:** Standardizes error handling across the full stack — backend catches and classifies errors, logs them through the existing LoggerService, returns structured error responses, and the frontend parses them and presents appropriate UI (inline warnings, toasts, error modals, persistent banners). Also adds console logging on the frontend for debugging.

**Size:** ~2-3 hours CC work
**Depends on:** Logging Sprint 1 (LoggerService with transports — done 2026-03-07)
**Scenarios:** Every scenario — errors can happen anywhere. The scoring weight validation is the motivating example, but this covers all endpoints.

---

## Current State

**Backend:**
- `AllExceptionsFilter` (from Logging Sprint 1) catches unhandled exceptions and returns a generic error response
- Engine throws raw strings: `"Scoring Rules must sum to 100 %"`, `"State not loaded"`, etc.
- Some endpoints use `HttpException` with status codes, others let errors bubble up
- `LoggerService` exists with 4 transports (memory/console/file/azure) but isn't used consistently for error logging
- No structured error envelope — response shape varies by error type

**Frontend:**
- `api()` helper (~line 37 in App.tsx) throws `new Error('API error: ${res.status}')` — loses the error message and details from the response body
- Catch blocks set `setError(e.message)` which shows a generic error string
- No console logging on API failures
- No error classification — all errors treated the same way (red dot in header)
- Scoring rules editor validates weights client-side but the validation isn't connected to preventing solve

---

## Part 1: Structured Error Response Envelope

### 1a. Error response interface

Define a standard error envelope used by all API responses:

```typescript
// dto/error-response.dto.ts

export interface ErrorResponse {
  error: {
    code: string;           // Machine-readable: SCORING_WEIGHT_INVALID, TASK_NOT_FOUND, etc.
    message: string;        // Human-readable: "Scoring rules must sum to 100%. Current total: 85%"
    category: ErrorCategory;
    details?: any;          // Optional structured data for the frontend to use
    timestamp?: string;     // ISO timestamp
    tenant?: string;        // Tenant ID for multi-tenant debugging
  };
}

export type ErrorCategory = 'validation' | 'engine' | 'config' | 'system';
```

**Category meanings:**

| Category | Cause | User action | UI treatment |
|----------|-------|-------------|--------------|
| `validation` | Bad input from the user | Fix the input and retry | Inline warning or toast, link to the fix |
| `engine` | Solver/engine internal failure | Retry, or report to admin | Error modal with details |
| `config` | Tenant config missing/broken | Admin needs to fix config | Persistent banner |
| `system` | Infrastructure (DB, timeout, OOM) | Retry later | Persistent banner |

### 1b. Error code constants

```typescript
// constants/error-codes.ts

export const ErrorCodes = {
  // Validation
  SCORING_WEIGHT_INVALID: 'SCORING_WEIGHT_INVALID',
  SCORING_RULE_NOT_FOUND: 'SCORING_RULE_NOT_FOUND',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  TASK_NOT_SCHEDULED: 'TASK_NOT_SCHEDULED',
  TASK_IS_PINNED: 'TASK_IS_PINNED',
  INVALID_STRATEGY: 'INVALID_STRATEGY',
  INVALID_PRIORITY: 'INVALID_PRIORITY',

  // Engine
  SOLVE_FAILED: 'SOLVE_FAILED',
  ENGINE_EXCEPTION: 'ENGINE_EXCEPTION',
  CHAIN_EVALUATION_FAILED: 'CHAIN_EVALUATION_FAILED',
  NO_FEASIBLE_SCHEDULE: 'NO_FEASIBLE_SCHEDULE',

  // Config
  STATE_NOT_LOADED: 'STATE_NOT_LOADED',
  SCORING_CONFIG_MISSING: 'SCORING_CONFIG_MISSING',
  TENANT_CONFIG_MISSING: 'TENANT_CONFIG_MISSING',
  HORIZON_NOT_SET: 'HORIZON_NOT_SET',

  // System
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',
} as const;
```

---

## Part 2: Backend — Catch, Classify, Log, Return

### 2a. Update AllExceptionsFilter

The existing `AllExceptionsFilter` should format all unhandled exceptions into the structured envelope. This is the safety net — ideally errors are caught at the service layer, but if they bubble up, this catches them.

```typescript
// In AllExceptionsFilter.catch():

const status = exception instanceof HttpException
  ? exception.getStatus()
  : HttpStatus.INTERNAL_SERVER_ERROR;

// Extract structured error if it's already in our format
const exceptionResponse = exception instanceof HttpException
  ? exception.getResponse()
  : null;

const errorBody = typeof exceptionResponse === 'object' && exceptionResponse?.error
  ? exceptionResponse  // Already structured — pass through
  : {
      error: {
        code: status === 500 ? ErrorCodes.INTERNAL_ERROR : 'UNKNOWN',
        message: exception.message || 'An unexpected error occurred',
        category: status >= 500 ? 'system' : 'engine',
        timestamp: new Date().toISOString(),
        tenant: request.headers['x-tenant-id'] || 'unknown',
      },
    };

// Log through LoggerService
this.logger.error('unhandled_exception', {
  tenant: request.headers['x-tenant-id'],
  path: request.url,
  method: request.method,
  status,
  error: errorBody.error,
  stack: exception.stack,
});

response.status(status).json(errorBody);
```

### 2b. Wrap engine calls in ctp.service.ts

The solve method is the most important one. Wrap the scoring validation and engine execution in try/catch with structured errors:

```typescript
// In solve():

// ─── 3. Build scoring ───
let scoringRules;
if (request?.scoringOverrides?.length > 0) {
  scoringRules = request.scoringOverrides;
} else {
  const scoringConfig = this.configService.getScoring();
  if (!scoringConfig) {
    this.logger.error('solve_config_missing', {
      tenant: this.configService.getTenantId(),
      detail: 'Scoring configuration not found',
    });
    throw new HttpException({
      error: {
        code: ErrorCodes.SCORING_CONFIG_MISSING,
        message: 'Scoring configuration not found for this tenant.',
        category: 'config',
      },
    }, HttpStatus.BAD_REQUEST);
  }
  scoringRules = scoringConfig.rules;
}

// Validate weights sum to 1.0 BEFORE building the CTPScoring object
const weightSum = scoringRules
  .filter(r => r.includeInSolve)
  .reduce((sum, r) => sum + r.weight, 0);

if (weightSum < 0.99 || weightSum > 1.01) {
  this.logger.warn('solve_scoring_invalid', {
    tenant: this.configService.getTenantId(),
    weightSum: Math.round(weightSum * 100),
    ruleCount: scoringRules.filter(r => r.includeInSolve).length,
    rules: scoringRules.map(r => ({ name: r.ruleName, weight: r.weight, included: r.includeInSolve })),
  });
  throw new HttpException({
    error: {
      code: ErrorCodes.SCORING_WEIGHT_INVALID,
      message: `Scoring rules must sum to 100%. Current total: ${Math.round(weightSum * 100)}%.`,
      category: 'validation',
      details: {
        currentTotal: Math.round(weightSum * 100) / 100,
        rules: scoringRules.map(r => ({ ruleName: r.ruleName, weight: r.weight, included: r.includeInSolve })),
      },
    },
  }, HttpStatus.BAD_REQUEST);
}

// ─── 4. Run solver ───
try {
  // ... existing solver code ...
} catch (engineErr) {
  this.logger.error('solve_engine_failed', {
    tenant: this.configService.getTenantId(),
    strategy,
    error: engineErr.message || String(engineErr),
    stack: engineErr.stack,
  });
  throw new HttpException({
    error: {
      code: ErrorCodes.SOLVE_FAILED,
      message: `Solver failed: ${engineErr.message || String(engineErr)}`,
      category: 'engine',
      details: {
        strategy,
        taskCount: taskList.length,
      },
    },
  }, HttpStatus.INTERNAL_SERVER_ERROR);
}
```

### 2c. Apply the same pattern to other endpoints

Each endpoint in `ctp.service.ts` that throws `HttpException` should use the structured envelope. Update existing throws:

```typescript
// Before:
throw new HttpException(`Task ${taskKey} not found`, HttpStatus.NOT_FOUND);

// After:
throw new HttpException({
  error: {
    code: ErrorCodes.TASK_NOT_FOUND,
    message: `Task ${taskKey} not found`,
    category: 'validation',
  },
}, HttpStatus.NOT_FOUND);
```

Priority endpoints to update:
- `scheduleTask` — TASK_NOT_FOUND, TASK_NOT_SCHEDULED, TASK_IS_PINNED
- `unscheduleTask` — TASK_NOT_FOUND, TASK_NOT_SCHEDULED, TASK_IS_PINNED
- `pinTask` — TASK_NOT_FOUND, TASK_NOT_SCHEDULED
- `whereTo` — TASK_NOT_FOUND
- `moveTo` — TASK_NOT_FOUND, position no longer available
- `solve` — SCORING_WEIGHT_INVALID, SCORING_CONFIG_MISSING, STATE_NOT_LOADED, SOLVE_FAILED, INVALID_STRATEGY

### 2d. Structured solve summary log

Add a structured info log at the end of every successful solve:

```typescript
// After building the response, before returning:
this.logger.info('solve_complete', {
  tenant: this.configService.getTenantId(),
  strategy,
  totalTimeMs: stats.totalTimeMs,
  tasks: {
    total: summary.totalTasks,
    included: summary.includedTasks,
    scheduled: summary.scheduledTasks,
    infeasible: summary.unscheduledTasks,
  },
  feasibilityRate: summary.feasibilityRate,
  scoringSource: request?.scoringOverrides ? 'override' : 'config',
});
```

And warn-level log when feasibility is low:

```typescript
if (summary.feasibilityRate < 70) {
  this.logger.warn('solve_low_feasibility', {
    tenant: this.configService.getTenantId(),
    feasibilityRate: summary.feasibilityRate,
    infeasibleCount: summary.unscheduledTasks,
    strategy,
  });
}
```

---

## Part 3: Frontend — Parse, Log, Present

### 3a. ApiError class

```typescript
class ApiError extends Error {
  code: string;
  category: string;
  status: number;
  details: any;

  constructor(message: string, code: string, category: string, status: number, details?: any) {
    super(message);
    this.code = code;
    this.category = category;
    this.status = status;
    this.details = details;
  }
}
```

### 3b. Update api() helper

Replace the current generic error throw with structured parsing and console logging:

```typescript
async function api(path: string, options?: RequestInit) {
  const method = options?.method?.toUpperCase() ?? 'GET';
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const res = await fetch(`/api/v1${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
    },
    ...(hasBody && !options?.body ? { body: '{}' } : {}),
    ...options,
  });

  if (!res.ok) {
    let errorData: any = null;
    try {
      errorData = await res.json();
    } catch {
      // No JSON body — use status text
    }

    const err = errorData?.error || {};
    const apiError = new ApiError(
      err.message || `API error: ${res.status} ${res.statusText}`,
      err.code || 'UNKNOWN',
      err.category || (res.status >= 500 ? 'system' : 'engine'),
      res.status,
      err.details,
    );

    // Always log to console
    console.error(
      `[API ${apiError.category}] ${method} ${path} → ${res.status}:`,
      apiError.message,
      apiError.details || '',
    );

    throw apiError;
  }

  return res.json();
}
```

### 3c. Category-aware error handling in catch blocks

Update the main catch blocks (solve, schedule, unschedule, pin, whereTo, moveTo) to handle errors by category:

```typescript
// In handleSolveConfirm:
try {
  // ... solve ...
} catch (e: any) {
  if (e instanceof ApiError) {
    switch (e.category) {
      case 'validation':
        // User can fix this — show toast with guidance
        showToast(e.message, 'warning');
        // Smart routing: if scoring-related, open settings to scoring tab
        if (e.code === 'SCORING_WEIGHT_INVALID') {
          setSettingsOpen(true);
          // If SettingsContent supports setting active section externally:
          // setSettingsActiveSection('scoring');
        }
        break;

      case 'config':
        // Tenant config problem — persistent error, admin action needed
        setError(`Configuration error: ${e.message}`);
        break;

      case 'engine':
        // Solver failed — show details, suggest retry
        setError(`Solver error: ${e.message}`);
        showToast('Solver encountered an error. Try adjusting your inputs and re-solving.', 'error');
        break;

      case 'system':
      default:
        // Infrastructure problem — persistent error
        setError(e.message);
        break;
    }
  } else {
    // Non-API error (network failure, etc.)
    console.error('[App] Non-API error:', e);
    setError(e.message || 'An unexpected error occurred');
  }
} finally {
  setSolving(false);
}
```

Apply similar pattern to other action handlers:

```typescript
// In handleApiUnschedule, handleApiPin, handleApiSchedule, handleWhereTo, handleMoveTo:
try {
  // ... action ...
} catch (e: any) {
  if (e instanceof ApiError) {
    if (e.category === 'validation') {
      showToast(e.message, 'warning');
    } else {
      showToast(e.message, 'error');
      console.error(`[${actionName}]`, e.code, e.message);
    }
  } else {
    showToast(e.message || 'Action failed', 'error');
  }
}
```

### 3d. Enhanced toast with severity

If `showToast` currently only accepts a message string, extend it to support severity levels that control the visual treatment:

```typescript
function showToast(message: string, severity: 'info' | 'warning' | 'error' = 'info') {
  // severity controls:
  //   info    → accent/blue background, auto-dismiss 3s
  //   warning → yellow background, auto-dismiss 5s
  //   error   → red background, auto-dismiss 8s (or manual dismiss)
}
```

### 3e. Frontend console logging for soft warnings

Add `console.warn` calls for non-error conditions that are useful for debugging:

```typescript
// In the scoring rules editor — when weights don't sum to 100%:
if (total < 0.99 || total > 1.01) {
  console.warn(`[Scoring] Weights sum to ${Math.round(total * 100)}%, expected 100%`);
}

// After a solve — if infeasibility is high:
if (solveResult?.summary?.feasibilityRate < 70) {
  console.warn(
    `[Solve] Low feasibility: ${solveResult.summary.feasibilityRate}%`,
    `(${solveResult.summary.unscheduledTasks} infeasible)`,
  );
}

// WhereTo returns zero options:
if (whereToOptions.length === 0) {
  console.warn(`[WhereTo] No feasible options for task ${taskKey}`);
}

// API call timing (debug-level, useful for perf):
const start = performance.now();
const result = await api('/ctp/solve', ...);
const elapsed = Math.round(performance.now() - start);
if (elapsed > 5000) {
  console.warn(`[API] Slow response: POST /ctp/solve took ${elapsed}ms`);
}
```

---

## Part 4: Client-Side Validation Gates

### 4a. Prevent solve when scoring is invalid

The scoring rules editor already shows a red "Invalid — must sum to 100%" badge. Wire this into the solve flow:

```typescript
// In handleSolve (the function that opens the solve preview):
if (scoringOverrides && scoringOverrides.length > 0) {
  const total = scoringOverrides
    .filter(r => r.includeInSolve)
    .reduce((sum, r) => sum + r.weight, 0);

  if (total < 0.99 || total > 1.01) {
    showToast(
      `Scoring rules must sum to 100% (currently ${Math.round(total * 100)}%). Open Settings → Scoring Rules to fix.`,
      'warning',
    );
    console.warn(`[Solve blocked] Scoring weights sum to ${Math.round(total * 100)}%`);
    return; // Don't open solve preview
  }
}
```

This prevents the error from ever reaching the backend. The backend validation (Part 2b) is the safety net.

### 4b. Validate before other actions that could fail

```typescript
// Before scheduling a pinned task:
if (taskPins[taskKey]) {
  showToast(`Task ${taskKey} is pinned. Unpin it first.`, 'warning');
  return;
}

// Before unscheduling an already unscheduled task:
if (task.state !== CTPTaskStateConstants.SCHEDULED) {
  showToast(`Task ${taskKey} is not currently scheduled.`, 'warning');
  return;
}
```

These are simple guards that avoid unnecessary API calls and give instant feedback.

---

## Part 5: Error Display Components

### 5a. Error banner (persistent, system/config errors)

The app already has a red dot status indicator in the header when `error` state is set. Enhance this to show a dismissible banner below the header:

```typescript
{error && (
  <div style={{
    background: C.redDim, borderBottom: `1px solid ${C.red}`,
    padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 12,
    fontSize: 13,
  }}>
    <span style={{ color: C.red, fontWeight: 600 }}>Error</span>
    <span style={{ color: C.text, flex: 1 }}>{error}</span>
    <button
      onClick={() => setError(null)}
      style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 16 }}
    >
      ×
    </button>
  </div>
)}
```

### 5b. Solve error in results dialog

When a solve fails, show the error in the Solve Results dialog instead of (or alongside) the success summary:

```typescript
// In SolveResultsDialog, if result.status === 'error':
if (result.error) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 24 }}>⚠</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.red }}>Solve Failed</div>
          <div style={{ fontSize: 13, color: C.textMuted }}>{result.error.message}</div>
        </div>
      </div>
      {result.error.category === 'validation' && (
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>
          This is a configuration issue that you can fix. Check your scoring rules and solver settings.
        </div>
      )}
      {result.error.details && showAt(experienceLevel, 'expert') && (
        <pre style={{
          marginTop: 12, padding: 12, borderRadius: 8,
          background: C.bg, border: `1px solid ${C.border}`,
          fontSize: 11, color: C.textDim, whiteSpace: 'pre-wrap',
        }}>
          {JSON.stringify(result.error.details, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

---

## Part 6: Testing Checklist

### Backend
1. **Scoring weight validation** — Solve with weights summing to 85% returns 400 with `SCORING_WEIGHT_INVALID` code and `validation` category
2. **Missing scoring config** — Solve with no `scoring.json` and no overrides returns 400 with `SCORING_CONFIG_MISSING`
3. **Invalid strategy** — Solve with `strategy: "Nonexistent"` returns 400 with `INVALID_STRATEGY`
4. **Task not found** — Unschedule nonexistent task returns 404 with `TASK_NOT_FOUND`
5. **Task is pinned** — Unschedule a pinned task returns 409 with `TASK_IS_PINNED`
6. **Engine exception** — Force an engine error (e.g., corrupted landscape data) returns 500 with `SOLVE_FAILED` and `engine` category
7. **Structured envelope** — All error responses match the `ErrorResponse` interface shape
8. **LoggerService called** — Check memory transport or console output for error/warn logs on each failure
9. **Solve summary logged** — Every successful solve produces an info-level log with tenant, strategy, feasibility rate
10. **Low feasibility warning** — Solve with <70% feasibility produces a warn-level log

### Frontend
11. **api() parses error body** — API error responses are parsed into `ApiError` with code, category, message, details
12. **Console logging** — Every API failure logs to `console.error` with path, status, message
13. **Validation errors show toast** — Scoring weight error shows yellow warning toast
14. **Engine errors show error modal** — Solver failure shows red error with details
15. **Scoring weight blocks solve** — Client-side validation prevents solve when weights don't sum to 100%
16. **Toast severity** — info (blue, 3s), warning (yellow, 5s), error (red, 8s) render with correct colors and durations
17. **Error banner dismissible** — Persistent error banner shows × button, clicking clears it
18. **Expert error details** — At Engineer experience level, error details JSON is visible in solve results
19. **Console warnings** — Low feasibility, empty WhereTo, slow API calls produce `console.warn`
20. **No regression** — Successful solves, schedules, and actions work exactly as before

---

## Data Flow Summary

```
User action (Solve, Schedule, Pin, etc.)
  │
  ├── Client-side validation gate
  │   └── Fail → showToast('warning') + console.warn + return early
  │
  ├── api() call
  │   ├── Success → normal flow
  │   └── Failure → parse response body
  │       │
  │       ├── Structured error? → ApiError(code, category, message, details)
  │       │   ├── console.error('[API category] path → status: message')
  │       │   └── throw ApiError
  │       │
  │       └── No body? → ApiError('API error: status', 'UNKNOWN', 'system')
  │           └── console.error + throw
  │
  └── Catch block (per-action handler)
      ├── validation → showToast('warning') + smart routing (open settings, highlight field)
      ├── engine → setError() + showToast('error') + suggest retry
      ├── config → setError() (persistent banner)
      └── system → setError() (persistent banner)


Backend flow:
  │
  Request → Controller → Service
  │                        │
  │                        ├── Validation check (weights, task exists, etc.)
  │                        │   └── Fail → logger.warn + throw HttpException({ error: structured })
  │                        │
  │                        ├── Engine execution
  │                        │   └── Fail → logger.error + throw HttpException({ error: structured })
  │                        │
  │                        └── Success → logger.info('solve_complete', summary) → return response
  │
  └── AllExceptionsFilter (safety net)
      └── Unhandled → logger.error + format to structured envelope + return
```
