import type { NodeState } from '../src/types';
import { isCriticalMass } from '../src/hivemind';
import type { Entity } from '../src/types';
import { getBuildingGeometry, getNodeStatePalette } from './building-geometry';
import { createPrismProjection, toScreen, traceFace, type IsoLayout, type ScreenPoint } from './iso';
import type { CityLayout } from './city-layout';
import { getFaceColors } from './sc2k-palette';
import { drawRooftopIdentity } from './rooftop-identity';
import { drawConditionOverlays, drawIvy } from './condition-renderer';
import { drawLotProps } from './lot-props';

export interface DrawBuildingContext {
  context: CanvasRenderingContext2D;
  entity: Entity;
  display: { x: number; y: number };
  layout: IsoLayout;
  phase: number;
  cityLayout: CityLayout;
  allEntities: Entity[];
  isSelected?: boolean;
}

type QuadFace = [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];

function snap(n: number): number {
  return Math.round(n);
}

function snapPoint(p: ScreenPoint): ScreenPoint {
  return { sx: snap(p.sx), sy: snap(p.sy) };
}

function snapFace(face: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  return [snapPoint(face[0]), snapPoint(face[1]), snapPoint(face[2]), snapPoint(face[3])];
}

function snapProjection(proj: ReturnType<typeof createPrismProjection>): ReturnType<typeof createPrismProjection> {
  return {
    center: snapPoint(proj.center),
    left: snapFace(proj.left),
    right: snapFace(proj.right),
    top: snapFace(proj.top),
  };
}

function createPrism(
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  layout: IsoLayout,
): ReturnType<typeof createPrismProjection> {
  return snapProjection(createPrismProjection(x, y, z, width, depth, height, layout));
}

