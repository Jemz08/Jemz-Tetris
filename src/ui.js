// DOM helpers, canvas rendering, HUD, overlays, touch pad and high scores.

import { COLORS } from './pieces.js';
import { COLS, ROWS, HIDDEN } from './board.js';
import { formatScore } from './scoring.js';
import { loadScores, loadSettings } from './storage.js';
import { fetchLeaderboard, subscribeLeaderboard, stopLiveLeaderboard, isOnlineLeaderboardConfigured } from './leaderboard.js';
import { getTier } from './rank.js';

export const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---- screen router ----------------------------------------------------

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const target = $(`screen-${name}`);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
  if (name !== 'scores') stopLiveLeaderboard();
}

// ---- canvas drawing ----------------------------------------------------

let canvases = new Map(); // playerIdx -> {canvas, ctx, cell}

export function sizeCanvas(canvas) {
  canvas.style.width = '';
  canvas.style.height = '';
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cell = Math.max(6, Math.floor(rect.width / COLS));
  const px = cell * COLS;
  canvas.width = px * dpr;
  canvas.height = px * (ROWS / COLS) * dpr;
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px * 2}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cell };
}

// Chunky pixel-bevel block: dark outline, thick light/shadow bands on two
// opposite edges and a small bright glint near the top-left corner —
// mirrors the look of the "TETROMINOES (PIXEL STYLE)" reference sprites.
export function drawPixelBlock(ctx, x0, y0, size, color) {
  const outline = Math.max(1, Math.round(size * 0.09));
  ctx.fillStyle = 'rgba(4,3,10,0.9)';
  ctx.fillRect(x0, y0, size, size);

  const ix = x0 + outline;
  const iy = y0 + outline;
  const s = size - outline * 2;
  if (s <= 0) return;

  ctx.fillStyle = color;
  ctx.fillRect(ix, iy, s, s);

  const bevel = Math.max(1, Math.round(s * 0.24));
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fillRect(ix, iy, s, bevel);
  ctx.fillRect(ix, iy, bevel, s);

  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(ix, iy + s - bevel, s, bevel);
  ctx.fillRect(ix + s - bevel, iy, bevel, s);

  const dot = Math.max(1, Math.round(s * 0.16));
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(ix + bevel * 0.5, iy + bevel * 0.5, dot, dot);
}

