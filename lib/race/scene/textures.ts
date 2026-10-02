import * as THREE from "three";
import type { MarbleDef } from "../marbles";
import { makeRng } from "../rng";
import type { Theme } from "../themes";

/** All textures are drawn on canvases at runtime — nothing to download. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[], count: number, size: number, seed: number) {
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.25 + rng() * 0.35;
    ctx.fillRect(rng() * w, rng() * h, size * (0.5 + rng()), size * (0.5 + rng()));
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, width: number, seed: number) {
  const rng = makeRng(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    ctx.lineWidth = width * (0.4 + rng());
    ctx.beginPath();
    let x = rng() * w;
    let y = rng() * h;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rng() - 0.5) * w * 0.25;
      y += (rng() - 0.5) * h * 0.25;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

export interface SurfaceTextures {
  map: THREE.Texture;
  emissiveMap?: THREE.Texture;
  roughness: number;
  metalness: number;
}

/**
 * Track floor. u runs across the channel (0 → 1, left → right), v runs along it.
 * One tile covers FLOOR_TILE_LENGTH world units of track.
 */
export const FLOOR_TILE_LENGTH = 6;

export function floorTextures(theme: Theme): SurfaceTextures {
  const { base, alt, line, glow } = theme.floor;
  const W = 256;
  const H = 512;
  // The racing line (u 0.15–0.85) is kept calm and even so marbles read clearly against it.
  // Each theme's personality lives in the curved edge bands and the walls, not under the marbles.
  const EDGE = 0.15;
  const edges = (ctx: CanvasRenderingContext2D, paint: (x0: number, w: number) => void) => {
    paint(0, W * EDGE);
    paint(W * (1 - EDGE), W * EDGE);
  };
  const edgeLines = (ctx: CanvasRenderingContext2D, color: string, width = 3) => {
    ctx.fillStyle = color;
    ctx.fillRect(W * EDGE - width, 0, width, H);
    ctx.fillRect(W * (1 - EDGE), 0, width, H);
  };
  const clipBand = (ctx: CanvasRenderingContext2D, x0: number, w: number, draw: () => void) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, w, H);
    ctx.clip();
    draw();
    ctx.restore();
  };

  switch (theme.floor.style) {
    case "wood": {
      const map = canvasTexture(W, H, (ctx) => {
        // Low-contrast planks laid across the track.
        const plank = H / 12;
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = i % 2 ? base : alt;
          ctx.fillRect(0, i * plank, W, plank);
          ctx.fillStyle = "rgba(60,30,10,0.18)";
          ctx.fillRect(0, i * plank, W, 2);
        }
        const rng = makeRng(7);
        ctx.strokeStyle = "rgba(90,50,20,0.08)";
        for (let i = 0; i < 60; i++) {
          ctx.lineWidth = 1 + rng();
          ctx.beginPath();
          const y = rng() * H;
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(W * 0.3, y + rng() * 6 - 3, W * 0.6, y + rng() * 6 - 3, W, y + rng() * 4 - 2);
          ctx.stroke();
        }
        edges(ctx, (x0, w) => {
          ctx.fillStyle = "rgba(70,35,10,0.35)";
          ctx.fillRect(x0, 0, w, H);
        });
        edgeLines(ctx, line);
      });
      return { map, roughness: 0.65, metalness: 0.02 };
    }
    case "neon": {
      const draw = (ctx: CanvasRenderingContext2D, dark: boolean) => {
        ctx.fillStyle = dark ? "#000" : base;
        ctx.fillRect(0, 0, W, H);
        if (!dark) {
          // Faint, non-glowing grid on the racing line.
          ctx.fillStyle = alt;
          for (let i = 0; i < 8; i++) ctx.fillRect(0, (i * H) / 8, W, 2);
          for (let i = 1; i < 6; i++) ctx.fillRect((i * W) / 6, 0, 2, H);
        }
        // Glow only in the edge bands.
        edges(ctx, (x0, w) =>
          clipBand(ctx, x0, w, () => {
            ctx.fillStyle = glow!;
            for (let i = 0; i < 8; i++) ctx.fillRect(x0, (i * H) / 8, w, 6);
          }),
        );
        edgeLines(ctx, line, 5);
      };
      return {
        map: canvasTexture(W, H, (ctx) => draw(ctx, false)),
        emissiveMap: canvasTexture(W, H, (ctx) => draw(ctx, true)),
        roughness: 0.55,
        metalness: 0.2,
      };
    }
    case "candy": {
      const map = canvasTexture(W, H, (ctx) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, H);
        // Candy-cane bands on the curved edges only.
        edges(ctx, (x0, w) =>
          clipBand(ctx, x0, w, () => {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x0, 0, w, H);
            ctx.fillStyle = alt;
            for (let k = -H; k < W + H; k += 48) {
              ctx.beginPath();
              ctx.moveTo(k, 0);
              ctx.lineTo(k + 24, 0);
              ctx.lineTo(k + 24 + H, H);
              ctx.lineTo(k + H, H);
              ctx.fill();
            }
          }),
        );
        edgeLines(ctx, line, 4);
      });
      return { map, roughness: 0.35, metalness: 0.0 };
    }
    case "ice": {
      const map = canvasTexture(W, H, (ctx) => {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, H);
        speckle(ctx, W, H, [alt], 160, 3, 3);
        edges(ctx, (x0, w) =>
          clipBand(ctx, x0, w, () => {
            ctx.fillStyle = alt;
            ctx.fillRect(x0, 0, w, H);
            cracks(ctx, W, H, "rgba(255,255,255,0.75)", 18, 1.5, 11);
          }),
        );
        edgeLines(ctx, line);
      });
      return { map, roughness: 0.2, metalness: 0.05 };
    }
    case "basalt": {
      const draw = (ctx: CanvasRenderingContext2D, dark: boolean) => {
        ctx.fillStyle = dark ? "#000" : base;
        ctx.fillRect(0, 0, W, H);
        if (!dark) speckle(ctx, W, H, [alt], 300, 5, 5);
        // Glowing lava cracks confined to the edge bands.
        edges(ctx, (x0, w) => clipBand(ctx, x0, w, () => cracks(ctx, W, H, glow!, 24, 3, 9)));
        edgeLines(ctx, line);
      };
      return {
        map: canvasTexture(W, H, (ctx) => draw(ctx, false)),
        emissiveMap: canvasTexture(W, H, (ctx) => draw(ctx, true)),
        roughness: 0.85,
        metalness: 0.05,
      };
    }
  }
}

