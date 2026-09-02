// JEMZ TETRIS — app entry: screens, input, game lifecycle, online, persistence.
// ENHANCED: particles, screen shake, combo popups, visual effects.

import { GameController } from './multiplayer.js';
import { audio } from './audio.js';
import { Online2P } from './online.js';
import { PIECE_COLORS } from './pieces.js';
import {
  loadSettings, saveSettings, loadScores, submitScore, scoreQualifies,
  loadStats, saveStats, clearAllData
} from './storage.js';
import { submitToLeaderboard } from './leaderboard.js';
import { onAuthChange, signUpEmail, signInEmail, signInGoogle, signOutUser, getCurrentUser } from './auth.js';
import { DIFFICULTIES } from './scoring.js';
import {
  $, showScreen, updateArenaHud, setTopBar, showOverlay, hideOverlay,
  showCountdown, showGameOver, showVictory, showToast, renderScores,
  buildControlsTable, prettyKey, updateTouchpad, touchTarget, setAudioRefs,
  resetCanvasSizes, renderAccountUI, setAccountStatus,
  particles, screenShake, showComboPopup, showScoreFloat
} from './ui.js';

// ---------------------------------------------------------------- state

const settings = loadSettings();
const online = new Online2P();
let controller = null;
let currentMode = 'solo';
let gameDifficulty = settings.difficulty;
let scoreSaved = false;
let lastGameStats = null;
let onlineMatch = false;
let recordingRemap = null;
let lastFrameSent = 0;

const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
document.body.classList.toggle('is-touch', IS_TOUCH);
document.body.classList.toggle('no-touch', !IS_TOUCH);

audio.setVolume(settings.volume);
audio.setSound(settings.sound);
audio.setMusic(settings.music);
setAudioRefs(audio);

// ---------------------------------------------------------------- board fit

function fitBoard() {
  const screenGame = $('screen-game');
  if (!screenGame || !screenGame.classList.contains('active')) return;
  const arena = $('arena');
  const topbar = $('game-topbar');
  const touchpad = $('touchpad');
  const zones = arena.querySelectorAll('.pzone');
  if (!zones.length) return;

  const touchpadVisible = !touchpad.classList.contains('hidden');
  const gcs = getComputedStyle(screenGame);
  const gap = parseFloat(gcs.rowGap) || parseFloat(gcs.gap) || 0;
  const padTop = parseFloat(gcs.paddingTop) || 0;
  const padBottom = parseFloat(gcs.paddingBottom) || 0;

  const reserved = padTop + padBottom
    + topbar.offsetHeight
    + (touchpadVisible ? touchpad.offsetHeight : 0)
    + gap * (touchpadVisible ? 2 : 1);

  const viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const availH = Math.max(120, viewportH - reserved);

  const sidePanel = arena.querySelector('.side-panel');
  const sideStacked = sidePanel && getComputedStyle(sidePanel).flexDirection === 'row';
  const sideExtraH = sidePanel && sideStacked ? sidePanel.offsetHeight + 10 : 0;
  const sideExtraW = sidePanel && !sideStacked ? sidePanel.offsetWidth + 14 : 0;

  const firstZone = zones[0];
  const zoneHead = firstZone.querySelector('.pzone-head');
  const zoneStats = firstZone.querySelector('.pzone-stats');
  const zoneChrome = (zoneHead ? zoneHead.offsetHeight : 0)
    + (zoneStats ? zoneStats.offsetHeight : 0)
    + 14;

  const boardAvailH = Math.max(100, availH - sideExtraH - zoneChrome);
  const arenaW = arena.clientWidth - sideExtraW;
  const cols = zones.length;
  const gapTotal = 14 * Math.max(0, cols - 1);
  const perBoardW = Math.max(60, (arenaW - gapTotal) / cols);

  const widthFromHeight = boardAvailH / 2;
  const boardW = Math.floor(Math.min(perBoardW, widthFromHeight));

  zones.forEach((z) => { z.style.maxWidth = `${boardW}px`; });

  if (sidePanel) {
    if (!sideStacked) {
      const zoneTotalH = zoneChrome + boardW * 2;
      sidePanel.style.maxHeight = `${zoneTotalH}px`;
      sidePanel.style.overflowY = 'auto';
    } else {
      sidePanel.style.maxHeight = '';
      sidePanel.style.overflowY = '';
    }
  }

  resetCanvasSizes();
  if (controller) updateArenaHud(controller);
}

// ---------------------------------------------------------------- arena builder (DOM)

