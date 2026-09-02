// DOM helpers, canvas rendering, HUD, overlays, touch pad and high scores.
// ENHANCED: 3D block rendering, particle system, screen shake, combo popups.

import { PIECE_COLORS } from './pieces.js';
import { COLS, ROWS, HIDDEN } from './board.js';
import { formatScore } from './scoring.js';
import { loadScores, loadSettings } from './storage.js';
import { fetchLeaderboard, subscribeLeaderboard, stopLiveLeaderboard, isOnlineLeaderboardConfigured } from './leaderboard.js';
import { getTier } from './rank.js';

// roundRect polyfill for older browsers
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
    let r = typeof radii === 'number' ? [radii, radii, radii, radii]
      : Array.isArray(radii) ? radii.concat([0, 0, 0, 0]).slice(0, 4)
      : [0, 0, 0, 0];
    this.beginPath();
    this.moveTo(x + r[0], y);
    this.lineTo(x + w - r[1], y);
    this.quadraticCurveTo(x + w, y, x + w, y + r[1]);
    this.lineTo(x + w, y + h - r[2]);
    this.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
    this.lineTo(x + r[3], y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r[3]);
    this.lineTo(x, y + r[0]);
    this.quadraticCurveTo(x, y, x + r[0], y);
    this.closePath();
    return this;
  };
}

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

// ---- particle system --------------------------------------------------

class Particle {
  constructor(x, y, vx, vy, color, life, size, type = 'circle') {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.type = type;
    this.gravity = 0.08;
    this.friction = 0.99;
    this.alpha = 1;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
    this.vx *= this.friction;
    this.life--;
    this.alpha = Math.max(0, this.life / this.maxLife);
  }

  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (this.type === 'spark') {
      const len = this.size * 2;
      const angle = Math.atan2(this.vy, this.vx);
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x - Math.cos(angle) * len, this.y - Math.sin(angle) * len);
      ctx.lineTo(this.x + Math.cos(angle) * len * 0.3, this.y + Math.sin(angle) * len * 0.3);
      ctx.stroke();
    } else if (this.type === 'glow') {
      const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
      grad.addColorStop(0, this.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * this.alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emit(x, y, count, color, opts = {}) {
    const {
      speedMin = 0.5, speedMax = 3, lifeMin = 20, lifeMax = 50,
      sizeMin = 1, sizeMax = 3, type = 'circle', gravity = 0.08
    } = opts;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const life = lifeMin + Math.random() * (lifeMax - lifeMin);
      const size = sizeMin + Math.random() * (sizeMax - sizeMin);
      const p = new Particle(x, y, vx, vy, color, life, size, type);
      p.gravity = gravity;
      this.particles.push(p);
    }
  }

  emitLock(cellX, cellY, cellSize, color) {
    const cx = cellX * cellSize + cellSize / 2;
    const cy = cellY * cellSize + cellSize / 2;
    const pColors = PIECE_COLORS[color] || { base: color, light: color };
    // Sparks
    this.emit(cx, cy, 6, pColors.light, { speedMin: 1, speedMax: 4, lifeMin: 10, lifeMax: 25, sizeMin: 1, sizeMax: 2, type: 'spark', gravity: 0.05 });
    // Glow dots
    this.emit(cx, cy, 4, pColors.glow, { speedMin: 0.3, speedMax: 1.5, lifeMin: 15, lifeMax: 30, sizeMin: 2, sizeMax: 5, type: 'glow', gravity: 0.02 });
  }

  emitClear(y, cellSize, row, isTetris) {
    for (let x = 0; x < COLS; x++) {
      const cx = x * cellSize + cellSize / 2;
      const cy = y * cellSize + cellSize / 2;
      const count = isTetris ? 8 : 4;
      const color = isTetris ? '#ffd740' : '#00f0ff';
      this.emit(cx, cy, count, color, { speedMin: 1, speedMax: 5, lifeMin: 15, lifeMax: 40, sizeMin: 1, sizeMax: 3, type: isTetris ? 'glow' : 'circle', gravity: 0.06 });
    }
  }

  emitTetrisCelebration(cellSize) {
    for (let i = 0; i < 60; i++) {
      const cx = (Math.random() * COLS) * cellSize + cellSize / 2;
      const cy = (Math.random() * ROWS) * cellSize * 0.3;
      const colors = ['#ffd740', '#00f0ff', '#e040fb', '#00e676'];
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.emit(cx, cy, 2, c, { speedMin: 2, speedMax: 6, lifeMin: 30, lifeMax: 70, sizeMin: 2, sizeMax: 5, type: 'glow', gravity: 0.04 });
    }
  }

  emitHardDropTrail(startY, endY, cellX, cellSize, color) {
    const pColors = PIECE_COLORS[color] || { base: color };
    for (let y = startY; y <= endY; y += 2) {
      const cy = y * cellSize + cellSize / 2;
      const cx = cellX * cellSize + cellSize / 2;
      this.emit(cx, cy, 1, pColors.glow, { speedMin: 0, speedMax: 0.5, lifeMin: 8, lifeMax: 15, sizeMin: 1, sizeMax: 3, type: 'glow', gravity: 0 });
    }
  }

  update() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      this.particles[i].update();
      if (this.particles[i].life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const p of this.particles) p.draw(ctx);
  }

  clear() {
    this.particles = [];
  }
}

