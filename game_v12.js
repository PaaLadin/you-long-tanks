'use strict';

const CONFIG = {
  SW: 800, SH: 600,
  HUD: 130, FW: 720, FH: 440,
  CELL: 24, CELL_W: 24, CELL_H: 22,
  COLS: 30, ROWS: 20, BOTTOM_H: 30,
  TANK_TICK: 110, MAN_TICK: 550, BULLET_TICK: 45,
  MAN_SPAWN: 2200, MAX_MEN: 6,
  TARGETS: [10,15,25,50,15,15,15,15,15,15,20,20,20,20,20,20,20,20,20,20],
  SHOOT_LVL: 1,
};

const DIR = {
  up:    {dx:0,  dy:-1, name:'up'},
  down:  {dx:0,  dy:1,  name:'down'},
  left:  {dx:-1, dy:0,  name:'left'},
  right: {dx:1,  dy:0,  name:'right'},
};

const STATE = {
  TITLE:'title', HELP:'help', SETTINGS:'settings',
  HIGHSCORES:'highscores', INTRO:'intro', PLAYING:'playing',
  PAUSED:'paused', GAMEOVER:'gameover',
};

const ITEMS = ['sign','stone','bag','umbrella','bicycle','bench','trash','metal','tree'];

const Storage = {
  get(k, d) { try { const r = localStorage.getItem('dragon_'+k); return r?JSON.parse(r):d; } catch(e) { return d; } },
  set(k, v) { try { localStorage.setItem('dragon_'+k, JSON.stringify(v)); } catch(e){} }
};

let settings = Storage.get('settings', { music: true, sfx: true, theme: 'dark' });
let highscores = Storage.get('highscores', []);

