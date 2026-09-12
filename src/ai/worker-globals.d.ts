// Minimal ambient declarations for the Web Worker globals used by worker.ts.
// @types/node / DOM lib types are not available offline, so we declare only the
// tiny surface the worker consumes. This lets the src build type-check without
// pulling in the full DOM/WebWorker lib.

interface WorkerMessageEvent {
  data: unknown;
}

// The dedicated-worker global scope exposes onmessage and postMessage.
declare function postMessage(message: unknown): void;

declare var onmessage: ((this: unknown, ev: WorkerMessageEvent) => unknown) | null;