function buildArenaDOM(playerCount, mode) {
  const parentEl = $('arena');
  parentEl.innerHTML = '';
  const arena = document.createElement('div');
  arena.className = 'arena';
  for (let i = 0; i < playerCount; i++) {
    const zone = document.createElement('div');
    zone.className = 'pzone';
    zone.id = `pzone-${i}`;
    const head = document.createElement('div');
    head.className = `pzone-head p${i + 1}`;
    head.textContent = `PLAYER ${i + 1}`;
    zone.appendChild(head);

    const wrap = document.createElement('div');
    wrap.className = `board-wrap p${i + 1}`;
    wrap.id = `board-wrap-${i}`;
    const canvas = document.createElement('canvas');
    canvas.id = `board-canvas-${i}`;
    wrap.appendChild(canvas);
    zone.appendChild(wrap);

    const stats = document.createElement('div');
    stats.className = 'pzone-stats';
    stats.innerHTML = `
      <div class="stat"><span class="stat-label">SCORE</span><span class="stat-value score-val" id="score-${i}">000000</span></div>
      <div class="stat"><span class="stat-label">LINES</span><span class="stat-value lines-val" id="lines-${i}">0</span></div>
      <div class="stat"><span class="stat-label">LEVEL</span><span class="stat-value level-val" id="level-${i}">1</span></div>
    `;
    zone.appendChild(stats);
    arena.appendChild(zone);
  }
  // Side panel for hold/next (solo mode only)
  if (playerCount === 1) {
    const side = document.createElement('div');
    side.className = 'side-panel';
    // Hold panel
    const holdPanel = document.createElement('div');
    holdPanel.className = 'mini-panel';
    holdPanel.innerHTML = '<div class="mini-label">HOLD</div>';
    const holdCanvas = document.createElement('canvas');
    holdCanvas.id = 'hold-canvas';
    holdCanvas.width = 120;
    holdCanvas.height = 120;
    holdPanel.appendChild(holdCanvas);
    side.appendChild(holdPanel);
    // Next panel
    const nextPanel = document.createElement('div');
    nextPanel.className = 'mini-panel';
    nextPanel.innerHTML = '<div class="mini-label">NEXT</div>';
    const nextCanvas = document.createElement('canvas');
    nextCanvas.id = 'next-canvas';
    nextCanvas.width = 120;
    nextCanvas.height = 120;
    nextPanel.appendChild(nextCanvas);
    side.appendChild(nextPanel);
    arena.appendChild(side);
  }
  parentEl.appendChild(arena);
  return arena;
}

// ---------------------------------------------------------------- audio + FX wiring

