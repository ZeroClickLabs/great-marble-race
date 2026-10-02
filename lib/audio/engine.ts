"use client";

import { noiseBuffer, Sequencer, SONGS, type Intensity } from "./music";

const PREFS_KEY = "gmr:sound";

interface Prefs {
  muted: boolean;
  volume: number;
}

const DEFAULT_VOLUME = 0.8;

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = { muted: false, volume: DEFAULT_VOLUME, ...JSON.parse(raw) };
      // Never come back silently at zero volume; "off" is what mute is for.
      if (!(p.volume > 0.02)) p.volume = DEFAULT_VOLUME;
      return p;
    }
  } catch {}
  return { muted: false, volume: DEFAULT_VOLUME };
}

/**
 * All game audio for the host screen. Everything is synthesised with Web Audio, except an
 * optional per-theme MP3 at /music/<theme>.mp3 that replaces the generated music.
 *
 * Mix: music + sfx + ambience → slow-mo lowpass → compressor → master volume → speakers.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private slowMoFilter: BiquadFilterNode;
  private music: GainNode;
  private sfx: GainNode;
  private reverb: ConvolverNode;
  private sequencer: Sequencer;
  private noise: AudioBuffer;
  private rolling: { gain: GainNode; filter: BiquadFilterNode };
  private crowd: { gain: GainNode };
  private file: HTMLAudioElement | null = null;
  private fileGain: GainNode;
  private theme: string | null = null;
  private intensity: Intensity = 0;
  private overrides = new Map<string, boolean>();
  private lastPlayed = new Map<string, number>();
  prefs: Prefs;

  constructor() {
    const ctx = new AudioContext({ latencyHint: "playback" });
    this.ctx = ctx;
    this.prefs = loadPrefs();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.slowMoFilter = ctx.createBiquadFilter();
    this.slowMoFilter.type = "lowpass";
    this.slowMoFilter.frequency.value = 20000;
    this.slowMoFilter.connect(comp).connect(this.master).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.slowMoFilter);

    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.slowMoFilter);
    this.fileGain = ctx.createGain();
    this.fileGain.connect(this.music);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.slowMoFilter);

    this.noise = noiseBuffer(ctx, 2);
    this.sequencer = new Sequencer(ctx, this.music, this.reverb);
    this.rolling = this.loop("lowpass", 380, 0.8);
    this.crowd = { gain: this.loop("bandpass", 900, 0.6, true).gain };
    this.applyVolume();
  }

  // ------------------------------------------------------------ plumbing

  /** Browsers start audio suspended until a user gesture; call from any click. */
  unlock() {
    if (this.ctx.state !== "running") this.ctx.resume();
    // An MP3 override that tried to start before the first click was blocked; retry it.
    if (this.file?.paused) this.file.play().catch(() => {});
  }

  get unlocked() {
    return this.ctx.state === "running";
  }

  setMuted(muted: boolean) {
    this.prefs.muted = muted;
    this.savePrefs();
    this.applyVolume();
  }

  /** Dragging to zero counts as muting, keeping the last audible volume for when sound comes back. */
  setVolume(volume: number) {
    if (volume <= 0.02) return this.setMuted(true);
    this.prefs.volume = volume;
    this.prefs.muted = false;
    this.savePrefs();
    this.applyVolume();
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {}
  }

  private applyVolume() {
    const v = this.prefs.muted ? 0 : this.prefs.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private impulse(seconds: number) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  /** A continuously running filtered-noise bed whose level we ride (rolling marbles, crowd). */
  private loop(type: BiquadFilterType, freq: number, q: number, wobble = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    let node: AudioNode = src.connect(filter);
    if (wobble) {
      // Amplitude flutter makes noise read as a crowd rather than wind.
      const am = this.ctx.createGain();
      am.gain.value = 0.7;
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      lfo.frequency.value = 7;
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(am.gain);
      lfo.start();
      node = node.connect(am);
    }
    node.connect(gain).connect(this.sfx);
    src.start();
    return { gain, filter };
  }

  /** Don't stack the same effect more often than `gapMs`. */
  private throttle(key: string, gapMs: number) {
    const now = performance.now();
    if (now - (this.lastPlayed.get(key) ?? -1e9) < gapMs) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  // ------------------------------------------------------------ music

  /** Switch to a theme's music (generated, or /music/<theme>.mp3 if present). */
  async playTheme(theme: string, intensity: Intensity) {
    this.intensity = intensity;
    if (this.theme === theme) return this.setIntensity(intensity);
    this.stopMusic();
    this.theme = theme;
    if (await this.hasOverride(theme)) {
      if (this.theme !== theme) return; // switched again while checking
      const el = new Audio(`/music/${theme}.mp3`);
      el.loop = true;
      el.crossOrigin = "anonymous";
      this.ctx.createMediaElementSource(el).connect(this.fileGain);
      this.file = el;
      this.applyFileLevel();
      el.play().catch(() => {});
    } else {
      this.sequencer.play(SONGS[theme] ?? SONGS.sunny, intensity);
    }
  }

  setIntensity(intensity: Intensity) {
    this.intensity = intensity;
    this.sequencer.setIntensity(intensity);
    this.applyFileLevel();
  }

  private applyFileLevel() {
    this.fileGain.gain.setTargetAtTime([0.55, 0.8, 1][this.intensity], this.ctx.currentTime, 0.4);
  }

  stopMusic() {
    this.theme = null;
    this.sequencer.stop();
    if (this.file) {
      this.file.pause();
      this.file = null;
    }
  }

  private async hasOverride(theme: string) {
    if (!this.overrides.has(theme)) {
      try {
        const res = await fetch(`/music/${theme}.mp3`, { method: "HEAD" });
        this.overrides.set(theme, res.ok && (res.headers.get("content-type") ?? "").startsWith("audio"));
      } catch {
        this.overrides.set(theme, false);
      }
    }
    return this.overrides.get(theme)!;
  }

  /** Muffle everything during slow-motion photo finishes. */
  setSlowMo(on: boolean) {
    this.slowMoFilter.frequency.setTargetAtTime(on ? 900 : 20000, this.ctx.currentTime, on ? 0.08 : 0.25);
  }

  // ------------------------------------------------------------ ambience

  /** pace: typical marble speed (m/s). Drives the rolling rumble. */
  setRolling(pace: number) {
    const level = Math.min(1, pace / 7);
    this.rolling.gain.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.15);
    this.rolling.filter.frequency.setTargetAtTime(220 + level * 500, this.ctx.currentTime, 0.2);
  }

  /** 0..1 background crowd murmur. */
  setCrowd(level: number) {
    this.crowd.gain.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.4);
  }

  // ------------------------------------------------------------ sound effects

  private tone(freq: number, t: number, len: number, peak: number, type: OscillatorType = "sine", glideTo?: number) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + len);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(this.sfx);
    const s = this.ctx.createGain();
    s.gain.value = 0.3;
    g.connect(s).connect(this.reverb);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  private burst(t: number, type: BiquadFilterType, from: number, to: number, len: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + len);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + len * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + len + 0.05);
  }

  /** 3, 2, 1 … */
  countdownBeep() {
    const t = this.ctx.currentTime;
    this.tone(660, t, 0.25, 0.35, "square");
    this.tone(1320, t, 0.12, 0.08, "sine");
  }

  /** GO! plus the starting gate dropping. */
  go() {
    const t = this.ctx.currentTime;
    for (const f of [880, 1108.7, 1318.5]) this.tone(f, t, 0.7, 0.18, "square");
    this.tone(140, t + 0.02, 0.3, 0.6, "sine", 50); // gate thunk
    this.burst(t + 0.02, "lowpass", 900, 200, 0.25, 0.4);
    this.cheer(0.7, 2.5);
  }

  boost() {
    if (!this.throttle("boost", 450)) return;
    this.burst(this.ctx.currentTime, "bandpass", 400, 3500, 0.45, 0.25);
  }

  leadChange() {
    if (!this.throttle("lead", 1200)) return;
    const t = this.ctx.currentTime;
    this.tone(988, t, 0.12, 0.12, "triangle");
    this.tone(1319, t + 0.09, 0.2, 0.12, "triangle");
  }

  checkpoint() {
    const t = this.ctx.currentTime;
    this.tone(784, t, 0.35, 0.15, "sine");
    this.tone(1175, t + 0.12, 0.5, 0.15, "sine");
  }

  /** Live prop opened: a bright "ding-ding" to send people to their phones. */
  propOpened() {
    const t = this.ctx.currentTime;
    for (const [d, f] of [
      [0, 1568],
      [0.16, 2093],
    ])
      this.tone(f, t + d, 0.6, 0.22, "sine");
  }

  /** Crowd roar: swell then decay. */
  cheer(strength = 1, seconds = 3) {
    const t = this.ctx.currentTime;
    const g = this.crowd.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.45 * strength, t + 0.35);
    g.setTargetAtTime(0.04, t + 0.6, seconds / 3);
  }

  finished(place: number) {
    if (place === 1) {
      this.fanfare();
      this.cheer(1, 4);
    } else if (this.throttle("finish", 150)) {
      this.tone(1760, this.ctx.currentTime, 0.12, 0.06, "triangle");
    }
  }

  fanfare() {
    const t = this.ctx.currentTime;
    const notes: [number, number, number][] = [
      [523.3, 0, 0.18],
      [659.3, 0.15, 0.18],
      [784, 0.3, 0.18],
      [1046.5, 0.45, 0.9],
    ];
    for (const [f, d, len] of notes) {
      this.tone(f, t + d, len, 0.16, "sawtooth");
      this.tone(f / 2, t + d, len, 0.1, "square");
    }
  }

  /** Marbles knocked out. */
  elimination() {
    const t = this.ctx.currentTime;
    this.tone(90, t, 1.2, 0.7, "sine", 35);
    this.burst(t, "lowpass", 1200, 80, 1.0, 0.5);
    this.tone(220, t + 0.05, 0.6, 0.08, "sawtooth", 110);
  }

  /** Grand champion crowned. */
  champion() {
    this.fanfare();
    const t = this.ctx.currentTime + 1.1;
    for (const [d, f] of [
      [0, 784],
      [0.2, 1046.5],
      [0.4, 1318.5],
      [0.6, 1568],
    ])
      this.tone(f, t + d, 1.4, 0.12, "triangle");
    this.cheer(1.2, 6);
  }

  dispose() {
    this.stopMusic();
    this.ctx.close();
  }
}

let shared: AudioEngine | null = null;

/** One engine per page; created lazily in the browser. */
export function audioEngine() {
  if (!shared) {
    shared = new AudioEngine();
    if (process.env.NODE_ENV !== "production") (window as unknown as { __audio: AudioEngine }).__audio = shared;
  }
  return shared;
}

/** Dev aid: RMS level of what's playing, measured on the master bus. */
export function measureLevel(engine: AudioEngine, ms = 1000): Promise<number> {
  const analyser = engine.ctx.createAnalyser();
  analyser.fftSize = 2048;
  (engine as unknown as { master: GainNode }).master.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let sum = 0;
  let n = 0;
  return new Promise((resolve) => {
    const id = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      for (const v of buf) sum += v * v;
      n += buf.length;
    }, 50);
    setTimeout(() => {
      clearInterval(id);
      analyser.disconnect();
      resolve(Math.sqrt(sum / Math.max(1, n)));
    }, ms);
  });
}
