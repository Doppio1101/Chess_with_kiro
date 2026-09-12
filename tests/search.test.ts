// search.test.ts - tests for the AI search: correctness on tactics, the
// movetime cap / no-timeout guarantee, and legal-move safety at every tier.

import { test } from 'node:test';
import assert from 'node:assert';

import { Board, squareToAlgebraic, Move } from '../src/engine/board.js';
import { generateLegalMoves } from '../src/engine/movegen.js';
import { searchBestMove, MOVETIME_TOLERANCE_MS } from '../src/ai/search.js';
import { DIFFICULTY_ORDER, paramsFor } from '../src/ai/difficulty.js';

function moveIsLegal(fen: string, move: Move): boolean {
  const board = Board.fromFEN(fen);
  const legal = generateLegalMoves(board);
  return legal.some(
    (m) =>
      m.from === move.from &&
      m.to === move.to &&
      m.promotion === move.promotion &&
      m.flag === move.flag
  );
}

function moveStr(move: Move | null): string {
  if (!move) return '(none)';
  return squareToAlgebraic(move.from) + squareToAlgebraic(move.to);
}

test('finds a forced mate-in-1', () => {
  // White to move: Qb7-b8 is mate? Use a clean back-rank mate setup.
  // Position: black king on g8 boxed in by its own pawns, white rook delivers
  // mate on the back rank. "6k1/5ppp/8/8/8/8/8/R6K w - - 0 1": Ra8#.
  const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
  const board = Board.fromFEN(fen);
  const res = searchBestMove(board, { movetimeMs: 1000, maxDepth: 4 });
  assert.ok(res.move, 'a move was returned');
  assert.strictEqual(moveStr(res.move), 'a1a8', `expected Ra8# but got ${moveStr(res.move)}`);
});

test('finds a mate-in-1 with the queen (scholar\'s mate)', () => {
  // Classic scholar's mate: white queen on h5 and bishop on c4 both bear on f7.
  // Qxf7# is the only mating move (the queen is defended by the bishop).
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 3';
  const board = Board.fromFEN(fen);
  const res = searchBestMove(board, { movetimeMs: 1000, maxDepth: 4 });
  assert.ok(res.move, 'a move was returned');
  assert.strictEqual(moveStr(res.move), 'h5f7', `expected Qxf7# but got ${moveStr(res.move)}`);
});

test('grabs a free hanging queen', () => {
  // White to move. Black queen sits on d5 completely undefended; white pawn on
  // e4 can capture it: exd5. Nothing else comes close in value.
  const fen = '4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1';
  const board = Board.fromFEN(fen);
  const res = searchBestMove(board, { movetimeMs: 1000, maxDepth: 4 });
  assert.ok(res.move, 'a move was returned');
  assert.strictEqual(moveStr(res.move), 'e4d5', `expected exd5 but got ${moveStr(res.move)}`);
});

test('always returns a legal move that respects the movetime cap at every tier', () => {
  // A rich middlegame position (Kiwipete) exercises the full search.
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

  for (const level of DIFFICULTY_ORDER) {
    const params = paramsFor(level);
    const board = Board.fromFEN(fen);
    const start = Date.now();
    const res = searchBestMove(board, params);
    const elapsed = Date.now() - start;

    assert.ok(res.move, `${level}: returned a move`);
    assert.ok(
      moveIsLegal(fen, res.move as Move),
      `${level}: returned move ${moveStr(res.move)} must be legal`
    );
    assert.ok(
      elapsed <= params.movetimeMs + MOVETIME_TOLERANCE_MS + 200,
      `${level}: elapsed ${elapsed}ms must respect cap ${params.movetimeMs}ms (+tolerance)`
    );
  }
});

test('returns a legal move even under an absurdly tiny movetime cap', () => {
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  const board = Board.fromFEN(fen);
  const res = searchBestMove(board, { movetimeMs: 1, maxDepth: 20 });
  assert.ok(res.move, 'a move was returned even with a 1ms cap');
  assert.ok(moveIsLegal(fen, res.move as Move), 'the move under a tiny cap is still legal');
});

test('returns null only when there are no legal moves (checkmate)', () => {
  // Fool's mate final position: black is checkmated, white to move is fine, but
  // set it so the side to move has no legal moves.
  const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
  const board = Board.fromFEN(fen);
  const res = searchBestMove(board, { movetimeMs: 200, maxDepth: 4 });
  assert.strictEqual(res.move, null, 'no legal move exists in a checkmated position');
});

test('pro tier never plays a weaker/illegal move than practice on a tactic', () => {
  // On the free-queen position, the pro tier (no weakening) must find exd5.
  // The practice tier must at least always return a LEGAL move.
  const fen = '4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1';

  const proBoard = Board.fromFEN(fen);
  const pro = searchBestMove(proBoard, paramsFor('pro'));
  assert.ok(pro.move && moveIsLegal(fen, pro.move), 'pro returns a legal move');
  assert.strictEqual(moveStr(pro.move), 'e4d5', 'pro captures the free queen');

  // Deterministic RNG (always 0) forces practice down its weakening branches;
  // it must still only ever return a legal move.
  const practiceBoard = Board.fromFEN(fen);
  const practice = searchBestMove(practiceBoard, paramsFor('practice'), () => 0);
  assert.ok(
    practice.move && moveIsLegal(fen, practice.move),
    'practice always returns a legal move even when weakened'
  );
});
