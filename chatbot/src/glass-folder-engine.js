// Glass folder texture engine.
//
// Renders the back plate behind the folder: a seeded gradient-noise field
// warped twice (liquid marble / brushed streaks), shaded with a normal
// derived from the field so highlights travel with the pattern instead of
// sitting on a flat image. Every variant is deterministic from its seed, so
// repeated mounts reuse the cached bitmap.
//
// Nothing here touches the DOM beyond an offscreen canvas; the component owns
// when to paint and how to scale the result.

const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Gradient (Perlin-style) noise on a shuffled permutation table.
function makeNoise(random) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = p[i];
    p[i] = p[j];
    p[j] = swap;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
  const grad = (hash, x, y) => {
    const angle = (hash & 7) * (TAU / 8);
    return Math.cos(angle) * x + Math.sin(angle) * y;
  };
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

function makeFbm(noise, octaves = 4) {
  return function fbm(x, y) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.02;
    }
    return sum / norm;
  };
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// Palettes come straight from the design spec: seven stops, a mode and the
// warp/streak parameters that give each one its character.
export const FOLDER_PALETTES = {
  aurora: {
    colors: ["#f4efe9", "#e9c2b8", "#c2433f", "#2a1e2a", "#22395e", "#6f97c2", "#e5edf4"],
    mode: "streak",
    scale: 0.7,
    warp: 1.4,
    angle: -0.62,
    gloss: 0.18,
    veins: 0,
    seed: 0x51f15e,
  },
  ember: {
    colors: ["#07090c", "#16252c", "#3d5f68", "#1a1416", "#a3201a", "#ef4a2b", "#ff8a5c"],
    mode: "marble",
    scale: 0.62,
    warp: 3.2,
    angle: -0.5,
    gloss: 0.55,
    veins: 0.6,
    seed: 0xe4b3a1,
  },
  dusk: {
    colors: ["#120c18", "#3e2850", "#8f6c9c", "#2b1a24", "#b3502f", "#eab08a", "#fbe7d2"],
    mode: "marble",
    scale: 0.9,
    warp: 3.6,
    angle: 0.8,
    gloss: 0.4,
    veins: 0.25,
    seed: 0xd0c4f1,
  },
  glacier: {
    colors: ["#f7fbff", "#e9f1f8", "#d7e4ef", "#c3d4e4", "#9db6cd", "#7a9ab8", "#5c7d9c"],
    mode: "streak",
    scale: 0.8,
    warp: 1.2,
    angle: 0.3,
    gloss: 0.24,
    veins: 0,
    seed: 0x9ac0de,
  },
  verdant: {
    colors: ["#f3f6ee", "#dfe8d3", "#c3d3b0", "#a9bd93", "#8a9e73", "#6f8757", "#5a6f47"],
    mode: "marble",
    scale: 0.75,
    warp: 2.4,
    angle: -0.3,
    gloss: 0.3,
    veins: 0.35,
    seed: 0x77c1a3,
  },
};

const cache = new Map();

function samplePalette(stops, t) {
  const scaled = clamp(t, 0, 1) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return [
    lerp(a[0], b[0], local),
    lerp(a[1], b[1], local),
    lerp(a[2], b[2], local),
  ];
}

