import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';

import { withAlpha } from './facade-pipeline';

export function drawWeatherOnFacade(
  context: CanvasRenderingContext2D,
  entity: Entity,
  projection: { left: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; right: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] },
  layout: IsoLayout,
  wetness: number,
  snowCover: number,
  fogFactor: number,
  phase: number,
): void {
  context.save();

  // Wet facade - darkened faces with subtle sheen
  if (wetness > 0.1) {
    const wetAlpha = wetness * 0.15;
    for (const face of [projection.left, projection.right]) {
      context.fillStyle = withAlpha('#1e3a5f', wetAlpha);
      context.beginPath();
      context.moveTo(face[0].sx, face[0].sy);
      context.lineTo(face[1].sx, face[1].sy);
      context.lineTo(face[2].sx, face[2].sy);
      context.lineTo(face[3].sx, face[3].sy);
      context.closePath();
      context.fill();
    }

    // Puddle reflection near base
    if (wetness > 0.4) {
      const base = {
        sx: (projection.left[3].sx + projection.right[3].sx) / 2,
        sy: (projection.left[3].sy + projection.right[3].sy) / 2 + layout.tileHeight * 0.05,
      };
      const puddleW = layout.tileWidth * 0.3 * wetness;
      const puddleH = layout.tileHeight * 0.1 * wetness;
      context.fillStyle = withAlpha('#87ceeb', 0.12 + wetness * 0.1);
      context.beginPath();
      context.ellipse(base.sx, base.sy, puddleW, puddleH, 0, 0, Math.PI * 2);
      context.fill();

      // Ripple
      context.strokeStyle = withAlpha('#a5f3fc', 0.15);
      context.lineWidth = 0.5;
      const rippleR = ((phase * 0.5) % 10) + 3;
      context.beginPath();
      context.ellipse(base.sx, base.sy, rippleR, rippleR * 0.4, 0, 0, Math.PI * 2);
      context.stroke();
    }
  }

  // Snow on roof
  if (snowCover > 0.1) {
    const snowAlpha = snowCover * 0.7;
    const top = projection.top;
    context.fillStyle = withAlpha('#f8fafc', snowAlpha);
    context.beginPath();
    context.moveTo(top[0].sx, top[0].sy);
    context.lineTo(top[1].sx, top[1].sy);
    context.lineTo(top[2].sx, top[2].sy);
    context.lineTo(top[3].sx, top[3].sy);
    context.closePath();
    context.fill();

    // Snow cap thickness
    context.strokeStyle = withAlpha('#e2e8f0', snowAlpha * 0.8);
    context.lineWidth = 1.5;
    context.stroke();
  }

  // Fog fade on building
  if (fogFactor > 0.1) {
    const fogAlpha = fogFactor * 0.35;
    for (const face of [projection.left, projection.right, projection.top]) {
      context.fillStyle = withAlpha('#cbd5e1', fogAlpha);
      context.beginPath();
      context.moveTo(face[0].sx, face[0].sy);
      context.lineTo(face[1].sx, face[1].sy);
      context.lineTo(face[2].sx, face[2].sy);
      context.lineTo(face[3].sx, face[3].sy);
      context.closePath();
      context.fill();
    }
  }

  // Ground wear / mud around footprint
  if (wetness > 0.3 || snowCover > 0.2) {
    const center = {
      sx: (projection.left[3].sx + projection.right[3].sx) / 2,
      sy: (projection.left[3].sy + projection.right[3].sy) / 2,
    };
    const wearAlpha = Math.max(wetness, snowCover * 0.5) * 0.15;
    context.fillStyle = withAlpha('#3f3f46', wearAlpha);
    context.beginPath();
    context.ellipse(center.sx, center.sy, layout.tileWidth * 0.4, layout.tileHeight * 0.2, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}
