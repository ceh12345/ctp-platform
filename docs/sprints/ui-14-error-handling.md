# Sprint 14: Error Display & API Error Handling

**What it does:** Surface engine and API errors clearly in the UI instead of swallowing them as generic "500 Error" or silent failures. When the engine throws a validation error like "Scoring weights must sum to 100%", the user sees that exact message — not a blank screen or cryptic error code.

**Size:** ~1 hour CC work  
**Depends on:** Nothing  
**Priority:** High — this blocks effective debugging for both CC and users

---

## Why

Current behavior when the engine throws:

```
User clicks Solve
  → Frontend calls POST /v1/ctp/solve
  → Engine throws "Scoring weights must sum to 100%"
  → NestJS returns { statusCode: 500, message: "Internal server error" }
  → Frontend shows generic toast: "Error 500" or nothing at all
  → User has no idea what went wrong
```

This happens with any engine validation error — bad scoring config, missing resources, invalid horizon, malformed task data. The actual error message exists in the engine but gets swallowed by NestJS's default exception filter before reaching the frontend.

---

## Part 1: API Error Response Structure

### 1a. Standard error response format

All API error responses should follow a consistent structure:

```typescript
interface ApiErrorResponse {
  status: 'error';
  code: string;              // machine-readable: 'VALIDATION_ERROR', 'SOLVE_FAILED', 'STATE_NOT_LOADED'
  message: string;           // human-readable: "Scoring weights must sum to 100%"
  details?: string[];        // optional array of specific issues
  source?: string;           // 'engine' | 'api' | 'config' — where the error originated
  timestamp: string;         // ISO datetime
}
```

Example responses:

**Scoring validation:**
```json
{
  "status": "error",
  "code": "VALIDATION_ERROR",
  "message": "Scoring configuration is invalid",
  "details": [
    "Scoring rule weights must sum to 1.0 (currently 1.5)",
    "Rule 'EarliestStartTimeScoringRule' weight: 1.0",
    "Rule 'ResourceUtilizationScoringRule' weight: 0.5"
  ],
  "source": "engine",
  "timestamp": "2026-06-06T13:00:00Z"
}
```

**State not loaded:**
```json
{
  "status": "error",
  "code": "STATE_NOT_LOADED",
  "message": "No scheduling state loaded. Call POST /v1/state/sync first.",
  "source": "api",
  "timestamp": "2026-06-06T13:00:00Z"
}
```

**Solve failed — partial:**
```json
{
  "status": "error",
  "code": "SOLVE_FAILED",
  "message": "Solver encountered an unrecoverable error after scheduling 12 of 30 tasks",
  "details": [
    "Error at task OP-015: No feasible context found — all resources offline",
    "Solver aborted to preserve partial results"
  ],
  "source": "engine",
  "timestamp": "2026-06-06T13:00:00Z"
}
```

### 1b. NestJS Exception Filter

Create a global exception filter that catches engine errors and formats them properly instead of returning generic 500s.

```typescript
// src/filters/engine-exception.filter.ts

@Catch()
export class EngineExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    // If it's already an HttpException, extract the message
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exResponse = exception.getResponse();

      response.status(status).json({
        status: 'error',
        code: this.inferCode(status, exResponse),
        message: typeof exResponse === 'string' 
          ? exResponse 
          : exResponse?.message || 'Unknown error',
        details: exResponse?.details || [],
        source: exResponse?.source || 'api',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Unhandled engine errors — these are the ones getting swallowed today
    const message = exception?.message || 'Internal server error';
    response.status(500).json({
      status: 'error',
      code: 'ENGINE_ERROR',
      message: message,                  // ← THE KEY FIX: pass the actual error message through
      details: exception?.stack ? [exception.stack.split('\n')[0]] : [],
      source: 'engine',
      timestamp: new Date().toISOString(),
    });
  }

  private inferCode(status: number, response: any): string {
    if (response?.code) return response.code;
    if (status === 400) return 'VALIDATION_ERROR';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    return 'API_ERROR';
  }
}
```

Register it globally in `main.ts`:

```typescript
app.useGlobalFilters(new EngineExceptionFilter());
```

### 1c. Improve engine-side error throwing

Where the engine currently throws generic errors, add structured information. For example, the scoring validation:

```typescript
// In the scoring validation (wherever weights are checked)
const totalWeight = rules.reduce((sum, r) => sum + r.weight, 0);
if (Math.abs(totalWeight - 1.0) > 0.001) {
  throw new HttpException({
    code: 'VALIDATION_ERROR',
    message: `Scoring rule weights must sum to 1.0 (currently ${totalWeight})`,
    details: rules.map(r => `Rule '${r.ruleName}' weight: ${r.weight}`),
    source: 'engine',
  }, HttpStatus.BAD_REQUEST);    // 400, not 500
}
```

Similar pattern for other common validation points:

| Validation | Code | HTTP Status |
|---|---|---|
| Scoring weights don't sum to 1.0 | VALIDATION_ERROR | 400 |
| State not loaded | STATE_NOT_LOADED | 400 |
| Task not found | NOT_FOUND | 404 |
| Resource not found | NOT_FOUND | 404 |
| Horizon not set | VALIDATION_ERROR | 400 |
| Invalid strategy name | VALIDATION_ERROR | 400 |
| Empty task list | VALIDATION_ERROR | 400 |
| Duplicate task keys in config | VALIDATION_ERROR | 400 |
| Resource availability missing | VALIDATION_ERROR | 400 |

