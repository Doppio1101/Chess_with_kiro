// difficulty.test.ts - the five tiers map to valid, monotonically
// non-decreasing strength parameters within sane bounds.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  configFor,
  paramsFor,
  difficultyForElo,
  Difficulty,
} from '../src/ai/difficulty.js';

test('exactly five tiers in weakest-to-strongest order', () => {
  assert.strictEqual(DIFFICULTY_ORDER.length, 5);
  assert.deepStrictEqual(DIFFICULTY_ORDER, [
    'practice',
    'beginner',
    'intermediate',
    'advanced',
    'pro',
  ]);
});

test('movetime and depth are non-decreasing across tiers', () => {
  let prevMovetime = 0;
  let prevDepth = 0;
  let prevElo = 0;
  for (const level of DIFFICULTY_ORDER) {
    const cfg = configFor(level);
    assert.ok(
      cfg.movetimeMs >= prevMovetime,
      `${level}: movetime ${cfg.movetimeMs} must be >= previous ${prevMovetime}`
    );
    assert.ok(
      cfg.maxDepth >= prevDepth,
      `${level}: maxDepth ${cfg.maxDepth} must be >= previous ${prevDepth}`
    );
    assert.ok(
      cfg.approxElo >= prevElo,
      `${level}: approxElo ${cfg.approxElo} must be >= previous ${prevElo}`
    );
    prevMovetime = cfg.movetimeMs;
    prevDepth = cfg.maxDepth;
    prevElo = cfg.approxElo;
  }
});

test('every tier has sane, finite bounds', () => {
  for (const level of DIFFICULTY_ORDER) {
    const cfg = configFor(level);
    // Finite, positive movetime cap => the engine can never time out.
    assert.ok(Number.isFinite(cfg.movetimeMs) && cfg.movetimeMs > 0, `${level}: finite movetime`);
    assert.ok(cfg.movetimeMs <= 10_000, `${level}: movetime within an upper sanity bound`);
    assert.ok(
      Number.isInteger(cfg.maxDepth) && cfg.maxDepth >= 1 && cfg.maxDepth <= 32,
      `${level}: depth in [1,32]`
    );
    assert.strictEqual(cfg.level, level, `${level}: config.level matches key`);
    assert.ok(cfg.label.length > 0, `${level}: has a label`);
  }
});

test('weakening decreases toward stronger tiers; pro has none', () => {
  // Blunder chance and randomness should not increase as tiers get stronger.
  let prevBlunder = Infinity;
  let prevRandom = Infinity;
  for (const level of DIFFICULTY_ORDER) {
    const cfg = configFor(level);
    const blunder = cfg.skill?.blunderChance ?? 0;
    const randomness = cfg.skill?.randomness ?? 0;
    assert.ok(blunder <= prevBlunder + 1e-9, `${level}: blunder chance non-increasing`);
    assert.ok(randomness <= prevRandom + 1e-9, `${level}: randomness non-increasing`);
    prevBlunder = blunder;
    prevRandom = randomness;
  }
  // Pro plays the best move it finds: no artificial weakening.
  assert.strictEqual(DIFFICULTIES.pro.skill, undefined, 'pro tier has no skill weakening');
});

test('paramsFor mirrors the config values', () => {
  for (const level of DIFFICULTY_ORDER) {
    const cfg = configFor(level);
    const params = paramsFor(level);
    assert.strictEqual(params.movetimeMs, cfg.movetimeMs);
    assert.strictEqual(params.maxDepth, cfg.maxDepth);
    assert.strictEqual(params.skill, cfg.skill);
  }
});

test('difficultyForElo maps ratings to the right tier', () => {
  // Below the weakest tier's approxElo still yields the weakest tier.
  assert.strictEqual(difficultyForElo(0), 'practice');
  assert.strictEqual(difficultyForElo(500), 'practice');
  assert.strictEqual(difficultyForElo(1000), 'beginner');
  assert.strictEqual(difficultyForElo(1399), 'beginner');
  assert.strictEqual(difficultyForElo(1400), 'intermediate');
  assert.strictEqual(difficultyForElo(1800), 'advanced');
  assert.strictEqual(difficultyForElo(2200), 'pro');
  assert.strictEqual(difficultyForElo(3000), 'pro');
  // Monotonic: higher Elo never maps to a weaker tier.
  let prevIdx = -1;
  for (let elo = 0; elo <= 3000; elo += 100) {
    const level = difficultyForElo(elo) as Difficulty;
    const idx = DIFFICULTY_ORDER.indexOf(level);
    assert.ok(idx >= prevIdx, `elo ${elo}: tier index must be non-decreasing`);
    prevIdx = idx;
  }
});
