// A single playable instance: owns a board, piece queue, hold, score and level.
// Emits events for the UI and audio systems to react to.
// ENHANCED: combo tracking, T-spin detection, bonus scoring.

import { Board } from './board.js';
import { BagRandomizer, createPiece, clonePiece, rotateMatrix, KICKS_JLSTZ, KICKS_I } from './pieces.js';
import {
  dropIntervalMs,
  linesScore,
  levelForLines,
  softDropPoints,
  hardDropPoints,
  comboBonus
} from './scoring.js';

export class Player {
  constructor(config) {
    this.name = config.name || 'PLAYER';
    this.id = config.id || 0;
    this.difficulty = config.difficulty || 'moderate';
    this.remote = !!config.remote;
    this.bot = !!config.bot;
    this.board = new Board();
    this.bag = new BagRandomizer();
    this.queue = [];
    this.piece = null;
    this.hold = null;
    this.canHold = true;
    this.ghostY = -1;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.pieces = 0;
    this.tetrises = 0;
    this.topOut = false;
    this.finished = false;
    this.finishOrder = -1;
    this.elapsed = 0;
    this.dropTimer = 0;
    this.state = 'idle';
    this._handlers = {};

    // Combo system
    this.combo = 0;
    this.maxCombo = 0;
    this.backToBack = false;
    this.tSpins = 0;
    this.lastRotationWasKick = false;
    this.lastKickCorners = 0;
    this.lastAction = null; // 'move', 'rotate', 'harddrop', 'softdrop'
    this.lockMoves = 0;
    this.lastDropDist = 0;

    this._fillQueue(2);
  }

  on(event, cb) {
    (this._handlers[event] = this._handlers[event] || []).push(cb);
  }

  emit(event, payload) {
    (this._handlers[event] || []).forEach((cb) => {
      try { cb(payload); } catch (e) { console.error('player event', event, e); }
    });
  }

  _fillQueue(n) {
    for (let i = 0; i < n; i++) this.queue.push(createPiece(this.bag.next()));
  }

  start() {
    this.state = 'playing';
    this._spawn();
  }

  reset() {
    this.board.reset();
    this.bag = new BagRandomizer();
    this.queue = [];
    this.hold = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.pieces = 0;
    this.tetrises = 0;
    this.topOut = false;
    this.finished = false;
    this.finishOrder = -1;
    this.elapsed = 0;
    this.dropTimer = 0;
    this.state = 'idle';
    this.combo = 0;
    this.maxCombo = 0;
    this.backToBack = false;
    this.tSpins = 0;
    this.lastRotationWasKick = false;
    this.lastKickCorners = 0;
    this.lastAction = null;
    this.lockMoves = 0;
    this.lastDropDist = 0;
    this._fillQueue(2);
  }

