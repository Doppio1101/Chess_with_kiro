// perft.test.ts - validate the move generator against known node counts.
import { test } from 'node:test';
import assert from 'node:assert';
import { Board } from '../src/engine/board.js';
import { perft } from '../src/engine/movegen.js';

test('perft: standard start position', () => {
  const b = Board.start();
  assert.strictEqual(perft(b, 1), 20, 'depth 1');
  assert.strictEqual(perft(b, 2), 400, 'depth 2');
  assert.strictEqual(perft(b, 3), 8902, 'depth 3');
  assert.strictEqual(perft(b, 4), 197281, 'depth 4');
});

test('perft: Kiwipete position', () => {
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  const b = Board.fromFEN(fen);
  assert.strictEqual(perft(b, 1), 48, 'depth 1');
  assert.strictEqual(perft(b, 2), 2039, 'depth 2');
  assert.strictEqual(perft(b, 3), 97862, 'depth 3');
});
