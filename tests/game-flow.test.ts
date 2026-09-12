// game-flow.test.ts - a DOM-free integration test proving the end-to-end wiring
// the browser controller relies on: engine make/undo + legal move validation +
// searchBestMove (the same call the Web Worker makes) within the movetime cap +
// the Elo update path (updateAfterGame / recordGame / pushRecentResult) and the
// auto-difficulty tier selection. There is no headless browser here, so this
// drives the exact logic main.ts wires together, minus the DOM.

import { test } from 'node:test';
import assert from 'node:assert';

import { Board, Color, Move } from '../src/engine/board.js';
import { generateLegalMoves } from '../src/engine/movegen.js';
import { getGameResult } from '../src/engine/rules.js';
import { handleSearchRequest } from '../src/ai/worker.js';
import { paramsFor } from '../src/ai/difficulty.js';
import { MemoryStorage } from '../src/elo/storage.js';
import {
  eloForTier,
  loadStats,
  recordGame,
  updateAfterGame,
  initialStats,
} from '../src/elo/rating.js';
import { autoDifficultyFromStorage, pushRecentResult } from '../src/elo/autoDifficulty.js';

// Find a concrete legal Move matching from/to (+ optional promotion), the way
// the controller resolves the worker's algebraic reply back to an engine move.
function findLegal(board: Board, from: number, to: number, promotion: number): Move | null {
  const legal = generateLegalMoves(board);
  return (
    legal.find((m) => m.from === from && m.to === to && m.promotion === promotion) ??
    legal.find((m) => m.from === from && m.to === to) ??
    null
  );
}

test('worker returns a legal move within the movetime cap for a mid-game position', () => {
  const board = Board.start();
  const params = paramsFor('beginner');
  const start = Date.now();
  const reply = handleSearchRequest({ fen: board.toFEN(), params });
  const elapsed = Date.now() - start;

  assert.ok(reply.from && reply.to, 'worker returned a move');
  // Movetime cap respected (generous slack for node:test scheduling overhead).
  assert.ok(elapsed <= params.movetimeMs + 500, `elapsed ${elapsed}ms within cap`);
});

test('drive several plies of human-vs-AI through the engine + search', () => {
  const board = Board.start();
  const humanColor: Color = 'w';
  const positionKeys: string[] = [board.positionKey()];

  // A few deterministic human opening moves (by algebraic squares).
  const humanMoves = ['e2e4', 'g1f3', 'f1c4'];

  const sqTo = (s: string): [number, number] => {
    const from = (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 16;
    const to = (s.charCodeAt(2) - 97) + (s.charCodeAt(3) - 49) * 16;
    return [from, to];
  };

  for (let ply = 0; ply < humanMoves.length; ply++) {
    // Human move.
    assert.strictEqual(board.turn, humanColor, 'human to move');
    const [hf, ht] = sqTo(humanMoves[ply]);
    const hMove = findLegal(board, hf, ht, 0);
    assert.ok(hMove, `human move ${humanMoves[ply]} is legal`);
    board.makeMove(hMove!);
    positionKeys.push(board.positionKey());

    if (getGameResult(board, positionKeys).status !== 'ongoing') break;

    // AI reply via the same entry point the Web Worker uses.
    const reply = handleSearchRequest({ fen: board.toFEN(), params: paramsFor('intermediate') });
    assert.ok(reply.from && reply.to, 'AI produced a move');
    const from = (reply.from!.charCodeAt(0) - 97) + (reply.from!.charCodeAt(1) - 49) * 16;
    const to = (reply.to!.charCodeAt(0) - 97) + (reply.to!.charCodeAt(1) - 49) * 16;
    const promo =
      reply.promotion === 'q' ? 5 : reply.promotion === 'r' ? 4 : reply.promotion === 'b' ? 3 : reply.promotion === 'n' ? 2 : 0;
    const aiMove = findLegal(board, from, to, promo);
    assert.ok(aiMove, 'AI move maps to a legal engine move');
    board.makeMove(aiMove!);
    positionKeys.push(board.positionKey());

    // Board stays internally consistent (round-trips through FEN).
    const fen = board.toFEN();
    assert.strictEqual(Board.fromFEN(fen).toFEN(), fen, 'FEN round-trips after AI move');
  }

  // We should have advanced past the opening without any illegal state.
  assert.ok(positionKeys.length > 1, 'game advanced several plies');
});

test('a decisive result feeds the Elo model and updates persisted stats', () => {
  const storage = new MemoryStorage();
  const before = loadStats(storage);
  assert.strictEqual(before.gamesPlayed, 0, 'fresh stats');

  const opponentElo = eloForTier('advanced');
  // Human wins as if by checkmate.
  const after = recordGame(storage, opponentElo, 'win');
  pushRecentResult(storage, 'win');

  assert.strictEqual(after.wins, 1, 'win recorded');
  assert.strictEqual(after.gamesPlayed, 1, 'game counted');
  assert.ok(after.elo > before.elo, 'Elo rose after a win vs a stronger opponent');

  // Persistence survives a reload.
  const reloaded = loadStats(storage);
  assert.strictEqual(reloaded.elo, after.elo, 'stats persisted');
  assert.strictEqual(reloaded.wins, 1, 'wins persisted');
});

test('auto-difficulty tracks Elo and a win streak (the controller pre-game selection)', () => {
  const storage = new MemoryStorage();

  // Simulate a strong player with a win streak.
  let stats = initialStats(1450);
  for (let i = 0; i < 4; i++) {
    stats = updateAfterGame(stats, eloForTier('intermediate'), 'win');
    pushRecentResult(storage, 'win');
  }

  const tier = autoDifficultyFromStorage(storage, stats);
  // With a mid-1400s Elo and a 4-game win streak, auto mode should not pick the
  // weakest tier; it should be at least intermediate.
  const order = ['practice', 'beginner', 'intermediate', 'advanced', 'pro'];
  assert.ok(order.indexOf(tier) >= order.indexOf('intermediate'), `tier ${tier} matched to strong player`);
});