  _spawn() {
    this.piece = this.queue.shift();
    this._fillQueue(1);
    this.canHold = true;
    this.lockMoves = 0;
    this.lastRotationWasKick = false;
    this.lastKickCorners = 0;
    if (!this.piece) return;
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y)) {
      this._topOut();
      return;
    }
    this._updateGhost();
    this.emit('spawn', { piece: this.piece });
  }

  _updateGhost() {
    let gy = this.piece.y;
    while (!this.board.collides(this.piece.matrix, this.piece.x, gy + 1)) gy++;
    this.ghostY = gy;
  }

  gravityInterval() {
    return dropIntervalMs(this.difficulty, this.level);
  }

  tick(dt) {
    if (this.state !== 'playing' || !this.piece || this.board.isClearing()) return false;
    this.elapsed += dt;
    this.dropTimer += dt;
    let locked = false;
    while (this.dropTimer >= this.gravityInterval()) {
      this.dropTimer -= this.gravityInterval();
      if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
        locked = true;
        break;
      }
      this.piece.y++;
    }
    if (locked) {
      this._lock();
      return true;
    }
    this._updateGhost();
    return false;
  }

  moveLeft() {
    return this._move(-1, 0, 'move');
  }

  moveRight() {
    return this._move(1, 0, 'move');
  }

  _move(dx, dy, evt) {
    if (this.state !== 'playing' || !this.piece) return false;
    if (this.board.collides(this.piece.matrix, this.piece.x + dx, this.piece.y + dy)) return false;
    this.piece.x += dx;
    this.piece.y += dy;
    this.lockMoves++;
    this._updateGhost();
    this.emit(evt);
    return true;
  }

  rotate(dir) {
    if (this.state !== 'playing' || !this.piece) return false;
    const rotated = rotateMatrix(this.piece.matrix, dir);
    const kicks = this.piece.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    let kicked = false;
    for (const [kx, ky] of kicks) {
      const nx = this.piece.x + kx;
      const ny = this.piece.y + ky;
      if (!this.board.collides(rotated, nx, ny)) {
        this.piece.matrix = rotated;
        this.piece.x = nx;
        this.piece.y = ny;
        this.lockMoves++;
        this._updateGhost();

        // T-spin detection: if T-piece and used a kick
        if (kx !== 0 || ky !== 0) {
          this.lastRotationWasKick = true;
          this.lastKickCorners = this._countTSpinCorners();
        } else {
          this.lastRotationWasKick = false;
          this.lastKickCorners = 0;
        }
        this.lastAction = 'rotate';
        this.emit('rotate');
        return true;
      }
    }
    this.emit('blocked');
    return false;
  }

  // T-spin detection: count occupied corners of the T-piece bounding box
  _countTSpinCorners() {
    if (this.piece.type !== 'T' || !this.piece) return 0;
    const corners = [
      [this.piece.x, this.piece.y],
      [this.piece.x + 2, this.piece.y],
      [this.piece.x, this.piece.y + 2],
      [this.piece.x + 2, this.piece.y + 2]
    ];
    let count = 0;
    for (const [cx, cy] of corners) {
      if (cx < 0 || cx >= 10 || cy >= 22) count++;
      else if (cy >= 0 && this.board.grid[cy][cx]) count++;
    }
    return count;
  }

  softDrop(manual = true) {
    if (this.state !== 'playing' || !this.piece) return false;
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
      this.dropTimer = 0;
      return false;
    }
    this.piece.y++;
    this.lastDropDist++;
    if (manual) this.score += softDropPoints(1);
    this.dropTimer = 0;
    this._updateGhost();
    if (manual) this.emit('softdrop');
    return false;
  }

  hardDrop() {
    if (this.state !== 'playing' || !this.piece) return false;
    let dist = 0;
    while (!this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
      this.piece.y++;
      dist++;
    }
    this.lastDropDist = dist;
    this.score += hardDropPoints(dist);
    this.lastAction = 'harddrop';
    this.emit('harddrop', { dist });
    this._lock();
    return true;
  }

  holdPiece() {
    if (this.state !== 'playing' || !this.piece || !this.canHold) return false;
    const current = this.piece;
    if (this.hold) {
      this.piece = clonePiece(this.hold);
      this.piece.x = 3;
      this.piece.y = current.type === 'O' ? 0 : -1;
      this.hold = current;
    } else {
      this.hold = current;
      this.piece = this.queue.shift();
      this._fillQueue(1);
    }
    this.canHold = false;
    this.lastRotationWasKick = false;
    this.lastKickCorners = 0;
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y)) {
      this._topOut();
      return true;
    }
    this._updateGhost();
    this.emit('hold');
    return true;
  }

  _lock() {
    // T-spin detection before lock
    const isTSpin = this.piece && this.piece.type === 'T' &&
      this.lastRotationWasKick && this.lastKickCorners >= 3;

    const cleared = this.board.merge(this.piece);
    this.pieces++;
    this.lastAction = 'lock';
    this.emit('lock', { lines: cleared.length, tSpin: isTSpin });

    if (this.board.gameOver) {
      this._topOut();
      return;
    }

    if (cleared.length) {
      // Combo tracking
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;

      // Back-to-back tracking (Tetris or T-spin)
      const isSpecial = cleared.length === 4 || isTSpin;
      if (isSpecial) {
        this.backToBack = true;
      } else {
        this.backToBack = false;
      }

      this.board.startClearing(cleared);
      this.emit('clearing', { rows: cleared });
      this.lines += cleared.length;

      let gained = linesScore(cleared.length, this.level);

      // T-spin bonus
      if (isTSpin) {
        const tSpinBonus = cleared.length === 0 ? 400 : cleared.length === 1 ? 800 : cleared.length === 2 ? 1200 : 1600;
        gained += tSpinBonus * this.level;
        this.tSpins++;
        this.emit('tspin', { lines: cleared.length });
      }

      // Combo bonus
      if (this.combo > 1) {
        gained += comboBonus(this.combo, this.level);
        this.emit('combo', { count: this.combo, gained: comboBonus(this.combo, this.level) });
      }

      // Back-to-back bonus
      if (isSpecial && this.backToBack && cleared.length === 4) {
        gained += 100 * this.level;
        this.emit('backtoback');
      }

      this.score += gained;

      if (cleared.length === 4) {
        this.tetrises++;
        this.emit('tetris');
      }
      this.emit('clear', { count: cleared.length, gained, level: this.level, tSpin: isTSpin, combo: this.combo });

      const newLevel = levelForLines(this.lines);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.emit('levelup', { level: this.level });
      }
    } else {
      // No lines cleared resets combo
      this.combo = 0;
    }

    this.lastDropDist = 0;
    this.lastRotationWasKick = false;
    this.lastKickCorners = 0;
    this.lockMoves = 0;
    this.piece = null;
    if (!this.board.isClearing()) this._spawn();
  }

  afterClear() {
    if (this.board.finishClearing()) {
      this.emit('rowsgone');
    }
    if (!this.piece && !this.topOut) this._spawn();
  }

  pause() {
    if (this.state === 'playing') this.state = 'paused';
  }

  resume() {
    if (this.state === 'paused') this.state = 'playing';
  }

  _topOut() {
    if (this.topOut) return;
    this.topOut = true;
    this.state = 'finished';
    this.finished = true;
    this.emit('topout', { score: this.score, lines: this.lines });
  }

  finish(rank) {
    this.finished = true;
    this.state = 'finished';
    this.finishOrder = rank;
    this.emit('finish', { rank });
  }

  toJSON() {
    return {
      name: this.name,
      score: this.score,
      lines: this.lines,
      level: this.level,
      pieces: this.pieces,
      tetrises: this.tetrises,
      topOut: this.topOut,
      rank: this.finishOrder,
      snapshot: this.board.snapshot()
    };
  }
}
