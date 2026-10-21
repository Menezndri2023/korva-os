import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the production build configuration, not the code.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at BUILD time, so a variable that docker-compose.prod.yml
 * does not pass as a build arg (and the Dockerfile does not declare) silently becomes its
 * development fallback in production. That is how every "Voir mon site" link pointed at
 * localhost:3001 for weeks: NEXT_PUBLIC_STOREFRONT_URL was read in six places and passed in none.
 * Nothing failed — owners just could not reach their own sites.
 *
 * The storefront's server code also reads STOREFRONT_URL and APP_URL at RUNTIME; unset, every page
 * declared itself at localhost (canonical, og:url, sitemap) and the dashboard preview could not
 * frame it.
 */

const repoRoot = resolve(__dirname, "../../../..");
const compose = readFileSync(join(repoRoot, "docker-compose.prod.yml"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function publicVarsUsedIn(app: string): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(join(repoRoot, "apps", app, "src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

/** The text of one top-level service block in docker-compose.prod.yml. */
function serviceBlock(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `service "${name}" in docker-compose.prod.yml`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe.each([
  ["web", "web"],
  ["storefront", "storefront"],
])("production build of apps/%s", (app, service) => {
  const dockerfile = readFileSync(join(repoRoot, "apps", app, "Dockerfile"), "utf8");
  const block = serviceBlock(service);

  it.each(publicVarsUsedIn(app))("passes %s as a build arg", (name) => {
    expect(dockerfile).toMatch(new RegExp(`^ARG ${name}\\b`, "m"));
    expect(block).toMatch(new RegExp(`^\\s+${name}: \\$\\{[A-Z_]+\\}`, "m"));
  });
});

describe("storefront runtime environment", () => {
  it.each(["STOREFRONT_URL", "APP_URL"])("sets %s", (name) => {
    expect(serviceBlock("storefront")).toMatch(new RegExp(`^\\s+${name}: \\$\\{${name}\\}`, "m"));
  });
});
