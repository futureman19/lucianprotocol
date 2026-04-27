import type { Entity } from '../src/types';
import type { IsoLayout } from './iso';
import { toScreen } from './iso';
import { withAlpha } from './facade-pipeline';

export function drawLongShadow(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  footprintWidth: number,
  footprintDepth: number,
  height: number,
  layout: IsoLayout,
  phase: number,
): void {
  if (height < 0.2) return;

  const daylight = 0.2 + 0.8 * ((Math.sin((phase / 60) * Math.PI * 2 - Math.PI / 2) + 1) / 2);
  const night = 1 - daylight;
  if (daylight < 0.1 && night < 0.1) return;

  const z = entity.z ?? 0;
  const corners: [{ sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }] = [
    toScreen(displayX + (1 - footprintWidth) / 2, displayY + (1 - footprintDepth) / 2, z, layout),
    toScreen(displayX + (1 + footprintWidth) / 2, displayY + (1 - footprintDepth) / 2, z, layout),
    toScreen(displayX + (1 + footprintWidth) / 2, displayY + (1 + footprintDepth) / 2, z, layout),
    toScreen(displayX + (1 - footprintWidth) / 2, displayY + (1 + footprintDepth) / 2, z, layout),
  ];

  const shadowLen = (0.15 + height * 0.3) * (1 + night * 0.8);
  const sdx = -shadowLen * 0.35;
  const sdy = -shadowLen * 0.25;

  const proj: [{ sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }] = [
    { sx: corners[0].sx + sdx * layout.tileWidth, sy: corners[0].sy + sdy * layout.tileHeight },
    { sx: corners[1].sx + sdx * layout.tileWidth, sy: corners[1].sy + sdy * layout.tileHeight },
    { sx: corners[2].sx + sdx * layout.tileWidth, sy: corners[2].sy + sdy * layout.tileHeight },
    { sx: corners[3].sx + sdx * layout.tileWidth, sy: corners[3].sy + sdy * layout.tileHeight },
  ];

  context.save();

  // Contact shadow
  context.globalAlpha = 0.12 + night * 0.08;
  context.fillStyle = '#0a1520';
  context.beginPath();
  context.moveTo(corners[0].sx, corners[0].sy);
  context.lineTo(corners[1].sx, corners[1].sy);
  context.lineTo(corners[2].sx, corners[2].sy);
  context.lineTo(corners[3].sx, corners[3].sy);
  context.closePath();
  context.fill();

  // Cast shadow
  context.globalAlpha = 1;
  const castShadow: Array<{ sx: number; sy: number }> = [corners[2], corners[1], proj[1], proj[0], proj[3], corners[3]];

  const cx = (corners[0].sx + corners[2].sx) / 2;
  const cy = (corners[0].sy + corners[2].sy) / 2;
  const pcx = (proj[0].sx + proj[2].sx) / 2;
  const pcy = (proj[0].sy + proj[2].sy) / 2;

  const grad = context.createLinearGradient(cx, cy, pcx, pcy);
  grad.addColorStop(0, `rgba(8, 16, 28, ${0.2 + night * 0.1})`);
  grad.addColorStop(0.5, `rgba(8, 16, 28, ${0.08 + night * 0.05})`);
  grad.addColorStop(1, 'rgba(8, 16, 28, 0)');

  context.fillStyle = grad;
  context.beginPath();
  context.moveTo(castShadow[0]!.sx, castShadow[0]!.sy);
  for (let i = 1; i < castShadow.length; i++) {
    const p = castShadow[i];
    if (p) context.lineTo(p.sx, p.sy);
  }
  context.closePath();
  context.fill();

  context.restore();
}

export function drawNeonSpill(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  nightFactor: number,
  phase: number,
): void {
  if (nightFactor < 0.3) return;

  const center = toScreen(displayX + 0.5, displayY + 0.5, zBase + height * 0.5, layout);
  const colors = ['#f472b6', '#38bdf8', '#a78bfa', '#fbbf24'];
  const seed = entity.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const color = colors[seed % colors.length] ?? '#f472b6';

  context.save();
  const flicker = 0.7 + Math.sin(phase * 0.2 + seed) * 0.3;
  const spill = context.createRadialGradient(center.sx, center.sy, 0, center.sx, center.sy, layout.tileWidth * 0.6);
  spill.addColorStop(0, withAlpha(color, nightFactor * 0.06 * flicker));
  spill.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = spill;
  context.beginPath();
  context.ellipse(center.sx, center.sy, layout.tileWidth * 0.6, layout.tileHeight * 0.35, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawRainReflection(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  wetness: number,
  nightFactor: number,
  _phase: number,
): void {
  if (wetness < 0.3 || nightFactor < 0.2) return;

  const center = toScreen(displayX + 0.5, displayY + 0.5, 0, layout);
  context.save();
  context.fillStyle = withAlpha('#e0f2fe', wetness * nightFactor * 0.1);
  context.beginPath();
  context.ellipse(center.sx, center.sy + layout.tileHeight * 0.15, layout.tileWidth * 0.25, layout.tileHeight * 0.08, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawNightBloom(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  nightFactor: number,
): void {
  if (nightFactor < 0.4) return;

  const center = toScreen(displayX + 0.5, displayY + 0.5, zBase + height + 0.1, layout);
  context.save();
  const bloom = context.createRadialGradient(center.sx, center.sy, 0, center.sx, center.sy, layout.tileWidth * 0.8);
  bloom.addColorStop(0, withAlpha('#fef08a', nightFactor * 0.04));
  bloom.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = bloom;
  context.beginPath();
  context.ellipse(center.sx, center.sy, layout.tileWidth * 0.8, layout.tileHeight * 0.5, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawBlinkingObstructionLight(
  context: CanvasRenderingContext2D,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  phase: number,
): void {
  const blink = (phase % 60) < 30;
  if (!blink) return;

  const top = toScreen(displayX + 0.5, displayY + 0.5, zBase + height + 0.15, layout);
  context.save();
  context.fillStyle = 'rgba(239, 68, 68, 0.9)';
  context.shadowBlur = 14;
  context.shadowColor = 'rgba(239, 68, 68, 0.7)';
  context.beginPath();
  context.arc(top.sx, top.sy, 2.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawSlowMicroAnimations(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  phase: number,
): void {
  // Slow beacon rotation or gentle sway
  const seed = entity.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const sway = Math.sin(phase * 0.02 + seed) * 2;

  const top = toScreen(displayX + 0.5, displayY + 0.5, zBase + height + 0.1, layout);
  context.save();
  context.strokeStyle = withAlpha('#fcd34d', 0.3);
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(top.sx, top.sy);
  context.lineTo(top.sx + sway, top.sy - layout.tileHeight * 0.15);
  context.stroke();
  context.restore();
}
