import * as THREE from "three";
import type { Theme } from "../themes";
import { framePoint, LID_HEIGHT, PROFILE, SAMPLE_STEP, TRACK_HALF_WIDTH, type Frame, type Track } from "../track";
import { FLOOR_TILE_LENGTH, floorTextures, skirtTextures } from "./textures";

/**
 * Sweep a 2D cross-section along the track frames, with UVs:
 * u = distance around the profile (0..1), v = distance along the track / tileLength.
 */
export function sweep(frames: Frame[], profile: [number, number][], tileLength: number, faceIn = true) {
  const cols = profile.length;
  const lens = [0];
  for (let j = 1; j < cols; j++) lens.push(lens[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  const total = lens[cols - 1] || 1;

  const pos = new Float32Array(frames.length * cols * 3);
  const uv = new Float32Array(frames.length * cols * 2);
  frames.forEach((f, i) => {
    profile.forEach(([x, y], j) => {
      const v = framePoint(f, x, y);
      pos.set([v.x, v.y, v.z], (i * cols + j) * 3);
      uv.set([lens[j] / total, (i * SAMPLE_STEP) / tileLength], (i * cols + j) * 2);
    });
  });
  const idx: number[] = [];
  for (let i = 0; i < frames.length - 1; i++)
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (faceIn) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Outer shell under the channel so the track reads as a solid object, not a paper-thin surface. */
const SKIRT: [number, number][] = [
  [-TRACK_HALF_WIDTH - 0.12, LID_HEIGHT - 0.05],
  [-TRACK_HALF_WIDTH - 0.12, 0.3],
  [-1.6, -0.1],
  [-1.25, -0.2],
  [1.25, -0.2],
  [1.6, -0.1],
  [TRACK_HALF_WIDTH + 0.12, 0.3],
  [TRACK_HALF_WIDTH + 0.12, LID_HEIGHT - 0.05],
];

export function buildTrack(track: Track, theme: Theme) {
  const group = new THREE.Group();
  const frames = track.samples;

  const floorTex = floorTextures(theme);
  const floor = new THREE.Mesh(
    sweep(frames, PROFILE.slice(1, 7), FLOOR_TILE_LENGTH),
    new THREE.MeshStandardMaterial({
      map: floorTex.map,
      emissiveMap: floorTex.emissiveMap ?? null,
      emissive: floorTex.emissiveMap ? "#ffffff" : "#000000",
      emissiveIntensity: floorTex.emissiveMap ? 1.1 : 0,
      roughness: floorTex.roughness,
      metalness: floorTex.metalness,
    }),
  );
  floor.receiveShadow = true;

  const skirtTex = skirtTextures(theme);
  const skirt = new THREE.Mesh(
    sweep(frames, SKIRT, 4, false),
    new THREE.MeshStandardMaterial({
      map: skirtTex.map,
      emissiveMap: skirtTex.emissiveMap ?? null,
      emissive: skirtTex.emissiveMap ? "#ffffff" : "#000000",
      emissiveIntensity: skirtTex.emissiveMap ? 1.8 : 0,
      roughness: skirtTex.roughness,
      metalness: skirtTex.metalness,
    }),
  );
  skirt.castShadow = true;
  skirt.receiveShadow = true;

  const glass = new THREE.MeshPhysicalMaterial({
    color: theme.walls.color,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: theme.walls.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
  });
  const leftWall = new THREE.Mesh(sweep(frames, PROFILE.slice(0, 2), 4), glass);
  const rightWall = new THREE.Mesh(sweep(frames, PROFILE.slice(6), 4), glass);
  leftWall.renderOrder = rightWall.renderOrder = 2;

  const railMat = new THREE.MeshStandardMaterial({
    color: theme.rails.color,
    emissive: theme.rails.emissive ?? "#000000",
    emissiveIntensity: theme.rails.emissive ? 1.2 : 0,
    roughness: 0.3,
    metalness: 0.6,
  });
  const railCurve = (x: number) =>
    new THREE.CatmullRomCurve3(frames.filter((_, i) => i % 4 === 0).map((f) => framePoint(f, x, LID_HEIGHT - 0.04)));
  const segs = Math.floor(frames.length / 2);
  const rails = [-TRACK_HALF_WIDTH - 0.06, TRACK_HALF_WIDTH + 0.06].map(
    (x) => new THREE.Mesh(new THREE.TubeGeometry(railCurve(x), segs, 0.07, 8), railMat),
  );

  group.add(floor, skirt, leftWall, rightWall, ...rails);
  return group;
}
