// rules.ts - game status / draw detection.
// Pure logic: no DOM / Worker references.

import {
  Board,
  Color,
  PieceType,
  EMPTY,
  pieceType,
  pieceColor,
  isWhite,
  fileOf,
  rankOf,
  makeSquare,
} from './board.js';
import { generateLegalMoves, isKingInCheck } from './movegen.js';

export type GameStatus = 'ongoing' | 'checkmate' | 'stalemate' | 'draw';

export interface GameResult {
  status: GameStatus;
  // For checkmate, the winner is the side that delivered mate.
  winner?: Color;
  // For draws, a human-readable reason.
  reason?: string;
}

export function isCheck(board: Board): boolean {
  return isKingInCheck(board, board.turn);
}

export function isCheckmate(board: Board): boolean {
  if (!isKingInCheck(board, board.turn)) return false;
  return generateLegalMoves(board).length === 0;
}

export function isStalemate(board: Board): boolean {
  if (isKingInCheck(board, board.turn)) return false;
  return generateLegalMoves(board).length === 0;
}

// Insufficient material: K vs K, K+minor vs K, K+B vs K+B with bishops on same color.
export function isInsufficientMaterial(board: Board): boolean {
  const pieces: { type: PieceType; color: Color; square: number }[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = makeSquare(file, rank);
      const p = board.squares[sq];
      if (p === EMPTY) continue;
      pieces.push({ type: pieceType(p), color: pieceColor(p), square: sq });
    }
  }

  // Any pawn, rook or queen => sufficient material.
  for (const p of pieces) {
    if (p.type === PieceType.Pawn || p.type === PieceType.Rook || p.type === PieceType.Queen) {
      return false;
    }
  }

  const nonKings = pieces.filter((p) => p.type !== PieceType.King);

  // K vs K.
  if (nonKings.length === 0) return true;

  // K + single minor (bishop or knight) vs K.
  if (nonKings.length === 1) {
    const t = nonKings[0].type;
    return t === PieceType.Bishop || t === PieceType.Knight;
  }

  // K+B vs K+B with both bishops on the same color square.
  if (nonKings.length === 2) {
    if (nonKings[0].type === PieceType.Bishop && nonKings[1].type === PieceType.Bishop) {
      // Different colors owning the bishops (one each) or same side both bishops:
      // draw only when all bishops sit on same-colored squares.
      const colorOf = (sq: number) => (fileOf(sq) + rankOf(sq)) & 1;
      return colorOf(nonKings[0].square) === colorOf(nonKings[1].square);
    }
  }

  return false;
}

// Threefold repetition: caller supplies the history of position keys (including current).
export function isThreefoldRepetition(positionKeys: string[]): boolean {
  const counts = new Map<string, number>();
  for (const key of positionKeys) {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (n >= 3) return true;
  }
  return false;
}

export function isFiftyMoveRule(board: Board): boolean {
  return board.halfmove >= 100;
}

// Determine full game status. positionKeys is optional; if provided, threefold is checked.
export function getGameResult(board: Board, positionKeys?: string[]): GameResult {
  const legal = generateLegalMoves(board);
  const inCheck = isKingInCheck(board, board.turn);

  if (legal.length === 0) {
    if (inCheck) {
      // The side to move is mated; the opponent wins.
      return { status: 'checkmate', winner: board.turn === 'w' ? 'b' : 'w' };
    }
    return { status: 'stalemate', reason: 'stalemate' };
  }

  if (isInsufficientMaterial(board)) {
    return { status: 'draw', reason: 'insufficient material' };
  }
  if (isFiftyMoveRule(board)) {
    return { status: 'draw', reason: 'fifty-move rule' };
  }
  if (positionKeys && isThreefoldRepetition(positionKeys)) {
    return { status: 'draw', reason: 'threefold repetition' };
  }

  return { status: 'ongoing' };
}

// Suppress unused import warning for isWhite (kept for API completeness).
void isWhite;
