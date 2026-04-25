import { isCriticalMass } from '../src/hivemind';
import type { HivemindNodeState } from '../src/hivemind';
import type { Entity } from '../src/types';
import {
  createPrismProjection,
  toScreen,
  type IsoLayout,
} from './iso';
import {
  getBuildingHeight,
  getFileFootprint,
  getFilePalette,
  getFileArchetype,
  type BuildingPalette,

} from './file-colors';

export interface DrawBuildingContext {
  context: CanvasRenderingContext2D;
  entity: Entity;
  display: { x: number; y: number };
  layout: IsoLayout;
  phase: number;
  nodeState: HivemindNodeState;
}

function withAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function traceFace(
  context: CanvasRenderingContext2D,
  points: { sx: number; sy: number }[],
): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.sx, first.sy);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p) context.lineTo(p.sx, p.sy);
  }
  context.closePath();
}

function fillFace(
  context: CanvasRenderingContext2D,
  points: { sx: number; sy: number }[],
  color: string,
  stroke: string,
  lineWidth = 1.1,
): void {
  traceFace(context, points);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = lineWidth;
  context.stroke();
}

// ─── Node State Visual System ───

interface StateVisuals {
  beaconColor: string;
  beaconPulse: number;
  groundRingColor: string;
  groundRingAlpha: number;
  scaffold: boolean;
  windowTint: string | null;
}

function getStateVisuals(nodeState: HivemindNodeState, phase: number): StateVisuals {
  switch (nodeState) {
    case 'task': {
      const pulse = 0.6 + ((phase % 8) * 0.06);
      return {
        beaconColor: '#ec4899',
        beaconPulse: pulse,
        groundRingColor: '#ec4899',
        groundRingAlpha: 0.35,
        scaffold: true,
        windowTint: 'rgba(236, 72, 153, 0.15)',
      };
    }
    case 'in-progress': {
      const pulse = 0.5 + ((phase % 6) * 0.09);
      return {
        beaconColor: '#fb923c',
        beaconPulse: pulse,
        groundRingColor: '#fb923c',
        groundRingAlpha: 0.4,
        scaffold: true,
        windowTint: 'rgba(251, 146, 60, 0.18)',
      };
    }
    case 'asymmetry': {
      const pulse = 0.5 + ((phase % 4) * 0.14);
      return {
        beaconColor: '#ef4444',
        beaconPulse: pulse,
        groundRingColor: '#ef4444',
        groundRingAlpha: 0.5,
        scaffold: false,
        windowTint: 'rgba(239, 68, 68, 0.2)',
      };
    }
    case 'verified': {
      const pulse = 0.7 + ((phase % 12) * 0.03);
      return {
        beaconColor: '#22c55e',
        beaconPulse: pulse,
        groundRingColor: '#22c55e',
        groundRingAlpha: 0.3,
        scaffold: false,
        windowTint: 'rgba(34, 197, 94, 0.12)',
      };
    }
    default: {
      const pulse = 0.6 + ((phase % 14) * 0.03);
      return {
        beaconColor: '#56d9ff',
        beaconPulse: pulse,
        groundRingColor: '#56d9ff',
        groundRingAlpha: 0.2,
        scaffold: false,
        windowTint: null,
      };
    }
  }
}

function drawGroundRing(
  context: CanvasRenderingContext2D,
  center: { sx: number; sy: number },
  layout: IsoLayout,
  visuals: StateVisuals,
): void {
  const rx = layout.tileWidth * 0.32;
  const ry = layout.tileHeight * 0.24;
  context.save();
  context.beginPath();
  context.ellipse(center.sx, center.sy, rx, ry, 0, 0, Math.PI * 2);
  context.strokeStyle = withAlpha(visuals.groundRingColor, visuals.groundRingAlpha);
  context.lineWidth = 2;
  context.shadowBlur = 12;
  context.shadowColor = withAlpha(visuals.groundRingColor, visuals.groundRingAlpha * 0.6);
  context.stroke();
  context.restore();
}

function drawBeacon(
  context: CanvasRenderingContext2D,
  top: { sx: number; sy: number },
  layout: IsoLayout,
  visuals: StateVisuals,
): void {
  const radius = Math.max(2, layout.tileHeight * 0.1);
  context.save();
  context.beginPath();
  context.ellipse(top.sx, top.sy, radius, radius * 0.7, 0, 0, Math.PI * 2);
  context.fillStyle = withAlpha(visuals.beaconColor, visuals.beaconPulse);
  context.shadowBlur = 14;
  context.shadowColor = withAlpha(visuals.beaconColor, visuals.beaconPulse * 0.8);
  context.fill();
  context.restore();
}

