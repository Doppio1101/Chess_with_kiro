// board.ts - 0x88 board representation, FEN parse/export, make/undo move.
// Pure logic: no DOM / Worker references.

export type Color = 'w' | 'b';

// Piece types.
export const enum PieceType {
  Pawn = 1,
  Knight = 2,
  Bishop = 3,
  Rook = 4,
  Queen = 5,
  King = 6,
}

// A piece is encoded as { type, color }. On the board we store either null (empty)
// or a small integer encoding. We use an integer encoding for speed:
//   piece = (color === 'w' ? 8 : 16) | type
// so white pieces are 9..14, black pieces are 17..22, empty is 0.
export const WHITE_FLAG = 8;
export const BLACK_FLAG = 16;

export function makePiece(color: Color, type: PieceType): number {
  return (color === 'w' ? WHITE_FLAG : BLACK_FLAG) | type;
}
export function pieceType(piece: number): PieceType {
  return (piece & 7) as PieceType;
}
export function pieceColor(piece: number): Color {
  return (piece & WHITE_FLAG) !== 0 ? 'w' : 'b';
}
export function isWhite(piece: number): boolean {
  return (piece & WHITE_FLAG) !== 0;
}
export function isBlack(piece: number): boolean {
  return (piece & BLACK_FLAG) !== 0;
}

// 0x88 board: 128 squares, valid ones satisfy (sq & 0x88) === 0.
// File = sq & 7, Rank = sq >> 4. Rank 0 = rank 1 (white home), Rank 7 = rank 8.
export const EMPTY = 0;

export function fileOf(sq: number): number {
  return sq & 7;
}
export function rankOf(sq: number): number {
  return sq >> 4;
}
export function onBoard(sq: number): boolean {
  return (sq & 0x88) === 0;
}
export function makeSquare(file: number, rank: number): number {
  return rank * 16 + file;
}

// Convert algebraic (e.g. "e4") to 0x88 square and back.
export function algebraicToSquare(s: string): number {
  const file = s.charCodeAt(0) - 97; // 'a'
  const rank = s.charCodeAt(1) - 49; // '1'
  return makeSquare(file, rank);
}
export function squareToAlgebraic(sq: number): string {
  return String.fromCharCode(97 + fileOf(sq)) + String.fromCharCode(49 + rankOf(sq));
}

// Castling rights bit flags.
export const CASTLE_WK = 1; // white king-side
export const CASTLE_WQ = 2; // white queen-side
export const CASTLE_BK = 4; // black king-side
export const CASTLE_BQ = 8; // black queen-side

// Move flags.
export const enum MoveFlag {
  Normal = 0,
  DoublePush = 1,
  EnPassant = 2,
  Castle = 3,
  Promotion = 4,
}

export interface Move {
  from: number;
  to: number;
  piece: number; // moving piece encoding
  captured: number; // captured piece encoding (0 if none). For EP this is the pawn captured.
  promotion: PieceType | 0; // 0 if not a promotion
  flag: MoveFlag;
}

// State needed to undo a move.
interface UndoState {
  move: Move;
  castling: number;
  epSquare: number; // -1 if none, else 0x88 square
  halfmove: number;
  capturedSquare: number; // square where a capture removed a piece (differs for EP)
  hashKey: string;
}

export class Board {
  // 128-entry board array (0x88).
  squares: Int8Array;
  turn: Color;
  castling: number;
  epSquare: number; // -1 or 0x88 square
  halfmove: number;
  fullmove: number;
  kingSquare: { w: number; b: number };

  private history: UndoState[] = [];

  constructor() {
    this.squares = new Int8Array(128);
    this.turn = 'w';
    this.castling = 0;
    this.epSquare = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSquare = { w: -1, b: -1 };
  }

  static fromFEN(fen: string): Board {
    const b = new Board();
    b.loadFEN(fen);
    return b;
  }

