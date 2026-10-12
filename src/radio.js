// In-car radio: every station plays endless procedurally generated music
// (chord progressions, bass, drums and melody are rolled at random — no recordings).
const STATIONS = [
  { name: 'Neon Wave 88.1', genre: 'Synthwave', bpm: 104, scale: [0, 2, 3, 5, 7, 8, 10], lead: 'sawtooth', drums: 'four', root: 45 },
  { name: 'Bay Beats 97.3', genre: 'Hip-Hop', bpm: 88, scale: [0, 3, 5, 7, 10], lead: 'triangle', drums: 'boom', root: 41 },
  { name: 'Rust Radio 104', genre: 'Rock', bpm: 132, scale: [0, 3, 5, 7, 10], lead: 'square', drums: 'rock', root: 40 },
  { name: 'Palm FM 92.5', genre: 'Island Lounge', bpm: 96, scale: [0, 2, 4, 5, 7, 9, 11], lead: 'sine', drums: 'reggae', root: 48 },
  { name: 'Radio Off' },
];
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 4, 3], [0, 5, 2, 4], [0, 4, 5, 3], [0, 0, 3, 4]];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Radio {
  constructor(audio) {
    this.audio = audio;
    this.station = 0;
    this.on = false;
    this.step = 0;
    this.nextTime = 0;
    this.song = null;
  }
  get stations() {
    return STATIONS;
  }
  get current() {
    return STATIONS[this.station];
  }
  setup() {
    const c = this.audio.ctx;
    if (!c || this.out) return;
    this.out = c.createGain();
    this.out.gain.value = 0;
    // a touch of "speaker" colour
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 70;
    this.out.connect(hp);
    hp.connect(this.audio.master);
  }
  next() {
    this.station = (this.station + 1) % STATIONS.length;
    this.newSong();
    return this.current;
  }
  newSong() {
    const st = this.current;
    if (!st.bpm) return;
    const r = Math.random;
    this.song = {
      prog: PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)],
      bpm: st.bpm + Math.round((r() - 0.5) * 10),
      key: st.root + Math.floor(r() * 5) - 2,
      // a 16-step melody motif that repeats with small variations
      motif: Array.from({ length: 16 }, () => (r() < 0.55 ? Math.floor(r() * st.scale.length) + (r() < 0.3 ? st.scale.length : 0) : -1)),
      bars: 0,
    };
    this.step = 0;
  }
  // called every frame; schedules notes slightly ahead of time
  update(inCar, dt) {
    const c = this.audio.ctx;
    if (!c) return;
    this.setup();
    const st = this.current;
    const active = inCar && !!st.bpm;
    this.out.gain.setTargetAtTime(active ? 0.16 : 0, c.currentTime, 0.25);
    if (!active) {
      this.nextTime = 0;
      return;
    }
    if (!this.song) this.newSong();
    const sixteenth = 60 / this.song.bpm / 4;
    if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.05;
    while (this.nextTime < c.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
      if (this.step % 64 === 0) {
        this.song.bars += 4;
        if (this.song.bars >= 32) this.newSong(); // new "track" every 32 bars
      }
    }
  }

  // ---- instruments ----
  note(freq, t, dur, type, vol, filter = 2000) {
    const c = this.audio.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  kick(t) {
    const c = this.audio.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
  }
  noise(t, dur, freq, vol, type = 'highpass') {
    const c = this.audio.ctx;
    const src = c.createBufferSource();
    src.buffer = this.audio.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.out);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  playStep(i, t, six) {
    const st = this.current, song = this.song;
    const s16 = i % 16;
    const bar = Math.floor(i / 16) % 4;
    const deg = song.prog[bar];
    const scale = st.scale;
    const pitch = (d) => song.key + scale[((d % scale.length) + scale.length) % scale.length] + 12 * Math.floor(d / scale.length);
    // drums
    const d = st.drums;
    if (d === 'four') {
      if (s16 % 4 === 0) this.kick(t);
      if (s16 === 4 || s16 === 12) this.noise(t, 0.18, 1500, 0.35, 'bandpass');
      if (s16 % 2 === 1) this.noise(t, 0.04, 7000, 0.12);
    } else if (d === 'boom') {
      if (s16 === 0 || s16 === 7 || s16 === 10) this.kick(t);
      if (s16 === 4 || s16 === 12) this.noise(t, 0.22, 1200, 0.45, 'bandpass');
      if (s16 % 2 === 0) this.noise(t, 0.05, 8000, 0.1);
    } else if (d === 'rock') {
      if (s16 === 0 || s16 === 8 || s16 === 10) this.kick(t);
      if (s16 === 4 || s16 === 12) this.noise(t, 0.2, 1800, 0.5, 'bandpass');
      if (s16 % 2 === 0) this.noise(t, 0.08, 6000, 0.15);
    } else if (d === 'reggae') {
      if (s16 === 8) this.kick(t);
      if (s16 === 8) this.noise(t, 0.15, 2200, 0.3, 'bandpass');
      if (s16 % 4 === 2) this.noise(t, 0.05, 9000, 0.12);
    }
    // bass
    if (d === 'rock' ? s16 % 2 === 0 : s16 % 4 === 0 || (d === 'boom' && s16 === 10)) {
      this.note(midi(pitch(deg) - 12), t, six * (d === 'rock' ? 1.8 : 3.5), d === 'rock' ? 'sawtooth' : 'triangle', 0.32, 600);
    }
    // chords
    const chordOn = d === 'reggae' ? s16 % 4 === 2 : d === 'rock' ? s16 % 8 === 0 : s16 === 0 || (d === 'four' && s16 === 8);
    if (chordOn) {
      const len = d === 'reggae' ? six * 1.2 : six * 7;
      for (const k of [0, 2, 4]) this.note(midi(pitch(deg + k) + 12), t, len, d === 'rock' ? 'sawtooth' : 'square', d === 'rock' ? 0.05 : 0.035, d === 'rock' ? 1400 : 1800);
    }
    // lead melody (sits out every other 4 bars)
    if (Math.floor(i / 64) % 2 === 1) {
      const m = song.motif[s16];
      if (m >= 0) this.note(midi(pitch(deg + m) + 12), t, six * 1.6, st.lead, 0.07, 3200);
    }
  }
}