const Audio = {
  ctx: null, musicGain: null, sfxGain: null,
  musicTimer: null, playing: false,
  SCALE: [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880],

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const mg = this.ctx.createGain(); mg.gain.value = 1.0; mg.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.8; this.musicGain.connect(mg);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.8; this.sfxGain.connect(mg);
    } catch(e) {}
  },
  resume() {
    if (!this.ctx) return Promise.resolve();
    if (this.ctx.state === 'suspended') {
      return this.ctx.resume().then(() => {
        console.log('[Audio] resumed, state=' + this.ctx.state);
      }).catch(e => console.warn('[Audio] resume failed:', e));
    }
    return Promise.resolve();
  },
  note(f, d, type, g, dest, when) {
    if (!this.ctx) return;
    const t = when || this.ctx.currentTime;
    const o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.type = type || 'triangle'; o.frequency.value = f;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(g || 0.2, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(gn); gn.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + d + 0.05);
  },
  sfx(name) {
    if (!settings.sfx || !this.ctx) return;
    const t = this.ctx.currentTime, S = this.sfxGain;
    if (name === 'shoot') { this.note(880, 0.08, 'square', 0.15, S); this.note(440, 0.06, 'square', 0.1, S, t+0.03); }
    else if (name === 'eat') { this.note(523.25,0.1,'triangle',0.3,S,t); this.note(659.25,0.15,'triangle',0.3,S,t+0.08); this.note(783.99,0.2,'triangle',0.3,S,t+0.16); }
    else if (name === 'stuck') { this.note(110,0.3,'sawtooth',0.2,S,t); this.note(80,0.4,'sawtooth',0.15,S,t+0.1); }
    else if (name === 'break') {
      const bs = Math.floor(this.ctx.sampleRate * 0.15);
      const buf = this.ctx.createBuffer(1, bs, this.ctx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i=0;i<bs;i++) dd[i] = (Math.random()*2-1)*(1-i/bs);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const g = this.ctx.createGain(); g.gain.value = 0.3;
      src.connect(g); g.connect(S); src.start(t);
    }
    else if (name === 'tp') { this.note(400,0.15,'sine',0.2,S,t); this.note(800,0.1,'sine',0.15,S,t+0.05); }
    else if (name === 'death') { this.note(392,0.2,'triangle',0.3,S,t); this.note(329.63,0.2,'triangle',0.3,S,t+0.15); this.note(261.63,0.4,'triangle',0.3,S,t+0.3); }
  },
  startMusic() {
    if (!settings.music) return;
    if (!this.ctx) this.init();
    if (!this.ctx) { console.warn('AudioContext unavailable'); return; }
    if (this.ctx.state === 'suspended') this.resume();
    if (this._phraseBus) {
      try { this._phraseBus.disconnect(); } catch(e) {}
      this._phraseBus = null;
    }
    if (this.musicTimer) { clearTimeout(this.musicTimer); this.musicTimer = null; }
    this.playing = true;
    // Выбор мелодии: меню -> MENU_MELODY, игра -> MELODIES[level-1]
    if (Game.state === STATE.TITLE || Game.state === STATE.HELP ||
        Game.state === STATE.SETTINGS || Game.state === STATE.HIGHSCORES) {
      this.playMenuMusic();
    } else {
      this.phraseForLevel(Game.level || 1);
    }
  },

  playMenuMusic() {
    if (!this.playing || !this.ctx) return;
    this._currentMelody = 'menu';
    this.resume();
    if (this._phraseBus) {
      try { this._phraseBus.disconnect(); } catch(e) {}
      this._phraseBus = null;
    }
    const bus = this.ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.musicGain);
    this._phraseBus = bus;
    const t = this.ctx.currentTime;
    const M = this.MENU_MELODY;
    const SLOW = 1.3, VOL = 0.7;
    let maxT = 0;
    for (let i = 0; i < M.length; i++) {
      this.note(M[i][1], M[i][2] * SLOW, 'sine', M[i][4] * VOL, bus, t + M[i][0] * SLOW);
      const end = M[i][0] * SLOW + M[i][2] * SLOW;
      if (end > maxT) maxT = end;
    }
    this.musicTimer = setTimeout(() => this.playMenuMusic(), (maxT + 2.0) * 1000);
  },
  // 5 мелодий — пентатоника (C D E G A), ~25-30с каждая, для 5 уровней-циклов
  MELODIES: [
    [
      [0.000, 440.00, 0.250, 'triangle', 0.213],
      [0.250, 392.00, 0.250, 'triangle', 0.213],
      [0.500, 440.00, 0.250, 'triangle', 0.213],
      [0.750, 523.25, 0.250, 'triangle', 0.213],
      [1.000, 587.33, 0.250, 'triangle', 0.213],
      [1.250, 523.25, 0.250, 'triangle', 0.213],
      [1.500, 698.46, 0.250, 'triangle', 0.213],
      [1.750, 587.33, 0.250, 'triangle', 0.213],
      [2.000, 523.25, 0.250, 'triangle', 0.213],
      [2.250, 440.00, 0.250, 'triangle', 0.213],
      [2.500, 523.25, 1.000, 'triangle', 0.213],
      [3.500, 587.33, 0.500, 'triangle', 0.213],
      [4.000, 698.46, 0.500, 'triangle', 0.213],
      [4.500, 783.99, 0.250, 'triangle', 0.213],
      [4.750, 880.00, 0.250, 'triangle', 0.213],
      [5.000, 783.99, 0.250, 'triangle', 0.213],
      [5.250, 698.46, 0.250, 'triangle', 0.213],
      [5.500, 587.33, 0.250, 'triangle', 0.213],
      [5.750, 698.46, 0.250, 'triangle', 0.213],
      [6.000, 523.25, 2.000, 'triangle', 0.213],
      [8.000, 523.25, 0.250, 'triangle', 0.213],
      [8.250, 440.00, 0.250, 'triangle', 0.213],
      [8.500, 523.25, 1.000, 'triangle', 0.213],
      [9.500, 587.33, 0.500, 'triangle', 0.213],
      [10.000, 698.46, 0.500, 'triangle', 0.213],
      [10.500, 783.99, 0.250, 'triangle', 0.213],
      [10.750, 880.00, 0.250, 'triangle', 0.213],
      [11.000, 783.99, 0.250, 'triangle', 0.213],
      [11.250, 698.46, 0.250, 'triangle', 0.213],
      [11.500, 587.33, 0.500, 'triangle', 0.213],
      [12.000, 523.25, 0.500, 'triangle', 0.213],
      [12.500, 392.00, 0.500, 'triangle', 0.213],
      [13.000, 440.00, 0.250, 'triangle', 0.213],
      [13.250, 523.25, 0.250, 'triangle', 0.213],
      [13.500, 440.00, 0.250, 'triangle', 0.213],
      [13.750, 392.00, 0.250, 'triangle', 0.213],
      [14.000, 349.23, 0.250, 'triangle', 0.213],
      [14.250, 293.66, 0.250, 'triangle', 0.213],
      [14.500, 349.23, 1.500, 'triangle', 0.213],
      [16.000, 440.00, 0.250, 'triangle', 0.213],
      [16.250, 392.00, 0.250, 'triangle', 0.213],
      [16.500, 349.23, 0.500, 'triangle', 0.213],
      [17.000, 392.00, 0.750, 'triangle', 0.213],
      [17.750, 440.00, 0.250, 'triangle', 0.213],
      [18.000, 523.25, 0.500, 'triangle', 0.213],
      [18.500, 587.33, 0.250, 'triangle', 0.213],
      [18.750, 698.46, 0.250, 'triangle', 0.213],
      [19.000, 587.33, 0.500, 'triangle', 0.213],
      [19.500, 523.25, 0.500, 'triangle', 0.213],
      [20.000, 523.25, 0.250, 'triangle', 0.213],
      [20.250, 440.00, 0.250, 'triangle', 0.213],
      [20.500, 392.00, 0.500, 'triangle', 0.213],
      [21.000, 440.00, 0.250, 'triangle', 0.213],
      [21.250, 523.25, 0.250, 'triangle', 0.213],
      [21.500, 440.00, 0.250, 'triangle', 0.213],
      [21.750, 392.00, 0.250, 'triangle', 0.213],
      [22.000, 349.23, 0.250, 'triangle', 0.213],
      [22.250, 392.00, 0.250, 'triangle', 0.213],
      [22.500, 293.66, 1.000, 'triangle', 0.213],
      [23.500, 349.23, 0.500, 'triangle', 0.213],
      [24.000, 392.00, 0.750, 'triangle', 0.213],
      [24.750, 440.00, 0.250, 'triangle', 0.213],
      [25.000, 349.23, 0.250, 'triangle', 0.213],
      [0.0, 130.81, 1.8, 'sine', 0.15],
      [2.0, 130.81, 1.8, 'sine', 0.15],
      [4.0, 130.81, 1.8, 'sine', 0.15],
      [6.0, 130.81, 1.8, 'sine', 0.15],
      [8.0, 130.81, 1.8, 'sine', 0.15],
      [10.0, 130.81, 1.8, 'sine', 0.15],
      [12.0, 130.81, 1.8, 'sine', 0.15],
      [14.0, 130.81, 1.8, 'sine', 0.15],
      [16.0, 130.81, 1.8, 'sine', 0.15],
      [18.0, 130.81, 1.8, 'sine', 0.15],
      [20.0, 130.81, 1.8, 'sine', 0.15],
      [22.0, 130.81, 1.8, 'sine', 0.15],
      [24.0, 130.81, 1.8, 'sine', 0.15]
    ],
    [
      [0.000, 329.63, 0.500, 'triangle', 0.213],
      [0.500, 329.63, 0.500, 'triangle', 0.213],
      [1.000, 392.00, 0.500, 'triangle', 0.213],
      [2.000, 783.99, 0.500, 'triangle', 0.213],
      [2.500, 659.26, 0.500, 'triangle', 0.213],
      [3.000, 587.33, 0.250, 'triangle', 0.213],
      [3.250, 659.26, 0.250, 'triangle', 0.213],
      [3.500, 523.25, 0.250, 'triangle', 0.213],
      [3.750, 587.33, 0.250, 'triangle', 0.213],
      [4.000, 440.00, 0.500, 'triangle', 0.213],
      [4.500, 523.25, 0.500, 'triangle', 0.213],
      [5.000, 392.00, 0.250, 'triangle', 0.213],
      [5.250, 440.00, 0.250, 'triangle', 0.213],
      [5.500, 392.00, 0.500, 'triangle', 0.213],
      [6.500, 329.63, 0.250, 'triangle', 0.213],
      [6.750, 392.00, 0.250, 'triangle', 0.213],
      [7.000, 293.66, 0.500, 'triangle', 0.213],
      [7.500, 329.63, 0.500, 'triangle', 0.213],
      [8.000, 392.00, 0.500, 'triangle', 0.213],
      [8.500, 329.63, 0.250, 'triangle', 0.213],
      [8.750, 392.00, 0.250, 'triangle', 0.213],
      [9.000, 523.25, 0.500, 'triangle', 0.213],
      [9.500, 329.63, 0.500, 'triangle', 0.213],
      [10.000, 392.00, 1.000, 'triangle', 0.213],
      [11.000, 349.23, 0.250, 'triangle', 0.213],
      [11.250, 392.00, 0.250, 'triangle', 0.213],
      [11.500, 329.63, 0.500, 'triangle', 0.213],
      [12.000, 349.23, 0.250, 'triangle', 0.213],
      [12.250, 392.00, 0.250, 'triangle', 0.213],
      [12.500, 329.63, 0.500, 'triangle', 0.213],
      [13.000, 293.66, 0.250, 'triangle', 0.213],
      [13.250, 329.63, 0.250, 'triangle', 0.213],
      [13.500, 392.00, 0.250, 'triangle', 0.213],
      [13.750, 440.00, 0.250, 'triangle', 0.213],
      [14.000, 261.63, 1.500, 'triangle', 0.213],
      [15.500, 293.66, 0.250, 'triangle', 0.213],
      [15.750, 329.63, 0.250, 'triangle', 0.213],
      [16.000, 261.63, 0.500, 'triangle', 0.213],
      [16.500, 293.66, 0.250, 'triangle', 0.213],
      [16.750, 329.63, 0.250, 'triangle', 0.213],
      [17.000, 261.63, 0.500, 'triangle', 0.213],
      [17.500, 293.66, 0.250, 'triangle', 0.213],
      [17.750, 329.63, 0.250, 'triangle', 0.213],
      [18.000, 261.63, 0.500, 'triangle', 0.213],
      [18.500, 261.63, 0.500, 'triangle', 0.213],
      [19.500, 293.66, 0.500, 'triangle', 0.213],
      [20.000, 329.63, 0.250, 'triangle', 0.213],
      [20.250, 293.66, 0.250, 'triangle', 0.213],
      [20.500, 329.63, 1.000, 'triangle', 0.213],
      [21.500, 392.00, 0.500, 'triangle', 0.213],
      [22.000, 440.00, 0.500, 'triangle', 0.213],
      [22.500, 523.25, 0.500, 'triangle', 0.213],
      [23.000, 392.00, 0.250, 'triangle', 0.213],
      [23.250, 440.00, 0.250, 'triangle', 0.213],
      [23.500, 349.23, 0.500, 'triangle', 0.213],
      [24.000, 329.63, 0.250, 'triangle', 0.213],
      [24.250, 293.66, 0.250, 'triangle', 0.213],
      [24.500, 329.63, 1.000, 'triangle', 0.213],
      [0.0, 130.81, 1.8, 'sine', 0.15],
      [2.0, 130.81, 1.8, 'sine', 0.15],
      [4.0, 130.81, 1.8, 'sine', 0.15],
      [6.0, 130.81, 1.8, 'sine', 0.15],
      [8.0, 130.81, 1.8, 'sine', 0.15],
      [10.0, 130.81, 1.8, 'sine', 0.15],
      [12.0, 130.81, 1.8, 'sine', 0.15],
      [14.0, 130.81, 1.8, 'sine', 0.15],
      [16.0, 130.81, 1.8, 'sine', 0.15],
      [18.0, 130.81, 1.8, 'sine', 0.15],
      [20.0, 130.81, 1.8, 'sine', 0.15],
      [22.0, 130.81, 1.8, 'sine', 0.15],
      [24.0, 130.81, 1.8, 'sine', 0.15]
    ],
    [
      [0.000, 329.63, 0.500, 'triangle', 0.213],
      [0.500, 392.00, 0.500, 'triangle', 0.213],
      [1.000, 293.66, 0.500, 'triangle', 0.213],
      [1.500, 329.63, 0.500, 'triangle', 0.213],
      [2.000, 392.00, 1.000, 'triangle', 0.213],
      [3.000, 587.33, 0.750, 'triangle', 0.213],
      [3.750, 659.26, 0.250, 'triangle', 0.213],
      [4.000, 523.25, 0.500, 'triangle', 0.213],
      [4.500, 493.88, 0.500, 'triangle', 0.213],
      [5.000, 440.00, 1.000, 'triangle', 0.213],
      [6.000, 440.00, 0.500, 'triangle', 0.213],
      [6.500, 587.33, 0.500, 'triangle', 0.213],
      [7.000, 587.33, 0.500, 'triangle', 0.213],
      [7.500, 440.00, 0.500, 'triangle', 0.213],
      [8.000, 523.25, 0.500, 'triangle', 0.213],
      [8.500, 493.88, 0.500, 'triangle', 0.213],
      [9.000, 440.00, 0.500, 'triangle', 0.213],
      [9.500, 392.00, 0.250, 'triangle', 0.213],
      [9.750, 440.00, 0.250, 'triangle', 0.213],
      [10.000, 523.25, 0.500, 'triangle', 0.213],
      [10.500, 523.25, 0.500, 'triangle', 0.213],
      [11.000, 329.63, 0.500, 'triangle', 0.213],
      [11.500, 392.00, 0.500, 'triangle', 0.213],
      [12.000, 440.00, 0.500, 'triangle', 0.213],
      [12.500, 523.25, 0.500, 'triangle', 0.213],
      [13.000, 440.00, 0.250, 'triangle', 0.213],
      [13.250, 392.00, 0.250, 'triangle', 0.213],
      [13.500, 329.63, 0.250, 'triangle', 0.213],
      [13.750, 392.00, 0.250, 'triangle', 0.213],
      [14.000, 293.66, 1.000, 'triangle', 0.213],
      [15.000, 329.63, 0.500, 'triangle', 0.213],
      [15.500, 329.63, 0.500, 'triangle', 0.213],
      [16.000, 293.66, 1.000, 'triangle', 0.213],
      [17.000, 587.33, 0.500, 'triangle', 0.213],
      [17.500, 587.33, 0.500, 'triangle', 0.213],
      [18.000, 523.25, 0.500, 'triangle', 0.213],
      [18.500, 523.25, 0.500, 'triangle', 0.213],
      [19.000, 587.33, 0.500, 'triangle', 0.213],
      [19.500, 587.33, 0.500, 'triangle', 0.213],
      [20.000, 440.00, 1.000, 'triangle', 0.213],
      [21.000, 440.00, 0.500, 'triangle', 0.213],
      [21.500, 587.33, 0.500, 'triangle', 0.213],
      [22.000, 523.25, 0.500, 'triangle', 0.213],
      [22.500, 523.25, 0.500, 'triangle', 0.213],
      [23.000, 329.63, 0.500, 'triangle', 0.213],
      [23.500, 392.00, 0.500, 'triangle', 0.213],
      [24.000, 440.00, 1.000, 'triangle', 0.213],
      [25.000, 523.25, 0.500, 'triangle', 0.213],
      [0.0, 130.81, 1.8, 'sine', 0.15],
      [2.0, 130.81, 1.8, 'sine', 0.15],
      [4.0, 130.81, 1.8, 'sine', 0.15],
      [6.0, 130.81, 1.8, 'sine', 0.15],
      [8.0, 130.81, 1.8, 'sine', 0.15],
      [10.0, 130.81, 1.8, 'sine', 0.15],
      [12.0, 130.81, 1.8, 'sine', 0.15],
      [14.0, 130.81, 1.8, 'sine', 0.15],
      [16.0, 130.81, 1.8, 'sine', 0.15],
      [18.0, 130.81, 1.8, 'sine', 0.15],
      [20.0, 130.81, 1.8, 'sine', 0.15],
      [22.0, 130.81, 1.8, 'sine', 0.15],
      [24.0, 130.81, 1.8, 'sine', 0.15]
    ],
    [
      [0.000, 659.26, 0.500, 'triangle', 0.213],
      [0.500, 880.00, 0.500, 'triangle', 0.213],
      [1.000, 659.26, 0.250, 'triangle', 0.213],
      [1.250, 783.99, 0.250, 'triangle', 0.213],
      [1.500, 659.26, 0.250, 'triangle', 0.213],
      [1.750, 587.33, 0.250, 'triangle', 0.213],
      [2.000, 659.26, 0.250, 'triangle', 0.213],
      [2.250, 587.33, 0.250, 'triangle', 0.213],
      [2.500, 523.25, 0.250, 'triangle', 0.213],
      [2.750, 493.88, 0.250, 'triangle', 0.213],
      [3.000, 440.00, 1.000, 'triangle', 0.213],
      [4.000, 880.00, 0.500, 'triangle', 0.213],
      [4.500, 880.00, 0.250, 'triangle', 0.213],
      [4.750, 987.77, 0.250, 'triangle', 0.213],
      [5.000, 880.00, 0.250, 'triangle', 0.213],
      [5.250, 783.99, 0.250, 'triangle', 0.213],
      [5.500, 659.26, 0.250, 'triangle', 0.213],
      [5.750, 783.99, 0.250, 'triangle', 0.213],
      [6.000, 880.00, 2.000, 'triangle', 0.213],
      [8.000, 880.00, 0.500, 'triangle', 0.213],
      [8.500, 880.00, 0.250, 'triangle', 0.213],
      [8.750, 987.77, 0.250, 'triangle', 0.213],
      [9.000, 880.00, 0.250, 'triangle', 0.213],
      [9.250, 783.99, 0.250, 'triangle', 0.213],
      [9.500, 659.26, 0.250, 'triangle', 0.213],
      [9.750, 783.99, 0.250, 'triangle', 0.213],
      [10.000, 880.00, 2.000, 'triangle', 0.213],
      [12.000, 880.00, 0.500, 'triangle', 0.213],
      [12.500, 880.00, 0.500, 'triangle', 0.213],
      [13.000, 1174.66, 0.500, 'triangle', 0.213],
      [13.500, 880.00, 0.250, 'triangle', 0.213],
      [13.750, 783.99, 0.250, 'triangle', 0.213],
      [14.000, 880.00, 0.500, 'triangle', 0.213],
      [14.500, 880.00, 0.500, 'triangle', 0.213],
      [15.000, 783.99, 0.500, 'triangle', 0.213],
      [15.500, 659.26, 0.500, 'triangle', 0.213],
      [16.000, 880.00, 0.500, 'triangle', 0.213],
      [16.500, 880.00, 0.250, 'triangle', 0.213],
      [16.750, 987.77, 0.250, 'triangle', 0.213],
      [17.000, 880.00, 0.250, 'triangle', 0.213],
      [17.250, 783.99, 0.250, 'triangle', 0.213],
      [17.500, 659.26, 0.500, 'triangle', 0.213],
      [18.000, 587.33, 0.750, 'triangle', 0.213],
      [18.750, 659.26, 0.250, 'triangle', 0.213],
      [19.000, 783.99, 0.250, 'triangle', 0.213],
      [19.250, 880.00, 0.250, 'triangle', 0.213],
      [19.500, 783.99, 0.250, 'triangle', 0.213],
      [19.750, 659.26, 0.250, 'triangle', 0.213],
      [20.000, 587.33, 0.500, 'triangle', 0.213],
      [20.500, 659.26, 0.250, 'triangle', 0.213],
      [20.750, 783.99, 0.250, 'triangle', 0.213],
      [21.000, 659.26, 0.250, 'triangle', 0.213],
      [21.250, 587.33, 0.250, 'triangle', 0.213],
      [21.500, 523.25, 0.250, 'triangle', 0.213],
      [21.750, 493.88, 0.250, 'triangle', 0.213],
      [22.000, 440.00, 2.000, 'triangle', 0.213],
      [24.000, 880.00, 0.500, 'triangle', 0.213],
      [24.500, 880.00, 0.250, 'triangle', 0.213],
      [24.750, 987.77, 0.250, 'triangle', 0.213],
      [25.000, 880.00, 0.250, 'triangle', 0.213],
      [0.0, 130.81, 1.8, 'sine', 0.15],
      [2.0, 130.81, 1.8, 'sine', 0.15],
      [4.0, 130.81, 1.8, 'sine', 0.15],
      [6.0, 130.81, 1.8, 'sine', 0.15],
      [8.0, 130.81, 1.8, 'sine', 0.15],
      [10.0, 130.81, 1.8, 'sine', 0.15],
      [12.0, 130.81, 1.8, 'sine', 0.15],
      [14.0, 130.81, 1.8, 'sine', 0.15],
      [16.0, 130.81, 1.8, 'sine', 0.15],
      [18.0, 130.81, 1.8, 'sine', 0.15],
      [20.0, 130.81, 1.8, 'sine', 0.15],
      [22.0, 130.81, 1.8, 'sine', 0.15],
      [24.0, 130.81, 1.8, 'sine', 0.15]
    ],
    [
      [0.000, 392.00, 0.500, 'triangle', 0.213],
      [0.500, 523.25, 0.500, 'triangle', 0.213],
      [1.000, 659.26, 1.000, 'triangle', 0.213],
      [2.000, 659.26, 0.500, 'triangle', 0.213],
      [2.500, 659.26, 0.500, 'triangle', 0.213],
      [3.000, 659.26, 1.000, 'triangle', 0.213],
      [4.000, 587.33, 0.500, 'triangle', 0.213],
      [4.500, 659.26, 0.500, 'triangle', 0.213],
      [5.000, 587.33, 0.500, 'triangle', 0.213],
      [5.500, 523.25, 0.500, 'triangle', 0.213],
      [6.000, 523.25, 2.000, 'triangle', 0.213],
      [8.000, 392.00, 0.500, 'triangle', 0.213],
      [8.500, 523.25, 0.500, 'triangle', 0.213],
      [9.000, 659.26, 1.000, 'triangle', 0.213],
      [10.000, 523.25, 0.500, 'triangle', 0.213],
      [10.500, 659.26, 0.500, 'triangle', 0.213],
      [11.000, 783.99, 1.000, 'triangle', 0.213],
      [12.000, 698.46, 0.500, 'triangle', 0.213],
      [12.500, 659.26, 0.500, 'triangle', 0.213],
      [13.000, 587.33, 3.000, 'triangle', 0.213],
      [16.000, 783.99, 0.500, 'triangle', 0.213],
      [16.500, 698.46, 0.500, 'triangle', 0.213],
      [17.000, 659.26, 1.000, 'triangle', 0.213],
      [18.000, 659.26, 0.500, 'triangle', 0.213],
      [18.500, 587.33, 0.500, 'triangle', 0.213],
      [19.000, 523.25, 1.000, 'triangle', 0.213],
      [20.000, 587.33, 0.500, 'triangle', 0.213],
      [20.500, 659.26, 0.500, 'triangle', 0.213],
      [21.000, 783.99, 0.500, 'triangle', 0.213],
      [21.500, 698.46, 0.500, 'triangle', 0.213],
      [22.000, 698.46, 2.000, 'triangle', 0.213],
      [24.000, 440.00, 0.500, 'triangle', 0.213],
      [24.500, 415.30, 0.500, 'triangle', 0.213],
      [25.000, 392.00, 1.000, 'triangle', 0.213],
      [0.0, 130.81, 1.8, 'sine', 0.15],
      [2.0, 130.81, 1.8, 'sine', 0.15],
      [4.0, 130.81, 1.8, 'sine', 0.15],
      [6.0, 130.81, 1.8, 'sine', 0.15],
      [8.0, 130.81, 1.8, 'sine', 0.15],
      [10.0, 130.81, 1.8, 'sine', 0.15],
      [12.0, 130.81, 1.8, 'sine', 0.15],
      [14.0, 130.81, 1.8, 'sine', 0.15],
      [16.0, 130.81, 1.8, 'sine', 0.15],
      [18.0, 130.81, 1.8, 'sine', 0.15],
      [20.0, 130.81, 1.8, 'sine', 0.15],
      [22.0, 130.81, 1.8, 'sine', 0.15],
      [24.0, 130.81, 1.8, 'sine', 0.15]
    ]
  ],

  MENU_MELODY:     [
      [0.000, 783.99, 1.400, 'sine', 0.138],
      [1.400, 659.26, 0.700, 'sine', 0.138],
      [2.100, 783.99, 0.700, 'sine', 0.138],
      [2.800, 1046.50, 2.800, 'sine', 0.138],
      [5.600, 880.00, 1.400, 'sine', 0.138],
      [7.000, 1046.50, 1.400, 'sine', 0.138],
      [8.400, 783.99, 2.800, 'sine', 0.138],
      [11.200, 783.99, 1.400, 'sine', 0.138],
      [12.600, 523.25, 0.700, 'sine', 0.138],
      [13.300, 587.33, 0.700, 'sine', 0.138],
      [14.000, 659.26, 1.400, 'sine', 0.138],
      [15.400, 587.33, 0.700, 'sine', 0.138],
      [16.100, 523.25, 0.700, 'sine', 0.138],
      [16.800, 587.33, 4.200, 'sine', 0.138],
      [22.400, 783.99, 1.400, 'sine', 0.138],
      [23.800, 659.26, 0.700, 'sine', 0.138],
      [24.500, 783.99, 0.700, 'sine', 0.138],
      [25.200, 1046.50, 2.100, 'sine', 0.138],
      [27.300, 987.77, 0.700, 'sine', 0.138],
      [28.000, 880.00, 1.400, 'sine', 0.138],
      [29.400, 1046.50, 1.400, 'sine', 0.138],
      [30.800, 783.99, 2.800, 'sine', 0.138],
      [33.600, 783.99, 1.400, 'sine', 0.138],
      [35.000, 587.33, 0.700, 'sine', 0.138],
      [0.0, 130.81, 1.8, 'sine', 0.15],
      [2.0, 130.81, 1.8, 'sine', 0.15],
      [4.0, 130.81, 1.8, 'sine', 0.15],
      [6.0, 130.81, 1.8, 'sine', 0.15],
      [8.0, 130.81, 1.8, 'sine', 0.15],
      [10.0, 130.81, 1.8, 'sine', 0.15],
      [12.0, 130.81, 1.8, 'sine', 0.15],
      [14.0, 130.81, 1.8, 'sine', 0.15],
      [16.0, 130.81, 1.8, 'sine', 0.15],
      [18.0, 130.81, 1.8, 'sine', 0.15],
      [20.0, 130.81, 1.8, 'sine', 0.15],
      [22.0, 130.81, 1.8, 'sine', 0.15],
      [24.0, 130.81, 1.8, 'sine', 0.15]
    ],


  phraseForLevel(level) {
    if (!this.playing || !this.ctx) return;
    this._currentMelody = 'level' + level;
    this.resume();

    // Отключить прошлый bus -> старые ноты мгновенно замолкают
    if (this._phraseBus) {
      try { this._phraseBus.disconnect(); } catch(e) {}
      this._phraseBus = null;
    }
    const bus = this.ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.musicGain);
    this._phraseBus = bus;

    const t = this.ctx.currentTime;
    const idx = (Math.max(1, level) - 1) % this.MELODIES.length;
    const M = this.MELODIES[idx];
    let maxT = 0;
    for (let i = 0; i < M.length; i++) {
      this.note(M[i][1], M[i][2], 'triangle', 0.24, bus, t + M[i][0]);
      if (M[i][0] + M[i][2] > maxT) maxT = M[i][0] + M[i][2];
    }
    for (let bt = 0; bt < maxT; bt += 2) {
      this.note(130.81, 2.0, 'sine', 0.18, bus, t + bt);
    }
    this.musicTimer = setTimeout(() => this.phraseForLevel(level), (maxT + 1.5) * 1000);
  },

  phrase() {
    this.phraseForLevel(Game.level || 1);
  },

  startMusic() {
    if (!settings.music) return;
    if (!this.ctx) this.init();
    if (!this.ctx) { console.warn('AudioContext unavailable'); return; }
    if (this.ctx.state === 'suspended') this.resume();
    if (this.playing) {
      // Если уже играет — перезапускаем с новой мелодией (для смены уровня)
      this.stopMusic();
    }
    this.playing = true;
    this.phraseForLevel(Game.level || 1);
  },
  stopMusic() {
    this.playing = false;
    if (this.musicTimer) { clearTimeout(this.musicTimer); this.musicTimer = null; }
    if (this._phraseBus) {
      try { this._phraseBus.disconnect(); } catch(e) {}
      this._phraseBus = null;
    }
  },
  applySettings() {
    if (!this.ctx) return;
    this.musicGain.gain.value = settings.music ? 0.8 : 0;
    this.sfxGain.gain.value = settings.sfx ? 0.8 : 0;
    if (settings.music) this.startMusic(); else this.stopMusic();
  }
};



