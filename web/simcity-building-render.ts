import type { NodeState } from '../src/types';
import { isCriticalMass } from '../src/hivemind';
import type { Entity } from '../src/types';
import { getBuildingGeometry, getNodeStatePalette } from './building-geometry';
import { createPrismProjection, toScreen, traceFace, type IsoLayout, type ScreenPoint } from './iso';
import type { CityLayout } from './city-layout';
import { getFaceColors } from './sc2k-palette';
import { drawRooftopIdentity } from './rooftop-identity';

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

function getDaylight(phase: number): number {
  return 0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2));
}

function getNightFactor(phase: number): number {
  return 1 - getDaylight(phase);
}

function drawGroundShadow(
  context: CanvasRenderingContext2D,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  width: number,
  depth: number,
): void {
  // SC2K-style pre-baked ground shadow: soft oval offset to the southeast
  const shadowOffsetX = 0.22;
  const shadowOffsetY = 0.14;
  const shadowW = width * 1.25;
  const shadowD = depth * 1.25;

  const center = toScreen(
    displayX + ((1 - width) / 2) + (width / 2) + shadowOffsetX,
    displayY + ((1 - depth) / 2) + (depth / 2) + shadowOffsetY,
    0,
    layout,
  );

  const rx = layout.tileWidth * shadowW * 0.5;
  const ry = layout.tileHeight * shadowD * 0.35;

  context.save();
  context.globalAlpha = 0.18;
  context.fillStyle = '#1e293b';
  context.beginPath();
  context.ellipse(center.sx, center.sy, rx, ry, 0, 0, Math.PI * 2);
  context.fill();

  // Inner darker core for depth
  context.globalAlpha = 0.10;
  context.beginPath();
  context.ellipse(center.sx + rx * 0.1, center.sy + ry * 0.05, rx * 0.6, ry * 0.5, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawGroundLot(
  context: CanvasRenderingContext2D,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  width: number,
  depth: number,
  accent: string,
  _kind: string,
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
}

function drawDetailedWindows(
  context: CanvasRenderingContext2D,
  face: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
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

      const y1 = face[0].sy + ((face[3].sy - face[0].sy) * tLeft);
      const y2 = face[1].sy + ((face[2].sy - face[1].sy) * tLeft);
      const x1 = face[0].sx + ((face[3].sx - face[0].sx) * tLeft);
      const x2 = face[1].sx + ((face[2].sx - face[1].sx) * tLeft);

      const y3 = face[0].sy + ((face[3].sy - face[0].sy) * tRight);
      const y4 = face[1].sy + ((face[2].sy - face[1].sy) * tRight);
      const x3 = face[0].sx + ((face[3].sx - face[0].sx) * tRight);
      const x4 = face[1].sx + ((face[2].sx - face[1].sx) * tRight);

      const p1 = { sx: x1 + (x2 - x1) * tTop, sy: y1 + (y2 - y1) * tTop };
      const p2 = { sx: x3 + (x4 - x3) * tTop, sy: y3 + (y4 - y3) * tTop };
      const p3 = { sx: x3 + (x4 - x3) * tBottom, sy: y3 + (y4 - y3) * tBottom };
      const p4 = { sx: x1 + (x2 - x1) * tBottom, sy: y1 + (y2 - y1) * tBottom };

      context.beginPath();
      context.moveTo(p1.sx, p1.sy);
      context.lineTo(p2.sx, p2.sy);
      context.lineTo(p3.sx, p3.sy);
      context.lineTo(p4.sx, p4.sy);
      context.closePath();
      context.fill();

      const shouldBleed = warmNightWindows && isLit && Math.sin((randomSeed * 0.17) + (r * 19) + (c * 23)) > 0.6;
      if (shouldBleed) {
        const bleedCenterX = (p1.sx + p2.sx) / 2;
        const bleedTopY = Math.min(p1.sy, p2.sy);
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

function drawStateAccent(
  context: CanvasRenderingContext2D,
  topCenter: ScreenPoint,
  layout: IsoLayout,
  nodeState: string,
  phase: number,
  height?: number,
  projection?: ReturnType<typeof createPrismProjection>,
  nightFactor?: number,
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

  // SC2K pre-baked ground shadow (drawn before lot)
  drawGroundShadow(context, display.x, display.y, layout, footprint.width, footprint.depth);

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

      // Loading dock / bay door on right face (subtle dark grey, not black)
      const dockWidth = Math.min(0.35, footprint.depth * 0.25);
      const dockHeight = height * 0.22;
      const px1 = projection.right[3].sx + (projection.right[2].sx - projection.right[3].sx) * 0.35;
      const py1 = projection.right[3].sy + (projection.right[2].sy - projection.right[3].sy) * 0.35;
      context.fillStyle = '#334155';
      context.fillRect(px1, py1 - (layout.tileHeight * dockHeight), layout.tileWidth * dockWidth, layout.tileHeight * dockHeight);

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

      // Awning on right face
      const awningColor = geometry.palette.accent;
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

      // Service door on right face (subtle)
      context.fillStyle = '#475569';
      const dx = utilProj.right[3].sx + (utilProj.right[2].sx - utilProj.right[3].sx) * 0.5;
      const dy = utilProj.right[3].sy + (utilProj.right[2].sy - utilProj.right[3].sy) * 0.5;
      context.fillRect(dx - 2, dy - 8, 4, 8);
      break;
    }
  }

  // Rooftop identity details (antennas, HVAC, flags, etc.)
  drawRooftopIdentity(context, projection.top, layout, {
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
    drawStateAccent(context, topCenter, layout, nodeState, phase);
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
}
