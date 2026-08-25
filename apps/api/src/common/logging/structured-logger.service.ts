import { ConsoleLogger, ConsoleLoggerOptions, LogLevel } from '@nestjs/common';
import { getRequestId } from './request-context';

/**
 * Nest's own ConsoleLogger already knows how to emit JSON (the `json: true` option, added in
 * Nest 11) — no third-party logging library needed for that half of this lot. What it does NOT
 * do is know about this app's per-request id, since that's an application concept, not a
 * framework one. Overriding the one protected extension point Nest exposes for the JSON log
 * object (`getJsonLogObject`) is the minimal-diff way to add it: every `new Logger(SomeClass.name)`
 * call site across the codebase keeps working unmodified, and `app.useLogger(new
 * StructuredLogger(...))` in main.ts (see bootstrap()) makes ALL of them — via Nest's
 * `Logger.overrideLogger` — go through this class, so log lines emitted anywhere during a
 * request automatically carry that request's id with zero per-call-site changes.
 */
export class StructuredLogger extends ConsoleLogger {
  constructor(options: ConsoleLoggerOptions = {}) {
    super({ json: true, ...options });
  }

  protected getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
    },
  ) {
    const base = super.getJsonLogObject(message, options);
    const requestId = getRequestId();
    return requestId ? { ...base, requestId } : base;
  }
}
