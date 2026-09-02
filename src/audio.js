// Retro arcade audio built entirely with the Web Audio API — no sound files.
// Sound effects, a looping chiptune, master volume, and sound/music toggles.

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.sound = true;
    this.music = true;
    this.volume = 0.7;
    this._musicTimer = null;
    this._step = 0;
    this._nextNoteTime = 0;
    this._unlockHandler = () => this.unlock();
  }

  // Called from a user gesture; browsers require this to start audio.
  unlock() {
    if (!this.ctx) this._init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  _init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.music ? 0.28 : 0;
    this.musicGain.connect(this.master);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setSound(on) {
    this.sound = on;
    if (!on) this.sfxGain && (this.sfxGain.gain.value = 0);
    else this.sfxGain && (this.sfxGain.gain.value = 1);
  }

  setMusic(on) {
    this.music = on;
    if (!this.ctx) return;
    const target = on ? 0.28 : 0;
    const now = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(target, now, 0.05);
  }

  // ---- low-level helpers ----------------------------------------------

  _env(type, freq, t0, dur, vol = 0.25, slideTo = null) {
    if (!this.ctx || !this.sound) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise(t0, dur, vol = 0.2, lowpass = 900) {
    if (!this.ctx || !this.sound) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t0);
  }

  _arpeggio(notes, stepMs = 70, type = 'square', vol = 0.22) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + 0.01;
    notes.forEach((f, i) => {
      this._env(type, f, t0 + (i * stepMs) / 1000, 0.09, vol);
    });
  }

  // ---- effects ---------------------------------------------------------

  move() { this._env('square', 210, this._now(), 0.035, 0.12, 180); }
  rotate() { this._env('square', 330, this._now(), 0.05, 0.14, 260); }
  softdrop() { this._env('triangle', 140, this._now(), 0.03, 0.1, 120); }
  harddrop() {
    const t = this._now();
    this._noise(t, 0.09, 0.25, 700);
    this._env('square', 90, t, 0.08, 0.22, 40);
  }
  land() {
    const t = this._now();
    this._noise(t, 0.06, 0.18, 800);
    this._env('triangle', 120, t, 0.06, 0.18, 70);
  }
  hold() { this._env('square', 520, this._now(), 0.06, 0.13, 400); }
  blocked() { this._env('square', 120, this._now(), 0.05, 0.1, 100); }
  clear(lines) {
    if (lines <= 0) return;
    const base = 392;
    const notes = [];
    for (let i = 0; i < lines + 1; i++) notes.push(base * Math.pow(1.26, i));
    this._arpeggio(notes, 65, 'square', 0.22);
  }
  tetris() {
    const notes = [392, 523, 659, 784, 1046, 1318];
    this._arpeggio(notes, 75, 'square', 0.26);
    const t = this._now();
    this._noise(t, 0.35, 0.08, 3000);
  }
  levelup() {
    this._arpeggio([440, 587, 880], 80, 'triangle', 0.24);
  }
  gameover() {
    const t = this._now();
    [392, 330, 262, 196, 147].forEach((f, i) => {
      this._env('sawtooth', f, t + i * 0.14, 0.18, 0.16, f * 0.9);
    });
  }
  victory() {
    const t = this._now();
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => {
      this._env('square', f, t + i * 0.13, 0.14, 0.22);
    });
    this._noise(t, 0.5, 0.06, 4000);
  }
  click() { this._env('square', 700, this._now(), 0.03, 0.12, 500); }
  highscore() {
    this._arpeggio([659, 784, 988, 1318], 90, 'triangle', 0.24);
  }
  pause() { this._env('square', 500, this._now(), 0.06, 0.12, 300); }
  countdown() { this._env('square', 660, this._now(), 0.09, 0.2, 500); }
  go() { this._arpeggio([523, 784, 1046], 70, 'square', 0.24); }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---- announcer voice (browser text-to-speech, no audio files) --------

  speak(text, opts = {}) {
    if (!this.sound) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel(); // don't let callouts queue up and stack
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate || 1.1;
      u.pitch = opts.pitch || 1.15;
      u.volume = Math.max(0, Math.min(1, this.volume + 0.25));
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech synthesis unsupported/blocked — fail silently */ }
  }

  voiceTetris() { this.speak('Tetris!', { pitch: 1.35, rate: 1.05 }); }
  voiceCombo(lines) {
    if (lines === 3) this.speak('Triple!', { pitch: 1.2 });
    else if (lines === 2) this.speak('Double!', { pitch: 1.1 });
  }
  voiceLevelUp(level) { this.speak(`Level ${level}!`, { pitch: 1.15 }); }
  voiceGameOver() { this.speak('Game over', { pitch: 0.85, rate: 0.95 }); }
  voiceVictory() { this.speak('Victory!', { pitch: 1.2 }); }

  // ---- background music -------------------------------------------------

  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    this._step = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 25);
  }

  stopMusic() {
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
  }

  _scheduleMusic() {
    if (!this.ctx) return;
    const tempo = 128; // bpm
    const stepDur = 60 / tempo / 2; // 8th notes
    while (this._nextNoteTime < this.ctx.currentTime + 0.15) {
      this._playMusicStep(this._step, this._nextNoteTime, stepDur);
      this._nextNoteTime += stepDur;
      this._step = (this._step + 1) % 32;
    }
  }

  _playMusicStep(step, t, dur) {
    const bass = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 10, 0, 10, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 15, 0, 14, 0, 12, 0];
    const lead = [0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 12, -1, 10, -1, 10, -1, 0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 15, -1, 14, -1, 12, -1];
    const A = 110;
    const b = bass[step];
    const l = lead[step];
    if (b !== -1 && b !== 0) this._note('triangle', A * Math.pow(2, b / 12), t, dur * 1.9, 0.5);
    if (l !== -1 && l !== 0) this._note('square', A * 2 * Math.pow(2, l / 12), t, dur * 0.9, 0.14);
    // hat tick
    if (step % 4 === 2) this._noise(t, 0.02, 0.02, 6000);
  }

  _note(type, freq, t, dur, vol) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

export const audio = new AudioEngine();

// Unlock audio on the first user interaction anywhere.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio.unlock();
    if (audio.music) audio.startMusic();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('touchstart', unlock, { passive: true });
}