function wirePlayerAudio(p) {
  p.on('move', () => audio.move());
  p.on('rotate', () => audio.rotate());
  p.on('softdrop', () => audio.softdrop());
  p.on('hold', () => audio.hold());
  p.on('blocked', () => audio.blocked());

  p.on('harddrop', (d) => {
    audio.harddrop();
    // Hard drop particles + trail
    const canvas = $(`board-canvas-${p.id}`);
    const boardWrap = $(`board-wrap-${p.id}`);
    if (canvas && p.piece) {
      const rect = canvas.getBoundingClientRect();
      const cell = Math.max(6, Math.floor(rect.width / 10));
      const color = p.piece.type;
      if (d && d.dist > 2) {
        particles.emitHardDropTrail(p.piece.y, p.piece.y + d.dist, p.piece.x, cell, color);
      }
      // Impact particles
      const cx = p.piece.x * cell + cell / 2;
      const cy = (p.piece.y + 2) * cell + cell / 2;
      const pColors = PIECE_COLORS[color];
      if (pColors) {
        particles.emit(cx, cy, 12, pColors.light, { speedMin: 1, speedMax: 4, lifeMin: 10, lifeMax: 25, type: 'spark', gravity: 0.05 });
        particles.emit(cx, cy, 6, pColors.glow, { speedMin: 0.5, speedMax: 2, lifeMin: 15, lifeMax: 30, type: 'glow', gravity: 0.02 });
      }
    }
    // Screen shake
    if (boardWrap && d && d.dist > 3) {
      screenShake(boardWrap, d.dist > 8 ? 'big' : 'normal');
    }
  });

  p.on('lock', (d) => {
    if (!d.lines) audio.land();
    // Lock particles on each cell of the locked piece
    const canvas = $(`board-canvas-${p.id}`);
    if (canvas && p.piece) {
      const rect = canvas.getBoundingClientRect();
      const cell = Math.max(6, Math.floor(rect.width / 10));
      const m = p.piece.matrix;
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (!m[r][c]) continue;
          const px = p.piece.x + c;
          const py = p.piece.y + r - 2; // offset for HIDDEN rows
          if (py >= 0 && py < 20) {
            particles.emitLock(px, py, cell, p.piece.type);
          }
        }
      }
    }
  });

  p.on('clear', (d) => {
    audio.clear(d.count);
    if (p.id === 0) audio.voiceCombo(d.count);

    const boardWrap = $(`board-wrap-${p.id}`);
    const canvas = $(`board-canvas-${p.id}`);

    // Clear particles on each cleared row
    if (canvas && d.count > 0) {
      const rect = canvas.getBoundingClientRect();
      const cell = Math.max(6, Math.floor(rect.width / 10));
      const board = p.board;
      const clearedRows = board.clearing || [];
      const isTetris = d.count >= 4;
      for (const row of clearedRows) {
        particles.emitClear(row - 2, cell, row, isTetris);
      }
    }

    // Screen shake on line clears
    if (boardWrap) {
      screenShake(boardWrap, d.count >= 4 ? 'big' : 'normal');
    }

    // Flash overlay on board
    if (boardWrap) {
      const flash = document.createElement('div');
      flash.className = d.count >= 4 ? 'clear-flash tetris-flash' : 'clear-flash';
      boardWrap.appendChild(flash);
      setTimeout(() => flash.remove(), 400);
    }

    // Score float
    if (boardWrap && d.gained > 0) {
      showScoreFloat(boardWrap, `+${d.gained}`);
    }
  });

  p.on('tetris', () => {
    audio.tetris();
    if (p.id === 0) audio.voiceTetris();
    // Tetris celebration particles
    const canvas = $(`board-canvas-${p.id}`);
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const cell = Math.max(6, Math.floor(rect.width / 10));
      particles.emitTetrisCelebration(cell);
    }
    // Big combo popup
    const boardWrap = $(`board-wrap-${p.id}`);
    if (boardWrap) {
      showComboPopup(boardWrap, 'TETRIS!', 'tetris');
      screenShake(boardWrap, 'big');
    }
  });

  p.on('combo', (d) => {
    audio.combo(d.count);
    if (p.id === 0 && d.count >= 3) audio.voiceComboCount(d.count);
    const boardWrap = $(`board-wrap-${p.id}`);
    if (boardWrap && d.count >= 2) {
      showComboPopup(boardWrap, `${d.count}x COMBO`, 'combo');
    }
  });

  p.on('tspin', (d) => {
    audio.tspin(d.lines);
    if (p.id === 0) audio.voiceTSpin(d.lines);
    const boardWrap = $(`board-wrap-${p.id}`);
    if (boardWrap) {
      const text = d.lines === 0 ? 'T-SPIN!' : d.lines === 1 ? 'T-SPIN SINGLE!' : d.lines === 2 ? 'T-SPIN DOUBLE!' : 'T-SPIN TRIPLE!';
      showComboPopup(boardWrap, text, 'tetris');
      screenShake(boardWrap, 'big');
    }
  });

  p.on('backtoback', () => {
    audio.backtoback();
    if (p.id === 0) audio.voiceBackToBack();
  });

  p.on('levelup', (d) => { audio.levelup(); if (p.id === 0) audio.voiceLevelUp(d.level); });
  p.on('topout', () => { audio.gameover(); if (p.id === 0) audio.voiceGameOver(); });
}

// ---------------------------------------------------------------- background

const bg = $('bg-canvas');
const bgCtx = bg.getContext('2d');
let bgStars = [];
let bgShapes = [];

const BASE_HUE = 258;
let scoreHue = BASE_HUE;

function updateColorTheme(score) {
  scoreHue = (BASE_HUE + (score || 0) / 18) % 360;
  document.documentElement.style.setProperty('--score-hue', scoreHue.toFixed(1));
}

function initBackground() {
  const resize = () => {
    bg.width = window.innerWidth;
    bg.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);
  bgStars = Array.from({ length: 120 }, () => ({
    x: Math.random() * bg.width,
    y: Math.random() * bg.height,
    r: Math.random() * 1.6 + 0.3,
    sp: Math.random() * 0.4 + 0.04,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: Math.random() * 0.02 + 0.005
  }));
  const types = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  bgShapes = Array.from({ length: 16 }, () => ({
    type: types[Math.floor(Math.random() * types.length)],
    x: Math.random() * bg.width,
    y: Math.random() * bg.height,
    sp: Math.random() * 0.25 + 0.05,
    rot: Math.random() * Math.PI * 2,
    size: 14 + Math.random() * 28
  }));
}

