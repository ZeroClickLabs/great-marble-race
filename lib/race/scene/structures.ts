import * as THREE from "three";
import { makeRng } from "../rng";
import type { Theme } from "../themes";
import { framePoint, frameQuaternion, TRACK_HALF_WIDTH, type Track } from "../track";
import { checkerTexture, signTexture } from "./textures";

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

/** Collects transforms (and optional colours) and turns them into one InstancedMesh: one draw call. */
export class InstanceBatch {
  readonly matrices: THREE.Matrix4[] = [];
  readonly colors: THREE.Color[] = [];
  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
  ) {}

  add(m: THREE.Matrix4, color?: THREE.ColorRepresentation) {
    this.matrices.push(m);
    if (color !== undefined) this.colors.push(new THREE.Color(color));
  }

  /** A unit-length Y-aligned shape stretched between two points. */
  addBetween(a: THREE.Vector3, b: THREE.Vector3, thickness = 1, color?: THREE.ColorRepresentation) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize());
    this.add(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(thickness, len, thickness)), color);
  }

  build(opts: { castShadow?: boolean; receiveShadow?: boolean } = {}) {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, this.matrices.length));
    mesh.count = this.matrices.length;
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (this.colors.length === this.matrices.length && this.colors.length) this.colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = !!opts.castShadow;
    mesh.receiveShadow = !!opts.receiveShadow;
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** True if another part of the track runs underneath this point (e.g. a lower helix loop). */
export function makeClearanceTest(track: Track) {
  const coarse = track.samples.filter((_, i) => i % 4 === 0).map((f, k) => ({ p: f.p, s: k * 4 }));
  return (p: THREE.Vector3, s: number, radius = 2.4) =>
    coarse.some((c) => Math.abs(c.s - s) > 30 && c.p.y < p.y - 0.3 && Math.hypot(c.p.x - p.x, c.p.z - p.z) < radius);
}

export function trackGroundY(track: Track) {
  let min = Infinity;
  for (const f of track.samples) min = Math.min(min, f.p.y);
  return min - 6;
}

/** Scaffold trusses: legs, a cross beam under the track, ladder rungs and diagonal bracing. */
export function buildSupports(track: Track, theme: Theme, groundY: number) {
  const blocked = makeClearanceTest(track);
  const legMat = new THREE.MeshStandardMaterial({ color: theme.supports.color, roughness: 0.55, metalness: 0.35 });
  const braceMat = new THREE.MeshStandardMaterial({
    color: theme.supports.brace,
    roughness: 0.5,
    metalness: 0.3,
    emissive: theme.supports.emissive ?? "#000000",
    emissiveIntensity: theme.supports.emissive ? 1.2 : 0,
  });
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const legs = new InstanceBatch(cyl, legMat);
  const beams = new InstanceBatch(box, legMat);
  const braces = new InstanceBatch(cyl, braceMat);

  const STEP = 24;
  let prev: { left?: THREE.Vector3; right?: THREE.Vector3 } = {};
  for (let s = 8; s < track.samples.length - 4; s += STEP) {
    const f = track.samples[s];
    const tops = [-1, 1].map((side) => framePoint(f, side * (TRACK_HALF_WIDTH + 0.1), -0.15));
    const ok = tops.map((p) => !blocked(p, s));
    const cur: { left?: THREE.Vector3; right?: THREE.Vector3 } = {};
    tops.forEach((top, k) => {
      if (!ok[k]) return;
      const foot = new THREE.Vector3(top.x, groundY, top.z);
      legs.addBetween(foot, top, 0.18);
      if (k === 0) cur.left = top;
      else cur.right = top;
    });
    if (ok[0] && ok[1]) {
      // Cross beam directly under the channel.
      const mid = framePoint(f, 0, -0.25);
      beams.add(new THREE.Matrix4().compose(mid, frameQuaternion(f), new THREE.Vector3(TRACK_HALF_WIDTH * 2 + 0.4, 0.14, 0.2)));
      // Ladder rungs between the legs every few metres.
      for (let y = groundY + 2.5; y < Math.min(tops[0].y, tops[1].y) - 1; y += 3) {
        braces.addBetween(new THREE.Vector3(tops[0].x, y, tops[0].z), new THREE.Vector3(tops[1].x, y, tops[1].z), 0.08);
      }
    }
    // Diagonal bracing back to the previous support on each side.
    for (const key of ["left", "right"] as const) {
      const a = prev[key];
      const b = cur[key];
      if (!a || !b || a.distanceTo(b) > 9) continue;
      const drop = Math.min(3, Math.min(a.y, b.y) - groundY - 0.5);
      if (drop < 1) continue;
      braces.addBetween(a.clone().setY(a.y - 0.3), b.clone().setY(b.y - drop), 0.07);
    }
    prev = cur;
  }
  const group = new THREE.Group();
  group.add(legs.build({ castShadow: true }), beams.build({ castShadow: true }), braces.build());
  return group;
}

