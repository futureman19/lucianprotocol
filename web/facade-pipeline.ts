
import type { IsoLayout, ScreenPoint } from './iso';
import { createPrismProjection, traceFace } from './iso';
import { getArchetypeSilhouette, type BuildingArchetype } from './building-archetypes';
import type { DistrictGrammar } from './district-grammar';

export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const normalized = color.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return color;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

export function adjustLightness(color: string, amount: number): string {
  if (color.startsWith('#')) {
    let r = parseInt(color.slice(1, 3), 16);
    let g = parseInt(color.slice(3, 5), 16);
    let b = parseInt(color.slice(5, 7), 16);
    r = Math.max(0, Math.min(255, r + amount));
    g = Math.max(0, Math.min(255, g + amount));
    b = Math.max(0, Math.min(255, b + amount));
    return `rgb(${r},${g},${b})`;
  }
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return color;
  const r = Math.max(0, Math.min(255, parseInt(match[1]!) + amount));
  const g = Math.max(0, Math.min(255, parseInt(match[2]!) + amount));
  const b = Math.max(0, Math.min(255, parseInt(match[3]!) + amount));
  return `rgb(${r},${g},${b})`;
}

export function fillFace(
  context: CanvasRenderingContext2D,
  points: ScreenPoint[],
  fill: string,
  stroke: string,
  lineWidth = 1,
): void {
  traceFace(context, points);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

export function interpolateTopPoint(
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  u: number,
  v: number,
): ScreenPoint {
  return {
    sx: top[0].sx + (top[1].sx - top[0].sx) * u + (top[3].sx - top[0].sx) * v,
    sy: top[0].sy + (top[1].sy - top[0].sy) * u + (top[3].sy - top[0].sy) * v,
  };
}

export interface FacadeModuleOptions {
  context: CanvasRenderingContext2D;
  displayX: number;
  displayY: number;
  zBase: number;
  footprintWidth: number;
  footprintDepth: number;
  height: number;
  layout: IsoLayout;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
    trim: string;
    windowLit: string;
    windowDark: string;
  };
  grammar: DistrictGrammar;
  seed: number;
  nightFactor: number;
  occupancy: number;
  conditionFactor: number; // 0 = pristine, 1 = condemned
}

export function drawBaseModule(opts: FacadeModuleOptions): ReturnType<typeof createPrismProjection> {
  const { context, displayX, displayY, zBase, footprintWidth, footprintDepth, height, layout, palette } = opts;
  const proj = createPrismProjection(
    displayX + (1 - footprintWidth) / 2,
    displayY + (1 - footprintDepth) / 2,
    zBase,
    footprintWidth,
    footprintDepth,
    height,
    layout,
  );

  const leftColor = adjustLightness(palette.primary, -30 + opts.conditionFactor * -20);
  const rightColor = adjustLightness(palette.secondary, -30 + opts.conditionFactor * -20);
  const topColor = adjustLightness(palette.trim, -10);

  fillFace(context, proj.left, leftColor, withAlpha(palette.trim, 0.35), 1);
  fillFace(context, proj.right, rightColor, withAlpha(palette.trim, 0.35), 1);
  fillFace(context, proj.top, topColor, withAlpha(palette.trim, 0.25), 1);

  return proj;
}

