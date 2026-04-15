export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  event: string;
  details?: Record<string, unknown>;
}

export function toLogEntry(
  scope: string,
  event: string,
  details?: Record<string, unknown>,
  level: LogLevel = "info"
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    scope,
    event,
    details: sanitizeForLog(details) as Record<string, unknown> | undefined
  };
}

export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nextValue]) => [key, sanitizeForLog(nextValue)])
    );
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}
