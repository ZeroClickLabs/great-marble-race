import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { Theme } from "../themes";

export interface QualityLevel {
  name: string;
  /** Cap on device pixel ratio. */
  pixelRatio: number;
  shadowMapSize: number;
  shadows: boolean;
  bloom: boolean;
}

/** Highest first. The renderer steps down a level whenever the frame rate sags. */
export const QUALITY_LEVELS: QualityLevel[] = [
  { name: "high", pixelRatio: 1.5, shadowMapSize: 2048, shadows: true, bloom: true },
  { name: "medium", pixelRatio: 1.25, shadowMapSize: 1024, shadows: true, bloom: true },
  { name: "low", pixelRatio: 1, shadowMapSize: 1024, shadows: true, bloom: false },
  { name: "minimal", pixelRatio: 0.8, shadowMapSize: 512, shadows: false, bloom: false },
];

/** Bloom (glow on emissive light strips, neon, lava) via a composer; plain render when bloom is off. */
export class PostPipeline {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  enabled = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    theme: Theme,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), theme.bloom.strength, theme.bloom.radius, theme.bloom.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    // UnrealBloomPass already blurs from half resolution down, so it stays cheap at any size.
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    if (this.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}

/** Watches real frame times and asks for a lower quality level when the host's machine is struggling. */
export class FrameMonitor {
  private samples: number[] = [];
  private cooldownUntil = 0;

  constructor(
    private budgetMs = 26,
    private window = 90,
  ) {}

  /** Returns true when the recent average frame time is over budget. */
  record(dtSeconds: number, now: number) {
    // Ignore hidden tabs and hitches (tab switches, GC) — only sustained slowness counts.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
    if (dtSeconds <= 0 || dtSeconds > 0.25 || now < this.cooldownUntil) return false;
    this.samples.push(dtSeconds * 1000);
    if (this.samples.length < this.window) return false;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    if (avg <= this.budgetMs) return false;
    this.cooldownUntil = now + 2000;
    return true;
  }
}