export function drawMidsectionModule(
  opts: FacadeModuleOptions,
  _atop: ReturnType<typeof createPrismProjection>,
): ReturnType<typeof createPrismProjection> {
  const { context, displayX, displayY, zBase, footprintWidth, footprintDepth, height, layout, palette, seed } = opts;
  const proj = createPrismProjection(
    displayX + (1 - footprintWidth) / 2,
    displayY + (1 - footprintDepth) / 2,
    zBase,
    footprintWidth,
    footprintDepth,
    height,
    layout,
  );

  const grime = opts.conditionFactor * 15;
  const leftColor = adjustLightness(palette.primary, -10 - grime);
  const rightColor = adjustLightness(palette.secondary, -10 - grime);
  const topColor = adjustLightness(palette.primary, 5 - grime);

  fillFace(context, proj.left, leftColor, withAlpha(palette.trim, 0.3), 1);
  fillFace(context, proj.right, rightColor, withAlpha(palette.trim, 0.3), 1);
  fillFace(context, proj.top, topColor, withAlpha(palette.trim, 0.2), 1);

  // Window grid — density scales with footprint so larger buildings show more detail
  const rows = Math.max(2, Math.floor(height * 2.5));
  const cols = Math.max(2, Math.floor(footprintWidth * 3.5) + ((seed ?? 0) % 2));
  drawWindowGrid(context, proj.left, rows, cols, opts);
  drawWindowGrid(context, proj.right, rows, cols, opts);

  return proj;
}

export function drawCrownModule(
  opts: FacadeModuleOptions,
): ReturnType<typeof createPrismProjection> {
  const { context, displayX, displayY, zBase, footprintWidth, footprintDepth, height, layout, palette } = opts;
  const proj = createPrismProjection(
    displayX + (1 - footprintWidth) / 2,
    displayY + (1 - footprintDepth) / 2,
    zBase,
    footprintWidth,
    footprintDepth,
    height,
    layout,
  );

  const leftColor = adjustLightness(palette.primary, 10);
  const rightColor = adjustLightness(palette.secondary, 10);
  const topColor = adjustLightness(palette.trim, 15);

  fillFace(context, proj.left, leftColor, withAlpha(palette.trim, 0.35), 1);
  fillFace(context, proj.right, rightColor, withAlpha(palette.trim, 0.35), 1);
  fillFace(context, proj.top, topColor, withAlpha(palette.accent, 0.4), 1);

  return proj;
}

