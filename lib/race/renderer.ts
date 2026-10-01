import * as THREE from "three";
import type { Race } from "./engine";
import { marbleBySlot, type MarbleDef } from "./marbles";
import {
  framePoint,
  frameQuaternion,
  LID_HEIGHT,
  MARBLE_RADIUS,
  PROFILE,
  stripMesh,
  TRACK_HALF_WIDTH,
  type MeshData,
} from "./track";

export type CameraMode = "grid" | "leader" | "battle" | "finish";

function geometryFrom(data: MeshData) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function marbleTexture(m: MarbleDef) {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = m.color;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = m.accent;
    ctx.strokeStyle = m.accent;
    if (m.pattern === "stripe") {
      ctx.fillRect(0, 52, 256, 24);
    } else if (m.pattern === "dots") {
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        ctx.arc((i * 73) % 256, 20 + ((i * 37) % 90), 9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (m.pattern === "swirl") {
      ctx.lineWidth = 10;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        for (let x = 0; x <= 256; x += 4) ctx.lineTo(x, 64 + Math.sin(x / 20 + k * 2) * 30 + (k - 1) * 18);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(70, 40, 40, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function labelSprite(m: MarbleDef) {
  const tex = canvasTexture(256, 64, (ctx) => {
    ctx.font = "bold 34px system-ui, sans-serif";
    const w = Math.min(250, ctx.measureText(m.name).width + 28);
    ctx.fillStyle = "rgba(10,12,20,0.72)";
    ctx.beginPath();
    ctx.roundRect((256 - w) / 2, 6, w, 52, 26);
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc((256 - w) / 2 + 20, 32, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.name, 128 + 10, 33);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.1, 0.275, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function checkerTexture() {
  const tex = canvasTexture(128, 32, (ctx) => {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        ctx.fillStyle = (x + y) % 2 ? "#111" : "#fff";
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function chevronTexture() {
  const tex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = "#ff3df2";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#fff6a8";
    ctx.beginPath();
    ctx.moveTo(4, 8);
    ctx.lineTo(32, 36);
    ctx.lineTo(60, 8);
    ctx.lineTo(60, 26);
    ctx.lineTo(32, 54);
    ctx.lineTo(4, 26);
    ctx.fill();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class RaceRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 800);
  mode: CameraMode = "grid";
  /** Slot the "battle" camera watches (marble on the elimination line). */
  battleSlot: number | null = null;
  private marbles = new Map<number, { mesh: THREE.Mesh; label: THREE.Sprite }>();
  private spinners: THREE.Mesh[] = [];
  private boostTextures: THREE.Texture[] = [];
  private sun: THREE.DirectionalLight;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private disposables: { dispose(): void }[] = [];
  private host: HTMLElement;
  private resizeObserver: ResizeObserver;

  constructor(host: HTMLElement, private race: Race) {
    this.host = host;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    this.renderer = renderer;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);

    const track = race.track;
    const scene = this.scene;
    scene.background = new THREE.Color("#8fc9ff");
    scene.fog = new THREE.Fog("#8fc9ff", 60, 260);

    scene.add(new THREE.HemisphereLight("#dff1ff", "#5a6b4a", 1.4));
    const sun = new THREE.DirectionalLight("#fff4e0", 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -25;
    sc.right = sc.top = 25;
    sc.near = 1;
    sc.far = 120;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Track: opaque floor, translucent walls.
    const floorGeo = geometryFrom(stripMesh(track.samples, PROFILE.slice(1, 7), true));
    const floor = new THREE.Mesh(
      floorGeo,
      new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }),
    );
    floor.receiveShadow = true;
    const wallMat = new THREE.MeshStandardMaterial({
      color: "#9fd8ff",
      roughness: 0.15,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const leftWall = new THREE.Mesh(geometryFrom(stripMesh(track.samples, PROFILE.slice(0, 2), true)), wallMat);
    const rightWall = new THREE.Mesh(geometryFrom(stripMesh(track.samples, PROFILE.slice(6), true)), wallMat);
    const railMat = new THREE.MeshStandardMaterial({ color: "#3b4cff", roughness: 0.4 });
    const railCurve = (x: number) =>
      new THREE.CatmullRomCurve3(track.samples.filter((_, i) => i % 4 === 0).map((f) => framePoint(f, x, LID_HEIGHT - 0.05)));
    const tubeSegs = Math.floor(track.samples.length / 2);
    const leftRail = new THREE.Mesh(new THREE.TubeGeometry(railCurve(-TRACK_HALF_WIDTH), tubeSegs, 0.06, 6), railMat);
    const rightRail = new THREE.Mesh(new THREE.TubeGeometry(railCurve(TRACK_HALF_WIDTH), tubeSegs, 0.06, 6), railMat);
    scene.add(floor, leftWall, rightWall, leftRail, rightRail);
    this.disposables.push(floorGeo, wallMat, railMat);

    // Ground and support pillars.
    let minY = Infinity;
    const box = new THREE.Box3();
    for (const f of track.samples) {
      minY = Math.min(minY, f.p.y);
      box.expandByPoint(f.p);
    }
    const groundY = minY - 6;
    const center = box.getCenter(new THREE.Vector3());
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(400, 64),
      new THREE.MeshStandardMaterial({ color: "#6fae5a", roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(center.x, groundY, center.z);
    grass.receiveShadow = true;
    scene.add(grass);
    const pillarMat = new THREE.MeshStandardMaterial({ color: "#c9ced8", roughness: 0.6 });
    const pillarGeo = new THREE.CylinderGeometry(0.12, 0.16, 1, 8);
    for (let i = 0; i < track.samples.length; i += 40) {
      const f = track.samples[i];
      // Skip pillars that would spear through a lower loop of a helix.
      const below = track.samples.some((g, j) => Math.abs(j - i) > 30 && g.p.y < f.p.y - 0.5 && Math.hypot(g.p.x - f.p.x, g.p.z - f.p.z) < 2.2);
      if (below) continue;
      const h = f.p.y - groundY;
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.scale.y = h;
      pillar.position.set(f.p.x, groundY + h / 2 - 0.05, f.p.z);
      pillar.castShadow = true;
      scene.add(pillar);
    }

    // Start gate, checkpoints and finish line.
    const banner = (s: number, color: string, text: string) => {
      const f = track.samples[s];
      const group = new THREE.Group();
      group.position.copy(f.p);
      group.quaternion.copy(frameQuaternion(f));
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
      for (const x of [-TRACK_HALF_WIDTH - 0.2, TRACK_HALF_WIDTH + 0.2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), mat);
        post.position.set(x, 1.3, 0);
        post.castShadow = true;
        group.add(post);
      }
      const signMat = new THREE.MeshBasicMaterial({
          map: canvasTexture(512, 96, (ctx) => {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 512, 96);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 64px system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, 256, 50);
          }),
        });
      // One face per direction so the text reads correctly from both sides.
      for (const yaw of [0, Math.PI]) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 0.7), signMat);
        sign.position.set(0, 2.4, 0);
        sign.rotation.y = yaw;
        group.add(sign);
      }
      scene.add(group);
    };
    banner(track.gateS, "#16a34a", "START");
    track.checkpoints.forEach((s, i) => banner(s, "#f59e0b", `CHECKPOINT ${i + 1}`));
    banner(track.finishS, "#111827", "FINISH");
    const finishLine = new THREE.Mesh(
      new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 1.6, 0.5),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), side: THREE.DoubleSide }),
    );
    const ff = track.samples[track.finishS];
    finishLine.position.copy(framePoint(ff, 0, 0.01));
    finishLine.quaternion.copy(frameQuaternion(ff)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    scene.add(finishLine);

    // Obstacles.
    const spinnerMat = new THREE.MeshStandardMaterial({ color: "#ef4444", roughness: 0.3, metalness: 0.2 });
    const pegMat = new THREE.MeshStandardMaterial({ color: "#facc15", roughness: 0.3, metalness: 0.4 });
    for (const o of track.obstacles) {
      if (o.kind === "spinner") {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(o.halfLength * 2, 0.4, 0.2), spinnerMat);
        bar.castShadow = true;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, LID_HEIGHT + 0.6), spinnerMat);
        hub.position.y = 0.2;
        bar.add(hub);
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
        const tex = chevronTexture();
        tex.repeat.set(1, (o.s1 - o.s0) / 6);
        this.boostTextures.push(tex);
        const g = geometryFrom(stripMesh(track.samples.slice(o.s0, o.s1 + 1), [[-0.9, 0.012], [0.9, 0.012]], true));
        // UVs: u across the strip, v along it.
        const uv = new Float32Array((o.s1 - o.s0 + 1) * 4);
        for (let i = 0; i <= o.s1 - o.s0; i++) uv.set([0, i / (o.s1 - o.s0), 1, i / (o.s1 - o.s0)], i * 4);
        g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        const strip = new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({ map: tex, emissive: "#ff3df2", emissiveIntensity: 0.6, emissiveMap: tex, side: THREE.DoubleSide }),
        );
        scene.add(strip);
      }
    }

    // Marbles.
    const sphere = new THREE.SphereGeometry(MARBLE_RADIUS, 32, 16);
    this.disposables.push(sphere);
    for (const r of race.racers) {
      const def = marbleBySlot(r.slot);
      const mesh = new THREE.Mesh(
        sphere,
        new THREE.MeshPhysicalMaterial({ map: marbleTexture(def), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }),
      );
      mesh.castShadow = true;
      const label = labelSprite(def);
      scene.add(mesh, label);
      this.marbles.set(r.slot, { mesh, label });
    }

    const start = track.samples[track.gateS - 6];
    this.camTarget.copy(start.p);
    this.camPos.copy(framePoint(start, 4, 4)).addScaledVector(start.t, -6);
    this.resize();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    const race = this.race;
    for (const r of race.racers) {
      const m = this.marbles.get(r.slot)!;
      m.mesh.position.copy(r.pos);
      m.mesh.quaternion.copy(r.quat);
      m.label.position.copy(r.pos).add(new THREE.Vector3(0, 0.55, 0));
    }
    race.spinnerPoses().forEach((p, i) => {
      this.spinners[i].position.copy(p.pos);
      this.spinners[i].quaternion.copy(p.quat);
    });
    for (const tex of this.boostTextures) tex.offset.y -= dt * 1.5;

    this.updateCamera(dt);
    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(18, 40, 10));
    this.sun.target.position.copy(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(dt: number) {
    const race = this.race;
    const track = race.track;
    let focus: number | undefined;
    if (this.mode === "battle" && this.battleSlot !== null) focus = this.battleSlot;
    else focus = race.standings[0];
    const racer = focus !== undefined ? race.racer(focus) : undefined;

    const desiredTarget = new THREE.Vector3();
    const desiredPos = new THREE.Vector3();
    if (this.mode === "grid" || !racer) {
      const f = track.samples[track.gateS - 4];
      desiredTarget.copy(f.p);
      desiredPos.copy(framePoint(f, 3.5, 3.2)).addScaledVector(f.t, 4.5);
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
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
