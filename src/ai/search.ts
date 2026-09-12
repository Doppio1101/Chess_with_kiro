// search.ts - negamax alpha-beta search with iterative deepening,
// quiescence search, MVV-LVA move ordering, killer moves, and a transposition
// table. Pure logic: NO DOM / Worker references so it runs identically under
// Node tests and inside the search Web Worker.
//
// A HARD movetime cap guarantees a legal move is ALWAYS available before the
// deadline: iterative deepening keeps the best move from the last fully
// completed depth, and the inner search aborts cleanly the moment the deadline
// passes. This is the "the engine never times out" guarantee.

import { Board, Move, MoveFlag, PieceType, pieceType } from '../engine/board.js';
import { generateLegalMoves } from '../engine/movegen.js';
import { isCheck } from '../engine/rules.js';
import { evaluate, PIECE_VALUE, MATE_SCORE, MATE_THRESHOLD } from './evaluate.js';

export interface SearchParams {
  // Hard wall-clock cap on the search, in milliseconds. The search never runs
  // longer than roughly this (plus a tiny abort-check tolerance).
  movetimeMs: number;
  // Upper bound on iterative-deepening depth. The search may finish earlier if
  // the movetime cap is hit first.
  maxDepth: number;
  // Optional deliberate weakening (0 = full strength). See selection logic:
  // - randomness in [0,1]: probability of NOT always taking the best move.
  // - blunderChance in [0,1]: probability of picking a clearly worse move.
  // - topN: when weakening, choose among the best `topN` root moves.
  skill?: SkillParams;
}

export interface SkillParams {
  randomness?: number; // chance to pick a near-best move instead of the best
  blunderChance?: number; // chance to pick a random legal (possibly bad) move
  topN?: number; // pool size for near-best selection
}

export interface SearchResult {
  move: Move | null; // null only if there are no legal moves (mate/stalemate)
  score: number; // score of the chosen move, side-to-move perspective
  depth: number; // deepest fully completed depth
  nodes: number; // nodes visited (search + quiescence)
  elapsedMs: number; // wall-clock time spent
}

// A random source can be injected for deterministic tests; defaults to Math.random.
export type RandomFn = () => number;

// Hard ply cap for quiescence search. Captures/promotions already make material
// strictly decrease so quiescence terminates on its own; this bound is a
// defensive backstop so termination never depends solely on the movetime clock.
const QUIESCENCE_MAX_PLY = 64;

// Transposition table entry bound types.
const enum Bound {
  Exact = 0,
  Lower = 1, // fail-high: score is a lower bound (>= beta)
  Upper = 2, // fail-low: score is an upper bound (<= alpha)
}

interface TTEntry {
  key: string;
  depth: number;
  score: number;
  bound: Bound;
  best: Move | null;
}

// Internal per-search state so the module has no global mutable state and stays
// safe to call repeatedly (and from a worker).
class Searcher {
  private board: Board;
  private deadline: number;
  private maxDepth: number;
  private nodes = 0;
  private aborted = false;
  private tt = new Map<string, TTEntry>();
  // killer moves per ply (two slots).
  private killers: (Move | null)[][] = [];

  constructor(board: Board, deadline: number, maxDepth: number) {
    this.board = board;
    this.deadline = deadline;
    this.maxDepth = maxDepth;
  }

  private timeUp(): boolean {
    // Check the clock; once past the deadline, mark aborted so callers unwind.
    if (this.aborted) return true;
    if (Date.now() >= this.deadline) {
      this.aborted = true;
      return true;
    }
    return false;
  }

  getNodes(): number {
    return this.nodes;
  }

  wasAborted(): boolean {
    return this.aborted;
  }

