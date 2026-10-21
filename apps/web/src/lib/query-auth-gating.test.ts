// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every dashboard query to the API must wait until the session is restored (useAuthReady).
 *
 * On a reload the access token is only in memory, so it is gone until useAuthBootstrap refreshes
 * it. A query that fires before that goes out without a token and gets a 401 — the Settings page
 * did exactly that for its roles, custom fields, subscription and audit log until 2026-10-21:
 * each section loaded late, after failed requests. This scans the source so a new query cannot
 * reintroduce it: a useQuery block calling apiClient must carry an `enabled` condition.
 */
const srcRoot = resolve(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function ungatedQueries(source: string): number[] {
  const lines: number[] = [];
  const pattern = /useQuery\(\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (depth > 0 && index < source.length) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
      index += 1;
    }
    const block = source.slice(match.index, index);
    if (block.includes("apiClient") && !block.includes("enabled")) {
      lines.push(source.slice(0, match.index).split("\n").length);
    }
  }
  return lines;
}

describe("dashboard queries wait for the restored session", () => {
  it("has no API query without an `enabled` condition", () => {
    const offenders = [join(srcRoot, "app"), join(srcRoot, "components"), join(srcRoot, "lib")]
      .flatMap(files)
      .flatMap((file) =>
        ungatedQueries(readFileSync(file, "utf8")).map((line) => `${relative(srcRoot, file)}:${line}`),
      );
    expect(offenders).toEqual([]);
  });
});
