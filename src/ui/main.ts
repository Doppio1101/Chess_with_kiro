// main.ts - the app controller.
//
// Owns the game Board, wires up the board view, controls and stats panels, and
// runs the AI in a Web Worker so the UI never freezes. Flow per game:
//   1. Human makes a legal move on the board view.
//   2. Controller applies it, checks for game end, and if the game continues
//      posts the position (FEN + search params) to the worker.
//   3. The worker replies with a move (always within the movetime cap); the
//      controller applies it and checks for game end again.
//   4. On game end, the result is fed into the Elo model, stats are persisted
//      and re-rendered, and (in Auto mode) the next game's tier is reselected.

import { Board, Color, Move, algebraicToSquare, PieceType } from '../engine/board.js';
import { generateLegalMoves } from '../engine/movegen.js';
import { getGameResult, isCheck, GameResult } from '../engine/rules.js';
import { Difficulty, paramsFor } from '../ai/difficulty.js';
import { SearchParams } from '../ai/search.js';
import { defaultStorage, Storage } from '../elo/storage.js';
import {
  PlayerStats,
  GameResult as EloResult,
  eloForTier,
  loadStats,
  saveStats,
  updateAfterGame,
} from '../elo/rating.js';
import { autoDifficultyFromStorage, pushRecentResult } from '../elo/autoDifficulty.js';
import { BoardView } from './board.js';
import { Controls, DifficultySelection } from './controls.js';
import { StatsView } from './stats.js';

// Shape of the worker's reply (see worker.ts protocol).
interface WorkerReply {
  id?: number | string;
  from: string | null;
  to: string | null;
  promotion: 'q' | 'r' | 'b' | 'n' | null;
}

export class GameController {
  private board = Board.start();
  private positionKeys: string[] = [];

  private readonly storage: Storage;
  private readonly view: BoardView;
  private readonly controls: Controls;
  private readonly stats: StatsView;

  private worker: Worker | null = null;
  private requestId = 0;

  private humanColor: Color = 'w';
  private selection: DifficultySelection = 'auto';
  private activeTier: Difficulty = 'beginner';
  private thinking = false;
  private gameOver = false;

  constructor(storage: Storage, view: BoardView, controls: Controls, stats: StatsView) {
    this.storage = storage;
    this.view = view;
    this.controls = controls;
    this.stats = stats;

    this.view.setMoveHandler((move) => this.onHumanMove(move));
    this.selection = controls.getDifficulty();
    this.humanColor = controls.getSide();
  }

  // Spawn (or respawn) the search worker. Uses import.meta.url so the worker URL
  // resolves against the compiled dist/ layout regardless of where the app is
  // served from.
  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('../ai/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent) => this.onWorkerReply(ev.data as WorkerReply);
  }

  // Start a fresh game, applying the current side + difficulty selection.
  newGame(): void {
    this.selection = this.controls.getDifficulty();
    this.humanColor = this.controls.getSide();

    // In Auto mode, reselect the tier from the player's Elo + recent results
    // before the game starts.
    this.activeTier = this.resolveTier();

    this.board = Board.start();
    this.positionKeys = [this.board.positionKey()];
    this.gameOver = false;
    this.thinking = false;

    this.view.setHumanColor(this.humanColor);
    this.view.setOrientation(this.humanColor);
    this.view.setInteractive(true);
    this.view.render(this.board);

    this.renderStats();
    this.updateStatus();

    // If the human chose black, the AI (white) moves first.
    if (this.board.turn !== this.humanColor) {
      this.requestAiMove();
    }
  }

  // Resolve the concrete tier the AI should use this game.
  private resolveTier(): Difficulty {
    if (this.selection === 'auto') {
      return autoDifficultyFromStorage(this.storage, loadStats(this.storage));
    }
    return this.selection;
  }

  private searchParams(): SearchParams {
    return paramsFor(this.activeTier);
  }

  // --- Human move -----------------------------------------------------------

  private onHumanMove(move: Move): void {
    if (this.gameOver || this.thinking) return;
    if (this.board.turn !== this.humanColor) return;
    if (!this.isLegal(move)) return;

    this.applyMove(move);
    if (this.checkGameEnd()) return;
    this.requestAiMove();
  }

