import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeRng } from "../rng";
import type { Theme } from "../themes";
import { dotTexture, groundTextures } from "./textures";

/** Image-based lighting from a procedural room: real-looking reflections on marbles and glass for free. */
export function environmentMap(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

function skyDome(theme: Theme) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky.top) },
      horizon: { value: new THREE.Color(theme.sky.horizon) },
      bottom: { value: new THREE.Color(theme.sky.bottom) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.9999, p.w); // pinned just inside the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.4));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

function stars() {
  const rng = makeRng(99);
  const pts = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const theta = rng() * Math.PI * 2;
    const y = 0.08 + rng() * 0.92;
    const r = Math.sqrt(1 - y * y);
    pts.set([Math.cos(theta) * r * 850, y * 850, Math.sin(theta) * r * 850], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 2.2, sizeAttenuation: false, fog: false, map: dotTexture(), transparent: true, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}

function mountains(theme: Theme, center: THREE.Vector3, groundY: number) {
  const rng = makeRng(31);
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(1, 1, 7, 1);
  for (const [ring, color, count, hMin, hMax] of [
    [520, theme.mountains.far, 22, 90, 180],
    [380, theme.mountains.near, 18, 50, 110],
  ] as const) {
    // Beyond the fog distance, so drawn unfogged; theme colours are already hazy.
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, fog: false });
    const cap = theme.mountains.snowcap
      ? new THREE.MeshStandardMaterial({ color: theme.mountains.snowcap, roughness: 0.9, flatShading: true, fog: false })
      : null;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.2;
      const h = hMin + rng() * (hMax - hMin);
      const w = h * (0.9 + rng() * 0.6);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(w, h, w);
      m.rotation.y = rng() * Math.PI;
      m.position.set(center.x + Math.cos(a) * ring, groundY + h / 2 - 2, center.z + Math.sin(a) * ring);
      group.add(m);
      if (cap) {
        const c = new THREE.Mesh(geo, cap);
        c.scale.set(w * 0.3, h * 0.3, w * 0.3);
        c.rotation.y = m.rotation.y;
        c.position.set(m.position.x, groundY + h - 2 - h * 0.15 + 0.5, m.position.z);
        group.add(c);
      }
    }
  }
  if (theme.scenery.style === "volcanic") {
    // One big volcano on the horizon with a glowing crater.
    const v = new THREE.Mesh(new THREE.CylinderGeometry(40, 160, 170, 12, 1, true), new THREE.MeshStandardMaterial({ color: "#2a1610", roughness: 1, flatShading: true, fog: false }));
    v.position.set(center.x + 300, groundY + 85, center.z - 260);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(40, 16), new THREE.MeshBasicMaterial({ color: "#ff5a0a", toneMapped: false, fog: false }));
    crater.rotation.x = -Math.PI / 2;
    crater.position.set(v.position.x, groundY + 168, v.position.z);
    group.add(v, crater);
  }
  return group;
}

function ground(theme: Theme, center: THREE.Vector3, groundY: number) {
  const tex = groundTextures(theme);
  // Large tiles where the pattern is distinctive (lava cracks), so the repetition isn't obvious.
  const repeat = { grid: 160, ash: 45, grass: 120, frosting: 120, snow: 120 }[theme.ground.style];
  for (const t of [tex.map, tex.emissiveMap]) t?.repeat.set(repeat, repeat);
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(700, 64),
    new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissiveMap ?? null,
      emissive: tex.emissiveMap ? "#ffffff" : "#000000",
      emissiveIntensity: tex.emissiveMap ? 0.9 : 0,
      roughness: tex.roughness,
      metalness: tex.metalness,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, groundY, center.z);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Ambient particles in a box that follows the camera target. Motion is computed in the vertex
 * shader from a time uniform, so thousands of flakes/embers cost almost nothing on the CPU.
 */
export class Atmosphere {
  readonly points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;

  constructor(theme: Theme, count: number) {
    const style = theme.particles.style;
    if (style === "none" || count <= 0) return;
    const rng = makeRng(17);
    const box = new THREE.Vector3(70, 30, 70);
    const seeds = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = style === "sprinkles" ? theme.scenery.colors : [theme.particles.color];
    for (let i = 0; i < count; i++) {
      seeds.set([rng() * box.x, rng() * box.y, rng() * box.z], i * 3);
      const c = new THREE.Color(palette[i % palette.length]);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const velocity = {
      snow: new THREE.Vector3(0.4, -1.6, 0.2),
      embers: new THREE.Vector3(0.3, 2.2, -0.2),
      pollen: new THREE.Vector3(0.6, 0.15, 0.3),
      sprinkles: new THREE.Vector3(0.1, -2.4, 0.1),
    }[style];
    const size = { snow: 0.22, embers: 0.18, pollen: 0.12, sprinkles: 0.16 }[style];
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: style === "embers" ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        origin: { value: new THREE.Vector3() },
        box: { value: box },
        velocity: { value: velocity },
        size: { value: size },
        map: { value: dotTexture() },
        glow: { value: style === "embers" ? 3.0 : 1.0 },
      },
      vertexShader: /* glsl */ `
        uniform float time; uniform vec3 origin; uniform vec3 box; uniform vec3 velocity; uniform float size;
        attribute vec3 color; varying vec3 vColor; varying float vFade;
        void main() {
          vec3 p = position + velocity * time;
          p.x += sin(time * 0.7 + position.y) * 0.8;
          // Wrap into a box centred on the action.
          vec3 local = mod(p - origin + box * 0.5, box) - box * 0.5;
          vec4 mv = modelViewMatrix * vec4(origin + local, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * 900.0 / -mv.z;
          vColor = color;
          vFade = 1.0 - smoothstep(0.35, 0.5, max(abs(local.x / box.x), abs(local.z / box.z)));
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float glow; varying vec3 vColor; varying float vFade;
        void main() {
          float a = texture2D(map, gl_PointCoord).a * vFade;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * glow, a);
          #include <colorspace_fragment>
        }`,
    });
    const points = new THREE.Points(g, this.material);
    points.frustumCulled = false;
    this.points = points;
  }

  update(time: number, target: THREE.Vector3) {
    if (!this.material) return;
    this.material.uniforms.time.value = time;
    this.material.uniforms.origin.value.copy(target);
  }
}

export interface Lights {
  sun: THREE.DirectionalLight;
  follow: THREE.PointLight | null;
}

export function buildEnvironment(scene: THREE.Scene, theme: Theme, center: THREE.Vector3, groundY: number): Lights {
  scene.background = new THREE.Color(theme.sky.horizon);
  scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
  scene.add(skyDome(theme));
  if (theme.sky.stars) scene.add(stars());
  scene.add(ground(theme, center, groundY), mountains(theme, center, groundY));

  scene.add(new THREE.HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity));
  const sun = new THREE.DirectionalLight(theme.sun.color, theme.sun.intensity);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -22;
  sc.right = sc.top = 22;
  sc.near = 1;
  sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  let follow: THREE.PointLight | null = null;
  if (theme.followLight) {
    follow = new THREE.PointLight(theme.followLight.color, theme.followLight.intensity, 14, 1.8);
    scene.add(follow);
  }
  return { sun, follow };
}

/** Sun direction from the theme's elevation/azimuth (degrees). */
export function sunOffset(theme: Theme) {
  const el = THREE.MathUtils.degToRad(theme.sun.elevation);
  const az = THREE.MathUtils.degToRad(theme.sun.azimuth);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(60);
}