function drawBackground() {
  bgCtx.clearRect(0, 0, bg.width, bg.height);
  const grad = bgCtx.createLinearGradient(0, 0, 0, bg.height);
  grad.addColorStop(0, `hsl(${scoreHue}, 58%, 7%)`);
  grad.addColorStop(0.5, `hsl(${(scoreHue + 12) % 360}, 50%, 4%)`);
  grad.addColorStop(1, `hsl(${(scoreHue + 18) % 360}, 62%, 3%)`);
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, bg.width, bg.height);

  // Twinkling stars
  for (const s of bgStars) {
    s.y -= s.sp;
    s.twinkle += s.twinkleSpeed;
    if (s.y < 0) { s.y = bg.height; s.x = Math.random() * bg.width; }
    const alpha = 0.15 + Math.abs(Math.sin(s.twinkle)) * 0.35;
    bgCtx.fillStyle = `rgba(234,230,255,${alpha})`;
    bgCtx.beginPath();
    bgCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    bgCtx.fill();
  }

  const colors = {
    I: '#00f0ff', O: '#ffd740', T: '#e040fb', S: '#00e676',
    Z: '#ff1744', J: '#448aff', L: '#ff9100'
  };
  for (const sh of bgShapes) {
    sh.y -= sh.sp;
    sh.rot += 0.002;
    if (sh.y < -80) { sh.y = bg.height + 40; sh.x = Math.random() * bg.width; }
    bgCtx.save();
    bgCtx.translate(sh.x, sh.y);
    bgCtx.rotate(sh.rot);
    bgCtx.globalAlpha = 0.08;
    bgCtx.fillStyle = colors[sh.type];
    const s = sh.size;
    const cells = {
      I: [[1, 0], [1, 1], [1, 2], [1, 3]],
      O: [[0, 0], [0, 1], [1, 0], [1, 1]],
      T: [[0, 1], [1, 0], [1, 1], [1, 2]],
      S: [[0, 1], [0, 2], [1, 0], [1, 1]],
      Z: [[0, 0], [0, 1], [1, 1], [1, 2]],
      J: [[0, 0], [1, 0], [1, 1], [1, 2]],
      L: [[0, 2], [1, 0], [1, 1], [1, 2]]
    }[sh.type];
    for (const [r, c] of cells) {
      bgCtx.fillRect(c * s, r * s, s - 2, s - 2);
    }
    bgCtx.restore();
  }
  requestAnimationFrame(drawBackground);
}

// ---------------------------------------------------------------- navigation

function goMenu() {
  updateColorTheme(0);
  hideOverlay('pause');
  hideOverlay('gameover');
  hideOverlay('victory');
  hideOverlay('online');
  hideOverlay('countdown');
  showScreen('menu');
  updateMenuBadges();
}

function updateMenuBadges() {
  const d = $('menu-difficulty');
  if (d) d.textContent = DIFFICULTIES[gameDifficulty].label;
  const s = $('menu-sound');
  if (s) s.textContent = settings.sound ? 'ON' : 'OFF';
  const m = $('menu-music');
  if (m) m.textContent = settings.music ? 'ON' : 'OFF';
}

function syncSettingsUI() {
  const setToggle = (id, val) => {
    const b = $(id);
    b.textContent = val ? 'ON' : 'OFF';
    b.classList.toggle('off', !val);
  };
  setToggle('set-sound', settings.sound);
  setToggle('set-music', settings.music);
  setToggle('set-crt', settings.crt);
  $('set-volume').value = Math.round(settings.volume * 100);
  $('volume-value').textContent = `${Math.round(settings.volume * 100)}%`;
  $('set-name').value = settings.playerName;
  document.getElementById('crt').classList.toggle('on', settings.crt);
  buildControlsTable($('controls-table'), settings.controls, onRemap);
  buildHowtoControls();
  renderScores();
  document.querySelectorAll('.diff-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.difficulty === gameDifficulty);
  });
}

function buildHowtoControls() {
  const wrap = $('howto-controls');
  wrap.innerHTML = '';
  buildControlsTable(wrap, settings.controls, () => {});
}

function startVsBot(difficulty) {
  startGame(2, { bot: true, difficulty: difficulty || settings.difficulty, name: settings.playerName || 'YOU' });
}

