// SC2K-style isometric palette & lighting utilities
// Top-left sun convention: left = warm highlight, right = cool shadow, top = ambient bright

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
}

export function adjustHue(color: string, degrees: number): string {
  const { r, g, b } = hexToRgb(color);
  const hsl = rgbToHsl(r, g, b);
  hsl.h += degrees;
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function adjustSaturation(color: string, delta: number): string {
  const { r, g, b } = hexToRgb(color);
  const hsl = rgbToHsl(r, g, b);
  hsl.s = Math.max(0, Math.min(1, hsl.s + delta));
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function adjustLightnessSc2k(color: string, delta: number): string {
  // delta is in range [-1, 1] representing fraction of luminosity change
  const { r, g, b } = hexToRgb(color);
  const hsl = rgbToHsl(r, g, b);
  hsl.l = Math.max(0, Math.min(1, hsl.l + delta));
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export interface Sc2kFaceColors {
  left: string;   // sun-facing: warm highlight
  right: string;  // shadowed: cool shadow
  top: string;    // ambient bright
}

/**
 * Given a base material color, derive the three isometric face colors
 * using SC2K conventions:
 * - Left face (sun): warm shift (+10° hue), +15% lightness
 * - Right face (shadow): cool shift (-15° hue), -12% lightness
 * - Top face (ambient): desaturated slightly, +22% lightness
 */
export function getFaceColors(baseColor: string, daylight: number): Sc2kFaceColors {
  const warm = adjustHue(baseColor, 10);
  const cool = adjustHue(baseColor, -15);

  const left = adjustLightnessSc2k(warm, 0.12 + (daylight * 0.08));
  const right = adjustLightnessSc2k(cool, -0.10 - (daylight * 0.06));
  const top = adjustLightnessSc2k(adjustSaturation(baseColor, -0.08), 0.18 + (daylight * 0.06));

  return { left, right, top };
}

/**
 * Ordered dithering fill for smooth gradients on large flat surfaces.
 * Returns a CanvasPattern of two colors in a 2x2 checkerboard.
 */
export function createDitherPattern(
  context: CanvasRenderingContext2D,
  colorA: string,
  colorB: string,
): CanvasPattern | null {
  const size = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colorB;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(1, 1, 1, 1);

  return context.createPattern(canvas, 'repeat');
}

/**
 * SC2K-style master palette slot definitions.
 * Each archetype gets a base material color; all face/window/trim colors
 * are derived algorithmically from it to maintain visual cohesion.
 */
export const SC2K_BASE_COLORS: Record<string, string> = {
  tower: '#64748b',      // blue-grey concrete
  warehouse: '#b45309',  // rust brick
  shopfront: '#be185d',  // magenta storefront
  campus: '#15803d',     // institutional green
  factory: '#1e3a8a',    // industrial blue
  civic: '#cbd5e1',      // pale stone
  substation: '#52525b', // dark concrete
  landmark: '#7c3aed',   // purple monument
};

export function getSc2kBaseColor(archetype: string): string {
  return (SC2K_BASE_COLORS[archetype] ?? SC2K_BASE_COLORS.tower) as string;
}