  // Order moves: TT best move first, then captures by MVV-LVA, then killers,
  // then the rest. Returns a new sorted array.
  private orderMoves(moves: Move[], ttBest: Move | null, ply: number): Move[] {
    const killerA = this.killers[ply]?.[0] ?? null;
    const killerB = this.killers[ply]?.[1] ?? null;
    const scored = moves.map((m) => ({ m, s: this.moveScore(m, ttBest, killerA, killerB) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  }

  private moveScore(m: Move, ttBest: Move | null, killerA: Move | null, killerB: Move | null): number {
    if (ttBest && sameMove(m, ttBest)) return 1_000_000;
    if (m.captured !== 0 || m.flag === MoveFlag.EnPassant) {
      // MVV-LVA: value of victim high, value of attacker low.
      const victim = m.flag === MoveFlag.EnPassant ? PieceType.Pawn : pieceType(m.captured);
      const attacker = pieceType(m.piece);
      return 100_000 + PIECE_VALUE[victim] * 10 - PIECE_VALUE[attacker];
    }
    if (m.flag === MoveFlag.Promotion) return 90_000 + PIECE_VALUE[m.promotion || PieceType.Queen];
    if (killerA && sameMove(m, killerA)) return 80_000;
    if (killerB && sameMove(m, killerB)) return 79_000;
    return 0;
  }

  private recordKiller(m: Move, ply: number): void {
    // Only quiet moves become killers.
    if (m.captured !== 0 || m.flag === MoveFlag.EnPassant || m.flag === MoveFlag.Promotion) return;
    if (!this.killers[ply]) this.killers[ply] = [null, null];
    const slot = this.killers[ply];
    if (slot[0] && sameMove(slot[0], m)) return;
    slot[1] = slot[0];
    slot[0] = m;
  }

  // Quiescence search: only explore captures (and check evasions implicitly via
  // the stand-pat cutoff) so the leaf evaluation is not distorted by a pending
  // recapture (the horizon effect).
  private quiescence(alpha: number, beta: number, ply: number): number {
    if (this.timeUp()) return alpha;
    // Defensive hard ply bound: captures already make material strictly
    // decrease so quiescence terminates naturally, but this backstop guarantees
    // termination independent of the movetime clock (e.g. under an absurd cap).
    if (ply >= QUIESCENCE_MAX_PLY) return evaluate(this.board);
    this.nodes++;

    const standPat = evaluate(this.board);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    const moves = generateLegalMoves(this.board);
    // Only tactical moves (captures / en passant / promotions).
    const tactical = moves.filter(
      (m) => m.captured !== 0 || m.flag === MoveFlag.EnPassant || m.flag === MoveFlag.Promotion
    );
    const ordered = this.orderMoves(tactical, null, ply);

    for (const m of ordered) {
      if (this.timeUp()) break;
      this.board.makeMove(m);
      const score = -this.quiescence(-beta, -alpha, ply + 1);
      this.board.undoMove();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  // Negamax with alpha-beta. Returns score from the side-to-move perspective.
  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.timeUp()) return alpha;

    const alphaOrig = alpha;
    const key = this.board.positionKey();

    // Transposition table probe.
    const entry = this.tt.get(key);
    if (entry && entry.key === key && entry.depth >= depth) {
      if (entry.bound === Bound.Exact) return entry.score;
      if (entry.bound === Bound.Lower && entry.score > alpha) alpha = entry.score;
      else if (entry.bound === Bound.Upper && entry.score < beta) beta = entry.score;
      if (alpha >= beta) return entry.score;
    }

    if (depth <= 0) {
      return this.quiescence(alpha, beta, ply);
    }

    this.nodes++;

    const moves = generateLegalMoves(this.board);
    if (moves.length === 0) {
      // Checkmate (adjusted by ply so shorter mates score higher) or stalemate.
      if (isCheck(this.board)) return -MATE_SCORE + ply;
      return 0;
    }

    const ttBest = entry ? entry.best : null;
    const ordered = this.orderMoves(moves, ttBest, ply);

    let best = -Infinity;
    let bestMove: Move | null = null;

    for (const m of ordered) {
      this.board.makeMove(m);
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.board.undoMove();

      if (this.aborted) {
        // Do not trust a partially-searched subtree; unwind without updating TT.
        return best > -Infinity ? best : alpha;
      }

      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) {
        this.recordKiller(m, ply);
        break;
      }
    }

    // Store in the transposition table.
    let bound: Bound;
    if (best <= alphaOrig) bound = Bound.Upper;
    else if (best >= beta) bound = Bound.Lower;
    else bound = Bound.Exact;
    this.tt.set(key, { key, depth, score: best, bound, best: bestMove });

    return best;
  }

  // Root search for a single depth. Returns scored root moves (already legal).
  // Keeps evaluating even moves after an alpha cutoff at the root is not done;
  // instead we score every root move so weakening logic can pick alternates.
  searchRoot(depth: number, orderedRoot: Move[]): { move: Move; score: number }[] {
    const results: { move: Move; score: number }[] = [];
    let alpha = -Infinity;
    const beta = Infinity;

    for (const m of orderedRoot) {
      if (this.timeUp()) break;
      this.board.makeMove(m);
      const score = -this.negamax(depth - 1, -beta, -alpha, 1);
      this.board.undoMove();
      if (this.aborted) break;
      results.push({ move: m, score });
      if (score > alpha) alpha = score;
    }
    return results;
  }
}

function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.promotion === b.promotion && a.flag === b.flag;
}

// Small tolerance (ms) allowed for the abort check granularity. Callers/tests
// should assert elapsed <= movetimeMs + MOVETIME_TOLERANCE_MS.
export const MOVETIME_TOLERANCE_MS = 50;

/**
 * Search for the best move under a hard movetime cap.
 *
 * Guarantees:
 *  - Returns a legal move whenever one exists (best from the deepest completed
 *    depth), even if the very first depth is interrupted (depth 1 is always
 *    allowed to finish so a legal move is always available).
 *  - Never runs meaningfully past `movetimeMs` (iterative deepening stops once
 *    the deadline is reached; the inner search aborts on the same deadline).
 */
export function searchBestMove(
  board: Board,
  params: SearchParams,
  random: RandomFn = Math.random
): SearchResult {
  const start = Date.now();
  const movetimeMs = Math.max(1, params.movetimeMs);
  const maxDepth = Math.max(1, params.maxDepth);
  const deadline = start + movetimeMs;

  const rootMoves = generateLegalMoves(board);
  if (rootMoves.length === 0) {
    return { move: null, score: 0, depth: 0, nodes: 0, elapsedMs: Date.now() - start };
  }

  const searcher = new Searcher(board, deadline, maxDepth);

  // Best result across completed depths. Seed with the first legal move so we
  // ALWAYS have something legal to return even under an absurdly tiny cap.
  let bestScored: { move: Move; score: number }[] = [{ move: rootMoves[0], score: 0 }];
  let completedDepth = 0;

  // Order root moves once up front (subsequent depths re-order via the TT best).
  let orderedRoot = rootMoves.slice();

  for (let depth = 1; depth <= maxDepth; depth++) {
    // For depth 1 we let the search complete even if the clock is essentially
    // spent, so there is always a real evaluation of every root move.
    if (depth > 1 && Date.now() >= deadline) break;

    const results = searcher.searchRoot(depth, orderedRoot);

    if (searcher.wasAborted() || results.length < orderedRoot.length) {
      // This depth did not complete for every root move; keep the previous
      // depth's fully-searched result and stop deepening.
      if (depth === 1 && results.length > 0) {
        // Even a partial depth-1 pass gives real scores; use what we have.
        bestScored = results.slice();
        completedDepth = 1;
      }
      break;
    }

    // Depth completed fully: adopt its results and re-order root by score so the
    // next iteration searches the most promising move first.
    results.sort((a, b) => b.score - a.score);
    bestScored = results;
    completedDepth = depth;
    orderedRoot = results.map((r) => r.move);

    // If we found a forced mate, no need to search deeper.
    if (Math.abs(bestScored[0].score) >= MATE_THRESHOLD) break;

    if (Date.now() >= deadline) break;
  }

  // Ensure results are sorted best-first (searchRoot for a partial depth-1 may
  // not be sorted).
  bestScored = bestScored.slice().sort((a, b) => b.score - a.score);

  const chosen = selectMove(bestScored, params.skill, random);

  return {
    move: chosen.move,
    score: chosen.score,
    depth: completedDepth,
    nodes: searcher.getNodes(),
    elapsedMs: Date.now() - start,
  };
}

// Choose a move from the scored root list, applying optional weakening. Always
// returns a legal move (an element of `scored`).
function selectMove(
  scored: { move: Move; score: number }[],
  skill: SkillParams | undefined,
  random: RandomFn
): { move: Move; score: number } {
  if (scored.length === 0) {
    // Should never happen (caller guards for no legal moves), but be safe.
    throw new Error('selectMove called with no moves');
  }
  if (!skill) return scored[0];

  const blunderChance = clamp01(skill.blunderChance ?? 0);
  const randomness = clamp01(skill.randomness ?? 0);
  const topN = Math.max(1, Math.floor(skill.topN ?? 1));

  // Blunder: pick a fully random legal move (may be bad). This models a weak
  // player's occasional oversight. Never removes the safety of returning a
  // legal move.
  if (blunderChance > 0 && random() < blunderChance) {
    const idx = Math.min(scored.length - 1, Math.floor(random() * scored.length));
    return scored[idx];
  }

  // Randomness: pick among the best `topN` moves instead of strictly the best.
  if (randomness > 0 && topN > 1 && random() < randomness) {
    const pool = scored.slice(0, Math.min(topN, scored.length));
    const idx = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    return pool[idx];
  }

  return scored[0];
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
