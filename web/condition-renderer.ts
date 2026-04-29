import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';
import { withAlpha } from './facade-pipeline';

export type ConditionGrade = 'pristine' | 'maintained' | 'worn' | 'decaying' | 'condemned';

export function getConditionFactor(condition: ConditionGrade): number {
  switch (condition) {
    case 'pristine':
      return 0;
    case 'maintained':
      return 0.25;
    case 'worn':
      return 0.5;
    case 'decaying':
      return 0.75;
    case 'condemned':
      return 1;
    default:
      return 0.25;
  }
}

function seededFraction(seed: number, offset: number): number {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function drawConditionOverlays(
  context: CanvasRenderingContext2D,
  entity: Entity,
  projection: { left: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; right: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] },
  layout: IsoLayout,
  condition: ConditionGrade,
  seed: number,
): void {
  const factor = getConditionFactor(condition);
  if (factor <= 0.05) return;

  context.save();

  // Grime overlay
  if (factor >= 0.2) {
    const grimeAlpha = factor * 0.25;
    context.fillStyle = withAlpha('#3f3f46', grimeAlpha);
    for (const face of [projection.left, projection.right]) {
      context.beginPath();
      context.moveTo(face[0].sx, face[0].sy);
      context.lineTo(face[1].sx, face[1].sy);
      context.lineTo(face[2].sx, face[2].sy);
      context.lineTo(face[3].sx, face[3].sy);
      context.closePath();
      context.fill();
    }
  }

  // Cracks
  if (factor >= 0.4) {
    const crackCount = Math.floor(factor * 6);
    context.strokeStyle = withAlpha('#18181b', factor * 0.6);
    context.lineWidth = 0.6;
    for (const face of [projection.left, projection.right]) {
      for (let i = 0; i < crackCount; i++) {
        const t1 = 0.08 + seededFraction(seed, i * 17) * 0.84;
        const t2 = 0.08 + seededFraction(seed, i * 31 + 0.2) * 0.84;
        const x1 = face[0].sx + (face[3].sx - face[0].sx) * t1;
        const y1 = face[0].sy + (face[3].sy - face[0].sy) * t1;
        const x2 = face[1].sx + (face[2].sx - face[1].sx) * t2;
        const y2 = face[1].sy + (face[2].sy - face[1].sy) * t2;
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      }
    }
  }

  // Boarded windows
  if (factor >= 0.6) {
    const boardCount = Math.floor(factor * 3);
    context.fillStyle = withAlpha('#5c3a21', 0.85);
    for (const face of [projection.left, projection.right]) {
      for (let i = 0; i < boardCount; i++) {
        const t = 0.1 + seededFraction(seed, i * 23 + 0.3) * 0.8;
        const x = face[0].sx + (face[3].sx - face[0].sx) * t;
        const y = face[0].sy + (face[3].sy - face[0].sy) * t;
        context.fillRect(x - 3, y - 6, 6, 12);
        context.strokeStyle = withAlpha('#3d1f0a', 0.9);
        context.lineWidth = 0.5;
        context.beginPath();
        context.moveTo(x - 3, y - 6);
        context.lineTo(x + 3, y + 6);
        context.stroke();
      }
    }
  }

  // Condemnation cues
  if (factor >= 0.9) {
    const topCenter = {
      sx: (projection.top[0].sx + projection.top[2].sx) / 2,
      sy: (projection.top[0].sy + projection.top[2].sy) / 2,
    };
    context.fillStyle = withAlpha('#ef4444', 0.85);
    context.font = `bold ${Math.max(8, layout.tileWidth * 0.1)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('X', topCenter.sx, topCenter.sy - layout.tileHeight * 0.1);

    context.strokeStyle = withAlpha('#ef4444', 0.6);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(topCenter.sx - 6, topCenter.sy - layout.tileHeight * 0.1 - 6);
    context.lineTo(topCenter.sx + 6, topCenter.sy - layout.tileHeight * 0.1 + 6);
    context.moveTo(topCenter.sx + 6, topCenter.sy - layout.tileHeight * 0.1 - 6);
    context.lineTo(topCenter.sx - 6, topCenter.sy - layout.tileHeight * 0.1 + 6);
    context.stroke();
  }

  context.restore();
}

export function drawIvy(
  context: CanvasRenderingContext2D,
  projection: { left: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; right: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] },
  layout: IsoLayout,
  coverage: number,
  seed: number,
): void {
  if (coverage <= 0.05) return;

  context.save();
  const colors = ['#166534', '#15803d', '#14532d', '#22c55e'];

  for (const face of [projection.left, projection.right]) {
    const vineCount = Math.floor(coverage * 8);
    for (let i = 0; i < vineCount; i++) {
      const t = 0.05 + seededFraction(seed, i * 19) * 0.9;
      const x = face[0].sx + (face[3].sx - face[0].sx) * t;
      const y = face[0].sy + (face[3].sy - face[0].sy) * t;
      const color = colors[i % colors.length] ?? '#166534';

      context.fillStyle = withAlpha(color, 0.6 + coverage * 0.3);
      context.beginPath();
      context.arc(x, y, 2 + coverage * 2, 0, Math.PI * 2);
      context.fill();

      // Leaf
      context.fillStyle = withAlpha(color, 0.5);
      context.beginPath();
      context.ellipse(x + 3, y - 2, 2, 1.5, 0.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.restore();
}