/** Arch over the track with a sign on both faces and a glowing light strip. */
function gate(track: Track, s: number, text: string, color: string, glow: string, checkered = false) {
  const f = track.samples[s];
  const g = new THREE.Group();
  g.position.copy(f.p);
  g.quaternion.copy(frameQuaternion(f));
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
  const glowMat = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 6 });
  const x = TRACK_HALF_WIDTH + 0.45;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.4, 0.32), mat);
    pillar.position.set(side * x, 1.3, 0);
    pillar.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.12), glowMat);
    strip.position.set(side * (x - 0.17), 1.4, 0);
    g.add(pillar, strip);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(x * 2 + 0.6, 0.85, 0.36), mat);
  beam.position.set(0, 3.05, 0);
  beam.castShadow = true;
  const underGlow = new THREE.Mesh(new THREE.BoxGeometry(x * 2 - 0.3, 0.06, 0.2), glowMat);
  underGlow.position.set(0, 2.6, 0);
  g.add(beam, underGlow);
  const signMat = new THREE.MeshBasicMaterial({ map: checkered ? checkerTexture() : signTexture(text, color), toneMapped: false });
  const textMat = new THREE.MeshBasicMaterial({ map: signTexture(text, color), toneMapped: false });
  for (const [z, yaw] of [
    [0.19, 0],
    [-0.19, Math.PI],
  ] as const) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(x * 2 + 0.4, 0.7), checkered && z > 0 ? signMat : textMat);
    sign.position.set(0, 3.05, z);
    sign.rotation.y = yaw;
    g.add(sign);
  }
  return g;
}

export function buildGates(track: Track, theme: Theme) {
  const group = new THREE.Group();
  group.add(gate(track, track.gateS, "START", theme.gates.start, theme.gates.glow));
  track.checkpoints.forEach((s, i) => group.add(gate(track, s, `CHECKPOINT ${i + 1}`, theme.gates.checkpoint, theme.gates.glow)));
  group.add(gate(track, track.finishS, "FINISH", theme.gates.finish, theme.gates.glow));

  const f = track.samples[track.finishS];
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 1.6, 0.5),
    new THREE.MeshStandardMaterial({ map: checkerTexture(), side: THREE.DoubleSide }),
  );
  line.position.copy(framePoint(f, 0, 0.012));
  line.quaternion.copy(frameQuaternion(f)).multiply(new THREE.Quaternion().setFromAxisAngle(X, -Math.PI / 2));
  group.add(line);
  return group;
}