export function drawSpire(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  accent: string,
  height: number,
  phase: number,
): void {
  const center = interpolateTopPoint(top, 0.5, 0.5);
  const spireH = layout.tileHeight * height;

  context.save();
  context.strokeStyle = accent;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(center.sx, center.sy);
  context.lineTo(center.sx, center.sy - spireH);
  context.stroke();

  // Blinking obstruction light
  const blink = (phase % 60) < 30;
  context.fillStyle = blink ? '#ef4444' : withAlpha('#ef4444', 0.3);
  context.shadowBlur = blink ? 12 : 0;
  context.shadowColor = '#ef4444';
  context.beginPath();
  context.arc(center.sx, center.sy - spireH, 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawEntranceModule(
  opts: FacadeModuleOptions,
  projection: ReturnType<typeof createPrismProjection>,
): void {
  const { context, palette, nightFactor } = opts;
  const face = projection.right;

  // Door position
  const doorW = 0.35;
  const doorH = 0.45;
  const u = 0.5 - doorW / 2;
  const _v = 1 - doorH;

  const p0 = {
    sx: face[0].sx + (face[3].sx - face[0].sx) * u,
    sy: face[0].sy + (face[3].sy - face[0].sy) * u,
  };
  const p1 = {
    sx: face[0].sx + (face[3].sx - face[0].sx) * (u + doorW),
    sy: face[0].sy + (face[3].sy - face[0].sy) * (u + doorW),
  };
  const p2 = {
    sx: face[1].sx + (face[2].sx - face[1].sx) * (u + doorW),
    sy: face[1].sy + (face[2].sy - face[1].sy) * (u + doorW),
  };
  const p3 = {
    sx: face[1].sx + (face[2].sx - face[1].sx) * u,
    sy: face[1].sy + (face[2].sy - face[1].sy) * u,
  };

  context.save();
  context.fillStyle = '#3d1f0a';
  context.beginPath();
  context.moveTo(p0.sx, p0.sy);
  context.lineTo(p1.sx, p1.sy);
  context.lineTo(p2.sx, p2.sy);
  context.lineTo(p3.sx, p3.sy);
  context.closePath();
  context.fill();

  // Door frame
  context.strokeStyle = palette.trim;
  context.lineWidth = 1.2;
  context.stroke();

  // Lobby glow
  if (nightFactor > 0.2) {
    context.fillStyle = withAlpha(palette.windowLit, nightFactor * 0.7);
    context.shadowBlur = 8 * nightFactor;
    context.shadowColor = palette.windowLit;
    context.fill();
  }

  // Knob
  context.fillStyle = '#c9a227';
  context.beginPath();
  context.arc(p1.sx - 2, (p1.sy + p2.sy) / 2, 1.2, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

export function drawSideAttachment(
  opts: FacadeModuleOptions,
  projection: ReturnType<typeof createPrismProjection>,
  side: 'left' | 'right',
  type: 'fire-escape' | 'duct' | 'bay',
): void {
  const { context, palette, seed } = opts;
  const face = side === 'left' ? projection.left : projection.right;

  const attachW = 0.15;
  void 0.7;
  const u = 0.2 + (seed % 3) * 0.2;

  const p0 = {
    sx: face[0].sx + (face[3].sx - face[0].sx) * u,
    sy: face[0].sy + (face[3].sy - face[0].sy) * u,
  };
  const p1 = {
    sx: face[0].sx + (face[3].sx - face[0].sx) * (u + attachW),
    sy: face[0].sy + (face[3].sy - face[0].sy) * (u + attachW),
  };
  const p2 = {
    sx: face[1].sx + (face[2].sx - face[1].sx) * (u + attachW),
    sy: face[1].sy + (face[2].sy - face[1].sy) * (u + attachW),
  };
  const p3 = {
    sx: face[1].sx + (face[2].sx - face[1].sx) * u,
    sy: face[1].sy + (face[2].sy - face[1].sy) * u,
  };

  context.save();

  if (type === 'fire-escape') {
    context.strokeStyle = withAlpha('#64748b', 0.9);
    context.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const y1 = p0.sy + (p3.sy - p0.sy) * t;
      const y2 = p1.sy + (p2.sy - p1.sy) * t;
      context.beginPath();
      context.moveTo(p0.sx, y1);
      context.lineTo(p1.sx, y2);
      context.stroke();
    }
  } else if (type === 'duct') {
    context.fillStyle = withAlpha('#71717a', 0.85);
    context.beginPath();
    context.moveTo(p0.sx, p0.sy);
    context.lineTo(p1.sx, p1.sy);
    context.lineTo(p2.sx, p2.sy);
    context.lineTo(p3.sx, p3.sy);
    context.closePath();
    context.fill();
  } else if (type === 'bay') {
    context.fillStyle = withAlpha(palette.secondary, 0.7);
    context.beginPath();
    context.moveTo(p0.sx, p0.sy);
    context.lineTo(p1.sx, p1.sy);
    context.lineTo(p2.sx, p2.sy);
    context.lineTo(p3.sx, p3.sy);
    context.closePath();
    context.fill();
  }

  context.restore();
}

function drawWindowGrid(
  context: CanvasRenderingContext2D,
  face: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  rows: number,
  cols: number,
  opts: FacadeModuleOptions,
): void {
  const { nightFactor, occupancy, palette, seed } = opts;
  const warmNight = nightFactor > 0.4;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = warmNight && occupancy > 0.3 && Math.sin(seed + r * 13 + c * 7) > (0.3 - occupancy * 0.5);

      const tTop = (r + 0.15) / rows;
      const tBottom = (r + 0.85) / rows;
      const tLeft = (c + 0.2) / cols;
      const tRight = (c + 0.8) / cols;

      const x1 = face[0].sx + (face[3].sx - face[0].sx) * tLeft;
      const y1 = face[0].sy + (face[3].sy - face[0].sy) * tLeft;
      const x2 = face[1].sx + (face[2].sx - face[1].sx) * tLeft;
      const y2 = face[1].sy + (face[2].sy - face[1].sy) * tLeft;
      const x3 = face[0].sx + (face[3].sx - face[0].sx) * tRight;
      const y3 = face[0].sy + (face[3].sy - face[0].sy) * tRight;
      const x4 = face[1].sx + (face[2].sx - face[1].sx) * tRight;
      const y4 = face[1].sy + (face[2].sy - face[1].sy) * tRight;

      const p1 = { sx: x1 + (x2 - x1) * tTop, sy: y1 + (y2 - y1) * tTop };
      const p2 = { sx: x3 + (x4 - x3) * tTop, sy: y3 + (y4 - y3) * tTop };
      const p3 = { sx: x3 + (x4 - x3) * tBottom, sy: y3 + (y4 - y3) * tBottom };
      const p4 = { sx: x1 + (x2 - x1) * tBottom, sy: y1 + (y2 - y1) * tBottom };

      context.save();
      context.fillStyle = lit ? withAlpha(palette.windowLit, 0.85 + nightFactor * 0.15) : withAlpha(palette.windowDark, 0.45 + nightFactor * 0.2);
      if (lit) {
        context.shadowBlur = 8 + nightFactor * 6;
        context.shadowColor = palette.windowLit;
      }
      context.beginPath();
      context.moveTo(p1.sx, p1.sy);
      context.lineTo(p2.sx, p2.sy);
      context.lineTo(p3.sx, p3.sy);
      context.lineTo(p4.sx, p4.sy);
      context.closePath();
      context.fill();

      context.strokeStyle = withAlpha(palette.trim, 0.35);
      context.lineWidth = 0.6;
      context.stroke();
      context.restore();
    }
  }
}

export function drawArchetypeFacade(
  context: CanvasRenderingContext2D,
  archetype: BuildingArchetype,
  displayX: number,
  displayY: number,
  zBase: number,
  footprintWidth: number,
  footprintDepth: number,
  totalHeight: number,
  layout: IsoLayout,
  palette: FacadeModuleOptions['palette'],
  grammar: DistrictGrammar,
  seed: number,
  nightFactor: number,
  occupancy: number,
  conditionFactor: number,
  importanceTier: number,
): ReturnType<typeof createPrismProjection> {
  const silhouette = getArchetypeSilhouette(archetype, importanceTier, 0, seed);

  const baseOpts: FacadeModuleOptions = {
    context,
    displayX,
    displayY,
    zBase,
    footprintWidth: footprintWidth * silhouette.baseWidthScale,
    footprintDepth: footprintDepth * silhouette.baseDepthScale,
    height: totalHeight * silhouette.baseHeight,
    layout,
    palette,
    grammar,
    seed,
    nightFactor,
    occupancy,
    conditionFactor,
  };

  const baseProj = drawBaseModule(baseOpts);

  if (silhouette.midHeight > 0.05) {
    const midOpts: FacadeModuleOptions = {
      ...baseOpts,
      footprintWidth: footprintWidth * silhouette.midWidthScale,
      footprintDepth: footprintDepth * silhouette.midDepthScale,
      height: totalHeight * silhouette.midHeight,
      zBase: zBase + totalHeight * silhouette.baseHeight,
    };
    drawMidsectionModule(midOpts, baseProj);

    if (silhouette.crownHeight > 0.05) {
      const crownOpts: FacadeModuleOptions = {
        ...baseOpts,
        footprintWidth: footprintWidth * silhouette.crownWidthScale,
        footprintDepth: footprintDepth * silhouette.crownDepthScale,
        height: totalHeight * silhouette.crownHeight,
        zBase: zBase + totalHeight * (silhouette.baseHeight + silhouette.midHeight),
      };
      const crownProj = drawCrownModule(crownOpts);

      if (silhouette.hasSpire) {
        drawSpire(context, crownProj.top, layout, palette.accent, Math.max(0.6, totalHeight * 0.25), 0);
      }

      return crownProj;
    }

    return midOpts as unknown as ReturnType<typeof createPrismProjection>;
  }

  return baseProj;
}
