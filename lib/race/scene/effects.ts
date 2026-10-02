import * as THREE from "three";
import { dotTexture } from "./textures";

const TRAIL_POINTS = 28;

/** Glowing ribbon behind a marble. A fixed-size strip rebuilt each frame — a handful of vertices. */
export class Trail {
  readonly mesh: THREE.Mesh;
  /** Marble this trail is following. */
  slot: number | null = null;
  private history: THREE.Vector3[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private color = new THREE.Color();

  constructor() {
    const g = new THREE.BufferGeometry();
    this.positions = new Float32Array(TRAIL_POINTS * 2 * 3);
    this.colors = new Float32Array(TRAIL_POINTS * 2 * 4);
    g.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  reset() {
    this.slot = null;
    this.history = [];
    this.mesh.visible = false;
  }

  update(pos: THREE.Vector3, color: string, intensity: number) {
    const last = this.history[0];
    if (!last || last.distanceToSquared(pos) > 0.02) {
      this.history.unshift(pos.clone());
      if (this.history.length > TRAIL_POINTS) this.history.pop();
    } else {
      last.copy(pos);
    }
    const n = this.history.length;
    this.mesh.visible = n > 2;
    if (!this.mesh.visible) return;
    this.color.set(color).multiplyScalar(intensity);
    const side = new THREE.Vector3();
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = this.history[Math.min(i, n - 1)];
      const q = this.history[Math.min(i + 1, n - 1)];
      const dir = p.clone().sub(q);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      side.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const fade = 1 - i / (TRAIL_POINTS - 1);
      const w = 0.2 * fade + 0.02;
      for (const [k, sgn] of [
        [0, -1],
        [1, 1],
      ] as const) {
        const o = (i * 2 + k) * 3;
        this.positions[o] = p.x + side.x * w * sgn;
        this.positions[o + 1] = p.y - 0.12 + side.y * w * sgn;
        this.positions[o + 2] = p.z + side.z * w * sgn;
        const c = (i * 2 + k) * 4;
        this.colors[c] = this.color.r;
        this.colors[c + 1] = this.color.g;
        this.colors[c + 2] = this.color.b;
        this.colors[c + 3] = fade * fade * (i < n ? 0.9 : 0);
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  color: THREE.Color;
}

/** Pooled CPU particles for short bursts (boost sparks, finish confetti). */
export class Bursts {
  readonly points: THREE.Points;
  private pool: Particle[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private cursor = 0;
  private gravity: number;

  constructor(
    private capacity: number,
    opts: { size: number; additive: boolean; gravity: number },
  ) {
    this.gravity = opts.gravity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    // RGBA so particles fade out rather than darken.
    g.setAttribute("color", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: opts.size,
        vertexColors: true,
        map: dotTexture(),
        transparent: true,
        depthWrite: false,
        blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: !opts.additive,
      }),
    );
    this.points.frustumCulled = false;
    for (let i = 0; i < capacity; i++)
      this.pool.push({ pos: new THREE.Vector3(0, -9999, 0), vel: new THREE.Vector3(), life: 0, max: 1, color: new THREE.Color() });
  }

  emit(origin: THREE.Vector3, count: number, opts: { speed: number; up: number; life: number; colors: string[]; spread?: THREE.Vector3 }) {
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;
      p.pos.copy(origin);
      if (opts.spread) p.pos.add(new THREE.Vector3((Math.random() - 0.5) * opts.spread.x, (Math.random() - 0.5) * opts.spread.y, (Math.random() - 0.5) * opts.spread.z));
      p.vel.set((Math.random() - 0.5) * opts.speed, Math.random() * opts.up, (Math.random() - 0.5) * opts.speed);
      p.life = p.max = opts.life * (0.6 + Math.random() * 0.6);
      p.color.set(opts.colors[Math.floor(Math.random() * opts.colors.length)]);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (p.life <= 0) {
        this.positions[i * 3 + 1] = -9999;
        continue;
      }
      p.life -= dt;
      p.vel.y -= this.gravity * dt;
      p.vel.multiplyScalar(1 - dt * 0.8);
      p.pos.addScaledVector(p.vel, dt);
      this.positions.set([p.pos.x, p.pos.y, p.pos.z], i * 3);
      const fade = Math.max(0, p.life / p.max);
      this.colors.set([p.color.r, p.color.g, p.color.b, fade], i * 4);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