/** Ground plane tile (repeated many times). */
export function groundTextures(theme: Theme): SurfaceTextures {
  const { base, alt } = theme.ground;
  const S = 256;
  switch (theme.ground.style) {
    case "grass":
      return {
        map: canvasTexture(S, S, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, S, S);
          ctx.fillStyle = alt;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(0, 0, S / 2, S); // mowing stripes
          ctx.globalAlpha = 1;
          speckle(ctx, S, S, ["#3f7a33", "#8cc865", "#4e8c3c"], 1500, 2, 1);
        }),
        roughness: 1,
        metalness: 0,
      };
    case "grid": {
      const draw = (ctx: CanvasRenderingContext2D, dark: boolean) => {
        ctx.fillStyle = dark ? "#000" : base;
        ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = alt;
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, S, S);
      };
      return {
        map: canvasTexture(S, S, (ctx) => draw(ctx, false)),
        emissiveMap: canvasTexture(S, S, (ctx) => draw(ctx, true)),
        roughness: 0.4,
        metalness: 0.5,
      };
    }
    case "frosting":
      return {
        map: canvasTexture(S, S, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, S, S);
          const rng = makeRng(4);
          const colors = theme.scenery.colors;
          for (let i = 0; i < 160; i++) {
            ctx.save();
            ctx.translate(rng() * S, rng() * S);
            ctx.rotate(rng() * Math.PI);
            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(-5, -1.5, 10, 3);
            ctx.restore();
          }
          speckle(ctx, S, S, [alt], 300, 6, 2);
        }),
        roughness: 0.6,
        metalness: 0,
      };
    case "snow":
      return {
        map: canvasTexture(S, S, (ctx) => {
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, S, S);
          speckle(ctx, S, S, [alt, "#ffffff", "#cfdbe8"], 900, 5, 6);
        }),
        roughness: 0.9,
        metalness: 0,
      };
    case "ash": {
      const draw = (ctx: CanvasRenderingContext2D, dark: boolean) => {
        ctx.fillStyle = dark ? "#000" : base;
        ctx.fillRect(0, 0, S, S);
        if (!dark) speckle(ctx, S, S, ["#2a2420", "#151110", "#3a302a"], 900, 5, 8);
        cracks(ctx, S, S, alt, 6, 2.5, 12);
      };
      return {
        map: canvasTexture(S, S, (ctx) => draw(ctx, false)),
        emissiveMap: canvasTexture(S, S, (ctx) => draw(ctx, true)),
        roughness: 1,
        metalness: 0,
      };
    }
  }
}

