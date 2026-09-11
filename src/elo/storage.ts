// storage.ts - a tiny key/value JSON persistence abstraction.
//
// The Elo model (rating.ts) and the auto-difficulty selector (autoDifficulty.ts)
// must be unit-testable under Node, where there is no `localStorage` / `window`.
// So they depend on this `Storage` interface rather than touching localStorage
// directly. The browser app wires up `BrowserStorage`; tests wire up
// `MemoryStorage`.
//
// Values are stored/retrieved as parsed JSON so callers work with plain objects
// (e.g. PlayerStats) and never hand-serialize.

export interface Storage {
  // Read the value for `key`, or `undefined` if absent / unparseable.
  get<T>(key: string): T | undefined;
  // Persist `value` under `key` (JSON-serialized).
  set<T>(key: string, value: T): void;
  // Remove `key` if present.
  remove(key: string): void;
}

// In-memory implementation. Pure, dependency-free, Node-runnable. Used by tests
// and as a safe fallback when no persistent storage is available.
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get<T>(key: string): T | undefined {
    const raw = this.map.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

// Minimal shape of the Web Storage API (localStorage) we rely on. Declared
// locally so the src build type-checks offline without pulling in the DOM lib.
interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Browser implementation backed by localStorage (or any Web Storage-compatible
// object). Kept isolated here so no other module references `localStorage`
// directly. The reference to the global is guarded so this file still compiles
// and imports cleanly under Node; constructing BrowserStorage() without a
// backing store throws a clear error instead of crashing at import time.
export class BrowserStorage implements Storage {
  private readonly backing: WebStorageLike;

  constructor(backing?: WebStorageLike) {
    const resolved =
      backing ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as { localStorage?: WebStorageLike }).localStorage
        : undefined);
    if (!resolved) {
      throw new Error('BrowserStorage requires a localStorage-compatible backing store');
    }
    this.backing = resolved;
  }

  get<T>(key: string): T | undefined {
    const raw = this.backing.getItem(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    this.backing.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.backing.removeItem(key);
  }
}

// Pick the best storage available in the current environment: real localStorage
// in the browser, otherwise an in-memory store (so the app degrades gracefully
// and tests/Node never crash on a missing global).
export function defaultStorage(): Storage {
  const ls =
    typeof globalThis !== 'undefined'
      ? (globalThis as { localStorage?: WebStorageLike }).localStorage
      : undefined;
  if (ls) {
    try {
      return new BrowserStorage(ls);
    } catch {
      // fall through to memory
    }
  }
  return new MemoryStorage();
}
