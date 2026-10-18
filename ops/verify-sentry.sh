#!/usr/bin/env bash
#
# Proves that SENTRY_DSN actually reaches Sentry, by sending one deliberate test event and
# waiting for the transport to confirm it. Run ON THE SERVER, after ops/set-secret.sh SENTRY_DSN:
#
#   ~/ops/verify-sentry.sh
#
# WHY A DEDICATED CHECK. "The DSN is set" and "errors arrive in Sentry" are different claims, and
# only the second one is worth anything. A DSN with a wrong project id, a revoked key, or a
# region mismatch is accepted by Sentry.init() without complaint and then silently drops
# everything — the SDK is built never to break the host application, which is correct for
# production and useless for verification.
#
# This runs in a SEPARATE node process inside the api container, so it initialises its own
# client and cannot disturb the running application. It sends a message, not an exception, and
# never touches a route, so nothing in the API is broken to test it.
#
set -euo pipefail

COMPOSE_DIR="${KORVA_COMPOSE_DIR:-$HOME/korva-os}"
cd "$COMPOSE_DIR"

docker compose -f docker-compose.prod.yml --env-file .env.production exec -T api node -e '
(async () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("FAIL: SENTRY_DSN is empty in the container. Run ops/set-secret.sh SENTRY_DSN.");
    process.exit(1);
  }
  // Report the shape without the key: a DSN is https://<publicKey>@<host>/<projectId>, and the
  // public key is not a password but there is no reason to print it either.
  try {
    const u = new URL(dsn);
    console.log("DSN host:", u.host, "| project:", u.pathname.replace("/", ""));
  } catch {
    console.log("FAIL: SENTRY_DSN is not a valid URL.");
    process.exit(1);
  }

  const Sentry = require("@sentry/node");
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  const stamp = new Date().toISOString();
  const id = Sentry.captureMessage(
    "KORVA deliberate test event from ops/verify-sentry.sh at " + stamp,
    "info",
  );
  console.log("event id:", id);

  // flush() resolves true only once the transport has handed the event over. Without it the
  // process would exit first and the event would never leave, which is the classic way a
  // verification like this reports success while proving nothing.
  const delivered = await Sentry.flush(15000);
  if (!delivered) {
    console.log("FAIL: the event was not flushed within 15s — wrong DSN, or no egress to Sentry.");
    process.exit(1);
  }
  console.log("OK: event accepted by the transport.");
  console.log("Now LOOK IN SENTRY for the message above. The transport confirming delivery is");
  console.log("not the same as the project accepting it — a wrong project id can still 403 at");
  console.log("the far end, and only the Sentry UI can tell you that.");
})().catch((e) => {
  console.log("FAIL:", e && e.message ? e.message : e);
  process.exit(1);
});
'