// ===== SPRITES (16-bit palette) =====
const PAL = {
  tankBody: '#4a7c3a', tankLight: '#7ab85a', tankDark: '#2d4a24',
  tankShadow: '#1a2e15', barrel: '#5a8c4a', barrelTip: '#9ac87a',
  manTop: '#f0e6d2', manBot: '#1a1a1a', manSkin: '#d4a07a',
  pagodaRed: '#c1272d', pagodaDark: '#8b1a1a', pagodaRoof: '#d4a017',
  gold: '#d4a017', goldBright: '#f4c430',
  bgDeep: '#1a0f0a', bgMid: '#2a1a10', groundDark: '#1f1410', groundLight: '#2a1a12',
  wall: '#5a4a3a', wallLight: '#7a6a5a', wallDark: '#3a2a1a',
  barrier: '#6b4a2a', barrierLight: '#8a6a4a', barrierDark: '#4a2a1a',
  bullet: '#ffe066', bulletTrail: '#ff8800',
  cloud: '#3a2515',
};

// ===== RENDERER =====
const Renderer = {
  canvas: null, ctx: null,

  init() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  },

  clear() {
    this.ctx.fillStyle = PAL.bgDeep;
    this.ctx.fillRect(0, 0, CONFIG.SW, CONFIG.SH);
  },

  drawPagodas() {
    const c = this.ctx, W = CONFIG.SW;
    // Небо (верхняя полоса 120px)
    const sky = c.createLinearGradient(0, 0, 0, CONFIG.HUD);
    sky.addColorStop(0, '#3a1a1a'); sky.addColorStop(0.5, '#5a2a1a'); sky.addColorStop(1, '#1a0f0a');
    c.fillStyle = sky; c.fillRect(0, 0, W, CONFIG.HUD);

    // Далёкие пагоды (затемнённые)
    this._pagoda(60, 70, 0.6, '#4a1518');
    this._pagoda(740, 75, 0.5, '#3a1010');
    // Средние пагоды
    this._pagoda(180, 95, 0.85, '#7a2020');
    this._pagoda(620, 90, 0.8, '#6a1a1a');
    // Центральная главная (красная, яркая)
    this._pagoda(400, 100, 1.2, PAL.pagodaRed);
    // Декор — золотые шпили
    c.fillStyle = PAL.gold;
    c.fillRect(396, 8, 4, 16);
    c.fillRect(398, 4, 2, 6);

    // Облака (祥云) — тёмные полосы
    c.fillStyle = PAL.cloud;
    for (let i = 0; i < 5; i++) {
      const x = (i * 180 + 30) % W;
      c.fillRect(x, 30 + (i % 3) * 8, 40, 3);
      c.fillRect(x + 8, 27 + (i % 3) * 8, 24, 3);
    }

    // Разделитель (нижняя граница неба)
    c.fillStyle = PAL.gold; c.fillRect(0, CONFIG.HUD - 2, W, 2);
    c.fillStyle = PAL.pagodaDark; c.fillRect(0, CONFIG.HUD, W, 1);
  },

  _pagoda(cx, baseY, scale, color, levels) {
    levels = levels || 3;
    const c = this.ctx, W = 32 * scale, H = 24 * scale;
    c.fillStyle = color;
    c.fillRect(cx - W, baseY - H * 0.2, W * 2, H * 0.2);
    const step = 0.84 / levels;
    for (let i = 0; i < levels; i++) {
      const lvlY = baseY - H * 0.2 - i * H * step;
      const lvlW = W * (1 - i * (0.54 / levels)) * 1.2;
      c.fillStyle = color;
      c.fillRect(cx - lvlW, lvlY - H * 0.18, lvlW * 2, H * 0.18);
      c.fillStyle = PAL.pagodaRoof;
      c.fillRect(cx - lvlW * 1.15, lvlY - H * 0.22, lvlW * 2.3, H * 0.04);
      c.fillStyle = '#6a0a10';
      c.fillRect(cx - lvlW * 1.2, lvlY - H * 0.26, lvlW * 0.15, H * 0.06);
      c.fillRect(cx + lvlW * 1.05, lvlY - H * 0.26, lvlW * 0.15, H * 0.06);
      c.fillStyle = PAL.goldBright;
      c.fillRect(cx - lvlW * 0.9, lvlY - H * 0.21, lvlW * 0.3, 1);
    }
    const topY = baseY - H * 0.2 - levels * H * step - H * 0.1;
    c.fillStyle = PAL.gold;
    c.fillRect(cx - 1, topY, 2, H * 0.14);
    c.fillStyle = PAL.goldBright;
    c.fillRect(cx - 3, topY - 2, 6, 3);
  },

  drawGround() {
    const c = this.ctx;
    const FT = CONFIG.HUD, FB = CONFIG.HUD + CONFIG.FH;
    c.fillStyle = PAL.groundDark;
    c.fillRect(0, FT, CONFIG.FW, CONFIG.FH);
    c.fillStyle = PAL.groundLight;
    for (let row = 0; row < CONFIG.ROWS; row++) {
      for (let col = 0; col < CONFIG.COLS; col++) {
        if ((row + col) % 2 === 0) {
          c.fillRect(col * CONFIG.CELL_W, FT + row * CONFIG.CELL_H, CONFIG.CELL_W, CONFIG.CELL_H);
        }
      }
    }
    c.strokeStyle = 'rgba(80,60,40,0.15)';
    c.lineWidth = 1;
    for (let col = 0; col <= CONFIG.COLS; col++) {
      c.beginPath(); c.moveTo(col * CONFIG.CELL_W, FT); c.lineTo(col * CONFIG.CELL_W, FB); c.stroke();
    }
    for (let row = 0; row <= CONFIG.ROWS; row++) {
      c.beginPath(); c.moveTo(0, FT + row * CONFIG.CELL_H); c.lineTo(CONFIG.FW, FT + row * CONFIG.CELL_H); c.stroke();
    }
    c.fillStyle = '#1a0a05';
    c.fillRect(0, FT, CONFIG.FW, 2);
    c.fillRect(0, FB - 2, CONFIG.FW, 2);
  },

  drawTank(px, py, dir, isHead) {
    const c = this.ctx, SW = CONFIG.CELL_W, SH = CONFIG.CELL_H;
    c.fillStyle = PAL.tankShadow;
    c.fillRect(px + 1, py + SH - 2, SW - 2, 2);
    c.fillStyle = PAL.tankBody;
    c.fillRect(px + 1, py + 4, SW - 2, SH - 6);
    c.fillStyle = PAL.tankLight;
    c.fillRect(px + 1, py + 4, SW - 2, 3);
    c.fillStyle = PAL.tankDark;
    c.fillRect(px + 1, py + SH - 4, SW - 2, 2);
    c.fillStyle = PAL.tankShadow;
    c.fillRect(px + 1, py + 6, 2, SH - 8);
    c.fillRect(px + SW - 3, py + 6, 2, SH - 8);
    c.fillStyle = PAL.tankDark;
    for (let i = 0; i < 3; i++) {
      c.fillRect(px + 1, py + 8 + i * 4, 2, 1);
      c.fillRect(px + SW - 3, py + 8 + i * 4, 2, 1);
    }
    if (isHead) {
      const cx = px + SW / 2, cy = py + SH / 2;
      c.fillStyle = PAL.tankDark;
      c.fillRect(cx - 4, cy - 4, 8, 8);
      c.fillStyle = PAL.tankBody;
      c.fillRect(cx - 3, cy - 3, 6, 6);
      c.fillStyle = PAL.barrel;
      if (dir === 'up')    { c.fillRect(cx - 1, py + 1, 2, 8); c.fillStyle = PAL.barrelTip; c.fillRect(cx - 1, py + 1, 2, 2); }
      if (dir === 'down')  { c.fillRect(cx - 1, py + SH - 9, 2, 8); c.fillStyle = PAL.barrelTip; c.fillRect(cx - 1, py + SH - 3, 2, 2); }
      if (dir === 'left')  { c.fillRect(px + 1, cy - 1, 8, 2); c.fillStyle = PAL.barrelTip; c.fillRect(px + 1, cy - 1, 2, 2); }
      if (dir === 'right') { c.fillRect(px + SW - 9, cy - 1, 8, 2); c.fillStyle = PAL.barrelTip; c.fillRect(px + SW - 3, cy - 1, 2, 2); }
    }
  },

  drawMan(px, py, item, isMoving, kind) {
    const c = this.ctx, SW = CONFIG.CELL_W, SH = CONFIG.CELL_H, W = 16, H = 16;
    const ox = px + (SW - W) / 2, oy = py + (SH - H) / 2;
    // Ноги (чёрный низ)
    c.fillStyle = PAL.manBot;
    const legOff = isMoving ? 1 : 0;
    c.fillRect(ox + 4, oy + 12, 3, 4 - legOff);
    c.fillRect(ox + 9, oy + 12, 3, 4 - legOff);
    // Туловище — цвет по kind
    c.fillStyle = (kind === 1) ? '#d4e6f0' : (kind === 2 ? '#e0c0b0' : PAL.manTop);
    c.fillRect(ox + 4, oy + 6, 8, 6);
    // Голова
    c.fillStyle = PAL.manSkin;
    c.fillRect(ox + 6, oy + 2, 4, 4);
    // Головной убор
    if (kind === 1) {
      c.fillStyle = '#d4a017'; c.fillRect(ox + 4, oy, 8, 2); c.fillRect(ox + 5, oy + 2, 6, 1);
    } else if (kind === 2) {
      c.fillStyle = '#c1272d'; c.fillRect(ox + 4, oy, 8, 3);
    }
    // Глаза
    c.fillStyle = '#000';
    c.fillRect(ox + 6, oy + 3, 1, 1);
    c.fillRect(ox + 9, oy + 3, 1, 1);
    // Предмет в руках (значок)
    this._itemIcon(ox + 12, oy + 6, 4, item);
  },

  _itemIcon(x, y, s, item) {
    const c = this.ctx;
    switch (item) {
      case 'sign':     c.fillStyle = '#8a6a4a'; c.fillRect(x, y, s, s); c.fillStyle = '#000'; c.fillRect(x+1, y+1, s-2, 1); break;
      case 'stone':    c.fillStyle = '#888'; c.beginPath(); c.arc(x+s/2, y+s/2, s/2-0.5, 0, Math.PI*2); c.fill(); break;
      case 'bag':      c.fillStyle = '#a06a3a'; c.fillRect(x, y+1, s, s-1); c.fillStyle = '#6a4a2a'; c.fillRect(x+1, y+1, s-2, 1); break;
      case 'umbrella': c.fillStyle = '#c1272d'; c.beginPath(); c.moveTo(x+s/2, y); c.lineTo(x+s, y+s*0.7); c.lineTo(x, y+s*0.7); c.closePath(); c.fill(); c.fillStyle = '#000'; c.fillRect(x+s/2-0.5, y+s*0.7, 1, s*0.3); break;
      case 'bicycle':  c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(x+1, y+s-1, 2, 0, Math.PI*2); c.moveTo(x+s-1, y+s-1); c.arc(x+s-1, y+s-1, 2, 0, Math.PI*2); c.stroke(); break;
      case 'bench':    c.fillStyle = '#8a6a4a'; c.fillRect(x, y+2, s, 1); c.fillRect(x, y+s-1, s, 1); break;
      case 'trash':    c.fillStyle = '#5a5a5a'; c.fillRect(x+1, y, s-2, s); c.fillStyle = '#3a3a3a'; c.fillRect(x, y, s, 1); break;
      case 'metal':    c.fillStyle = '#777'; c.fillRect(x, y, s, 2); c.fillRect(x+s-2, y, 2, s); break;
      case 'tree':     c.fillStyle = '#4a7c3a'; c.fillRect(x+1, y, s-2, s-2); c.fillStyle = '#2d4a24'; c.fillRect(x+s/2-1, y+s-2, 2, 2); break;
    }
  },

  drawBarrier(px, py, item) {
    const c = this.ctx, SW = CONFIG.CELL_W, SH = CONFIG.CELL_H;
    c.fillStyle = PAL.barrier;
    c.fillRect(px + 1, py + 1, SW - 2, SH - 2);
    c.fillStyle = PAL.barrierLight;
    c.fillRect(px + 1, py + 1, SW - 2, 3);
    c.fillStyle = PAL.barrierDark;
    c.fillRect(px + 1, py + SH - 4, SW - 2, 3);
    this._itemIcon(px + 5, py + 3, SW - 10, item || 'sign');
  },

  drawBike(px, py) {
    const c = this.ctx, SW = CONFIG.CELL_W, SH = CONFIG.CELL_H;
    const cx = px + SW/2, cy = py + SH/2;
    const wheelR = 6;
    const leftWX = cx - 7, rightWX = cx + 7, wy = cy + 3;

    // Тень под велосипедом
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(cx, wy + 4, 10, 1.5, 0, 0, Math.PI * 2); c.fill();

    // Колёса: резина + обод
    for (const wx of [leftWX, rightWX]) {
      // Покрышка (тёмная)
      c.strokeStyle = '#1a1a1a'; c.lineWidth = 2;
      c.beginPath(); c.arc(wx, wy, wheelR, 0, Math.PI * 2); c.stroke();
      // Обод (светлый)
      c.strokeStyle = '#c0c0c0'; c.lineWidth = 0.8;
      c.beginPath(); c.arc(wx, wy, wheelR - 1.2, 0, Math.PI * 2); c.stroke();
      // Спицы
      c.strokeStyle = 'rgba(200,200,200,0.6)'; c.lineWidth = 0.5;
      for (let a = 0; a < 4; a++) {
        const ang = a * Math.PI / 2 + Math.PI / 4;
        c.beginPath();
        c.moveTo(wx + Math.cos(ang) * (wheelR - 1.2), wy + Math.sin(ang) * (wheelR - 1.2));
        c.lineTo(wx - Math.cos(ang) * (wheelR - 1.2), wy - Math.sin(ang) * (wheelR - 1.2));
        c.stroke();
      }
      // Втулка
      c.fillStyle = '#666';
      c.beginPath(); c.arc(wx, wy, 1, 0, Math.PI * 2); c.fill();
    }

    // Рама — треугольник + задний треугольник (классический велосипед)
    c.strokeStyle = '#a06a3a'; c.lineWidth = 1.8;
    // Верхняя труба (seat → руль)
    c.beginPath(); c.moveTo(leftWX + 1, wy - 2); c.lineTo(rightWX - 2, wy - 5); c.stroke();
    // Нижняя труба (каретка → руль)
    c.beginPath(); c.moveTo(cx, wy + 2); c.lineTo(rightWX - 2, wy - 5); c.stroke();
    // Подседельная труба (каретка → седло)
    c.beginPath(); c.moveTo(cx, wy + 2); c.lineTo(leftWX + 1, wy - 2); c.stroke();
    // Заднее перо (каретка → заднее колесо)
    c.beginPath(); c.moveTo(cx, wy + 2); c.lineTo(leftWX, wy); c.stroke();
    // Передняя вилка (руль → переднее колесо)
    c.beginPath(); c.moveTo(rightWX - 2, wy - 5); c.lineTo(rightWX, wy); c.stroke();

    // Седло (коричневое, немного вытянуто)
    c.fillStyle = '#5a2a1a';
    c.beginPath();
    c.moveTo(leftWX - 2, wy - 4);
    c.lineTo(leftWX + 4, wy - 4);
    c.lineTo(leftWX + 3, wy - 2);
    c.lineTo(leftWX - 2, wy - 2);
    c.closePath(); c.fill();

    // Руль (загнутый, металлический)
    c.strokeStyle = '#888'; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(rightWX - 3, wy - 6);
    c.lineTo(rightWX + 2, wy - 8);
    c.lineTo(rightWX + 4, wy - 8);
    c.stroke();

    // Педали (звёздочка + рычаг)
    c.fillStyle = '#888';
    c.beginPath(); c.arc(cx, wy + 2, 1.8, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#666'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx - 3, wy + 4); c.lineTo(cx + 3, wy); c.stroke();

    // Фара (маленькая жёлтая точка на руле)
    c.fillStyle = '#ffe066';
    c.beginPath(); c.arc(rightWX + 4, wy - 6, 1, 0, Math.PI * 2); c.fill();
  },

  drawBullet(px, py) {
    const c = this.ctx;
    c.fillStyle = PAL.bulletTrail;
    c.fillRect(px - 1, py - 1, 4, 4);
    c.fillStyle = PAL.bullet;
    c.fillRect(px, py, 2, 2);
  },

  drawTop(score, best, level, current, target) {
    const c = this.ctx, W = CONFIG.SW;
    // === Небо (пагоды) 0..70 ===
    const sky = c.createLinearGradient(0, 0, 0, 70);
    sky.addColorStop(0, '#4a1a1a'); sky.addColorStop(1, '#1a0f0a');
    c.fillStyle = sky; c.fillRect(0, 0, W, 70);
    // Пагоды: одна большая по центру (многоуровневая), две маленькие по краям
// Пагоды: большая 5-ярусная по центру, маленькие 1-ярусные по краям
    this._pagoda(60, 65, 1.2, '#a01a20', 1);
    this._pagoda(740, 65, 1.2, '#a01a20', 1);
    this._pagoda(400, 68, 4.0, PAL.pagodaRed, 5);
    c.fillStyle = PAL.gold;
    c.fillRect(398, 4, 4, 18);
    c.fillRect(399, 0, 2, 6);

    // === Красная стена 70..130 ===
    const wallGrad = c.createLinearGradient(0, 70, 0, 130);
    wallGrad.addColorStop(0, '#b01a20'); wallGrad.addColorStop(0.5, '#8a1218'); wallGrad.addColorStop(1, '#6a0a10');
    c.fillStyle = wallGrad; c.fillRect(0, 70, W, 60);
    c.fillStyle = PAL.gold; c.fillRect(0, 70, W, 3);
    c.fillStyle = PAL.gold; c.fillRect(0, 128, W, 2);
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { c.beginPath(); c.moveTo(x, 73); c.lineTo(x, 128); c.stroke(); }
    for (let y = 80; y < 128; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = PAL.goldBright;
    c.font = 'bold 34px "Noto Serif SC", serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('\u6e38', 130, 100);
    c.fillText('\u9f99', 180, 100);
    c.fillText('\u620f', 660, 100);
    c.fillText('\u73e0', 710, 100);

    this._drawBoard(score, best, level, current, target);
    this._drawBanner(400);
  },

  _drawBoard(score, best, level, current, target) {
    const c = this.ctx;
    const bx = 220, by = 78, bw = 360, bh = 46;
    c.fillStyle = '#0a0505'; c.fillRect(bx, by, bw, bh);
    c.strokeStyle = PAL.gold; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    c.strokeStyle = PAL.goldBright; c.lineWidth = 1; c.strokeRect(bx + 3, by + 3, bw - 6, bh - 6);
    c.strokeStyle = 'rgba(255,255,255,0.15)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(bx + 60, by + 6); c.lineTo(bx + 60, by + bh - 6); c.stroke();
    c.beginPath(); c.moveTo(bx + 180, by + 6); c.lineTo(bx + 180, by + bh - 6); c.stroke();
    c.beginPath(); c.moveTo(bx + 300, by + 6); c.lineTo(bx + 300, by + bh - 6); c.stroke();
    c.fillStyle = PAL.gold; c.font = 'bold 9px monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('SCORE', bx + 30, by + 6);
    c.fillStyle = PAL.goldBright; c.font = 'bold 22px monospace'; c.textBaseline = 'middle';
    c.fillText(String(score).padStart(5, '0'), bx + 30, by + 27);
    c.fillStyle = PAL.gold; c.font = 'bold 9px monospace'; c.textBaseline = 'top';
    c.fillText('BEST', bx + 120, by + 6);
    c.fillStyle = PAL.goldBright; c.font = 'bold 22px monospace'; c.textBaseline = 'middle';
    c.fillText(String(best).padStart(5, '0'), bx + 120, by + 27);
    this._drawPortrait(bx + 180 - 22, by + 6, 44, 34);
    c.fillStyle = PAL.gold; c.font = 'bold 9px monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('LEVEL', bx + 240, by + 6);
    const lvl = '\u7b2c' + this._cn(level) + '\u5173';
    c.fillStyle = PAL.goldBright; c.font = 'bold 18px "Noto Serif SC", serif'; c.textBaseline = 'middle';
    c.fillText(lvl, bx + 240, by + 27);
    c.fillStyle = PAL.gold; c.font = 'bold 9px monospace'; c.textAlign = 'center'; c.textBaseline = 'top';
    c.fillText('COLUMN', bx + 330, by + 6);
    const colTxt = current + '/' + target;
    c.fillStyle = current >= target ? PAL.goldBright : '#ff5533';
    c.font = 'bold 18px monospace'; c.textBaseline = 'middle';
    c.fillText(colTxt, bx + 330, by + 27);
  },

  _drawPortrait(x, y, w, h) {
    const c = this.ctx;
    c.fillStyle = '#1a0a0a'; c.fillRect(x - 2, y - 2, w + 4, h + 4);
    c.strokeStyle = PAL.gold; c.lineWidth = 2; c.strokeRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = '#2a1a0a'; c.fillRect(x, y, w, h);
    c.fillStyle = '#d4a07a'; c.fillRect(x + 10, y + 6, 24, 22);
    c.fillStyle = '#1a0a0a';
    c.fillRect(x + 8, y + 4, 28, 8);
    c.fillRect(x + 8, y + 10, 4, 20);
    c.fillRect(x + 32, y + 10, 4, 20);
    c.fillStyle = '#000';
    c.fillRect(x + 14, y + 16, 3, 3);
    c.fillRect(x + 27, y + 16, 3, 3);
    c.fillStyle = '#c1272d';
    c.fillRect(x + 15, y + 17, 1, 1);
    c.fillRect(x + 28, y + 17, 1, 1);
    c.fillStyle = '#8a1218';
    c.fillRect(x + 12, y + 22, 8, 1);
    c.fillRect(x + 24, y + 22, 8, 1);
    c.fillStyle = '#3a1a0a';
    c.fillRect(x + 16, y + 26, 12, 4);
    c.fillStyle = PAL.gold;
    c.font = 'bold 9px "Noto Serif SC", serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('\u5251', x + w / 2, y + h - 3);
  },

  _drawBanner(cx) {
    const c = this.ctx;
    c.fillStyle = PAL.gold;
    c.fillRect(cx - 2, 5, 4, 65);
    c.fillStyle = PAL.goldBright;
    c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx - 5, 8); c.lineTo(cx + 5, 8); c.closePath(); c.fill();
    c.fillStyle = PAL.gold;
    c.fillRect(cx - 60, 8, 120, 3);
    const flagW = 120, flagH = 58, flagX = cx - 60, flagY = 11;
    c.fillStyle = '#5a0810';
    c.fillRect(flagX - 2, flagY - 2, flagW + 4, flagH + 4);
    c.fillStyle = '#c1272d';
    c.fillRect(flagX, flagY, flagW, flagH);
    c.fillStyle = PAL.gold;
    c.fillRect(flagX, flagY, flagW, 4);
    c.fillRect(flagX, flagY + flagH - 4, flagW, 4);
    c.fillRect(flagX, flagY, 4, flagH);
    c.fillRect(flagX + flagW - 4, flagY, 4, flagH);
    c.strokeStyle = PAL.goldBright;
    c.lineWidth = 1;
    c.strokeRect(flagX + 7, flagY + 7, flagW - 14, flagH - 14);
    c.fillStyle = PAL.goldBright;
    c.font = 'bold 38px "Noto Serif SC", serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('\u9f99', cx, flagY + flagH / 2 + 2);
    c.fillStyle = PAL.gold;
    for (let i = 0; i < 6; i++) {
      c.fillRect(flagX + 6 + i * 20, flagY + flagH + 1, 4, 6);
    }
  },

  drawBottom() {
    const c = this.ctx;
    const y = CONFIG.SH - CONFIG.BOTTOM_H;
    const grad = c.createLinearGradient(0, y, 0, CONFIG.SH);
    grad.addColorStop(0, '#4a4a4a');
    grad.addColorStop(0.3, '#5a5a5a');
    grad.addColorStop(1, '#2a2a2a');
    c.fillStyle = grad; c.fillRect(0, y, CONFIG.SW, CONFIG.BOTTOM_H);
    c.fillStyle = '#7a7a7a'; c.fillRect(0, y, CONFIG.SW, 2);
    for (let x = 40; x < CONFIG.SW; x += 80) {
      c.fillStyle = '#3a3a3a'; c.fillRect(x - 8, y + 4, 16, CONFIG.BOTTOM_H - 4);
      c.fillStyle = '#6a6a6a'; c.fillRect(x - 7, y + 4, 2, CONFIG.BOTTOM_H - 4);
      c.fillStyle = PAL.gold; c.fillRect(x - 3, y + 2, 6, 4);
    }
    for (let x = 0; x < CONFIG.SW; x += 8) {
      c.strokeStyle = '#8a8a8a'; c.lineWidth = 1.5;
      c.beginPath();
      if (x % 16 === 0) {
        c.ellipse(x + 4, y + 8, 3, 2, 0, 0, Math.PI * 2);
      } else {
        c.arc(x + 4, y + 8, 2, 0, Math.PI * 2);
      }
      c.stroke();
    }
    for (let x = 120; x < CONFIG.SW; x += 160) {
      c.fillStyle = '#c1272d';
      c.beginPath(); c.ellipse(x, y + 14, 6, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = PAL.gold; c.fillRect(x - 3, y + 5, 6, 2);
      c.fillRect(x - 3, y + 22, 6, 2);
    }
  },

  _cn(n) {
    const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (n <= 10) return d[n] || String(n);
    if (n < 20) return '十' + (d[n - 10] || '');
    return String(n);
  },

  drawStageIntro(level, target) {
    const c = this.ctx;
    c.fillStyle = 'rgba(26, 15, 10, 0.75)';
    c.fillRect(0, 0, CONFIG.SW, CONFIG.SH);
    const lvlName = '第' + this._cn(level) + '关';
    c.fillStyle = '#c1272d';
    c.font = 'bold 96px "Noto Serif SC", monospace';
    c.textAlign = 'center';
    c.fillText(lvlName, CONFIG.SW / 2, CONFIG.SH / 2 - 20);
    c.fillStyle = PAL.gold;
    c.font = 'bold 24px monospace';
    c.fillText('Цель: собрать ' + target + ' танков', CONFIG.SW / 2, CONFIG.SH / 2 + 60);
  },

  drawGameOver(score) {
    const c = this.ctx;
    c.fillStyle = 'rgba(26, 15, 10, 0.9)';
    c.fillRect(0, 0, CONFIG.SW, CONFIG.SH);
    c.fillStyle = '#c1272d';
    c.font = 'bold 72px "Noto Serif SC", monospace';
    c.textAlign = 'center';
    c.fillText('游戏结束', CONFIG.SW / 2, CONFIG.SH / 2 - 40);
    c.fillStyle = PAL.gold;
    c.font = 'bold 20px monospace';
    c.fillText('GAME OVER', CONFIG.SW / 2, CONFIG.SH / 2);
    c.fillStyle = PAL.goldBright;
    c.font = 'bold 48px monospace';
    c.fillText(String(score), CONFIG.SW / 2, CONFIG.SH / 2 + 70);
  },
};


// ===== GAME =====
const Game = {
  _storyCards: [
    { img: 'story_card1_shop.svg', title: '\u0423\u043b\u0438\u0446\u0430. \u041c\u0430\u0433\u0430\u0437\u0438\u043d \u00ab\u041f\u0440\u043e\u0434\u0443\u043a\u0442\u044b\u00bb', lines: [
      { speaker: '\u5b66\u751f (\u0421\u0442\u0443\u0434\u0435\u043d\u0442)', text: '\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0430\u043a\u0446\u0438\u044f. \u0410\u043f\u0435\u043b\u044c\u0441\u0438\u043d\u044b \u043f\u043e \u0440\u0443\u0431\u043b\u044e, \u0430\u0432\u043e\u0441\u044c\u043a\u0430 \u0442\u044f\u0436\u0451\u043b\u0430\u044f. \u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0431\u0443\u0434\u0435\u0442 \u043a\u0430\u0440\u0442\u043e\u0448\u043a\u0430 \u0441 \u0430\u043f\u0435\u043b\u044c\u0441\u0438\u043d\u0430\u043c\u0438.' },
      { speaker: '\u5b66\u751f', text: '...\u0438 \u043a\u043e\u043c\u043f\u043e\u0442! \u0412\u0441\u0451, \u0438\u0434\u0443 \u0434\u043e\u043c\u043e\u0439 \u0443\u0447\u0438\u0442\u044c \u043c\u0430\u0442\u0430\u043d\u0430\u043b\u0438\u0437.' }
    ]},
    { img: 'story_card2_tank.svg', title: '\u0423\u043b\u0438\u0446\u0430. \u0412\u043d\u0435\u0437\u0430\u043f\u043d\u043e', lines: [
      { speaker: '\u5b66\u751f', text: '\u0427\u0442\u043e \u044d\u0442\u043e?! \u042d\u0442\u043e... \u0442\u0430\u043d\u043a?!' },
      { speaker: '\u6307\u6325\u5b98 (\u041a\u043e\u043c\u0430\u043d\u0434\u0438\u0440)', text: '\u0421\u0422\u041e\u0419! \u0414\u043e\u0440\u043e\u0433\u0443 \u043a\u043e\u043b\u043e\u043d\u043d\u0435!' },
      { speaker: '\u5b66\u751f', text: '\u0410-\u0430-\u0430! \u0410\u0432\u043e\u0441\u044c\u043a\u0430! \u0410\u043f\u0435\u043b\u044c\u0441\u0438\u043d\u044b!' }
    ]},
    { img: 'story_card3_square.svg', title: '\u041f\u043b\u043e\u0449\u0430\u0434\u044c. \u0422\u0430\u043d\u043a\u0438', lines: [
      { speaker: '\u5b66\u751f', text: '\u0422\u0430\u043d\u043a\u0438! \u0412\u0441\u044e\u0434\u0443 \u0442\u0430\u043d\u043a\u0438!' },
      { speaker: '\u5b66\u751f 2', text: '\u0411\u0435\u0433\u0438 \u0437\u0430 \u043c\u043d\u043e\u0439! \u041d\u0430 \u043f\u043b\u043e\u0449\u0430\u0434\u0438 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u0435\u0435!' }
    ]},
    { img: 'story_scene.svg', title: '\u041a\u043e\u043b\u043e\u043d\u043d\u0430 \u0432\u044b\u0434\u0432\u0438\u0433\u0430\u0435\u0442\u0441\u044f', lines: [
      { speaker: '\u6307\u6325\u5b98', text: '\u0412 \u0430\u0442\u0430\u043a\u0443, \u0440\u0435\u0431\u044f\u0442\u0430! \u0412\u043f\u0435\u0440\u0451\u0434!' },
      { speaker: '\u5b66\u751f', text: '\u0414\u0430 \u0447\u0442\u043e \u0436\u0435 \u044d\u0442\u043e \u0442\u0430\u043a\u043e\u0435... \u0413\u043e\u0441\u043f\u043e\u0434\u0438.' }
    ]}
  ],

  _levelCutscenes: {
    2: { img: 'story_level2_crowd.svg', lines: [
      { speaker: '指挥官', text: 'Студенты собираются на площади. Плакаты, мегафоны.' },
      { speaker: '学生 (Вася)', text: 'Мы не сдадимся!' }
    ]},
    3: { img: 'story_level3_bikes.svg', lines: [
      { speaker: '指挥官', text: 'Студенты стали бросать велосипеды!' },
      { speaker: '学生', text: 'Берегись! Велосипед летит в танк!' }
    ]},
    4: { img: 'story_level4_barricades.svg', lines: [
      { speaker: '指挥官', text: 'Они тащат баррикады!' },
      { speaker: '学生 2', text: 'Не проедешь!' }
,
      { speaker: 'Студент', text: 'Несите баррикады к верхней стене! Если вся стена будет загорожена — поражение. Стреляй по ним, чтобы очистить стену!' }    ]},
    5: { img: 'story_level5_shoot.svg', lines: [
      { speaker: '指挥官', text: 'Огонь! Стреляй по баррикадам!' },
      { speaker: '学生', text: 'Бан! Дорогу!' }
    ]},
    6: { img: 'story_level6_base.svg', lines: [
      { speaker: '学生', text: 'Строим штаб! Тащим всё!' },
      { speaker: '指挥官', text: 'Не проедем легко.' }
    ]},
    7: { img: 'story_level7_breakthrough.svg', lines: [
      { speaker: '指挥官', text: 'Вперёд! Ломаем баррикады!' },
      { speaker: '学生', text: 'Они прорвались!' }
    ]},
    8: { img: 'story_level8_stones.svg', lines: [
      { speaker: '学生', text: 'Кидайте камни!' },
      { speaker: '指挥官', text: 'Они бросают в нас всё.' }
    ]},
    9: { img: 'story_level9_laststand.svg', lines: [
      { speaker: '学生 (Вася)', text: 'Это наш последний рубеж!' },
      { speaker: '指挥官', text: 'Сломаем их дух.' }
    ]},
    10: { img: 'story_level10_vasya.svg', lines: [
      { speaker: '学生 (Вася)', text: 'Я прорвусь!' },
      { speaker: '指挥官', text: 'Открыть огонь!' }
    ]}
  },

  state: STATE.TITLE,
  level: 1, score: 0, best: 0,
  head: null, tail: [], stuckTanks: [],
  men: [], barriers: [], bullets: [], bikes: [],
  direction: 'right', pendingDir: null, pendingStart: false,

  // === COMBO ===
  _combo: 0,
  _comboTs: 0,
  COMBO_GAP: 3000,      // 3 секунды между ударами

  // === JUICE ===
  _trauma: 0,           // screen shake trauma 0..1
  _particles: [],       // [{x, y, vx, vy, life, maxLife, color, size}]
  _floats: [],          // [{x, y, vy, text, life, maxLife, color}]
  _flash: null,         // {color, alpha, decay}
  _hitstop: 0,          // frames left

  target: 10, tickCount: 0,
  _eaten: 0, _wallShots: 0, _wallShotsAfterEat: 0,
  manSpawnTimer: 0, lastManSpawn: 0,
  anim: false,

  start() {
    this.state = STATE.PLAYING;
    this.level = 1; this.score = 0;
    this.best = highscores.length > 0 ? highscores[0].score : 0;
    this.loadLevel();
    UI.setHUD(true);
    UI.showScreen(null);
    // Музыка стартует после интро (в startStageIntro)
  },

  loadLevel() {
    this.target = CONFIG.TARGETS[Math.min(this.level - 1, CONFIG.TARGETS.length - 1)];
    this.head = { col: 15, row: 10, dir: 'right' };
    this.tail = [];
    this.stuckTanks = [];
    this.men = [];
    this.barriers = [];
    this.bullets = [];
    this.bikes = [];
    this.direction = 'right';
    this.pendingDir = null;
    this.pendingStart = false;
    this.tickCount = 0;
    this.manSpawnTimer = 0;
    this.lastManSpawn = performance.now();
    this.anim = false;
    this._eaten = 0;
    this._wallShots = 0;
    this._wallShotsAfterEat = 0;
    // На старте — 2 человечка на поле
    for (let i = 0; i < 2; i++) this.spawnMan();
    UI.updateHUD();
  },

  startStageIntro() {
    this.state = STATE.INTRO;
    UI.showScreen(null);
    const self = this;
    function doStage() {
      UI.showStageIntro(self.level, self.target);
      Audio.stopMusic();
      setTimeout(() => {
        if (self.state === STATE.INTRO) {
          self.state = STATE.PLAYING;
          UI.hideStageIntro();
          UI.setHUD(true);
          Audio.startMusic();
        }
      }, 2400);
    }
    if (typeof CutSceneLoader !== 'undefined') {
      CutSceneLoader.prepareForLevel(this.level).then(function (cuts) {
        if (cuts && cuts.length > 0) {
          UI.showCutSet(cuts, function () {
            self.state = STATE.INTRO;
            doStage();
          });
        } else {
          doStage();
        }
      }).catch(function () { doStage(); });
    } else {
      doStage();
    }
  },

  spawnMan() {
    const _maxMen = (this.level === 4) ? 12 : ((this.level === 5) ? 8 : CONFIG.MAX_MEN);
    if (this.men.length >= _maxMen) return;
    let tries = 0;
    while (tries++ < 50) {
      const col = Math.floor(Math.random() * CONFIG.COLS);
      const row = Math.floor(Math.random() * CONFIG.ROWS);
      if (!this.isOccupied(col, row)) {
        const kind = this.level >= 2 ? Math.floor(Math.random() * 3) : 0;
        const now = performance.now();
        const isCarrier = this.level >= 4 && Math.random() < (this.level === 4 ? 0.95 : 0.6);

        if (isCarrier) {
          const sx = Math.floor(Math.random() * CONFIG.COLS);
          const sy = CONFIG.ROWS - 1;
          if (this.isOccupied(sx, sy)) continue;
          const tx = 3 + Math.floor(Math.random() * (CONFIG.COLS - 6));
          const ty = 0; // уровень 4+: несут баррикады к верхней стене
          this.men.push({
            col: sx, row: sy, kind,
            item: 'bicycle',
            carrying_barrier: true,
            targetCol: tx, targetRow: ty,
            nextMove: now + CONFIG.MAN_TICK / 2,
            tickMs: CONFIG.MAN_TICK / 2,
            throwTimer: 0,
            hasBike: false,
            hasThrownBike: true
          });
          return;
        }

        // Level 3: throwers (has bike, 2x speed, one throw)
        const isThrower = (this.level === 3 && Math.random() < 0.5) || (this.level === 5 && Math.random() < 0.5);

        this.men.push({
          col, row, kind,
          item: isThrower ? 'bicycle' : ITEMS[Math.floor(Math.random() * ITEMS.length)],
          carrying_barrier: false,
          nextMove: now + (isThrower ? CONFIG.MAN_TICK / 2 : CONFIG.MAN_TICK),
          tickMs: isThrower ? CONFIG.MAN_TICK / 2 : CONFIG.MAN_TICK,
          throwTimer: isThrower ? (now + 2500 + Math.random() * 3000) : 0,
          hasBike: isThrower,
          hasThrownBike: false
        });
        return;
      }
    }
  },

  isOccupied(col, row, exceptMan) {
    if (this.head && this.head.col === col && this.head.row === row) return true;
    for (const t of this.tail) if (t.col === col && t.row === row) return true;
    for (const s of this.stuckTanks) if (s.col === col && s.row === row) return true;
    for (const m of this.men) {
      if (m === exceptMan) continue;
      if (m.col === col && m.row === row) return true;
    }
    for (const b of this.barriers) if (b.col === col && b.row === row) return true;
    return false;
  },

  // ===== INPUT =====
  input(dir) {
    if (this.state !== STATE.PLAYING) return;
    if (this.pendingStart) {
      // После застревания: ждём направления от оператора.
      // pendingStart остаётся true, pendingDir задаёт первый шаг.
      this.pendingDir = dir;
      this.anim = false;
      return;
    }
    this.direction = dir;
    this.anim = false;
  },

  shoot() {
    if (this.state !== STATE.PLAYING) return;
    if (this.level < CONFIG.SHOOT_LVL) return;
    // Перезарядка = пока летит предыдущий снаряд от головы
    if (this.bullets.length > 0) return;
    const h = this.head;
    const b = { col: h.col, row: h.row, dir: this.direction, startCol: h.col, startRow: h.row };
    this.bullets.push(b);
    Audio.sfx('shoot');
    // JUICE: muzzle particles
    const _mx = h.col * CONFIG.CELL_W + CONFIG.CELL_W/2;
    const _my = CONFIG.HUD + h.row * CONFIG.CELL_H + CONFIG.CELL_H/2;
    const _d = DIR[this.direction];
    this.addParticles(_mx + _d.dx * CONFIG.CELL_W/2, _my + _d.dy * CONFIG.CELL_H/2, 6, ['#ffe066', '#ff8800'], 2);
    this.addTrauma(0.05);
  },

  // ===== TICK (движение) =====
  getTankTick() {
    // 1 уровень: 240ms (медленно), 20: 120ms
    return Math.max(120, 240 - (this.level - 1) * 6.3);
  },

  // JUICE_HELPERS_V1
  addTrauma(v) {
    this._trauma = Math.min(1, (this._trauma || 0) + v);
  },
  addParticles(x, y, count, colors, speed) {
    if (!this._particles) this._particles = [];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (speed || 2) * (0.5 + Math.random());
      this._particles.push({
        x: x, y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1,
        life: 30 + Math.random() * 20,
        maxLife: 50,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 2 + Math.random() * 3
      });
    }
  },
  addFloat(x, y, text, color) {
    if (!this._floats) this._floats = [];
    this._floats.push({
      x: x, y: y, vy: -1.5,
      text: text, life: 60, maxLife: 60,
      color: color || '#f4c430'
    });
  },
  addFlash(color, alpha) {
    this._flash = { color: color, alpha: alpha, decay: 0.05 };
  },
  addHitstop(frames) {
    this._hitstop = (this._hitstop || 0) + frames;
  },
  updateJuice() {
    if (this._trauma > 0) this._trauma = Math.max(0, this._trauma - 0.02);
    if (this._particles) {
      for (let i = this._particles.length - 1; i >= 0; i--) {
        const p = this._particles[i];
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.15;
        p.vx *= 0.98;
        p.life--;
        if (p.life <= 0) this._particles.splice(i, 1);
      }
    }
    if (this._floats) {
      for (let i = this._floats.length - 1; i >= 0; i--) {
        const f = this._floats[i];
        f.y += f.vy;
        f.vy *= 0.97;
        f.life--;
        if (f.life <= 0) this._floats.splice(i, 1);
      }
    }
    if (this._flash) {
      this._flash.alpha -= this._flash.decay;
      if (this._flash.alpha <= 0) this._flash = null;
    }
  },
  renderJuice() {
    const c = Renderer.ctx;
    if (this._particles) {
      for (const p of this._particles) {
        c.globalAlpha = Math.max(0, p.life / p.maxLife);
        c.fillStyle = p.color;
        c.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      }
      c.globalAlpha = 1;
    }
    if (this._floats) {
      for (const f of this._floats) {
        c.globalAlpha = Math.max(0, f.life / f.maxLife);
        c.fillStyle = f.color;
        c.font = 'bold 20px monospace';
        c.textAlign = 'center';
        c.fillText(f.text, f.x, f.y);
      }
      c.globalAlpha = 1;
    }
    if (this._flash) {
      c.fillStyle = this._flash.color;
      c.globalAlpha = Math.max(0, this._flash.alpha);
      c.fillRect(0, 0, CONFIG.SW, CONFIG.SH);
      c.globalAlpha = 1;
    }
  },

  // === COMBO ===
  hitCombo() {
    const now = performance.now();
    if (now - (this._comboTs || 0) > (this.COMBO_GAP || 3000)) {
      this._combo = 0;
    }
    this._combo = (this._combo || 0) + 1;
    this._comboTs = now;
    return this._combo;
  },
  getComboMultiplier() {
    const c = this._combo || 0;
    return 1 + Math.max(0, c - 1) * 0.1;
  },
  checkComboTimeout() {
    if ((this._combo || 0) > 0 && performance.now() - (this._comboTs || 0) > (this.COMBO_GAP || 3000)) {
      this._combo = 0;
    }
  },

  tick() {
    if (this.state !== STATE.PLAYING) return;
    // JUICE: hitstop
    if (this._hitstop > 0) {
      this._hitstop--;
      this.updateJuice();
      return;
    }
    this.tickCount++;
    this.updateJuice();
    this.checkComboTimeout();

    // 1. Движение снарядов (быстрее тика, но проверим по позиции)
    this.updateBullets();

    // 2. Движение человечков (по таймеру)
    const now = performance.now();
    for (const m of this.men) {
      if (now >= m.nextMove) {
        this.moveMan(m);
        m.nextMove = now + (m.tickMs || CONFIG.MAN_TICK) + Math.random() * 200;
      }
    }

    // 3. Спавн новых человечков
    if (now - this.lastManSpawn > CONFIG.MAN_SPAWN && this.men.length < CONFIG.MAX_MEN) {
      this.spawnMan();
      this.lastManSpawn = now;
    }

    // 4. Снаряды — 3 подшага за тик (скорость x3)
    for (let _i = 0; _i < 3; _i++) this.updateBullets();

    // 4b. Летящие велосипеды (level 3)
    this.updateBikes();

    // 5. Движение танка (голова)
    if (this.anim) return;
    this.moveHead();
  },

  moveMan(m) {
    const now = performance.now();

    // === НОСИЛЬЩИК БАРРИКАДЫ ===
    if (m.carrying_barrier) {
      // уровень 4+: если цель на верхней стене занята — ищем свободную клетку в row=0
      if (m.targetRow === 0 && this.isOccupied(m.targetCol, 0, m)) {
        let found = -1;
        for (let d = 1; d < CONFIG.COLS; d++) {
          if (m.targetCol - d >= 0 && !this.isOccupied(m.targetCol - d, 0, m)) { found = m.targetCol - d; break; }
          if (m.targetCol + d < CONFIG.COLS && !this.isOccupied(m.targetCol + d, 0, m)) { found = m.targetCol + d; break; }
        }
        if (found >= 0) m.targetCol = found;
      }
      if (m.col === m.targetCol && m.row === m.targetRow) {
        // Дошёл — ставит баррикаду, становится обычным
        if (!this.isOccupied(m.targetCol, m.targetRow, m)) {
          this.barriers.push({col: m.targetCol, row: m.targetRow, item: m.item});
          Audio.sfx('break');
          if (m.targetRow === 0 && this._checkTopWallLock()) { this.wallLockdownLoss(); return; }
        }
        m.carrying_barrier = false;
        m.hasBike = false;
        m.item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        m.throwTimer = 0;
        m.tickMs = CONFIG.MAN_TICK;
        return;
      }
      // Шаг к цели
      const dc = m.targetCol > m.col ? 1 : (m.targetCol < m.col ? -1 : 0);
      const dr = m.targetRow > m.row ? 1 : (m.targetRow < m.row ? -1 : 0);
      if (dc !== 0 && !this.isOccupied(m.col + dc, m.row, m)) { m.col += dc; return; }
      if (dr !== 0 && !this.isOccupied(m.col, m.row + dr, m)) { m.row += dr; return; }
      // Обход
      const alt = [[0,-1],[-1,0],[1,0],[0,1]];
      for (const [dx,dy] of alt) {
        let nc = m.col + dx, nr = m.row + dy;
        if (nc < 0) nc = CONFIG.COLS - 1;
        if (nc >= CONFIG.COLS) nc = 0;
        if (nr >= 0 && nr < CONFIG.ROWS && !this.isOccupied(nc, nr, m)) {
          m.col = nc; m.row = nr; return;
        }
      }
      return;
    }

    // === ОБЫЧНЫЙ (уязвимый) ===
    // Level 3: thrower throws ONCE, becomes normal (1x speed)
    if (m.hasBike && m.throwTimer && now >= m.throwTimer) {
      m.throwTimer = 0;
      m.hasBike = false;
      m.hasThrownBike = true;
      m.tickMs = CONFIG.MAN_TICK;
      const h = this.head;
      if (h) {
        const dcol = h.col > m.col ? 1 : (h.col < m.col ? -1 : 0);
        const drow = h.row > m.row ? 1 : (h.row < m.row ? -1 : 0);
        let dx = dcol !== 0 ? dcol : 0;
        let dy = dcol === 0 ? drow : 0;
        if (dx !== 0 || dy !== 0) {
          this.bikes.push({col: m.col, row: m.row, dx, dy, ticks: 5});
          Audio.sfx('shoot');
        }
      }
    }

    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const [dx,dy] of dirs) {
      let nc = m.col + dx, nr = m.row + dy;
      if (nc < 0) nc = CONFIG.COLS - 1;
      if (nc >= CONFIG.COLS) nc = 0;
      if (nr < 0 || nr >= CONFIG.ROWS) continue;
      if (!this.isOccupied(nc, nr, m)) {
        m.col = nc; m.row = nr;
        return;
      }
    }
  },

  moveHead() {
    // После застревания ждём ввода оператора
    if (this.pendingStart && !this.pendingDir) {
      return;
    }

    let { col, row } = this.head;
    const useDir = (this.pendingStart && this.pendingDir) ? this.pendingDir : this.direction;
    const d = DIR[useDir];
    if (!d) { return; }

    if (this.pendingStart && this.pendingDir) {
      this.direction = this.pendingDir;
      this.pendingStart = false;
      this.pendingDir = null;
    }
    let nc = col + d.dx, nr = row + d.dy;

    // Телепорт по краям
    if (nc < 0) nc = CONFIG.COLS - 1;
    if (nc >= CONFIG.COLS) nc = 0;

    // Стены (верх/низ) — проигрыш
    if (nr < 0 || nr >= CONFIG.ROWS) {
      this.die('wall');
      return;
    }

    // Проверка столкновения
    if (this.collidesAt(nc, nr)) {
      // Баррикада? -> застревание
      const b = this.barriers.find(bb => bb.col === nc && bb.row === nr);
      if (b) {
        this.stuck(nc, nr);
        return;
      }
      // Стена/свой танк/человечек
      if (this.stuckTanks.some(s => s.col === nc && s.row === nr)) {
        this.die('stuck');
        return;
      }
      for (const t of this.tail) {
        if (t.col === nc && t.row === nr) {
          this.die('self');
          return;
        }
      }
      // Нет баррикады, но и не нашли — просто стоп
      return;
    }

    // 1. Проверка: съедаем человечка (только если НЕ носильщик)
    const manIdx = this.men.findIndex(m => m.col === nc && m.row === nr);
    if (manIdx >= 0) {
      const target = this.men[manIdx];
      if (target.carrying_barrier) {
        // Носильщик неуязвим — таран не проходит, танк просто останавливается
        return;
      }
      this.men.splice(manIdx, 1);
      // COMBO
      const _c = this.hitCombo();
      const _mult = this.getComboMultiplier();
      // Очки по типу человечка
      const _manKind = target.kind || 0;
      const _basePoints = _manKind === 2 ? 25 : (_manKind === 1 ? 20 : 10);
      const _points = Math.floor(_basePoints * this.level * _mult);
      this.score += _points;
      this.tail.push({ col, row });
      this._eaten++;
      Audio.sfx('eat');
      UI.updateHUD();
      // JUICE: eat
      const _eatX = nc * CONFIG.CELL_W + CONFIG.CELL_W/2;
      const _eatY = CONFIG.HUD + nr * CONFIG.CELL_H + CONFIG.CELL_H/2;
      this.addParticles(_eatX, _eatY, 12, ['#f4c430', '#c1272d', '#f0e6d2'], 3);
      const _floatTxt = (_c > 1) ? ('+' + _points + ' ×' + _c) : ('+' + _points);
      const _floatColor = (_c >= 3) ? '#ff5533' : ((_c >= 2) ? '#f8c040' : '#f4c430');
      this.addFloat(_eatX, _eatY - 10, _floatTxt, _floatColor);
      if (_c === 3) this.addTrauma(0.25);
      else if (_c === 5) this.addTrauma(0.35);
      this.addTrauma(0.15);
      this.addHitstop(2);
      if (this.tail.length + 1 >= this.target) {
        this.winLevel();
        return;
      }
    }

    // 2. Сдвигаем хвост
    for (let i = this.tail.length - 1; i > 0; i--) {
      this.tail[i] = { col: this.tail[i - 1].col, row: this.tail[i - 1].row };
    }
    if (this.tail.length > 0) {
      this.tail[0] = { col, row };
    }

    // 3. Двигаем голову
    this.head.col = nc;
    this.head.row = nr;
    this.head.dir = d.name;

    // Телепорт-звук
    if (d.dx !== 0 && (nc === 0 || nc === CONFIG.COLS - 1) && (col === 0 || col === CONFIG.COLS - 1)) {
      Audio.sfx('tp');
    }
  },

  collidesAt(col, row) {
    // Простые: баррикады, застрявшие
    if (this.barriers.some(b => b.col === col && b.row === row)) return true;
    if (this.stuckTanks.some(s => s.col === col && s.row === row)) return true;
    return false;
  },

  stuck(col, row) {
    // Голова застряла: её танк -> stuck, управление -> следующему
    Audio.sfx('stuck');
    // JUICE: stuck shake
    this.addTrauma(0.45);
    this.addParticles(this.head.col * CONFIG.CELL_W + CONFIG.CELL_W/2,
                     CONFIG.HUD + this.head.row * CONFIG.CELL_H + CONFIG.CELL_H/2,
                     15, ['#5a4a3a', '#000', '#8a6a4a'], 3);
    const oldHead = { col: this.head.col, row: this.head.row };
    this.stuckTanks.push(oldHead);
    // Убираем голову (она осталась на баррикаде как застрявшая)
    if (this.tail.length > 0) {
      this.head = { col: this.tail[0].col, row: this.tail[0].row, dir: this.direction };
      this.tail.shift();
      // Новый головной = бывший второй
      this.pendingStart = true;
      this.pendingDir = null;
    } else {
      // Больше танков нет — проигрыш
      this.die('all_stuck');
    }
    UI.updateHUD();
  },

  updateBikes() {
    if (!this.bikes) return;
    for (let i = this.bikes.length - 1; i >= 0; i--) {
      const b = this.bikes[i];
      b.col += b.dx;
      b.row += b.dy;
      b.ticks--;
      if (b.col < 0 || b.col >= CONFIG.COLS || b.row < 0 || b.row >= CONFIG.ROWS || b.ticks <= 0) {
        this.bikes.splice(i, 1);
        continue;
      }
      if (this.head && b.col === this.head.col && b.row === this.head.row) {
        this.bikes.splice(i, 1);
        this.die('bike');
        continue;
      }
      const tailIdx = this.tail.findIndex(t => t.col === b.col && t.row === b.row);
      if (tailIdx >= 0) {
        this.tail.splice(tailIdx, 1);
        this.bikes.splice(i, 1);
        Audio.sfx('stuck');
      }
    }
  },

  updateBullets() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let nc = b.col + DIR[b.dir].dx, nr = b.row + DIR[b.dir].dy;
      // Снаряд улетел за край — удаляем (без телепорта)
      if (nc < 0 || nc >= CONFIG.COLS) {
        this.bullets.splice(i, 1);
        continue;
      }
      // Стена сверху/снизу — штраф
      if (nr < 0 || nr >= CONFIG.ROWS) {
        this.bullets.splice(i, 1);
        this.score = Math.max(0, this.score - 5);
        if (nr < 0) {
          if (this.level === 1 && this._eaten === 0) {
            this._wallShots++;
            if (this._wallShots >= 10) { this.peaceVictory(); return; }
          } else if (this.level === 1 && this._eaten > 0) {
            this._wallShotsAfterEat++;
            if (this._wallShotsAfterEat >= 5) { this.tribunalLoss(); return; }
          }
        }
        continue;
      }
      b.col = nc; b.row = nr;
      // Попадание в баррикаду — ломаем
      const bIdx = this.barriers.findIndex(bb => bb.col === nc && bb.row === nr);
      if (bIdx >= 0) {
        this.barriers.splice(bIdx, 1);
        this.bullets.splice(i, 1);
        Audio.sfx('break');
        // COMBO
        const _bc = this.hitCombo();
        const _bmult = this.getComboMultiplier();
        const _bpoints = Math.floor(10 * _bmult);
        this.score += _bpoints;
        UI.updateHUD();
        // JUICE: barrier break
        const _bx = nc * CONFIG.CELL_W + CONFIG.CELL_W/2;
        const _by = CONFIG.HUD + nr * CONFIG.CELL_H + CONFIG.CELL_H/2;
        this.addParticles(_bx, _by, 20, ['#8a5a2a', '#c1272d', '#f4c430', '#fff'], 4);
        const _bfloatTxt = (_bc > 1) ? ('+' + _bpoints + ' ×' + _bc) : ('+' + _bpoints);
        const _bfloatColor = (_bc >= 3) ? '#ff5533' : '#f8c040';
        this.addFloat(_bx, _by - 10, _bfloatTxt, _bfloatColor);
        this.addTrauma(0.35);
        this.addHitstop(4);
        continue;
      }
      // Попадание в человечка
      const mIdx = this.men.findIndex(m => m.col === nc && m.row === nr);
      if (mIdx >= 0) {
        const target = this.men[mIdx];
        if (target.carrying_barrier) {
          // Носильщик: убит вместе с баррикадой
          this.men.splice(mIdx, 1);
          this.barriers.push({col: nc, row: nr, item: target.item});
          const _cc = this.hitCombo();
          this.score += Math.floor(30 * this.getComboMultiplier());
          Audio.sfx('break');
        } else {
          // Обычный: убит, +очки (с комбо)
          this.men.splice(mIdx, 1);
          const _nc = this.hitCombo();
          this.score += Math.floor(10 * this.getComboMultiplier());
          Audio.sfx('eat');
        }
        this.bullets.splice(i, 1);
        UI.updateHUD();
      }
    }
  },

  _withFinalCut(prefix, nextFn) {
    if (typeof CutSceneLoader === 'undefined') { nextFn(); return; }
    CutSceneLoader.prepareForFinal(prefix).then(function (cuts) {
      if (cuts && cuts.length > 0) {
        UI.showCutSet(cuts, function () { nextFn(); });
      } else {
        nextFn();
      }
    }).catch(function () { nextFn(); });
  },

  peaceVictory() {
    const self = this;
    this._withFinalCut('f2', function () {
      self.state = STATE.GAMEOVER;
      Audio.stopMusic();
      Audio.sfx('break');
      self.addTrauma(0.3);
      self.addFlash('#f4c430', 0.5);
      UI.setHUD(false);
      highscores.push({ score: self.score, level: self.level, date: new Date().toISOString().slice(0,10) });
      highscores.sort((a, b) => b.score - a.score);
      highscores = highscores.slice(0, 5);
      Storage.set('highscores', highscores);
      self.best = highscores[0].score;
      UI.showPeaceScreen(self.score);
    });
  },

  tribunalLoss() {
    const self = this;
    this._withFinalCut('f0', function () {
      self.state = STATE.GAMEOVER;
      Audio.stopMusic();
      Audio.sfx('death');
      self.addTrauma(0.9);
      self.addFlash('#c1272d', 0.6);
      UI.setHUD(false);
      highscores.push({ score: self.score, level: self.level, date: new Date().toISOString().slice(0,10) });
      highscores.sort((a, b) => b.score - a.score);
      highscores = highscores.slice(0, 5);
      Storage.set('highscores', highscores);
      self.best = highscores[0].score;
      UI.showTribunalScreen(self.score);
    });
  },

  _checkTopWallLock() {
    // уровень 4+: если вся верхняя стена (row=0) загорожена — поражение
    if (this.level < 4) return false;
    let n = 0;
    for (const b of this.barriers) if (b.row === 0) n++;
    return n >= CONFIG.COLS;
  },

  wallLockdownLoss() {
    const self = this;
    this._withFinalCut('f3', function () {
      self.state = STATE.GAMEOVER;
      Audio.stopMusic();
      Audio.sfx('death');
      self.addTrauma(0.9);
      self.addFlash('#c1272d', 0.6);
      UI.setHUD(false);
      highscores.push({ score: self.score, level: self.level, date: new Date().toISOString().slice(0,10) });
      highscores.sort((a, b) => b.score - a.score);
      highscores = highscores.slice(0, 5);
      Storage.set('highscores', highscores);
      self.best = highscores[0].score;
      UI.showWallLockdownScreen(self.score);
    });
  },

  die(reason) {
    const self = this;
    this._withFinalCut('f4', function () {
      self.state = STATE.GAMEOVER;
      Audio.stopMusic();
      Audio.sfx('death');
      self.addTrauma(0.8);
      self.addFlash('#c1272d', 0.5);
      UI.setHUD(false);
      highscores.push({ score: self.score, level: self.level, date: new Date().toISOString().slice(0,10) });
      highscores.sort((a, b) => b.score - a.score);
      highscores = highscores.slice(0, 5);
      Storage.set('highscores', highscores);
      self.best = highscores[0].score;
      UI.showGameOver(self.score);
    });
  },

  winLevel() {
    // JUICE: victory celebration
    this.addFlash('#f4c430', 0.4);
    this.addTrauma(0.3);
    for (let _i = 0; _i < 30; _i++) {
      this.addParticles(Math.random() * CONFIG.SW, Math.random() * 200,
        1, ['#f4c430', '#c1272d', '#4a7c3a', '#fff'], 4);
    }
    this.addFloat(CONFIG.SW/2, CONFIG.SH/2 - 60, '\u80dc\u5229!', '#f4c430');
    this.level++;
    if (this.level > CONFIG.TARGETS.length) {
      const self = this;
      this._withFinalCut('f1', function () {
        self.state = STATE.GAMEOVER;
        Audio.stopMusic();
        UI.setHUD(false);
        highscores.push({ score: self.score, level: self.level - 1, date: new Date().toISOString().slice(0,10) });
        highscores.sort((a, b) => b.score - a.score);
        highscores = highscores.slice(0, 5);
        Storage.set('highscores', highscores);
        UI.showGameOver(self.score, true);
      });
    } else {
      this.loadLevel();
      this.startStageIntro();
    }
  },

  pause() {
    if (this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      UI.showScreen('pause-screen');
      Audio.stopMusic();
    } else if (this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      UI.showScreen(null);
      Audio.startMusic();
    }
  },

  render() {
    Renderer.clear();
    // JUICE: screen shake
    const c = Renderer.ctx;
    c.save();
    if (this._trauma > 0) {
      const trauma2 = this._trauma * this._trauma;
      const maxShake = 15;
      const t = performance.now() * 0.05;
      const ox = (Math.sin(t * 1.7) + Math.sin(t * 2.3)) * 0.5 * maxShake * trauma2;
      const oy = (Math.cos(t * 1.9) + Math.sin(t * 2.7)) * 0.5 * maxShake * trauma2;
      const rot = Math.sin(t * 1.5) * 0.02 * trauma2;
      c.translate(CONFIG.SW/2 + ox, CONFIG.SH/2 + oy);
      c.rotate(rot);
      c.translate(-CONFIG.SW/2, -CONFIG.SH/2);
    }

    Renderer.drawTop(this.score || 0, this.best || 0, this.level || 1,
                    this.head ? this.tail.length + 1 : 0, this.target || 10);
    Renderer.drawGround();
    const isGame = (this.state === STATE.PLAYING || this.state === STATE.PAUSED || this.state === STATE.INTRO);
    if (isGame) {
      for (const b of this.barriers) {
        Renderer.drawBarrier(b.col * CONFIG.CELL_W, CONFIG.HUD + b.row * CONFIG.CELL_H, b.item);
      }
      for (const s of this.stuckTanks) {
        Renderer.drawTank(s.col * CONFIG.CELL_W, CONFIG.HUD + s.row * CONFIG.CELL_H, 'up', false);
      }
      for (const t of this.tail) {
        Renderer.drawTank(t.col * CONFIG.CELL_W, CONFIG.HUD + t.row * CONFIG.CELL_H, 'right', false);
      }
      if (this.head) {
        Renderer.drawTank(this.head.col * CONFIG.CELL_W, CONFIG.HUD + this.head.row * CONFIG.CELL_H, this.head.dir, true);
      }
      for (const m of this.men) {
        const mx = m.col * CONFIG.CELL_W;
        const my = CONFIG.HUD + m.row * CONFIG.CELL_H;
        Renderer.drawMan(mx, my, m.item, false, m.kind || 0);
        if (m.carrying_barrier) {
          Renderer.drawBarrier(mx, my - 8, m.item);
        }
      }
      for (const b of this.bullets) {
        Renderer.drawBullet(b.col * CONFIG.CELL_W + CONFIG.CELL_W/2 - 1, CONFIG.HUD + b.row * CONFIG.CELL_H + CONFIG.CELL_H/2 - 1);
      }
      for (const bk of this.bikes) {
        Renderer.drawBike(bk.col * CONFIG.CELL_W, CONFIG.HUD + bk.row * CONFIG.CELL_H);
      }
    }
        Renderer.drawBottom();
    c.restore();
    // JUICE: particles/floats/flash (после shake)
    this.renderJuice();
  },
};


