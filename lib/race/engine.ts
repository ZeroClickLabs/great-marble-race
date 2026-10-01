import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { makeRng, range, shuffle } from "./rng";
import {
  framePoint,
  frameQuaternion,
  LID_HEIGHT,
  MARBLE_RADIUS,
  SAMPLE_STEP,
  type MeshData,
  type Track,
} from "./track";

export const FIXED_DT = 1 / 60;
/** After the winner crosses, stragglers get this long before the race is called. */
const FINISH_GRACE = 15;
const MAX_RACE_TIME = 180;
/** Seconds to keep rolling after the last safe spot is taken. */
const DECIDED_LINGER = 2.5;
const STUCK_SECONDS = 1.5;
const BASE_DAMPING = 0.1;

let rapierReady: Promise<void> | null = null;
export function initPhysics() {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface Entrant {
  slot: number;
  /** Persistent tournament "form" in [-1, 1]. Slightly better form = slightly less drag. */
  form?: number;
}

export type RaceEvent =
  | { type: "start" }
  | { type: "checkpoint"; index: number; leader: number; standings: number[] }
  | { type: "lead_change"; leader: number; previous: number }
  | { type: "boost"; slot: number }
  | { type: "finished"; slot: number; place: number; time: number }
  | { type: "race_over"; order: number[] };

export interface MarbleState {
  slot: number;
  pos: Vector3;
  quat: Quaternion;
  /** Fractional sample index along the track. */
  progress: number;
  speed: number;
  finished: boolean;
  finishTime?: number;
}

interface Racer extends MarbleState {
  body: RAPIER.RigidBody;
  best: number;
  stuckFor: number;
  boosted: Set<number>;
}

type Spinner = { body: RAPIER.RigidBody; base: Quaternion; speed: number; angle: number };

function toRapierQuat(q: Quaternion) {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

function triMesh(data: MeshData) {
  return RAPIER.ColliderDesc.trimesh(data.vertices, data.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
}

export class Race {
  readonly track: Track;
  readonly world: RAPIER.World;
  readonly racers: Racer[] = [];
  phase: "grid" | "running" | "done" = "grid";
  /** Seconds since the gate dropped. */
  time = 0;
  standings: number[] = [];
  finishOrder: number[] = [];
  private events: RaceEvent[] = [];
  private gate: RAPIER.Collider;
  private spinners: Spinner[] = [];
  private checkpointsHit = new Set<number>();
  private leader = -1;
  private lastLeadChange = -10;
  private firstFinishTime: number | null = null;
  private rng: () => number;

  /**
   * @param safeSpots once this many marbles have finished, everything bettable is decided,
   *   so the race is called shortly after instead of waiting for stragglers.
   */
  constructor(track: Track, entrants: Entrant[], seed: number, private safeSpots = entrants.length) {
    this.track = track;
    const rng = makeRng(seed ^ 0x9e3779b9);
    this.rng = rng;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = FIXED_DT;
    this.world = world;

    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(triMesh(track.channel).setFriction(0.15).setRestitution(0.2), ground);
    world.createCollider(triMesh(track.lid).setFriction(0.1).setRestitution(0.1), ground);

    const wall = (s: number, y = 0.55) => {
      const f = track.samples[s];
      const p = framePoint(f, 0, y);
      return RAPIER.ColliderDesc.cuboid(1.75, 0.6, 0.05)
        .setTranslation(p.x, p.y, p.z)
        .setRotation(toRapierQuat(frameQuaternion(f)));
    };
    world.createCollider(wall(1), ground);
    world.createCollider(wall(track.samples.length - 2), ground);
    this.gate = world.createCollider(wall(track.gateS), ground);

    for (const o of track.obstacles) {
      if (o.kind === "spinner") {
        const f = track.samples[Math.round(o.s)];
        const p = framePoint(f, 0, 0.35);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
        world.createCollider(RAPIER.ColliderDesc.cuboid(o.halfLength, 0.2, 0.1).setRestitution(0.6), body);
        this.spinners.push({ body, base: frameQuaternion(f), speed: o.speed, angle: rng() * Math.PI });
      } else if (o.kind === "pegs") {
        for (const peg of o.pegs) {
          const f = track.samples[Math.round(peg.s)];
          const p = framePoint(f, peg.x, LID_HEIGHT / 2);
          world.createCollider(
            RAPIER.ColliderDesc.cylinder(LID_HEIGHT / 2, 0.1)
              .setTranslation(p.x, p.y, p.z)
              .setRotation(toRapierQuat(frameQuaternion(f)))
              .setRestitution(0.7),
            ground,
          );
        }
      }
    }

    // Grid: rows of four behind the gate, in a seeded random order.
    const lanes = [-1.05, -0.35, 0.35, 1.05];
    const order = shuffle(rng, entrants);
    order.forEach((e, i) => {
      const row = Math.floor(i / lanes.length);
      const s = track.gateS - 3 - row * 3;
      const f = track.samples[s];
      const p = framePoint(f, lanes[i % lanes.length] + range(rng, -0.04, 0.04), MARBLE_RADIUS + 0.05);
      const drag = BASE_DAMPING * (1 - 0.02 * (e.form ?? 0) + range(rng, -0.015, 0.015));
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setLinearDamping(drag)
          .setAngularDamping(0.05)
          .setCcdEnabled(true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.ball(MARBLE_RADIUS).setDensity(1).setFriction(0.4).setRestitution(range(rng, 0.3, 0.45)),
        body,
      );
      this.racers.push({
        slot: e.slot,
        body,
        pos: p.clone(),
        quat: new Quaternion(),
        progress: s,
        best: s,
        speed: 0,
        finished: false,
        stuckFor: 0,
        boosted: new Set(),
      });
    });
    this.updateStandings();
  }

  start() {
    if (this.phase !== "grid") return;
    this.world.removeCollider(this.gate, false);
    this.phase = "running";
    this.time = 0;
    this.events.push({ type: "start" });
  }

  /** Pop all events emitted since the last call. */
  drain(): RaceEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step() {
    if (this.phase === "done") return;
    for (const sp of this.spinners) {
      sp.angle += sp.speed * FIXED_DT;
      const q = sp.base.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), sp.angle));
      sp.body.setNextKinematicRotation(toRapierQuat(q));
    }
    this.world.step();
    if (this.phase === "running") this.time += FIXED_DT;

    for (const r of this.racers) {
      const t = r.body.translation();
      const q = r.body.rotation();
      r.pos.set(t.x, t.y, t.z);
      r.quat.set(q.x, q.y, q.z, q.w);
      const v = r.body.linvel();
      r.speed = Math.hypot(v.x, v.y, v.z);
      r.progress = this.locate(r.pos, r.progress);
      if (this.phase !== "running" || r.finished) continue;

      this.applyBoosts(r);
      this.unstick(r);

      if (r.progress >= this.track.finishS) {
        r.finished = true;
        r.finishTime = this.time;
        this.finishOrder.push(r.slot);
        this.firstFinishTime ??= this.time;
        this.events.push({ type: "finished", slot: r.slot, place: this.finishOrder.length, time: this.time });
      }
    }

    if (this.phase !== "running") return;
    this.updateStandings();
    this.checkCheckpoints();
    this.checkLeader();

    const allDone = this.finishOrder.length === this.racers.length;
    const graceOver = this.firstFinishTime !== null && this.time - this.firstFinishTime > FINISH_GRACE;
    const decided =
      this.finishOrder.length >= this.safeSpots &&
      this.time - this.racer(this.finishOrder[this.safeSpots - 1])!.finishTime! > DECIDED_LINGER;
    if (allDone || graceOver || decided || this.time > MAX_RACE_TIME) {
      this.phase = "done";
      this.events.push({ type: "race_over", order: [...this.standings] });
    }
  }

  /** Nearest track sample to `pos`, searching near the previous estimate so stacked helix loops don't confuse it. */
  private locate(pos: Vector3, prev: number): number {
    const samples = this.track.samples;
    const from = Math.max(0, Math.floor(prev) - 24);
    const to = Math.min(samples.length - 1, Math.floor(prev) + 48);
    let best = from;
    let bestD = Infinity;
    for (let i = from; i <= to; i++) {
      const d = samples[i].p.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Refine within the segment using the tangent.
    const f = samples[best];
    const along = pos.clone().sub(f.p).dot(f.t) / SAMPLE_STEP;
    return Math.max(0, Math.min(samples.length - 1, best + Math.max(-0.5, Math.min(0.5, along))));
  }

  private applyBoosts(r: Racer) {
    this.track.obstacles.forEach((o, i) => {
      if (o.kind !== "boost" || r.progress < o.s0 || r.progress > o.s1) return;
      const t = this.track.samples[Math.round(r.progress)].t;
      const m = r.body.mass();
      r.body.applyImpulse({ x: t.x * o.strength * m * FIXED_DT, y: t.y * o.strength * m * FIXED_DT, z: t.z * o.strength * m * FIXED_DT }, true);
      if (!r.boosted.has(i)) {
        r.boosted.add(i);
        this.events.push({ type: "boost", slot: r.slot });
      }
    });
  }

  private unstick(r: Racer) {
    if (r.progress > r.best + 0.5) {
      r.best = r.progress;
      r.stuckFor = 0;
      return;
    }
    r.stuckFor += FIXED_DT;
    if (r.stuckFor < STUCK_SECONDS) return;
    r.stuckFor = 0;
    const f = this.track.samples[Math.round(r.progress)];
    const m = r.body.mass();
    // Kick forward, up and sideways so a marble balanced dead-centre behind a peg rolls off it.
    const side = this.rng() < 0.5 ? -1.5 : 1.5;
    const k = new Vector3().addScaledVector(f.t, 2).addScaledVector(f.n, 1).addScaledVector(f.r, side).multiplyScalar(m);
    r.body.applyImpulse({ x: k.x, y: k.y, z: k.z }, true);
  }

  private updateStandings() {
    const finishedRank = new Map(this.finishOrder.map((slot, i) => [slot, i]));
    this.standings = [...this.racers]
      .sort((a, b) => {
        const fa = finishedRank.get(a.slot);
        const fb = finishedRank.get(b.slot);
        if (fa !== undefined || fb !== undefined) return (fa ?? Infinity) - (fb ?? Infinity);
        return b.progress - a.progress;
      })
      .map((r) => r.slot);
  }

  private checkCheckpoints() {
    const lead = this.racers.find((r) => r.slot === this.standings[0]);
    if (!lead) return;
    this.track.checkpoints.forEach((s, index) => {
      if (this.checkpointsHit.has(index) || lead.progress < s) return;
      this.checkpointsHit.add(index);
      this.events.push({ type: "checkpoint", index, leader: lead.slot, standings: [...this.standings] });
    });
  }

  private checkLeader() {
    const leader = this.standings[0];
    if (leader === this.leader) return;
    if (this.leader !== -1 && this.time - this.lastLeadChange < 1.5) return;
    if (this.leader !== -1) this.events.push({ type: "lead_change", leader, previous: this.leader });
    this.leader = leader;
    this.lastLeadChange = this.time;
  }

  spinnerPoses() {
    return this.spinners.map((sp) => {
      const t = sp.body.translation();
      const q = sp.body.rotation();
      return { pos: new Vector3(t.x, t.y, t.z), quat: new Quaternion(q.x, q.y, q.z, q.w) };
    });
  }

  racer(slot: number): MarbleState | undefined {
    return this.racers.find((r) => r.slot === slot);
  }

  dispose() {
    this.world.free();
  }
}