// Export for use in main.js
export const particles = new ParticleSystem();

// ---- screen shake -----------------------------------------------------

export function screenShake(boardWrap, intensity = 'normal') {
  if (!boardWrap) return;
  boardWrap.classList.remove('shake', 'shake-big');
  void boardWrap.offsetWidth; // force reflow
  boardWrap.classList.add(intensity === 'big' ? 'shake-big' : 'shake');
}

// ---- combo popup ------------------------------------------------------

export function showComboPopup(boardWrap, text, type = '') {
  if (!boardWrap) return;
  const popup = document.createElement('div');
  popup.className = `combo-popup ${type}`;
  popup.textContent = text;
  boardWrap.appendChild(popup);
  setTimeout(() => popup.remove(), 1200);
}

export function showScoreFloat(boardWrap, text) {
  if (!boardWrap) return;
  const f = document.createElement('div');
  f.className = 'score-float';
  f.textContent = text;
  f.style.left = '50%';
  f.style.top = '30%';
  f.style.transform = 'translateX(-50%)';
  boardWrap.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

// ---- canvas drawing ---------------------------------------------------

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

// Enhanced 3D block drawing
function drawCell(ctx, x, y, size, color, flash = 0, pieceType = null) {
  const pad = Math.max(1, Math.round(size * 0.06));
  const x0 = x * size + pad;
  const y0 = y * size + pad;
  const s = size - pad * 2;
  const r = Math.max(2, Math.round(s * 0.12)); // corner radius

  if (flash > 0) {
    // Flash effect for clearing rows
    const intensity = 0.55 + 0.45 * flash;
    ctx.fillStyle = `rgba(255,255,255,${intensity})`;
    ctx.beginPath();
    ctx.roundRect(x0, y0, s, s, r);
    ctx.fill();
    return;
  }

  // Get rich colors
  const colors = pieceType && PIECE_COLORS[pieceType] ? PIECE_COLORS[pieceType] : null;
  const baseColor = typeof color === 'string' ? color : '#888';
  const lightColor = colors ? colors.light : '#ffffff';
  const darkColor = colors ? colors.dark : '#333333';
  const glowColor = colors ? colors.glow : 'rgba(128,128,128,0.3)';
  const shineColor = colors ? colors.shine : 'rgba(255,255,255,0.5)';

  // Outer glow
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = Math.max(2, s * 0.15);
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.roundRect(x0, y0, s, s, r);
  ctx.fill();
  ctx.restore();

  // Main body gradient (3D effect)
  const bodyGrad = ctx.createLinearGradient(x0, y0, x0 + s, y0 + s);
  bodyGrad.addColorStop(0, lightColor);
  bodyGrad.addColorStop(0.3, baseColor);
  bodyGrad.addColorStop(0.7, baseColor);
  bodyGrad.addColorStop(1, darkColor);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.roundRect(x0, y0, s, s, r);
  ctx.fill();

  // Top-left highlight bevel
  const bevelSize = Math.max(2, s * 0.18);
  ctx.fillStyle = shineColor;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x0 + bevelSize, y0);
  ctx.lineTo(x0, y0 + bevelSize);
  ctx.lineTo(x0, y0 + r);
  ctx.arcTo(x0, y0, x0 + r, y0, r);
  ctx.fill();

  // Inner highlight (fresnel-like)
  const innerGrad = ctx.createLinearGradient(x0, y0, x0, y0 + s * 0.5);
  innerGrad.addColorStop(0, 'rgba(255,255,255,0.25)');
  innerGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = innerGrad;
  ctx.beginPath();
  ctx.roundRect(x0 + 1, y0 + 1, s - 2, s * 0.45, [r, r, 0, 0]);
  ctx.fill();

  // Bottom-right shadow bevel
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(x0 + s - r, y0 + s);
  ctx.lineTo(x0 + s - bevelSize, y0 + s);
  ctx.lineTo(x0 + s, y0 + s - bevelSize);
  ctx.lineTo(x0 + s, y0 + s - r);
  ctx.arcTo(x0 + s, y0 + s, x0 + s - r, y0 + s, r);
  ctx.fill();

  // Tiny specular highlight
  const specX = x0 + s * 0.22;
  const specY = y0 + s * 0.22;
  const specR = Math.max(1, s * 0.08);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(specX, specY, specR, 0, Math.PI * 2);
  ctx.fill();
}