function drawScaffolding(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  _layout: IsoLayout,
): void {
  context.save();
  context.strokeStyle = 'rgba(251, 191, 36, 0.5)';
  context.lineWidth = 1;

  // X pattern on left face
  const left = projection.left;
  context.beginPath();
  context.moveTo(left[0]!.sx, left[0]!.sy);
  context.lineTo(left[2]!.sx, left[2]!.sy);
  context.moveTo(left[1]!.sx, left[1]!.sy);
  context.lineTo(left[3]!.sx, left[3]!.sy);
  context.stroke();

  // X pattern on right face
  const right = projection.right;
  context.beginPath();
  context.moveTo(right[0]!.sx, right[0]!.sy);
  context.lineTo(right[2]!.sx, right[2]!.sy);
  context.moveTo(right[1]!.sx, right[1]!.sy);
  context.lineTo(right[3]!.sx, right[3]!.sy);
  context.stroke();

  context.restore();
}

// ─── Window & Facade Details ───

function drawWindowGrid(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  rows: number,
  cols: number,
  windowColor: string,
): void {
  const left = projection.left;
  const right = projection.right;

  context.save();
  context.strokeStyle = windowColor;
  context.lineWidth = 0.8;
  context.globalAlpha = 0.6;

  // Left face windows
  for (let r = 1; r < rows; r++) {
    const t = r / rows;
    const y = left[0]!.sy + (left[3]!.sy - left[0]!.sy) * t;
    const x1 = left[0]!.sx + (left[3]!.sx - left[0]!.sx) * t;
    const x2 = left[1]!.sx + (left[2]!.sx - left[1]!.sx) * t;
    context.beginPath();
    context.moveTo(x1, y);
    context.lineTo(x2, y);
    context.stroke();
  }
  for (let c = 1; c < cols; c++) {
    const t = c / cols;
    const x = left[0]!.sx + (left[1]!.sx - left[0]!.sx) * t;
    const y1 = left[0]!.sy + (left[1]!.sy - left[0]!.sy) * t;
    const y2 = left[3]!.sy + (left[2]!.sy - left[3]!.sy) * t;
    context.beginPath();
    context.moveTo(x, y1);
    context.lineTo(x, y2);
    context.stroke();
  }

  // Right face windows
  for (let r = 1; r < rows; r++) {
    const t = r / rows;
    const y = right[0]!.sy + (right[3]!.sy - right[0]!.sy) * t;
    const x1 = right[0]!.sx + (right[3]!.sx - right[0]!.sx) * t;
    const x2 = right[1]!.sx + (right[2]!.sx - right[1]!.sx) * t;
    context.beginPath();
    context.moveTo(x1, y);
    context.lineTo(x2, y);
    context.stroke();
  }
  for (let c = 1; c < cols; c++) {
    const t = c / cols;
    const x = right[0]!.sx + (right[1]!.sx - right[0]!.sx) * t;
    const y1 = right[0]!.sy + (right[1]!.sy - right[0]!.sy) * t;
    const y2 = right[3]!.sy + (right[2]!.sy - right[3]!.sy) * t;
    context.beginPath();
    context.moveTo(x, y1);
    context.lineTo(x, y2);
    context.stroke();
  }

  context.restore();
}

function drawVerticalWindows(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  count: number,
  windowColor: string,
): void {
  const left = projection.left;
  const right = projection.right;
  context.save();
  context.strokeStyle = windowColor;
  context.lineWidth = 1.2;
  context.globalAlpha = 0.55;

  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    // Left face vertical strip
    const lx = left[0]!.sx + (left[1]!.sx - left[0]!.sx) * t;
    const ly1 = left[0]!.sy + (left[1]!.sy - left[0]!.sy) * t;
    const ly2 = left[3]!.sy + (left[2]!.sy - left[3]!.sy) * t;
    context.beginPath();
    context.moveTo(lx, ly1);
    context.lineTo(lx, ly2);
    context.stroke();

    // Right face vertical strip
    const rx = right[0]!.sx + (right[1]!.sx - right[0]!.sx) * t;
    const ry1 = right[0]!.sy + (right[1]!.sy - right[0]!.sy) * t;
    const ry2 = right[3]!.sy + (right[2]!.sy - right[3]!.sy) * t;
    context.beginPath();
    context.moveTo(rx, ry1);
    context.lineTo(rx, ry2);
    context.stroke();
  }
  context.restore();
}