function withAlpha(color: string, alpha: number): string {
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

function adjustLightness(color: string, amount: number): string {
  if (color.startsWith('#')) {
    let r = parseInt(color.slice(1, 3), 16);
    let g = parseInt(color.slice(3, 5), 16);
    let b = parseInt(color.slice(5, 7), 16);
    r = Math.max(0, Math.min(255, r + amount));
    g = Math.max(0, Math.min(255, g + amount));
    b = Math.max(0, Math.min(255, b + amount));
    return `rgb(${r}, ${g}, ${b})`;
  }
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return color;
  const r = Math.max(0, Math.min(255, parseInt(match[1]!) + amount));
  const g = Math.max(0, Math.min(255, parseInt(match[2]!) + amount));
  const b = Math.max(0, Math.min(255, parseInt(match[3]!) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function fillFace(
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

function interpolateFacePoint(face: QuadFace, u: number, v: number): ScreenPoint {
  const top = {
    sx: face[0].sx + ((face[1].sx - face[0].sx) * u),
    sy: face[0].sy + ((face[1].sy - face[0].sy) * u),
  };
  const bottom = {
    sx: face[3].sx + ((face[2].sx - face[3].sx) * u),
    sy: face[3].sy + ((face[2].sy - face[3].sy) * u),
  };

  return {
    sx: top.sx + ((bottom.sx - top.sx) * v),
    sy: top.sy + ((bottom.sy - top.sy) * v),
  };
}

function getFacePanel(face: QuadFace, u1: number, v1: number, u2: number, v2: number): QuadFace {
  return [
    interpolateFacePoint(face, u1, v1),
    interpolateFacePoint(face, u2, v1),
    interpolateFacePoint(face, u2, v2),
    interpolateFacePoint(face, u1, v2),
  ];
}

function drawFaceLine(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  startU: number,
  startV: number,
  endU: number,
  endV: number,
): void {
  const start = interpolateFacePoint(face, startU, startV);
  const end = interpolateFacePoint(face, endU, endV);
  context.beginPath();
  context.moveTo(start.sx, start.sy);
  context.lineTo(end.sx, end.sy);
  context.stroke();
}

function drawSurfacePanel(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  u1: number,
  v1: number,
  u2: number,
  v2: number,
  fill: string,
  stroke: string,
  lineWidth = 0.7,
): void {
  const panel = getFacePanel(face, u1, v1, u2, v2);
  fillFace(context, panel, fill, stroke, lineWidth);
}

function drawFacadeRibs(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  rows: number,
  cols: number,
  trim: string,
  strength = 0.18,
): void {
  context.save();
  context.lineWidth = 0.65;
  context.strokeStyle = withAlpha(trim, strength);

  for (let row = 1; row < rows; row += 1) {
    const v = row / rows;
    drawFaceLine(context, face, 0.04, v, 0.96, v);
  }

  for (let col = 1; col < cols; col += 1) {
    const u = col / cols;
    drawFaceLine(context, face, u, 0.04, u, 0.96);
  }

  context.strokeStyle = withAlpha(trim, strength + 0.12);
  context.lineWidth = 0.9;
  drawFaceLine(context, face, 0.02, 0.02, 0.02, 0.98);
  drawFaceLine(context, face, 0.98, 0.02, 0.98, 0.98);
  context.restore();
}

function drawRoofDeckDetails(
  context: CanvasRenderingContext2D,
  top: QuadFace,
  layout: IsoLayout,
  trim: string,
  accent: string,
  seed: number,
  density: number,
): void {
  context.save();

  context.strokeStyle = withAlpha(trim, 0.32 + (density * 0.16));
  context.lineWidth = 0.85;
  traceFace(context, top);
  context.stroke();

  const inner = getFacePanel(top, 0.08, 0.08, 0.92, 0.92);
  context.strokeStyle = withAlpha(trim, 0.18 + (density * 0.12));
  context.lineWidth = 0.7;
  traceFace(context, inner);
  context.stroke();

  const ribCount = Math.max(2, Math.min(6, Math.round(2 + density * 5)));
  context.strokeStyle = withAlpha(trim, 0.12 + (density * 0.1));
  for (let index = 1; index < ribCount; index += 1) {
    const t = index / ribCount;
    drawFaceLine(context, top, 0.12, t, 0.88, t);
  }

  const hatchU = 0.18 + ((seed % 5) * 0.08);
  const hatchV = 0.16 + ((seed % 7) * 0.06);
  drawSurfacePanel(
    context,
    top,
    Math.min(0.7, hatchU),
    Math.min(0.68, hatchV),
    Math.min(0.88, hatchU + 0.16),
    Math.min(0.86, hatchV + 0.12),
    withAlpha(adjustLightness(trim, -24), 0.66),
    withAlpha(trim, 0.45),
    0.75,
  );

  const ventCount = Math.max(1, Math.min(4, Math.round(1 + density * 3)));
  for (let index = 0; index < ventCount; index += 1) {
    const u = 0.2 + (((seed + index * 17) % 50) / 100);
    const v = 0.18 + (((seed + index * 23) % 48) / 100);
    const anchor = interpolateFacePoint(top, Math.min(0.78, u), Math.min(0.78, v));
    const radius = Math.max(1.6, layout.tileWidth * (0.018 + density * 0.008));
    context.fillStyle = withAlpha(adjustLightness(trim, -36), 0.74);
    context.beginPath();
    context.ellipse(anchor.sx, anchor.sy, radius * 1.7, radius, 0.15, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = withAlpha(accent, 0.28);
    context.lineWidth = 0.55;
    context.stroke();
  }

  context.restore();
}

function drawWallFaceDetails(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  trim: string,
  seed: number,
  intensity: number,
): void {
  context.save();
  const markCount = Math.max(1, Math.min(5, Math.round(1 + intensity * 5)));
  context.strokeStyle = withAlpha(trim, 0.12 + (intensity * 0.14));
  context.lineWidth = 0.65;

  for (let index = 0; index < markCount; index += 1) {
    const u = 0.16 + (((seed + index * 29) % 68) / 100);
    const v = 0.14 + (((seed + index * 31) % 70) / 100);
    const length = 0.06 + (((seed + index * 11) % 12) / 100);
    drawFaceLine(context, face, Math.min(0.9, u), v, Math.min(0.94, u + length), Math.min(0.96, v + length * 0.45));
  }

  context.restore();
}

function drawColonnade(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  columns: number,
  trim: string,
): void {
  context.save();
  context.strokeStyle = withAlpha(trim, 0.58);
  context.lineWidth = 1.2;

  for (let index = 0; index < columns; index += 1) {
    const u = (index + 0.5) / columns;
    drawFaceLine(context, face, u, 0.14, u, 0.92);
  }

  context.strokeStyle = withAlpha(trim, 0.34);
  context.lineWidth = 0.8;
  drawFaceLine(context, face, 0.08, 0.22, 0.92, 0.22);
  drawFaceLine(context, face, 0.08, 0.86, 0.92, 0.86);
  context.restore();
}

function drawStripedAwning(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  accent: string,
  trim: string,
): void {
  const awning = getFacePanel(face, 0.12, 0.52, 0.9, 0.72);
  context.save();
  fillFace(context, awning, withAlpha(accent, 0.9), withAlpha(trim, 0.58), 0.8);

  context.strokeStyle = withAlpha('#ffffff', 0.34);
  context.lineWidth = 1;
  for (let index = 1; index < 5; index += 1) {
    const u = index / 5;
    drawFaceLine(context, awning, u, 0.06, u, 0.94);
  }

  context.restore();
}

function drawIndustrialRoofline(
  context: CanvasRenderingContext2D,
  top: QuadFace,
  trim: string,
  seed: number,
): void {
  context.save();
  context.strokeStyle = withAlpha(trim, 0.42);
  context.lineWidth = 1;

  const rows = 2 + (seed % 2);
  for (let row = 0; row < rows; row += 1) {
    const v = 0.25 + row * 0.22;
    drawFaceLine(context, top, 0.1, v, 0.9, v);
    drawFaceLine(context, top, 0.1, v + 0.05, 0.9, v + 0.05);
  }

  context.restore();
}

function drawHazardStripes(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  trim: string,
): void {
  context.save();
  const band = getFacePanel(face, 0.08, 0.78, 0.92, 0.92);
  fillFace(context, band, withAlpha('#1f2937', 0.62), withAlpha(trim, 0.35), 0.6);
  context.strokeStyle = 'rgba(251, 191, 36, 0.72)';
  context.lineWidth = 1;

  for (let index = 0; index < 7; index += 1) {
    const u = index / 7;
    drawFaceLine(context, band, u, 0.95, Math.min(1, u + 0.18), 0.05);
  }

  context.restore();
}

function drawLotMarkings(
  context: CanvasRenderingContext2D,
  top: QuadFace,
  kind: string,
  accent: string,
): void {
  context.save();
  context.strokeStyle = withAlpha('#f8fafc', 0.18);
  context.lineWidth = 0.75;

  drawFaceLine(context, top, 0.08, 0.12, 0.92, 0.12);
  drawFaceLine(context, top, 0.08, 0.88, 0.92, 0.88);
  drawFaceLine(context, top, 0.12, 0.08, 0.12, 0.92);
  drawFaceLine(context, top, 0.88, 0.08, 0.88, 0.92);

  if (kind === 'factory' || kind === 'warehouse' || kind === 'substation') {
    context.strokeStyle = withAlpha('#fbbf24', 0.28);
    for (let index = 1; index < 4; index += 1) {
      const u = index / 4;
      drawFaceLine(context, top, u, 0.18, u, 0.82);
    }
  } else if (kind === 'shopfront') {
    context.strokeStyle = withAlpha(accent, 0.28);
    drawFaceLine(context, top, 0.18, 0.74, 0.82, 0.74);
    drawFaceLine(context, top, 0.3, 0.82, 0.7, 0.82);
  } else {
    context.strokeStyle = withAlpha(accent, 0.2);
    drawFaceLine(context, top, 0.5, 0.14, 0.5, 0.86);
    drawFaceLine(context, top, 0.14, 0.5, 0.86, 0.5);
  }

  context.restore();
}

function getLotPropMix(kind: string): Record<string, number> {
  switch (kind) {
    case 'factory':
      return { loading: 0.8, pallet: 0.65, utility: 0.4, fence: 0.45 };
    case 'warehouse':
      return { loading: 0.7, pallet: 0.75, parking: 0.45, dumpster: 0.35 };
    case 'shopfront':
      return { awning: 0.75, planter: 0.45, bench: 0.35, bike: 0.28 };
    case 'campus':
      return { bush: 0.7, bench: 0.5, planter: 0.45 };
    case 'civic':
      return { art: 0.6, planter: 0.5, bench: 0.45 };
    case 'substation':
      return { fence: 0.65, utility: 0.75, hvac: 0.45 };
    case 'landmark':
      return { art: 0.65, planter: 0.5, parking: 0.3 };
    case 'tower':
      return { parking: 0.45, planter: 0.35, mailbox: 0.25 };
    default:
      return {};
  }
}

function getDaylight(phase: number): number {
  return 0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2));
}

function getNightFactor(phase: number): number {
  return 1 - getDaylight(phase);
}

function drawGroundLot(
  context: CanvasRenderingContext2D,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  width: number,
  depth: number,
  accent: string,
  kind: string,
): void {
  const margin = 0.1;
  const lotProjection = createPrism(
    displayX + ((1 - width) / 2) - margin,
    displayY + ((1 - depth) / 2) - margin,
    0,
    width + (margin * 2),
    depth + (margin * 2),
    0.05,
    layout,
  );

  // SC2K-style asphalt/concrete lot with three-tone isometric shading
  const topColor = 'rgba(190, 195, 200, 0.92)';
  const leftColor = 'rgba(120, 125, 130, 0.95)';
  const rightColor = 'rgba(90, 95, 100, 0.98)';

  fillFace(context, lotProjection.left, leftColor, 'rgba(60, 65, 70, 0.7)');
  fillFace(context, lotProjection.right, rightColor, 'rgba(60, 65, 70, 0.7)');
  fillFace(context, lotProjection.top, topColor, withAlpha(accent, 0.18), 1.0);
  drawLotMarkings(context, lotProjection.top, kind, accent);
}

function drawDetailedWindows(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  rows: number,
  cols: number,
  windowColor: string,
  nightFactor: number,
  isLitPattern: (r: number, c: number) => boolean,
  windowWidthRatio = 0.6,
  windowHeightRatio = 0.6,
  randomSeed = 0,
): void {
  context.save();
  const warmNightWindows = nightFactor > 0.5;
  const faceLitColor = warmNightWindows
    ? withAlpha('#ffcc80', 0.82 + (nightFactor * 0.18))
    : withAlpha('#ffe599', 0.8 + (nightFactor * 0.2));
  const faceDarkColor = withAlpha(windowColor, 0.4 + (nightFactor * 0.4));
  const frameColor = withAlpha('#dbeafe', 0.18 + (nightFactor * 0.16));
  const sillColor = withAlpha('#020617', 0.22 + (nightFactor * 0.18));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isLit = isLitPattern(r, c) && nightFactor > 0.3;
      context.fillStyle = isLit ? faceLitColor : faceDarkColor;
      context.shadowColor = isLit
        ? (warmNightWindows ? 'rgba(255, 204, 128, 0.92)' : 'rgba(255, 229, 153, 0.8)')
        : 'transparent';
      context.shadowBlur = isLit
        ? (warmNightWindows ? 12 + (nightFactor * 10) : 8 * nightFactor)
        : 0;

      const tTop = (r + (1 - windowHeightRatio) / 2) / rows;
      const tBottom = (r + 1 - (1 - windowHeightRatio) / 2) / rows;
      const tLeft = (c + (1 - windowWidthRatio) / 2) / cols;
      const tRight = (c + 1 - (1 - windowWidthRatio) / 2) / cols;
      const panel = getFacePanel(face, tLeft, tTop, tRight, tBottom);

      traceFace(context, panel);
      context.fill();

      context.shadowBlur = 0;
      context.strokeStyle = frameColor;
      context.lineWidth = 0.55;
      context.stroke();

      if (windowWidthRatio >= 0.55) {
        context.strokeStyle = withAlpha('#0f172a', isLit ? 0.18 : 0.34);
        context.lineWidth = 0.45;
        drawFaceLine(context, panel, 0.5, 0.12, 0.5, 0.88);
      }

      if (((r + c + randomSeed) % 3) === 0 && windowHeightRatio >= 0.55) {
        context.strokeStyle = withAlpha('#0f172a', isLit ? 0.12 : 0.28);
        context.lineWidth = 0.4;
        drawFaceLine(context, panel, 0.12, 0.52, 0.88, 0.52);
      }

      const highlight = getFacePanel(panel, 0.1, 0.08, 0.9, 0.2);
      traceFace(context, highlight);
      context.fillStyle = withAlpha('#ffffff', isLit ? 0.18 : 0.08);
      context.fill();

      context.strokeStyle = sillColor;
      context.lineWidth = 0.65;
      drawFaceLine(context, face, tLeft, Math.min(0.98, tBottom + 0.015), tRight, Math.min(0.98, tBottom + 0.015));

      const shouldBleed = warmNightWindows && isLit && Math.sin((randomSeed * 0.17) + (r * 19) + (c * 23)) > 0.6;
      if (shouldBleed) {
        const bleedCenter = interpolateFacePoint(panel, 0.5, 0.08);
        const bleedCenterX = bleedCenter.sx;
        const bleedTopY = bleedCenter.sy;
        const bleedLength = 3 + Math.round(nightFactor * 2);
        const bleed = context.createLinearGradient(bleedCenterX, bleedTopY - bleedLength, bleedCenterX, bleedTopY);
        bleed.addColorStop(0, 'rgba(255, 204, 128, 0)');
        bleed.addColorStop(1, 'rgba(255, 204, 128, 0.45)');

        context.shadowBlur = 0;
        context.strokeStyle = bleed;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(bleedCenterX, bleedTopY - bleedLength);
        context.lineTo(bleedCenterX, bleedTopY);
        context.stroke();
      }
    }
  }
  context.restore();
}
function drawConstructionCrane(
  context: CanvasRenderingContext2D,
  topCenter: ScreenPoint,
  layout: IsoLayout,
  phase: number,
  height: number,
): void {
  const craneColor = '#f59e0b';
  const mastHeight = layout.tileHeight * Math.max(1.2, height * 1.5);
  const jibLength = layout.tileWidth * 1.5;
  const counterJibLength = layout.tileWidth * 0.6;

  const rotation = (phase * 0.05) % (Math.PI * 2);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  context.save();
  context.strokeStyle = craneColor;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(topCenter.sx, topCenter.sy);
  context.lineTo(topCenter.sx, topCenter.sy - mastHeight);
  context.stroke();

  const steps = Math.floor(mastHeight / 6);
  context.lineWidth = 0.8;
  context.beginPath();
  for (let i = 0; i < steps; i++) {
    const y1 = topCenter.sy - (i * 6);
    const y2 = topCenter.sy - ((i + 1) * 6);
    context.moveTo(topCenter.sx - 2, y1);
    context.lineTo(topCenter.sx + 2, y2);
    context.moveTo(topCenter.sx + 2, y1);
    context.lineTo(topCenter.sx - 2, y2);
  }
  context.stroke();

  const pivotY = topCenter.sy - mastHeight + 4;
  context.translate(topCenter.sx, pivotY);

  const isoScaleY = 0.5;

  context.strokeStyle = craneColor;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-counterJibLength * cos, -counterJibLength * sin * isoScaleY);
  context.lineTo(jibLength * cos, jibLength * sin * isoScaleY);
  context.stroke();

  const hookX = (jibLength * 0.8) * cos;
  const hookY = (jibLength * 0.8) * sin * isoScaleY;
  const dropLength = (layout.tileHeight * 0.5) + Math.sin(phase * 0.2) * (layout.tileHeight * 0.2);

  context.strokeStyle = '#94a3b8';
  context.beginPath();
  context.moveTo(hookX, hookY);
  context.lineTo(hookX, hookY + dropLength);
  context.stroke();

  context.fillStyle = '#1e293b';
  context.fillRect(hookX - 2, hookY + dropLength, 4, 4);

  context.fillStyle = '#475569';
  const cwX = (-counterJibLength * 0.8) * cos;
  const cwY = (-counterJibLength * 0.8) * sin * isoScaleY;
  context.fillRect(cwX - 3, cwY - 2, 6, 8);

  context.restore();
}

function drawScaffolding(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  nightFactor: number,
): void {
  const faces = [projection.left, projection.right];
  context.save();
  context.strokeStyle = `rgba(245, 158, 11, ${0.4 + (nightFactor * 0.2)})`;
  context.lineWidth = 1.0;

  for (const face of faces) {
    const w = Math.hypot(face[1].sx - face[0].sx, face[1].sy - face[0].sy);
    const h = Math.hypot(face[3].sx - face[0].sx, face[3].sy - face[0].sy);
    const cols = Math.max(2, Math.floor(w / 15));
    const rows = Math.max(2, Math.floor(h / 15));

    for (let r = 1; r < rows; r++) {
      const t = r / rows;
      const y1 = face[0].sy + ((face[3].sy - face[0].sy) * t);
      const x1 = face[0].sx + ((face[3].sx - face[0].sx) * t);
      const y2 = face[1].sy + ((face[2].sy - face[1].sy) * t);
      const x2 = face[1].sx + ((face[2].sx - face[1].sx) * t);
      context.beginPath();
      context.moveTo(x1 - 2, y1);
      context.lineTo(x2 - 2, y2);
      context.stroke();
    }

    for (let c = 1; c < cols; c++) {
      const t = c / cols;
      const xTop = face[0].sx + ((face[1].sx - face[0].sx) * t);
      const yTop = face[0].sy + ((face[1].sy - face[0].sy) * t);
      const xBottom = face[3].sx + ((face[2].sx - face[3].sx) * t);
      const yBottom = face[3].sy + ((face[2].sy - face[3].sy) * t);
      context.beginPath();
      context.moveTo(xTop - 2, yTop);
      context.lineTo(xBottom - 2, yBottom);
      context.stroke();
    }
  }

  for (const face of faces) {
    context.beginPath();
    context.moveTo(face[0].sx - 2, face[0].sy);
    context.lineTo(face[2].sx - 2, face[2].sy);
    context.stroke();
    context.beginPath();
    context.moveTo(face[1].sx - 2, face[1].sy);
    context.lineTo(face[3].sx - 2, face[3].sy);
    context.stroke();
  }

  context.restore();
}

function drawConstructionProgress(
  context: CanvasRenderingContext2D,
  face: QuadFace,
  progress: number,
  accent: string,
): void {
  const panel = getFacePanel(face, 0.12, 0.42, 0.88, 0.58);
  fillFace(context, panel, 'rgba(15, 23, 42, 0.55)', withAlpha(accent, 0.35), 0.7);

  const fillWidth = Math.max(0.04, progress * 0.76);
  const fillPanel = getFacePanel(face, 0.12, 0.46, 0.12 + fillWidth, 0.54);
  fillFace(context, fillPanel, withAlpha(accent, 0.72), withAlpha(accent, 0.45), 0.6);
}

function drawStateAccent(
  context: CanvasRenderingContext2D,
  topCenter: ScreenPoint,
  layout: IsoLayout,
  nodeState: string,
  phase: number,
  height?: number,
  projection?: ReturnType<typeof createPrismProjection>,
  nightFactor?: number,
  constructionMass = 0,
): void {
  const palette = getNodeStatePalette(nodeState);
  if (nodeState === 'stable') return;

  context.save();
  const pulse = 0.4 + (((phase % 12) / 12) * 0.55);

  if (nodeState === 'in-progress') {
    if (projection && nightFactor !== undefined) {
      drawScaffolding(context, projection, nightFactor);
    }
    drawConstructionCrane(context, topCenter, layout, phase, height ?? 1.0);

    const lightBlink = (phase % 10) > 5;
    if (lightBlink) {
      context.fillStyle = '#ef4444';
      context.shadowBlur = 8;
      context.shadowColor = '#ef4444';
      context.beginPath();
      context.arc(topCenter.sx, topCenter.sy, 2.5, 0, Math.PI * 2);
      context.fill();
    }
  } else if (nodeState === 'task' && constructionMass > 0 && projection && nightFactor !== undefined) {
    const progress = Math.min(1, constructionMass / 10);
    drawScaffolding(context, projection, nightFactor);
    if (progress < 1) {
      drawConstructionProgress(context, projection.left, progress, palette.accent);
    }

    const lightBlink = (phase % 14) > 7;
    if (lightBlink) {
      context.fillStyle = '#3b82f6';
      context.shadowBlur = 6;
      context.shadowColor = '#3b82f6';
      context.beginPath();
      context.arc(topCenter.sx, topCenter.sy, 2.2, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    context.beginPath();
    context.arc(topCenter.sx, topCenter.sy, layout.tileHeight * 0.22, 0, Math.PI * 2);
    context.fillStyle = withAlpha(palette.accent, 0.35 + (pulse * 0.35));
    context.shadowBlur = 16;
    context.shadowColor = withAlpha(palette.accent, 0.3 + (pulse * 0.3));
    context.fill();
  }
  context.restore();
}

function drawNeighborhoodPlaza(ctx: DrawBuildingContext): void {
  const { context, entity, display, layout } = ctx;
  const geometry = getBuildingGeometry(entity);
  const accent = geometry.palette.accent;

  const lotWidth = 0.9;
  const lotDepth = 0.9;

  const lotProjection = createPrism(
    display.x + ((1 - lotWidth) / 2),
    display.y + ((1 - lotDepth) / 2),
    0,
    lotWidth,
    lotDepth,
    0.06,
    layout,
  );

  fillFace(context, lotProjection.left, 'rgba(130, 170, 130, 0.9)', 'rgba(74, 85, 104, 0.45)');
  fillFace(context, lotProjection.right, 'rgba(110, 150, 110, 0.9)', 'rgba(74, 85, 104, 0.45)');
  fillFace(context, lotProjection.top, 'rgba(150, 190, 150, 0.82)', withAlpha(accent, 0.25), 1.2);
  drawSurfacePanel(
    context,
    lotProjection.top,
    0.43,
    0.08,
    0.57,
    0.92,
    'rgba(205, 213, 186, 0.52)',
    'rgba(90, 118, 92, 0.32)',
    0.7,
  );
  drawSurfacePanel(
    context,
    lotProjection.top,
    0.08,
    0.43,
    0.92,
    0.57,
    'rgba(205, 213, 186, 0.48)',
    'rgba(90, 118, 92, 0.3)',
    0.7,
  );

  context.save();
  const plazaTrees = [
    interpolateFacePoint(lotProjection.top, 0.2, 0.22),
    interpolateFacePoint(lotProjection.top, 0.8, 0.24),
    interpolateFacePoint(lotProjection.top, 0.22, 0.78),
    interpolateFacePoint(lotProjection.top, 0.78, 0.78),
  ];

  for (let index = 0; index < plazaTrees.length; index += 1) {
    const tree = plazaTrees[index];
    if (!tree) {
      continue;
    }

    context.fillStyle = 'rgba(101, 67, 33, 0.78)';
    context.fillRect(tree.sx - 1, tree.sy - layout.tileHeight * 0.18, 2, layout.tileHeight * 0.18);
    context.fillStyle = index % 2 === 0 ? 'rgba(34, 139, 68, 0.82)' : 'rgba(73, 156, 84, 0.82)';
    context.beginPath();
    context.arc(tree.sx, tree.sy - layout.tileHeight * 0.22, Math.max(3, layout.tileWidth * 0.055), 0, Math.PI * 2);
    context.fill();
  }

  const lamp = interpolateFacePoint(lotProjection.top, 0.5, 0.18);
  context.strokeStyle = 'rgba(71, 85, 105, 0.78)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(lamp.sx, lamp.sy);
  context.lineTo(lamp.sx, lamp.sy - layout.tileHeight * 0.34);
  context.stroke();
  context.fillStyle = withAlpha(accent, 0.9);
  context.shadowBlur = 8;
  context.shadowColor = accent;
  context.beginPath();
  context.arc(lamp.sx, lamp.sy - layout.tileHeight * 0.35, 2.4, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const wallProjection = createPrism(
    display.x + ((1 - lotWidth) / 2),
    display.y + ((1 - lotDepth) / 2),
    0,
    lotWidth,
    lotDepth,
    0.18,
    layout,
  );
  fillFace(context, wallProjection.left, 'rgba(160, 160, 160, 0.7)', 'rgba(100, 100, 100, 0.4)', 0.8);
  fillFace(context, wallProjection.right, 'rgba(140, 140, 140, 0.7)', 'rgba(100, 100, 100, 0.4)', 0.8);

  const center = lotProjection.center;
  context.save();
  context.fillStyle = '#8b5a2b';
  context.fillRect(center.sx - 1.5, center.sy - layout.tileHeight * 0.28, 3, layout.tileHeight * 0.28);
  context.fillStyle = withAlpha(accent, 0.92);
  context.fillRect(center.sx - 7, center.sy - layout.tileHeight * 0.38, 14, 9);
  context.strokeStyle = 'rgba(71, 85, 105, 0.6)';
  context.lineWidth = 0.8;
  context.strokeRect(center.sx - 7, center.sy - layout.tileHeight * 0.38, 14, 9);
  context.restore();
}
export function drawBuilding(ctx: DrawBuildingContext): void {
  const { context, entity, display, layout, phase } = ctx;
  const nodeState = (entity.node_state as NodeState | null | undefined) ?? 'stable';

  const isDirectory = entity.type === 'directory';
  if (isDirectory) {
    drawNeighborhoodPlaza(ctx);
    return;
  }

  const geometry = getBuildingGeometry(entity);
  const kind = geometry.archetype;
  const footprint = geometry.footprint;
  const height = geometry.height;
  const randomSeed = geometry.seed;

  const daylight = getDaylight(phase);
  const nightFactor = getNightFactor(phase);
  const statePalette = getNodeStatePalette(nodeState);
  const accent = nodeState === 'stable' ? geometry.palette.accent : statePalette.accent;
  const trim = nodeState === 'stable' ? geometry.palette.trim : statePalette.accent;
  const windowColor = withAlpha(geometry.palette.windowDark, 0.3 + (nightFactor * 0.75));

  drawGroundLot(context, display.x, display.y, layout, footprint.width, footprint.depth, accent, kind);

  const isLitPattern = (r: number, c: number) => {
    const v = Math.sin(randomSeed + r * 13 + c * 7);
    return v > 0;
  };

  // SC2K three-tone isometric lighting: warm left, cool right, bright top
  const faces = getFaceColors(geometry.palette.primary, daylight);
  const leftColor = faces.left;
  const rightColor = faces.right;
  const topColor = faces.top;

  const projection = createPrism(
    display.x + ((1 - footprint.width) / 2),
    display.y + ((1 - footprint.depth) / 2),
    entity.z ?? 0,
    footprint.width,
    footprint.depth,
    height,
    layout,
  );
  let roofFace: QuadFace = projection.top;

  drawLotProps(context, entity, display.x, display.y, layout, randomSeed, getLotPropMix(kind), geometry.importanceTier);

  context.save();
  context.shadowBlur = 10 + (nightFactor * 10);
  context.shadowColor = withAlpha(geometry.palette.accent, 0.15 + (nightFactor * 0.18));

  switch (kind) {
    case 'tower':
    case 'landmark': {
      const isHuge = kind === 'landmark';
      const floors = isHuge ? Math.max(6, Math.floor(height * 2.2)) : Math.max(3, Math.floor(height * 1.5));
      const cols = isHuge ? 5 : 4;
      const podiumHeight = height * (isHuge ? 0.18 : 0.24);
      const zBase = entity.z ?? 0;
      const baseX = display.x + ((1 - footprint.width) / 2);
      const baseY = display.y + ((1 - footprint.depth) / 2);
      const podiumProj = createPrism(
        baseX,
        baseY,
        zBase,
        footprint.width,
        footprint.depth,
        podiumHeight,
        layout,
      );
      fillFace(context, podiumProj.left, adjustLightness(leftColor, -30), withAlpha(trim, 0.42), 1);
      fillFace(context, podiumProj.right, adjustLightness(rightColor, -30), withAlpha(trim, 0.42), 1);
      fillFace(context, podiumProj.top, topColor, withAlpha(trim, 0.3), 1);
      drawDetailedWindows(context, podiumProj.left, 1, cols, windowColor, nightFactor, () => true, 0.8, 0.7, randomSeed);
      drawDetailedWindows(context, podiumProj.right, 1, cols, windowColor, nightFactor, () => true, 0.8, 0.7, randomSeed);
      drawFacadeRibs(context, podiumProj.left, 2, cols, trim, 0.2);
      drawFacadeRibs(context, podiumProj.right, 2, cols, trim, 0.2);

      if (isHuge) {
        const midScale = 0.8;
        const topScale = 0.6;
        const midHeight = height * 0.34;
        const topHeight = Math.max(0.25, height - podiumHeight - midHeight);
        const midX = baseX + ((footprint.width * (1 - midScale)) / 2);
        const midY = baseY + ((footprint.depth * (1 - midScale)) / 2);
        const midProj = createPrism(
          midX,
          midY,
          zBase + podiumHeight,
          footprint.width * midScale,
          footprint.depth * midScale,
          midHeight,
          layout,
        );
        const topX = baseX + ((footprint.width * (1 - topScale)) / 2);
        const topY = baseY + ((footprint.depth * (1 - topScale)) / 2);
        const topProj = createPrism(
          topX,
          topY,
          zBase + podiumHeight + midHeight,
          footprint.width * topScale,
          footprint.depth * topScale,
          topHeight,
          layout,
        );

        fillFace(context, midProj.left, leftColor, withAlpha(trim, 0.32), 1);
        fillFace(context, midProj.right, rightColor, withAlpha(trim, 0.32), 1);
        fillFace(context, midProj.top, topColor, withAlpha(trim, 0.2), 1);
        drawDetailedWindows(
          context,
          midProj.left,
          Math.max(4, Math.floor(floors * 0.5)),
          cols,
          windowColor,
          nightFactor,
          isLitPattern,
          0.58,
          0.6,
          randomSeed,
        );
        drawDetailedWindows(
          context,
          midProj.right,
          Math.max(4, Math.floor(floors * 0.5)),
          cols,
          windowColor,
          nightFactor,
          isLitPattern,
          0.58,
          0.6,
          randomSeed,
        );
        drawFacadeRibs(context, midProj.left, Math.max(4, Math.floor(floors * 0.5)), cols, trim, 0.16);
        drawFacadeRibs(context, midProj.right, Math.max(4, Math.floor(floors * 0.5)), cols, trim, 0.16);

        fillFace(context, topProj.left, adjustLightness(leftColor, 10), withAlpha(trim, 0.32), 1);
        fillFace(context, topProj.right, adjustLightness(rightColor, 10), withAlpha(trim, 0.32), 1);
        fillFace(context, topProj.top, adjustLightness(topColor, 10), withAlpha(trim, 0.2), 1);
        drawDetailedWindows(
          context,
          topProj.left,
          Math.max(3, Math.floor(floors * 0.35)),
          Math.max(3, cols - 1),
          windowColor,
          nightFactor,
          isLitPattern,
          0.56,
          0.58,
          randomSeed,
        );
        drawDetailedWindows(
          context,
          topProj.right,
          Math.max(3, Math.floor(floors * 0.35)),
          Math.max(3, cols - 1),
          windowColor,
          nightFactor,
          isLitPattern,
          0.56,
          0.58,
          randomSeed,
        );
        drawFacadeRibs(context, topProj.left, Math.max(3, Math.floor(floors * 0.35)), Math.max(3, cols - 1), trim, 0.18);
        drawFacadeRibs(context, topProj.right, Math.max(3, Math.floor(floors * 0.35)), Math.max(3, cols - 1), trim, 0.18);
        roofFace = topProj.top;
      } else {
        const towerScale = 0.88;
        const towerProj = createPrism(
          baseX + ((footprint.width * (1 - towerScale)) / 2),
          baseY + ((footprint.depth * (1 - towerScale)) / 2),
          zBase + podiumHeight,
          footprint.width * towerScale,
          footprint.depth * towerScale,
          height - podiumHeight,
          layout,
        );

        fillFace(context, towerProj.left, leftColor, withAlpha(trim, 0.3), 1);
        fillFace(context, towerProj.right, rightColor, withAlpha(trim, 0.3), 1);
        fillFace(context, towerProj.top, topColor, withAlpha(trim, 0.2), 1);
        drawDetailedWindows(context, towerProj.left, floors, cols, windowColor, nightFactor, isLitPattern, 0.6, 0.62, randomSeed);
        drawDetailedWindows(context, towerProj.right, floors, cols, windowColor, nightFactor, isLitPattern, 0.6, 0.62, randomSeed);
        drawFacadeRibs(context, towerProj.left, floors, cols, trim, 0.16);
        drawFacadeRibs(context, towerProj.right, floors, cols, trim, 0.16);
        roofFace = towerProj.top;
      }
      break;
    }

    case 'factory':
    case 'warehouse': {
      // SC2K-style industrial silhouette: tall box with loading dock
      fillFace(context, projection.left, leftColor, withAlpha(trim, 0.35), 1);
      fillFace(context, projection.right, rightColor, withAlpha(trim, 0.35), 1);
      fillFace(context, projection.top, topColor, withAlpha(trim, 0.25), 1);

      drawDetailedWindows(context, projection.left, 2, 4, windowColor, nightFactor, isLitPattern, 0.5, 0.4, randomSeed);
      drawDetailedWindows(context, projection.right, 2, 4, windowColor, nightFactor, isLitPattern, 0.5, 0.4, randomSeed);
      drawFacadeRibs(context, projection.left, 3, 5, trim, 0.15);
      drawFacadeRibs(context, projection.right, 3, 5, trim, 0.15);
      drawWallFaceDetails(context, projection.left, trim, randomSeed, geometry.conditionFactor + 0.35);
      drawWallFaceDetails(context, projection.right, trim, randomSeed + 5, geometry.conditionFactor + 0.35);
      drawIndustrialRoofline(context, projection.top, trim, randomSeed);

      // Loading dock / bay door on right face (subtle dark grey, not black)
      const dockWidth = Math.min(0.35, footprint.depth * 0.25);
      const dockHeight = height * 0.22;
      const px1 = projection.right[3].sx + (projection.right[2].sx - projection.right[3].sx) * 0.35;
      const py1 = projection.right[3].sy + (projection.right[2].sy - projection.right[3].sy) * 0.35;
      context.fillStyle = '#334155';
      context.fillRect(px1, py1 - (layout.tileHeight * dockHeight), layout.tileWidth * dockWidth, layout.tileHeight * dockHeight);
      context.strokeStyle = withAlpha(trim, 0.28);
      context.lineWidth = 0.7;
      for (let line = 1; line < 4; line += 1) {
        const y = py1 - (layout.tileHeight * dockHeight * (line / 4));
        context.beginPath();
        context.moveTo(px1, y);
        context.lineTo(px1 + (layout.tileWidth * dockWidth), y);
        context.stroke();
      }

      if (kind === 'factory') {
        // Smokestack
        const top = projection.top;
        const xStack = top[0].sx + (top[1].sx - top[0].sx) * 0.7;
        const yStack = top[0].sy + (top[1].sy - top[0].sy) * 0.7;

        context.fillStyle = '#52525b';
        context.fillRect(xStack - 3, yStack - layout.tileHeight * 1.2, 6, layout.tileHeight * 1.2);

        // Smoke puffs
        context.fillStyle = 'rgba(200, 200, 200, 0.35)';
        context.beginPath();
        context.arc(xStack + (Math.sin(phase / 5) * 5), yStack - layout.tileHeight * 1.5, 6 + (phase % 10) / 2, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(xStack + 5 + (Math.sin(phase / 7) * 5), yStack - layout.tileHeight * 1.8, 8 + (phase % 10) / 2, 0, Math.PI * 2);
        context.fill();
      }
      roofFace = projection.top;
      break;
    }

    case 'civic':
    case 'campus': {
      // SC2K-style civic silhouette: colonnade podium + main block
      const civicScale = 0.88;
      const podiumH = height * 0.22;
      const baseX = display.x + ((1 - footprint.width) / 2);
      const baseY = display.y + ((1 - footprint.depth) / 2);
      const zBase = entity.z ?? 0;

      const civicPodium = createPrism(
        baseX,
        baseY,
        zBase,
        footprint.width,
        footprint.depth,
        podiumH,
        layout,
      );
      fillFace(context, civicPodium.left, adjustLightness(leftColor, -20), withAlpha(trim, 0.4), 1);
      fillFace(context, civicPodium.right, adjustLightness(rightColor, -20), withAlpha(trim, 0.4), 1);
      fillFace(context, civicPodium.top, adjustLightness(topColor, -15), withAlpha(trim, 0.3), 1);
      drawColonnade(context, civicPodium.left, kind === 'civic' ? 5 : 4, trim);
      drawColonnade(context, civicPodium.right, kind === 'civic' ? 5 : 4, trim);

      const civicBlock = createPrism(
        baseX + ((footprint.width * (1 - civicScale)) / 2),
        baseY + ((footprint.depth * (1 - civicScale)) / 2),
        zBase + podiumH,
        footprint.width * civicScale,
        footprint.depth * civicScale,
        height - podiumH,
        layout,
      );
      fillFace(context, civicBlock.left, leftColor, withAlpha(trim, 0.3), 1);
      fillFace(context, civicBlock.right, rightColor, withAlpha(trim, 0.3), 1);
      fillFace(context, civicBlock.top, topColor, withAlpha(trim, 0.2), 1);

      if (kind === 'civic') {
        // Dome / rotunda on roof
        const domeRadius = layout.tileWidth * 0.3;
        context.beginPath();
        context.ellipse(civicBlock.center.sx, civicBlock.center.sy, domeRadius, domeRadius * 0.5, 0, Math.PI, 0);
        context.fillStyle = adjustLightness(rightColor, 20);
        context.fill();
        context.strokeStyle = trim;
        context.lineWidth = 1;
        context.stroke();
      }

      drawDetailedWindows(context, civicBlock.left, 2, 4, windowColor, nightFactor, isLitPattern, 0.5, 0.5, randomSeed);
      drawDetailedWindows(context, civicBlock.right, 2, 4, windowColor, nightFactor, isLitPattern, 0.5, 0.5, randomSeed);
      drawFacadeRibs(context, civicBlock.left, 3, 4, trim, 0.16);
      drawFacadeRibs(context, civicBlock.right, 3, 4, trim, 0.16);
      drawWallFaceDetails(context, civicBlock.left, trim, randomSeed, geometry.conditionFactor + 0.15);
      drawWallFaceDetails(context, civicBlock.right, trim, randomSeed + 9, geometry.conditionFactor + 0.15);
      roofFace = civicBlock.top;
      break;
    }

    case 'shopfront': {
      // SC2K-style shopfront: podium base + setback upper floor + awning
      const shopScale = 0.92;
      const shopPodiumH = height * 0.35;
      const baseX = display.x + ((1 - footprint.width) / 2);
      const baseY = display.y + ((1 - footprint.depth) / 2);
      const zBase = entity.z ?? 0;

      const podiumProj = createPrism(
        baseX,
        baseY,
        zBase,
        footprint.width,
        footprint.depth,
        shopPodiumH,
        layout,
      );
      fillFace(context, podiumProj.left, adjustLightness(leftColor, -15), withAlpha(trim, 0.35), 1);
      fillFace(context, podiumProj.right, adjustLightness(rightColor, -15), withAlpha(trim, 0.35), 1);
      fillFace(context, podiumProj.top, adjustLightness(topColor, -10), withAlpha(trim, 0.25), 1);

      const shopProj = createPrism(
        baseX + ((footprint.width * (1 - shopScale)) / 2),
        baseY + ((footprint.depth * (1 - shopScale)) / 2),
        zBase + shopPodiumH,
        footprint.width * shopScale,
        footprint.depth * shopScale,
        height - shopPodiumH,
        layout,
      );
      fillFace(context, shopProj.left, leftColor, withAlpha(trim, 0.3), 1);
      fillFace(context, shopProj.right, rightColor, withAlpha(trim, 0.3), 1);
      fillFace(context, shopProj.top, topColor, withAlpha(trim, 0.2), 1);

      drawDetailedWindows(context, shopProj.left, 2, 3, windowColor, nightFactor, isLitPattern, 0.6, 0.6, randomSeed);
      drawDetailedWindows(context, shopProj.right, 1, 1, windowColor, nightFactor, () => true, 0.9, 0.6, randomSeed);
      drawFacadeRibs(context, shopProj.left, 2, 3, trim, 0.16);
      drawWallFaceDetails(context, shopProj.left, trim, randomSeed, geometry.conditionFactor + 0.18);

      // Awning on right face
      const awningColor = geometry.palette.accent;
      drawSurfacePanel(
        context,
        shopProj.right,
        0.16,
        0.26,
        0.86,
        0.4,
        withAlpha(adjustLightness(trim, -18), 0.66),
        withAlpha(trim, 0.46),
        0.8,
      );
      drawStripedAwning(context, shopProj.right, awningColor, trim);
      context.fillStyle = awningColor;
      context.beginPath();
      const hX1 = shopProj.right[0].sx + (shopProj.right[1].sx - shopProj.right[0].sx) * 0.2;
      const hY1 = shopProj.right[0].sy + (shopProj.right[1].sy - shopProj.right[0].sy) * 0.2;
      const hX2 = shopProj.right[3].sx + (shopProj.right[2].sx - shopProj.right[3].sx) * 0.8;
      const hY2 = shopProj.right[3].sy + (shopProj.right[2].sy - shopProj.right[3].sy) * 0.8;
      context.moveTo(hX1, hY1);
      context.lineTo(hX2, hY2);
      context.lineTo(hX2 - 6, hY2 + 10);
      context.lineTo(hX1 - 6, hY1 + 10);
      context.closePath();
      context.fill();
      context.strokeStyle = withAlpha(trim, 0.5);
      context.lineWidth = 0.8;
      context.stroke();
      roofFace = shopProj.top;
      break;
    }

    case 'substation':
    default: {
      // SC2K-style utility building: squat box with equipment pad
      const utilScale = 0.95;
      const padH = height * 0.15;
      const baseX = display.x + ((1 - footprint.width) / 2);
      const baseY = display.y + ((1 - footprint.depth) / 2);
      const zBase = entity.z ?? 0;

      const padProj = createPrism(
        baseX,
        baseY,
        zBase,
        footprint.width,
        footprint.depth,
        padH,
        layout,
      );
      fillFace(context, padProj.left, adjustLightness(leftColor, -25), withAlpha(trim, 0.4), 1);
      fillFace(context, padProj.right, adjustLightness(rightColor, -25), withAlpha(trim, 0.4), 1);
      fillFace(context, padProj.top, adjustLightness(topColor, -20), withAlpha(trim, 0.3), 1);

      const utilProj = createPrism(
        baseX + ((footprint.width * (1 - utilScale)) / 2),
        baseY + ((footprint.depth * (1 - utilScale)) / 2),
        zBase + padH,
        footprint.width * utilScale,
        footprint.depth * utilScale,
        height - padH,
        layout,
      );
      fillFace(context, utilProj.left, leftColor, withAlpha(trim, 0.3), 1);
      fillFace(context, utilProj.right, rightColor, withAlpha(trim, 0.3), 1);
      fillFace(context, utilProj.top, topColor, withAlpha(trim, 0.2), 1);

      drawDetailedWindows(context, utilProj.left, 2, 2, windowColor, nightFactor, isLitPattern, 0.4, 0.5, randomSeed);
      drawDetailedWindows(context, utilProj.right, 2, 2, windowColor, nightFactor, isLitPattern, 0.4, 0.5, randomSeed);
      drawFacadeRibs(context, utilProj.left, 2, 3, trim, 0.18);
      drawFacadeRibs(context, utilProj.right, 2, 3, trim, 0.18);
      drawWallFaceDetails(context, utilProj.left, trim, randomSeed, geometry.conditionFactor + 0.2);
      drawWallFaceDetails(context, utilProj.right, trim, randomSeed + 7, geometry.conditionFactor + 0.2);
      drawHazardStripes(context, utilProj.right, trim);

      // Service door on right face (subtle)
      context.fillStyle = '#475569';
      const dx = utilProj.right[3].sx + (utilProj.right[2].sx - utilProj.right[3].sx) * 0.5;
      const dy = utilProj.right[3].sy + (utilProj.right[2].sy - utilProj.right[3].sy) * 0.5;
      context.fillRect(dx - 2, dy - 8, 4, 8);
      roofFace = utilProj.top;
      break;
    }
  }

  drawRoofDeckDetails(
    context,
    roofFace,
    layout,
    trim,
    accent,
    randomSeed,
    Math.min(1, 0.18 + geometry.ornamentation + geometry.activityLevel * 0.28),
  );
  drawConditionOverlays(context, entity, projection, layout, geometry.condition, randomSeed);
  drawIvy(
    context,
    projection,
    layout,
    kind === 'campus' ? 0.14 + (geometry.activityLevel * 0.12) : Math.max(0, (geometry.conditionFactor - 0.45) * 0.36),
    randomSeed,
  );

  // Rooftop identity details (antennas, HVAC, flags, etc.)
  drawRooftopIdentity(context, roofFace, layout, {
    archetype: kind,
    importanceTier: geometry.importanceTier,
    upgradeLevel: geometry.upgradeLevel,
    seed: randomSeed,
    accent,
    trim,
  }, phase);

  context.restore();

  if (nodeState !== 'stable') {
    const topCenter = toScreen(display.x + 0.5, display.y + 0.5, (entity.z ?? 0) + height, layout);
    drawStateAccent(context, topCenter, layout, nodeState, phase, height, projection, nightFactor, entity.construction_mass ?? 0);
  }

  if (isCriticalMass(entity)) {
    context.save();
    context.beginPath();
    context.ellipse(projection.center.sx, projection.center.sy, layout.tileWidth * 0.35, layout.tileHeight * 0.22, 0, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    context.lineWidth = 1.8;
    context.shadowBlur = 14;
    context.shadowColor = 'rgba(251, 191, 36, 0.35)';
    context.stroke();
    context.restore();
  }

  // File name label above the building
  const label = entity.name ?? entity.path ?? '';
  if (label.length > 0 && label !== '.') {
    const labelPoint = toScreen(display.x + 0.5, display.y + 0.5, (entity.z ?? 0) + height + 0.35, layout);
    const fontSize = Math.max(8, Math.min(13, layout.tileHeight * 0.38));
    context.save();
    context.font = `${fontSize}px var(--mono, monospace)`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    const textWidth = context.measureText(label).width;
    const padding = 5;
    const bgHeight = fontSize + 5;
    const bgY = labelPoint.sy - bgHeight;
    context.fillStyle = 'rgba(8, 12, 20, 0.82)';
    context.beginPath();
    context.roundRect(labelPoint.sx - (textWidth / 2) - padding, bgY, textWidth + (padding * 2), bgHeight, 4);
    context.fill();
    context.fillStyle = 'rgba(200, 220, 255, 0.92)';
    context.fillText(label, labelPoint.sx, labelPoint.sy - 2);
    context.restore();
  }
}
