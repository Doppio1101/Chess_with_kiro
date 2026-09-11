// worker.ts - Web Worker entry point for the AI search.
//
// The heavy search runs off the main thread so the UI stays responsive. This is
// the ONLY AI module that references Worker globals (postMessage / onmessage);
// evaluate.ts, search.ts and difficulty.ts stay DOM/Worker-free so they run
// identically under Node tests and here.
//
// Protocol:
//   main -> worker: { id, fen, params }            (params: SearchParams)
//                or { id, fen, difficulty }         (a Difficulty level)
//   worker -> main: { id, move, from, to, promotion, score, depth, nodes,
//                     elapsedMs }
// where `from`/`to` are algebraic squares and `promotion` is 'q'|'r'|'b'|'n'|null
// for easy consumption by the UI. `move` is the raw engine Move (or null).

import { Board, squareToAlgebraic, PieceType } from '../engine/board.js';
import { searchBestMove, SearchParams } from './search.js';
import { Difficulty, paramsFor } from './difficulty.js';

interface SearchRequest {
  id?: number | string;
  fen: string;
  params?: SearchParams;
  difficulty?: Difficulty;
}

function promotionToChar(promotion: PieceType | 0): string | null {
  switch (promotion) {
    case PieceType.Queen:
      return 'q';
    case PieceType.Rook:
      return 'r';
    case PieceType.Bishop:
      return 'b';
    case PieceType.Knight:
      return 'n';
    default:
      return null;
  }
}

// Run a single search request and return a plain, structured-clone-friendly
// result object. Exported so it can be unit-tested without a real Worker.
export function handleSearchRequest(req: SearchRequest): {
  id?: number | string;
  move: unknown;
  from: string | null;
  to: string | null;
  promotion: string | null;
  score: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
} {
  const board = Board.fromFEN(req.fen);
  const params: SearchParams = req.params
    ? req.params
    : req.difficulty
      ? paramsFor(req.difficulty)
      : paramsFor('pro');

  const result = searchBestMove(board, params);
  const move = result.move;

  return {
    id: req.id,
    move,
    from: move ? squareToAlgebraic(move.from) : null,
    to: move ? squareToAlgebraic(move.to) : null,
    promotion: move ? promotionToChar(move.promotion) : null,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
}

// Wire up the Worker message handler. Guarded so importing this module in a
// non-worker context (e.g. a test) does not throw.
if (typeof onmessage !== 'undefined') {
  onmessage = (ev: WorkerMessageEvent): void => {
    const req = ev.data as SearchRequest;
    if (!req || typeof req.fen !== 'string') return;
    const response = handleSearchRequest(req);
    postMessage(response);
  };
}
