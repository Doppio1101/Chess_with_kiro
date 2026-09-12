// stats.ts - the player-stats panel.
//
// Shows the player's current Elo, their win/loss/draw record, and (in Auto mode)
// the difficulty tier currently matched to their rating. Persistence goes
// through the FEAT-003 Storage abstraction; this view only reads/renders and
// asks the controller to record results via the Elo model.

import { PlayerStats, loadStats } from '../elo/rating.js';
import { Difficulty, DIFFICULTIES } from '../ai/difficulty.js';
import { Storage } from '../elo/storage.js';

export class StatsView {
  private readonly eloEl: HTMLElement;
  private readonly winsEl: HTMLElement;
  private readonly lossesEl: HTMLElement;
  private readonly drawsEl: HTMLElement;
  private readonly gamesEl: HTMLElement;
  private readonly tierEl: HTMLElement;
  private readonly storage: Storage;

  constructor(root: HTMLElement, storage: Storage) {
    this.storage = storage;
    this.eloEl = root.querySelector<HTMLElement>('#stat-elo')!;
    this.winsEl = root.querySelector<HTMLElement>('#stat-wins')!;
    this.lossesEl = root.querySelector<HTMLElement>('#stat-losses')!;
    this.drawsEl = root.querySelector<HTMLElement>('#stat-draws')!;
    this.gamesEl = root.querySelector<HTMLElement>('#stat-games')!;
    this.tierEl = root.querySelector<HTMLElement>('#stat-tier')!;
  }

  // Read persisted stats from storage.
  load(): PlayerStats {
    return loadStats(this.storage);
  }

  // Render the given stats. `matchedTier` is shown when in Auto mode (the tier
  // the auto-difficulty selector picked); pass null to hide it.
  render(stats: PlayerStats, matchedTier: Difficulty | null): void {
    this.eloEl.textContent = String(stats.elo);
    this.winsEl.textContent = String(stats.wins);
    this.lossesEl.textContent = String(stats.losses);
    this.drawsEl.textContent = String(stats.draws);
    this.gamesEl.textContent = String(stats.gamesPlayed);

    if (matchedTier) {
      const cfg = DIFFICULTIES[matchedTier];
      this.tierEl.textContent = `Auto \u2192 ${cfg.label} (~${cfg.approxElo})`;
      this.tierEl.hidden = false;
    } else {
      this.tierEl.textContent = '';
      this.tierEl.hidden = true;
    }
  }
}
