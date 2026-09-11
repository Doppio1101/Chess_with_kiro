// Minimal ambient declarations for the Node.js built-in modules used by tests.
// @types/node cannot be installed offline, so we declare only what we consume.

declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function test(fn: () => void | Promise<void>): void;
  const _default: typeof test;
  export default _default;
}

declare module 'node:assert' {
  interface AssertFn {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => void, message?: string): void;
  }
  const assert: AssertFn;
  export default assert;
}