  private isLegal(move: Move): boolean {
    return generateLegalMoves(this.board).some(
      (m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion,
    );
  }

  private applyMove(move: Move): void {
    this.board.makeMove(move);
    this.positionKeys.push(this.board.positionKey());
    this.view.render(this.board);
    this.updateStatus();
  }

  // --- AI move --------------------------------------------------------------

  private requestAiMove(): void {
    this.ensureWorker();
    this.thinking = true;
    this.view.setInteractive(false);
    this.controls.setBusy(true);
    this.updateStatus();

    const id = ++this.requestId;
    const params = this.searchParams();
    this.worker!.postMessage({ id, fen: this.board.toFEN(), params });
  }

  private onWorkerReply(reply: WorkerReply): void {
    if (this.gameOver) return;
    this.thinking = false;
    this.controls.setBusy(false);

    const move = reply.from && reply.to ? this.resolveReplyMove(reply) : null;
    if (move) {
      this.applyMove(move);
    }

    if (!this.checkGameEnd()) {
      this.view.setInteractive(true);
      this.updateStatus();
    }
  }

  // Map the worker's algebraic reply back onto a concrete legal Move.
  private resolveReplyMove(reply: WorkerReply): Move | null {
    const from = algebraicToSquare(reply.from!);
    const to = algebraicToSquare(reply.to!);
    const promo = this.promoCharToType(reply.promotion);
    const legal = generateLegalMoves(this.board);
    // Prefer an exact promotion match; fall back to from/to match.
    return (
      legal.find((m) => m.from === from && m.to === to && m.promotion === promo) ??
      legal.find((m) => m.from === from && m.to === to) ??
      null
    );
  }

  private promoCharToType(c: 'q' | 'r' | 'b' | 'n' | null): PieceType | 0 {
    switch (c) {
      case 'q':
        return PieceType.Queen;
      case 'r':
        return PieceType.Rook;
      case 'b':
        return PieceType.Bishop;
      case 'n':
        return PieceType.Knight;
      default:
        return 0;
    }
  }

  // --- Game end + Elo -------------------------------------------------------

  private currentResult(): GameResult {
    return getGameResult(this.board, this.positionKeys);
  }

  // Returns true if the game has ended (and finalizes it).
  private checkGameEnd(): boolean {
    const result = this.currentResult();
    if (result.status === 'ongoing') return false;

    this.gameOver = true;
    this.thinking = false;
    this.view.setInteractive(false);
    this.controls.setBusy(false);
    this.finishGame(result);
    this.updateStatus(result);
    return true;
  }

  // Feed the outcome into the Elo model and persist / re-render stats.
  private finishGame(result: GameResult): void {
    let eloResult: EloResult;
    if (result.status === 'checkmate') {
      eloResult = result.winner === this.humanColor ? 'win' : 'loss';
    } else {
      // stalemate or any draw
      eloResult = 'draw';
    }

    const opponentElo = eloForTier(this.activeTier);
    const current = loadStats(this.storage);
    const next = updateAfterGame(current, opponentElo, eloResult);
    saveStats(this.storage, next);
    pushRecentResult(this.storage, eloResult);

    this.renderStats(next);
  }

  // --- Rendering ------------------------------------------------------------

  private renderStats(stats?: PlayerStats): void {
    const s = stats ?? this.stats.load();
    const matched = this.selection === 'auto' ? this.activeTier : null;
    this.stats.render(s, matched);
  }

  private updateStatus(result?: GameResult): void {
    const r = result ?? (this.gameOver ? this.currentResult() : { status: 'ongoing' } as GameResult);
    this.controls.showStatus(this.board.turn, r, isCheck(this.board), this.thinking);
  }
}

// --- Bootstrap --------------------------------------------------------------

function boot(): void {
  const storage = defaultStorage();
  const boardEl = document.getElementById('board')!;
  const controlsEl = document.getElementById('controls')!;
  const statsEl = document.getElementById('stats')!;

  const view = new BoardView(boardEl);
  const stats = new StatsView(statsEl, storage);

  let controller: GameController;

  const controls = new Controls(controlsEl, {
    onDifficultyChange: () => controller.newGame(),
    onSideChange: () => controller.newGame(),
    onNewGame: () => controller.newGame(),
  });

  controller = new GameController(storage, view, controls, stats);
  controller.newGame();
}

// Only auto-boot in a real browser DOM. Guarded so importing this module under
// a test/Node context does not throw.
if (typeof document !== 'undefined') {
  boot();
}