function copyOnlineCode() {
  const raw = $('online-code').textContent.replace('CODE: ', '').trim();
  if (!raw || raw === '—') { showToast('CREATE A ROOM FIRST TO GET A CODE'); return; }
  const done = () => showToast(`CODE COPIED: ${raw}`);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(raw).then(done).catch(() => fallbackCopy(raw, done));
  } else {
    fallbackCopy(raw, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { }
  document.body.removeChild(ta);
  if (ok) done();
  else showToast('COULD NOT COPY — TYPE THE CODE MANUALLY');
}

// ---------------------------------------------------------------- game lifecycle

let lastStartArgs = { count: 1, opts: {} };

function startGame(playerCount, opts = {}) {
  lastStartArgs = { count: playerCount, opts };
  onlineMatch = !!opts.online;
  const botMatch = !!opts.bot;
  currentMode = playerCount === 1 ? 'solo' : (botMatch ? 'bot' : String(playerCount));
  gameDifficulty = opts.difficulty || settings.difficulty;
  scoreSaved = false;
  updateColorTheme(0);
  particles.clear();

  if (controller) controller.quit();

  const names = [];
  for (let i = 0; i < playerCount; i++) {
    if (i === 0) names.push(opts.name || settings.playerName || 'P1');
    else if (opts.online) names.push(opts.rivalName || 'RIVAL');
    else if (botMatch) names.push(`BOT · ${DIFFICULTIES[gameDifficulty].label}`);
    else names.push(`P${i + 1}`);
  }

  controller = new GameController({
    playerCount,
    difficulty: gameDifficulty,
    names,
    remotePlayers: opts.online ? [1] : [],
    botPlayers: botMatch ? [1] : [],
    onEvent: (ev, data) => {
      if (ev === 'frame') {
        updateArenaHud(controller);
        updateColorTheme(controller.players[0] ? controller.players[0].score : 0);
        // Render all player canvases
        for (let i = 0; i < controller.players.length; i++) {
          const cv = $(`board-canvas-${i}`);
          if (cv) renderPlayer(controller.players[i], cv);
        }
        // Render side panel (hold/next)
        renderSidePanel(controller);
      }
      if (ev === 'over') handleRoundOver(data);
    },
    onFrame: (dt) => {
      if (opts.online) sendOnlineFrame(dt);
    }
  });

  controller.players.forEach(wirePlayerAudio);

  buildArenaDOM(playerCount, currentMode);
  setTopBar(currentMode === 'solo' ? 'solo' : currentMode, DIFFICULTIES[gameDifficulty].label);
  updateTouchpad(controller);
  if (IS_TOUCH) $('touchpad').classList.remove('hidden');
  else $('touchpad').classList.add('hidden');

  showScreen('game');
  fitBoard();
  hideOverlay('pause');
  hideOverlay('gameover');
  hideOverlay('victory');
  hideOverlay('online');
  hideOverlay('countdown');

  resetCanvasSizes();
  updateArenaHud(controller);

  controller.start();

  if (playerCount > 1) {
    controller.pause();
    showCountdown(() => controller.resume());
  }
}

function quitGame() {
  if (controller) controller.quit();
  controller = null;
  if (onlineMatch) online.close();
  onlineMatch = false;
  hideOverlay('pause');
  hideOverlay('gameover');
  hideOverlay('victory');
  goMenu();
}

function handleRoundOver(data) {
  const stats = loadStats();
  const p0 = controller.players[0];
  let totalPieces = 0, totalLines = 0, totalTetrises = 0;
  controller.players.forEach((p) => {
    totalPieces += p.pieces;
    totalLines += p.lines;
    totalTetrises += p.tetrises;
  });
  lastGameStats = {
    games: stats.games + 1,
    pieces: stats.pieces + totalPieces,
    lines: stats.lines + totalLines,
    tetrises: stats.tetrises + totalTetrises,
    bestScore: Math.max(stats.bestScore, p0.score),
    bestLines: Math.max(stats.bestLines, p0.lines),
    multiplayerWins: stats.multiplayerWins + (currentMode !== 'solo' && data.ranked[0].id === 0 ? 1 : 0),
    lastDifficulty: gameDifficulty,
    lastMode: currentMode
  };
  saveStats(lastGameStats);

  if (currentMode === 'solo' && !onlineMatch) {
    audio.gameover();
    const isBest = p0.score > stats.bestScore && p0.score > 0;
    const qualifies = scoreQualifies(p0.score);
    $('gameover-newbest').textContent = isBest ? 'NEW HIGH SCORE!' : '';
    if (isBest) audio.highscore();
    showGameOver(p0.score, p0.lines, p0.level, isBest);
    return;
  }

  audio.victory();
  const winner = data.ranked[0];
  if (winner && winner.score > 0 && scoreQualifies(winner.score)) {
    submitScore({
      name: winner.name,
      score: winner.score,
      lines: winner.lines,
      difficulty: gameDifficulty,
      mode: currentMode
    });
  }
  if (!onlineMatch) {
    data.ranked.forEach((p) => {
      if (p.score > 0) {
        submitToLeaderboard({
          name: p.name,
          uid: p.id === 0 ? (getCurrentUser() && getCurrentUser().uid) : null,
          score: p.score,
          lines: p.lines,
          difficulty: gameDifficulty,
          mode: currentMode
        });
      }
    });
  } else {
    const me = data.ranked.find((p) => p.id === 0);
    if (me && me.score > 0) {
      submitToLeaderboard({
        name: me.name,
        uid: getCurrentUser() && getCurrentUser().uid,
        score: me.score,
        lines: me.lines,
        difficulty: gameDifficulty,
        mode: 'online'
      });
    }
  }
  showVictory(data.ranked);
  const againBtn = $('overlay-victory').querySelector('[data-action="again"]');
  if (againBtn) againBtn.classList.toggle('hidden', onlineMatch);
}

function saveScoreFromOverlay() {
  if (scoreSaved || !controller) return;
  const name = ($('gameover-name').value || settings.playerName || 'PLAYER').toUpperCase().slice(0, 12);
  const p = controller.players[0];
  const entry = submitScore({ name, score: p.score, lines: p.lines, difficulty: gameDifficulty, mode: 'solo' });
  submitToLeaderboard({
    name,
    uid: getCurrentUser() && getCurrentUser().uid,
    score: p.score,
    lines: p.lines,
    difficulty: gameDifficulty,
    mode: 'solo'
  });
  if (entry) {
    scoreSaved = true;
    showToast('SCORE SAVED!');
    audio.click();
  }
  $('gameover-name-row').classList.add('hidden');
}

// ---------------------------------------------------------------- input

const ACTION_KEYS = ['left', 'right', 'rotate', 'softdrop', 'harddrop', 'hold'];

function playerForCode(code) {
  for (let i = 0; i < 4; i++) {
    const map = settings.controls[`p${i}`];
    for (const action of ACTION_KEYS) {
      if (map[action] === code) return { i, action };
    }
  }
  return null;
}

window.addEventListener('keydown', (e) => {
  audio.unlock();
  if (recordingRemap) {
    if (e.code !== 'Escape' && !e.code.startsWith('Meta')) {
      const { btn, p, action } = recordingRemap;
      settings.controls[`p${p}`][action] = e.code;
      saveSettings(settings);
      buildControlsTable($('controls-table'), settings.controls, onRemap);
      showToast(`P${p + 1} ${action.toUpperCase()} → ${prettyKey(e.code)}`);
      recordingRemap = null;
    }
    e.preventDefault();
    return;
  }

  if (e.code === 'Escape') {
    const ov = document.querySelector('.overlay.open');
    if (ov && ov.id === 'overlay-pause') {
      togglePause();
      return;
    }
    if (ov) return;
  }

  const inGame = $('screen-game').classList.contains('active');
  if (!inGame || !controller) return;

  if (e.code === 'KeyP' || e.code === 'Escape') {
    togglePause();
    e.preventDefault();
    return;
  }

  const hit = playerForCode(e.code);
  if (hit) {
    e.preventDefault();
    controller.press(hit.i, hit.action);
  }
});

window.addEventListener('keyup', (e) => {
  const hit = playerForCode(e.code);
  if (hit) controller && controller.release(hit.i, hit.action);
});

function togglePause() {
  if (!controller || controller.ended || controller.players.some((p) => p.topOut)) return;
  if (controller.paused) {
    hideOverlay('pause');
    controller.resume();
    audio.click();
  } else {
    controller.pause();
    showOverlay('pause');
    audio.pause();
  }
}

// ---------------------------------------------------------------- touch pad

function bindTouchpad() {
  const pad = $('touchpad');
  const target = () => (controller && controller.playerCount > 1 ? touchTarget : 0);
  pad.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.tbtn');
    if (!btn) return;
    e.preventDefault();
    audio.unlock();
    const action = btn.dataset.touch;
    if (action === 'pause') { togglePause(); return; }
    if (action === 'left' || action === 'right') {
      controller && controller.press(target(), action);
      const up = () => {
        controller && controller.release(target(), action);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    } else {
      controller && controller.press(target(), action);
    }
  });
}

