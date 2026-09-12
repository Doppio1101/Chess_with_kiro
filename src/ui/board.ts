// board.ts - the interactive chessboard view.
//
// Renders an 8x8 board from an engine Board, draws pieces with Unicode chess
// glyphs (so NO image assets are downloaded - works fully offline), highlights
// the selected square and its legal target squares, and turns click/tap into a
// select-then-move interaction with a promotion picker. The view is a thin DOM
// layer over the pure engine: it never mutates the Board itself; instead it
// reports the chosen move to a callback and lets the controller apply it.

import {
  Board,
  Color,
  Move,
  MoveFlag,
  PieceType,
  EMPTY,
  pieceType,
  pieceColor,
  makeSquare,
  squareToAlgebraic,
} from '../engine/board.js';
import { generateLegalMoves, isKingInCheck } from '../engine/movegen.js';

// Unicode glyphs for each piece, keyed by color + type. Rendered as text so no
// network/image assets are required.
const GLYPHS: Record<Color, Record<PieceType, string>> = {
  w: {
    [PieceType.Pawn]: '\u2659',
    [PieceType.Knight]: '\u2658',
    [PieceType.Bishop]: '\u2657',
    [PieceType.Rook]: '\u2656',
    [PieceType.Queen]: '\u2655',
    [PieceType.King]: '\u2654',
  },
  b: {
    [PieceType.Pawn]: '\u265F',
    [PieceType.Knight]: '\u265E',
    [PieceType.Bishop]: '\u265D',
    [PieceType.Rook]: '\u265C',
    [PieceType.Queen]: '\u265B',
    [PieceType.King]: '\u265A',
  },
};

// Human-readable names for promotion pieces (const enum has no reverse map).
const PROMO_NAMES: Partial<Record<PieceType, string>> = {
  [PieceType.Queen]: 'Queen',
  [PieceType.Rook]: 'Rook',
  [PieceType.Bishop]: 'Bishop',
  [PieceType.Knight]: 'Knight',
};

// A move the human has committed to (after resolving any promotion choice).
export type MoveHandler = (move: Move) => void;

export class BoardView {
  private readonly root: HTMLElement;
  private readonly squares = new Map<number, HTMLElement>();
  private board: Board | null = null;

  // The perspective the board is drawn from. 'w' = white at the bottom.
  private orientation: Color = 'w';

  // The side the human controls; only that side's pieces are interactive.
  private humanColor: Color = 'w';

  // Whether input is currently accepted (disabled while the AI is thinking or
  // the game is over).
  private interactive = true;

  // Currently selected origin square (0x88) or -1 if none.
  private selected = -1;

  // Legal moves from the selected square, indexed by destination square.
  private targets = new Map<number, Move[]>();

