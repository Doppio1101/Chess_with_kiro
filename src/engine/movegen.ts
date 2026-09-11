// movegen.ts - legal move generation and attack detection.
// Pure logic: no DOM / Worker references.

import {
  Board,
  Color,
  Move,
  MoveFlag,
  PieceType,
  EMPTY,
  makePiece,
  pieceType,
  pieceColor,
  onBoard,
  rankOf,
  fileOf,
  makeSquare,
  CASTLE_WK,
  CASTLE_WQ,
  CASTLE_BK,
  CASTLE_BQ,
} from './board.js';

// 0x88 offsets.
const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const BISHOP_OFFSETS = [17, 15, -17, -15];
const ROOK_OFFSETS = [16, -16, 1, -1];
const KING_OFFSETS = [17, 16, 15, 1, -1, -17, -16, -15];

function opposite(c: Color): Color {
  return c === 'w' ? 'b' : 'w';
}

// Is `sq` attacked by side `by`?
export function isSquareAttacked(board: Board, sq: number, by: Color): boolean {
  const sqs = board.squares;

  // Pawn attacks: a pawn of color `by` attacks `sq` if it sits on the diagonal
  // one step "behind" from that pawn's advance direction.
  // White pawns attack up (+15/+17). So a white pawn attacking sq is at sq-15 / sq-17.
  if (by === 'w') {
    for (const off of [-17, -15]) {
      const from = sq + off;
      if (onBoard(from)) {
        const p = sqs[from];
        if (p !== EMPTY && pieceColor(p) === 'w' && pieceType(p) === PieceType.Pawn) return true;
      }
    }
  } else {
    for (const off of [17, 15]) {
      const from = sq + off;
      if (onBoard(from)) {
        const p = sqs[from];
        if (p !== EMPTY && pieceColor(p) === 'b' && pieceType(p) === PieceType.Pawn) return true;
      }
    }
  }

  // Knight attacks.
  for (const off of KNIGHT_OFFSETS) {
    const from = sq + off;
    if (onBoard(from)) {
      const p = sqs[from];
      if (p !== EMPTY && pieceColor(p) === by && pieceType(p) === PieceType.Knight) return true;
    }
  }

  // King attacks.
  for (const off of KING_OFFSETS) {
    const from = sq + off;
    if (onBoard(from)) {
      const p = sqs[from];
      if (p !== EMPTY && pieceColor(p) === by && pieceType(p) === PieceType.King) return true;
    }
  }

  // Sliding: bishop/queen along diagonals.
  for (const off of BISHOP_OFFSETS) {
    let cur = sq + off;
    while (onBoard(cur)) {
      const p = sqs[cur];
      if (p !== EMPTY) {
        if (pieceColor(p) === by) {
          const t = pieceType(p);
          if (t === PieceType.Bishop || t === PieceType.Queen) return true;
        }
        break;
      }
      cur += off;
    }
  }

  // Sliding: rook/queen along ranks/files.
  for (const off of ROOK_OFFSETS) {
    let cur = sq + off;
    while (onBoard(cur)) {
      const p = sqs[cur];
      if (p !== EMPTY) {
        if (pieceColor(p) === by) {
          const t = pieceType(p);
          if (t === PieceType.Rook || t === PieceType.Queen) return true;
        }
        break;
      }
      cur += off;
    }
  }

  return false;
}

export function isKingInCheck(board: Board, color: Color): boolean {
  const ks = board.kingSquare[color];
  if (ks < 0) return false;
  return isSquareAttacked(board, ks, opposite(color));
}

function addMove(
  list: Move[],
  from: number,
  to: number,
  piece: number,
  captured: number,
  flag: MoveFlag,
  promotion: PieceType | 0
): void {
  list.push({ from, to, piece, captured, promotion, flag });
}

// Generate pseudo-legal moves (may leave own king in check).
export function generatePseudoLegalMoves(board: Board): Move[] {
  const moves: Move[] = [];
  const sqs = board.squares;
  const us = board.turn;
  const them = opposite(us);

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const from = makeSquare(file, rank);
      const piece = sqs[from];
      if (piece === EMPTY || pieceColor(piece) !== us) continue;
      const type = pieceType(piece);

      switch (type) {
        case PieceType.Pawn:
          genPawnMoves(board, from, piece, us, moves);
          break;
        case PieceType.Knight:
          genStepMoves(board, from, piece, us, KNIGHT_OFFSETS, moves);
          break;
        case PieceType.King:
          genStepMoves(board, from, piece, us, KING_OFFSETS, moves);
          genCastling(board, from, piece, us, them, moves);
          break;
        case PieceType.Bishop:
          genSlideMoves(board, from, piece, us, BISHOP_OFFSETS, moves);
          break;
        case PieceType.Rook:
          genSlideMoves(board, from, piece, us, ROOK_OFFSETS, moves);
          break;
        case PieceType.Queen:
          genSlideMoves(board, from, piece, us, BISHOP_OFFSETS, moves);
          genSlideMoves(board, from, piece, us, ROOK_OFFSETS, moves);
          break;
      }
    }
  }

  return moves;
}

function genStepMoves(
  board: Board,
  from: number,
  piece: number,
  us: Color,
  offsets: number[],
  moves: Move[]
): void {
  const sqs = board.squares;
  for (const off of offsets) {
    const to = from + off;
    if (!onBoard(to)) continue;
    const target = sqs[to];
    if (target === EMPTY) {
      addMove(moves, from, to, piece, EMPTY, MoveFlag.Normal, 0);
    } else if (pieceColor(target) !== us) {
      addMove(moves, from, to, piece, target, MoveFlag.Normal, 0);
    }
  }
}