// ---------------------------------------------------------------- online

function openOnlineLobby() {
  if (!online.supported()) {
    showToast('ONLINE NEEDS INTERNET — PEERJS SCRIPT BLOCKED');
    return;
  }
  $('online-status').textContent = 'READY — CREATE OR JOIN A ROOM';
  $('online-lobby').classList.remove('hidden');
  $('online-lobby').classList.remove('room-created', 'joining');
  $('online-start').classList.add('hidden');
  $('online-code').textContent = 'CODE: —';
  showOverlay('online');
  audio.click();
}

function startOnlineMatch(difficulty) {
  hideOverlay('online');
  startGame(2, { online: true, difficulty, name: online.myName, rivalName: online.rivalName });
}

function sendOnlineFrame() {
  if (!online.connected || !controller || controller.ended) return;
  const now = performance.now();
  if (now - lastFrameSent < 120) return;
  lastFrameSent = now;
  const p = controller.players[0];
  online.send('frame', {
    score: p.score,
    lines: p.lines,
    level: p.level,
    snapshot: p.board.snapshot(),
    topOut: p.topOut
  });
}

online.on('code', (code) => {
  $('online-code').textContent = `CODE: ${code.toUpperCase()}`;
  $('online-status').textContent = 'SHARE THIS CODE — WAITING FOR RIVAL…';
  $('online-lobby').classList.add('room-created');
});

