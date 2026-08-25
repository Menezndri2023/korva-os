import { Logger } from '@nestjs/common';
import { StructuredLogger } from './structured-logger.service';
import { runWithRequestContext } from './request-context';

/**
 * `forceConsole: true` routes Nest's ConsoleLogger through console.log/console.error instead of
 * process.stdout/stderr.write — the same escape hatch Nest documents for test environments like
 * Jest that buffer/mock console calls (see ConsoleLoggerOptions.forceConsole). Spying on
 * console.log lets these tests assert on the exact JSON object emitted.
 */
function readJsonLogLine(spy: jest.SpyInstance): Record<string, unknown> {
  expect(spy).toHaveBeenCalled();
  const [line] = spy.mock.calls[spy.mock.calls.length - 1] as [string];
  return JSON.parse(line) as Record<string, unknown>;
}

describe('StructuredLogger', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('TEST 1 — emits valid JSON with no requestId field outside any request context', () => {
    const logger = new StructuredLogger({
      forceConsole: true,
      context: 'NoContext',
    });
    logger.log('hello outside a request');

    const parsed = readJsonLogLine(logSpy);
    expect(parsed.message).toBe('hello outside a request');
    expect(parsed.context).toBe('NoContext');
    expect(parsed.requestId).toBeUndefined();
  });

  it('TEST 2 — stamps the active request id on a log line emitted inside runWithRequestContext', () => {
    const logger = new StructuredLogger({
      forceConsole: true,
      context: 'InRequest',
    });

    runWithRequestContext({ requestId: 'req-123' }, () => {
      logger.log('inside the request');
    });

    const parsed = readJsonLogLine(logSpy);
    expect(parsed.requestId).toBe('req-123');
  });

  it('TEST 3 — two different Logger contexts emit the SAME requestId within one request', () => {
    runWithRequestContext({ requestId: 'req-shared' }, () => {
      new StructuredLogger({ forceConsole: true, context: 'ServiceA' }).log(
        'from service A',
      );
      new StructuredLogger({ forceConsole: true, context: 'ServiceB' }).log(
        'from service B',
      );
    });

    const [firstCallLine] = logSpy.mock.calls[0] as [string];
    const [secondCallLine] = logSpy.mock.calls[1] as [string];
    const first = JSON.parse(firstCallLine) as Record<string, unknown>;
    const second = JSON.parse(secondCallLine) as Record<string, unknown>;

    expect(first.requestId).toBe('req-shared');
    expect(second.requestId).toBe('req-shared');
    expect(first.context).toBe('ServiceA');
    expect(second.context).toBe('ServiceB');
  });

  it('TEST 4 — a log line emitted after the request context ends carries no requestId', () => {
    const logger = new StructuredLogger({
      forceConsole: true,
      context: 'AfterRequest',
    });

    runWithRequestContext({ requestId: 'req-ended' }, () => {
      /* request handling finishes here */
    });
    logger.log('emitted after the request already completed');

    const parsed = readJsonLogLine(logSpy);
    expect(parsed.requestId).toBeUndefined();
  });

  it('TEST 5 — app.useLogger(new StructuredLogger()) makes plain `new Logger(ctx)` call sites pick up the requestId too', () => {
    // This is the actual mechanism main.ts relies on: Logger.overrideLogger() (invoked
    // internally by app.useLogger()) redirects every `new Logger(SomeClass.name)` instance
    // app-wide through the given LoggerService, with zero changes to any of those call sites.
    Logger.overrideLogger(new StructuredLogger({ forceConsole: true }));
    const anyServiceLogger = new Logger('SomeUnrelatedService');

    runWithRequestContext({ requestId: 'req-override' }, () => {
      anyServiceLogger.log('business as usual');
    });

    const parsed = readJsonLogLine(logSpy);
    expect(parsed.requestId).toBe('req-override');
    expect(parsed.context).toBe('SomeUnrelatedService');

    // Restore the default logger so this test file doesn't leak global state into others.
    Logger.overrideLogger(new Logger());
  });
});
