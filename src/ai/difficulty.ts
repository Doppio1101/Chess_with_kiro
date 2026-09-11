// difficulty.ts - the five difficulty tiers and their mapping to search
// parameters. Pure logic: NO DOM / Worker references.
//
// Design:
//  - Strength grows monotonically from `practice` to `pro`: each tier has a
//    movetime cap and max search depth that are >= the previous tier's.
//  - Lower tiers are weakened ONLY by (a) a shorter movetime, (b) a shallower
//    max depth, and (c) deliberately picking a suboptimal legal move sometimes
//    (randomness / blunderChance). The hard movetime SAFETY cap is never
//    removed, so the engine can never time out at any tier.
//  - `pro` applies no artificial weakening (skill undefined): it plays the best
//    move it finds within its (longest) movetime cap. Under this offline,
//    dependency-free sandbox that is strong club level rather than literal
//    grandmaster/Stockfish strength (documented in the README).

import { SearchParams, SkillParams } from './search.js';

export type Difficulty = 'practice' | 'beginner' | 'intermediate' | 'advanced' | 'pro';

// Ordered weakest -> strongest. Used for monotonicity checks and auto-matching.
export const DIFFICULTY_ORDER: Difficulty[] = [
  'practice',
  'beginner',
  'intermediate',
  'advanced',
  'pro',
];

export interface DifficultyConfig {
  level: Difficulty;
  // Human-facing label and an approximate Elo the tier is tuned to feel like.
  label: string;
  approxElo: number;
  // Search parameters handed to searchBestMove.
  movetimeMs: number;
  maxDepth: number;
  skill?: SkillParams;
}

// Exact, documented values for each tier.
//
//  level        movetimeMs  maxDepth  weakening (skill)
//  -----------  ----------  --------  ----------------------------------------
//  practice        200          2     blunderChance .35, randomness .8, topN 6
//  beginner        400          3     blunderChance .15, randomness .5, topN 4
//  intermediate    800          5     randomness .25, topN 3 (no blunders)
//  advanced       1500          7     randomness .08, topN 2
//  pro            3000         14     none (plays best move found)
//
// movetimeMs and maxDepth are both non-decreasing across the tiers, so strength
// grows monotonically. Every tier keeps a finite movetime cap => no timeouts.
export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  practice: {
    level: 'practice',
    label: 'Practice',
    approxElo: 600,
    movetimeMs: 200,
    maxDepth: 2,
    skill: { blunderChance: 0.35, randomness: 0.8, topN: 6 },
  },
  beginner: {
    level: 'beginner',
    label: 'Beginner',
    approxElo: 1000,
    movetimeMs: 400,
    maxDepth: 3,
    skill: { blunderChance: 0.15, randomness: 0.5, topN: 4 },
  },
  intermediate: {
    level: 'intermediate',
    label: 'Intermediate',
    approxElo: 1400,
    movetimeMs: 800,
    maxDepth: 5,
    skill: { blunderChance: 0, randomness: 0.25, topN: 3 },
  },
  advanced: {
    level: 'advanced',
    label: 'Advanced',
    approxElo: 1800,
    movetimeMs: 1500,
    maxDepth: 7,
    skill: { blunderChance: 0, randomness: 0.08, topN: 2 },
  },
  pro: {
    level: 'pro',
    label: 'Pro',
    approxElo: 2200,
    movetimeMs: 3000,
    maxDepth: 14,
    // No skill => no artificial weakening; always plays the best move found.
  },
};

// Build the SearchParams object for a given difficulty.
export function paramsFor(level: Difficulty): SearchParams {
  const cfg = DIFFICULTIES[level];
  return { movetimeMs: cfg.movetimeMs, maxDepth: cfg.maxDepth, skill: cfg.skill };
}

// Return the config for a difficulty level.
export function configFor(level: Difficulty): DifficultyConfig {
  return DIFFICULTIES[level];
}

// Map an Elo rating to the closest tier (used by the auto-difficulty mode).
// Chooses the strongest tier whose approxElo does not exceed the player's Elo,
// so improving players are matched against progressively stronger opponents.
export function difficultyForElo(elo: number): Difficulty {
  let chosen: Difficulty = DIFFICULTY_ORDER[0];
  for (const level of DIFFICULTY_ORDER) {
    if (elo >= DIFFICULTIES[level].approxElo) chosen = level;
  }
  return chosen;
}
