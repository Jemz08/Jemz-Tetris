// A single playable instance: owns a board, piece queue, hold, score and level.
// Emits events for the UI and audio systems to react to.

import { Board } from './board.js';
import { BagRandomizer, createPiece, clonePiece, rotateMatrix } from './pieces.js';
import {
  dropIntervalMs,
  linesScore,
  levelForLines,
  softDropPoints,
  hardDropPoints
} from './scoring.js';

export class Player {
  constructor(config) {
    this.name = config.name || 'PLAYER';
    this.id = config.id || 0;
    this.difficulty = config.difficulty || 'moderate';
    this.remote = !!config.remote; // online opponent: no local input
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
    this.state = 'idle'; // idle | playing | paused | finished
    this._handlers = {};
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
    this._fillQueue(2);
  }

  _spawn() {
    this.piece = this.queue.shift();
    this._fillQueue(1);
    this.canHold = true;
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

  // Gravity step. Returns true if the piece locked this tick.
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
    this._updateGhost();
    this.emit(evt);
    return true;
  }

  rotate(dir) {
    if (this.state !== 'playing' || !this.piece) return false;
    const rotated = rotateMatrix(this.piece.matrix, dir);
    const kicks = [0, -1, 1, -2, 2];
    for (const kx of kicks) {
      if (!this.board.collides(rotated, this.piece.x + kx, this.piece.y)) {
        this.piece.matrix = rotated;
        this.piece.x += kx;
        this._updateGhost();
        this.emit('rotate');
        return true;
      }
    }
    return false;
  }

  softDrop(manual = true) {
    if (this.state !== 'playing' || !this.piece) return false;
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
      this.dropTimer = 0;
      return false;
    }
    this.piece.y++;
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
    this.score += hardDropPoints(dist);
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
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y)) {
      this._topOut();
      return true;
    }
    this._updateGhost();
    this.emit('hold');
    return true;
  }

  _lock() {
    const cleared = this.board.merge(this.piece);
    this.pieces++;
    this.emit('lock', { lines: cleared.length });
    if (this.board.gameOver) {
      this._topOut();
      return;
    }
    if (cleared.length) {
      this.board.startClearing(cleared);
      this.emit('clearing', { rows: cleared });
      this.lines += cleared.length;
      const gained = linesScore(cleared.length, this.level);
      this.score += gained;
      if (cleared.length === 4) {
        this.tetrises++;
        this.emit('tetris');
      }
      this.emit('clear', { count: cleared.length, gained, level: this.level });
      const newLevel = levelForLines(this.lines);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.emit('levelup', { level: this.level });
      }
    }
    this.piece = null;
    // Spawn immediately unless rows are still flashing out.
    if (!this.board.isClearing()) this._spawn();
  }

  // Called by the controller when the clear-flash animation completes.
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
