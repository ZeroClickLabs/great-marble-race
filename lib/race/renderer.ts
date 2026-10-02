import * as THREE from "three";
import type { Race } from "./engine";
import { marbleBySlot } from "./marbles";
import { Bursts, Trail } from "./scene/effects";
import { Atmosphere, buildEnvironment, environmentMap, sunOffset, type Lights } from "./scene/environment";
import { FrameMonitor, PostPipeline, QUALITY_LEVELS } from "./scene/post";
import { buildScenery } from "./scene/scenery";
import { buildBillboards, buildFlags, buildGates, buildSupports, Grandstand, trackGroundY } from "./scene/structures";
import { chevronTexture, dotTexture, labelTexture, marbleTexture } from "./scene/textures";
import { buildTrack, sweep } from "./scene/trackMeshes";
import type { Theme } from "./themes";
import { framePoint, frameQuaternion, LID_HEIGHT, MARBLE_RADIUS, type Track } from "./track";

/** How far the floor stays flat either side of the centreline (the profile curves up beyond). */
const FLAT_FLOOR = 1.2;

export type CameraMode = "grid" | "leader" | "battle" | "finish";

const TRAILS = 3;

export class RaceRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1200);
  mode: CameraMode = "grid";
  /** Slot the "battle" camera watches (marble on the elimination line). */
  battleSlot: number | null = null;
  qualityLevel = 0;

  private marbles = new Map<number, { mesh: THREE.Mesh; label: THREE.Sprite }>();
  private outlines!: THREE.InstancedMesh;
  private contactShadows!: THREE.InstancedMesh;
  private spinners: THREE.Mesh[] = [];
  private boostTextures: THREE.Texture[] = [];
  private lights: Lights;
  private sunOffset: THREE.Vector3;
  private atmosphere: Atmosphere;
  private grandstand: Grandstand;
  private trails: Trail[] = [];
  private sparks: Bursts;
  private confetti: Bursts;
  private post: PostPipeline;
  private monitor = new FrameMonitor();
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private time = 0;
  private finishedSeen = 0;
  private lastFinishAt = -10;
  private host: HTMLElement;
  private resizeObserver: ResizeObserver;

  constructor(
    host: HTMLElement,
    private race: Race,
    private theme: Theme,
  ) {
    this.host = host;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = theme.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    this.renderer = renderer;

    const track = race.track;
    const scene = this.scene;
    scene.environment = environmentMap(renderer);
    scene.environmentIntensity = theme.envIntensity;

    const groundY = trackGroundY(track);
    const box = new THREE.Box3();
    for (const f of track.samples) box.expandByPoint(f.p);
    const center = box.getCenter(new THREE.Vector3());

    this.lights = buildEnvironment(scene, theme, center, groundY);
    this.sunOffset = sunOffset(theme);
    scene.add(buildTrack(track, theme), buildSupports(track, theme, groundY), buildGates(track, theme), buildFlags(track, theme));
    scene.add(buildScenery(track, theme, groundY, 420), buildBillboards(track, theme, groundY));
    this.grandstand = new Grandstand(track, theme, groundY);
    scene.add(this.grandstand.group);
    this.atmosphere = new Atmosphere(theme, 1600);
    if (this.atmosphere.points) scene.add(this.atmosphere.points);

    this.buildObstacles(track);
    this.buildMarbles();

    for (let i = 0; i < TRAILS; i++) {
      const t = new Trail();
      this.trails.push(t);
      scene.add(t.mesh);
    }
    // Additive glow reads well on night tracks but turns to white glare in daylight.
    this.sparks = new Bursts(300, { size: 0.1, additive: !!theme.followLight, gravity: 6 });
    this.confetti = new Bursts(500, { size: 0.22, additive: false, gravity: 3 });
    scene.add(this.sparks.points, this.confetti.points);

    this.post = new PostPipeline(renderer, scene, this.camera, theme);
    this.applyQuality();

    const start = track.samples[track.gateS - 6];
    this.camTarget.copy(start.p);
    this.camPos.copy(framePoint(start, 4, 4)).addScaledVector(start.t, -6);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  private buildObstacles(track: Track) {
    const { theme, scene } = this;
    const spinnerMat = new THREE.MeshStandardMaterial({ color: theme.obstacles.spinner, roughness: 0.25, metalness: 0.5 });
    const pegMat = new THREE.MeshStandardMaterial({
      color: theme.obstacles.peg,
      roughness: 0.25,
      metalness: 0.6,
      emissive: theme.obstacles.peg,
      emissiveIntensity: theme.followLight ? 0.6 : 0,
    });
    for (const o of track.obstacles) {
      if (o.kind === "spinner") {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(o.halfLength * 2, 0.4, 0.2), spinnerMat);
        bar.castShadow = true;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, LID_HEIGHT + 0.6, 12), spinnerMat);
        hub.position.y = 0.2;
        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 12, 8),
          new THREE.MeshStandardMaterial({ color: theme.gates.glow, emissive: theme.gates.glow, emissiveIntensity: 2 }),
        );
        cap.position.y = LID_HEIGHT / 2 + 0.5;
        bar.add(hub, cap);
        this.spinners.push(bar);
        scene.add(bar);
      } else if (o.kind === "pegs") {
        for (const peg of o.pegs) {
          const f = track.samples[Math.round(peg.s)];
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, LID_HEIGHT, 12), pegMat);
          m.position.copy(framePoint(f, peg.x, LID_HEIGHT / 2));
          m.quaternion.copy(frameQuaternion(f));
          m.castShadow = true;
          scene.add(m);
        }
      } else {
        const tex = chevronTexture(theme.obstacles.boost);
        tex.repeat.set(1, ((o.s1 - o.s0) * 0.25) / 1.5);
        this.boostTextures.push(tex);
        const strip = new THREE.Mesh(
          sweep(track.samples.slice(o.s0, o.s1 + 1), [[-0.9, 0.014], [0.9, 0.014]], (o.s1 - o.s0) * 0.25),
          new THREE.MeshStandardMaterial({
            map: tex,
            emissive: "#ffffff",
            emissiveMap: tex,
            emissiveIntensity: 1.3,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          }),
        );
        strip.renderOrder = 1;
        scene.add(strip);
      }
    }
  }

  private buildMarbles() {
    const sphere = new THREE.SphereGeometry(MARBLE_RADIUS, 40, 20);
    const night = !!this.theme.followLight;
    for (const r of this.race.racers) {
      const def = marbleBySlot(r.slot);
      const map = marbleTexture(def);
      const mesh = new THREE.Mesh(
        sphere,
        new THREE.MeshPhysicalMaterial({
          map,
          roughness: 0.18,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          // Keep reflections from washing out the marble's own colour.
          envMapIntensity: 0.6,
          // A touch of self-illumination keeps marbles readable on night tracks.
          emissive: night ? "#ffffff" : "#000000",
          emissiveMap: night ? map : null,
          emissiveIntensity: night ? 0.12 : 0,
        }),
      );
      mesh.castShadow = true;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(def), depthTest: false, transparent: true, toneMapped: false }));
      label.scale.set(1.1, 0.275, 1);
      label.renderOrder = 10;
      this.scene.add(mesh, label);
      this.marbles.set(r.slot, { mesh, label });
    }
    const n = this.race.racers.length;
    // Contrasting rim: a slightly larger back-facing shell reads as an outline from any angle.
    this.outlines = new THREE.InstancedMesh(
      new THREE.SphereGeometry(MARBLE_RADIUS * 1.13, 24, 12),
      new THREE.MeshBasicMaterial({ color: this.theme.marbleOutline, side: THREE.BackSide }),
      n,
    );
    // Soft dark disc on the floor under each marble, shrinking as it bounces up.
    this.contactShadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(MARBLE_RADIUS * 3.2, MARBLE_RADIUS * 3.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#000000", map: dotTexture(), transparent: true, opacity: 0.55, depthWrite: false }),
      n,
    );
    this.contactShadows.renderOrder = 1;
    for (const m of [this.outlines, this.contactShadows]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.scene.add(this.outlines, this.contactShadows);
  }

  private updateMarbles() {
    const track = this.race.track;
    const m4 = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const ident = new THREE.Quaternion();
    this.race.racers.forEach((r, i) => {
      const m = this.marbles.get(r.slot)!;
      m.mesh.position.copy(r.pos);
      m.mesh.quaternion.copy(r.quat);
      m.label.position.copy(r.pos).add(new THREE.Vector3(0, 0.55, 0));
      this.outlines.setMatrixAt(i, m4.compose(r.pos, ident, one));

      const f = track.samples[Math.min(track.samples.length - 1, Math.round(r.progress))];
      const rel = r.pos.clone().sub(f.p);
      const lateral = THREE.MathUtils.clamp(rel.dot(f.r), -FLAT_FLOOR, FLAT_FLOOR);
      const height = Math.max(0, rel.dot(f.n) - MARBLE_RADIUS);
      const s = 1 / (1 + height * 1.5);
      const spot = framePoint(f, lateral, 0.02).addScaledVector(f.t, rel.dot(f.t));
      this.contactShadows.setMatrixAt(i, m4.compose(spot, frameQuaternion(f), new THREE.Vector3(s, 1, s)));
    });
    this.outlines.instanceMatrix.needsUpdate = true;
    this.contactShadows.instanceMatrix.needsUpdate = true;
  }

  private applyQuality() {
    const q = QUALITY_LEVELS[this.qualityLevel];
    this.lights.sun.castShadow = q.shadows;
    this.lights.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.lights.sun.shadow.map?.dispose();
    this.lights.sun.shadow.map = null;
    // Softer shadow edges at the top level (PCFSoftShadowMap is gone in this three.js version).
    this.lights.sun.shadow.radius = this.qualityLevel === 0 ? 3 : 1;
    this.post.enabled = q.bloom;
    this.resize();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const pr = Math.min(window.devicePixelRatio, QUALITY_LEVELS[this.qualityLevel].pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h, pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Dev aid: scene cost of one frame without post-processing. */
  stats() {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    this.renderer.render(this.scene, this.camera);
    const out = { calls: info.render.calls, triangles: info.render.triangles, quality: QUALITY_LEVELS[this.qualityLevel].name };
    info.autoReset = true;
    return out;
  }

  render(dt: number) {
    const race = this.race;
    const track = race.track;
    this.time += dt;
    if (this.monitor.record(dt, performance.now()) && this.qualityLevel < QUALITY_LEVELS.length - 1) {
      this.qualityLevel++;
      this.applyQuality();
    }

    this.updateMarbles();
    race.spinnerPoses().forEach((p, i) => {
      this.spinners[i].position.copy(p.pos);
      this.spinners[i].quaternion.copy(p.quat);
    });
    for (const tex of this.boostTextures) tex.offset.y -= dt * 1.5;

    this.updateEffects(dt);
    this.updateCamera(dt);

    const target = this.camTarget;
    this.lights.sun.position.copy(target).add(this.sunOffset);
    this.lights.sun.target.position.copy(target);
    this.lights.follow?.position.copy(target).add(new THREE.Vector3(0, 3.5, 0));
    this.atmosphere.update(this.time, target);
    const leader = race.racer(race.standings[0]);
    const nearFinish = leader ? 1 - Math.min(1, Math.max(0, (track.finishS - leader.progress) / 120)) : 0;
    const cheering = this.time - this.lastFinishAt < 4 ? 1 : 0;
    this.grandstand.update(this.time, Math.max(nearFinish * 0.6, cheering));

    this.post.render(dt);
  }

  private updateEffects(dt: number) {
    const race = this.race;
    const running = race.phase !== "grid";
    // Light trails behind the top three still racing.
    const leaders = running ? race.standings.filter((s) => !race.racer(s)?.finished).slice(0, TRAILS) : [];
    this.trails.forEach((trail, i) => {
      const slot = leaders[i];
      if (slot === undefined) return trail.reset();
      if (trail.slot !== slot) {
        trail.reset();
        trail.slot = slot;
      }
      trail.update(race.racer(slot)!.pos, marbleBySlot(slot).color, this.theme.followLight ? 0.7 : 1.1);
    });

    // Sparks off marbles riding a boost pad.
    for (const r of race.racers) {
      for (const o of race.track.obstacles) {
        if (o.kind === "boost" && r.progress >= o.s0 && r.progress <= o.s1 && !r.finished) {
          this.sparks.emit(r.pos.clone().add(new THREE.Vector3(0, -0.15, 0)), 1, {
            speed: 2.5,
            up: 2.2,
            life: 0.45,
            colors: [this.theme.obstacles.boost, this.theme.gates.glow],
          });
        }
      }
    }
    // Confetti over the finish gate for each finisher, a big burst for the winner.
    if (race.finishOrder.length > this.finishedSeen) {
      const f = race.track.samples[race.track.finishS];
      const above = framePoint(f, 0, 3.4);
      const winner = this.finishedSeen === 0;
      this.confetti.emit(above, winner ? 260 : 40, {
        speed: winner ? 9 : 5,
        up: winner ? 7 : 4,
        life: winner ? 3 : 1.8,
        colors: [...this.theme.crowd, this.theme.gates.glow],
        spread: new THREE.Vector3(3, 0.5, 1),
      });
      this.finishedSeen = race.finishOrder.length;
      this.lastFinishAt = this.time;
    }
    this.sparks.update(dt);
    this.confetti.update(dt);
  }

  private updateCamera(dt: number) {
    const race = this.race;
    const track = race.track;
    const focus = this.mode === "battle" && this.battleSlot !== null ? this.battleSlot : race.standings[0];
    const racer = focus !== undefined ? race.racer(focus) : undefined;

    const desiredTarget = new THREE.Vector3();
    const desiredPos = new THREE.Vector3();
    if (this.mode === "grid" || !racer) {
      // Slow orbit around the starting grid while bets come in.
      const f = track.samples[track.gateS - 4];
      const a = Math.sin(this.time * 0.15) * 0.6;
      desiredTarget.copy(f.p);
      desiredPos.copy(framePoint(f, 3.5 * Math.cos(a) + 1, 3.2)).addScaledVector(f.t, 4.5 + Math.sin(a) * 2);
    } else if (this.mode === "finish") {
      // Past the line, looking back up the track at the marbles coming in.
      const f = track.samples[track.finishS];
      desiredTarget.copy(framePoint(f, 0, 0.3)).addScaledVector(f.t, -3);
      desiredPos.copy(framePoint(f, 1.1, 1.9)).addScaledVector(f.t, 5);
    } else {
      // Chase cam: just behind and above the marble in its local track frame, so it never
      // swings across to another loop of a helix.
      const s = Math.min(track.samples.length - 1, Math.round(racer.progress));
      const f = track.samples[s];
      const ahead = track.samples[Math.min(track.samples.length - 1, s + 8)];
      desiredTarget.copy(racer.pos).lerp(ahead.p, 0.2);
      desiredPos.copy(racer.pos).addScaledVector(f.t, -5.5).addScaledVector(f.n, 2.4).add(new THREE.Vector3(0, 0.8, 0));
    }
    const rate = this.mode === "grid" ? 1.5 : this.mode === "finish" ? 2.5 : 4.5;
    const k = 1 - Math.exp(-dt * rate);
    this.camTarget.lerp(desiredTarget, Math.min(1, k * 1.4));
    this.camPos.lerp(desiredPos, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          for (const key of ["map", "emissiveMap"] as const) (m as THREE.MeshStandardMaterial)[key]?.dispose();
          m.dispose();
        }
      }
    });
    this.scene.environment?.dispose();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