---

## Part 2: Frontend Error Handling

### 2a. Error Toast — Detailed

Replace the current generic error toast with a detailed one that shows the actual engine message.

**Current (bad):**
```
❌ Error 500
```

**New (good):**
```
┌─────────────────────────────────────────────────────┐
│ ⚠️ Scoring Configuration Error                       │
│                                                     │
│ Scoring rule weights must sum to 1.0 (currently 1.5)│
│                                                     │
│ • EarliestStartTimeScoringRule: weight 1.0          │
│ • ResourceUtilizationScoringRule: weight 0.5        │
│                                                     │
│ Source: engine                          [Dismiss]   │
└─────────────────────────────────────────────────────┘
```

### 2b. Error toast design

```typescript
interface ErrorToast {
  title: string;          // derived from error code
  message: string;        // the human-readable message
  details?: string[];     // expandable detail lines
  source?: string;        // "engine" | "api" | "config"
  severity: 'error' | 'warning';
  autoDismiss: boolean;   // false for errors, true for warnings
}
```

Mapping error codes to titles:

```typescript
const ERROR_TITLES: Record<string, string> = {
  VALIDATION_ERROR: 'Configuration Error',
  STATE_NOT_LOADED: 'State Not Loaded',
  SOLVE_FAILED: 'Solve Failed',
  ENGINE_ERROR: 'Engine Error',
  NOT_FOUND: 'Not Found',
  CONFLICT: 'Conflict',
  API_ERROR: 'API Error',
};
```

### 2c. Toast behavior

- **Errors** (4xx, 5xx): persist until dismissed. Red/orange accent. Show full message + expandable details.
- **Warnings**: auto-dismiss after 5 seconds. Yellow accent.
- **Success**: auto-dismiss after 3 seconds. Green accent. (Existing behavior for solve complete, etc.)
- **Multiple errors**: stack toasts vertically, max 3 visible at once, older ones collapse.

### 2d. Error details expansion

If `details` array has items, show a "Show details" toggle that expands to list them:

```
⚠️ Scoring Configuration Error

Scoring rule weights must sum to 1.0 (currently 1.5)

▸ Show details (2 items)
```

Expanded:

```
⚠️ Scoring Configuration Error

Scoring rule weights must sum to 1.0 (currently 1.5)

▾ Hide details
  • EarliestStartTimeScoringRule: weight 1.0
  • ResourceUtilizationScoringRule: weight 0.5
```

### 2e. API call wrapper

Create a centralized API error handler that all fetch calls use:

```typescript
async function apiCall<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok || data.status === 'error') {
      // Show error toast with the structured error data
      showErrorToast({
        title: ERROR_TITLES[data.code] || 'Error',
        message: data.message || `HTTP ${response.status}`,
        details: data.details,
        source: data.source,
        severity: 'error',
        autoDismiss: false,
      });
      throw new ApiError(data);
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;

    // Network errors, timeouts, etc.
    showErrorToast({
      title: 'Connection Error',
      message: 'Unable to reach the scheduling engine. Is the server running?',
      severity: 'error',
      autoDismiss: false,
    });
    throw err;
  }
}
```

All existing API calls (`solveLandscape`, `unscheduleTask`, `scheduleTask`, `whereTo`, `moveTo`, etc.) should use this wrapper.

### 2f. Specific error states in the UI

Beyond toasts, certain errors should affect the UI state:

| Error | UI Effect |
|---|---|
| STATE_NOT_LOADED | Show "No data loaded" banner on Schedule tab. Disable Solve button. |
| SOLVE_FAILED | Show partial results if available. Banner: "Solve incomplete — X of Y tasks scheduled" |
| VALIDATION_ERROR on solve | Keep previous solve results visible. Toast explains what's wrong. |
| Network error | Show offline banner. Retry button. |
| 404 on task/resource | Remove stale item from UI, show toast |

---

## Part 3: Console Logging

### 3a. Structured server-side logging

When the engine catches and formats an error, also log it server-side with context:

```typescript
console.error(`[${tenantId}] ${error.code}: ${error.message}`, {
  details: error.details,
  source: error.source,
  endpoint: request.url,
});
```

### 3b. Frontend console logging

In development, log the full error response to browser console for debugging:

```typescript
if (process.env.NODE_ENV !== 'production') {
  console.error('[API Error]', { url, status: response.status, data });
}
```

---

## Part 4: Verification

After implementing:

- [ ] Scoring weights that don't sum to 1.0 → toast shows exact message with rule breakdown
- [ ] State not loaded → "No data loaded" banner, Solve button disabled
- [ ] Invalid strategy name → toast: "Invalid strategy 'foo'. Available: Chain, ChainFirstFit, ..."
- [ ] Task not found (unschedule/schedule bad key) → toast: "Task FAKE-KEY not found"
- [ ] Server not running → "Connection Error" toast with retry suggestion
- [ ] Solve succeeds → no change to existing success behavior
- [ ] Error toasts persist until dismissed (don't auto-hide)
- [ ] Error details expandable when present
- [ ] Multiple errors stack (don't overwrite each other)
- [ ] All three tenants — trigger at least one error, verify toast displays correctly
- [ ] Browser console shows structured error in development mode

---

## Size Estimate

- API: Exception filter + structured error responses in validation points (~30 min)
- Frontend: Error toast component + API wrapper + UI state handling (~30 min)
- Total: ~1 hour CC work