function drawCell(ctx, x, y, size, color, flash = 0) {
  const pad = Math.max(1, Math.round(size * 0.05));
  const x0 = x * size + pad;
  const y0 = y * size + pad;
  const s = size - pad * 2;
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * flash})`;
    ctx.fillRect(x0, y0, s, s);
    return;
  }
  drawPixelBlock(ctx, x0, y0, s, color);
}

export function renderPlayer(player, canvas, opts = {}) {
  let entry = canvases.get(canvas);
  if (!entry || entry.cell === 0) {
    entry = sizeCanvas(canvas);
    canvases.set(canvas, entry);
  }
  const { ctx, cell } = entry;
  const w = cell * COLS;
  const h = cell * ROWS;

  // background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(4,2,12,0.92)';
  ctx.fillRect(0, 0, w, h);
  // grid
  ctx.strokeStyle = 'rgba(120,100,180,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) {
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, h);
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(w, y * cell + 0.5);
  }
  ctx.stroke();

  const board = player.board;
  // locked cells
  for (let y = HIDDEN; y < ROWS + HIDDEN; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = board.grid[y][x];
      if (!v) continue;
      const flashing = board.isRowFlashing(y);
      const flash = flashing ? Math.max(0, board.flash / 180) : 0;
      drawCell(ctx, x, y - HIDDEN, cell, typeof v === 'string' ? v : COLORS[v], flash);
    }
  }

  // ghost
  if (player.piece && !player.topOut && player.state !== 'finished' && !board.isClearing()) {
    const ghostColor = 'rgba(200,190,255,0.28)';
    const m = player.piece.matrix;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const px = player.piece.x + c;
        const py = player.ghostY + r;
        if (py < HIDDEN || py >= ROWS + HIDDEN) continue;
        ctx.strokeStyle = ghostColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px * cell + 1.5, (py - HIDDEN) * cell + 1.5, cell - 3, cell - 3);
      }
    }
  }

  // active piece
  if (player.piece && !player.topOut && player.state !== 'finished' && !board.isClearing()) {
    const m = player.piece.matrix;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const px = player.piece.x + c;
        const py = player.piece.y + r;
        if (py < HIDDEN || py >= ROWS + HIDDEN) continue;
        drawCell(ctx, px, py - HIDDEN, cell, player.piece.color);
      }
    }
  }

  // top-out red haze
  if (player.topOut) {
    ctx.fillStyle = 'rgba(255,40,80,0.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff2d55';
    ctx.font = `bold ${Math.round(cell * 1.5)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('GAME', w / 2, h / 2 - cell);
    ctx.fillText('OVER', w / 2, h / 2 + cell * 0.6);
  }

  // online opponent / CPU opponent name tag
  if ((player.remote || player.bot) && !player.finished) {
    ctx.fillStyle = 'rgba(154,143,192,0.9)';
    ctx.font = `${Math.round(cell * 0.9)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(player.remote ? 'RIVAL' : 'BOT', w / 2, cell * 1.2);
  }

  if (opts.callback) opts.callback();
}

export function drawMiniPiece(canvas, type, dim = true) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const size = Math.max(10, Math.floor(rect.width));
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (!type) return;
  const cell = Math.floor((size - 6) / 4);
  const cells = {
    I: [[1, 0], [1, 1], [1, 2], [1, 3]],
    O: [[0, 0], [0, 1], [1, 0], [1, 1]],
    T: [[0, 1], [1, 0], [1, 1], [1, 2]],
    S: [[0, 1], [0, 2], [1, 0], [1, 1]],
    Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
    J: [[0, 0], [1, 0], [1, 1], [1, 2]],
    L: [[0, 2], [1, 0], [1, 1], [1, 2]]
  };
  const ox = (size - cell * 4) / 2;
  const oy = (size - cell * 4) / 2;
  for (const [r, c] of cells[type]) {
    if (dim) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(ox + c * cell, oy + r * cell, cell - 1, cell - 1);
    } else {
      drawPixelBlock(ctx, ox + c * cell, oy + r * cell, cell - 1, COLORS[type]);
    }
  }
}

export function resetCanvasSizes() {
  canvases.clear();
}

// ---- arena construction -------------------------------------------------

export function buildArena(controller, mode) {
  const arena = $('arena');
  arena.innerHTML = '';
  arena.className = `arena mode-${mode}`;
  const playerCount = controller.players.length;

  controller.players.forEach((p, i) => {
    const zone = el('div', 'pzone');
    zone.dataset.p = i;

    const header = el('div', 'pzone-head');
    const name = el('span', 'pzone-name', p.name);
    const status = el('span', 'pzone-status', '');
    header.append(name, status);

    const boardWrap = el('div', 'board-wrap');
    const canvas = el('canvas', 'board-canvas');
    canvas.setAttribute('aria-label', `${p.name} Tetris board`);
    boardWrap.appendChild(canvas);

    const stats = el('div', 'pzone-stats');
    const stat = (label, val, id) => {
      const s = el('div', 'stat');
      s.appendChild(el('span', 'stat-label', label));
      const v = el('span', 'stat-value', val);
      v.id = `stat-${id}-${i}`;
      s.appendChild(v);
      stats.appendChild(s);
      return v;
    };
    const scoreEl = stat('SCORE', '000000', 'score');
    const linesEl = stat('LINES', '0', 'lines');
    const levelEl = stat('LEVEL', '1', 'level');
    const piecesEl = stat('PIECES', '0', 'pieces');
    // Combo counter (hidden when 0)
    const comboEl = stat('COMBO', '', 'combo');
    comboEl.closest('.stat').style.display = 'none';
    zone.append(header, boardWrap, stats);

    // solo side panel with hold / next
    if (playerCount === 1) {
      const side = el('div', 'side-panel');
      const panel = (title, canvasId) => {
        const box = el('div', 'mini-panel');
        box.appendChild(el('div', 'mini-title', title));
        const cv = el('canvas', 'mini-canvas');
        cv.id = canvasId;
        box.appendChild(cv);
        return box;
      };
      side.appendChild(panel('HOLD', 'mini-hold'));
      side.appendChild(panel('NEXT', 'mini-next'));
      const hs = el('div', 'mini-panel high-panel');
      hs.appendChild(el('div', 'mini-title', 'HIGH SCORE'));
      const hv = el('div', 'high-value');
      hv.id = 'high-score-value';
      hs.appendChild(hv);
      side.appendChild(hs);
      arena.appendChild(side);
    }

    arena.appendChild(zone);
    sizeCanvas(canvas);
  });

  // solo: prefill high score
  if (playerCount === 1) {
    const hs = loadScores();
    const best = hs.length ? Math.max(...hs.map((s) => s.score)) : 0;
    const hv = $('high-score-value');
    if (hv) hv.textContent = formatScore(best);
  }

  return arena;
}

export function updateArenaHud(controller) {
  controller.players.forEach((p, i) => {
    const set = (id, val) => {
      const node = $(`${id}-${i}`);
      if (node) node.textContent = val;
    };
    set('stat-score', formatScore(p.score));
    set('stat-lines', String(p.lines));
    set('stat-level', String(p.level));
    set('stat-pieces', String(p.pieces));

    const status = document.querySelector(`.pzone[data-p="${i}"] .pzone-status`);
    if (status) {
      if (p.topOut) status.textContent = 'GAME OVER';
      else if (p.finished) status.textContent = `#${p.finishOrder}`;
      else if (p.state === 'paused') status.textContent = 'PAUSED';
      else status.textContent = p.remote ? 'ONLINE' : (p.bot ? 'CPU' : '');
    }

    // Combo display
    const comboNode = $(`stat-combo-${i}`);
    const comboStat = comboNode && comboNode.closest('.stat');
    if (comboStat) {
      if (p.combo > 1) {
        comboStat.style.display = '';
        comboNode.textContent = String(p.combo);
      } else {
        comboStat.style.display = 'none';
      }
    }

    const canvas = document.querySelector(`.pzone[data-p="${i}"] .board-canvas`);
    if (canvas) renderPlayer(p, canvas);

    if (i === 0) {
      const hold = $('mini-hold');
      const next = $('mini-next');
      if (hold) drawMiniPiece(hold, p.hold ? p.hold.type : null, !p.canHold);
      if (next) drawMiniPiece(next, p.queue.length ? p.queue[0].type : null, false);
    }
  });
}

