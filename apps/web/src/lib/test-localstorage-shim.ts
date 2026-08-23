// Import this BEFORE anything that imports auth-store.ts. zustand's persist middleware
// resolves `window.localStorage` once, synchronously, at module-evaluation time (when
// auth-store.ts's `create()(persist(...))` call runs) — not lazily per operation. Node's own
// experimental global `localStorage` already exists here (so a `typeof === "undefined"` check
// would never fire) but is inert without `--localstorage-file`, and this jsdom test
// environment doesn't otherwise provide one (vitest.setup.ts deliberately stays minimal — see
// its own comment), so both `globalThis.localStorage` and `window.localStorage` are
// unconditionally replaced with a bare in-memory shim before auth-store.ts ever loads.
const backing = new Map<string, string>();
const shim = {
  getItem: (key: string) => backing.get(key) ?? null,
  setItem: (key: string, value: string) => void backing.set(key, value),
  removeItem: (key: string) => void backing.delete(key),
  clear: () => backing.clear(),
};

const targets = [globalThis, typeof window !== "undefined" ? window : undefined];
for (const target of targets) {
  if (!target) continue;
  Object.defineProperty(target, "localStorage", { value: shim, writable: true, configurable: true });
}
