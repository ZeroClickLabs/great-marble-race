import * as THREE from "three";
import { makeRng, type Rng } from "../rng";
import type { Theme } from "../themes";
import type { Track } from "../track";
import { InstanceBatch } from "./structures";
import { windowTextures } from "./textures";

/** Spatial hash of the track footprint (padded by `clearance`) so props never sprout through it or crowd the camera. */
function footprint(track: Track, clearance: number, cell = 4) {
  const cells = new Set<string>();
  const key = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const reach = Math.ceil(clearance / cell);
  for (let i = 0; i < track.samples.length; i += 4) {
    const p = track.samples[i].p;
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) cells.add(key(p.x + dx * cell, p.z + dz * cell));
  }
  return (x: number, z: number) => cells.has(key(x, z));
}

function placements(track: Track, rng: Rng, count: number, groundY: number, clearance: number) {
  const box = new THREE.Box3();
  for (const f of track.samples) box.expandByPoint(f.p);
  box.expandByVector(new THREE.Vector3(45 + clearance, 0, 45 + clearance));
  const near = footprint(track, clearance);
  const out: THREE.Vector3[] = [];
  for (let tries = 0; out.length < count && tries < count * 6; tries++) {
    const x = box.min.x + rng() * (box.max.x - box.min.x);
    const z = box.min.z + rng() * (box.max.z - box.min.z);
    if (!near(x, z)) out.push(new THREE.Vector3(x, groundY, z));
  }
  return out;
}

const compose = (pos: THREE.Vector3, scale: THREE.Vector3, yaw = 0) =>
  new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), scale);

export function buildScenery(track: Track, theme: Theme, groundY: number, budget: number) {
  const rng = makeRng(track.seed ^ 0x5eed);
  // Tall city blocks need more room or they wall in the chase camera.
  const clearance = theme.scenery.style === "city" ? 16 : 4;
  const spots = placements(track, rng, Math.round(budget * theme.scenery.density), groundY, clearance);
  const { colors, trunk } = theme.scenery;
  const pick = () => colors[Math.floor(rng() * colors.length)];
  const group = new THREE.Group();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  switch (theme.scenery.style) {
    case "trees": {
      const trunks = new InstanceBatch(new THREE.CylinderGeometry(0.18, 0.28, 1, 6), new THREE.MeshStandardMaterial({ color: trunk, roughness: 1 }));
      const crowns = new InstanceBatch(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }));
      for (const p of spots) {
        const h = 1.5 + rng() * 2.5;
        const r = 1.2 + rng() * 1.3;
        trunks.add(compose(p.clone().setY(groundY + h / 2), v(1, h, 1)));
        crowns.add(compose(p.clone().setY(groundY + h + r * 0.6), v(r, r * (0.9 + rng() * 0.5), r), rng() * 6), pick());
      }
      group.add(trunks.build({ castShadow: true }), crowns.build({ castShadow: true }));
      break;
    }
    case "pines": {
      const trunks = new InstanceBatch(new THREE.CylinderGeometry(0.15, 0.22, 1, 6), new THREE.MeshStandardMaterial({ color: trunk, roughness: 1 }));
      const tiers = new InstanceBatch(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }));
      const caps = new InstanceBatch(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.8, flatShading: true }));
      for (const p of spots) {
        const h = 3 + rng() * 5;
        const r = h * 0.32;
        trunks.add(compose(p.clone().setY(groundY + 0.6), v(1, 1.2, 1)));
        const color = pick();
        for (let k = 0; k < 3; k++) {
          const s = 1 - k * 0.28;
          tiers.add(compose(p.clone().setY(groundY + 1 + k * h * 0.26 + (h * 0.45 * s) / 2), v(r * s, h * 0.45 * s, r * s), rng()), color);
        }
        caps.add(compose(p.clone().setY(groundY + 1 + h * 0.78), v(r * 0.35, h * 0.16, r * 0.35)));
      }
      group.add(trunks.build(), tiers.build({ castShadow: true }), caps.build());
      break;
    }
    case "lollipops": {
      const sticks = new InstanceBatch(new THREE.CylinderGeometry(0.08, 0.08, 1, 6), new THREE.MeshStandardMaterial({ color: trunk, roughness: 0.4 }));
      const pops = new InstanceBatch(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshPhysicalMaterial({ roughness: 0.15, clearcoat: 1 }));
      const drops = new InstanceBatch(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 0.6 }));
      spots.forEach((p, i) => {
        if (i % 3 === 0) {
          const r = 0.5 + rng() * 0.9;
          drops.add(compose(p.clone(), v(r, r * 1.1, r)), pick());
          return;
        }
        const h = 2 + rng() * 4;
        const r = 0.8 + rng() * 1.1;
        sticks.add(compose(p.clone().setY(groundY + h / 2), v(1, h, 1)));
        pops.add(compose(p.clone().setY(groundY + h + r * 0.8), v(r, r, r * 0.35), rng() * 6), pick());
      });
      group.add(sticks.build(), pops.build({ castShadow: true }), drops.build());
      break;
    }
    case "city": {
      const win = windowTextures(["#00f0ff", "#ff3df2", "#ffd21f", "#ffffff"]);
      const towers = new InstanceBatch(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ map: win.map, emissiveMap: win.emissiveMap, emissive: "#ffffff", emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.4 }),
      );
      const trims = new InstanceBatch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }));
      const glows = ["#00f0ff", "#ff3df2", "#c6ff3d"];
      // Fewer, bigger props: towers ring the course rather than crowding it.
      for (const p of spots.slice(0, Math.round(spots.length * 0.6))) {
        const w = 3 + rng() * 5;
        const d = 3 + rng() * 5;
        const h = 6 + rng() * 34;
        const yaw = Math.round(rng() * 4) * (Math.PI / 2);
        towers.add(compose(p.clone().setY(groundY + h / 2), v(w, h, d), yaw), pick());
        trims.add(compose(p.clone().setY(groundY + h + 0.1), v(w + 0.2, 0.25, d + 0.2), yaw), glows[Math.floor(rng() * glows.length)]);
      }
      group.add(towers.build(), trims.build());
      break;
    }
    case "volcanic": {
      const rocks = new InstanceBatch(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }));
      const pools = new InstanceBatch(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: "#ff5a0a", toneMapped: false }));
      const spires = new InstanceBatch(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshStandardMaterial({ color: "#2b2522", roughness: 1, flatShading: true }));
      spots.forEach((p, i) => {
        if (i % 5 === 0) {
          const r = 1.5 + rng() * 3;
          const m = compose(p.clone().setY(groundY + 0.05), v(r, r, r));
          m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
          pools.add(m);
        } else if (i % 3 === 0) {
          const h = 3 + rng() * 9;
          spires.add(compose(p.clone().setY(groundY + h / 2), v(h * 0.25, h, h * 0.25), rng() * 6));
        } else {
          const r = 0.5 + rng() * 2;
          rocks.add(compose(p.clone().setY(groundY + r * 0.4), v(r, r * (0.5 + rng() * 0.5), r), rng() * 6), pick());
        }
      });
      group.add(rocks.build({ castShadow: true }), pools.build(), spires.build({ castShadow: true }));
      break;
    }
  }
  return group;
}