function genSlideMoves(
  board: Board,
  from: number,
  piece: number,
  us: Color,
  offsets: number[],
  moves: Move[]
): void {
  const sqs = board.squares;
  for (const off of offsets) {
    let to = from + off;
    while (onBoard(to)) {
      const target = sqs[to];
      if (target === EMPTY) {
        addMove(moves, from, to, piece, EMPTY, MoveFlag.Normal, 0);
      } else {
        if (pieceColor(target) !== us) {
          addMove(moves, from, to, piece, target, MoveFlag.Normal, 0);
        }
        break;
      }
      to += off;
    }
  }
}

const PROMO_TYPES: PieceType[] = [PieceType.Queen, PieceType.Rook, PieceType.Bishop, PieceType.Knight];

function genPawnMoves(board: Board, from: number, piece: number, us: Color, moves: Move[]): void {
  const sqs = board.squares;
  const forward = us === 'w' ? 16 : -16;
  const startRank = us === 'w' ? 1 : 6;
  const promoRank = us === 'w' ? 7 : 0;
  const captureOffsets = us === 'w' ? [15, 17] : [-15, -17];

  // Single push.
  const one = from + forward;
  if (onBoard(one) && sqs[one] === EMPTY) {
    if (rankOf(one) === promoRank) {
      for (const pt of PROMO_TYPES) {
        addMove(moves, from, one, piece, EMPTY, MoveFlag.Promotion, pt);
      }
    } else {
      addMove(moves, from, one, piece, EMPTY, MoveFlag.Normal, 0);
      // Double push.
      if (rankOf(from) === startRank) {
        const two = from + forward * 2;
        if (onBoard(two) && sqs[two] === EMPTY) {
          addMove(moves, from, two, piece, EMPTY, MoveFlag.DoublePush, 0);
        }
      }
    }
  }

  // Captures + en passant.
  for (const off of captureOffsets) {
    const to = from + off;
    if (!onBoard(to)) continue;
    const target = sqs[to];
    if (target !== EMPTY && pieceColor(target) !== us) {
      if (rankOf(to) === promoRank) {
        for (const pt of PROMO_TYPES) {
          addMove(moves, from, to, piece, target, MoveFlag.Promotion, pt);
        }
      } else {
        addMove(moves, from, to, piece, target, MoveFlag.Normal, 0);
      }
    } else if (target === EMPTY && to === board.epSquare) {
      // En passant: captured pawn is behind target.
      const capSq = us === 'w' ? to - 16 : to + 16;
      const capPiece = sqs[capSq];
      addMove(moves, from, to, piece, capPiece, MoveFlag.EnPassant, 0);
    }
  }
}

function genCastling(
  board: Board,
  from: number,
  piece: number,
  us: Color,
  them: Color,
  moves: Move[]
): void {
  const sqs = board.squares;
  const rank = us === 'w' ? 0 : 7;
  // King must be on its home square (e-file).
  if (from !== makeSquare(4, rank)) return;
  // King must not currently be in check.
  if (isSquareAttacked(board, from, them)) return;

  const kingSide = us === 'w' ? CASTLE_WK : CASTLE_BK;
  const queenSide = us === 'w' ? CASTLE_WQ : CASTLE_BQ;

  // King side: squares f,g empty; king not passing through/into attack; rook present.
  if (board.castling & kingSide) {
    const f = makeSquare(5, rank);
    const g = makeSquare(6, rank);
    const rookSq = makeSquare(7, rank);
    if (
      sqs[f] === EMPTY &&
      sqs[g] === EMPTY &&
      sqs[rookSq] !== EMPTY &&
      pieceType(sqs[rookSq]) === PieceType.Rook &&
      pieceColor(sqs[rookSq]) === us &&
      !isSquareAttacked(board, f, them) &&
      !isSquareAttacked(board, g, them)
    ) {
      addMove(moves, from, g, piece, EMPTY, MoveFlag.Castle, 0);
    }
  }

  // Queen side: squares b,c,d empty; king not passing through/into attack; rook present.
  if (board.castling & queenSide) {
    const b = makeSquare(1, rank);
    const c = makeSquare(2, rank);
    const d = makeSquare(3, rank);
    const rookSq = makeSquare(0, rank);
    if (
      sqs[b] === EMPTY &&
      sqs[c] === EMPTY &&
      sqs[d] === EMPTY &&
      sqs[rookSq] !== EMPTY &&
      pieceType(sqs[rookSq]) === PieceType.Rook &&
      pieceColor(sqs[rookSq]) === us &&
      !isSquareAttacked(board, d, them) &&
      !isSquareAttacked(board, c, them)
    ) {
      addMove(moves, from, c, piece, EMPTY, MoveFlag.Castle, 0);
    }
  }
}

// Generate fully-legal moves by filtering pseudo-legal ones that leave own king in check.
export function generateLegalMoves(board: Board): Move[] {
  const us = board.turn;
  const pseudo = generatePseudoLegalMoves(board);
  const legal: Move[] = [];
  for (const move of pseudo) {
    board.makeMove(move);
    // After makeMove, turn has switched; check whether OUR king (us) is attacked.
    if (!isKingInCheck(board, us)) {
      legal.push(move);
    }
    board.undoMove();
  }
  return legal;
}

export { opposite };

// Perft: count leaf nodes at given depth. Used for move-generator correctness tests.
export function perft(board: Board, depth: number): number {
  if (depth === 0) return 1;
  const moves = generateLegalMoves(board);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    board.makeMove(move);
    nodes += perft(board, depth - 1);
    board.undoMove();
  }
  return nodes;
}
