// VS BOT opponent AI.
// For each new piece the bot scores every (rotation, column) placement with
// a classic height/holes/bumpiness/lines heuristic, then "plays" the winning
// placement by issuing the same rotate/move/hardDrop calls a human would —
// paced out over time so it looks like it's actually playing, not teleporting.

import { rotateMatrix } from './pieces.js';
import { COLS } from './board.js';

// Per-difficulty personality: how long the bot "thinks" before moving,
// how fast it executes each rotate/shift, and how often it deliberately
// picks a worse-than-best placement (so EASY looks beatable and EXTREME
// looks ruthless).
const PROFILES = {
  easy: { reaction: 620, moveInterval: 170, mistakeChance: 0.40, mistakePool: 6 },
  moderate: { reaction: 360, moveInterval: 115, mistakeChance: 0.20, mistakePool: 4 },
  hard: { reaction: 190, moveInterval: 75, mistakeChance: 0.08, mistakePool: 3 },
  extreme: { reaction: 70, moveInterval: 30, mistakeChance: 0.0, mistakePool: 1 }
};

export class BotAI {
  constructor(difficulty) {
    this.setDifficulty(difficulty);
    this.pieceRef = null;
    this.plan = null; // { rotationsLeft, targetX }
    this.thinkTimer = 0;
    this.moveTimer = 0;
    this.stallGuard = 0;
  }

  setDifficulty(difficulty) {
    this.profile = PROFILES[difficulty] || PROFILES.moderate;
  }

  update(dt, player) {
    if (!player.piece || player.state !== 'playing') {
      this.pieceRef = null;
      this.plan = null;
      return;
    }

    if (this.pieceRef !== player.piece) {
      // A new piece spawned — "notice" it after a short reaction delay.
      this.pieceRef = player.piece;
      this.plan = null;
      this.thinkTimer = this.profile.reaction;
      this.moveTimer = 0;
      this.stallGuard = 0;
      return;
    }

    if (!this.plan) {
      this.thinkTimer -= dt;
      if (this.thinkTimer > 0) return;
      this.plan = this._choosePlacement(player);
      this.moveTimer = 0;
      return;
    }

    this.moveTimer -= dt;
    if (this.moveTimer > 0) return;
    this.moveTimer = this.profile.moveInterval;
    this._step(player);
  }

  _step(player) {
    const plan = this.plan;
    if (!plan) return;

    if (plan.rotationsLeft > 0) {
      const ok = player.rotate(1);
      plan.rotationsLeft--;
      if (!ok && ++this.stallGuard > 8) plan.rotationsLeft = 0;
      return;
    }

    const dx = plan.targetX - player.piece.x;
    if (dx === 0) {
      player.hardDrop();
      this.plan = null;
      return;
    }
    const moved = dx > 0 ? player.moveRight() : player.moveLeft();
    if (!moved && ++this.stallGuard > 12) {
      // Stuck against something unexpected — take the drop rather than hang.
      player.hardDrop();
      this.plan = null;
    }
  }

  _choosePlacement(player) {
    const options = enumeratePlacements(player);
    if (!options.length) return { rotationsLeft: 0, targetX: player.piece.x };
    options.sort((a, b) => b.score - a.score);
    let choice = options[0];
    if (Math.random() < this.profile.mistakeChance) {
      const pool = options.slice(0, Math.min(options.length, this.profile.mistakePool));
      choice = pool[Math.floor(Math.random() * pool.length)];
    }
    return { rotationsLeft: choice.rot, targetX: choice.x };
  }
}

function enumeratePlacements(player) {
  const board = player.board;
  const startMatrix = player.piece.matrix;
  const results = [];
  let matrix = startMatrix.map((row) => row.slice());

  for (let rot = 0; rot < 4; rot++) {
    const size = matrix.length;
    let minC = size;
    let maxC = -1;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) { if (c < minC) minC = c; if (c > maxC) maxC = c; }
      }
    }
    if (maxC >= 0) {
      for (let x = -minC; x <= COLS - 1 - maxC; x++) {
        let y = -size;
        while (board.collides(matrix, x, y)) y++;
        while (!board.collides(matrix, x, y + 1)) y++;
        if (board.collides(matrix, x, y)) continue;
        results.push({ rot, x, score: evaluate(board, matrix, x, y) });
      }
    }
    matrix = rotateMatrix(matrix, 1);
    // O piece looks identical in every state — no point trying all 4.
    if (player.piece.type === 'O') break;
  }
  return results;
}

function evaluate(board, matrix, x, y) {
  const grid = board.grid.map((row) => row.slice());
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      const px = x + c;
      const py = y + r;
      if (py >= 0 && py < grid.length) grid[py][px] = 1;
    }
  }
  const cols = grid[0].length;
  const heights = new Array(cols).fill(0);
  let holes = 0;
  for (let c = 0; c < cols; c++) {
    let seenBlock = false;
    for (let r = 0; r < grid.length; r++) {
      if (grid[r][c]) {
        if (!seenBlock) { heights[c] = grid.length - r; seenBlock = true; }
      } else if (seenBlock) {
        holes++;
      }
    }
  }
  let bumpiness = 0;
  for (let c = 0; c < cols - 1; c++) bumpiness += Math.abs(heights[c] - heights[c + 1]);
  let linesCleared = 0;
  for (let r = 0; r < grid.length; r++) if (grid[r].every((v) => v)) linesCleared++;
  const aggHeight = heights.reduce((a, b) => a + b, 0);

  // Classic weighted heuristic (Pierre Dellacherie-style): reward clearing
  // lines, punish tall/uneven/holey stacks.
  return (-0.51 * aggHeight) + (0.76 * linesCleared) - (0.36 * holes) - (0.18 * bumpiness);
}
