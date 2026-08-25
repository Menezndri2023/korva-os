import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
}

/**
 * Threads the per-request id set by requestIdMiddleware through every downstream
 * async continuation (guards, interceptors, controller/service code, and any Logger
 * call made along the way) without passing it explicitly through every function
 * signature. AsyncLocalStorage (unlike the old domains/Zone.js approach) correctly
 * follows Promise/async-await chains, so a value set once per request in the
 * middleware is still visible in, say, a service two `await`s deep.
 */
const requestContextStorage = new AsyncLocalStorage<RequestContextStore>();

/** Runs `fn` with `store` bound as the active request context for its entire async lifetime. */
export function runWithRequestContext<T>(
  store: RequestContextStore,
  fn: () => T,
): T {
  return requestContextStorage.run(store, fn);
}

/** The current request's id, or undefined when called outside any request context (e.g. app bootstrap, a cron job, a test that never ran the middleware). */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