// ===== UI =====
const UI = {
  init() {
    // Screens
    document.getElementById('btn-start').onclick = () => {
      Audio.init(); Audio.resume();
      if (typeof CutSceneLoader !== 'undefined') {
        CutSceneLoader.prepare('0').then(function (cuts) {
          if (cuts && cuts.length > 0) {
            UI.showCutSet(cuts, function () {
              Game.state = STATE.TITLE;
              UI.showScreen(null);
              Game.start();
              Game.startStageIntro();
            });
          } else {
            Game.state = 'story';
            Game._storyStep = 0;
            UI.showStoryCard(0);
            UI.showScreen('story-screen');
          }
        }).catch(function () {
          Game.state = 'story';
          Game._storyStep = 0;
          UI.showStoryCard(0);
          UI.showScreen('story-screen');
        });
      } else {
        Game.state = 'story';
        Game._storyStep = 0;
        UI.showStoryCard(0);
        UI.showScreen('story-screen');
      }
    };

    document.getElementById('btn-story-continue').onclick = () => {
      Game._storyStep = (Game._storyStep || 0) + 1;
      if (Game._storyStep >= Game._storyCards.length) {
        // Конец катсцен — запуск игры
        Game.state = STATE.TITLE;
        UI.showScreen(null);
        Game.start();
        Game.startStageIntro();
      } else {
        UI.showStoryCard(Game._storyStep);
      }
    };
    document.getElementById('btn-settings').onclick = () => this.showScreen('settings-screen');
    document.getElementById('btn-highscores').onclick = () => { this.renderHighscores(); this.showScreen('highscores-screen'); };
    document.getElementById('btn-help').onclick = () => this.showScreen('help-screen');
    document.getElementById('btn-help-back').onclick = () => this.showScreen('title-screen');
    document.getElementById('btn-settings-back').onclick = () => { Storage.set('settings', settings); this.showScreen('title-screen'); };
    document.getElementById('btn-highscores-back').onclick = () => this.showScreen('title-screen');

    // Toggles
    document.getElementById('btn-music').onclick = (e) => {
      settings.music = !settings.music;
      e.target.textContent = settings.music ? 'ON' : 'OFF';
      e.target.classList.toggle('off', !settings.music);
      Storage.set('settings', settings);
      Audio.init(); Audio.applySettings();
    };
    document.getElementById('btn-sfx').onclick = (e) => {
      settings.sfx = !settings.sfx;
      e.target.textContent = settings.sfx ? 'ON' : 'OFF';
      e.target.classList.toggle('off', !settings.sfx);
      Storage.set('settings', settings);
      Audio.applySettings();
    };
    document.getElementById('btn-theme').onclick = (e) => {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      e.target.textContent = settings.theme === 'dark' ? 'DARK' : 'LIGHT';
      document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : '');
      Storage.set('settings', settings);
    };

    // Pause / resume / restart / quit (btn-pause удалён вместе с DOM-HUD, пауза по Esc)
    const _bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    _bind('btn-pause', () => Game.pause());
    _bind('btn-resume', () => Game.pause());
    _bind('btn-restart', () => { this.showScreen(null); Game.start(); Game.startStageIntro(); });
    _bind('btn-quit', () => { Game.state = STATE.TITLE; this.setHUD(false); this.showScreen('title-screen'); Audio.stopMusic(); });

    // Game Over
    _bind('btn-play-again', () => { this.showScreen(null); Game.start(); Game.startStageIntro(); });
    _bind('btn-gameover-menu', () => { Game.state = STATE.TITLE; this.setHUD(false); this.showScreen('title-screen'); });
    _bind('btn-peace-again', () => { this.showScreen(null); Game.start(); Game.startStageIntro(); });
    _bind('btn-peace-menu', () => { Game.state = STATE.TITLE; this.setHUD(false); this.showScreen('title-screen'); });
    _bind('btn-tribunal-again', () => { this.showScreen(null); Game.start(); Game.startStageIntro(); });
    _bind('btn-tribunal-menu', () => { Game.state = STATE.TITLE; this.setHUD(false); this.showScreen('title-screen'); });
    _bind('btn-wall-again', () => { this.showScreen(null); Game.start(); Game.startStageIntro(); });
    _bind('btn-wall-menu', () => { Game.state = STATE.TITLE; this.setHUD(false); this.showScreen('title-screen'); });

    // Apply saved settings
    const _setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _setText('btn-music', settings.music ? 'ON' : 'OFF');
    _setText('btn-sfx', settings.sfx ? 'ON' : 'OFF');
    _setText('btn-theme', settings.theme === 'dark' ? 'DARK' : 'LIGHT');
    if (settings.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  },

  showCutSet(cuts, onDone) {
    // cuts: [{imgUrl, title, lines}] — проигрывает последовательно.
    if (!cuts || cuts.length === 0) { if (onDone) onDone(); return; }
    Game.state = 'story';
    this._cutQueue = cuts;
    this._cutPos = 0;
    this._cutDone = onDone;
    this._renderCutCurrent();
  },

  _renderCutCurrent() {
    const cuts = this._cutQueue || [];
    const i = this._cutPos || 0;
    const c = cuts[i];
    if (!c) {
      const cb = this._cutDone; this._cutDone = null; this._cutQueue = null; this._cutPos = 0;
      this.showScreen(null);
      if (cb) cb();
      return;
    }
    const img = document.getElementById('story-img');
    if (img) img.src = c.imgUrl || '';
    const txtEl = document.getElementById('story-text');
    if (txtEl) {
      txtEl.innerHTML = '';
      (c.lines || []).forEach(function (line) {
        const p = document.createElement('p');
        const s = document.createElement('span');
        s.className = 'speaker';
        s.textContent = '[' + (line.speaker || '') + ']';
        p.appendChild(s);
        p.appendChild(document.createTextNode(' ' + (line.text || '')));
        txtEl.appendChild(p);
      });
    }
    const prog = document.getElementById('story-progress');
    if (prog) prog.textContent = (i + 1) + '/' + cuts.length;
    const btn = document.getElementById('btn-story-continue');
    if (btn) {
      btn.textContent = (i + 1 === cuts.length) ? 'Продолжить ▶' : 'Далее ▶';
      btn.onclick = () => {
        this._cutPos = (this._cutPos || 0) + 1;
        this._renderCutCurrent();
      };
    }
    this.showScreen('story-screen');
  },

  showLevelCutscene(level, onDone) {
    const cs = Game._levelCutscenes && Game._levelCutscenes[level];
    if (!cs) { if (onDone) onDone(); return; }
    Game.state = 'story';
    this._cutsceneDone = onDone;
    // Используем тот же story-screen
    const img = document.getElementById('story-img');
    if (img) img.src = cs.img;
    const txtEl = document.getElementById('story-text');
    if (txtEl) {
      txtEl.innerHTML = '';
      cs.lines.forEach(function(line) {
        const p = document.createElement('p');
        const s = document.createElement('span');
        s.className = 'speaker';
        s.textContent = '[' + line.speaker + ']';
        p.appendChild(s);
        p.appendChild(document.createTextNode(' ' + line.text));
        txtEl.appendChild(p);
      });
    }
    const prog = document.getElementById('story-progress');
    if (prog) prog.textContent = '\u0423\u0440\u043e\u0432\u0435\u043d\u044c ' + level;
    // Меняем кнопку на «продолжить катсцену»
    const btn = document.getElementById('btn-story-continue');
    if (btn) {
      btn.textContent = '\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u25b6';
      btn.onclick = () => {
        this.showScreen(null);
        const cb = this._cutsceneDone;
        this._cutsceneDone = null;
        Game.state = STATE.PLAYING;
        Audio.startMusic();
        if (cb) cb();
      };
    }
    this.showScreen('story-screen');
  },

  showStoryCard(idx) {
    const cards = Game._storyCards || [];
    const c = cards[idx];
    if (!c) return;
    const img = document.getElementById('story-img');
    if (img) img.src = c.img;
    const txtEl = document.getElementById('story-text');
    if (txtEl) {
      txtEl.innerHTML = '';
      c.lines.forEach(function(line) {
        const p = document.createElement('p');
        const s = document.createElement('span');
        s.className = 'speaker';
        s.textContent = '[' + line.speaker + ']';
        p.appendChild(s);
        p.appendChild(document.createTextNode(' ' + line.text));
        txtEl.appendChild(p);
      });
    }
    const prog = document.getElementById('story-progress');
    if (prog) prog.textContent = (idx + 1) + '/' + cards.length;
  },

  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('visible'));
    if (id) {
      const scr = document.getElementById(id);
      if (scr) {
        scr.classList.add('visible');
        const firstBtn = scr.querySelector('button');
        if (firstBtn) setTimeout(() => firstBtn.focus(), 50);
      }
      // Меню: переключить музыку на MENU_MELODY (для title/help/settings/highscores)
      if (id === 'title-screen' || id === 'help-screen' ||
          id === 'settings-screen' || id === 'highscores-screen') {
        Audio.startMusic();
      }
    }
  },

  setHUD(on) { /* no-op: HUD on canvas wall */ },
  updateHUD() { /* no-op: HUD on canvas wall */ },

  renderHighscores() {
    const list = document.getElementById('highscores-list');
    list.innerHTML = '';
    if (highscores.length === 0) {
      list.innerHTML = '<li style="justify-content:center;opacity:0.5">— пусто —</li>';
      return;
    }
    highscores.forEach((h, i) => {
      const li = document.createElement('li');
      li.setAttribute('data-rank', '#' + (i+1));
      li.innerHTML = '<span>' + h.score + '</span><span>\u7b2c' + h.level + '\u5173 · ' + h.date + '</span>';
      list.appendChild(li);
    });
  },

  showPeaceScreen(score) {
    const el = document.getElementById('peace-score');
    if (el) el.textContent = score;
    this.showScreen('peace-screen');
  },

  showTribunalScreen(score) {
    const el = document.getElementById('tribunal-score');
    if (el) el.textContent = score;
    this.showScreen('tribunal-screen');
  },

  showWallLockdownScreen(score) {
    const el = document.getElementById('wall-score');
    if (el) el.textContent = score;
    this.showScreen('wall-screen');
  },

  showGameOver(score, win) {
    document.getElementById('final-score').textContent = score;
    const nr = document.getElementById('new-record');
    if (highscores.length > 0 && highscores[0].score === score) nr.classList.remove('hidden');
    else nr.classList.add('hidden');
    this.showScreen('gameover-screen');
  },

  showStageIntro(level, target) {
    const scr = document.getElementById('stage-intro');
    document.getElementById('stage-text').textContent = '\u7b2c' + Renderer._cn(level) + '\u5173';
    document.getElementById('stage-goal').textContent = '\u76ee\u6807: ' + target;
    scr.classList.add('visible');
  },

  hideStageIntro() {
    document.getElementById('stage-intro').classList.remove('visible');
  },
};