  static start(): Board {
    return Board.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  loadFEN(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    const placement = parts[0];
    const turn = parts[1] ?? 'w';
    const castle = parts[2] ?? '-';
    const ep = parts[3] ?? '-';
    const half = parts[4] ?? '0';
    const full = parts[5] ?? '1';

    this.squares = new Int8Array(128);
    this.kingSquare = { w: -1, b: -1 };

    let rank = 7;
    let file = 0;
    for (const c of placement) {
      if (c === '/') {
        rank--;
        file = 0;
      } else if (c >= '1' && c <= '8') {
        file += c.charCodeAt(0) - 48;
      } else {
        const color: Color = c === c.toUpperCase() ? 'w' : 'b';
        const lower = c.toLowerCase();
        let type: PieceType;
        switch (lower) {
          case 'p': type = PieceType.Pawn; break;
          case 'n': type = PieceType.Knight; break;
          case 'b': type = PieceType.Bishop; break;
          case 'r': type = PieceType.Rook; break;
          case 'q': type = PieceType.Queen; break;
          case 'k': type = PieceType.King; break;
          default: throw new Error(`Invalid FEN piece: ${c}`);
        }
        const sq = makeSquare(file, rank);
        const piece = makePiece(color, type);
        this.squares[sq] = piece;
        if (type === PieceType.King) this.kingSquare[color] = sq;
        file++;
      }
    }

    this.turn = turn === 'b' ? 'b' : 'w';

    this.castling = 0;
    if (castle.includes('K')) this.castling |= CASTLE_WK;
    if (castle.includes('Q')) this.castling |= CASTLE_WQ;
    if (castle.includes('k')) this.castling |= CASTLE_BK;
    if (castle.includes('q')) this.castling |= CASTLE_BQ;

    this.epSquare = ep === '-' ? -1 : algebraicToSquare(ep);
    this.halfmove = parseInt(half, 10) || 0;
    this.fullmove = parseInt(full, 10) || 1;
    this.history = [];
  }

  toFEN(): string {
    let placement = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const sq = makeSquare(file, rank);
        const piece = this.squares[sq];
        if (piece === EMPTY) {
          empty++;
        } else {
          if (empty > 0) {
            placement += empty;
            empty = 0;
          }
          const type = pieceType(piece);
          let ch: string;
          switch (type) {
            case PieceType.Pawn: ch = 'p'; break;
            case PieceType.Knight: ch = 'n'; break;
            case PieceType.Bishop: ch = 'b'; break;
            case PieceType.Rook: ch = 'r'; break;
            case PieceType.Queen: ch = 'q'; break;
            case PieceType.King: ch = 'k'; break;
            default: ch = '?'; break;
          }
          placement += isWhite(piece) ? ch.toUpperCase() : ch;
        }
      }
      if (empty > 0) placement += empty;
      if (rank > 0) placement += '/';
    }

    let castle = '';
    if (this.castling & CASTLE_WK) castle += 'K';
    if (this.castling & CASTLE_WQ) castle += 'Q';
    if (this.castling & CASTLE_BK) castle += 'k';
    if (this.castling & CASTLE_BQ) castle += 'q';
    if (castle === '') castle = '-';

    const ep = this.epSquare === -1 ? '-' : squareToAlgebraic(this.epSquare);

