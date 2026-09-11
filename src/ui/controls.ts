// controls.ts - the control panel: difficulty selector (five tiers + Auto),
// side-to-play choice, new-game button, and a status line showing whose turn it
// is and check / checkmate / stalemate / draw outcomes.
//
// A thin DOM layer that reports user intent to the controller via callbacks; it
// holds no game state of its own.

import { Color } from '../engine/board.js';
import { GameResult } from '../engine/rules.js';
import { Difficulty, DIFFICULTY_ORDER, DIFFICULTIES } from '../ai/difficulty.js';

// 'auto' selects the Elo-based auto-difficulty mode; the concrete tiers are the
// five Difficulty values.
export type DifficultySelection = Difficulty | 'auto';

export interface ControlsCallbacks {
  onDifficultyChange: (selection: DifficultySelection) => void;
  onSideChange: (side: Color) => void;
  onNewGame: () => void;
}

export class Controls {
  private readonly difficultySelect: HTMLSelectElement;
  private readonly sideSelect: HTMLSelectElement;
  private readonly newGameButton: HTMLButtonElement;
  private readonly statusEl: HTMLElement;

  constructor(root: HTMLElement, callbacks: ControlsCallbacks) {
    this.difficultySelect = root.querySelector<HTMLSelectElement>('#difficulty')!;
    this.sideSelect = root.querySelector<HTMLSelectElement>('#side')!;
    this.newGameButton = root.querySelector<HTMLButtonElement>('#new-game')!;
    this.statusEl = root.querySelector<HTMLElement>('#status')!;

    this.populateDifficulties();

    this.difficultySelect.addEventListener('change', () => {
      callbacks.onDifficultyChange(this.difficultySelect.value as DifficultySelection);
    });
    this.sideSelect.addEventListener('change', () => {
      callbacks.onSideChange(this.sideSelect.value === 'b' ? 'b' : 'w');
    });
    this.newGameButton.addEventListener('click', () => callbacks.onNewGame());
  }

  // Fill the difficulty <select> with the five tiers plus the Auto (Elo) option.
  private populateDifficulties(): void {
    this.difficultySelect.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'Auto (Elo)';
    this.difficultySelect.appendChild(auto);

    for (const tier of DIFFICULTY_ORDER) {
      const cfg = DIFFICULTIES[tier];
      const opt = document.createElement('option');
      opt.value = tier;
      opt.textContent = `${cfg.label} (~${cfg.approxElo})`;
      this.difficultySelect.appendChild(opt);
    }
  }

  getDifficulty(): DifficultySelection {
    return this.difficultySelect.value as DifficultySelection;
  }

  setDifficulty(selection: DifficultySelection): void {
    this.difficultySelect.value = selection;
  }

  getSide(): Color {
    return this.sideSelect.value === 'b' ? 'b' : 'w';
  }

  // Enable/disable inputs (e.g. lock the selectors while a game is in progress
  // or the AI is thinking).
  setBusy(busy: boolean): void {
    this.newGameButton.disabled = busy;
  }

  // Render the status line for the current position / outcome.
  showStatus(turn: Color, result: GameResult, inCheck: boolean, thinking: boolean): void {
    let text: string;
    let tone = 'ongoing';

    if (result.status === 'checkmate') {
      const winner = result.winner === 'w' ? 'White' : 'Black';
      text = `Checkmate \u2014 ${winner} wins`;
      tone = 'over';
    } else if (result.status === 'stalemate') {
      text = 'Stalemate \u2014 draw';
      tone = 'over';
    } else if (result.status === 'draw') {
      text = `Draw (${result.reason ?? 'draw'})`;
      tone = 'over';
    } else if (thinking) {
      text = 'AI is thinking\u2026';
      tone = 'thinking';
    } else {
      const side = turn === 'w' ? 'White' : 'Black';
      text = inCheck ? `${side} to move \u2014 check!` : `${side} to move`;
    }

    this.statusEl.textContent = text;
    this.statusEl.setAttribute('data-tone', tone);
  }
}