online.on('connected', () => {
  $('online-lobby').classList.add('hidden');
  $('online-status').textContent = 'CONNECTED — SYNCING…';
});

online.on('peer', () => {
  $('online-status').textContent = `CONNECTED — ${online.rivalName} IS READY`;
  $('online-start').classList.remove('hidden');
  audio.click();
});

online.on('message', (msg) => {
  if (!msg.type) return;
  if (msg.type === 'start') {
    const difficulty = msg.data && msg.data.difficulty ? msg.data.difficulty : settings.difficulty;
    startOnlineMatch(difficulty);
  } else if (msg.type === 'frame' && controller && onlineMatch) {
    controller.applyRemoteFrame(1, msg.data || {});
  } else if (msg.type === 'over') {
    if (controller && onlineMatch) controller.applyRemoteFrame(1, { topOut: true });
  }
});

online.on('close', () => {
  $('online-start').classList.add('hidden');
  if (controller && onlineMatch && !controller.ended) {
    showToast('RIVAL DISCONNECTED — YOU WIN');
    controller.applyRemoteFrame(1, { topOut: true });
  } else if (!$('screen-game').classList.contains('active')) {
    $('online-status').textContent = 'CONNECTION LOST';
  }
});

online.on('error', (err) => {
  if (!online.connected) {
    $('online-status').textContent = 'CONNECTION FAILED — TRY AGAIN';
    showToast('COULD NOT CONNECT TO PEERJS');
  }
});

// ---------------------------------------------------------------- account

onAuthChange((user) => {
  renderAccountUI(user);
  if (user) {
    const name = (user.displayName || user.email || 'PLAYER').toUpperCase().slice(0, 12);
    settings.playerName = name;
    saveSettings(settings);
    const nameInput = $('set-name');
    if (nameInput) nameInput.value = name;
    setAccountStatus('');
  }
});

async function handleSignIn() {
  const email = ($('acct-email').value || '').trim();
  const password = $('acct-password').value || '';
  if (!email || !password) { setAccountStatus('ENTER EMAIL AND PASSWORD'); return; }
  setAccountStatus('SIGNING IN…');
  const res = await signInEmail(email, password);
  if (!res.ok) { setAccountStatus(res.error); return; }
  showToast('SIGNED IN!');
  audio.click();
}

async function handleSignUp() {
  const email = ($('acct-email').value || '').trim();
  const password = $('acct-password').value || '';
  if (!email || !password) { setAccountStatus('ENTER EMAIL AND PASSWORD'); return; }
  const name = settings.playerName || 'PLAYER';
  setAccountStatus('CREATING ACCOUNT…');
  const res = await signUpEmail(email, password, name);
  if (!res.ok) { setAccountStatus(res.error); return; }
  showToast('ACCOUNT CREATED!');
  audio.click();
}

async function handleGoogleSignIn() {
  setAccountStatus('OPENING GOOGLE SIGN-IN…');
  const res = await signInGoogle();
  if (!res.ok) setAccountStatus(res.error);
}

async function handleSignOut() {
  await signOutUser();
  showToast('SIGNED OUT');
  audio.click();
}

// ---------------------------------------------------------------- menu wiring

