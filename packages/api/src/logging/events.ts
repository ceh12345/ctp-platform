export type LogEventType = 'ai_call' | 'solve' | 'api_error' | 'system_error';

export interface BaseLogEvent {
  type: LogEventType;
  tenantId: string;
  timestamp: string;          // ISO 8601
  sessionId?: string;
}

export interface AIToolCall {
  name: string;
  params: Record<string, any>;
  durationMs: number;
  success: boolean;
  resultSummary?: string;     // e.g. "3 options returned" — not full payload
  error?: string;
}

export interface AICallEvent extends BaseLogEvent {
  type: 'ai_call';
  sessionId: string;
  userMessage: string;
  iterations: number;
  totalDurationMs: number;
  tools: AIToolCall[];
  finalResponseLength: number;
  error?: string;
}

export interface SolveEvent extends BaseLogEvent {
  type: 'solve';
  strategy: string;
  solveTimeMs: number;
  propagationTimeMs?: number;
  taskCount: number;
  scheduledCount: number;
  infeasibleCount: number;
  feasibilityRate: number;
  resourceCount: number;
  horizonDays: number;
  windowsTightened?: number;
  scoringSource?: string;
  error?: string;
}

export interface APIErrorEvent extends BaseLogEvent {
  type: 'api_error';
  endpoint: string;
  method: string;
  statusCode: number;
  message: string;
  stack?: string;             // only in console/file transports, never sent to client
}

export interface SystemErrorEvent extends BaseLogEvent {
  type: 'system_error';
  severity: 'warning' | 'error' | 'fatal';
  category: 'database' | 'config' | 'engine' | 'ai_provider' | 'unknown';
  message: string;
  stack?: string;             // never sent to client
  context?: Record<string, any>;  // e.g. { query, table } — no PII, no full payloads
}

export type LogEvent = AICallEvent | SolveEvent | APIErrorEvent | SystemErrorEvent;
