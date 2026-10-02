/**
 * Visual themes, one per race. Pure data (no three.js) so phones can show the theme name too.
 */

export type FloorStyle = "wood" | "neon" | "candy" | "ice" | "basalt";
export type GroundStyle = "grass" | "grid" | "frosting" | "snow" | "ash";
export type SceneryStyle = "trees" | "city" | "lollipops" | "pines" | "volcanic";
export type ParticleStyle = "pollen" | "none" | "sprinkles" | "snow" | "embers";

export interface Theme {
  key: string;
  name: string;
  tagline: string;
  /** Accent used by UI chrome for this race. */
  accent: string;
  sky: { top: string; horizon: string; bottom: string; stars: boolean };
  fog: { color: string; near: number; far: number };
  sun: { color: string; intensity: number; elevation: number; azimuth: number };
  hemi: { sky: string; ground: string; intensity: number };
  /** Strength of the image-based reflections on marbles and glass. */
  envIntensity: number;
  exposure: number;
  /** Extra light that follows the action — keeps night themes readable. */
  followLight?: { color: string; intensity: number };
  /** Threshold is in HDR scene units: sunlit surfaces reach ~2-3, so day themes only bloom true emissives. */
  bloom: { strength: number; radius: number; threshold: number };
  /** base is the racing line: keep it a mid-tone that every marble colour stands out against. */
  floor: { style: FloorStyle; base: string; alt: string; line: string; glow?: string };
  /** Thin rim drawn around each marble; pick whatever contrasts most with floor.base. */
  marbleOutline: string;
  walls: { color: string; opacity: number };
  rails: { color: string; emissive?: string };
  skirt: { color: string; stripe: string; emissive?: string };
  supports: { color: string; brace: string; emissive?: string };
  gates: { checkpoint: string; finish: string; start: string; glow: string };
  obstacles: { spinner: string; peg: string; boost: string };
  ground: { style: GroundStyle; base: string; alt: string };
  mountains: { near: string; far: string; snowcap?: string };
  scenery: { style: SceneryStyle; colors: string[]; trunk: string; density: number };
  particles: { style: ParticleStyle; color: string };
  crowd: string[];
  flags: string[];
}

