import type { HivemindNodeState } from '../src/hivemind';
import { isCriticalMass } from '../src/hivemind';
import type { Entity } from '../src/types';
import { getBuildingStyle, getNodeStatePalette } from './building-styles';
import { createPrismProjection, toScreen, traceFace, type IsoLayout, type ScreenPoint } from './iso';
import { getFileFootprint } from './file-colors';
import { getBuildingProfile } from './city-layout';

export interface DrawBuildingContext {
  context: CanvasRenderingContext2D;
  entity: Entity;
  display: { x: number; y: number };
  layout: IsoLayout;
  phase: number;
  nodeState: HivemindNodeState;
}

type RenderedBuildingKind = ReturnType<typeof getBuildingProfile>['type'];
type RoofStyle = ReturnType<typeof getBuildingStyle>['roofStyle'];

interface RoofClutterOptions {
  accent: string;
  kind: RenderedBuildingKind;
  roofStyle: RoofStyle;
  seed: number;
  trim: string;
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

function interpolateTopPoint(
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  u: number,
  v: number,
): ScreenPoint {
  return {
    sx: top[0].sx + ((top[1].sx - top[0].sx) * u) + ((top[3].sx - top[0].sx) * v),
    sy: top[0].sy + ((top[1].sy - top[0].sy) * u) + ((top[3].sy - top[0].sy) * v),
  };
}

function drawRoofBox(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  {
    depth,
    height,
    leftColor,
    rightColor,
    stroke,
    topColor,
    u,
    v,
    width,
  }: {
    depth: number;
    height: number;
    leftColor: string;
    rightColor: string;
    stroke: string;
    topColor: string;
    u: number;
    v: number;
    width: number;
  },
): void {
  const origin = interpolateTopPoint(top, u, v);
  const uVector = {
    sx: (top[1].sx - top[0].sx) * width,
    sy: (top[1].sy - top[0].sy) * width,
  };
  const vVector = {
    sx: (top[3].sx - top[0].sx) * depth,
    sy: (top[3].sy - top[0].sy) * depth,
  };
  const base = [
    origin,
    { sx: origin.sx + uVector.sx, sy: origin.sy + uVector.sy },
    { sx: origin.sx + uVector.sx + vVector.sx, sy: origin.sy + uVector.sy + vVector.sy },
    { sx: origin.sx + vVector.sx, sy: origin.sy + vVector.sy },
  ] as const;
  const lift = layout.tileHeight * height;
  const raised = base.map((point) => ({ sx: point.sx, sy: point.sy - lift })) as [
    ScreenPoint,
    ScreenPoint,
    ScreenPoint,
    ScreenPoint,
  ];

  fillFace(context, [raised[3], raised[0], base[0], base[3]], leftColor, stroke, 0.8);
  fillFace(context, [raised[1], raised[2], base[2], base[1]], rightColor, stroke, 0.8);
  fillFace(context, [...raised], topColor, stroke, 0.8);
}

function drawWaterTower(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  seed: number,
): void {
  const anchor = interpolateTopPoint(top, 0.2 + ((seed % 2) * 0.22), 0.2 + (((seed >> 1) % 2) * 0.16));
  const legSpread = layout.tileWidth * 0.045;
  const towerHeight = layout.tileHeight * 0.95;
  const tankY = anchor.sy - (towerHeight * 0.7);

  context.save();
  context.strokeStyle = 'rgba(71, 85, 105, 0.9)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(anchor.sx - legSpread, anchor.sy);
  context.lineTo(anchor.sx - (legSpread * 0.6), tankY + 2);
  context.moveTo(anchor.sx + legSpread, anchor.sy);
  context.lineTo(anchor.sx + (legSpread * 0.6), tankY + 2);
  context.moveTo(anchor.sx, anchor.sy);
  context.lineTo(anchor.sx, tankY + 2);
  context.stroke();

  context.fillStyle = 'rgba(203, 213, 225, 0.95)';
  context.beginPath();
  context.ellipse(anchor.sx, tankY, layout.tileWidth * 0.12, layout.tileHeight * 0.16, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(100, 116, 139, 0.9)';
  context.beginPath();
  context.ellipse(anchor.sx, tankY + (layout.tileHeight * 0.04), layout.tileWidth * 0.12, layout.tileHeight * 0.05, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawAntennaCluster(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  accent: string,
): void {
  const anchors: [ScreenPoint, ScreenPoint, ScreenPoint] = [
    interpolateTopPoint(top, 0.58, 0.2),
    interpolateTopPoint(top, 0.68, 0.24),
    interpolateTopPoint(top, 0.5, 0.3),
  ];

  context.save();
  context.strokeStyle = withAlpha(accent, 0.72);
  context.lineWidth = 1.1;

  anchors.forEach((anchor, index) => {
    const mastHeight = layout.tileHeight * (0.45 + (index * 0.14));
    context.beginPath();
    context.moveTo(anchor.sx, anchor.sy);
    context.lineTo(anchor.sx, anchor.sy - mastHeight);
    context.stroke();

    const barY = anchor.sy - (mastHeight * 0.55);
    context.beginPath();
    context.moveTo(anchor.sx - 3, barY);
    context.lineTo(anchor.sx + 3, barY);
    context.stroke();
  });

  context.fillStyle = 'rgba(248, 113, 113, 0.95)';
  context.beginPath();
  context.arc(anchors[1].sx, anchors[1].sy - (layout.tileHeight * 0.75), 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawCommunicationRing(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  accent: string,
): void {
  const center = interpolateTopPoint(top, 0.52, 0.42);

  context.save();
  context.strokeStyle = withAlpha(accent, 0.6);
  context.lineWidth = 1;
  context.beginPath();
  context.ellipse(center.sx, center.sy - (layout.tileHeight * 0.34), layout.tileWidth * 0.12, layout.tileHeight * 0.08, 0, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.ellipse(center.sx, center.sy - (layout.tileHeight * 0.5), layout.tileWidth * 0.08, layout.tileHeight * 0.05, 0, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawRooftopSign(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  accent: string,
  trim: string,
): void {
  const left = interpolateTopPoint(top, 0.18, 0.08);
  const right = interpolateTopPoint(top, 0.52, 0.08);
  const depthOffset = {
    sx: (top[3].sx - top[0].sx) * 0.07,
    sy: (top[3].sy - top[0].sy) * 0.07,
  };
  const panelHeight = layout.tileHeight * 0.42;

  const panel: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] = [
    { sx: left.sx, sy: left.sy - panelHeight },
    { sx: right.sx, sy: right.sy - panelHeight },
    { sx: right.sx + depthOffset.sx, sy: right.sy + depthOffset.sy - panelHeight },
    { sx: left.sx + depthOffset.sx, sy: left.sy + depthOffset.sy - panelHeight },
  ];

  context.save();
  context.strokeStyle = 'rgba(71, 85, 105, 0.85)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left.sx, left.sy);
  context.lineTo(left.sx, left.sy - (panelHeight * 0.88));
  context.moveTo(right.sx, right.sy);
  context.lineTo(right.sx, right.sy - (panelHeight * 0.88));
  context.stroke();

  traceFace(context, panel);
  context.fillStyle = withAlpha(accent, 0.88);
  context.fill();
  context.strokeStyle = withAlpha(trim, 0.75);
  context.stroke();

  context.strokeStyle = 'rgba(255, 244, 214, 0.7)';
  context.beginPath();
  context.moveTo(panel[0].sx + 3, panel[0].sy + 3);
  context.lineTo(panel[1].sx - 3, panel[1].sy + 1);
  context.stroke();
  context.restore();
}

function drawFlagPole(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  accent: string,
): void {
  const anchor = interpolateTopPoint(top, 0.7, 0.25);
  const mastHeight = layout.tileHeight * 0.9;

  context.save();
  context.strokeStyle = 'rgba(71, 85, 105, 0.95)';
  context.lineWidth = 1.1;
  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy);
  context.lineTo(anchor.sx, anchor.sy - mastHeight);
  context.stroke();

  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy - mastHeight + 2);
  context.lineTo(anchor.sx + (layout.tileWidth * 0.12), anchor.sy - mastHeight + 5);
  context.lineTo(anchor.sx, anchor.sy - mastHeight + 10);
  context.closePath();
  context.fillStyle = withAlpha(accent, 0.9);
  context.fill();
  context.restore();
}

function drawClockTower(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  trim: string,
): void {
  drawRoofBox(context, top, layout, {
    u: 0.38,
    v: 0.3,
    width: 0.16,
    depth: 0.16,
    height: 0.58,
    topColor: 'rgba(241, 245, 249, 0.96)',
    leftColor: 'rgba(203, 213, 225, 0.98)',
    rightColor: 'rgba(226, 232, 240, 0.98)',
    stroke: withAlpha(trim, 0.5),
  });

  const faceCenter = interpolateTopPoint(top, 0.46, 0.38);
  context.save();
  context.fillStyle = 'rgba(248, 250, 252, 0.95)';
  context.beginPath();
  context.arc(faceCenter.sx, faceCenter.sy - (layout.tileHeight * 0.36), layout.tileWidth * 0.045, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(71, 85, 105, 0.95)';
  context.lineWidth = 0.9;
  context.stroke();
  context.beginPath();
  context.moveTo(faceCenter.sx, faceCenter.sy - (layout.tileHeight * 0.36));
  context.lineTo(faceCenter.sx, faceCenter.sy - (layout.tileHeight * 0.39));
  context.moveTo(faceCenter.sx, faceCenter.sy - (layout.tileHeight * 0.36));
  context.lineTo(faceCenter.sx + 2, faceCenter.sy - (layout.tileHeight * 0.35));
  context.stroke();
  context.restore();
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
  _kind: string,
): void {
  // Consistent small margin for all building types so lots align neatly
  const margin = 0.1;
  const lotProjection = createPrismProjection(
    displayX + ((1 - width) / 2) - margin,
    displayY + ((1 - depth) / 2) - margin,
    0,
    width + (margin * 2),
    depth + (margin * 2),
    0.05,
    layout,
  );

  // Concrete sidewalk slab — neutral, consistent for all types
  const topColor = 'rgba(180, 190, 200, 0.9)';
  const leftColor = 'rgba(100, 110, 120, 0.95)';
  const rightColor = 'rgba(80, 90, 100, 0.98)';

  fillFace(context, lotProjection.left, leftColor, 'rgba(74, 85, 104, 0.85)');
  fillFace(context, lotProjection.right, rightColor, 'rgba(74, 85, 104, 0.85)');
  fillFace(context, lotProjection.top, topColor, withAlpha(accent, 0.2), 1.0);
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

function drawRoofClutter(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  layout: IsoLayout,
  options: RoofClutterOptions,
): void {
  const top = projection.top;
  const acPalette = {
    topColor: 'rgba(226, 232, 240, 0.96)',
    leftColor: 'rgba(148, 163, 184, 0.98)',
    rightColor: 'rgba(203, 213, 225, 0.98)',
    stroke: 'rgba(71, 85, 105, 0.6)',
  };

  const drawAcUnit = (u: number, v: number, width = 0.12, depth = 0.1, height = 0.18) => {
    drawRoofBox(context, top, layout, {
      u,
      v,
      width,
      depth,
      height,
      ...acPalette,
    });

    const fanCenter = interpolateTopPoint(top, u + (width / 2), v + (depth / 2));
    context.save();
    context.fillStyle = 'rgba(30, 41, 59, 0.92)';
    context.beginPath();
    context.ellipse(fanCenter.sx, fanCenter.sy - (layout.tileHeight * height), layout.tileWidth * 0.028, layout.tileHeight * 0.03, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  switch (options.kind) {
    case 'factory':
    case 'warehouse':
      drawAcUnit(0.18, 0.18, 0.14, 0.1, 0.18);
      drawAcUnit(0.58, 0.24, 0.12, 0.1, 0.16);
      drawAcUnit(0.38, 0.62, 0.14, 0.1, 0.16);
      break;
    case 'skyscraper':
      drawWaterTower(context, top, layout, options.seed);
      drawAntennaCluster(context, top, layout, options.accent);
      drawCommunicationRing(context, top, layout, options.accent);
      break;
    case 'office':
      if ((options.seed % 2) === 0) {
        drawWaterTower(context, top, layout, options.seed);
      } else {
        drawAcUnit(0.56, 0.18, 0.13, 0.09, 0.16);
      }

      if (options.roofStyle === 'antenna' || options.roofStyle === 'flat') {
        drawAntennaCluster(context, top, layout, options.accent);
      }
      if (options.roofStyle === 'antenna') {
        drawCommunicationRing(context, top, layout, options.accent);
      }
      break;
    case 'shop':
    case 'cafe':
      if (options.roofStyle === 'peaked' || (options.seed % 2) === 0) {
        drawRooftopSign(context, top, layout, options.accent, options.trim);
      } else {
        drawAcUnit(0.24, 0.24, 0.1, 0.08, 0.15);
      }
      break;
    case 'townhall':
      if (options.roofStyle === 'dome' || options.kind === 'townhall') {
        drawFlagPole(context, top, layout, options.accent);
      } else {
        drawClockTower(context, top, layout, options.trim);
      }
      break;
    case 'school':
      drawFlagPole(context, top, layout, options.accent);
      break;
    case 'hospital':
      drawClockTower(context, top, layout, options.trim);
      drawAcUnit(0.18, 0.22, 0.1, 0.08, 0.14);
      break;
    default:
      if (options.roofStyle === 'antenna') {
        drawAntennaCluster(context, top, layout, options.accent);
      }
      break;
  }
}

function drawPeakedRoof(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  leftColor: string,
  rightColor: string,
  ridgeColor: string,
): void {
  const top = projection.top;
  const apex = {
    sx: (top[0].sx + top[2].sx) / 2,
    sy: (top[0].sy + top[2].sy) / 2 - Math.abs(top[0].sy - top[3].sy) * 0.9,
  };

  context.save();
  context.beginPath();
  context.moveTo(top[0].sx, top[0].sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[3].sx, top[3].sy);
  context.closePath();
  context.fillStyle = leftColor;
  context.fill();
  context.strokeStyle = withAlpha(ridgeColor, 0.35);
  context.stroke();

  context.beginPath();
  context.moveTo(top[1].sx, top[1].sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[2].sx, top[2].sy);
  context.closePath();
  context.fillStyle = rightColor;
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(top[0].sx, top[0].sy);
  context.lineTo(apex.sx, apex.sy);
  context.lineTo(top[1].sx, top[1].sy);
  context.closePath();
  context.fillStyle = ridgeColor;
  context.fill();
  context.stroke();
  context.restore();
}

function drawColumns(
  context: CanvasRenderingContext2D,
  face: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  numColumns: number,
  color: string
): void {
  context.save();
  context.fillStyle = color;
  for (let i = 1; i < numColumns; i++) {
    const t = i / numColumns;
    const yTop = face[0].sy + ((face[3].sy - face[0].sy) * t);
    const xTop = face[0].sx + ((face[3].sx - face[0].sx) * t);
    const yBottom = face[1].sy + ((face[2].sy - face[1].sy) * t);
    const xBottom = face[1].sx + ((face[2].sx - face[1].sx) * t);
    
    // Draw column
    context.beginPath();
    context.moveTo(xTop - 2, yTop);
    context.lineTo(xTop + 2, yTop);
    context.lineTo(xBottom + 2, yBottom);
    context.lineTo(xBottom - 2, yBottom);
    context.fill();
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
  const craneColor = '#f59e0b'; // Amber/Orange
  const mastHeight = layout.tileHeight * Math.max(1.2, height * 1.5);
  const jibLength = layout.tileWidth * 1.5;
  const counterJibLength = layout.tileWidth * 0.6;
  
  const rotation = (phase * 0.05) % (Math.PI * 2);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  
  context.save();
  // Draw the Mast (vertical tower)
  context.strokeStyle = craneColor;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(topCenter.sx, topCenter.sy);
  context.lineTo(topCenter.sx, topCenter.sy - mastHeight);
  context.stroke();
  
  // Cross bracing on the mast
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

  // Draw the Jib (horizontal arm)
  const pivotY = topCenter.sy - mastHeight + 4;
  context.translate(topCenter.sx, pivotY);
  
  // Flatten isometric rotation slightly for crane arm
  const isoScaleY = 0.5; 
  
  context.strokeStyle = craneColor;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-counterJibLength * cos, -counterJibLength * sin * isoScaleY);
  context.lineTo(jibLength * cos, jibLength * sin * isoScaleY);
  context.stroke();
  
  // Draw hook/cable dropping down
  const hookX = (jibLength * 0.8) * cos;
  const hookY = (jibLength * 0.8) * sin * isoScaleY;
  const dropLength = (layout.tileHeight * 0.5) + Math.sin(phase * 0.2) * (layout.tileHeight * 0.2);
  
  context.strokeStyle = '#94a3b8'; // cable
  context.beginPath();
  context.moveTo(hookX, hookY);
  context.lineTo(hookX, hookY + dropLength);
  context.stroke();
  
  // Hook block
  context.fillStyle = '#1e293b';
  context.fillRect(hookX - 2, hookY + dropLength, 4, 4);

  // Counterweight
  context.fillStyle = '#475569';
  const cwX = (-counterJibLength * 0.8) * cos;
  const cwY = (-counterJibLength * 0.8) * sin * isoScaleY;
  context.fillRect(cwX - 3, cwY - 2, 6, 8);

  context.restore();
}

function drawScaffolding(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  nightFactor: number
): void {
  const faces = [projection.left, projection.right];
  context.save();
  context.strokeStyle = `rgba(245, 158, 11, ${0.4 + (nightFactor * 0.2)})`; // Amber/Orange
  context.lineWidth = 1.0;
  
  for (const face of faces) {
    const w = Math.hypot(face[1].sx - face[0].sx, face[1].sy - face[0].sy);
    const h = Math.hypot(face[3].sx - face[0].sx, face[3].sy - face[0].sy);
    const cols = Math.max(2, Math.floor(w / 15));
    const rows = Math.max(2, Math.floor(h / 15));
    
    // Draw grid
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
  
  // Just do full face X braces for simplicity
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
  nodeState: HivemindNodeState,
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
    // Instead of a dashed line, we draw construction equipment!
    if (projection && nightFactor !== undefined) {
      drawScaffolding(context, projection, nightFactor);
    }
    drawConstructionCrane(context, topCenter, layout, phase, height ?? 1.0);
    
    // Add flashing warning lights
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
  const style = getBuildingStyle(entity);
  const accent = style.accent;

  // Wide flat plaza lot
  const lotWidth = 0.9;
  const lotDepth = 0.9;

  const lotProjection = createPrismProjection(
    display.x + ((1 - lotWidth) / 2),
    display.y + ((1 - lotDepth) / 2),
    0,
    lotWidth,
    lotDepth,
    0.06,
    layout,
  );

  // Plaza surface — warm pavement / park ground
  fillFace(context, lotProjection.left, 'rgba(130, 170, 130, 0.9)', 'rgba(74, 85, 104, 0.45)');
  fillFace(context, lotProjection.right, 'rgba(110, 150, 110, 0.9)', 'rgba(74, 85, 104, 0.45)');
  fillFace(context, lotProjection.top, 'rgba(150, 190, 150, 0.82)', withAlpha(accent, 0.25), 1.2);

  // Low border wall
  const wallProjection = createPrismProjection(
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

  // Small neighborhood sign in center
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
  const { context, entity, display, layout, nodeState, phase } = ctx;

  const isDirectory = entity.type === 'directory';
  if (isDirectory) {
    drawNeighborhoodPlaza(ctx);
    return;
  }

  const style = getBuildingStyle(entity);
  const baseFootprint = getFileFootprint(entity);
  const profile = getBuildingProfile(entity);

  const kind = profile.type;

  const footprint = {
    width: baseFootprint.width * profile.footprint,
    depth: baseFootprint.depth * profile.footprint,
  };

  const height = profile.floors * 0.8;
  const daylight = getDaylight(phase);
  const nightFactor = getNightFactor(phase);
  const statePalette = getNodeStatePalette(nodeState);
  const accent = nodeState === 'stable' ? style.accent : statePalette.accent;
  const trim = nodeState === 'stable' ? style.trim : statePalette.accent;
  const windowColor = withAlpha(style.windowColor, 0.3 + (nightFactor * 0.75));

  drawGroundLot(context, display.x, display.y, layout, footprint.width, footprint.depth, accent, kind);

  const baseAO = createPrismProjection(
    display.x + ((1 - footprint.width) / 2),
    display.y + ((1 - footprint.depth) / 2),
    entity.z ?? 0,
    footprint.width,
    footprint.depth,
    0,
    layout
  );
  context.save();
  context.globalAlpha = 0.35;
  context.strokeStyle = '#0f172a';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(baseAO.top[0].sx, baseAO.top[0].sy);
  context.lineTo(baseAO.top[1].sx, baseAO.top[1].sy);
  context.lineTo(baseAO.top[2].sx, baseAO.top[2].sy);
  context.lineTo(baseAO.top[3].sx, baseAO.top[3].sy);
  context.closePath();
  context.stroke();
  context.restore();

  // Provide deterministic randomness per entity for window lit states
  const randomSeed = entity.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const isLitPattern = (r: number, c: number) => {
    const v = Math.sin(randomSeed + r * 13 + c * 7);
    return v > 0;
  };
  const rooftopOptions: RoofClutterOptions = {
    accent,
    kind,
    roofStyle: style.roofStyle,
    seed: randomSeed,
    trim,
  };

  const leftColor = withAlpha(style.left, 0.7 + (daylight * 0.25));
  const rightColor = withAlpha(style.right, 0.72 + (daylight * 0.25));
  const topColor = withAlpha(style.top, 0.78 + (daylight * 0.2));
  
  // Build main projection
  const projection = createPrismProjection(
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
  context.shadowColor = withAlpha(style.glow, 0.15 + (nightFactor * 0.18));

  switch (kind) {
    case 'skyscraper':
    case 'office': {
      const isHuge = kind === 'skyscraper';
      const floors = isHuge ? Math.max(6, Math.floor(height * 2.2)) : Math.max(3, Math.floor(height * 1.5));
      const cols = isHuge ? 5 : 4;
      const podiumHeight = height * (isHuge ? 0.18 : 0.24);
      const zBase = entity.z ?? 0;
      const baseX = display.x + ((1 - footprint.width) / 2);
      const baseY = display.y + ((1 - footprint.depth) / 2);
      const podiumProj = createPrismProjection(
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
        const midProj = createPrismProjection(
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
        const topProj = createPrismProjection(
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

        drawRoofClutter(context, topProj, layout, rooftopOptions);
      } else {
        const towerScale = 0.88;
        const towerProj = createPrismProjection(
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
        drawRoofClutter(context, towerProj, layout, rooftopOptions);
      }
      break;
    }
    
    case 'factory':
    case 'warehouse': {
      // Brick textures
      const facLeft = adjustLightness('#8b5e3c', daylight * 30);
      const facRight = adjustLightness('#7c5133', daylight * 30);
      const facTop = adjustLightness('#5c5c5c', daylight * 30);
      
      fillFace(context, projection.left, facLeft, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.right, facRight, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.top, facTop, withAlpha(trim, 0.3), 1);
      
      // Factory windows
      drawDetailedWindows(context, projection.left, 2, 4, windowColor, nightFactor, isLitPattern, 0.5, 0.4, randomSeed);
      drawDetailedWindows(context, projection.right, 2, 4, windowColor, nightFactor, isLitPattern, 0.5, 0.4, randomSeed);
      drawRoofClutter(context, projection, layout, rooftopOptions);
      
      // Loading dock on the right side
      context.fillStyle = '#222';
      const dockWidth = footprint.depth * 0.4;
      const dockHeight = height * 0.3;
      // Draw simple box for dock
      const px1 = projection.right[3].sx + (projection.right[2].sx - projection.right[3].sx) * 0.3;
      const py1 = projection.right[3].sy + (projection.right[2].sy - projection.right[3].sy) * 0.3;
      context.fillRect(px1, py1 - (layout.tileHeight * dockHeight), layout.tileWidth * dockWidth, layout.tileHeight * dockHeight);

      if (kind === 'factory') {
        // Smokestacks
        const top = projection.top;
        const xStack = top[0].sx + (top[1].sx - top[0].sx) * 0.7;
        const yStack = top[0].sy + (top[1].sy - top[0].sy) * 0.7;
        
        context.fillStyle = '#64748b';
        context.fillRect(xStack - 3, yStack - layout.tileHeight * 1.2, 6, layout.tileHeight * 1.2);
        
        // Smoke
        context.fillStyle = 'rgba(200, 200, 200, 0.4)';
        context.beginPath();
        context.arc(xStack + (Math.sin(phase/5)*5), yStack - layout.tileHeight * 1.5, 6 + (phase%10)/2, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.arc(xStack + 5 + (Math.sin(phase/7)*5), yStack - layout.tileHeight * 1.8, 8 + (phase%10)/2, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }

    case 'townhall':
    case 'school':
    case 'hospital': {
      // Marble/Stone
      const cLeft = adjustLightness('#f1f5f9', daylight * 20);
      const cRight = adjustLightness('#e2e8f0', daylight * 20);
      const cTop = adjustLightness('#ffffff', daylight * 20);
      
      fillFace(context, projection.left, cLeft, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.right, cRight, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.top, cTop, withAlpha(trim, 0.2), 1);
      
      // Classical columns
      drawColumns(context, projection.left, 5, adjustLightness(cLeft, -20));
      drawColumns(context, projection.right, 5, adjustLightness(cRight, -20));

      if (kind === 'townhall' || style.roofStyle === 'dome') {
        const domeRadius = layout.tileWidth * (kind === 'townhall' ? 0.4 : 0.28);
        context.beginPath();
        context.ellipse(projection.center.sx, projection.center.sy, domeRadius, domeRadius * 0.5, 0, Math.PI, 0);
        context.fillStyle = '#94a3b8';
        context.fill();
        context.strokeStyle = '#cbd5e1';
        context.stroke();
      } else if (style.roofStyle === 'peaked') {
        drawPeakedRoof(context, projection, '#cbd5e1', '#94a3b8', '#64748b');
      }

      drawRoofClutter(context, projection, layout, rooftopOptions);

      if (kind === 'hospital') {
        context.fillStyle = '#ef4444';
        const cx = projection.center.sx;
        const cy = projection.center.sy;
        context.fillRect(cx - 3, cy - 10, 6, 20);
        context.fillRect(cx - 10, cy - 3, 20, 6);
      }
      break;
    }

    case 'cafe':
    case 'shop': {
      fillFace(context, projection.left, leftColor, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.right, rightColor, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.top, topColor, withAlpha(trim, 0.2), 1);
      
      drawDetailedWindows(context, projection.left, 2, 3, windowColor, nightFactor, isLitPattern, 0.6, 0.6, randomSeed);
      
      // Storefront display
      drawDetailedWindows(context, projection.right, 1, 1, windowColor, nightFactor, () => true, 0.9, 0.6, randomSeed);
      drawRoofClutter(context, projection, layout, rooftopOptions);
      
      // Awning
      const awningColor = kind === 'cafe' ? '#f43f5e' : '#3b82f6';
      context.fillStyle = withAlpha(awningColor, 0.9);
      context.beginPath();
      // Midpoint of right face for awning height
      const hX1 = projection.right[0].sx + (projection.right[1].sx - projection.right[0].sx) * 0.5;
      const hY1 = projection.right[0].sy + (projection.right[1].sy - projection.right[0].sy) * 0.5;
      const hX2 = projection.right[3].sx + (projection.right[2].sx - projection.right[3].sx) * 0.5;
      const hY2 = projection.right[3].sy + (projection.right[2].sy - projection.right[3].sy) * 0.5;
      
      context.moveTo(hX1, hY1);
      context.lineTo(hX2, hY2);
      context.lineTo(hX2 - 8, hY2 + 12);
      context.lineTo(hX1 - 8, hY1 + 12);
      context.closePath();
      context.fill();
      
      // Stripes on awning
      context.fillStyle = 'rgba(255, 255, 255, 0.8)';
      context.beginPath();
      const sX1 = hX1 + (hX2 - hX1) * 0.3;
      const sY1 = hY1 + (hY2 - hY1) * 0.3;
      context.moveTo(sX1, sY1);
      context.lineTo(sX1 + (hX2 - hX1)*0.2, sY1 + (hY2 - hY1)*0.2);
      context.lineTo(sX1 + (hX2 - hX1)*0.2 - 8, sY1 + (hY2 - hY1)*0.2 + 12);
      context.lineTo(sX1 - 8, sY1 + 12);
      context.closePath();
      context.fill();
      break;
    }

    case 'house':
    default: {
      fillFace(context, projection.left, leftColor, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.right, rightColor, withAlpha(trim, 0.3), 1);
      fillFace(context, projection.top, topColor, withAlpha(trim, 0.2), 1);
      
      if (style.roofStyle === 'peaked') {
        drawPeakedRoof(context, projection, '#854d0e', '#613303', '#9a5d12');
      } else if (style.roofStyle === 'dome') {
        context.beginPath();
        context.ellipse(projection.center.sx, projection.center.sy, layout.tileWidth * 0.18, layout.tileHeight * 0.1, 0, Math.PI, 0);
        context.fillStyle = '#a5b4c8';
        context.fill();
        context.strokeStyle = '#dbe4ee';
        context.stroke();
      } else if (style.roofStyle === 'antenna') {
        drawRoofClutter(context, projection, layout, rooftopOptions);
      }

      drawDetailedWindows(context, projection.left, 2, 2, windowColor, nightFactor, isLitPattern, 0.4, 0.5, randomSeed);
      drawDetailedWindows(context, projection.right, 2, 2, windowColor, nightFactor, isLitPattern, 0.4, 0.5, randomSeed);
      
      // Door
      context.fillStyle = '#451a03';
      const dx = projection.right[3].sx + (projection.right[2].sx - projection.right[3].sx) * 0.5;
      const dy = projection.right[3].sy + (projection.right[2].sy - projection.right[3].sy) * 0.5;
      context.fillRect(dx - 4, dy - 12, 8, 12);
      break;
    }
  }

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