// ===== INPUT =====
document.addEventListener('keydown', (e) => {
  if (Audio.ctx && Audio.ctx.state === 'suspended') Audio.resume();

  // === МЕНЮ (TITLE/HELP/SETTINGS/HIGHSCORES): стрелки + Enter + Escape ===
  if (Game.state === STATE.TITLE || Game.state === STATE.HELP ||
      Game.state === STATE.SETTINGS || Game.state === STATE.HIGHSCORES) {
    const scr = document.querySelector('.screen.visible');
    if (!scr) return;
    const buttons = Array.from(scr.querySelectorAll('button')).filter(b => !b.classList.contains('hidden'));
    if (!buttons.length) return;

    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      let idx = buttons.indexOf(document.activeElement);
      idx = (idx + 1) % buttons.length;
      buttons[idx].focus();
      e.preventDefault();
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      let idx = buttons.indexOf(document.activeElement);
      if (idx < 0) idx = 0;
      idx = (idx - 1 + buttons.length) % buttons.length;
      buttons[idx].focus();
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      let idx = buttons.indexOf(document.activeElement);
      if (idx < 0) buttons[0].click();
      else buttons[idx].click();
    } else if (e.key === 'Escape' && Game.state !== STATE.TITLE) {
      UI.showScreen('title-screen');
      Game.state = STATE.TITLE;
      e.preventDefault();
    }
    return;
  }

  // === STORY cutscene: Space/Enter => продолжить ===
  if (Game.state === 'story') {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const btn = document.getElementById('btn-story-continue');
      if (btn) btn.click();
    }
    return;
  }

  // === PAUSED: Escape = resume ===
  if (Game.state === STATE.PAUSED) {
    if (e.key === 'Escape') { Game.pause(); e.preventDefault(); }
    return;
  }

  // === PLAYING ===
  if (Game.state !== STATE.PLAYING) return;
  if (e.key === 'Escape') { Game.pause(); return; }
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { Game.input('left'); e.preventDefault(); }
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { Game.input('right'); e.preventDefault(); }
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { Game.input('up'); e.preventDefault(); }
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { Game.input('down'); e.preventDefault(); }
  if (e.key === ' ') { Game.shoot(); e.preventDefault(); }
});

// ===== LOOP =====
let lastTick = 0;
function loop(ts) {
  if (Game.state === STATE.PLAYING && ts - lastTick >= Game.getTankTick()) {
    lastTick = ts;
    Game.tick();
  }
  Game.render();
  if (Game.state === STATE.INTRO) {
    Renderer.drawStageIntro(Game.level, Game.target);
  } else if (Game.state === STATE.GAMEOVER) {
    Renderer.drawGameOver(Game.score);
  }
  requestAnimationFrame(loop);
}

// ===== INIT =====
function init() {
  Renderer.init();
  UI.init();
  // Настройки темы
  document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : '');
  // Показать title
  UI.showScreen('title-screen');
  requestAnimationFrame(loop);
}

window.addEventListener('load', init);