function wireMenu() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    audio.unlock();
    audio.click();
    if (action === 'menu') goMenu();
    else if (action === 'play') startGame(parseInt(el.dataset.players, 10));
    else if (action === 'difficulty') showScreen('difficulty');
    else if (action === 'scores') { renderScores(); showScreen('scores'); }
    else if (action === 'settings') { syncSettingsUI(); showScreen('settings'); }
    else if (action === 'howto') { buildHowtoControls(); showScreen('howto'); }
    else if (action === 'vsbot') showScreen('vsbot');
    else if (action === 'vsbot-start') startVsBot(el.dataset.difficulty);
    else if (action === 'online') openOnlineLobby();
    else if (action === 'online-copy') copyOnlineCode();
    else if (action === 'pause') togglePause();
    else if (action === 'resume') { hideOverlay('pause'); controller && controller.resume(); audio.click(); }
    else if (action === 'restart') { hideOverlay('pause'); startGame(lastStartArgs.count, lastStartArgs.opts); }
    else if (action === 'again') { hideOverlay('gameover'); hideOverlay('victory'); startGame(lastStartArgs.count, lastStartArgs.opts); }
    else if (action === 'quit') quitGame();
    else if (action === 'save-score') saveScoreFromOverlay();
    else if (action === 'online-create') {
      if (!online.supported()) { showToast('ONLINE NEEDS INTERNET'); return; }
      const ok = online.createRoom($('online-name').value || settings.playerName || 'P1');
      if (!ok) showToast('PEERJS NOT AVAILABLE');
      else $('online-status').textContent = 'CREATING ROOM…';
    }
    else if (action === 'online-join') {
      if (!online.supported()) { showToast('ONLINE NEEDS INTERNET'); return; }
      const code = $('online-join-code').value;
      if (!code.trim()) { showToast('ENTER A ROOM CODE'); return; }
      const ok = online.joinRoom(code, $('online-name').value || settings.playerName || 'P2');
      if (!ok) showToast('PEERJS NOT AVAILABLE');
      else {
        $('online-status').textContent = 'CONNECTING TO ROOM…';
        $('online-lobby').classList.add('joining');
      }
    }
    else if (action === 'online-start') {
      online.send('start', { difficulty: gameDifficulty });
      startOnlineMatch(gameDifficulty);
    }
    else if (action === 'close-online') { online.close(); hideOverlay('online'); }
    else if (action === 'acct-signin') handleSignIn();
    else if (action === 'acct-signup') handleSignUp();
    else if (action === 'acct-google') handleGoogleSignIn();
    else if (action === 'acct-signout') handleSignOut();
  });

  document.querySelectorAll('.diff-card').forEach((card) => {
    card.addEventListener('click', () => {
      gameDifficulty = card.dataset.difficulty;
      settings.difficulty = gameDifficulty;
      saveSettings(settings);
      document.querySelectorAll('.diff-card').forEach((c) => c.classList.toggle('active', c === card));
      updateMenuBadges();
      audio.click();
      showToast(`DIFFICULTY: ${DIFFICULTIES[gameDifficulty].label}`);
    });
  });

  document.querySelectorAll('#score-filters .btn-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#score-filters .btn-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderScores(btn.dataset.filter || null);
      audio.click();
    });
  });

  $('set-sound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings(settings);
    audio.setSound(settings.sound);
    syncSettingsUI();
    updateMenuBadges();
    audio.click();
  });
  $('set-music').addEventListener('click', () => {
    settings.music = !settings.music;
    saveSettings(settings);
    audio.setMusic(settings.music);
    if (settings.music) audio.startMusic();
    syncSettingsUI();
    updateMenuBadges();
    audio.click();
  });
  $('set-crt').addEventListener('click', () => {
    settings.crt = !settings.crt;
    saveSettings(settings);
    syncSettingsUI();
    audio.click();
  });
  $('set-volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value) / 100;
    saveSettings(settings);
    audio.setVolume(settings.volume);
    $('volume-value').textContent = `${e.target.value}%`;
  });
  $('set-name').addEventListener('change', (e) => {
    settings.playerName = (e.target.value || 'PLAYER').toUpperCase().slice(0, 12);
    saveSettings(settings);
    showToast(`NAME SAVED: ${settings.playerName}`);
  });
  $('btn-reset-data').addEventListener('click', () => {
    if (confirm('Reset all saved data? This clears high scores, stats and settings.')) {
      clearAllData();
      location.reload();
    }
  });
}

function onRemap(btn, p, action) {
  audio.click();
  recordingRemap = { btn, p, action };
  document.querySelectorAll('.btn-key').forEach((b) => b.classList.remove('recording'));
  btn.classList.add('recording');
  showToast(`PRESS A KEY FOR P${p + 1} ${action.toUpperCase()}`);
}

// ---------------------------------------------------------------- init

function init() {
  initBackground();
  drawBackground();
  wireMenu();
  bindTouchpad();
  syncSettingsUI();
  updateMenuBadges();
  showScreen('menu');
  handleLaunchParams();

  window.addEventListener('resize', () => {
    fitBoard();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(fitBoard, 120);
  });
}

function handleLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  const target = params.get('screen');
  if (!target) return;
  if (target === 'play-solo') {
    startGame(1);
  } else if (target === 'scores') {
    renderScores();
    showScreen('scores');
  } else if (target === 'settings') {
    syncSettingsUI();
    showScreen('settings');
  }
  window.history.replaceState({}, '', window.location.pathname);
}

init();
