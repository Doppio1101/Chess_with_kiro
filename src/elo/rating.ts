// rating.ts - the player Elo model and tier<->Elo mapping.
//
// Pure logic (no DOM / localStorage). Persistence, when used by the app, goes
// through the injectable `Storage` abstraction in storage.ts; the math here is
// storage-agnostic and Node-testable.
//
// Elo update (standard formula):
//   E      = 1 / (1 + 10 ^ ((opponentElo - playerElo) / 400))   // expected score
//   actual = 1 (win) | 0.5 (draw) | 0 (loss)
//   newElo = playerElo + K * (actual - E)
//
// K-factor: we use a provisional K of 32 for the first PROVISIONAL_GAMES games
// (fast convergence while the rating is uncertain) and a settled K of 16 once
// the player is established. This mirrors common online-chess conventions and
// is documented here as the single source of truth.

import {
  Difficulty,
  DIFFICULTY_ORDER,
  DIFFICULTIES,
  difficultyForElo,
} from '../ai/difficulty.js';
import { Storage } from './storage.js';

// Result of a single game from the player's perspective.
export type GameResult = 'win' | 'loss' | 'draw';

// Persisted player record.
export interface PlayerStats {
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
}

// K-factor policy (documented above).
export const PROVISIONAL_K = 32;
export const ESTABLISHED_K = 16;
export const PROVISIONAL_GAMES = 20;

// Starting Elo for a brand-new player. Anchored to the `beginner` tier so a new
// player is matched sensibly in auto mode from game one.
export const DEFAULT_ELO = 1000;

// A fresh stats record.
export function initialStats(elo: number = DEFAULT_ELO): PlayerStats {
  return { elo, wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
}

// The numeric score for a result, from the player's perspective.
function actualScore(result: GameResult): number {
  switch (result) {
    case 'win':
      return 1;
    case 'draw':
      return 0.5;
    case 'loss':
      return 0;
  }
}

// The K-factor to use given how many games the player has completed.
export function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES ? PROVISIONAL_K : ESTABLISHED_K;
}

// Expected score for `playerElo` against `opponentElo` (the logistic curve).
export function expectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

// Apply one game's result, returning a NEW PlayerStats (pure; input untouched).
// The Elo is updated with the standard formula and the win/loss/draw and
// gamesPlayed counters are incremented. Elo is rounded to an integer and
// clamped to be non-negative.
export function updateAfterGame(
  stats: PlayerStats,
  opponentElo: number,
  result: GameResult,
): PlayerStats {
  const k = kFactor(stats.gamesPlayed);
  const expected = expectedScore(stats.elo, opponentElo);
  const actual = actualScore(result);
  const nextElo = Math.max(0, Math.round(stats.elo + k * (actual - expected)));

  return {
    elo: nextElo,
    wins: stats.wins + (result === 'win' ? 1 : 0),
    losses: stats.losses + (result === 'loss' ? 1 : 0),
    draws: stats.draws + (result === 'draw' ? 1 : 0),
    gamesPlayed: stats.gamesPlayed + 1,
  };
}

// --- Tier <-> Elo mapping ---------------------------------------------------
//
// The five tiers' anchor Elos live in difficulty.ts (DIFFICULTIES[t].approxElo)
// as the single source of truth. rating.ts builds its helpers on top of those
// anchors rather than re-declaring them.

// The representative (anchor) Elo for a tier.
export function eloForTier(tier: Difficulty): number {
  return DIFFICULTIES[tier].approxElo;
}

// The tier whose anchor Elo is CLOSEST to `elo` (ties resolved to the stronger
// tier). Note this differs from difficulty.ts's `difficultyForElo`, which picks
// the strongest tier at-or-below the Elo; `tierForElo` picks nearest by
// absolute distance, which is the natural round-trip inverse of `eloForTier`.
export function tierForElo(elo: number): Difficulty {
  let best: Difficulty = DIFFICULTY_ORDER[0];
  let bestDist = Infinity;
  for (const tier of DIFFICULTY_ORDER) {
    const dist = Math.abs(DIFFICULTIES[tier].approxElo - elo);
    if (dist <= bestDist) {
      bestDist = dist;
      best = tier;
    }
  }
  return best;
}

// Re-export the at-or-below mapping for callers that want it under this module.
export { difficultyForElo };

// --- Persistence helpers ----------------------------------------------------
//
// Thin, storage-agnostic load/save so the app (and tests) can persist stats via
// any Storage implementation without importing localStorage.

export const STATS_STORAGE_KEY = 'chess.playerStats';

// Load stats from storage, or a fresh record if none / invalid.
export function loadStats(storage: Storage, key: string = STATS_STORAGE_KEY): PlayerStats {
  const saved = storage.get<PlayerStats>(key);
  if (
    saved &&
    typeof saved.elo === 'number' &&
    typeof saved.wins === 'number' &&
    typeof saved.losses === 'number' &&
    typeof saved.draws === 'number' &&
    typeof saved.gamesPlayed === 'number'
  ) {
    return saved;
  }
  return initialStats();
}

// Persist stats to storage.
export function saveStats(
  storage: Storage,
  stats: PlayerStats,
  key: string = STATS_STORAGE_KEY,
): void {
  storage.set(key, stats);
}

// Record a game result against `opponentElo`, updating and persisting stats.
// Returns the new stats.
export function recordGame(
  storage: Storage,
  opponentElo: number,
  result: GameResult,
  key: string = STATS_STORAGE_KEY,
): PlayerStats {
  const current = loadStats(storage, key);
  const next = updateAfterGame(current, opponentElo, result);
  saveStats(storage, next, key);
  return next;
}
