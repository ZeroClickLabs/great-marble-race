import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";
import { makeRng, range, type Rng } from "./rng";

/** Distance between consecutive track samples (world units). */
export const SAMPLE_STEP = 0.25;
export const TRACK_HALF_WIDTH = 1.6;
export const WALL_HEIGHT = 1.0;
export const LID_HEIGHT = 1.05;
export const MARBLE_RADIUS = 0.25;

const UP = new Vector3(0, 1, 0);
/** Turns are banked as if taken at this speed (m/s). */
const BANK_SPEED = 5.5;
/** tan of the steepest bank angle (~35°). */
const MAX_BANK = 0.7;

/** Orthonormal frame along the track: t = forward, r = right, n = up (right-handed: r × n = t). */
export interface Frame {
  p: Vector3;
  t: Vector3;
  r: Vector3;
  n: Vector3;
}

export type Obstacle =
  | { kind: "spinner"; s: number; halfLength: number; speed: number }
  | { kind: "pegs"; s0: number; s1: number; pegs: { s: number; x: number }[] }
  | { kind: "boost"; s0: number; s1: number; strength: number };

export interface MeshData {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface Track {
  seed: number;
  samples: Frame[];
  /** Visible + collidable channel surface. */
  channel: MeshData;
  /** Invisible ceiling that keeps marbles inside the channel. */
  lid: MeshData;
  gateS: number;
  finishS: number;
  checkpoints: number[];
  obstacles: Obstacle[];
  /** Total centreline length in world units. */
  length: number;
}

/** Cross-section of the U-channel in (lateral, up) coordinates. */
export const PROFILE: [number, number][] = [
  [-TRACK_HALF_WIDTH, WALL_HEIGHT],
  [-TRACK_HALF_WIDTH, 0.4],
  [-1.5, 0.15],
  [-1.25, 0],
  [1.25, 0],
  [1.5, 0.15],
  [TRACK_HALF_WIDTH, 0.4],
  [TRACK_HALF_WIDTH, WALL_HEIGHT],
];

interface Walker {
  pos: Vector3;
  heading: number; // radians, 0 = +z
  points: Vector3[];
}

const MAX_HEADING = 1.05;

function dir(heading: number) {
  return new Vector3(Math.sin(heading), 0, Math.cos(heading));
}

function step(w: Walker, length: number, slope: number) {
  w.pos = w.pos.clone().add(dir(w.heading).multiplyScalar(length)).add(new Vector3(0, -length * slope, 0));
  w.points.push(w.pos);
}

function straight(w: Walker, length: number, slope: number) {
  const n = Math.max(1, Math.round(length / 4));
  for (let i = 0; i < n; i++) step(w, length / n, slope);
}

function snake(w: Walker, rng: Rng) {
  const n = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const turn = range(rng, 0.25, 0.5) * (w.heading > 0.3 ? -1 : w.heading < -0.3 ? 1 : rng() < 0.5 ? -1 : 1);
    w.heading = Math.max(-MAX_HEADING, Math.min(MAX_HEADING, w.heading + turn));
    step(w, 7, range(rng, 0.13, 0.18));
  }
}

function helix(w: Walker, rng: Rng) {
  const radius = range(rng, 4.5, 6);
  const turns = rng() < 0.6 ? 1 : 2;
  const dropPerTurn = 4.6;
  const side = rng() < 0.5 ? -1 : 1;
  const forward = dir(w.heading);
  const perp = new Vector3(forward.z, 0, -forward.x).multiplyScalar(side);
  const center = w.pos.clone().add(perp.clone().multiplyScalar(radius));
  const v0 = w.pos.clone().sub(center);
  const start = w.pos.clone();
  // Pick the rotation direction that starts out moving along the current heading.
  const rot = (a: number) => new Vector3(v0.x * Math.cos(a) - v0.z * Math.sin(a), 0, v0.x * Math.sin(a) + v0.z * Math.cos(a));
  const sign = rot(0.1).sub(v0).dot(forward) > 0 ? 1 : -1;
  const stepsPerTurn = 12;
  const total = turns * stepsPerTurn;
  for (let i = 1; i <= total; i++) {
    const a = (sign * i * 2 * Math.PI) / stepsPerTurn;
    const p = center.clone().add(rot(a));
    p.y = start.y - (dropPerTurn * i) / stepsPerTurn;
    w.points.push(p);
  }
  w.pos = w.points[w.points.length - 1].clone();
  // Leave tangentially and clear the helix footprint before turning again.
  straight(w, 2 * radius + 3, 0.12);
}

function buildFrames(points: Vector3[]): Frame[] {
  const last = points.length - 1;
  const tangents = points.map((_, i) =>
    points[Math.min(last, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize(),
  );
  // Horizontal centripetal acceleration at the design speed, used to bank the turns.
  const span = 4;
  const lateral = tangents.map((_, i) => {
    const a = tangents[Math.max(0, i - span)];
    const b = tangents[Math.min(last, i + span)];
    const ds = (Math.min(last, i + span) - Math.max(0, i - span)) * SAMPLE_STEP;
    const dt = b.clone().sub(a).divideScalar(ds || 1);
    dt.y = 0;
    return dt.multiplyScalar((BANK_SPEED * BANK_SPEED) / 9.81);
  });
  const smooth = 12;
  return points.map((p, i) => {
    const t = tangents[i];
    const lean = new Vector3();
    for (let j = i - smooth; j <= i + smooth; j++) lean.add(lateral[Math.max(0, Math.min(last, j))]);
    lean.divideScalar(2 * smooth + 1).clampLength(0, MAX_BANK);
    // Up vector leans into the turn, then re-orthogonalise against the tangent.
    const up = UP.clone().add(lean);
    const r = new Vector3().crossVectors(up, t).normalize();
    const n = new Vector3().crossVectors(t, r).normalize();
    return { p, t, r, n };
  });
}

export function frameQuaternion(f: Frame): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(f.r, f.n, f.t));
}

