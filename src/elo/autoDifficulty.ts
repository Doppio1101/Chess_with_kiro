// autoDifficulty.ts - the auto-difficulty mode.
//
// Given the player's current stats and their recent results, pick the AI
// difficulty tier the game should use. This satisfies the "automatically adjust
// difficulty based on win count and Elo" requirement:
//   - the BASE tier is chosen from the player's Elo (nearest tier), and
//   - a small adaptive NUDGE bumps the tier up after a win streak or down after
//     a loss streak, so the difficulty tracks recent momentum, not just Elo.
//
// Pure logic: depends on the difficulty tiers and the storage abstraction, not
// on localStorage/DOM, so it is Node-testable with MemoryStorage.

import { Difficulty, DIFFICULTY_ORDER } from '../ai/difficulty.js';
import { PlayerStats, tierForElo, GameResult } from './rating.js';
import { Storage } from './storage.js';

// Number of consecutive wins/losses that triggers a one-tier nudge.
export const STREAK_THRESHOLD = 3;

// How many recent results we keep for streak detection.
const RECENT_HISTORY_LIMIT = 10;

export const RECENT_RESULTS_STORAGE_KEY = 'chess.recentResults';

// Clamp a tier index into the valid range.
function clampTierIndex(index: number): number {
  if (index < 0) return 0;
  if (index >= DIFFICULTY_ORDER.length) return DIFFICULTY_ORDER.length - 1;
  return index;
}

// Shift a tier by `delta` steps along DIFFICULTY_ORDER (positive = stronger).
export function shiftTier(tier: Difficulty, delta: number): Difficulty {
  const idx = DIFFICULTY_ORDER.indexOf(tier);
  return DIFFICULTY_ORDER[clampTierIndex(idx + delta)];
}

// Compute the current streak from most-recent-last results.
//  > 0 : that many consecutive WINS at the tail
//  < 0 : that many consecutive LOSSES at the tail
//  = 0 : tail is a draw, or empty
export function currentStreak(recent: GameResult[]): number {
  if (recent.length === 0) return 0;
  const last = recent[recent.length - 1];
  if (last === 'draw') return 0;
  let count = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] === last) count++;
    else break;
  }
  return last === 'win' ? count : -count;
}

// The nudge (in tiers) implied by a streak: +1 on a win streak at/over the
// threshold, -1 on a loss streak at/over the threshold, else 0.
export function streakNudge(recent: GameResult[]): number {
  const streak = currentStreak(recent);
  if (streak >= STREAK_THRESHOLD) return 1;
  if (streak <= -STREAK_THRESHOLD) return -1;
  return 0;
}

// The core selection: nearest tier to the player's Elo, then nudged by the
// recent-results streak. Pure function over its inputs.
export function autoDifficulty(stats: PlayerStats, recent: GameResult[] = []): Difficulty {
  const base = tierForElo(stats.elo);
  return shiftTier(base, streakNudge(recent));
}

// --- Storage-backed recent-results tracking --------------------------------

// Load the recent-results ring (oldest first), or an empty list.
export function loadRecentResults(
  storage: Storage,
  key: string = RECENT_RESULTS_STORAGE_KEY,
): GameResult[] {
  const saved = storage.get<GameResult[]>(key);
  if (Array.isArray(saved)) {
    return saved.filter(
      (r): r is GameResult => r === 'win' || r === 'loss' || r === 'draw',
    );
  }
  return [];
}

// Append a result and persist the (trimmed) recent-results ring.
export function pushRecentResult(
  storage: Storage,
  result: GameResult,
  key: string = RECENT_RESULTS_STORAGE_KEY,
): GameResult[] {
  const recent = loadRecentResults(storage, key);
  recent.push(result);
  const trimmed = recent.slice(-RECENT_HISTORY_LIMIT);
  storage.set(key, trimmed);
  return trimmed;
}

// Convenience: read stats + recent results from storage and return the tier the
// auto mode should use right now.
export function autoDifficultyFromStorage(
  storage: Storage,
  stats: PlayerStats,
  recentKey: string = RECENT_RESULTS_STORAGE_KEY,
): Difficulty {
  return autoDifficulty(stats, loadRecentResults(storage, recentKey));
}
