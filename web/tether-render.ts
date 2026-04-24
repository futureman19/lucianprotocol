import { isStructureEntity } from '../src/mass-mapper';
import type { Entity } from '../src/types';
import { toScreen, type IsoLayout } from './iso';
import {
  getFibonacciBuildingHeight,
  getTetherColor,
  getVesicaPiscisStrength,
  getVesicaColor,
  getEntityLines,
} from './fibonacci-physics';

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

    const sourceHeight = getFibonacciBuildingHeight(source);
    const sourceCenter = toScreen(source.x + 0.5, source.y + 0.5, sourceHeight + 0.1, layout);
    const sourceLines = getEntityLines(source);

    for (const targetPath of source.tether_to) {
      const target = entityByPath.get(targetPath);
      if (!target) {
        continue;
      }

      const targetHeight = getFibonacciBuildingHeight(target);
      const targetCenter = toScreen(target.x + 0.5, target.y + 0.5, targetHeight + 0.1, layout);
      const targetLines = getEntityLines(target);

      const isBroken = source.tether_broken === true || target.tether_broken === true;

      // Fibonacci chirality-based tether color
      const tetherColor = getTetherColor(sourceLines, targetLines);
      
      // Vesica Piscis strength: how much shared "space" between files
      const importCount = source.tether_to?.length ?? 0;
      const exportCount = target.tether_to?.length ?? 0;
      const vesicaStrength = getVesicaPiscisStrength(importCount, exportCount);
      const vesicaColor = getVesicaColor(vesicaStrength);

      context.save();

      if (isBroken) {
        context.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
        context.lineWidth = 1.5;
        context.setLineDash([4, 4]);
        context.shadowBlur = 10;
        context.shadowColor = `rgba(239, 68, 68, ${pulse * 0.6})`;
      } else {
        // Blend chirality color with Vesica Piscis intensity
        const rgbMatch = tetherColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1]!);
          const g = parseInt(rgbMatch[2]!);
          const b = parseInt(rgbMatch[3]!);
          context.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.15 + vesicaStrength * 0.25})`;
        } else {
          context.strokeStyle = tetherColor;
        }
        
        // Line thickness = Vesica Piscis strength (coupling depth)
        context.lineWidth = 0.8 + vesicaStrength * 1.5;
        context.setLineDash([]);
        context.shadowBlur = vesicaStrength > 0.5 ? 8 : 0;
        context.shadowColor = vesicaColor;
      }

      context.beginPath();
      context.moveTo(sourceCenter.sx, sourceCenter.sy);
      context.lineTo(targetCenter.sx, targetCenter.sy);
      context.stroke();

      context.restore();
    }
  }
}
