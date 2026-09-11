// rules.test.ts - checkmate, stalemate, insufficient material, and special-move legality.
import { test } from 'node:test';
import assert from 'node:assert';
import { Board, MoveFlag, PieceType, squareToAlgebraic } from '../src/engine/board.js';
import { generateLegalMoves } from '../src/engine/movegen.js';
import {
  getGameResult,
  isCheckmate,
  isStalemate,
  isInsufficientMaterial,
} from '../src/engine/rules.js';

test('back-rank checkmate is detected', () => {
  // Black king on g8 boxed in by its own pawns, white rook delivers mate on e8.
  const b = Board.fromFEN('4R1k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
  assert.ok(isCheckmate(b), 'should be checkmate');
  const result = getGameResult(b);
  assert.strictEqual(result.status, 'checkmate');
  assert.strictEqual(result.winner, 'w');
});

test('fools mate is checkmate', () => {
  // 1. f3 e5 2. g4 Qh4#
  const b = Board.fromFEN('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert.ok(isCheckmate(b), 'fools mate');
  assert.strictEqual(getGameResult(b).winner, 'b');
});

test('stalemate is detected', () => {
  // Classic stalemate: black king a8, white king c7... use known position.
  // Black to move, king on h8, white queen g6, white king f6 -> not; use canonical:
  // Black king a1, white king c2, white queen b3 -> black to move, no legal moves, not in check.
  const b = Board.fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(isStalemate(b), 'should be stalemate');
  const result = getGameResult(b);
  assert.strictEqual(result.status, 'stalemate');
});

test('K vs K is insufficient material', () => {
  const b = Board.fromFEN('8/8/4k3/8/8/4K3/8/8 w - - 0 1');
  assert.ok(isInsufficientMaterial(b));
  assert.strictEqual(getGameResult(b).status, 'draw');
});

test('K+N vs K is insufficient material', () => {
  const b = Board.fromFEN('8/8/4k3/8/8/4K3/8/5N2 w - - 0 1');
  assert.ok(isInsufficientMaterial(b));
});

test('K+B vs K is insufficient material', () => {
  const b = Board.fromFEN('8/8/4k3/8/8/4K3/8/5B2 w - - 0 1');
  assert.ok(isInsufficientMaterial(b));
});

test('K+R vs K is sufficient material', () => {
  const b = Board.fromFEN('8/8/4k3/8/8/4K3/8/5R2 w - - 0 1');
  assert.ok(!isInsufficientMaterial(b));
});

test('en passant capture is generated and legal', () => {
  // White pawn e5, black just played d7-d5, ep square d6.
  const b = Board.fromFEN('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
  const moves = generateLegalMoves(b);
  const ep = moves.find((m) => m.flag === MoveFlag.EnPassant);
  assert.ok(ep, 'en passant move should exist');
  assert.strictEqual(squareToAlgebraic(ep!.from), 'e5');
  assert.strictEqual(squareToAlgebraic(ep!.to), 'd6');
  // Applying it removes the black d5 pawn.
  b.makeMove(ep!);
  assert.strictEqual(b.toFEN().split(' ')[0], 'rnbqkbnr/ppp1pppp/3P4/8/8/8/PPPP1PPP/RNBQKBNR');
  b.undoMove();
});

test('promotion moves are generated (all four pieces)', () => {
  // White pawn on a7, empty a8.
  const b = Board.fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const moves = generateLegalMoves(b);
  const promos = moves.filter((m) => m.flag === MoveFlag.Promotion);
  assert.strictEqual(promos.length, 4, 'four promotion options');
  const types = new Set(promos.map((m) => m.promotion));
  assert.ok(types.has(PieceType.Queen));
  assert.ok(types.has(PieceType.Rook));
  assert.ok(types.has(PieceType.Bishop));
  assert.ok(types.has(PieceType.Knight));
});

test('castling both sides generated and legal from initial castle position', () => {
  const b = Board.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const moves = generateLegalMoves(b);
  const castles = moves.filter((m) => m.flag === MoveFlag.Castle);
  assert.strictEqual(castles.length, 2, 'king-side and queen-side');
  const targets = new Set(castles.map((m) => squareToAlgebraic(m.to)));
  assert.ok(targets.has('g1'), 'king-side to g1');
  assert.ok(targets.has('c1'), 'queen-side to c1');
});

test('cannot castle through check', () => {
  // Black rook on f8 attacks f1, blocking white king-side castle.
  const b = Board.fromFEN('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const moves = generateLegalMoves(b);
  const castles = moves.filter((m) => m.flag === MoveFlag.Castle);
  const targets = new Set(castles.map((m) => squareToAlgebraic(m.to)));
  assert.ok(!targets.has('g1'), 'king-side blocked by attack on f1');
  assert.ok(targets.has('c1'), 'queen-side still allowed');
});

test('make/undo round-trips the FEN', () => {
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  const b = Board.fromFEN(fen);
  const before = b.toFEN();
  const moves = generateLegalMoves(b);
  for (const m of moves) {
    b.makeMove(m);
    b.undoMove();
    assert.strictEqual(b.toFEN(), before, 'state restored after make/undo');
  }
});