export function setTopBar(mode, difficultyLabel) {
  const bar = $('game-topbar');
  if (!bar) return;
  bar.innerHTML = '';
  const left = el('span', 'topbar-item', mode === 'solo' ? 'SOLO' : (mode === 'bot' ? 'VS BOT' : `${mode} PLAYERS`));
  const mid = el('span', 'topbar-item topbar-diff', difficultyLabel);
  const btn = el('button', 'btn btn-small', 'PAUSE');
  btn.type = 'button';
  btn.dataset.action = 'pause';
  bar.append(left, mid, btn);
}

// ---- overlays ------------------------------------------------------------

export function showOverlay(name) {
  const ov = $(`overlay-${name}`);
  if (ov) ov.classList.add('open');
}

export function hideOverlay(name) {
  const ov = $(`overlay-${name}`);
  if (ov) ov.classList.remove('open');
}

export function showCountdown(onDone) {
  const ov = $('overlay-countdown');
  const num = $('countdown-num');
  ov.classList.add('open');
  let n = 3;
  num.textContent = '3';
  audioRefs && audioRefs.countdown && audioRefs.countdown();
  const iv = setInterval(() => {
    n--;
    if (n === 0) {
      num.textContent = 'GO!';
      num.classList.add('go');
      audioRefs && audioRefs.go && audioRefs.go();
    } else if (n > 0) {
      num.textContent = String(n);
      num.classList.remove('go');
      audioRefs && audioRefs.countdown && audioRefs.countdown();
    }
    if (n < 0) {
      clearInterval(iv);
      ov.classList.remove('open');
      onDone();
    }
  }, 700);
}

