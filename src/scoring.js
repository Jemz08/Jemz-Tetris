// Classic Tetris scoring, difficulty gravity curves and level progression.
// ENHANCED: combo bonus scoring.

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

// Standard guideline points for 0..4 lines cleared in one move.
const LINE_SCORES = [0, 100, 300, 500, 800];

export function dropIntervalMs(difficultyId, level) {
  const d = DIFFICULTIES[difficultyId] || DIFFICULTIES.moderate;
  const ms = d.baseMs * Math.pow(d.softFactor, Math.max(0, level - 1));
  return Math.max(d.minMs, Math.round(ms));
}

export function linesScore(count, level) {
  return LINE_SCORES[Math.min(count, 4)] * Math.max(1, level);
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

// Combo bonus: 50 × combo_count × level
export function comboBonus(combo, level) {
  if (combo <= 1) return 0;
  return 50 * combo * Math.max(1, level);
}

export function formatScore(n) {
  return String(Math.floor(n)).padStart(6, '0');
}
