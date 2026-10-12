// Fully synthesized sound effects (no audio assets) via WebAudio.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      this.enabled = false;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(c.destination);
    // noise buffer
    const len = c.sampleRate * 1.5;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine
    this.engOsc = c.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc2 = c.createOscillator();
    this.engOsc2.type = 'square';
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.engOsc.start();
    this.engOsc2.start();
    // siren
    this.sirOsc = c.createOscillator();
    this.sirOsc.type = 'triangle';
    this.sirLfo = c.createOscillator();
    this.sirLfo.frequency.value = 0.5;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 260;
    this.sirLfo.connect(lfoGain);
    lfoGain.connect(this.sirOsc.frequency);
    this.sirOsc.frequency.value = 900;
    this.sirGain = c.createGain();
    this.sirGain.gain.value = 0;
    this.sirOsc.connect(this.sirGain);
    this.sirGain.connect(this.master);
    this.sirOsc.start();
    this.sirLfo.start();
    // horn
    this.hornGain = c.createGain();
    this.hornGain.gain.value = 0;
    for (const f of [392, 494]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(this.hornGain);
      o.start();
    }
    const hf = c.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1400;
    this.hornGain.connect(hf);
    hf.connect(this.master);
  }
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  noiseBurst(dur, freq, vol, type = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  tone(freq, dur, vol, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  gunshot(vol = 1, heavy = false) {
    this.noiseBurst(heavy ? 0.35 : 0.18, heavy ? 1800 : 3000, 0.9 * vol);
    this.tone(heavy ? 70 : 110, 0.12, 0.5 * vol, 'triangle');
  }
  explosion(vol = 1) {
    this.noiseBurst(1.4, 500, 1.2 * vol);
    this.tone(45, 0.9, 0.8 * vol, 'sine');
  }
  crash(vol = 1) {
    this.noiseBurst(0.3, 900, 0.8 * vol, 'bandpass');
  }
  punch() {
    this.noiseBurst(0.08, 600, 0.6);
  }
  pickup() {
    this.tone(880, 0.1, 0.25, 'square');
    this.tone(1320, 0.15, 0.25, 'square', 0.08);
  }
  passed() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 0.25, 'triangle', i * 0.13));
  }
  failed() {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 0.25, 'triangle', i * 0.18));
  }
  wasted() {
    this.tone(110, 1.8, 0.4, 'sawtooth');
    this.tone(82, 2.2, 0.3, 'sawtooth', 0.2);
  }
  click() {
    this.tone(300, 0.04, 0.2, 'square');
  }
  update(state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inCar = state.inCar;
    const rpm = inCar ? 0.2 + Math.min(1, Math.abs(state.speed) / 45) : 0;
    this.engOsc.frequency.setTargetAtTime(35 + rpm * 120 + state.throttle * 15, t, 0.08);
    this.engOsc2.frequency.setTargetAtTime((35 + rpm * 120) * 0.5, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(250 + rpm * 900, t, 0.1);
    this.engGain.gain.setTargetAtTime(inCar ? 0.09 + state.throttle * 0.05 : 0, t, 0.1);
    this.sirGain.gain.setTargetAtTime(state.siren ? 0.05 * state.siren : 0, t, 0.3);
    this.hornGain.gain.setTargetAtTime(state.horn ? 0.08 : 0, t, 0.02);
  }
}
