import { isStructureEntity } from '../src/mass-mapper';
import type { Entity } from '../src/types';
import {
  getEntityLines,
  getTetherColor,
  getVesicaPiscisStrength,
} from './fibonacci-physics';
import { toScreen, type IsoLayout } from './iso';

function withAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function withComputedAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    return withAlpha(color, alpha);
  }

  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgbMatch) {
    return color;
  }

  return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
}

function drawPipeSegment(
  context: CanvasRenderingContext2D,
  from: { sx: number; sy: number },
  to: { sx: number; sy: number },
  color: string,
  width: number,
  isBroken: boolean,
  phase: number,
): void {
  context.save();

  if (isBroken) {
    context.strokeStyle = `rgba(239, 68, 68, 0.6)`;
    context.lineWidth = width;
    context.setLineDash([4, 4]);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();
  } else {
    // Outer pipe — dark utility conduit
    context.strokeStyle = 'rgba(45, 55, 72, 0.85)';
    context.lineWidth = width + 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();

    // Inner fluid line
    context.strokeStyle = withComputedAlpha(color, 0.55);
    context.lineWidth = width * 0.5;
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();

    // Subtle flow pulse
    const flowT = ((phase * 2) % 60) / 60;
    const fx = from.sx + (to.sx - from.sx) * flowT;
    const fy = from.sy + (to.sy - from.sy) * flowT;
    context.fillStyle = withComputedAlpha(color, 0.9);
    context.beginPath();
    context.arc(fx, fy, width * 0.35, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawJunctionBox(
  context: CanvasRenderingContext2D,
  point: { sx: number; sy: number },
  color: string,
): void {
  context.save();
  context.fillStyle = 'rgba(45, 55, 72, 0.9)';
  context.beginPath();
  context.arc(point.sx, point.sy, 3.5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = withComputedAlpha(color, 0.7);
  context.beginPath();
  context.arc(point.sx, point.sy, 1.8, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawPlumbing(
  context: CanvasRenderingContext2D,
  entities: Entity[],
  layout: IsoLayout,
  phase: number,
): void {
  const entityByPath = new Map<string, Entity>();
  for (const entity of entities) {
    if (entity.path) {
      entityByPath.set(entity.path, entity);
    }
  }

  for (const source of entities) {
    if (!isStructureEntity(source) || !source.tether_to || source.tether_to.length === 0) {
      continue;
    }

    const sourceLines = getEntityLines(source);

    for (const targetPath of source.tether_to) {
      const target = entityByPath.get(targetPath);
      if (!target) {
        continue;
      }

      const targetLines = getEntityLines(target);

      const isBroken = source.tether_broken === true || target.tether_broken === true;

      // Grid-aligned L-shape plumbing at z = 0.015 (just above ground, below roads)
      const sx = source.x + 0.5;
      const sy = source.y + 0.5;
      const tx = target.x + 0.5;
      const ty = target.y + 0.5;
      const z = 0.015;

      const sourceScreen = toScreen(sx, sy, z, layout);
      const cornerScreen = toScreen(tx, sy, z, layout);
      const targetScreen = toScreen(tx, ty, z, layout);

      const tetherColor = getTetherColor(sourceLines, targetLines);
      const importCount = source.tether_to?.length ?? 0;
      const exportCount = target.tether_to?.length ?? 0;
      const vesicaStrength = getVesicaPiscisStrength(importCount, exportCount);
      const pipeWidth = 2.2 + (vesicaStrength * 1.8);

      // Horizontal segment
      if (Math.abs(tx - sx) > 0.01) {
        drawPipeSegment(context, sourceScreen, cornerScreen, tetherColor, pipeWidth, isBroken, phase);
      }

      // Vertical segment
      if (Math.abs(ty - sy) > 0.01) {
        drawPipeSegment(context, cornerScreen, targetScreen, tetherColor, pipeWidth, isBroken, phase);
      }

      // Junction box at the corner
      if (Math.abs(tx - sx) > 0.01 && Math.abs(ty - sy) > 0.01) {
        drawJunctionBox(context, cornerScreen, tetherColor);
      }
    }
  }
}

// Legacy export name for compatibility — now renders as underground plumbing
export function drawTethers(
  context: CanvasRenderingContext2D,
  entities: Entity[],
  layout: IsoLayout,
  phase: number,
): void {
  drawPlumbing(context, entities, layout, phase);
}
