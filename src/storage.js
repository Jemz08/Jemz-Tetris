// localStorage persistence: settings, high scores, stats and auto-save.

const KEYS = {
  settings: 'jemz.tetris.settings',
  scores: 'jemz.tetris.scores',
  stats: 'jemz.tetris.stats'
};

export const DEFAULT_SETTINGS = {
  sound: true,
  music: true,
  volume: 0.7,
  crt: true,
  difficulty: 'moderate',
  playerName: 'PLAYER',
  controls: {
    // per player default key map (KeyboardEvent.code)
    p0: { left: 'ArrowLeft', right: 'ArrowRight', rotate: 'ArrowUp', softdrop: 'ArrowDown', harddrop: 'Space', hold: 'KeyC' },
    p1: { left: 'KeyA', right: 'KeyD', rotate: 'KeyW', softdrop: 'KeyS', harddrop: 'KeyF', hold: 'KeyQ' },
    p2: { left: 'KeyJ', right: 'KeyL', rotate: 'KeyI', softdrop: 'KeyK', harddrop: 'KeyH', hold: 'KeyU' },
    p3: { left: 'Numpad4', right: 'Numpad6', rotate: 'Numpad8', softdrop: 'Numpad5', harddrop: 'Numpad7', hold: 'Numpad9' }
  }
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or blocked — game keeps working in memory
  }
}

export function loadSettings() {
  const saved = read(KEYS.settings, {});
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (saved[k] !== undefined) out[k] = saved[k];
  }
  if (saved.controls) {
    out.controls = { ...DEFAULT_SETTINGS.controls, ...saved.controls };
    for (const p of Object.keys(DEFAULT_SETTINGS.controls)) {
      out.controls[p] = { ...DEFAULT_SETTINGS.controls[p], ...(saved.controls[p] || {}) };
    }
  }
  return out;
}

export function saveSettings(settings) {
  write(KEYS.settings, settings);
}

export function loadScores() {
  const scores = read(KEYS.scores, []);
  return Array.isArray(scores) ? scores : [];
}

export function saveScores(scores) {
  write(KEYS.scores, scores);
}

// Insert a score; keep the top 10. Returns the new entry or null if it did not qualify.
export function submitScore(entry) {
  const scores = loadScores();
  const rank = scores.findIndex((s) => s.score < entry.score);
  const insertAt = rank === -1 ? scores.length : rank;
  if (insertAt >= 10) return null;
  const stamped = { ...entry, date: Date.now() };
  scores.splice(insertAt, 0, stamped);
  const trimmed = scores.slice(0, 10);
  saveScores(trimmed);
  return stamped;
}

export function scoreQualifies(score) {
  if (score <= 0) return false;
  const scores = loadScores();
  return scores.length < 10 || score > scores[scores.length - 1].score;
}

export function loadStats() {
  const stats = read(KEYS.stats, {});
  return {
    games: stats.games || 0,
    pieces: stats.pieces || 0,
    lines: stats.lines || 0,
    tetrises: stats.tetrises || 0,
    bestScore: stats.bestScore || 0,
    bestLines: stats.bestLines || 0,
    multiplayerWins: stats.multiplayerWins || 0,
    lastDifficulty: stats.lastDifficulty || 'moderate',
    lastMode: stats.lastMode || 'solo'
  };
}

export function saveStats(stats) {
  write(KEYS.stats, stats);
}

export function updateStats(patch) {
  const stats = loadStats();
  Object.assign(stats, patch);
  saveStats(stats);
  return stats;
}

export function clearAllData() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