let audioRefs = null;
export function setAudioRefs(refs) {
  audioRefs = refs;
}

export function showGameOver(data) {
  const ov = $('overlay-gameover');
  $('gameover-score').textContent = formatScore(data.score);
  $('gameover-lines').textContent = String(data.lines);
  $('gameover-level').textContent = String(data.level);
  const qualifies = data.qualifies;
  const nameRow = $('gameover-name-row');
  if (qualifies) {
    nameRow.classList.remove('hidden');
    const nameInput = $('gameover-name');
    const settings = loadSettings();
    nameInput.value = settings.playerName || 'PLAYER';
    nameInput.focus();
  } else {
    nameRow.classList.add('hidden');
  }
  ov.classList.add('open');
}

export function hideGameOver() {
  hideOverlay('gameover');
}

export function showVictory(ranked, mode) {
  const ov = $('overlay-victory');
  const list = $('victory-list');
  list.innerHTML = '';
  const winner = ranked[0];
  $('victory-title').textContent = mode === 'solo' ? 'GAME OVER' : `${winner.name} WINS!`;
  ranked.forEach((p, i) => {
    const row = el('div', `vrow ${i === 0 ? 'winner' : ''}`);
    row.appendChild(el('span', 'vrank', `#${i + 1}`));
    row.appendChild(el('span', 'vname', p.name));
    row.appendChild(el('span', 'vscore', formatScore(p.score)));
    row.appendChild(el('span', 'vlines', String(p.lines)));
    list.appendChild(row);
  });
  ov.classList.add('open');
}

// ---- toasts ---------------------------------------------------------------

export function showToast(msg, ms = 2600) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('open');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('open'), ms);
}

// ---- high scores ----------------------------------------------------------