/** Point at lateral offset x and height y in the frame of sample s. */
export function framePoint(f: Frame, x: number, y: number): Vector3 {
  return f.p.clone().addScaledVector(f.r, x).addScaledVector(f.n, y);
}

export function stripMesh(frames: Frame[], profile: [number, number][], faceUp: boolean): MeshData {
  const cols = profile.length;
  const vertices = new Float32Array(frames.length * cols * 3);
  frames.forEach((f, i) => {
    profile.forEach(([x, y], j) => {
      const v = framePoint(f, x, y);
      vertices.set([v.x, v.y, v.z], (i * cols + j) * 3);
    });
  });
  const idx: number[] = [];
  for (let i = 0; i < frames.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Winding chosen so normals face into the channel (where marbles are).
      if (faceUp) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  return { vertices, indices: new Uint32Array(idx) };
}

function curvatureAt(frames: Frame[], s: number, span = 12) {
  const a = frames[Math.max(0, s - span)].t;
  const b = frames[Math.min(frames.length - 1, s + span)].t;
  return 1 - a.dot(b);
}

function placeObstacles(frames: Frame[], rng: Rng, from: number, to: number, avoid: number[]): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const taken: [number, number][] = avoid.map((s) => [s - 16, s + 16]);
  const free = (s0: number, s1: number) => taken.every(([a, b]) => s1 < a - 20 || s0 > b + 20);
  const kinds: Obstacle["kind"][] = ["spinner", "pegs", "boost", "spinner", "pegs", "boost"];
  for (const kind of kinds) {
    const len = kind === "spinner" ? 8 : kind === "pegs" ? 22 : 16;
    for (let attempt = 0; attempt < 40; attempt++) {
      const s0 = Math.floor(range(rng, from, to - len));
      const s1 = s0 + len;
      if (!free(s0, s1)) continue;
      if (kind !== "boost" && curvatureAt(frames, Math.floor((s0 + s1) / 2), len) > 0.01) continue;
      taken.push([s0, s1]);
      if (kind === "spinner") {
        obstacles.push({ kind, s: s0 + len / 2, halfLength: 0.6, speed: range(rng, 1.5, 2.5) * (rng() < 0.5 ? -1 : 1) });
      } else if (kind === "pegs") {
        const rows = [[0], [-0.8, 0.8]];
        const pegs: { s: number; x: number }[] = [];
        for (let row = 0; row < 3; row++) {
          for (const x of rows[row % 2]) pegs.push({ s: s0 + 3 + row * 7, x });
        }
        obstacles.push({ kind, s0, s1, pegs });
      } else {
        obstacles.push({ kind, s0, s1, strength: range(rng, 7, 10) });
      }
      break;
    }
  }
  return obstacles;
}

export function generateTrack(seed: number): Track {
  const rng = makeRng(seed);
  const w: Walker = { pos: new Vector3(0, 0, 0), heading: 0, points: [new Vector3(0, 0, 0)] };

  straight(w, 8, 0.1); // starting grid
  straight(w, 8, 0.28); // opening drop

  let helixes = 0;
  let lastWasHelix = false;
  const sections = 5 + Math.floor(rng() * 2);
  for (let i = 0; i < sections; i++) {
    const roll = rng();
    if (!lastWasHelix && helixes < 2 && roll < 0.3 && i > 0) {
      // Straighten out and drop first so the helix sits well below the track behind it.
      w.heading *= 0.25;
      straight(w, 8, 0.3);
      helix(w, rng);
      helixes++;
      lastWasHelix = true;
      continue;
    }
    lastWasHelix = false;
    if (roll < 0.75) snake(w, rng);
    else straight(w, range(rng, 8, 14), range(rng, 0.18, 0.3));
  }
  if (helixes === 0) {
    w.heading *= 0.25;
    straight(w, 8, 0.3);
    helix(w, rng);
  }
  w.heading *= 0.4;
  straight(w, 12, 0.12); // home straight
  straight(w, 12, 0.05); // run-off after the finish line

  const curve = new CatmullRomCurve3(w.points, false, "centripetal");
  const length = curve.getLength();
  const count = Math.floor(length / SAMPLE_STEP);
  const frames = buildFrames(curve.getSpacedPoints(count));

  const gateS = Math.round(6 / SAMPLE_STEP);
  const finishS = frames.length - 1 - Math.round(11 / SAMPLE_STEP);
  const raceLen = finishS - gateS;
  const checkpoints = [0.25, 0.5, 0.75].map((f) => Math.round(gateS + raceLen * f));
  const obstacles = placeObstacles(frames, rng, gateS + 50, finishS - 40, checkpoints);

  const lidProfile: [number, number][] = [
    [-TRACK_HALF_WIDTH - 0.1, LID_HEIGHT],
    [TRACK_HALF_WIDTH + 0.1, LID_HEIGHT],
  ];

  return {
    seed,
    samples: frames,
    channel: stripMesh(frames, PROFILE, true),
    lid: stripMesh(frames, lidProfile, false),
    gateS,
    finishS,
    checkpoints,
    obstacles,
    length,
  };
}
