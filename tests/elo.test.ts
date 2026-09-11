// elo.test.ts - Elo rating model + auto-difficulty tests (node:test).

import { test } from 'node:test';
import assert from 'node:assert';

import {
  initialStats,
  updateAfterGame,
  expectedScore,
  eloForTier,
  tierForElo,
  loadStats,
  saveStats,
  recordGame,
  DEFAULT_ELO,
  type PlayerStats,
} from '../src/elo/rating.js';
import {
  autoDifficulty,
  autoDifficultyFromStorage,
  pushRecentResult,
  currentStreak,
  streakNudge,
  shiftTier,
  STREAK_THRESHOLD,
} from '../src/elo/autoDifficulty.js';
import { MemoryStorage } from '../src/elo/storage.js';
import { DIFFICULTY_ORDER, DIFFICULTIES, type Difficulty } from '../src/ai/difficulty.js';

function tierIndex(t: Difficulty): number {
  return DIFFICULTY_ORDER.indexOf(t);
}

// (a) a win vs a higher-rated opponent raises Elo MORE than a win vs a
// lower-rated one.
test('win vs higher-rated opponent raises Elo more than vs lower-rated', () => {
  const stats = initialStats(1500);
  const vsHigher = updateAfterGame(stats, 1900, 'win');
  const vsLower = updateAfterGame(stats, 1100, 'win');

  const gainHigher = vsHigher.elo - stats.elo;
  const gainLower = vsLower.elo - stats.elo;

  assert.ok(gainHigher > 0, 'a win should raise Elo');
  assert.ok(gainLower > 0, 'a win should raise Elo');
  assert.ok(
    gainHigher > gainLower,
    `beating a stronger opponent should gain more (${gainHigher} vs ${gainLower})`,
  );
});

// (b) a loss lowers Elo.
test('a loss lowers Elo', () => {
  const stats = initialStats(1500);
  const after = updateAfterGame(stats, 1500, 'loss');
  assert.ok(after.elo < stats.elo, 'a loss should lower Elo');
});

// (c) a draw vs an equal opponent leaves Elo ~unchanged.
test('draw vs equal opponent leaves Elo ~unchanged', () => {
  const stats = initialStats(1500);
  // Against an equal opponent the expected score is exactly 0.5.
  assert.strictEqual(expectedScore(1500, 1500), 0.5);
  const after = updateAfterGame(stats, 1500, 'draw');
  assert.strictEqual(after.elo, stats.elo, 'draw vs equal should not change Elo');
});

// (d) win/loss/draw/gamesPlayed counters increment correctly.
test('counters increment correctly', () => {
  let stats: PlayerStats = initialStats(1200);
  stats = updateAfterGame(stats, 1200, 'win');
  stats = updateAfterGame(stats, 1200, 'win');
  stats = updateAfterGame(stats, 1200, 'loss');
  stats = updateAfterGame(stats, 1200, 'draw');

  assert.strictEqual(stats.wins, 2);
  assert.strictEqual(stats.losses, 1);
  assert.strictEqual(stats.draws, 1);
  assert.strictEqual(stats.gamesPlayed, 4);
});

// (e) tierForElo / eloForTier round-trip to sane tiers.
test('tierForElo/eloForTier round-trip', () => {
  for (const tier of DIFFICULTY_ORDER) {
    const elo = eloForTier(tier);
    assert.strictEqual(
      tierForElo(elo),
      tier,
      `Elo anchor ${elo} should map back to tier ${tier}`,
    );
  }

  // A low Elo maps to the weakest tier; a very high Elo to the strongest.
  assert.strictEqual(tierForElo(0), DIFFICULTY_ORDER[0]);
  assert.strictEqual(tierForElo(9999), DIFFICULTY_ORDER[DIFFICULTY_ORDER.length - 1]);
});

// (f) auto-difficulty picks a HIGHER tier after a win streak and a LOWER tier
// after a loss streak, using the in-memory storage stub.
test('auto-difficulty nudges up on a win streak and down on a loss streak', () => {
  // Use an Elo whose nearest tier is in the middle so it can move both ways.
  const midElo = DIFFICULTIES.intermediate.approxElo;
  const stats = initialStats(midElo);
  const baseTier = autoDifficulty(stats, []);
  assert.strictEqual(baseTier, 'intermediate');

  const winStreak = Array<'win' | 'loss'>(STREAK_THRESHOLD).fill('win');
  const lossStreak = Array<'win' | 'loss'>(STREAK_THRESHOLD).fill('loss');

  const afterWins = autoDifficulty(stats, winStreak);
  const afterLosses = autoDifficulty(stats, lossStreak);

  assert.ok(
    tierIndex(afterWins) > tierIndex(baseTier),
    `win streak should raise the tier (${baseTier} -> ${afterWins})`,
  );
  assert.ok(
    tierIndex(afterLosses) < tierIndex(baseTier),
    `loss streak should lower the tier (${baseTier} -> ${afterLosses})`,
  );
});

// (f, storage-backed) same behaviour driven through MemoryStorage.
test('auto-difficulty via storage stub reflects recorded results', () => {
  const storage = new MemoryStorage();
  const stats = initialStats(DIFFICULTIES.intermediate.approxElo);
  const base = autoDifficultyFromStorage(storage, stats);

  for (let i = 0; i < STREAK_THRESHOLD; i++) pushRecentResult(storage, 'win');
  const afterWins = autoDifficultyFromStorage(storage, stats);
  assert.ok(
    tierIndex(afterWins) > tierIndex(base),
    'recorded win streak should raise the auto tier',
  );
});

// Streak helpers behave as documented.
test('currentStreak and streakNudge', () => {
  assert.strictEqual(currentStreak([]), 0);
  assert.strictEqual(currentStreak(['win', 'win', 'win']), 3);
  assert.strictEqual(currentStreak(['loss', 'loss']), -2);
  assert.strictEqual(currentStreak(['win', 'draw']), 0, 'a trailing draw breaks the streak');
  assert.strictEqual(currentStreak(['loss', 'win', 'win']), 2);

  assert.strictEqual(streakNudge(Array(STREAK_THRESHOLD).fill('win')), 1);
  assert.strictEqual(streakNudge(Array(STREAK_THRESHOLD).fill('loss')), -1);
  assert.strictEqual(streakNudge(['win']), 0);
});

// shiftTier clamps at the ends.
test('shiftTier clamps at the extremes', () => {
  const strongest = DIFFICULTY_ORDER[DIFFICULTY_ORDER.length - 1];
  const weakest = DIFFICULTY_ORDER[0];
  assert.strictEqual(shiftTier(strongest, 1), strongest, 'cannot go past strongest');
  assert.strictEqual(shiftTier(weakest, -1), weakest, 'cannot go below weakest');
});

// Persistence round-trip through MemoryStorage.
test('loadStats/saveStats/recordGame round-trip via storage', () => {
  const storage = new MemoryStorage();

  // No saved stats -> fresh defaults.
  const fresh = loadStats(storage);
  assert.strictEqual(fresh.elo, DEFAULT_ELO);
  assert.strictEqual(fresh.gamesPlayed, 0);

  saveStats(storage, initialStats(1234));
  assert.strictEqual(loadStats(storage).elo, 1234);

  const after = recordGame(storage, 1300, 'win');
  assert.strictEqual(after.gamesPlayed, 1);
  assert.strictEqual(after.wins, 1);
  assert.ok(after.elo > 1234, 'a recorded win should raise and persist Elo');
  assert.strictEqual(loadStats(storage).elo, after.elo, 'persisted Elo should match');
});