function drawRoofVents(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  color: string,
): void {
  const top = projection.top;
  const cx = (top[0]!.sx + top[2]!.sx) / 2;
  const cy = (top[0]!.sy + top[2]!.sy) / 2;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.2;
  context.globalAlpha = 0.5;
  for (let i = -1; i <= 1; i++) {
    const ox = i * 4;
    context.beginPath();
    context.moveTo(cx + ox - 3, cy - 2);
    context.lineTo(cx + ox + 3, cy - 2);
    context.stroke();
    context.beginPath();
    context.moveTo(cx + ox - 3, cy + 2);
    context.lineTo(cx + ox + 3, cy + 2);
    context.stroke();
  }
  context.restore();
}

function drawColumns(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  color: string,
): void {
  const front = projection.right;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.globalAlpha = 0.45;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const x = front[0]!.sx + (front[1]!.sx - front[0]!.sx) * t;
    const y1 = front[0]!.sy + (front[1]!.sy - front[0]!.sy) * t;
    const y2 = front[3]!.sy + (front[2]!.sy - front[3]!.sy) * t;
    context.beginPath();
    context.moveTo(x, y1);
    context.lineTo(x, y2);
    context.stroke();
  }
  context.restore();
}

function drawAntenna(
  context: CanvasRenderingContext2D,
  topCenter: { sx: number; sy: number },
  height: number,
  color: string,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.globalAlpha = 0.8;
  context.beginPath();
  context.moveTo(topCenter.sx, topCenter.sy);
  context.lineTo(topCenter.sx, topCenter.sy - height);
  context.stroke();
  // Tip glow
  context.beginPath();
  context.arc(topCenter.sx, topCenter.sy - height, 2, 0, Math.PI * 2);
  context.fillStyle = color;
  context.shadowBlur = 8;
  context.shadowColor = color;
  context.fill();
  context.restore();
}

function drawSmokestack(
  context: CanvasRenderingContext2D,
  base: { sx: number; sy: number },
  height: number,
  color: string,
): void {
  context.save();
  context.fillStyle = color;
  context.globalAlpha = 0.7;
  const w = 3;
  context.fillRect(base.sx - w / 2, base.sy - height, w, height);
  // Top rim
  context.globalAlpha = 0.9;
  context.fillRect(base.sx - w / 2 - 1, base.sy - height, w + 2, 2);
  context.restore();
}

function drawCrownRing(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  color: string,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.globalAlpha = 0.7;
  context.shadowBlur = 10;
  context.shadowColor = color;
  traceFace(context, projection.top);
  context.stroke();
  context.restore();
}

function drawScreenFace(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  color: string,
): void {
  context.save();
  context.fillStyle = color;
  context.globalAlpha = 0.35;
  context.shadowBlur = 16;
  context.shadowColor = color;
  traceFace(context, projection.right);
  context.fill();
  context.restore();
}

function drawArchFront(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  color: string,
): void {
  const right = projection.right;
  const mx = (right[0]!.sx + right[1]!.sx + right[2]!.sx + right[3]!.sx) / 4;
  const my = (right[0]!.sy + right[1]!.sy + right[2]!.sy + right[3]!.sy) / 4;
  const h = Math.abs(right[0]!.sy - right[3]!.sy);
  const w = Math.abs(right[0]!.sx - right[1]!.sx);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.globalAlpha = 0.5;
  context.beginPath();
  context.arc(mx, my + h * 0.1, Math.min(w, h) * 0.35, Math.PI, 0);
  context.stroke();
  context.restore();
}

function drawPyramidRoof(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
): void {
  const top = projection.top;
  const apex = {
    sx: (top[0]!.sx + top[2]!.sx) / 2,
    sy: (top[0]!.sy + top[2]!.sy) / 2 - Math.abs(top[0]!.sy - top[3]!.sy) * 0.5,
  };
  context.save();
  // Left slope
  context.beginPath();
  context.moveTo(top[0]!.sx, top[0]!.sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[3]!.sx, top[3]!.sy);
  context.closePath();
  context.fillStyle = palette.left;
  context.fill();
  context.strokeStyle = withAlpha(palette.window, 0.3);
  context.lineWidth = 1;
  context.stroke();

  // Right slope
  context.beginPath();
  context.moveTo(top[1]!.sx, top[1]!.sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[2]!.sx, top[2]!.sy);
  context.closePath();
  context.fillStyle = palette.right;
  context.fill();
  context.stroke();

  // Front slope (triangular face toward viewer)
  context.beginPath();
  context.moveTo(top[0]!.sx, top[0]!.sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[1]!.sx, top[1]!.sy);
  context.closePath();
  context.fillStyle = palette.top;
  context.fill();
  context.stroke();

  context.restore();
}

