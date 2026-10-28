/**
 * WebAudio sound design — all cues are synthesised at runtime, so the demo
 * ships with zero audio assets and works offline.
 *
 * The AudioContext is created lazily on the first user gesture (browser policy).
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.lastTickSecond = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
     const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  get ready() {
    return !!this.ctx && !this.muted && this.ctx.state === 'running';
  }

  envelope(node, { attack = 0.005, decay = 0.2, peak = 0.4, at = 0 }) {
    const t = this.ctx.currentTime + at;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + decay, 0.02));
  }

  tone({ freq = 440, type = 'sine', duration = 0.2, gain = 0.3, slide = null, at = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(slide, 20), t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  noise({ duration = 0.4, gain = 0.25, filterFrom = 1200, filterTo = 160, at = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + at;
    const frames = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFrom, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(filterTo, 60), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  /* ------------------------------- cues --------------------------------- */

  click() {
    this.tone({ freq: 520, type: 'triangle', duration: 0.06, gain: 0.12 });
  }

  tick(isFinal = false) {
    this.tone({
      freq: isFinal ? 880 : 540,
      type: isFinal ? 'square' : 'sine',
      duration: isFinal ? 0.13 : 0.07,
      gain: isFinal ? 0.16 : 0.08,
    });
  }

  takeoff() {
    this.noise({ duration: 0.75, gain: 0.16, filterFrom: 240, filterTo: 2400 });
    this.tone({ freq: 180, type: 'sawtooth', duration: 0.5, gain: 0.08, slide: 420 });
  }

  cashout(multiplier = 2) {
    const base = 660;
    this.tone({ freq: base, type: 'sine', duration: 0.16, gain: 0.22 });
    this.tone({ freq: base * 1.25, type: 'sine', duration: 0.2, gain: 0.18, at: 0.09 });
    this.tone({ freq: base * 1.5, type: 'triangle', duration: 0.3, gain: 0.14, at: 0.18 });
    if (multiplier >= 5) {
      this.tone({ freq: base * 2, type: 'sine', duration: 0.35, gain: 0.1, at: 0.28 });
    }
  }

  crash() {
    this.noise({ duration: 0.9, gain: 0.34, filterFrom: 2200, filterTo: 90 });
    this.tone({ freq: 160, type: 'sawtooth', duration: 0.7, gain: 0.2, slide: 38 });
    this.tone({ freq: 90, type: 'sine', duration: 0.9, gain: 0.24, slide: 30, at: 0.04 });
  }

  error() {
    this.tone({ freq: 220, type: 'square', duration: 0.12, gain: 0.1 });
    this.tone({ freq: 180, type: 'square', duration: 0.15, gain: 0.09, at: 0.1 });
  }
}

export const sound = new SoundEngine();