  private onMove: MoveHandler = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildGrid();
  }

  // Register the callback invoked when the human commits a legal move.
  setMoveHandler(handler: MoveHandler): void {
    this.onMove = handler;
  }

  setOrientation(color: Color): void {
    this.orientation = color;
    this.rebuildGrid();
    if (this.board) this.render(this.board);
  }

  setHumanColor(color: Color): void {
    this.humanColor = color;
  }

  setInteractive(value: boolean): void {
    this.interactive = value;
    if (!value) this.clearSelection();
  }

  // Build the 64 square cells once. Order depends on orientation.
  private buildGrid(): void {
    this.root.innerHTML = '';
    this.root.classList.add('board');
    this.squares.clear();

    const ranks = this.orientation === 'w' ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const files = this.orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

    for (const rank of ranks) {
      for (const file of files) {
        const sq = makeSquare(file, rank);
        const cell = document.createElement('div');
        const light = (file + rank) % 2 === 1;
        cell.className = `square ${light ? 'light' : 'dark'}`;
        cell.setAttribute('data-square', squareToAlgebraic(sq));
        cell.setAttribute('role', 'button');
        cell.addEventListener('click', () => this.onSquareClick(sq));
        this.root.appendChild(cell);
        this.squares.set(sq, cell);
      }
    }
  }

  private rebuildGrid(): void {
    this.buildGrid();
  }

  // Redraw all pieces and highlights from the given board state.
  render(board: Board): void {
    this.board = board;
    for (const [sq, cell] of this.squares) {
      const piece = board.squares[sq];
      cell.classList.remove('selected', 'target', 'target-capture', 'check');
      if (piece === EMPTY) {
        cell.textContent = '';
        cell.removeAttribute('data-piece');
      } else {
        const color = pieceColor(piece);
        const type = pieceType(piece);
        cell.textContent = GLYPHS[color][type];
        cell.setAttribute('data-piece', color === 'w' ? 'white' : 'black');
      }
    }

    // Highlight the king in check.
    if (this.isSideInCheck(board)) {
      const ks = board.kingSquare[board.turn];
      const cell = this.squares.get(ks);
      if (cell) cell.classList.add('check');
    }

    this.applySelectionHighlights();
  }

  private isSideInCheck(board: Board): boolean {
    // Highlight the king of the side to move whenever it is under attack.
    return isKingInCheck(board, board.turn);
  }

  private onSquareClick(sq: number): void {
    if (!this.interactive || !this.board) return;
    if (this.board.turn !== this.humanColor) return;

    const board = this.board;

    // If a piece is already selected and this square is a legal target, move.
    if (this.selected >= 0 && this.targets.has(sq)) {
      const moves = this.targets.get(sq)!;
      if (moves.length === 1) {
        this.commitMove(moves[0]);
      } else {
        // Multiple moves to the same square => promotion choice.
        this.showPromotionPicker(moves);
      }
      return;
    }

    // Otherwise (re)select if this square holds one of the human's pieces.
    const piece = board.squares[sq];
    if (piece !== EMPTY && pieceColor(piece) === this.humanColor) {
      this.select(sq);
    } else {
      this.clearSelection();
    }
  }

  private select(sq: number): void {
    if (!this.board) return;
    this.selected = sq;
    this.targets.clear();
    const legal = generateLegalMoves(this.board);
    for (const m of legal) {
      if (m.from !== sq) continue;
      const list = this.targets.get(m.to) ?? [];
      list.push(m);
      this.targets.set(m.to, list);
    }
    if (this.board) this.render(this.board);
  }

  private clearSelection(): void {
    this.selected = -1;
    this.targets.clear();
    if (this.board) this.applySelectionHighlights();
  }

  private applySelectionHighlights(): void {
    for (const [sq, cell] of this.squares) {
      cell.classList.remove('selected', 'target', 'target-capture');
      if (sq === this.selected) cell.classList.add('selected');
    }
    for (const [to] of this.targets) {
      const cell = this.squares.get(to);
      if (!cell) continue;
      const occupied = this.board && this.board.squares[to] !== EMPTY;
      cell.classList.add(occupied ? 'target-capture' : 'target');
    }
  }

  private commitMove(move: Move): void {
    this.clearSelection();
    this.onMove(move);
  }

  // Render an inline promotion picker over the board and resolve the chosen
  // piece type. Uses the same Unicode glyphs, no assets.
  private showPromotionPicker(moves: Move[]): void {
    const existing = this.root.parentElement?.querySelector('.promotion-picker');
    if (existing) existing.remove();

    const color = pieceColor(moves[0].piece);
    const picker = document.createElement('div');
    picker.className = 'promotion-picker';

    const order: PieceType[] = [PieceType.Queen, PieceType.Rook, PieceType.Bishop, PieceType.Knight];
    for (const pt of order) {
      const match = moves.find((m) => m.promotion === pt);
      if (!match) continue;
      const btn = document.createElement('button');
      btn.className = 'promo-choice';
      btn.textContent = GLYPHS[color][pt];
      btn.setAttribute('aria-label', `Promote to ${PROMO_NAMES[pt]}`);
      btn.addEventListener('click', () => {
        picker.remove();
        this.commitMove(match);
      });
      picker.appendChild(btn);
    }

    (this.root.parentElement ?? this.root).appendChild(picker);
  }

  // Utility exposed for callers: does this move require a promotion choice?
  static isPromotion(move: Move): boolean {
    return move.flag === MoveFlag.Promotion;
  }
}
