# Chess with Kiro

A dependency-free chess web app built with plain TypeScript compiled to native ES
modules. It runs directly in the browser (no bundler, no runtime npm packages) and is
designed to also work on mobile as a responsive PWA, with a documented path to native
packaging via Capacitor.

## Status

This repository is being built feature by feature. The current milestone (FEAT-001)
delivers the project scaffold and a correct, fully rules-compliant chess engine. The AI
search, Elo rating / auto-difficulty system, and the browser UI arrive in later features.

## Architecture

The code is split so that the pure game logic has zero DOM or Worker references and can be
unit-tested under Node.

- `src/engine/board.ts` — 0x88 board representation, piece encoding, FEN parse/export, and
  `makeMove` / `undoMove` with full state restoration (captured piece, castling rights, en
  passant square, halfmove/fullmove clocks, king tracking).
- `src/engine/movegen.ts` — legal move generation: pawn pushes/captures, en passant,
  promotions, castling (with all legality conditions), knight/king steps, sliding pieces,
  square-attack detection, and a `perft` helper for correctness testing.
- `src/engine/rules.ts` — game-status detection: checkmate, stalemate, and draws by the
  fifty-move rule, threefold repetition, and insufficient material.
- `src/ai/` — (later) evaluation, alpha-beta search with iterative deepening, quiescence,
  a hard movetime cap, and a Web Worker entry so search never blocks the UI.
- `src/elo/` — (later) Elo rating updates, persistence, and auto-difficulty matching.
- `src/ui/` — (later) DOM board rendering, input handling, difficulty selector, and stats.

## Build

TypeScript is compiled with the globally installed `tsc` (no local dependencies).

```sh
# Compile the engine/app sources to native ES modules in dist/
tsc -p tsconfig.json
```

> Note: in this environment you must `unset NODE_OPTIONS` before invoking `node` or `tsc`,
> otherwise Node tries to preload a missing `proxy-bootstrap.js` and crashes.

## Test

Tests use Node's built-in test runner (`node --test`) and the `node:assert` module. No
external test framework is required. Sources and tests are compiled together to
`dist-tests/` and then executed.

```sh
tsc -p tsconfig.tests.json
node --test 'dist-tests/tests/**/*.test.js'
```

Correctness of the move generator is proven with **perft** node-count tests that match the
standard published values:

| Position   | depth 1 | depth 2 | depth 3 | depth 4 |
| ---------- | ------- | ------- | ------- | ------- |
| Start      | 20      | 400     | 8902    | 197281  |
| Kiwipete   | 48      | 2039    | 97862   | —       |

Additional tests cover checkmate, stalemate, insufficient-material draws, and the legality
of en passant, promotion, and castling (including "cannot castle through check").

## Offline / engine-strength limitation

This project is developed under a no-network constraint: npm packages cannot be installed
and the Stockfish engine (`stockfish.js` / `stockfish.wasm`) cannot be downloaded. The AI
opponent is therefore hand-written (alpha-beta search, arriving in a later feature).
A hand-written search tuned for responsiveness plays a strong club-to-expert level game,
but literal grandmaster / Stockfish strength is **not** achievable under these constraints.

## Mobile

The app targets browsers first and is designed as a responsive PWA (installable, works on
mobile screens). For a native mobile build, the same static output can be wrapped with
[Capacitor](https://capacitorjs.com/) without changing the game logic; this path will be
documented once the UI feature lands.
