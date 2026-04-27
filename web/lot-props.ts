import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';
import { toScreen, createPrismProjection } from './iso';
import { withAlpha } from './facade-pipeline';

export interface LotProp {
  type: string;
  x: number;
  y: number;
  size: number;
}

function rng(seed: number, offset: number): number {
  const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function drawLotProps(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  seed: number,
  propMix: Record<string, number>,
  importanceTier: number,
): void {
  const props = Object.entries(propMix);
  if (props.length === 0) return;

  const footprint = createPrismProjection(displayX, displayY, entity.z ?? 0, 1, 1, 0, layout);
  void footprint;

  context.save();

  let propIndex = 0;
  for (const [type, density] of props) {
    const count = Math.floor(density * 3) + (importanceTier > 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const angle = rng(seed, propIndex * 7 + i * 13) * Math.PI * 2;
      const dist = 0.3 + rng(seed, propIndex * 11 + i * 17) * 0.5;
      const px = displayX + 0.5 + Math.cos(angle) * dist;
      const py = displayY + 0.5 + Math.sin(angle) * dist;
      const screen = toScreen(px, py, 0, layout);

      switch (type) {
        case 'fence':
          drawFence(context, screen, layout, seed + propIndex + i);
          break;
        case 'dumpster':
          drawDumpster(context, screen, layout);
          break;
        case 'bench':
          drawBench(context, screen, layout);
          break;
        case 'bike':
          drawBike(context, screen, layout, seed + propIndex + i);
          break;
        case 'pallet':
          drawPallet(context, screen, layout);
          break;
        case 'hvac':
          drawHvac(context, screen, layout);
          break;
        case 'utility':
          drawUtilityBox(context, screen, layout);
          break;
        case 'planter':
          drawPlanter(context, screen, layout);
          break;
        case 'parking':
          drawParkingMarks(context, screen, layout, seed + propIndex + i);
          break;
        case 'loading':
          drawLoadingDock(context, screen, layout);
          break;
        case 'awning':
          drawAwning(context, screen, layout, seed + propIndex + i);
          break;
        case 'bush':
          drawBush(context, screen, layout, seed + propIndex + i);
          break;
        case 'mailbox':
          drawMailbox(context, screen, layout);
          break;
        case 'art':
          drawArt(context, screen, layout, seed + propIndex + i);
          break;
      }
      propIndex++;
    }
  }

  context.restore();
}

function drawFence(
  context: CanvasRenderingContext2D,
  screen: ScreenPoint,
  layout: IsoLayout,
  _seed: number,
): void {
  const w = layout.tileWidth * 0.35;
  const h = layout.tileHeight * 0.12;
  context.strokeStyle = 'rgba(120, 113, 108, 0.7)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(screen.sx - w, screen.sy);
  context.lineTo(screen.sx + w, screen.sy);
  context.stroke();
  for (let i = 0; i < 4; i++) {
    const x = screen.sx - w + (i * w * 2) / 3;
    context.beginPath();
    context.moveTo(x, screen.sy);
    context.lineTo(x, screen.sy - h);
    context.stroke();
  }
}

function drawDumpster(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.2;
  const h = layout.tileHeight * 0.15;
  context.fillStyle = 'rgba(63, 63, 70, 0.85)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.strokeStyle = 'rgba(82, 82, 91, 0.9)';
  context.lineWidth = 0.8;
  context.strokeRect(screen.sx - w, screen.sy - h, w * 2, h);
}

function drawBench(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.22;
  const h = layout.tileHeight * 0.06;
  context.fillStyle = 'rgba(120, 53, 15, 0.8)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.fillStyle = 'rgba(87, 83, 78, 0.8)';
  context.fillRect(screen.sx - w, screen.sy - h * 2.5, 3, h * 2.5);
  context.fillRect(screen.sx + w - 3, screen.sy - h * 2.5, 3, h * 2.5);
}

function drawBike(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout, _seed: number): void {
  const r = layout.tileWidth * 0.06;
  context.strokeStyle = 'rgba(60, 60, 65, 0.7)';
  context.lineWidth = 1;
  context.beginPath();
  context.arc(screen.sx - r, screen.sy - r, r, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(screen.sx + r, screen.sy - r, r, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(screen.sx - r, screen.sy - r);
  context.lineTo(screen.sx, screen.sy - r * 2);
  context.lineTo(screen.sx + r, screen.sy - r);
  context.stroke();
}

function drawPallet(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.18;
  const h = layout.tileHeight * 0.06;
  context.fillStyle = 'rgba(161, 98, 7, 0.7)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.strokeStyle = 'rgba(120, 53, 15, 0.8)';
  context.lineWidth = 0.6;
  context.strokeRect(screen.sx - w, screen.sy - h, w * 2, h);
}

function drawHvac(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.15;
  const h = layout.tileHeight * 0.1;
  context.fillStyle = 'rgba(82, 82, 91, 0.8)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.strokeStyle = 'rgba(113, 113, 122, 0.9)';
  context.lineWidth = 0.8;
  context.strokeRect(screen.sx - w, screen.sy - h, w * 2, h);
  // Fan
  context.strokeStyle = 'rgba(39, 39, 42, 0.8)';
  context.beginPath();
  context.arc(screen.sx, screen.sy - h / 2, w * 0.5, 0, Math.PI * 2);
  context.stroke();
}

function drawUtilityBox(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.1;
  const h = layout.tileHeight * 0.12;
  context.fillStyle = 'rgba(82, 82, 91, 0.75)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.strokeStyle = 'rgba(113, 113, 122, 0.85)';
  context.lineWidth = 0.6;
  context.strokeRect(screen.sx - w, screen.sy - h, w * 2, h);
}

function drawPlanter(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.12;
  const h = layout.tileHeight * 0.08;
  context.fillStyle = 'rgba(120, 53, 15, 0.8)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.fillStyle = 'rgba(34, 197, 94, 0.7)';
  context.beginPath();
  context.ellipse(screen.sx, screen.sy - h, w * 0.7, h * 0.6, 0, 0, Math.PI * 2);
  context.fill();
}

function drawParkingMarks(
  context: CanvasRenderingContext2D,
  screen: ScreenPoint,
  layout: IsoLayout,
  _seed: number,
): void {
  context.strokeStyle = 'rgba(200, 200, 200, 0.5)';
  context.lineWidth = 1;
  const w = layout.tileWidth * 0.25;
  context.beginPath();
  context.moveTo(screen.sx - w, screen.sy);
  context.lineTo(screen.sx - w, screen.sy - layout.tileHeight * 0.08);
  context.stroke();
  context.beginPath();
  context.moveTo(screen.sx + w, screen.sy);
  context.lineTo(screen.sx + w, screen.sy - layout.tileHeight * 0.08);
  context.stroke();
}

function drawLoadingDock(context: CanvasRenderingContext2D, screen: ScreenPoint, layout: IsoLayout): void {
  const w = layout.tileWidth * 0.25;
  const h = layout.tileHeight * 0.08;
  context.fillStyle = 'rgba(39, 39, 42, 0.8)';
  context.fillRect(screen.sx - w, screen.sy - h, w * 2, h);
  context.strokeStyle = 'rgba(234, 179, 8, 0.7)';
  context.lineWidth = 1;
  context.strokeRect(screen.sx - w, screen.sy - h, w * 2, h);
}

function drawAwning(
  context: CanvasRenderingContext2D,
  screen: ScreenPoint,
  layout: IsoLayout,
  seed: number,
): void {
  const w = layout.tileWidth * 0.3;
  const h = layout.tileHeight * 0.12;
  const colors = ['#f43f5e', '#3b82f6', '#22c55e', '#f59e0b'];
  const color = colors[seed % colors.length] ?? '#f43f5e';
  context.fillStyle = withAlpha(color, 0.85);
  context.beginPath();
  context.moveTo(screen.sx - w, screen.sy - h);
  context.lineTo(screen.sx + w, screen.sy - h);
  context.lineTo(screen.sx + w, screen.sy);
  context.lineTo(screen.sx - w, screen.sy);
  context.closePath();
  context.fill();
}

function drawBush(
  context: CanvasRenderingContext2D,
  screen: ScreenPoint,
  layout: IsoLayout,
  _seed: number,
): void {
  const colors = ['#2d5a27', '#3a7a34', '#1e4a1a', '#4ade80'];
  const color = colors[_seed % colors.length] ?? '#2d5a27';
  context.fillStyle = withAlpha(color, 0.7);
  context.beginPath();
  context.arc(screen.sx, screen.sy - 3, 4, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(screen.sx - 3, screen.sy - 1, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawMailbox(context: CanvasRenderingContext2D, screen: ScreenPoint, _layout: IsoLayout): void {
  context.fillStyle = 'rgba(82, 82, 91, 0.8)';
  context.fillRect(screen.sx - 2, screen.sy - 10, 4, 10);
  context.fillStyle = 'rgba(200, 200, 200, 0.9)';
  context.beginPath();
  context.arc(screen.sx, screen.sy - 10, 3, 0, Math.PI * 2);
  context.fill();
}

function drawArt(
  context: CanvasRenderingContext2D,
  screen: ScreenPoint,
  layout: IsoLayout,
  seed: number,
): void {
  const colors = ['#ec4899', '#8b5cf6', '#06b6d4', '#f97316'];
  const color = colors[seed % colors.length] ?? '#ec4899';
  context.fillStyle = withAlpha(color, 0.6);
  context.beginPath();
  context.arc(screen.sx, screen.sy - 8, 4, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = withAlpha(color, 0.9);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(screen.sx, screen.sy - 4);
  context.lineTo(screen.sx, screen.sy);
  context.stroke();
}
