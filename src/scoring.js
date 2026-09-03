// Tetr.io-style scoring: T-spin, combo, back-to-back, perfect clear,
// difficulty gravity curves and level progression.

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'EASY',
    desc: 'Slow falling speed · beginner friendly',
    baseMs: 980,
    softFactor: 0.86,
    minMs: 130
  },
  moderate: {
    id: 'moderate',
    label: 'MODERATE',
    desc: 'Normal falling speed · classic feel',
    baseMs: 720,
    softFactor: 0.84,
    minMs: 90
  },
  hard: {
    id: 'hard',
    label: 'HARD',
    desc: 'Faster falling · serious challenge',
    baseMs: 520,
    softFactor: 0.82,
    minMs: 60
  },
  extreme: {
    id: 'extreme',
    label: 'EXTREME',
    desc: 'Very fast · for skilled players',
    baseMs: 360,
    softFactor: 0.8,
    minMs: 45
  }
};

export function dropIntervalMs(difficultyId, level) {
  const d = DIFFICULTIES[difficultyId] || DIFFICULTIES.moderate;
  const ms = d.baseMs * Math.pow(d.softFactor, Math.max(0, level - 1));
  return Math.max(d.minMs, Math.round(ms));
}

export function levelForLines(lines) {
  return 1 + Math.floor(lines / 10);
}

export function softDropPoints(cells) {
  return cells * 1;
}

export function hardDropPoints(cells) {
  return cells * 2;
}

// ---- Tetr.io-style line clear scoring -----------------------------------

// Base points for 1-4 lines cleared (used by non-T-spin, non-PC clears).
// These are per-level guideline values (× level multiplier applied externally).
export const BASE_LINE_SCORES = [0, 100, 300, 500, 800];

// T-spin line clear scores (per level).
export const TSPIN_LINE_SCORES = [400, 800, 1200, 1600];

// T-spin mini line clear scores (per level).
export const TSPIN_MINI_LINE_SCORES = [100, 200, 400, 800];

// ---- Combo scoring ------------------------------------------------------

// Combo bonus = 50 × comboCount × level (comboCount starts at 0).
export function comboScore(comboCount, level) {
  return 50 * comboCount * level;
}

// ---- Back-to-back multiplier --------------------------------------------

// B2B multiplier for consecutive "brilliant" clears (Tetris or T-spin).
export const B2B_MULTIPLIER = 1.5;

// ---- Perfect clear scoring ----------------------------------------------

// Perfect clear base scores by lines cleared (per level).
export const PC_LINE_SCORES = [0, 800, 1200, 1800, 2000];

// ---- T-spin detection helpers ------------------------------------------

// Check the four corners of the 3×3 bounding box around the T-piece.
// Returns count of filled corners.
// T-piece center is always at offset (1,1) within the bounding box,
// so corners are at (0,0), (2,0), (0,2), (2,2) relative to piece x,y.
export function checkTSpinCorners(board, px, py) {
  let count = 0;
  for (const [cx, cy] of [[0,0], [2,0], [0,2], [2,2]]) {
    const bx = px + cx;
    const by = py + cy;
    if (bx < 0 || bx >= 10 || by < 0) {
      count++; // off-screen top counts as filled (above the board)
    } else if (by >= board.grid.length) {
      // off-screen bottom = empty
    } else if (board.grid[by][bx]) {
      count++;
    }
  }
  return count;
}

// Determine the T-spin result: 'tspin', 'tspin-mini', or null.
// - full: at least 3 corners filled
// - mini: exactly 2 corners filled AND lastAction was a move (not rotate)
// T-spin requires lastAction === 'rotate'.
export function detectTSpin(board, piece, lastAction) {
  if (!piece || piece.type !== 'T') return null;
  if (lastAction !== 'rotate') return null;
  const corners = checkTSpinCorners(board, piece.x, piece.y);
  if (corners >= 3) return 'tspin';
  if (corners === 2) return 'tspin-mini';
  return null;
}

// ---- Composite scoring --------------------------------------------------

// Calculate all scoring for a line clear event.
// Returns { base, combo, b2b, total, isBrilliant, announce }.
export function calcClearScore({
  linesCleared,
  level,
  tSpin,       // null | 'tspin' | 'tspin-mini'
  comboCount,  // current combo count BEFORE this clear (0-indexed)
  b2bActive,   // whether back-to-back is currently active
  perfectClear // boolean: is the board empty after clearing?
}) {
  let base = 0;
  let announce = null;

  if (tSpin === 'tspin') {
    if (linesCleared === 0) {
      base = 400 * level;
      announce = 'T-SPIN';
    } else {
      base = TSPIN_LINE_SCORES[Math.min(linesCleared, 3)] * level;
      if (linesCleared === 1) announce = 'T-SPIN SINGLE';
      else if (linesCleared === 2) announce = 'T-SPIN DOUBLE';
      else if (linesCleared === 3) announce = 'T-SPIN TRIPLE';
    }
  } else if (tSpin === 'tspin-mini') {
    if (linesCleared === 0) {
      base = 100 * level;
      announce = 'T-SPIN MINI';
    } else {
      base = TSPIN_MINI_LINE_SCORES[Math.min(linesCleared, 3)] * level;
      if (linesCleared === 1) announce = 'T-SPIN MINI SINGLE';
      else if (linesCleared === 2) announce = 'T-SPIN MINI DOUBLE';
    }
  } else {
    base = BASE_LINE_SCORES[Math.min(linesCleared, 4)] * level;
  }

  // Combo
  const combo = comboScore(comboCount, level);

  // Back-to-back: applies to Tetris (4 lines) or any T-spin that clears lines
  const isBrilliant = linesCleared === 4 || (tSpin && linesCleared > 0);
  let b2b = 0;
  if (b2bActive && isBrilliant) {
    b2b = Math.floor(base * (B2B_MULTIPLIER - 1)); // the extra 50%
    if (!announce) announce = linesCleared === 4 ? 'B2B TETRIS' : 'B2B';
    else announce = 'B2B ' + announce;
  }

  // Perfect clear bonus
  let pc = 0;
  if (perfectClear) {
    pc = PC_LINE_SCORES[Math.min(linesCleared, 4)] * level;
    if (announce) announce += ' PC';
    else announce = 'PERFECT CLEAR';
  }

  return {
    base,
    combo,
    b2b,
    pc,
    total: base + combo + b2b + pc,
    isBrilliant,
    announce
  };
}