export const THEMES: readonly Theme[] = [
  {
    key: "sunny",
    name: "Sunny Speedway",
    tagline: "A wooden classic under blue skies",
    accent: "#ffd21f",
    sky: { top: "#3d8bff", horizon: "#bfe3ff", bottom: "#e9f6ff", stars: false },
    fog: { color: "#cfe8ff", near: 80, far: 320 },
    sun: { color: "#fff1d6", intensity: 2.6, elevation: 55, azimuth: 35 },
    hemi: { sky: "#e3f2ff", ground: "#6b7f4a", intensity: 1.1 },
    envIntensity: 0.9,
    exposure: 1.0,
    bloom: { strength: 0.35, radius: 0.4, threshold: 3.2 },
    floor: { style: "wood", base: "#c99a66", alt: "#bd8d5a", line: "#fff4e0" },
    marbleOutline: "#1c1208",
    walls: { color: "#bfe6ff", opacity: 0.28 },
    rails: { color: "#e23b3b" },
    skirt: { color: "#2f6bff", stripe: "#ffffff" },
    supports: { color: "#8a5a32", brace: "#a87447" },
    gates: { checkpoint: "#ff8a1f", finish: "#111827", start: "#16a34a", glow: "#ffd21f" },
    obstacles: { spinner: "#e23b3b", peg: "#ffd21f", boost: "#ff3df2" },
    ground: { style: "grass", base: "#5f9e4a", alt: "#7bb85c" },
    mountains: { near: "#5c8f6a", far: "#8fb3c9", snowcap: "#ffffff" },
    scenery: { style: "trees", colors: ["#3f8f3a", "#58a845", "#2f7a3a", "#7cbf4a"], trunk: "#6b4a2b", density: 1 },
    particles: { style: "pollen", color: "#fff6c0" },
    crowd: ["#e23b3b", "#2f6bff", "#ffd21f", "#ffffff", "#16a34a", "#ff8a1f"],
    flags: ["#e23b3b", "#ffd21f", "#2f6bff", "#ffffff"],
  },
  {
    key: "neon",
    name: "Neon Nights",
    tagline: "Synthwave racing through a city that never sleeps",
    accent: "#ff3df2",
    sky: { top: "#05010f", horizon: "#3a0a5c", bottom: "#ff3d8b", stars: true },
    fog: { color: "#1a0630", near: 60, far: 260 },
    sun: { color: "#8fa8ff", intensity: 0.5, elevation: 40, azimuth: -30 },
    hemi: { sky: "#6a3bff", ground: "#1a0630", intensity: 0.55 },
    envIntensity: 0.6,
    exposure: 1.1,
    followLight: { color: "#ffffff", intensity: 10 },
    bloom: { strength: 0.55, radius: 0.25, threshold: 1.4 },
    floor: { style: "neon", base: "#3a3266", alt: "#4a4180", line: "#00f0ff", glow: "#ff3df2" },
    marbleOutline: "#ffffff",
    walls: { color: "#7a3bff", opacity: 0.22 },
    rails: { color: "#00f0ff", emissive: "#00f0ff" },
    skirt: { color: "#0b0616", stripe: "#ff3df2", emissive: "#ff3df2" },
    supports: { color: "#1c1230", brace: "#2a1a48", emissive: "#00f0ff" },
    gates: { checkpoint: "#ff3df2", finish: "#00f0ff", start: "#c6ff3d", glow: "#ff3df2" },
    obstacles: { spinner: "#ff3df2", peg: "#00f0ff", boost: "#c6ff3d" },
    ground: { style: "grid", base: "#07020f", alt: "#ff3df2" },
    mountains: { near: "#1a0630", far: "#2c0b4d" },
    scenery: { style: "city", colors: ["#1b1036", "#24154a", "#120a24"], trunk: "#00f0ff", density: 1 },
    particles: { style: "none", color: "#ffffff" },
    crowd: ["#ff3df2", "#00f0ff", "#c6ff3d", "#ffffff", "#7a3bff"],
    flags: ["#ff3df2", "#00f0ff", "#c6ff3d"],
  },
  {
    key: "candy",
    name: "Candy Canyon",
    tagline: "Sugar-coated chaos in a land of sweets",
    accent: "#ff6fcf",
    sky: { top: "#ff9ad5", horizon: "#ffe1f1", bottom: "#fff6fb", stars: false },
    fog: { color: "#ffd6ec", near: 90, far: 320 },
    sun: { color: "#fff0f6", intensity: 2.4, elevation: 60, azimuth: 120 },
    hemi: { sky: "#fff0fa", ground: "#ff8ac4", intensity: 0.75 },
    envIntensity: 0.7,
    exposure: 0.9,
    bloom: { strength: 0.35, radius: 0.5, threshold: 3.2 },
    floor: { style: "candy", base: "#d9a3c0", alt: "#ff4d8d", line: "#ffffff" },
    marbleOutline: "#2a0a24",
    walls: { color: "#ffc8ea", opacity: 0.32 },
    rails: { color: "#7ee0ff" },
    skirt: { color: "#8a3ffc", stripe: "#ffd21f" },
    supports: { color: "#ff4d8d", brace: "#ffffff" },
    gates: { checkpoint: "#8a3ffc", finish: "#ff4d8d", start: "#3fd6a0", glow: "#ffd21f" },
    obstacles: { spinner: "#ff4d8d", peg: "#7ee0ff", boost: "#ffd21f" },
    ground: { style: "frosting", base: "#ffa8d4", alt: "#ffd1ea" },
    mountains: { near: "#ff9ad5", far: "#d9b3ff", snowcap: "#ffffff" },
    scenery: { style: "lollipops", colors: ["#ff4d8d", "#ffd21f", "#3fd6a0", "#7ee0ff", "#8a3ffc", "#ff8a1f"], trunk: "#ffffff", density: 0.8 },
    particles: { style: "sprinkles", color: "#ffffff" },
    crowd: ["#ff4d8d", "#ffd21f", "#3fd6a0", "#7ee0ff", "#8a3ffc"],
    flags: ["#ff4d8d", "#ffd21f", "#7ee0ff", "#3fd6a0"],
  },
  {
    key: "glacier",
    name: "Glacier Run",
    tagline: "Ice-slick turns through a frozen pass",
    accent: "#9fe3ff",
    sky: { top: "#2f5fae", horizon: "#b9d3f0", bottom: "#e6f0fb", stars: false },
    fog: { color: "#c9dcf2", near: 60, far: 240 },
    sun: { color: "#fff6ea", intensity: 2.0, elevation: 28, azimuth: -60 },
    hemi: { sky: "#dbe9ff", ground: "#7d93ad", intensity: 0.7 },
    envIntensity: 0.6,
    exposure: 0.85,
    bloom: { strength: 0.35, radius: 0.5, threshold: 3.4 },
    floor: { style: "ice", base: "#7aaccc", alt: "#4f8fbf", line: "#ffffff" },
    marbleOutline: "#08182e",
    walls: { color: "#d8f3ff", opacity: 0.4 },
    rails: { color: "#2f6bff" },
    skirt: { color: "#1b4f9c", stripe: "#ffffff" },
    supports: { color: "#5d6f84", brace: "#8899ad" },
    gates: { checkpoint: "#2f6bff", finish: "#1b2a6b", start: "#14a3a8", glow: "#9fe3ff" },
    obstacles: { spinner: "#2f6bff", peg: "#ffffff", boost: "#14a3a8" },
    ground: { style: "snow", base: "#e9f0f8", alt: "#c6d4e4" },
    mountains: { near: "#9fb4cc", far: "#c8d6e6", snowcap: "#ffffff" },
    scenery: { style: "pines", colors: ["#2f5d4a", "#3a6b55", "#24503f"], trunk: "#5a4030", density: 1.1 },
    particles: { style: "snow", color: "#ffffff" },
    crowd: ["#e23b3b", "#2f6bff", "#ffffff", "#ffd21f", "#14a3a8"],
    flags: ["#2f6bff", "#ffffff", "#e23b3b"],
  },
  {
    key: "volcano",
    name: "Volcano Rush",
    tagline: "Hot rocks, hotter racing",
    accent: "#ff6a1f",
    sky: { top: "#1a0a0a", horizon: "#7a2410", bottom: "#ff7a2a", stars: false },
    fog: { color: "#3a140c", near: 50, far: 230 },
    sun: { color: "#ffb27a", intensity: 1.6, elevation: 20, azimuth: 70 },
    hemi: { sky: "#ff9a5a", ground: "#2a0e08", intensity: 0.7 },
    envIntensity: 0.6,
    exposure: 1.05,
    followLight: { color: "#ffb27a", intensity: 8 },
    bloom: { strength: 0.5, radius: 0.25, threshold: 1.4 },
    floor: { style: "basalt", base: "#5e5650", alt: "#4f4843", line: "#ff8a1f", glow: "#ff4a0a" },
    marbleOutline: "#fff1dc",
    walls: { color: "#ffb27a", opacity: 0.18 },
    rails: { color: "#ff6a1f", emissive: "#ff3a0a" },
    skirt: { color: "#1c1714", stripe: "#ff6a1f", emissive: "#ff3a0a" },
    supports: { color: "#2a2420", brace: "#3a302a" },
    gates: { checkpoint: "#ff6a1f", finish: "#ffd21f", start: "#e23b3b", glow: "#ff6a1f" },
    obstacles: { spinner: "#ffd21f", peg: "#ff6a1f", boost: "#ff3a0a" },
    ground: { style: "ash", base: "#1f1a18", alt: "#ff4a0a" },
    mountains: { near: "#2a1610", far: "#4a1c10" },
    scenery: { style: "volcanic", colors: ["#2b2522", "#3a322d", "#1f1a18"], trunk: "#ff4a0a", density: 1 },
    particles: { style: "embers", color: "#ff8a3a" },
    crowd: ["#ffd21f", "#ff6a1f", "#e23b3b", "#ffffff"],
    flags: ["#ff6a1f", "#ffd21f", "#1c1714"],
  },
];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Each game starts somewhere different in the rotation; consecutive races never repeat a theme. */
export function themeForRound(gameId: string, round: number): Theme {
  return THEMES[(hash(gameId) + round - 1) % THEMES.length];
}

export const themeByKey = (key: string) => THEMES.find((t) => t.key === key) ?? THEMES[0];
