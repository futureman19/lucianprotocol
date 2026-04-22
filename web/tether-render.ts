import { isStructureEntity } from '../src/mass-mapper';
import type { Entity } from '../src/types';
import { toScreen, type IsoLayout } from './iso';

function getNodeHeight(entity: Entity): number {
  if (entity.type === 'directory') {
    return 1;
  }
  if (entity.type === 'file') {
    const lineLift = Math.min(4, Math.floor(((entity.content ?? entity.content_preview ?? '').split('\n').length) / 24));
    return Math.min(6, Math.max(1, entity.mass + lineLift));
  }
  return 0.7;
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

    const sourceHeight = getNodeHeight(source);
    const sourceCenter = toScreen(source.x + 0.5, source.y + 0.5, sourceHeight + 0.1, layout);

    for (const targetPath of source.tether_to) {
      const target = entityByPath.get(targetPath);
      if (!target) {
        continue;
      }

      const targetHeight = getNodeHeight(target);
      const targetCenter = toScreen(target.x + 0.5, target.y + 0.5, targetHeight + 0.1, layout);

      const isBroken = source.tether_broken === true || target.tether_broken === true;

      context.save();

      if (isBroken) {
        context.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
        context.lineWidth = 1.5;
        context.setLineDash([4, 4]);
        context.shadowBlur = 10;
        context.shadowColor = `rgba(239, 68, 68, ${pulse * 0.6})`;
      } else {
        context.strokeStyle = 'rgba(86, 217, 255, 0.22)';
        context.lineWidth = 1;
        context.setLineDash([]);
        context.shadowBlur = 0;
      }

      context.beginPath();
      context.moveTo(sourceCenter.sx, sourceCenter.sy);
      context.lineTo(targetCenter.sx, targetCenter.sy);
      context.stroke();

      context.restore();
    }
  }
}