function drawSteppedTop(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  _layout: IsoLayout,
): void {
  const top = projection.top;
  const cx = (top[0]!.sx + top[2]!.sx) / 2;
  const cy = (top[0]!.sy + top[2]!.sy) / 2;
  const hw = Math.abs(top[1]!.sx - top[0]!.sx) * 0.3;
  const hh = Math.abs(top[3]!.sy - top[0]!.sy) * 0.3;

  const stepped = [
    { sx: cx - hw, sy: cy - hh * 0.5 },
    { sx: cx + hw, sy: cy - hh * 0.5 },
    { sx: cx + hw, sy: cy + hh * 0.5 },
    { sx: cx - hw, sy: cy + hh * 0.5 },
  ];

  context.save();
  fillFace(context, stepped, palette.top, withAlpha(palette.window, 0.4), 1);
  context.restore();
}

function drawMonolithCrownFixed(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  layout: IsoLayout,
): void {
  const top = projection.top;
  const cx = (top[0]!.sx + top[2]!.sx) / 2;
  const cy = (top[0]!.sy + top[2]!.sy) / 2;
  const hw = Math.abs(top[1]!.sx - top[0]!.sx) * 0.25;
  const hh = Math.abs(top[3]!.sy - top[0]!.sy) * 0.25;
  const rise = layout.tileHeight * 0.25;

  const crownTop = [
    { sx: cx - hw, sy: cy - hh * 0.5 - rise },
    { sx: cx + hw, sy: cy - hh * 0.5 - rise },
    { sx: cx + hw, sy: cy + hh * 0.5 - rise },
    { sx: cx - hw, sy: cy + hh * 0.5 - rise },
  ];

  context.save();
  fillFace(context, crownTop, palette.top, withAlpha(palette.window, 0.3), 1);
  context.restore();
}

// ─── Critical Mass Halo ───

function drawCriticalMassHalo(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  layout: IsoLayout,
  phase: number,
): void {
  const pulse = 0.7 + ((phase % 10) * 0.05);
  context.save();
  context.beginPath();
  context.ellipse(
    projection.center.sx,
    projection.center.sy,
    layout.tileWidth * 0.28,
    layout.tileHeight * 0.22,
    0,
    0,
    Math.PI * 2,
  );
  context.strokeStyle = `rgba(236, 72, 153, ${pulse})`;
  context.lineWidth = 1.6;
  context.shadowBlur = 16;
  context.shadowColor = 'rgba(236, 72, 153, 0.62)';
  context.stroke();
  context.restore();
}

// ─── Base Prism Render ───

function drawBasePrism(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  lineWidth: number,
  highlighted: boolean,
  glow: string,
): void {
  context.save();
  context.lineWidth = lineWidth;
  if (highlighted) {
    context.shadowBlur = 14;
    context.shadowColor = glow;
  }
  fillFace(context, projection.left, palette.left, withAlpha(palette.window, 0.18));
  fillFace(context, projection.right, palette.right, withAlpha(palette.window, 0.22));
  fillFace(context, projection.top, palette.top, palette.accent);
  context.restore();
}

// ─── Archetype Renderers ───

