/**
 * AudioManager — procedural sound effects using the Web Audio API.
 * No external audio files required.
 */
export class AudioManager {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._enabled = true;
    this._bgmMode = null;
  }

  /** Lazily init AudioContext on first user interaction */
  init() {
    if (this._ctx) return;
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 0.6;
    this._masterGain.connect(this._ctx.destination);
  }

  get ctx() {
    if (!this._ctx) this.init();
    return this._ctx;
  }

  get out() {
    if (!this._masterGain) this.init();
    return this._masterGain;
  }

  setEnabled(val) { this._enabled = val; }

  /** Generic envelope helper */
  _env(node, gain, attack, hold, decay, peak = 1) {
    const now = this.ctx.currentTime;
    node.gain.setValueAtTime(0, now);
    node.gain.linearRampToValueAtTime(peak * gain, now + attack);
    node.gain.setValueAtTime(peak * gain, now + attack + hold);
    node.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + decay);
    return node;
  }

  /** Place bomb — soft click/thud */
  playPlaceBomb() {
    if (!this._enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  /** Explosion — layered noise burst + low boom */
  playExplosion(power = 1) {
    if (!this._enabled) return;
    const vol = Math.min(1, 0.5 + power * 0.1);

    // Noise burst
    const bufLen = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = this.ctx.createGain();
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 800;
    this._env(noiseGain, vol, 0.005, 0.05, 0.35);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.out);
    noise.start();

    // Low boom
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.3);
    this._env(oscGain, vol * 0.8, 0.005, 0.02, 0.28);
    osc.connect(oscGain);
    oscGain.connect(this.out);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  /** Block destroyed — wooden crack */
  playBlockDestroyed() {
    if (!this._enabled) return;
    const bufLen = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    this._env(gain, 0.5, 0.001, 0.01, 0.18);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.out);
    source.start();
  }

  /** Spiral map close hit — short heavy impact */
  playMapCloseHit() {
    if (!this._enabled) return;

    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(240, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.1);
    oscGain.gain.setValueAtTime(0.36, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(oscGain);
    oscGain.connect(this.out);
    osc.start(now);
    osc.stop(now + 0.15);

    const bufLen = Math.max(1, Math.floor(this.ctx.sampleRate * 0.08));
    const buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(380, now);
    filter.Q.value = 0.65;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.out);
    noise.start(now);
    noise.stop(now + 0.11);
  }

  /** Item pickup — bright ding */
  playItemPickup() {
    if (!this._enabled) return;
    const freqs = [880, 1108, 1320];
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = this.ctx.currentTime + i * 0.06;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
      gain.connect(this.out);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  }

  /** Player death — descending wail */
  playPlayerDeath() {
    if (!this._enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.85);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.9);
  }

  /** Skull curse — creepy warble */
  playSkull() {
    if (!this._enabled) return;
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 220;
    lfo.type = 'sine';
    lfo.frequency.value = 8;
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start();
    lfo.start();
    osc.stop(this.ctx.currentTime + 1.2);
    lfo.stop(this.ctx.currentTime + 1.2);
  }

  /** Round start fanfare */
  playRoundStart() {
    if (!this._enabled) return;
    const melody = [
      { freq: 523, dur: 0.1 },
      { freq: 659, dur: 0.1 },
      { freq: 784, dur: 0.2 },
    ];
    let t = this.ctx.currentTime;
    melody.forEach(({ freq, dur }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.setValueAtTime(0.001, t + dur - 0.01);
      osc.connect(gain);
      gain.connect(this.out);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.02;
    });
  }

  /** Round end / victory jingle */
  playVictory() {
    if (!this._enabled) return;
    const melody = [
      { freq: 523, dur: 0.1 },
      { freq: 659, dur: 0.1 },
      { freq: 784, dur: 0.1 },
      { freq: 1047, dur: 0.3 },
    ];
    let t = this.ctx.currentTime;
    melody.forEach(({ freq, dur }) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.1);
      osc.connect(gain);
      gain.connect(this.out);
      osc.start(t);
      osc.stop(t + dur + 0.15);
      t += dur + 0.03;
    });
  }

  /** Bomb kick sound */
  playKick() {
    if (!this._enabled) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(this.out);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.13);
  }

  /** Background music loop — simple chiptune ostinato */
  startBGM() {
    if (!this._enabled || this._bgmRunning) return;
    this._bgmRunning = true;
    this._bgmMode = 'normal';

    const scale = [262, 294, 330, 349, 392, 440, 494, 524];
    const pattern = [0, 2, 4, 5, 4, 2, 0, 6];
    let beat = 0;

    const playBeat = () => {
      if (!this._bgmRunning) return;
      const freq = scale[pattern[beat % pattern.length]];
      beat++;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.out);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);

      this._bgmTimeout = setTimeout(playBeat, 220);
    };
    playBeat();
  }

  /** Late-round danger BGM — faster and more tense than default loop */
  startDangerBGM() {
    if (!this._enabled) return;
    if (this._bgmRunning && this._bgmMode === 'danger') return;

    this.stopBGM();
    this._bgmRunning = true;
    this._bgmMode = 'danger';

    const scale = [147, 165, 175, 196, 208, 220, 233, 262];
    const pattern = [0, 2, 1, 4, 2, 5, 3, 6, 4, 7, 5, 2];
    let beat = 0;

    const playBeat = () => {
      if (!this._bgmRunning || this._bgmMode !== 'danger') return;

      const freq = scale[pattern[beat % pattern.length]];
      beat++;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1500;
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.14, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.out);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.11);

      if (beat % 2 === 0) {
        const bass = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bass.type = 'triangle';
        bass.frequency.setValueAtTime(70, this.ctx.currentTime);
        bass.frequency.exponentialRampToValueAtTime(52, this.ctx.currentTime + 0.1);
        bassGain.gain.setValueAtTime(0.09, this.ctx.currentTime);
        bassGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
        bass.connect(bassGain);
        bassGain.connect(this.out);
        bass.start();
        bass.stop(this.ctx.currentTime + 0.13);
      }

      this._bgmTimeout = setTimeout(playBeat, 130);
    };

    playBeat();
  }

  stopBGM() {
    this._bgmRunning = false;
    this._bgmMode = null;
    clearTimeout(this._bgmTimeout);
  }
}

export const audioManager = new AudioManager();
