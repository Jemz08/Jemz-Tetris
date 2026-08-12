// JEMZ TETRIS — app entry: screens, input, game lifecycle, online, persistence.

import { GameController } from './multiplayer.js';
import { audio } from './audio.js';
import { Online2P } from './online.js';
import {
  loadSettings, saveSettings, loadScores, submitScore, scoreQualifies,
  loadStats, saveStats, clearAllData
} from './storage.js';
import { DIFFICULTIES } from './scoring.js';
import {
  $, showScreen, buildArena, updateArenaHud, setTopBar, showOverlay, hideOverlay,
  showCountdown, showGameOver, showVictory, showToast, renderScores,
  buildControlsTable, prettyKey, updateTouchpad, touchTarget, setAudioRefs,
  resetCanvasSizes
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

// Measures the real space left for the board(s) after the topbar, touchpad,
// and (for solo) the hold/next/high-score panel, then sets an exact pixel
// max-width on each .pzone so the board always fills the actual screen
// instead of being capped by a guessed static size.
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

  // Use the real viewport height (not the container's own box, which can
  // be inflated by its own not-yet-resized content) as the source of truth.
  const viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const availH = Math.max(120, viewportH - reserved);

  const sidePanel = arena.querySelector('.side-panel');
  const sideStacked = sidePanel && getComputedStyle(sidePanel).flexDirection === 'row';
  const sideExtraH = sidePanel && sideStacked ? sidePanel.offsetHeight + 10 : 0;
  const sideExtraW = sidePanel && !sideStacked ? sidePanel.offsetWidth + 14 : 0;

  // Each pzone also has its own header label and stats row stacked above/
  // below the board itself — subtract those or the board gets sized too tall.
  const firstZone = zones[0];
  const zoneHead = firstZone.querySelector('.pzone-head');
  const zoneStats = firstZone.querySelector('.pzone-stats');
  const zoneChrome = (zoneHead ? zoneHead.offsetHeight : 0)
    + (zoneStats ? zoneStats.offsetHeight : 0)
    + 14; // pzone's own internal gaps

  const boardAvailH = Math.max(100, availH - sideExtraH - zoneChrome);
  const arenaW = arena.clientWidth - sideExtraW;
  const cols = zones.length;
  const gapTotal = 14 * Math.max(0, cols - 1);
  const perBoardW = Math.max(60, (arenaW - gapTotal) / cols);

  // Board grid is 10 wide x 20 tall, so height = 2 x width.
  const widthFromHeight = boardAvailH / 2;
  const boardW = Math.floor(Math.min(perBoardW, widthFromHeight));

  zones.forEach((z) => { z.style.maxWidth = `${boardW}px`; });

  // When the side panel sits beside the board (column layout, not stacked
  // above it), cap its height to match the board's total height so it can
  // never make the arena taller than the board itself; let it scroll
  // internally in the rare case it doesn't all fit.
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

// ---------------------------------------------------------------- audio wiring

function wirePlayerAudio(p) {
  p.on('move', () => audio.move());
  p.on('rotate', () => audio.rotate());
  p.on('softdrop', () => audio.softdrop());
  p.on('hold', () => audio.hold());
  p.on('blocked', () => audio.blocked());
  p.on('harddrop', () => audio.harddrop());
  p.on('lock', (d) => { if (!d.lines) audio.land(); });
  p.on('clear', (d) => audio.clear(d.count));
  p.on('tetris', () => audio.tetris());
  p.on('levelup', () => audio.levelup());
  p.on('topout', () => audio.gameover());
}

// ---------------------------------------------------------------- background

const bg = $('bg-canvas');
const bgCtx = bg.getContext('2d');
let bgStars = [];
let bgShapes = [];

function initBackground() {
  const resize = () => {
    bg.width = window.innerWidth;
    bg.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);
  bgStars = Array.from({ length: 90 }, () => ({
    x: Math.random() * bg.width,
    y: Math.random() * bg.height,
    r: Math.random() * 1.4 + 0.4,
    sp: Math.random() * 0.35 + 0.05
  }));
  const types = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  bgShapes = Array.from({ length: 12 }, () => ({
    type: types[Math.floor(Math.random() * types.length)],
    x: Math.random() * bg.width,
    y: Math.random() * bg.height,
    sp: Math.random() * 0.22 + 0.06,
    rot: Math.random() * Math.PI * 2,
    size: 16 + Math.random() * 26
  }));
}

function drawBackground() {
  bgCtx.clearRect(0, 0, bg.width, bg.height);
  // deep gradient
  const grad = bgCtx.createLinearGradient(0, 0, 0, bg.height);
  grad.addColorStop(0, '#0d0720');
  grad.addColorStop(1, '#070310');
  bgCtx.fillStyle = grad;
  bgCtx.fillRect(0, 0, bg.width, bg.height);

  for (const s of bgStars) {
    s.y -= s.sp;
    if (s.y < 0) { s.y = bg.height; s.x = Math.random() * bg.width; }
    bgCtx.fillStyle = `rgba(234,230,255,${0.15 + Math.random() * 0.3})`;
    bgCtx.beginPath();
    bgCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    bgCtx.fill();
  }

  const colors = {
    I: '#00f0ff', O: '#ffd447', T: '#d142f5', S: '#35e07a',
    Z: '#ff3b5c', J: '#4d7cff', L: '#ff9a3d'
  };
  for (const sh of bgShapes) {
    sh.y -= sh.sp;
    sh.rot += 0.002;
    if (sh.y < -80) { sh.y = bg.height + 40; sh.x = Math.random() * bg.width; }
    bgCtx.save();
    bgCtx.translate(sh.x, sh.y);
    bgCtx.rotate(sh.rot);
    bgCtx.globalAlpha = 0.10;
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
  buildMultiControls();
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

function buildMultiControls() {
  const wrap = $('multi-controls');
  if (!wrap) return;
  wrap.innerHTML = '';
  buildControlsTable(wrap, settings.controls, () => {});
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
  try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  if (ok) done();
  else showToast('COULD NOT COPY — TYPE THE CODE MANUALLY');
}

// ---------------------------------------------------------------- game lifecycle

function startGame(playerCount, opts = {}) {
  onlineMatch = !!opts.online;
  currentMode = playerCount === 1 ? 'solo' : String(playerCount);
  gameDifficulty = opts.difficulty || settings.difficulty;
  scoreSaved = false;

  if (controller) controller.quit();

  const names = [];
  for (let i = 0; i < playerCount; i++) {
    if (i === 0) names.push(opts.name || settings.playerName || 'P1');
    else if (opts.online) names.push(opts.rivalName || 'RIVAL');
    else names.push(`P${i + 1}`);
  }

  controller = new GameController({
    playerCount,
    difficulty: gameDifficulty,
    names,
    remotePlayers: opts.online ? [1] : [],
    onEvent: (ev, data) => {
      if (ev === 'frame') updateArenaHud(controller);
      if (ev === 'over') handleRoundOver(data);
    },
    onFrame: (dt) => {
      if (opts.online) sendOnlineFrame(dt);
    }
  });

  controller.players.forEach(wirePlayerAudio);

  buildArena(controller, currentMode);
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
    showGameOver({ score: p0.score, lines: p0.lines, level: p0.level, qualifies });
    return;
  }

  // multiplayer / online round
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
  showVictory(data.ranked, currentMode);
  const againBtn = $('overlay-victory').querySelector('[data-action="again"]');
  if (againBtn) againBtn.classList.toggle('hidden', onlineMatch);
}

function saveScoreFromOverlay() {
  if (scoreSaved || !controller) return;
  const name = ($('gameover-name').value || settings.playerName || 'PLAYER').toUpperCase().slice(0, 12);
  const p = controller.players[0];
  const entry = submitScore({ name, score: p.score, lines: p.lines, difficulty: gameDifficulty, mode: 'solo' });
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

online.on('open', ({ code }) => {
  $('online-lobby').classList.add('hidden');
  if (code) {
    $('online-code').textContent = `CODE: ${code.toUpperCase()}`;
    $('online-status').textContent = 'WAITING FOR RIVAL…';
  } else {
    $('online-status').textContent = 'CONNECTING TO ROOM…';
  }
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
    else if (action === 'multi') { buildMultiControls(); showScreen('multi'); }
    else if (action === 'online') openOnlineLobby();
    else if (action === 'online-copy') copyOnlineCode();
    else if (action === 'pause') togglePause();
    else if (action === 'resume') togglePause();
    else if (action === 'restart') { quitGame(); startGame(parseInt(currentMode === 'solo' ? '1' : currentMode, 10)); }
    else if (action === 'quit') {
      if ($('overlay-gameover').classList.contains('open') && !scoreSaved) saveScoreFromOverlay();
      quitGame();
    }
    else if (action === 'again') {
      if ($('overlay-gameover').classList.contains('open') && !scoreSaved) saveScoreFromOverlay();
      const count = currentMode === 'solo' ? 1 : parseInt(currentMode, 10);
      hideOverlay('gameover');
      hideOverlay('victory');
      if (onlineMatch) { online.send('start', { difficulty: gameDifficulty }); startOnlineMatch(gameDifficulty); }
      else startGame(count);
    }
    else if (action === 'save-score') saveScoreFromOverlay();
    else if (action === 'online-create') {
      if (!online.supported()) { showToast('ONLINE NEEDS INTERNET'); return; }
      const ok = online.createRoom($('online-name').value || settings.playerName || 'P1');
      if (!ok) showToast('PEERJS NOT AVAILABLE');
    }
    else if (action === 'online-join') {
      if (!online.supported()) { showToast('ONLINE NEEDS INTERNET'); return; }
      const code = $('online-join-code').value;
      if (!code.trim()) { showToast('ENTER A ROOM CODE'); return; }
      const ok = online.joinRoom(code, $('online-name').value || settings.playerName || 'P2');
      if (!ok) showToast('PEERJS NOT AVAILABLE');
    }
    else if (action === 'online-start') {
      online.send('start', { difficulty: gameDifficulty });
      startOnlineMatch(gameDifficulty);
    }
    else if (action === 'close-online') { online.close(); hideOverlay('online'); }
  });

  // difficulty cards
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

  // score filters
  document.querySelectorAll('#score-filters .btn-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#score-filters .btn-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderScores(btn.dataset.filter || null);
      audio.click();
    });
  });

  // settings
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

  window.addEventListener('resize', () => {
    fitBoard();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(fitBoard, 120);
  });

}

init();
