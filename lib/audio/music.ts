/**
 * A tiny generative music engine: synth instruments + a 16-step sequencer.
 * Each theme has a "song" (tempo, key, chords, patterns). Intensity adds layers:
 *   0 = lobby (pad, soft arp, light groove)  1 = racing (full band)  2 = finale (lead + driving hats)
 */

export type Intensity = 0 | 1 | 2;

interface Timbre {
  bass: OscillatorType;
  arp: OscillatorType;
  lead: OscillatorType;
  pad: OscillatorType;
  /** Bell-like FM arps instead of plucks. */
  bell?: boolean;
  /** Distorted bass. */
  grit?: boolean;
  /** Clap instead of snare. */
  clap?: boolean;
}

export interface Song {
  bpm: number;
  /** MIDI note of the key's root (bass plays an octave or two below). */
  root: number;
  scale: number[];
  /** One chord per bar, as scale degrees. */
  progression: number[][];
  kick: string[];
  snare: string[];
  hat: string[];
  /** 16 steps: 'x' chord root, 'o' octave up, '5' fifth, '.' rest. */
  bass: string;
  /** Index into the chord tones per 16th step; -1 = rest. */
  arp: number[];
  /** Two bars of 16ths, scale degrees (null = rest), played at intensity 2. */
  lead: (number | null)[];
  timbre: Timbre;
  swing?: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

// Drum patterns are indexed by intensity.
export const SONGS: Record<string, Song> = {
  sunny: {
    bpm: 122,
    root: 60,
    scale: MAJOR,
    progression: [[0, 2, 4], [4, 6, 8], [5, 7, 9], [3, 5, 7]],
    kick: ["x.......x.......", "x...x...x...x...", "x...x...x...x.x."],
    snare: ["................", "....x.......x...", "....x.......x..x"],
    hat: ["..x...x...x...x.", "..x...x...x...x.", "x.x.x.x.x.x.x.xx"],
    bass: "x..x..o.x..x..5.",
    arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 3, -1],
    lead: [4, null, 4, 5, 7, null, 5, 4, 2, null, 2, null, 4, null, null, null, 4, null, 4, 5, 7, null, 9, 7, 5, null, 4, null, 2, null, null, null],
    timbre: { bass: "square", arp: "triangle", lead: "square", pad: "sawtooth", clap: true },
    swing: 0.06,
  },
  neon: {
    bpm: 108,
    root: 57,
    scale: MINOR,
    progression: [[0, 2, 4], [5, 7, 9], [2, 4, 6], [6, 8, 10]],
    kick: ["x.......x.......", "x...x...x...x...", "x...x...x...x..x"],
    snare: ["................", "....x.......x...", "....x.......x.x."],
    hat: ["................", "..x...x...x...x.", "x.xxx.xxx.xxx.xx"],
    bass: "x.x.x.x.x.x.x.x.",
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 0, 1],
    lead: [7, null, null, 6, 7, null, 9, null, 7, null, 6, null, 4, null, null, null, 4, null, null, 6, 7, null, 6, 4, 2, null, 4, null, 0, null, null, null],
    timbre: { bass: "sawtooth", arp: "sawtooth", lead: "sawtooth", pad: "sawtooth" },
  },
  candy: {
    bpm: 132,
    root: 65,
    scale: MAJOR,
    progression: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    kick: ["x.......x.......", "x.......x.......", "x...x...x...x..."],
    snare: ["................", "....x.......x...", "....x.......x.xx"],
    hat: ["x...x...x...x...", "x.x.x.x.x.x.x.x.", "xxxxxxxxxxxxxxxx"],
    bass: "x...o...x...o...",
    arp: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
    lead: [0, 2, 4, 7, 4, 2, 0, null, 2, 4, 5, 9, 5, 4, 2, null, 4, 5, 7, 11, 9, 7, 5, null, 7, null, 4, null, 7, null, null, null],
    timbre: { bass: "triangle", arp: "square", lead: "square", pad: "triangle", clap: true },
  },
  glacier: {
    bpm: 96,
    root: 64,
    scale: MINOR,
    progression: [[0, 2, 4], [5, 7, 9], [6, 8, 10], [0, 2, 4]],
    kick: ["x...............", "x.......x.......", "x.....x.x.....x."],
    snare: ["................", "........x.......", "....x.......x..."],
    hat: ["....x.......x...", "..x...x...x...x.", "x.x.x.x.x.x.x.x."],
    bass: "x.......x...5...",
    arp: [0, -1, 2, -1, 1, -1, 3, -1, 2, -1, 0, -1, 3, -1, 1, -1],
    lead: [7, null, null, null, 9, null, 7, null, 4, null, null, null, 2, null, null, null, 4, null, null, null, 7, null, 9, null, 11, null, null, null, 9, null, null, null],
    timbre: { bass: "sine", arp: "sine", lead: "triangle", pad: "triangle", bell: true },
  },
  // Grand final: a music-box lullaby; the lead is "Twinkle Twinkle Little Star" (public domain).
  coterie: {
    bpm: 112,
    root: 60,
    scale: MAJOR,
    progression: [[0, 2, 4], [4, 6, 8], [3, 5, 7], [4, 6, 8]],
    kick: ["x.......x.......", "x.......x.......", "x...x...x...x..."],
    snare: ["................", "....x.......x...", "....x.......x..x"],
    hat: ["....x.......x...", "..x...x...x...x.", "x.x.x.x.x.x.x.x."],
    bass: "x.......5.......",
    arp: [0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 0, -1, 2, -1],
    lead: [
      0, null, 0, null, 4, null, 4, null, 5, null, 5, null, 4, null, null, null,
      3, null, 3, null, 2, null, 2, null, 1, null, 1, null, 0, null, null, null,
    ],
    timbre: { bass: "sine", arp: "sine", lead: "triangle", pad: "triangle", bell: true, clap: true },
  },
  volcano: {
    bpm: 140,
    root: 52,
    scale: PHRYGIAN,
    progression: [[0, 2, 4], [0, 2, 4], [5, 7, 9], [6, 8, 10]],
    kick: ["x.......x.......", "x...x...x...x...", "x.x.x...x.x.x.x."],
    snare: ["................", "....x.......x...", "....x..x....x.xx"],
    hat: ["................", "..x...x...x...x.", "xxxxxxxxxxxxxxxx"],
    bass: "xx.xx.xxx.xx.x5.",
    arp: [0, -1, -1, 0, -1, -1, 1, -1, 0, -1, -1, 0, -1, 2, -1, 1],
    lead: [0, null, 1, null, 0, null, null, 4, 3, null, 1, null, 0, null, null, null, 4, null, 5, null, 4, null, 3, 1, 0, null, null, null, -1, null, null, null],
    timbre: { bass: "sawtooth", arp: "square", lead: "sawtooth", pad: "sawtooth", grit: true },
  },
};

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function noiseBuffer(ctx: BaseAudioContext, seconds = 1) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function distortionCurve(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** Plays a Song through `out`, scheduled slightly ahead of time for sample-accurate timing. */
export class Sequencer {
  private song: Song | null = null;
  private intensity: Intensity = 0;
  private pendingIntensity: Intensity = 0;
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private noise: AudioBuffer;
  private shaper: WaveShaperNode;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private reverbSend: AudioNode,
  ) {
    this.noise = noiseBuffer(ctx, 1);
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = distortionCurve(12);
    this.shaper.connect(out);
  }

  play(song: Song, intensity: Intensity) {
    this.stop();
    this.song = song;
    this.intensity = this.pendingIntensity = intensity;
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  /** Takes effect at the next bar line so changes land on the beat. */
  setIntensity(i: Intensity) {
    this.pendingIntensity = i;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const song = this.song;
    if (!song) return;
    const sixteenth = 60 / song.bpm / 4;
    const now = this.ctx.currentTime;
    // If timers were throttled (background tab), skip ahead rather than firing a backlog of notes.
    if (this.nextTime < now - 0.05) this.nextTime = now + 0.05;
    // Hidden tabs only get ~1 timer tick per second, so schedule further ahead there.
    const lookahead = typeof document !== "undefined" && document.hidden ? 1.5 : 0.15;
    while (this.nextTime < now + lookahead) {
      if (this.step === 0) this.intensity = this.pendingIntensity;
      const swing = this.step % 2 === 1 ? (song.swing ?? 0) * sixteenth * 2 : 0;
      this.playStep(song, this.step, this.nextTime + swing, sixteenth);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private chordNotes(song: Song) {
    const degrees = song.progression[this.bar % song.progression.length];
    return degrees.map((d) => {
      const octave = Math.floor(d / song.scale.length);
      return song.root + song.scale[((d % song.scale.length) + song.scale.length) % song.scale.length] + octave * 12;
    });
  }

  private degreeNote(song: Song, d: number) {
    const n = song.scale.length;
    const octave = Math.floor(d / n);
    return song.root + song.scale[((d % n) + n) % n] + octave * 12;
  }

  private playStep(song: Song, step: number, t: number, sixteenth: number) {
    const lvl = this.intensity;
    const chord = this.chordNotes(song);
    const fillBar = lvl >= 1 && this.bar % 4 === 3 && step >= 12;

    if (song.kick[lvl][step] === "x") this.kick(t);
    if (song.snare[lvl][step] === "x" || (fillBar && step % 2 === 0)) {
      if (song.timbre.clap) this.clap(t);
      else this.snare(t);
    }
    if (song.hat[lvl][step] === "x") this.hat(t, lvl === 2 && step % 4 === 2 ? 0.18 : 0.05);

    // Pad: one sustained chord per bar.
    if (step === 0) this.pad(song, chord, t, sixteenth * 16);

    if (lvl >= 1) {
      const b = song.bass[step];
      if (b !== ".") {
        const root = chord[0] - 24;
        const note = b === "o" ? root + 12 : b === "5" ? root + 7 : root;
        this.bass(song, midiToHz(note), t, sixteenth * 1.6);
      }
    }

    // Arp: 8ths in the lobby, full pattern while racing.
    const a = song.arp[step];
    if (a >= 0 && (lvl >= 1 || step % 2 === 0)) {
      const note = chord[a % chord.length] + (a >= chord.length ? 12 : 0) + 12;
      if (song.timbre.bell) this.bell(midiToHz(note), t, lvl === 0 ? 0.05 : 0.08);
      else this.pluck(song.timbre.arp, midiToHz(note), t, sixteenth * 0.9, lvl === 0 ? 0.035 : 0.055);
    }

    if (lvl === 2) {
      const d = song.lead[(this.bar % 2) * 16 + step];
      if (d !== null) this.lead(song.timbre.lead, midiToHz(this.degreeNote(song, d) + 12), t, sixteenth * 1.8);
    }
  }

  // ------------------------------------------------------------ instruments

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.9, 0.002, 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseHit(t: number, filter: BiquadFilterType, freq: number, peak: number, decay: number, toReverb = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.001, decay);
    src.connect(f).connect(g).connect(this.out);
    if (toReverb) {
      const s = this.ctx.createGain();
      s.gain.value = toReverb;
      g.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  private snare(t: number) {
    this.noiseHit(t, "highpass", 1400, 0.35, 0.18, 0.4);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(190, t);
    this.env(g, t, 0.25, 0.001, 0.08);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
  }

  private clap(t: number) {
    for (const d of [0, 0.012, 0.024]) this.noiseHit(t + d, "bandpass", 1600, 0.3, 0.09, 0.3);
  }

  private hat(t: number, decay: number) {
    this.noiseHit(t, "highpass", 8000, 0.12, decay);
  }

  private bass(song: Song, hz: number, t: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = song.timbre.bass;
    o.frequency.value = hz;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 6;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(220, t + len);
    const g = this.ctx.createGain();
    this.env(g, t, song.timbre.grit ? 0.16 : 0.28, 0.005, len);
    o.connect(f).connect(g).connect(song.timbre.grit ? this.shaper : this.out);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private pluck(type: OscillatorType, hz: number, t: number, len: number, peak: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(600, t + len);
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.003, len);
    o.connect(f).connect(g).connect(this.out);
    const s = this.ctx.createGain();
    s.gain.value = 0.35;
    g.connect(s).connect(this.reverbSend);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private bell(hz: number, t: number, peak: number) {
    // Two-operator FM: a slightly inharmonic modulator gives a glassy bell.
    const car = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    car.frequency.value = hz;
    mod.frequency.value = hz * 3.5;
    modGain.gain.setValueAtTime(hz * 2, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.8);
    mod.connect(modGain).connect(car.frequency);
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.002, 1.1);
    car.connect(g).connect(this.out);
    const s = this.ctx.createGain();
    s.gain.value = 0.6;
    g.connect(s).connect(this.reverbSend);
    car.start(t);
    mod.start(t);
    car.stop(t + 1.2);
    mod.stop(t + 1.2);
  }

  private lead(type: OscillatorType, hz: number, t: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const vib = this.ctx.createOscillator();
    const vibGain = this.ctx.createGain();
    vib.frequency.value = 5.5;
    vibGain.gain.value = hz * 0.006;
    vib.connect(vibGain).connect(o.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 3200;
    const g = this.ctx.createGain();
    this.env(g, t, 0.07, 0.01, len);
    o.connect(f).connect(g).connect(this.out);
    const s = this.ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.reverbSend);
    o.start(t);
    vib.start(t);
    o.stop(t + len + 0.05);
    vib.stop(t + len + 0.05);
  }

  private pad(song: Song, chord: number[], t: number, len: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(this.intensity === 0 ? 0.05 : 0.035, t + len * 0.25);
    g.gain.setValueAtTime(this.intensity === 0 ? 0.05 : 0.035, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = this.intensity === 2 ? 2400 : 1200;
    f.connect(g).connect(this.out);
    const s = this.ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.reverbSend);
    for (const n of chord) {
      for (const detune of [-8, 8]) {
        const o = this.ctx.createOscillator();
        o.type = song.timbre.pad;
        o.frequency.value = midiToHz(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    }
  }
}

export { noiseBuffer };