/** Outer shell of the track: base colour with a racing stripe along each side. u runs around the shell. */
export function skirtTextures(theme: Theme): SurfaceTextures {
  const { color, stripe, emissive } = theme.skirt;
  const W = 256;
  const H = 128;
  const draw = (ctx: CanvasRenderingContext2D, dark: boolean) => {
    ctx.fillStyle = dark ? "#000" : color;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = dark ? (emissive ?? "#000") : stripe;
    // Stripes sit on the outer side walls (start and end of the profile).
    for (const u of [0.05, 0.9]) ctx.fillRect(u * W, 0, W * 0.05, H);
    if (!dark) {
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, W, 3); // panel seams every tile
    }
  };
  return {
    map: canvasTexture(W, H, (ctx) => draw(ctx, false)),
    emissiveMap: emissive ? canvasTexture(W, H, (ctx) => draw(ctx, true)) : undefined,
    roughness: 0.45,
    metalness: 0.15,
  };
}

/** Lit windows for city buildings. */
export function windowTextures(lit: string[]) {
  const S = 128;
  const draw = (ctx: CanvasRenderingContext2D, dark: boolean) => {
    ctx.fillStyle = dark ? "#000" : "#141024";
    ctx.fillRect(0, 0, S, S);
    const rng = makeRng(21);
    for (let y = 6; y < S; y += 14)
      for (let x = 6; x < S; x += 12) {
        if (rng() < 0.45) continue;
        ctx.fillStyle = lit[Math.floor(rng() * lit.length)];
        ctx.globalAlpha = dark ? 0.5 + rng() * 0.5 : 0.8;
        ctx.fillRect(x, y, 6, 8);
      }
    ctx.globalAlpha = 1;
  };
  return { map: canvasTexture(S, S, (ctx) => draw(ctx, false)), emissiveMap: canvasTexture(S, S, (ctx) => draw(ctx, true)) };
}

export function marbleTexture(m: MarbleDef) {
  return canvasTexture(256, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, m.color);
    g.addColorStop(0.5, m.color);
    g.addColorStop(1, `#${new THREE.Color(m.color).multiplyScalar(0.7).getHexString()}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = m.accent;
    ctx.strokeStyle = m.accent;
    if (m.pattern === "stripe") {
      ctx.fillRect(0, 50, 256, 28);
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

export function labelTexture(m: MarbleDef) {
  return canvasTexture(256, 64, (ctx) => {
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
}

export function signTexture(text: string, bg: string, fg = "#ffffff") {
  return canvasTexture(512, 96, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0, 0, 512, 8);
    ctx.fillRect(0, 88, 512, 8);
    ctx.fillStyle = fg;
    ctx.font = "800 60px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 50);
  });
}

export function checkerTexture() {
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

export function chevronTexture(color: string) {
  return canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = color;
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
}

/** Soft round sprite for particles. */
export function dotTexture() {
  return canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.8)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}
