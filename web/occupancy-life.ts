import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';
import { toScreen } from './iso';
import { withAlpha } from './facade-pipeline';

export function drawOccupancyLife(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  occupancy: number,
  activityLevel: number,
  phase: number,
  seed: number,
): void {
  if (occupancy < 0.1) return;

  const center = toScreen(displayX + 0.5, displayY + 0.5, zBase + height * 0.3, layout);

  context.save();

  // Tiny crowd tokens near entrance
  const crowdCount = Math.floor(occupancy * 4);
  for (let i = 0; i < crowdCount; i++) {
    const t = ((phase * 0.01) + i * 0.37 + seed * 0.1) % 1;
    const angle = i * 2.4 + Math.sin(phase * 0.02 + i) * 0.5;
    const dist = layout.tileWidth * 0.25 * (0.5 + t * 0.5);
    const cx = center.sx + Math.cos(angle) * dist;
    const cy = center.sy + Math.sin(angle) * dist * 0.5;

    context.fillStyle = withAlpha('#fcd34d', 0.6 + activityLevel * 0.4);
    context.beginPath();
    context.arc(cx, cy, 1.2, 0, Math.PI * 2);
    context.fill();
  }

  // Delivery cart if activity is high
  if (activityLevel > 0.6) {
    const cartT = ((phase * 0.008) + seed * 0.2) % 1;
    const cartX = center.sx - layout.tileWidth * 0.3 + cartT * layout.tileWidth * 0.6;
    const cartY = center.sy + layout.tileHeight * 0.15;

    context.fillStyle = 'rgba(161, 98, 7, 0.75)';
    context.fillRect(cartX - 3, cartY - 2, 6, 4);
    context.fillStyle = 'rgba(60, 60, 65, 0.7)';
    context.beginPath();
    context.arc(cartX - 3, cartY + 2, 1.5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(cartX + 3, cartY + 2, 1.5, 0, Math.PI * 2);
    context.fill();
  }

  // Monitor flicker in upper floors
  if (occupancy > 0.5 && height > 1.5) {
    const flicker = Math.sin(phase * 0.3 + seed) > 0.7;
    if (flicker) {
      const fx = center.sx + Math.sin(seed * 3) * layout.tileWidth * 0.1;
      const fy = center.sy - layout.tileHeight * height * 0.4;
      context.fillStyle = withAlpha('#38bdf8', 0.4);
      context.shadowBlur = 6;
      context.shadowColor = '#38bdf8';
      context.fillRect(fx - 2, fy - 1, 4, 2);
      context.shadowBlur = 0;
    }
  }

  context.restore();
}

export function drawLobbyGlow(
  context: CanvasRenderingContext2D,
  face: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  occupancy: number,
  nightFactor: number,
): void {
  if (nightFactor < 0.2 || occupancy < 0.2) return;

  const midX = (face[0].sx + face[2].sx) / 2;
  const midY = (face[0].sy + face[2].sy) / 2;

  context.save();
  const glow = context.createRadialGradient(midX, midY, 0, midX, midY, layout.tileWidth * 0.25);
  glow.addColorStop(0, withAlpha('#fef08a', nightFactor * occupancy * 0.3));
  glow.addColorStop(1, 'rgba(254, 240, 138, 0)');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(midX, midY, layout.tileWidth * 0.25, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