// Resolve piece type from a color value
function resolvePieceType(colorVal) {
  if (typeof colorVal !== 'string') return null;
  for (const [type, c] of Object.entries(PIECE_COLORS)) {
    if (c.base === colorVal) return type;
  }
  return null;
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

  // background with subtle gradient
  ctx.clearRect(0, 0, w, h);
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, 'rgba(6,3,18,0.95)');
  bgGrad.addColorStop(0.5, 'rgba(4,2,12,0.95)');
  bgGrad.addColorStop(1, 'rgba(6,3,18,0.95)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // grid with subtle glow
  ctx.strokeStyle = 'rgba(100,80,170,0.08)';
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

  // locked cells with 3D rendering
  for (let y = HIDDEN; y < ROWS + HIDDEN; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = board.grid[y][x];
      if (!v) continue;
      const flashing = board.isRowFlashing(y);
      const flash = flashing ? Math.max(0, board.flash / 180) : 0;
      const colorStr = typeof v === 'string' ? v : '#888';
      const type = resolvePieceType(colorStr);
      drawCell(ctx, x, y - HIDDEN, cell, colorStr, flash, type);
    }
  }

  // ghost piece with glow outline
  if (player.piece && !player.topOut && player.state !== 'finished' && !board.isClearing()) {
    const m = player.piece.matrix;
    const ghostColor = PIECE_COLORS[player.piece.type]
      ? PIECE_COLORS[player.piece.type].glow
      : 'rgba(200,190,255,0.28)';
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const px = player.piece.x + c;
        const py = player.ghostY + r;
        if (py < HIDDEN || py >= ROWS + HIDDEN) continue;
        const bx = px * cell + 1.5;
        const by = (py - HIDDEN) * cell + 1.5;
        const bs = cell - 3;
        // Ghost fill
        ctx.fillStyle = ghostColor;
        ctx.globalAlpha = 0.12;
        ctx.beginPath();
        ctx.roundRect(bx, by, bs, bs, 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        // Ghost outline
        ctx.strokeStyle = ghostColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(bx, by, bs, bs, 2);
        ctx.stroke();
      }
    }
  }

  // active piece with full 3D rendering
  if (player.piece && !player.topOut && player.state !== 'finished' && !board.isClearing()) {
    const m = player.piece.matrix;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const px = player.piece.x + c;
        const py = player.piece.y + r;
        if (py < HIDDEN || py >= ROWS + HIDDEN) continue;
        drawCell(ctx, px, py - HIDDEN, cell, player.piece.color, 0, player.piece.type);
      }
    }
  }

  // top-out red haze
  if (player.topOut) {
    const topGrad = ctx.createLinearGradient(0, 0, 0, h);
    topGrad.addColorStop(0, 'rgba(255,20,60,0.28)');
    topGrad.addColorStop(0.5, 'rgba(255,20,60,0.12)');
    topGrad.addColorStop(1, 'rgba(255,20,60,0.28)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff1744';
    ctx.font = `bold ${Math.round(cell * 1.5)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(255,23,68,0.8)';
    ctx.shadowBlur = 16;
    ctx.fillText('GAME', w / 2, h / 2 - cell * 0.8);
    ctx.fillText('OVER', w / 2, h / 2 + cell * 0.8);
    ctx.shadowBlur = 0;
  }

  // Draw particles on top
  particles.update();
  particles.draw(ctx);
}

// ---- next / hold preview canvas ---------------------------------------

const previewCanvases = new Map();
const PREVIEW_MATRICES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]]
};

export function renderPreview(canvas, pieceType) {
  if (!canvas || !pieceType) return;
  let entry = previewCanvases.get(canvas);
  if (!entry || entry.cell === 0) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cell = Math.max(6, Math.floor(rect.width / 5));
    const px = cell * 5;
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    entry = { ctx, cell };
    previewCanvases.set(canvas, entry);
  }
  const { ctx, cell } = entry;
  const size = cell * 5;
  ctx.clearRect(0, 0, size, size);
  const colors = PIECE_COLORS[pieceType];
  const m = PREVIEW_MATRICES[pieceType];
  if (!m) return;
  let minC = 5, maxC = 0, minR = 5, maxR = 0;
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
    }
  }
  const ox = (size - (maxC - minC + 1) * cell) / 2 - minC * cell;
  const oy = (size - (maxR - minR + 1) * cell) / 2 - minR * cell;
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (!m[r][c]) continue;
      drawCell(ctx, (ox + c * cell) / cell, (oy + r * cell) / cell, cell, colors ? colors.base : '#888', 0, pieceType);
    }
  }
}

export function renderSidePanel(controller) {
  if (!controller || !controller.players[0]) return;
  const p = controller.players[0];
  // Hold piece
  const holdCanvas = $('hold-canvas');
  if (holdCanvas && p.hold) renderPreview(holdCanvas, p.hold.type);
  else if (holdCanvas) { const ctx = holdCanvas.getContext('2d'); ctx.clearRect(0, 0, holdCanvas.width, holdCanvas.height); }
  // Next piece
  const nextCanvas = $('next-canvas');
  if (nextCanvas && p.queue[0]) renderPreview(nextCanvas, p.queue[0].type);
  else if (nextCanvas) { const ctx = nextCanvas.getContext('2d'); ctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height); }
}

// ---- HUD --------------------------------------------------------------

export function buildArena(playerCount, parentEl) {
  parentEl.innerHTML = '';
  const arena = el('div', 'arena');
  for (let i = 0; i < playerCount; i++) {
    const zone = el('div', 'pzone');
    zone.id = `pzone-${i}`;
    const head = el('div', `pzone-head p${i + 1}`, `PLAYER ${i + 1}`);
    zone.appendChild(head);

    const wrap = el('div', `board-wrap p${i + 1}`);
    wrap.id = `board-wrap-${i}`;
    const canvas = el('canvas');
    canvas.id = `board-canvas-${i}`;
    wrap.appendChild(canvas);
    zone.appendChild(wrap);

    const stats = el('div', 'pzone-stats');
    stats.innerHTML = `
      <div class="stat"><span class="stat-label">SCORE</span><span class="stat-value score-val" id="score-${i}">000000</span></div>
      <div class="stat"><span class="stat-label">LINES</span><span class="stat-value lines-val" id="lines-${i}">0</span></div>
      <div class="stat"><span class="stat-label">LEVEL</span><span class="stat-value level-val" id="level-${i}">1</span></div>
    `;
    zone.appendChild(stats);
    arena.appendChild(zone);
  }
  parentEl.appendChild(arena);
  return arena;
}

export function updateArenaHud(controller) {
  for (let i = 0; i < controller.players.length; i++) {
    const p = controller.players[i];
    const scoreEl = $(`score-${i}`);
    const linesEl = $(`lines-${i}`);
    const levelEl = $(`level-${i}`);
    if (scoreEl) {
      const newScore = formatScore(p.score);
      if (scoreEl.textContent !== newScore) {
        scoreEl.textContent = newScore;
        scoreEl.classList.add('pop');
        setTimeout(() => scoreEl.classList.remove('pop'), 120);
      }
    }
    if (linesEl) linesEl.textContent = p.lines;
    if (levelEl) levelEl.textContent = p.level;
  }
}

export function setTopBar(mode, difficultyLabel) {
  const bar = $("game-topbar");
  if (!bar) return;
  bar.innerHTML = `<div class="topbar-left"><span style="font-family:var(--font-pixel);font-size:10px;color:var(--cyan);letter-spacing:1px">${mode === "solo" ? "SOLO" : "MULTIPLAYER"}</span><span class="diff-badge" style="font-size:8px">${difficultyLabel || ""}</span></div><div class="topbar-right"><button class="topbar-btn" type="button" data-action="pause">PAUSE</button></div>`;
}

export function resetCanvasSizes() {
  canvases.clear();
}

// ---- overlays ---------------------------------------------------------

export function showOverlay(id) {
  const ov = $(id);
  if (ov) ov.classList.add('open');
}

export function hideOverlay(id) {
  const ov = $(id);
  if (ov) ov.classList.remove('open');
}

export function showCountdown(num, cb) {
  const ov = $('overlay-countdown');
  const numEl = $('countdown-num');
  if (!ov || !numEl) { if (cb) cb(); return; }
  ov.classList.add('open');
  let n = num;
  numEl.textContent = n;
  numEl.classList.remove('go');
  const iv = setInterval(() => {
    n--;
    if (n > 0) {
      numEl.textContent = n;
    } else if (n === 0) {
      numEl.textContent = 'GO!';
      numEl.classList.add('go');
    } else {
      clearInterval(iv);
      ov.classList.remove('open');
      if (cb) cb();
    }
  }, 700);
}

export function showGameOver(score, lines, level, isNew, cb) {
  $('gameover-score').textContent = formatScore(score);
  $('gameover-lines').textContent = lines;
  $('gameover-level').textContent = level;
  const bestEl = $('gameover-newbest');
  if (isNew) {
    bestEl.classList.add('show');
  } else {
    bestEl.classList.remove('show');
  }
  const nameRow = $('gameover-name-row');
  if (isNew && nameRow) {
    nameRow.classList.remove('hidden');
    $('gameover-name').value = '';
    $('gameover-name').focus();
  } else if (nameRow) {
    nameRow.classList.add('hidden');
  }
  showOverlay('overlay-gameover');
}

export function showVictory(ranked) {
  const list = $('victory-list');
  list.innerHTML = '';
  ranked.forEach((p, i) => {
    const row = el('div', `vrow ${i === 0 ? 'winner' : ''}`);
    row.innerHTML = `
      <span class="vrank">#${i + 1}</span>
      <span class="vname">${p.name}</span>
      <span class="vscore">${formatScore(p.score)}</span>
      <span class="vlines">${p.lines} L</span>
    `;
    list.appendChild(row);
  });
  $('victory-title').textContent = ranked[0] ? `${ranked[0].name} WINS!` : 'WINNER!';
  showOverlay('overlay-victory');
}

export function showToast(text) {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('open');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('open'), 2200);
}

// ---- scores screen ----------------------------------------------------

function renderScoreRows(scores) {
  const tbody = $('scores-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!scores.length) {
    const row = el('tr');
    row.appendChild(Object.assign(el('td'), { colSpan: 4, textContent: 'NO SCORES YET' }));
    tbody.appendChild(row);
    return;
  }
  scores.slice(0, 10).forEach((s, i) => {
    const row = el('tr');
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${(s.name || 'PLAYER').toUpperCase()}</td>
      <td>${formatScore(s.score || 0)}</td>
      <td>${s.lines || 0}</td>
    `;
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
    ['rotate', 'ROTATE'],
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

export function setAudioRefs(a) {
  audioRefs = a;
}
let audioRefs = null;
