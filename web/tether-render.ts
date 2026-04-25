import { isStructureEntity } from '../src/mass-mapper';
import type { Entity } from '../src/types';
import { getBuildingHeight, getFileFootprint } from './file-colors';
import {
  getEntityLines,
  getTetherColor,
  getVesicaColor,
  getVesicaPiscisStrength,
} from './fibonacci-physics';
import { toScreen, type IsoLayout } from './iso';

function getNodeHeight(entity: Entity): number {
  if (entity.type === 'directory') {
    return getBuildingHeight(entity, 0.5);
  }
  if (entity.type === 'file') {
    const lineLift = Math.min(4, Math.floor(((entity.content ?? entity.content_preview ?? '').split('\n').length) / 24));
    const base = Math.min(6, Math.max(0.8, entity.mass * 0.5 + lineLift));
    return getBuildingHeight(entity, base);
  }
  return getBuildingHeight(entity, 0.7);
}

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

function getNodeColor(entity: Entity): string {
  // Return a representative color for this node type
  if (entity.type === 'directory') return '#4d8aff';
  const ext = entity.extension?.toLowerCase() ?? '';
  if (['ts', 'tsx'].includes(ext)) return '#00f0ff';
  if (['js', 'jsx'].includes(ext)) return '#f7df1e';
  if (['css', 'scss', 'less'].includes(ext)) return '#ff6b9d';
  if (['png', 'jpg', 'svg', 'gif'].includes(ext)) return '#ff3366';
  if (['md', 'mdx', 'txt'].includes(ext)) return '#00ff88';
  if (['html', 'htm'].includes(ext)) return '#ff7b00';
  if (['json', 'yaml', 'yml'].includes(ext)) return '#ffb347';
  if (['sh', 'ps1', 'bat'].includes(ext)) return '#ff3333';
  if (['py'].includes(ext)) return '#ffd700';
  if (['rs', 'go', 'cpp', 'c'].includes(ext)) return '#b967ff';
  return '#56d9ff';
}

export function drawTethers(
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

  const pulse = 0.5 + ((phase % 12) * 0.04);

  for (const source of entities) {
    if (!isStructureEntity(source) || !source.tether_to || source.tether_to.length === 0) {
      continue;
    }

    const sourceFootprint = getFileFootprint(source);
    const sourceHeight = getNodeHeight(source);
    const sourceCenter = toScreen(
      source.x + (sourceFootprint.width / 2),
      source.y + (sourceFootprint.depth / 2),
      (source.z ?? 0) + sourceHeight + 0.1,
      layout,
    );
    const sourceLines = getEntityLines(source);

    for (const targetPath of source.tether_to) {
      const target = entityByPath.get(targetPath);
      if (!target) {
        continue;
      }

      const targetFootprint = getFileFootprint(target);
      const targetHeight = getNodeHeight(target);
      const targetCenter = toScreen(
        target.x + (targetFootprint.width / 2),
        target.y + (targetFootprint.depth / 2),
        (target.z ?? 0) + targetHeight + 0.1,
        layout,
      );
      const targetLines = getEntityLines(target);

      const isBroken = source.tether_broken === true || target.tether_broken === true;
      const dx = targetCenter.sx - sourceCenter.sx;
      const dy = targetCenter.sy - sourceCenter.sy;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.001) {
        continue;
      }

      // Control point for the curve — bow outward based on vertical separation
      const zDiff = (target.z ?? 0) - (source.z ?? 0);
      const bowAmount = dist * 0.25 + Math.abs(zDiff) * layout.tileHeight * 0.3;
      const midX = (sourceCenter.sx + targetCenter.sx) / 2;
      const midY = (sourceCenter.sy + targetCenter.sy) / 2;
      // Bow perpendicular to the line, biased by which end is higher
      const perpX = -(dy / dist) * bowAmount;
      const perpY = (dx / dist) * bowAmount;
      const cpX = midX + perpX;
      const cpY = midY + perpY;

      context.save();

      if (isBroken) {
        // Broken tunnel: cracked, red, dashed
        context.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
        context.lineWidth = 3;
        context.setLineDash([6, 4]);
        context.shadowBlur = 14;
        context.shadowColor = `rgba(239, 68, 68, ${pulse * 0.6})`;
        context.lineCap = 'round';

        context.beginPath();
        context.moveTo(sourceCenter.sx, sourceCenter.sy);
        context.quadraticCurveTo(cpX, cpY, targetCenter.sx, targetCenter.sy);
        context.stroke();
      } else {
        // Healthy tunnel: keep the local curved tube, but tint and weight it
        // using the pulled Fibonacci chirality + dependency-strength physics.
        const sourceColor = getNodeColor(source);
        const targetColor = getNodeColor(target);
        const tetherColor = getTetherColor(sourceLines, targetLines);
        const importCount = source.tether_to?.length ?? 0;
        const exportCount = target.tether_to?.length ?? 0;
        const vesicaStrength = getVesicaPiscisStrength(importCount, exportCount);
        const vesicaColor = getVesicaColor(vesicaStrength);
        const outerWidth = 3 + (vesicaStrength * 3);

        // Outer glow (thick, soft)
        const gradient = context.createLinearGradient(sourceCenter.sx, sourceCenter.sy, targetCenter.sx, targetCenter.sy);
        gradient.addColorStop(0, withAlpha(sourceColor, 0.16 + (vesicaStrength * 0.08)));
        gradient.addColorStop(0.5, withComputedAlpha(tetherColor, 0.22 + (vesicaStrength * 0.22)));
        gradient.addColorStop(1, withAlpha(targetColor, 0.16 + (vesicaStrength * 0.08)));

        context.strokeStyle = gradient;
        context.lineWidth = outerWidth;
        context.lineCap = 'round';
        context.shadowBlur = 10 + (vesicaStrength * 14);
        context.shadowColor = vesicaColor === 'transparent'
          ? withComputedAlpha(tetherColor, 0.28)
          : vesicaColor;
        context.setLineDash([]);

        context.beginPath();
        context.moveTo(sourceCenter.sx, sourceCenter.sy);
        context.quadraticCurveTo(cpX, cpY, targetCenter.sx, targetCenter.sy);
        context.stroke();

        // Inner core (thin, bright)
        const coreGradient = context.createLinearGradient(sourceCenter.sx, sourceCenter.sy, targetCenter.sx, targetCenter.sy);
        coreGradient.addColorStop(0, withAlpha(sourceColor, 0.55));
        coreGradient.addColorStop(0.5, withComputedAlpha(tetherColor, 0.82));
        coreGradient.addColorStop(1, withAlpha(targetColor, 0.55));

        context.strokeStyle = coreGradient;
        context.lineWidth = 1.2 + (vesicaStrength * 0.9);
        context.shadowBlur = 6 + (vesicaStrength * 6);
        context.shadowColor = withComputedAlpha(tetherColor, 0.42 + (vesicaStrength * 0.16));

        context.beginPath();
        context.moveTo(sourceCenter.sx, sourceCenter.sy);
        context.quadraticCurveTo(cpX, cpY, targetCenter.sx, targetCenter.sy);
        context.stroke();
      }

      context.restore();
    }
  }
}
