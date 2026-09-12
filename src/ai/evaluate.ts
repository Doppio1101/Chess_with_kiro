// evaluate.ts - static position evaluation.
// Pure logic: NO DOM / Worker references so it runs identically under Node tests
// and inside the search Web Worker.
//
// The score is returned from the perspective of the side to move: a positive
// number means the position is good for whoever is on the move. This is what a
// negamax search expects.

import {
  Board,
  Color,
  PieceType,
  EMPTY,
  pieceType,
  pieceColor,
  fileOf,
  rankOf,
  makeSquare,
} from '../engine/board.js';

// Centipawn material values indexed by PieceType (1..6). Index 0 is unused.
export const PIECE_VALUE: number[] = [
  0, // (unused)
  100, // Pawn
  320, // Knight
  330, // Bishop
  500, // Rook
  900, // Queen
  0, // King (kingsafety handled by PST, not material)
];

// A large but finite score used for mate. Kept well below Number limits so that
// mate-distance adjustments (MATE - ply) never overflow or collide with real eval.
export const MATE_SCORE = 1_000_000;
// Threshold above which a score is considered "a forced mate".
export const MATE_THRESHOLD = MATE_SCORE - 1000;

// Piece-square tables (middlegame). Values are in centipawns and are written
// from White's point of view with rank 8 (black's back rank) at the TOP of each
// table, matching how a board is usually drawn. Index into a table with
// pstIndex(square, color): for black we vertically mirror the rank.
//
// These are the well-known "simplified evaluation" tables (Tomasz Michniewski)
// which give a solid, club-strength positional sense without any tuning data.

// prettier-ignore
const PAWN_PST: number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

// prettier-ignore
const KNIGHT_PST: number[] = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

// prettier-ignore
const BISHOP_PST: number[] = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];

// prettier-ignore
const ROOK_PST: number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];

// prettier-ignore
const QUEEN_PST: number[] = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];

// King middlegame table: encourages castling / staying safe behind pawns.
// prettier-ignore
const KING_MG_PST: number[] = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

// King endgame table: the king becomes an active central piece.
// prettier-ignore
const KING_EG_PST: number[] = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];

const PST_BY_TYPE: (number[] | null)[] = [
  null, // (unused)
  PAWN_PST,
  KNIGHT_PST,
  BISHOP_PST,
  ROOK_PST,
  QUEEN_PST,
  null, // King handled separately (tapered between MG and EG).
];

// The PST arrays above are laid out with rank 8 first. A 0x88 square has
// file = sq & 7 and rank = sq >> 4 (rank 0 = white home rank). Convert to a
// 0..63 table index. For white we read rank (7 - rank8index)... simplest is:
// table row 0 == rank 8 == our rank index 7. So for a white piece on rank r
// (0..7), the table row is (7 - r). For black we mirror so the piece reads the
// table as if it were White on the mirrored square: table row is r.
function pstIndex(sq: number, color: Color): number {
  const file = fileOf(sq);
  const rank = rankOf(sq);
  const row = color === 'w' ? 7 - rank : rank;
  return row * 8 + file;
}

// Rough game-phase detection for a tapered king evaluation: if neither side has
// a queen, or total non-pawn material is low, treat it as an endgame.
function isEndgame(
  whiteNonPawnMaterial: number,
  blackNonPawnMaterial: number,
  whiteQueens: number,
  blackQueens: number
): boolean {
  if (whiteQueens === 0 && blackQueens === 0) return true;
  // Endgame if each side has at most a queen + one minor worth of material.
  return whiteNonPawnMaterial <= 1300 && blackNonPawnMaterial <= 1300;
}

// Evaluate the position from White's perspective (positive = good for White),
// then the public evaluate() flips it for the side to move.
function evaluateWhitePov(board: Board): number {
  const sqs = board.squares;

  let material = 0; // white minus black material
  let positional = 0; // white minus black PST (non-king)

  let whiteNonPawn = 0;
  let blackNonPawn = 0;
  let whiteQueens = 0;
  let blackQueens = 0;

  let whiteKingSq = -1;
  let blackKingSq = -1;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = makeSquare(file, rank);
      const piece = sqs[sq];
      if (piece === EMPTY) continue;
      const type = pieceType(piece);
      const color = pieceColor(piece);
      const value = PIECE_VALUE[type];

      if (type === PieceType.King) {
        if (color === 'w') whiteKingSq = sq;
        else blackKingSq = sq;
        continue;
      }

      const pst = PST_BY_TYPE[type];
      const posVal = pst ? pst[pstIndex(sq, color)] : 0;

      if (color === 'w') {
        material += value;
        positional += posVal;
        if (type !== PieceType.Pawn) whiteNonPawn += value;
        if (type === PieceType.Queen) whiteQueens++;
      } else {
        material -= value;
        positional -= posVal;
        if (type !== PieceType.Pawn) blackNonPawn += value;
        if (type === PieceType.Queen) blackQueens++;
      }
    }
  }

  // King PST, tapered between middlegame and endgame tables.
  const endgame = isEndgame(whiteNonPawn, blackNonPawn, whiteQueens, blackQueens);
  const kingTable = endgame ? KING_EG_PST : KING_MG_PST;
  if (whiteKingSq >= 0) positional += kingTable[pstIndex(whiteKingSq, 'w')];
  if (blackKingSq >= 0) positional -= kingTable[pstIndex(blackKingSq, 'b')];

  return material + positional;
}

// Public evaluation: score relative to the side to move.
export function evaluate(board: Board): number {
  const whitePov = evaluateWhitePov(board);
  return board.turn === 'w' ? whitePov : -whitePov;
}
