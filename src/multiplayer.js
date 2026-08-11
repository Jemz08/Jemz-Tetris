// GameController: runs 1..4 local players on one shared animation loop,
// handles pause, DAS auto-repeat, ranking and end-of-round logic.

import { Player } from './player.js';
import { HIDDEN } from './board.js';

export class GameController {
  constructor(opts) {
    this.playerCount = opts.playerCount || 1;
    this.difficulty = opts.difficulty || 'moderate';
    this.names = opts.names || [];
    this.onEvent = opts.onEvent || (() => {});
    this.onFrame = opts.onFrame || (() => {}); // used by online sync
    this.players = [];
    this.running = false;
    this.paused = false;
    this.ended = false;
    this.rankCounter = this.playerCount;
    this._keys = new Map();
    for (let i = 0; i < this.playerCount; i++) {
      this.players.push(new Player({
        id: i,
        name: this.names[i] || `P${i + 1}`,
        difficulty: this.difficulty,
        remote: !!(opts.remotePlayers && opts.remotePlayers.includes(i))
      }));
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.ended = false;
    this.paused = false;
    this.lastTime = performance.now();
    this.players.forEach((p) => p.start());
    this.onEvent('start', { players: this.players });
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(50, now - this.lastTime);
      this.lastTime = now;
      this.step(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  step(dt) {
    if (this.paused || this.ended) return;
    this.dasTick(dt);
    for (const p of this.players) {
      if (!p.remote && p.state === 'playing') {
        p.tick(dt);
        if (p.board.isClearing()) {
          p.board.flash -= dt;
          if (p.board.flash <= 0) p.afterClear();
        }
      }
      if (p.topOut && p.finishOrder === -1) this._onTopOut(p);
    }
    this.onFrame(dt);
    this.onEvent('frame', { players: this.players });
    this._checkEnd();
  }

  _onTopOut(p) {
    const rank = this.rankCounter;
    this.rankCounter--;
    p.finish(rank);
    this.onEvent('rank', { player: p, rank });
  }

  _checkEnd() {
    if (this.ended) return;
    const finished = this.players.filter((p) => p.finished);
    if (this.playerCount === 1) {
      if (finished.length >= 1) this._end();
      return;
    }
    if (finished.length >= this.playerCount - 1) {
      const last = this.players.find((p) => !p.finished);
      if (last) last.finish(1);
      this._end();
    }
  }

  _end() {
    this.ended = true;
    this.running = false;
    const ranked = this.players.slice().sort((a, b) => {
      if (a.finishOrder !== b.finishOrder) return a.finishOrder - b.finishOrder;
      return b.score - a.score;
    });
    this.onEvent('over', { players: this.players, ranked });
  }

  pause() {
    if (this.ended || this.paused) return;
    this.paused = true;
    this.players.forEach((p) => p.pause());
    this.onEvent('pause');
  }

  resume() {
    if (this.ended || !this.paused) return;
    this.paused = false;
    this.players.forEach((p) => p.resume());
    this.lastTime = performance.now();
    this.onEvent('resume');
  }

  quit() {
    this.running = false;
    this.ended = true;
    this.players.forEach((p) => { p.state = 'finished'; });
  }

  // ---- input ---------------------------------------------------------

  press(playerIdx, action) {
    if (this.paused || this.ended) return;
    const p = this.players[playerIdx];
    if (!p || p.state !== 'playing' || p.remote) return;
    if (action === 'left' || action === 'right') {
      const key = `${playerIdx}:${action}`;
      if (this._keys.has(key)) return;
      this._keys.set(key, { time: 0, acc: 0, repeated: false });
      if (action === 'left') p.moveLeft();
      else p.moveRight();
      return;
    }
    if (action === 'rotate') p.rotate(1);
    else if (action === 'rotateCCW') p.rotate(-1);
    else if (action === 'softdrop') p.softDrop(true);
    else if (action === 'harddrop') p.hardDrop();
    else if (action === 'hold') p.holdPiece();
  }

  release(playerIdx, action) {
    if (action === 'left' || action === 'right') {
      this._keys.delete(`${playerIdx}:${action}`);
    }
  }

  // DAS: after 150ms of holding, repeat the move every 45ms.
  dasTick(dt) {
    for (const [key, state] of this._keys) {
      const sep = key.indexOf(':');
      const playerIdx = +key.slice(0, sep);
      const action = key.slice(sep + 1);
      state.time += dt;
      if (state.time < 150) continue;
      if (!state.repeated) {
        state.repeated = true;
        state.acc = 0;
      }
      state.acc += dt;
      while (state.acc >= 45) {
        state.acc -= 45;
        const p = this.players[playerIdx];
        if (!p || p.state !== 'playing') break;
        if (action === 'left') p.moveLeft();
        else p.moveRight();
      }
    }
  }

  // Online sync: apply a snapshot from a remote player.
  applyRemoteFrame(idx, data) {
    const p = this.players[idx];
    if (!p) return;
    if (typeof data.score === 'number') p.score = data.score;
    if (typeof data.lines === 'number') p.lines = data.lines;
    if (typeof data.level === 'number') p.level = data.level;
    if (typeof data.snapshot === 'string' && data.snapshot.length === 200) {
      for (let y = 0; y < 20; y++) {
        const row = data.snapshot.slice(y * 10, y * 10 + 10);
        for (let x = 0; x < 10; x++) {
          p.board.grid[y + HIDDEN][x] = row[x] === '1' ? '#9a8fc0' : 0;
        }
      }
    }
    if (data.topOut) p._topOut();
  }
}