    return `${placement} ${this.turn} ${castle} ${ep} ${this.halfmove} ${this.fullmove}`;
  }

  // Whether an en-passant capture is actually available for the side to move.
  //
  // FIDE treats two positions as identical (for threefold repetition) only when
  // the *possibility* of en passant is the same. `epSquare` is set on every
  // double push, but a capture is only possible when the side to move has a pawn
  // positioned to capture onto that square. When there is no such pawn the ep
  // square is a "phantom" that must NOT distinguish positions.
  epCaptureAvailable(): boolean {
    if (this.epSquare === -1) return false;
    // The capturing pawns belong to the side to move and sit on the two squares
    // diagonally "behind" the ep target (relative to their advance direction).
    // White captures upward, so a white capturer is one rank below the ep square;
    // black captures downward, so a black capturer is one rank above it.
    const capturer = makePiece(this.turn, PieceType.Pawn);
    const back = this.turn === 'w' ? -16 : 16;
    for (const side of [-1, 1]) {
      const from = this.epSquare + back + side;
      if (onBoard(from) && this.squares[from] === capturer) return true;
    }
    return false;
  }

  // A compact position key for repetition detection: placement + turn + castling + ep.
  // The ep square is only encoded when an en-passant capture is actually
  // available; otherwise a phantom ep square would wrongly distinguish
  // otherwise-identical positions and cause valid threefold draws to be missed.
  positionKey(): string {
    let key = '';
    for (let rank = 7; rank >= 0; rank--) {
      for (let file = 0; file < 8; file++) {
        key += this.squares[makeSquare(file, rank)].toString(36);
        key += ',';
      }
    }
    const epKey = this.epCaptureAvailable() ? this.epSquare : -1;
    key += this.turn + '|' + this.castling + '|' + epKey;
    return key;
  }

  private updateCastlingRights(move: Move): void {
    // If a king moves, drop both its rights.
    const from = move.from;
    const to = move.to;
    const ptype = pieceType(move.piece);
    const color = pieceColor(move.piece);

    if (ptype === PieceType.King) {
      if (color === 'w') this.castling &= ~(CASTLE_WK | CASTLE_WQ);
      else this.castling &= ~(CASTLE_BK | CASTLE_BQ);
    }

    // Rook moves from its home square drop that side.
    const A1 = makeSquare(0, 0), H1 = makeSquare(7, 0);
    const A8 = makeSquare(0, 7), H8 = makeSquare(7, 7);
    if (from === H1 || to === H1) this.castling &= ~CASTLE_WK;
    if (from === A1 || to === A1) this.castling &= ~CASTLE_WQ;
    if (from === H8 || to === H8) this.castling &= ~CASTLE_BK;
    if (from === A8 || to === A8) this.castling &= ~CASTLE_BQ;
  }

  makeMove(move: Move): void {
    const undo: UndoState = {
      move,
      castling: this.castling,
      epSquare: this.epSquare,
      halfmove: this.halfmove,
      capturedSquare: -1,
      hashKey: '',
    };

    const color = pieceColor(move.piece);
    const from = move.from;
    const to = move.to;

    // Reset EP square; set later if double push.
    this.epSquare = -1;

    // Halfmove clock: reset on pawn move or capture.
    const isPawn = pieceType(move.piece) === PieceType.Pawn;
    const isCapture = move.captured !== EMPTY || move.flag === MoveFlag.EnPassant;
    if (isPawn || isCapture) this.halfmove = 0;
    else this.halfmove++;

    // Move the piece.
    this.squares[from] = EMPTY;

    if (move.flag === MoveFlag.EnPassant) {
      // Captured pawn is behind the target square.
      const capSq = color === 'w' ? to - 16 : to + 16;
      undo.capturedSquare = capSq;
      this.squares[capSq] = EMPTY;
      this.squares[to] = move.piece;
    } else if (move.flag === MoveFlag.Promotion) {
      undo.capturedSquare = move.captured !== EMPTY ? to : -1;
      this.squares[to] = makePiece(color, move.promotion || PieceType.Queen);
    } else if (move.flag === MoveFlag.Castle) {
      this.squares[to] = move.piece;
      // Move the rook.
      const rank = rankOf(from);
      if (fileOf(to) === 6) {
        // king side
        const rookFrom = makeSquare(7, rank);
        const rookTo = makeSquare(5, rank);
        this.squares[rookTo] = this.squares[rookFrom];
        this.squares[rookFrom] = EMPTY;
      } else {
        // queen side
        const rookFrom = makeSquare(0, rank);
        const rookTo = makeSquare(3, rank);
        this.squares[rookTo] = this.squares[rookFrom];
        this.squares[rookFrom] = EMPTY;
      }
    } else {
      undo.capturedSquare = move.captured !== EMPTY ? to : -1;
      this.squares[to] = move.piece;
    }

    // Track king position.
    if (pieceType(move.piece) === PieceType.King) {
      this.kingSquare[color] = to;
    }

    // Double push sets EP square.
    if (move.flag === MoveFlag.DoublePush) {
      this.epSquare = color === 'w' ? from + 16 : from - 16;
    }

    this.updateCastlingRights(move);

    if (this.turn === 'b') this.fullmove++;
    this.turn = this.turn === 'w' ? 'b' : 'w';

    this.history.push(undo);
  }

  undoMove(): void {
    const undo = this.history.pop();
    if (!undo) return;
    const move = undo.move;
    const color = pieceColor(move.piece);
    const from = move.from;
    const to = move.to;

    // Restore side to move first.
    this.turn = color;
    if (color === 'b') this.fullmove--;

    this.castling = undo.castling;
    this.epSquare = undo.epSquare;
    this.halfmove = undo.halfmove;

    // Restore the moving piece to its origin.
    this.squares[from] = move.piece;

    if (move.flag === MoveFlag.EnPassant) {
      this.squares[to] = EMPTY;
      const capSq = color === 'w' ? to - 16 : to + 16;
      this.squares[capSq] = move.captured; // restore captured pawn
    } else if (move.flag === MoveFlag.Castle) {
      this.squares[to] = EMPTY;
      const rank = rankOf(from);
      if (fileOf(to) === 6) {
        const rookFrom = makeSquare(7, rank);
        const rookTo = makeSquare(5, rank);
        this.squares[rookFrom] = this.squares[rookTo];
        this.squares[rookTo] = EMPTY;
      } else {
        const rookFrom = makeSquare(0, rank);
        const rookTo = makeSquare(3, rank);
        this.squares[rookFrom] = this.squares[rookTo];
        this.squares[rookTo] = EMPTY;
      }
    } else {
      // Normal / double push / promotion: restore captured piece (or empty) at 'to'.
      this.squares[to] = move.captured;
    }

    if (pieceType(move.piece) === PieceType.King) {
      this.kingSquare[color] = from;
    }
  }

  pieceAt(sq: number): number {
    return this.squares[sq];
  }
}
