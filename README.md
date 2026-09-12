# Chess with Kiro

A dependency-free chess web app built with plain TypeScript compiled to native ES
modules. It runs directly in the browser (no bundler, no runtime npm packages), plays
against a hand-written alpha-beta AI, tracks your Elo, and installs as a PWA on mobile.

Play a human-vs-computer game with five difficulty tiers plus an **Auto (Elo)** mode that
automatically matches the AI to your rating. The search runs in a Web Worker so the UI
never freezes, and a hard movetime cap guarantees the AI always replies in time.

## Quick start

TypeScript is compiled with the globally installed `tsc` (no local dependencies), then the
folder is served as static files.

```sh
# 1. Build the TypeScript sources to native ES modules in dist/
tsc -p tsconfig.json

# 2. Serve the folder and open the app
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

> Note: in this environment you must `unset NODE_OPTIONS` before invoking `node` or `tsc`,
> otherwise Node tries to preload a missing `proxy-bootstrap.js` and crashes:
>
> ```sh
> unset NODE_OPTIONS && tsc -p tsconfig.json
> ```

The app is a static site: `index.html` loads `dist/ui/main.js` as a `<script type="module">`,
which spawns `dist/ai/worker.js` as a Web Worker. Any static file server works.

## How to play

- Choose a **Difficulty** (five tiers or Auto), pick which colour to **Play as**, and press
  **New game**.
- Click/tap one of your pieces to select it; legal destinations are highlighted. Click a
  highlighted square to move. Pawn promotions show an inline piece picker.
- The status line shows whose turn it is and announces check, checkmate, stalemate, or a
  draw. Your Elo and win/loss/draw record are shown in the stats panel and persist across
  reloads (via `localStorage`).

## Architecture

The code is split so the pure game logic has zero DOM or Worker references and is
unit-tested under Node. Only the UI layer and the Worker entry touch browser APIs.

- `src/engine/` — the rules engine (pure logic).
  - `board.ts` — 0x88 board representation, piece encoding, FEN parse/export, and
    `makeMove` / `undoMove` with full state restoration.
  - `movegen.ts` — legal move generation (pawns, en passant, promotions, castling,
    knight/king steps, sliders), square-attack detection, and a `perft` helper.
  - `rules.ts` — game-status detection: checkmate, stalemate, and draws by the fifty-move
    rule, threefold repetition, and insufficient material.
- `src/ai/` — the opponent (pure logic + one Worker entry).
  - `evaluate.ts` — material + piece-square-table evaluation.
  - `search.ts` — negamax alpha-beta with iterative deepening, quiescence, move ordering,
    a transposition table, and a **hard movetime cap** so a legal move is always returned.
  - `difficulty.ts` — the five tiers and their search parameters.
  - `worker.ts` — the Web Worker entry that runs the search off the main thread.
- `src/elo/` — rating + auto-difficulty (pure logic + isolated storage).
  - `rating.ts` — standard Elo update, tier↔Elo mapping, and storage-agnostic persistence.
  - `autoDifficulty.ts` — picks the tier from your Elo, nudged by recent win/loss streaks.
  - `storage.ts` — a tiny JSON key/value `Storage` abstraction (`localStorage`-backed in the
    browser, in-memory for tests).
- `src/ui/` — the browser layer (imports the pure modules above).
  - `board.ts` — renders the board and pieces with Unicode glyphs (no image downloads),
    highlights selection/targets, and handles click/tap + the promotion picker.
  - `controls.ts` — difficulty selector (five tiers + Auto), side choice, new-game, status.
  - `stats.ts` — renders Elo, W/L/D, and the matched tier in Auto mode.
  - `main.ts` — the controller: owns the `Board`, spawns the Worker, applies moves, detects
    game end, updates Elo/stats, and reselects the Auto tier before each new game.
- `index.html`, `styles.css`, `manifest.webmanifest`, `icon.svg` — the static PWA shell.

## Difficulty tiers

Each tier maps to search parameters. `movetimeMs` and `maxDepth` grow monotonically, so
strength increases from Practice to Pro. Lower tiers are weakened only by a shorter search
and by occasionally choosing a suboptimal legal move (`randomness` / `blunderChance` /
`topN`) — the hard movetime safety cap is never removed, so the AI can never time out.

| Tier         | ~Elo | movetimeMs | maxDepth | Weakening (skill)                          |
| ------------ | ---- | ---------- | -------- | ------------------------------------------ |
| Practice     | 600  | 200        | 2        | blunderChance .35, randomness .8, topN 6   |
| Beginner     | 1000 | 400        | 3        | blunderChance .15, randomness .5, topN 4   |
| Intermediate | 1400 | 800        | 5        | randomness .25, topN 3 (no blunders)       |
| Advanced     | 1800 | 1500       | 7        | randomness .08, topN 2                      |
| Pro          | 2200 | 3000       | 14       | none (always plays the best move it finds) |

The Elo values are approximate self-play/estimated ratings for this hand-written engine,
not FIDE-calibrated numbers.

## Auto (Elo) difficulty mode

When **Auto (Elo)** is selected, the app tracks your rating with the standard Elo formula:

```
E      = 1 / (1 + 10 ^ ((opponentElo - playerElo) / 400))   // expected score
actual = 1 (win) | 0.5 (draw) | 0 (loss)
newElo = playerElo + K * (actual - E)
```

with `K = 32` for your first 20 games (fast convergence while your rating is uncertain) and
`K = 16` once established. New players start at Elo 1000. After each finished game the
opponent's Elo is the anchor Elo of the tier you played, and your record + rating are
persisted to `localStorage`.

Before each new game in Auto mode, the app picks the tier whose anchor Elo is nearest your
rating, then nudges one tier up after a 3-game win streak (or down after a 3-game loss
streak) so difficulty tracks your recent momentum, not just your rating. This satisfies the
"automatically adjust difficulty from win count and Elo" requirement.

## Offline / engine-strength limitation

This project is developed and runs under a **no-network** constraint: npm packages cannot be
installed and the Stockfish engine (`stockfish.js` / `stockfish.wasm`) cannot be downloaded.
The AI is therefore **hand-written** — an alpha-beta search with iterative deepening,
quiescence, move ordering, and a transposition table. Tuned for responsiveness under a hard
movetime cap, the top (Pro) tier plays a **strong club level** (~2200) game, but literal
**grandmaster / Stockfish strength is not achievable** under these constraints because the
WASM engine binary cannot be fetched and no external packages can be added. Everything
(pieces via Unicode glyphs, the app icon via a committed SVG) is served locally with zero
network requests.

## Mobile (PWA + Capacitor)

The app is mobile-first and responsive: the board scales to the viewport with
touch-friendly targets, and `manifest.webmanifest` makes it **installable** to a phone home
screen (open in a mobile browser → "Add to Home screen"). It runs standalone, fullscreen,
offline.

For a native app store build, the same static output can be wrapped with
[Capacitor](https://capacitorjs.com/) without changing any game logic (this requires network
access to install the tooling, so it is documented rather than included here):

```sh
# When network access is available:
npm install --save @capacitor/core && npm install --save-dev @capacitor/cli
npx cap init "Chess with Kiro" com.example.chess --web-dir .
npx cap add ios
npx cap add android
tsc -p tsconfig.json && npx cap copy   # build web assets, then sync into the native shells
npx cap open android                   # or: npx cap open ios
```

Because the web app is self-contained static files, the Capacitor `web-dir` is simply the
project root (containing `index.html`, `dist/`, `styles.css`, `manifest.webmanifest`).

## Test

Tests use Node's built-in test runner (`node --test`) and the `node:assert` module. No
external test framework is required. Sources and tests are compiled together to
`dist-tests/` and then executed.

```sh
tsc -p tsconfig.tests.json
node --test 'dist-tests/tests/**/*.test.js'
```

Coverage includes:

- **perft** move-generator correctness (matching published node counts):

  | Position | depth 1 | depth 2 | depth 3 | depth 4 |
  | -------- | ------- | ------- | ------- | ------- |
  | Start    | 20      | 400     | 8902    | 197281  |
  | Kiwipete | 48      | 2039    | 97862   | —       |

- checkmate / stalemate / insufficient-material detection and the legality of en passant,
  promotion, and castling;
- the AI search (mate-in-1, free capture, always-legal-within-cap, tier monotonicity);
- the Elo model and auto-difficulty selection;
- `tests/game-flow.test.ts` — a DOM-free integration test that drives a full human-vs-AI
  flow through the engine + the Worker's `handleSearchRequest` + the Elo update path,
  proving the wiring the browser controller relies on without needing a headless browser.
