"use client";

import { useEffect } from "react";

const MAX_REPORTS_PER_PAGE = 5;
let sent = 0;
const seen = new Set<string>();

/**
 * Sends one browser error to the API's POST /client-errors, which forwards it to Sentry. Path
 * only — never the query string (the tracking page carries an e-mail there). At most five, and
 * each message once, per page load: a loop throwing on every frame must not flood anything.
 * Never throws: reporting an error must not cause another.
 */
export function reportClientError(
  endpoint: string,
  app: "web" | "storefront",
  error: unknown,
): void {
  try {
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
    if (!message || seen.has(message) || sent >= MAX_REPORTS_PER_PAGE) return;
    seen.add(message);
    sent += 1;
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        app,
        message: message.slice(0, 500),
        stack: error instanceof Error && error.stack ? error.stack.slice(0, 4000) : undefined,
        path: window.location.pathname,
      }),
    }).catch(() => {});
  } catch {
    // Nothing to do: the page goes on.
  }
}

/** Mounted once in a root layout: catches what nothing else caught on the page. */
export function ErrorReporter({ endpoint, app }: { endpoint: string; app: "web" | "storefront" }) {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(endpoint, app, event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(endpoint, app, event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [endpoint, app]);
  return null;
}