function renderScoreRows(list) {
  const tbody = $('scores-body');
  tbody.innerHTML = '';
  if (!list.length) {
    const row = el('tr');
    const cell = el('td', '', 'NO SCORES YET — BE THE FIRST!');
    cell.colSpan = 6;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  list.slice(0, 20).forEach((s, i) => {
    const row = el('tr');
    row.appendChild(el('td', '', String(i + 1)));
    row.appendChild(el('td', '', s.name));
    const tier = getTier(s.score || 0);
    const tierCell = el('td');
    const badge = el('span', 'rank-badge', tier.name);
    badge.style.color = tier.color;
    badge.style.borderColor = tier.color;
    tierCell.appendChild(badge);
    row.appendChild(tierCell);
    row.appendChild(el('td', 'num', formatScore(s.score)));
    row.appendChild(el('td', 'num', String(s.lines)));
    row.appendChild(el('td', '', (s.difficulty || 'moderate').toUpperCase()));
    tbody.appendChild(row);
  });
}

function setScoresStatus(text, live) {
  const status = $('scores-status');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('live', !!live);
}

export function renderScores(filter) {
  // Show local scores immediately so the screen never looks empty/frozen.
  const local = filter ? loadScores().filter((s) => s.difficulty === filter) : loadScores();
  renderScoreRows(local);

  if (!isOnlineLeaderboardConfigured()) {
    setScoresStatus('LOCAL SCORES ONLY (THIS DEVICE)', false);
    return;
  }

  setScoresStatus('CONNECTING TO SHARED LEADERBOARD…', false);
  fetchLeaderboard(filter).then((shared) => {
    if (shared) {
      renderScoreRows(shared);
      setScoresStatus('SHARED LEADERBOARD • LIVE', true);
    } else {
      setScoresStatus('OFFLINE — SHOWING LOCAL SCORES', false);
    }
  });

  // Keep it fresh while the player is sitting on this screen.
  subscribeLeaderboard(filter, (shared) => {
    renderScoreRows(shared);
    setScoresStatus('SHARED LEADERBOARD • LIVE', true);
  });
}

// ---- account -----------------------------------------------------------

export function renderAccountUI(user) {
  const signedOut = $('account-signed-out');
  const signedIn = $('account-signed-in');
  if (!signedOut || !signedIn) return;
  if (user) {
    signedOut.classList.add('hidden');
    signedIn.classList.remove('hidden');
    $('account-name').textContent = (user.displayName || user.email || 'PLAYER').toUpperCase();
    const best = Math.max(0, ...loadScores().map((s) => s.score || 0), 0);
    const tier = getTier(best);
    const badge = $('account-rank');
    badge.textContent = tier.name;
    badge.style.color = tier.color;
    badge.style.borderColor = tier.color;
  } else {
    signedOut.classList.remove('hidden');
    signedIn.classList.add('hidden');
  }
}

export function setAccountStatus(text) {
  const status = $('account-status');
  if (status) status.textContent = text || '';
}

// ---- settings helpers -----------------------------------------------------

export function buildControlsTable(container, controls, onRemap) {
  container.innerHTML = '';
  const actions = [
    ['left', 'MOVE LEFT'],
    ['right', 'MOVE RIGHT'],
    ['rotate', 'ROTATE CW'],
    ['rotateCCW', 'ROTATE CCW'],
    ['softdrop', 'SOFT DROP'],
    ['harddrop', 'HARD DROP'],
    ['hold', 'HOLD']
  ];
  const players = 4;
  const table = el('table', 'controls-table');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', '', 'ACTION'));
  for (let p = 0; p < players; p++) hr.appendChild(el('th', '', `P${p + 1}`));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const [action, label] of actions) {
    const row = el('tr');
    row.appendChild(el('td', 'ctl-action', label));
    for (let p = 0; p < players; p++) {
      const key = controls[`p${p}`][action];
      const btn = el('button', 'btn btn-key', prettyKey(key));
      btn.type = 'button';
      btn.dataset.player = p;
      btn.dataset.action = action;
      btn.addEventListener('click', () => onRemap(btn, p, action));
      row.appendChild(btn);
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

export function prettyKey(code) {
  const map = {
    ArrowLeft: '◀', ArrowRight: '▶', ArrowUp: '▲', ArrowDown: '▼',
    Space: 'SPACE', KeyC: 'C', KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyS: 'S',
    KeyF: 'F', KeyQ: 'Q', KeyJ: 'J', KeyL: 'L', KeyI: 'I', KeyK: 'K',
    KeyH: 'H', KeyU: 'U', Numpad4: '4', Numpad6: '6', Numpad8: '8',
    Numpad5: '5', Numpad7: '7', Numpad9: '9', Numpad1: '1', Numpad2: '2',
    Numpad3: '3', ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT', ControlLeft: 'CTRL',
    ControlRight: 'CTRL', AltLeft: 'ALT', AltRight: 'ALT', Enter: 'ENTER',
    KeyZ: 'Z', KeyX: 'X', KeyM: 'M', KeyN: 'N', KeyB: 'B', KeyG: 'G', KeyV: 'V',
    KeyT: 'T', KeyY: 'Y', KeyR: 'R', KeyE: 'E', KeyO: 'O', KeyP: 'P'
  };
  if (map[code]) return map[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code.replace('Numpad', 'NUM').replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function updateTouchpad(controller) {
  const pad = $('touchpad');
  const multi = controller && controller.players.filter((p) => !p.bot && !p.remote).length > 1;
  const sel = $('touchpad-select');
  if (sel) {
    sel.classList.toggle('hidden', !multi);
    if (multi) {
      sel.innerHTML = '';
      controller.players.forEach((p, i) => {
        const b = el('button', 'btn btn-tab', p.name);
        b.type = 'button';
        b.dataset.player = i;
        b.classList.toggle('active', i === touchTarget);
        b.addEventListener('click', () => {
          touchTarget = i;
          sel.querySelectorAll('.btn-tab').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          audioRefs && audioRefs.click && audioRefs.click();
        });
        sel.appendChild(b);
      });
    }
  }
}

export let touchTarget = 0;
export function setTouchTarget(i) {
  touchTarget = i;
}
