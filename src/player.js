// A single playable instance: owns a board, piece queue, hold, score and level.
// Emits events for the UI and audio systems to react to.
//
// Implements: SRS rotation system, T-spin / T-spin mini detection,
// combo counter, back-to-back tracking, perfect-clear detection,
// and configurable lock delay with move/rotate resets.

import { Board, ROWS, HIDDEN } from './board.js';
import {
  BagRandomizer, createPiece, clonePiece, rotateMatrix,
  getSrsKicks, nextRotationState
} from './pieces.js';
import {
  dropIntervalMs,
  softDropPoints,
  hardDropPoints,
  calcClearScore,
  detectTSpin,
  levelForLines
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
    this.state = 'idle'; // idle | playing | paused | finished

    // ---- lock delay (configurable) ----
    this.lockDelay = 500;            // ms before lock after grounding
    this.lockResetsMax = 15;         // max move/rotate resets while grounded
    this.lockResets = this.lockResetsMax;
    this.lockTimer = 0;
    this.isGrounded = false;

    // ---- action tracking ----
    this.lastAction = null;          // 'move' | 'rotate' | 'softdrop' | 'harddrop' | 'hold' | 'gravity' | null
    this.lastRotateDir = 0;          // +1 CW, -1 CCW
    this.lastMoveX = 0;              // last horizontal move delta

    // ---- combo & back-to-back ----
    this.combo = 0;                  // consecutive line clears (0 = no combo)
    this.b2b = false;                // back-to-back active
    this.b2bCount = 0;               // total back-to-back clears this game

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

    this.lockDelay = 500;
    this.lockResetsMax = 15;
    this.lockResets = this.lockResetsMax;
    this.lockTimer = 0;
    this.isGrounded = false;

    this.lastAction = null;
    this.lastRotateDir = 0;
    this.lastMoveX = 0;

    this.combo = 0;
    this.b2b = false;
    this.b2bCount = 0;

    this._fillQueue(2);
  }

  _spawn() {
    this.piece = this.queue.shift();
    this._fillQueue(1);
    this.canHold = true;
    this.lockResets = this.lockResetsMax;
    this.lockTimer = 0;
    this.isGrounded = false;
    this.lastAction = null;
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

  // ---- tick (gravity + lock delay) ----
  tick(dt) {
    if (this.state !== 'playing' || !this.piece || this.board.isClearing()) return false;
    this.elapsed += dt;
    this.dropTimer += dt;

    const grounded = this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1);

    if (grounded) {
      if (!this.isGrounded) {
        this.isGrounded = true;
        this.lockTimer = 0;
      }

      while (this.dropTimer >= this.gravityInterval()) {
        this.dropTimer -= this.gravityInterval();
        if (!this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
          this.piece.y++;
          this.isGrounded = false;
          this.lockTimer = 0;
        }
      }

      if (this.isGrounded) {
        this.lockTimer += dt;
        if (this.lockTimer >= this.lockDelay || this.lockResets <= 0) {
          this._lock();
          return true;
        }
      }
    } else {
      while (this.dropTimer >= this.gravityInterval()) {
        this.dropTimer -= this.gravityInterval();
        if (!this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
          this.piece.y++;
        } else {
          break;
        }
      }
      this.isGrounded = false;
      this.lockTimer = 0;
      this.lockResets = this.lockResetsMax;
    }

    this._updateGhost();
    return false;
  }

  // ---- movement ----

  moveLeft() {
    const moved = this._move(-1, 0, 'move');
    if (moved) {
      this.lastMoveX = -1;
      this._resetLockDelay();
    }
    return moved;
  }

  moveRight() {
    const moved = this._move(1, 0, 'move');
    if (moved) {
      this.lastMoveX = 1;
      this._resetLockDelay();
    }
    return moved;
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

  // ---- SRS rotation ----

  rotate(dir) {
    if (this.state !== 'playing' || !this.piece) return false;
    if (this.piece.type === 'O') return false;

    const rotated = rotateMatrix(this.piece.matrix, dir);
    const state = this.piece.rotationState;
    const kicks = getSrsKicks(this.piece.type, state, dir);

    for (const [kx, ky] of kicks) {
      const nx = this.piece.x + kx;
      const ny = this.piece.y + ky;
      if (!this.board.collides(rotated, nx, ny)) {
        this.piece.matrix = rotated;
        this.piece.x = nx;
        this.piece.y = ny;
        this.piece.rotationState = nextRotationState(state, dir);
        this.lastAction = 'rotate';
        this.lastRotateDir = dir;
        this._updateGhost();
        this._resetLockDelay();
        this.emit('rotate');
        return true;
      }
    }
    this.emit('blocked');
    return false;
  }

  // ---- soft / hard drop ----

  softDrop(manual = true) {
    if (this.state !== 'playing' || !this.piece) return false;
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y + 1)) {
      this.dropTimer = 0;
      return false;
    }
    this.piece.y++;
    if (manual) this.score += softDropPoints(1);
    this.dropTimer = 0;
    if (manual) this.lastAction = 'softdrop';
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
    this.lastAction = 'harddrop';
    this.emit('harddrop', { dist });
    this._lock();
    return true;
  }

  // ---- hold ----

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
    this.lastAction = 'hold';
    this.isGrounded = false;
    this.lockTimer = 0;
    this.lockResets = this.lockResetsMax;
    if (this.board.collides(this.piece.matrix, this.piece.x, this.piece.y)) {
      this._topOut();
      return true;
    }
    this._updateGhost();
    this.emit('hold');
    return true;
  }

  // ---- lock delay reset ----

  _resetLockDelay() {
    if (this.isGrounded && this.lockResets > 0) {
      this.lockResets--;
      this.lockTimer = 0;
    }
  }

  // ---- lock ----

  _lock() {
    // Detect T-spin BEFORE merging (we need the piece position on the board)
    const tSpin = detectTSpin(this.board, this.piece, this.lastAction);

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

      // Detect perfect clear before clearing rows
      const perfectClear = this.board.isPerfectClear();

      const result = calcClearScore({
        linesCleared: cleared.length,
        level: this.level,
        tSpin,
        comboCount: this.combo,
        b2bActive: this.b2b,
        perfectClear
      });

      this.score += result.total;

      // Update combo
      this.combo++;

      // Update back-to-back
      if (result.isBrilliant) {
        if (this.b2b) {
          this.b2bCount++;
        } else {
          this.b2b = true;
        }
      } else if (cleared.length > 0) {
        this.b2b = false;
      }

      // Emit events
      if (cleared.length === 4 && !tSpin) {
        this.tetrises++;
        this.emit('tetris');
      }

      if (tSpin) {
        this.emit('tspin', { type: tSpin, lines: cleared.length });
      }
      if (this.combo > 1) {
        this.emit('combo', { count: this.combo });
      }
      if (result.announce) {
        this.emit('announce', { text: result.announce, score: result.total });
      }

      this.emit('clear', {
        count: cleared.length,
        gained: result.total,
        level: this.level,
        tSpin,
        combo: this.combo,
        b2b: this.b2b,
        perfectClear
      });

      const newLevel = levelForLines(this.lines);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.emit('levelup', { level: this.level });
      }
    } else {
      // No lines cleared — reset combo
      this.combo = 0;
    }

    this.lastAction = null;
    this.isGrounded = false;
    this.lockTimer = 0;
    this.lockResets = this.lockResetsMax;

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
