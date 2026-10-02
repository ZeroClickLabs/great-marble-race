import { FIXED_DT, Race, type Entrant, type RaceEvent } from "./engine";
import { RaceRenderer } from "./renderer";
import type { Theme } from "./themes";
import type { Track } from "./track";

export interface RaceSnapshot {
  phase: Race["phase"];
  time: number;
  standings: number[];
  /** 0..1 progress from the gate to the finish line, by slot. */
  progress: Record<number, number>;
  finished: number[];
  slowMo: boolean;
  /** Average speed (m/s) of the leading marbles still racing — drives the rolling sound. */
  pace: number;
}

export interface RunnerOptions {
  host: HTMLElement;
  track: Track;
  theme: Theme;
  entrants: Entrant[];
  seed: number;
  /** How many marbles get knocked out this race (drives the "battle" camera). */
  eliminate: number;
  onEvent?: (e: RaceEvent) => void;
  onTick?: (s: RaceSnapshot) => void;
}

const TICK_MS = 200;

/** Owns a race simulation, its renderer and the animation loop. */
export class RaceRunner {
  readonly race: Race;
  readonly view: RaceRenderer;
  private raf = 0;
  private backup: ReturnType<typeof setInterval>;
  private last = 0;
  private lastRender = 0;
  private acc = 0;
  private lastTick = 0;
  private rate = 1;
  private cutCamUntil = 0;
  private nextCut = 9;
  private firstFinishAt: number | null = null;

  constructor(private opts: RunnerOptions) {
    this.race = new Race(opts.track, opts.entrants, opts.seed, opts.entrants.length - opts.eliminate);
    this.view = new RaceRenderer(opts.host, this.race, opts.theme);
    this.raf = requestAnimationFrame(this.frame);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __raceRunner: RaceRunner }).__raceRunner = this;
    // Browsers pause requestAnimationFrame in background tabs; keep the race (and the bets riding on it) moving.
    this.backup = setInterval(() => {
      if (this.last && performance.now() - this.last > 250) this.advance(Math.min(0.5, (performance.now() - this.last) / 1000), performance.now());
    }, 100);
  }

  /** Dev aid: average ms to render one frame (CPU + GPU, synchronous). */
  benchmark(frames = 120) {
    const gl = this.view.renderer.getContext();
    this.view.render(1 / 60);
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.view.render(1 / 60);
      gl.finish();
    }
    return (performance.now() - t0) / frames;
  }

  start() {
    this.race.start();
    this.view.mode = "leader";
  }

  snapshot(): RaceSnapshot {
    const { race } = this;
    const { gateS, finishS } = race.track;
    const progress: Record<number, number> = {};
    for (const r of race.racers) progress[r.slot] = Math.max(0, Math.min(1, (r.progress - gateS) / (finishS - gateS)));
    const pack = race.standings
      .map((slot) => race.racer(slot)!)
      .filter((r) => !r.finished)
      .slice(0, 6);
    const pace = race.phase === "running" && pack.length ? pack.reduce((s, r) => s + r.speed, 0) / pack.length : 0;
    return {
      phase: race.phase,
      time: race.time,
      standings: [...race.standings],
      progress,
      finished: [...race.finishOrder],
      slowMo: this.rate < 1,
      pace,
    };
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.advance(dt, now);
    // The camera eases by real time since the last drawn frame, so it keeps up even at low frame rates.
    this.view.render(this.lastRender ? Math.min(1, (now - this.lastRender) / 1000) : 0);
    this.lastRender = now;
  };

  private advance(dt: number, now: number) {
    this.last = now;
    this.direct();
    this.acc += dt * this.rate;
    while (this.acc >= FIXED_DT) {
      this.race.step();
      this.acc -= FIXED_DT;
      for (const e of this.race.drain()) {
        if (e.type === "finished" && this.firstFinishAt === null) this.firstFinishAt = this.race.time;
        this.opts.onEvent?.(e);
      }
    }
    if (now - this.lastTick > TICK_MS) {
      this.lastTick = now;
      this.opts.onTick?.(this.snapshot());
    }
  }

  /** Camera direction and slow motion. */
  private direct() {
    const { race, view } = this;
    if (race.phase === "grid") return;
    const { finishS } = race.track;
    const byRank = race.standings.map((slot) => race.racer(slot)!);
    const cut = byRank.length - this.opts.eliminate; // index of first marble in the danger zone
    const leader = byRank[0];
    const second = byRank[1];
    const t = race.time;

    // Slow-mo for a tight finish at the front, or at the elimination line.
    const near = (a?: { progress: number; finished: boolean }) => a && !a.finished && finishS - a.progress < 14;
    const tight = (a?: { progress: number }, b?: { progress: number }) => a && b && Math.abs(a.progress - b.progress) < 4;
    const lastSafe = byRank[cut - 1];
    const firstOut = byRank[cut];
    const photoFinish =
      (near(leader) && tight(leader, second)) ||
      (cut > 0 && cut < byRank.length && near(lastSafe) && tight(lastSafe, firstOut));
    this.rate = race.phase === "running" && photoFinish ? 0.35 : 1;

    if (race.phase === "done") {
      view.mode = "finish";
      return;
    }
    if (this.firstFinishAt === null) {
      if (finishS - leader.progress < 30) view.mode = "finish";
      else if (t > this.nextCut && cut > 0 && cut < byRank.length) {
        // Cut away to the fight for survival every so often.
        view.mode = "battle";
        view.battleSlot = firstOut.slot;
        this.cutCamUntil = t + 4.5;
        this.nextCut = t + 13;
      } else if (t > this.cutCamUntil) view.mode = "leader";
    } else if (t - this.firstFinishAt < 2.5) {
      view.mode = "finish";
    } else {
      // Winner is in. Follow whoever is fighting to avoid elimination.
      view.mode = "battle";
      const watched = firstOut ?? lastSafe ?? leader;
      view.battleSlot = watched.slot;
      if (finishS - watched.progress < 14) view.mode = "finish";
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.backup);
    this.view.dispose();
    this.race.dispose();
  }
}