function drawPlaza(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.4, false, palette.glow);

  // Courtyard pattern on roof
  const top = projection.top;
  const cx = (top[0]!.sx + top[2]!.sx) / 2;
  const cy = (top[0]!.sy + top[2]!.sy) / 2;
  const hw = Math.abs(top[1]!.sx - top[0]!.sx) * 0.35;
  const hh = Math.abs(top[3]!.sy - top[0]!.sy) * 0.35;

  context.save();
  context.fillStyle = withAlpha(palette.window, 0.2);
  context.beginPath();
  context.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = withAlpha(palette.window, 0.3);
  context.lineWidth = 1;
  context.stroke();
  context.restore();

  // Corner pillars
  for (const p of top) {
    context.save();
    context.fillStyle = palette.accent;
    context.globalAlpha = 0.5;
    context.beginPath();
    context.arc(p.sx, p.sy, 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  const center = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ, layout);
  drawGroundRing(context, center, layout, visuals);
  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawSkyscraper(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  const highlighted = ctx.nodeState !== 'stable' || isCriticalMass(ctx.entity);
  drawBasePrism(context, projection, palette, 1.2, highlighted, palette.glow);

  // Window grid
  const rows = Math.max(2, Math.min(5, Math.floor(height * 1.5)));
  drawWindowGrid(context, projection, rows, 3, palette.window);

  // Antenna
  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawAntenna(context, topCenter, layout.tileHeight * 0.45, palette.accent);

  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.25 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (visuals.windowTint) {
    context.save();
    context.globalAlpha = 0.2;
    fillFace(context, projection.right, visuals.windowTint, 'transparent');
    context.restore();
  }
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawTower(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  const highlighted = ctx.nodeState !== 'stable' || isCriticalMass(ctx.entity);
  drawBasePrism(context, projection, palette, 1.2, highlighted, palette.glow);

  // Stepped top
  drawSteppedTop(context, projection, palette, layout);

  // Vertical windows
  drawVerticalWindows(context, projection, 2, palette.window);

  // Crown ring
  drawCrownRing(context, projection, palette.accent);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.25 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawHut(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  _height: number,
  _baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Pyramid roof
  drawPyramidRoof(context, projection, palette);

  const apex = {
    sx: (projection.top[0]!.sx + projection.top[2]!.sx) / 2,
    sy: (projection.top[0]!.sy + projection.top[2]!.sy) / 2 - Math.abs(projection.top[0]!.sy - projection.top[3]!.sy) * 0.5,
  };

  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.2 }, layout, visuals);
  drawBeacon(context, apex, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawBillboard(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Glowing screen face
  drawScreenFace(context, projection, palette.accent);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.15 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawPavilion(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Columns on front
  drawColumns(context, projection, palette.window);

  // Open roof look — lighter top edges
  drawCrownRing(context, projection, palette.window);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.15 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawArchway(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Arch on front face
  drawArchFront(context, projection, palette.accent);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.15 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawDatacenter(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Vent grilles on roof
  drawRoofVents(context, projection, palette.window);

  // Small blinkenlights on front
  const right = projection.right;
  context.save();
  context.fillStyle = palette.accent;
  context.globalAlpha = 0.7 + ((phase % 6) * 0.05);
  const cx = (right[0]!.sx + right[2]!.sx) / 2;
  const cy = (right[0]!.sy + right[2]!.sy) / 2;
  context.beginPath();
  context.arc(cx, cy, 2, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.2 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawFactory(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Smokestacks
  const top = projection.top;
  const s1 = { sx: top[0]!.sx + (top[1]!.sx - top[0]!.sx) * 0.25, sy: top[0]!.sy + (top[1]!.sy - top[0]!.sy) * 0.25 };
  const s2 = { sx: top[0]!.sx + (top[1]!.sx - top[0]!.sx) * 0.75, sy: top[0]!.sy + (top[1]!.sy - top[0]!.sy) * 0.75 };
  drawSmokestack(context, s1, layout.tileHeight * 0.3, palette.accent);
  drawSmokestack(context, s2, layout.tileHeight * 0.25, palette.accent);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.2 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawPyramid(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  _height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  // Pyramid doesn't use the standard prism faces — replace with true pyramid
  const top = projection.top;
  const apex = {
    sx: (top[0]!.sx + top[2]!.sx) / 2,
    sy: (top[0]!.sy + top[2]!.sy) / 2 - Math.abs(top[0]!.sy - top[3]!.sy) * 0.8,
  };

  context.save();
  context.lineWidth = 1.1;

  // Left face
  context.beginPath();
  context.moveTo(top[0]!.sx, top[0]!.sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[3]!.sx, top[3]!.sy);
  context.closePath();
  context.fillStyle = palette.left;
  context.fill();
  context.strokeStyle = withAlpha(palette.window, 0.2);
  context.stroke();

  // Right face
  context.beginPath();
  context.moveTo(top[1]!.sx, top[1]!.sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[2]!.sx, top[2]!.sy);
  context.closePath();
  context.fillStyle = palette.right;
  context.fill();
  context.stroke();

  // Front face
  context.beginPath();
  context.moveTo(top[0]!.sx, top[0]!.sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[1]!.sx, top[1]!.sy);
  context.closePath();
  context.fillStyle = palette.top;
  context.fill();
  context.strokeStyle = palette.accent;
  context.stroke();

  context.restore();

  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.2 }, layout, visuals);
  drawBeacon(context, apex, layout, visuals);
  if (visuals.scaffold) {
    // Scaffold around base
    context.save();
    context.strokeStyle = 'rgba(251, 191, 36, 0.5)';
    context.lineWidth = 1;
    const b = [
      toScreen(ctx.display.x, ctx.display.y, baseZ, layout),
      toScreen(ctx.display.x + 1, ctx.display.y, baseZ, layout),
      toScreen(ctx.display.x + 1, ctx.display.y + 1, baseZ, layout),
      toScreen(ctx.display.x, ctx.display.y + 1, baseZ, layout),
    ];
    context.beginPath();
    context.moveTo(b[0]!.sx, b[0]!.sy);
    context.lineTo(b[2]!.sx, b[2]!.sy);
    context.moveTo(b[1]!.sx, b[1]!.sy);
    context.lineTo(b[3]!.sx, b[3]!.sy);
    context.stroke();
    context.restore();
  }
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawBrutalist(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  const highlighted = ctx.nodeState !== 'stable' || isCriticalMass(ctx.entity);
  drawBasePrism(context, projection, palette, 1.3, highlighted, palette.glow);

  // Monolith crown
  drawMonolithCrownFixed(context, projection, palette, layout);

  // Minimal slit windows
  drawVerticalWindows(context, projection, 1, palette.window);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height + layout.tileHeight * 0.25, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.25 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawWarehouse(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  // Vent ridges on roof
  drawRoofVents(context, projection, palette.window);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.12 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

function drawMonolith(
  ctx: DrawBuildingContext,
  projection: ReturnType<typeof createPrismProjection>,
  palette: BuildingPalette,
  visuals: StateVisuals,
  height: number,
  baseZ: number,
): void {
  const { context, layout, phase } = ctx;
  drawBasePrism(context, projection, palette, 1.1, false, palette.glow);

  const topCenter = toScreen(ctx.display.x + 0.5, ctx.display.y + 0.5, baseZ + height, layout);
  drawGroundRing(context, { sx: projection.center.sx, sy: projection.center.sy + layout.tileHeight * 0.25 }, layout, visuals);
  drawBeacon(context, topCenter, layout, visuals);
  if (visuals.scaffold) drawScaffolding(context, projection, layout);
  if (isCriticalMass(ctx.entity)) drawCriticalMassHalo(context, projection, layout, phase);
}

// ─── Main Dispatcher ───

export function drawBuilding(ctx: DrawBuildingContext): void {
  const { entity, display, layout, nodeState, phase } = ctx;
  const archetype = getFileArchetype(entity);
  const palette = getFilePalette(entity);
  const footprint = getFileFootprint(entity);

  const baseHeight = entity.type === 'directory'
    ? 0.5
    : entity.type === 'wall'
      ? 1.0
      : entity.type === 'goal'
        ? 0.2
        : Math.min(6, Math.max(0.8, entity.mass * 0.5 + ((entity.content ?? entity.content_preview ?? '').split('\n').length / 40)));

  const height = getBuildingHeight(entity, baseHeight);

  const baseZ = entity.z ?? 0;

  const projection = createPrismProjection(
    display.x + ((1 - footprint.width) / 2),
    display.y + ((1 - footprint.depth) / 2),
    baseZ,
    footprint.width,
    footprint.depth,
    height,
    layout,
  );

  const visuals = getStateVisuals(nodeState, phase);

  switch (archetype) {
    case 'plaza':
      drawPlaza(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'skyscraper':
      drawSkyscraper(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'tower':
      drawTower(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'hut':
      drawHut(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'billboard':
      drawBillboard(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'pavilion':
      drawPavilion(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'archway':
      drawArchway(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'datacenter':
      drawDatacenter(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'factory':
      drawFactory(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'pyramid':
      drawPyramid(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'brutalist':
      drawBrutalist(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'warehouse':
      drawWarehouse(ctx, projection, palette, visuals, height, baseZ);
      break;
    case 'monolith':
    default:
      drawMonolith(ctx, projection, palette, visuals, height, baseZ);
      break;
  }
}
