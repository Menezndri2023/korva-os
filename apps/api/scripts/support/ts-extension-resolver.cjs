/**
 * Makes `ts-node` able to load this monorepo's own TypeScript sources.
 *
 * Why it is needed: `packages/*` publish their sources directly (ADR-001 — no build step,
 * `main`/`types` point at `src/*.ts`), and those sources import each other with explicit `.ts`
 * extensions. `apps/api/tsconfig.json` sets `rewriteRelativeImportExtensions: true`, so the
 * compiler turns `./rbac.ts` into `./rbac.js` — correct for `nest build`, which emits real `.js`
 * next to it, but fatal under ts-node, where that `.js` never exists on disk. Every script in
 * this directory failed with `Cannot find module './rbac.js'` before this hook existed.
 *
 * Jest already solves the same problem its own way, via `moduleNameMapper`
 * (`"^(\\.{1,2}/.*)\\.js$": "$1"` in apps/api/package.json) — which is why the test suite always
 * worked while every script was broken. This is that mapping, for the CommonJS loader.
 *
 * Deliberately narrow: it only rewrites a RELATIVE request ending in `.js` whose `.js` file is
 * absent and whose sibling `.ts` exists. A real `.js` on disk always wins, and a bare package
 * specifier is never touched, so nothing in node_modules can be redirected by this.
 */
const Module = require('node:module');
const { existsSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(
  request,
  parent,
  ...rest
) {
  if (
    typeof request === 'string' &&
    request.endsWith('.js') &&
    (request.startsWith('./') || request.startsWith('../')) &&
    parent &&
    typeof parent.filename === 'string'
  ) {
    const base = resolve(dirname(parent.filename), request);
    if (!existsSync(base)) {
      const asTs = `${base.slice(0, -3)}.ts`;
      if (existsSync(asTs)) return asTs;
    }
  }
  return originalResolveFilename.call(this, request, parent, ...rest);
};