function buildTexture(variantName, width, height) {
  const variant = FOLDER_PALETTES[variantName] || FOLDER_PALETTES.aurora;
  const stops = variant.colors.map(hexToRgb);
  const random = mulberry32(variant.seed);
  const noise = makeNoise(random);
  const fbm = makeFbm(noise, 4);

  // Paint at plate resolution; the element scales it down with the card, and
  // the browser's downscale is the smoother of the two filters.
  const halfW = Math.max(8, Math.ceil(width));
  const halfH = Math.max(8, Math.ceil(height));
  const field = new Float32Array(halfW * halfH);
  const veinField = new Float32Array(halfW * halfH);
  const samples = [];
  const cos = Math.cos(variant.angle);
  const sin = Math.sin(variant.angle);
  const scale = variant.scale;
  const warp = variant.warp;

  for (let y = 0; y < halfH; y += 1) {
    for (let x = 0; x < halfW; x += 1) {
      // Normalise to a few noise units across the plate. Feeding raw pixel
      // coordinates into fBm made the highest octave land near the Nyquist
      // limit, which read as per-pixel speckle instead of a texture.
      const nx = (x / halfW - 0.5) * 3.2;
      const ny = (y / halfH - 0.5) * 3.2;
      let px = nx * scale;
      let py = ny * scale;
      // Rotate into the variant's angle, then stretch for streaks.
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      if (variant.mode === "streak") {
        px = rx * 0.14;
        py = ry * 2.2;
      } else {
        px = rx;
        py = ry;
      }
      // Two domain warps: q bends r, r bends the final field.
      const qx = fbm(px, py);
      const qy = fbm(px + 5.2, py + 1.3);
      const rx2 = fbm(px + warp * qx + 1.7, py + warp * qy + 9.2);
      const ry2 = fbm(px + warp * qx + 8.3, py + warp * qy + 2.8);
      const fieldValue = fbm(px + warp * rx2, py + warp * ry2);
      field[y * halfW + x] = fieldValue;
      veinField[y * halfW + x] = Math.sqrt(qx * qx + qy * qy);
      samples.push(fieldValue);
    }
  }

  samples.sort((a, b) => a - b);
  const low = samples[Math.floor(samples.length * 0.02)] ?? -1;
  const high = samples[Math.floor(samples.length * 0.98)] ?? 1;
  const span = high - low || 1;

  const canvas = document.createElement("canvas");
  canvas.width = halfW;
  canvas.height = halfH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const image = ctx.createImageData(halfW, halfH);
  const data = image.data;
  // Light direction from the spec: (-.55, -.65, .52).
  const lx = -0.55;
  const ly = -0.65;
  const lz = 0.52;

  for (let y = 0; y < halfH; y += 1) {
    for (let x = 0; x < halfW; x += 1) {
      const index = y * halfW + x;
      const value = (field[index] - low) / span;
      const left = field[y * halfW + Math.max(0, x - 1)];
      const right = field[y * halfW + Math.min(halfW - 1, x + 1)];
      const up = field[Math.max(0, y - 1) * halfW + x];
      const down = field[Math.min(halfH - 1, y + 1) * halfW + x];
      let nx = -(right - left) * 2.4;
      let ny = -(down - up) * 2.4;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const nd = nx * lx + ny * ly + nz * lz;
      // Keep the field soft: crisp per-pixel highlights read as noise once the
      // 340px plate is scaled down inside a 195px column.
      const diffuse = 0.88 + 0.18 * clamp(nd, 0, 1);
      const spec = Math.pow(clamp(nd, 0, 1), 24) * variant.gloss * 120;
      const fine = Math.sin((x / halfW + y / halfH) * 6.28 + veinField[index] * 6) * 1.6;
      const vein =
        variant.veins * Math.exp(-Math.pow(veinField[index] - 0.42, 2) / 0.0016) * 70;
      const rgb = samplePalette(stops, value);
      const offset = index * 4;
      data[offset] = clamp(rgb[0] * diffuse + spec + fine - vein, 0, 255);
      data[offset + 1] = clamp(rgb[1] * diffuse + spec + fine - vein, 0, 255);
      data[offset + 2] = clamp(rgb[2] * diffuse + spec + fine - vein, 0, 255);
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Return a cached canvas for the variant, painting it on first use. Callers
// are expected to be inside a DOM (browser or jsdom); in jsdom there is no 2D
// context, so this returns null and the CSS gradient fallback takes over.
export function folderTexture(variantName, width, height) {
  const key = `${variantName}:${Math.round(width)}x${Math.round(height)}`;
  if (cache.has(key)) return cache.get(key);
  let canvas = null;
  try {
    canvas = buildTexture(variantName, width, height);
  } catch {
    canvas = null;
  }
  cache.set(key, canvas);
  return canvas;
}