/** Grandstand beside the finish with a crowd that bounces — harder when marbles are finishing. */
export class Grandstand {
  readonly group = new THREE.Group();
  private people: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private base: { pos: THREE.Vector3; phase: number }[] = [];
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(track: Track, theme: Theme, groundY: number) {
    const f = track.samples[track.finishS];
    const flatT = new THREE.Vector3(f.t.x, 0, f.t.z).normalize();
    const side = new THREE.Vector3().crossVectors(Y, flatT).normalize(); // points to the track's right
    const yaw = Math.atan2(flatT.x, flatT.z);
    this.q.setFromAxisAngle(Y, yaw);
    const origin = f.p.clone().addScaledVector(side, TRACK_HALF_WIDTH + 2.6);
    const floorY = f.p.y - 0.6;

    const standMat = new THREE.MeshStandardMaterial({ color: "#c9ced8", roughness: 0.7, metalness: 0.2 });
    const roofMat = new THREE.MeshStandardMaterial({ color: theme.gates.finish, roughness: 0.5 });
    const tiers = 5;
    const length = 14;
    for (let k = 0; k < tiers; k++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, length), standMat);
      tier.position.copy(origin).addScaledVector(side, k * 0.9).setY(floorY + k * 0.45);
      tier.quaternion.copy(this.q);
      tier.receiveShadow = tier.castShadow = true;
      this.group.add(tier);
    }
    // Solid base down to the ground.
    const baseH = floorY - groundY;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(tiers * 0.9, baseH, length), standMat);
    plinth.position.copy(origin).addScaledVector(side, ((tiers - 1) * 0.9) / 2).setY(groundY + baseH / 2 - 0.22);
    plinth.quaternion.copy(this.q);
    this.group.add(plinth);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(tiers * 0.9 + 1, 0.15, length + 1), roofMat);
    roof.position.copy(origin).addScaledVector(side, ((tiers - 1) * 0.9) / 2).setY(floorY + tiers * 0.45 + 2.2);
    roof.quaternion.copy(this.q);
    roof.castShadow = true;
    this.group.add(roof);

    const rng = makeRng(track.seed ^ 0xc0ffee);
    const body = new THREE.BoxGeometry(0.32, 0.5, 0.24);
    const head = new THREE.SphereGeometry(0.13, 8, 6);
    const count = tiers * 22;
    this.people = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.8 }), count);
    this.heads = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ roughness: 0.7 }), count);
    const skins = ["#f1c7a5", "#d9a07a", "#a86f4c", "#6b4630", "#ffe0c4"];
    let i = 0;
    for (let k = 0; k < tiers; k++)
      for (let n = 0; n < 22; n++, i++) {
        const along = -length / 2 + 0.4 + (n / 21) * (length - 0.8) + (rng() - 0.5) * 0.2;
        const pos = origin
          .clone()
          .addScaledVector(side, k * 0.9 + (rng() - 0.5) * 0.2)
          .addScaledVector(flatT, along)
          .setY(floorY + k * 0.45 + 0.47);
        this.base.push({ pos, phase: rng() * Math.PI * 2 });
        this.people.setColorAt(i, new THREE.Color(theme.crowd[Math.floor(rng() * theme.crowd.length)]));
        this.heads.setColorAt(i, new THREE.Color(skins[Math.floor(rng() * skins.length)]));
      }
    this.update(0, 0);
    this.people.castShadow = true;
    this.group.add(this.people, this.heads);
  }

  /** excitement 0..1 scales how high the crowd jumps. */
  update(time: number, excitement: number) {
    const amp = 0.03 + excitement * 0.28;
    const speed = 3 + excitement * 7;
    const one = new THREE.Vector3(1, 1, 1);
    this.base.forEach((b, i) => {
      const hop = Math.max(0, Math.sin(time * speed + b.phase)) * amp;
      const p = b.pos.clone();
      p.y += hop;
      this.people.setMatrixAt(i, this.tmp.compose(p, this.q, one));
      p.y += 0.38;
      this.heads.setMatrixAt(i, this.tmp.compose(p, this.q, one));
    });
    this.people.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

/** Pennant flags on poles along the outside of the track. */
export function buildFlags(track: Track, theme: Theme) {
  const blocked = makeClearanceTest(track);
  const poleMat = new THREE.MeshStandardMaterial({ color: "#d8dde6", metalness: 0.6, roughness: 0.3 });
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.5, 0, 0, -0.25, -0.9], 3));
  tri.computeVertexNormals();
  const flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 });
  const poles = new InstanceBatch(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), poleMat);
  const flags = new InstanceBatch(tri, flagMat);
  let n = 0;
  for (let s = track.gateS + 20; s < track.finishS - 10; s += 36, n++) {
    const f = track.samples[s];
    const side = n % 2 ? 1 : -1;
    const foot = framePoint(f, side * (TRACK_HALF_WIDTH + 0.3), -0.2);
    if (blocked(foot, s, 1.5)) continue;
    const top = foot.clone().add(new THREE.Vector3(0, 2.9, 0));
    poles.addBetween(foot, top, 1);
    // Flag points back up the track, as if blown by the marbles rushing past.
    const yaw = Math.atan2(f.t.x, f.t.z);
    flags.add(
      new THREE.Matrix4().compose(top, new THREE.Quaternion().setFromAxisAngle(Y, yaw), new THREE.Vector3(1, 1, 1)),
      theme.flags[n % theme.flags.length],
    );
  }
  const group = new THREE.Group();
  group.add(poles.build(), flags.build());
  return group;
}
