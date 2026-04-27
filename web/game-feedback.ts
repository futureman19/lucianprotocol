import type { Entity } from '../src/types';
import type { IsoLayout, ScreenPoint } from './iso';
import { toScreen } from './iso';
import { withAlpha } from './facade-pipeline';
import { getLandmarkRole, getUpgradeLevel, getPowerState } from './shared-contract';

export function drawHoverAffordance(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  layout: IsoLayout,
  phase: number,
): void {
  const center = toScreen(displayX + 0.5, displayY + 0.5, 0, layout);
  const pulse = 0.5 + ((phase % 20) / 20) * 0.5;

  context.save();
  context.strokeStyle = withAlpha('#5eead4', 0.5 + pulse * 0.3);
  context.lineWidth = 1.2;
  context.setLineDash([4, 3]);
  context.beginPath();
  context.arc(center.sx, center.sy, layout.tileWidth * 0.45, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);

  // Subtle ground glow
  const glow = context.createRadialGradient(center.sx, center.sy, 0, center.sx, center.sy, layout.tileWidth * 0.5);
  glow.addColorStop(0, withAlpha('#5eead4', 0.08 * pulse));
  glow.addColorStop(1, 'rgba(94, 234, 212, 0)');
  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(center.sx, center.sy, layout.tileWidth * 0.5, layout.tileHeight * 0.3, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawAlertMarkers(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  phase: number,
): void {
  const power = getPowerState(entity);
  const nodeState = entity.node_state ?? 'stable';

  if (power === 'normal' && nodeState !== 'asymmetry') return;

  const top = toScreen(displayX + 0.5, displayY + 0.5, zBase + height + 0.2, layout);
  const blink = (phase % 12) < 6;

  context.save();

  if (power === 'offline') {
    context.fillStyle = blink ? withAlpha('#64748b', 0.9) : withAlpha('#64748b', 0.4);
    context.beginPath();
    context.arc(top.sx, top.sy - 6, 3, 0, Math.PI * 2);
    context.fill();
  } else if (power === 'overloaded') {
    context.fillStyle = blink ? withAlpha('#ef4444', 0.9) : withAlpha('#ef4444', 0.3);
    context.shadowBlur = blink ? 10 : 0;
    context.shadowColor = '#ef4444';
    context.beginPath();
    context.arc(top.sx, top.sy - 6, 3, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  } else if (power === 'strained') {
    context.fillStyle = blink ? withAlpha('#f59e0b', 0.9) : withAlpha('#f59e0b', 0.4);
    context.beginPath();
    context.arc(top.sx, top.sy - 6, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  if (nodeState === 'asymmetry') {
    context.fillStyle = blink ? withAlpha('#ef4444', 0.85) : withAlpha('#ef4444', 0.3);
    context.shadowBlur = blink ? 12 : 0;
    context.shadowColor = '#ef4444';
    context.beginPath();
    context.moveTo(top.sx, top.sy - 12);
    context.lineTo(top.sx + 4, top.sy - 4);
    context.lineTo(top.sx - 4, top.sy - 4);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
  }

  context.restore();
}

export function drawStatusAccents(
  context: CanvasRenderingContext2D,
  entity: Entity,
  projection: { left: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; right: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]; top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] },
  layout: IsoLayout,
  _phase: number,
): void {
  const upgradeLevel = getUpgradeLevel(entity);
  if (upgradeLevel <= 0) return;

  const topCenter = {
    sx: (projection.top[0].sx + projection.top[2].sx) / 2,
    sy: projection.top[0].sy - layout.tileHeight * 0.05,
  };

  context.save();
  const colors = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b'];
  const color = colors[upgradeLevel % colors.length] ?? '#22c55e';

  for (let i = 0; i < upgradeLevel; i++) {
    const x = topCenter.sx - (upgradeLevel - 1) * 4 + i * 8;
    context.fillStyle = withAlpha(color, 0.8);
    context.shadowBlur = 6;
    context.shadowColor = color;
    context.beginPath();
    context.arc(x, topCenter.sy, 2, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
  context.restore();
}

export function drawLandmarkTreatment(
  context: CanvasRenderingContext2D,
  entity: Entity,
  displayX: number,
  displayY: number,
  zBase: number,
  height: number,
  layout: IsoLayout,
  phase: number,
): void {
  const role = getLandmarkRole(entity);
  if (role === 'none') return;

  const center = toScreen(displayX + 0.5, displayY + 0.5, zBase + height + 0.3, layout);
  const pulse = 0.6 + ((phase % 30) / 30) * 0.4;

  context.save();

  let color = '#fbbf24';
  let radius = layout.tileWidth * 0.55;

  if (role === 'critical') {
    color = '#ef4444';
    radius = layout.tileWidth * 0.65;
  } else if (role === 'hub') {
    color = '#3b82f6';
  } else if (role === 'control') {
    color = '#a855f7';
  } else if (role === 'entry') {
    color = '#22c55e';
  }

  const glow = context.createRadialGradient(center.sx, center.sy, radius * 0.3, center.sx, center.sy, radius);
  glow.addColorStop(0, withAlpha(color, 0.15 * pulse));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = glow;
  context.beginPath();
  context.ellipse(center.sx, center.sy, radius, radius * 0.6, 0, 0, Math.PI * 2);
  context.fill();

  context.restore();
}
