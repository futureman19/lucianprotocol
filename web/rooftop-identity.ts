import type { IsoLayout, ScreenPoint } from './iso';
import { withAlpha, interpolateTopPoint } from './facade-pipeline';

export function drawRooftopIdentity(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  {
    archetype,
    importanceTier,
    upgradeLevel,
    seed,
    accent,
    trim,
  }: {
    archetype: string;
    importanceTier: number;
    upgradeLevel: number;
    seed: number;
    accent: string;
    trim: string;
  },
  phase: number,
): void {
  const density = (importanceTier + upgradeLevel) / 6;
  if (density < 0.15) return;

  const features: string[] = [];

  if (archetype === 'tower') {
    features.push('antenna');
    if (importanceTier >= 2) features.push('dish');
    if (upgradeLevel >= 2) features.push('helipad');
  } else if (archetype === 'factory' || archetype === 'warehouse') {
    features.push('hvac');
    if (seed % 2 === 0) features.push('solar');
  } else if (archetype === 'civic') {
    features.push('flag');
    if (importanceTier >= 2) features.push('clock');
  } else if (archetype === 'landmark') {
    features.push('billboard');
    features.push('antenna');
  } else if (archetype === 'campus') {
    features.push('garden');
  } else if (archetype === 'substation') {
    features.push('cooling');
  }

  // Deduplicate
  const unique = [...new Set(features)];

  for (let i = 0; i < unique.length; i++) {
    const u = 0.2 + (i % 3) * 0.3 + (seed % 7) * 0.05;
    const v = 0.2 + Math.floor(i / 3) * 0.3;
    const anchor = interpolateTopPoint(top, Math.min(0.8, u), Math.min(0.8, v));

    switch (unique[i]) {
      case 'antenna':
        drawAntenna(context, anchor, layout, accent);
        break;
      case 'dish':
        drawSatelliteDish(context, anchor, layout, accent);
        break;
      case 'helipad':
        drawHelipad(context, anchor, layout);
        break;
      case 'hvac':
        drawHvacUnit(context, anchor, layout, trim);
        break;
      case 'solar':
        drawSolarPanels(context, top, layout, seed);
        break;
      case 'flag':
        drawFlagPole(context, anchor, layout, accent, phase);
        break;
      case 'clock':
        drawClockTower(context, anchor, layout, trim);
        break;
      case 'billboard':
        drawBillboard(context, anchor, layout, accent);
        break;
      case 'garden':
        drawRooftopGarden(context, anchor, layout, seed);
        break;
      case 'cooling':
        drawCoolingUnit(context, anchor, layout, trim);
        break;
    }
  }
}

function drawAntenna(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  accent: string,
): void {
  const h = layout.tileHeight * 0.5;
  context.save();
  context.strokeStyle = withAlpha(accent, 0.8);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy);
  context.lineTo(anchor.sx, anchor.sy - h);
  context.stroke();

  context.beginPath();
  context.moveTo(anchor.sx - 3, anchor.sy - h * 0.6);
  context.lineTo(anchor.sx + 3, anchor.sy - h * 0.6);
  context.stroke();

  context.fillStyle = withAlpha(accent, 0.9);
  context.shadowBlur = 8;
  context.shadowColor = accent;
  context.beginPath();
  context.arc(anchor.sx, anchor.sy - h, 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSatelliteDish(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  accent: string,
): void {
  context.save();
  context.strokeStyle = withAlpha(accent, 0.7);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy);
  context.lineTo(anchor.sx, anchor.sy - layout.tileHeight * 0.2);
  context.stroke();

  context.fillStyle = withAlpha(accent, 0.5);
  context.beginPath();
  context.ellipse(anchor.sx, anchor.sy - layout.tileHeight * 0.2, layout.tileWidth * 0.06, layout.tileHeight * 0.04, 0.4, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawHelipad(context: CanvasRenderingContext2D, anchor: ScreenPoint, layout: IsoLayout): void {
  const rx = layout.tileWidth * 0.12;
  const ry = layout.tileHeight * 0.08;
  context.save();
  context.strokeStyle = 'rgba(220, 38, 38, 0.85)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.ellipse(anchor.sx, anchor.sy, rx, ry, 0, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = 'rgba(220, 38, 38, 0.8)';
  context.font = `bold ${Math.max(7, layout.tileWidth * 0.08)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('H', anchor.sx, anchor.sy - ry * 0.3);
  context.restore();
}

function drawHvacUnit(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  trim: string,
): void {
  const w = layout.tileWidth * 0.1;
  const h = layout.tileHeight * 0.06;
  context.save();
  context.fillStyle = withAlpha(trim, 0.85);
  context.fillRect(anchor.sx - w, anchor.sy - h, w * 2, h);
  context.strokeStyle = 'rgba(71, 85, 105, 0.6)';
  context.lineWidth = 0.8;
  context.strokeRect(anchor.sx - w, anchor.sy - h, w * 2, h);
  context.restore();
}

function drawSolarPanels(
  context: CanvasRenderingContext2D,
  top: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint],
  layout: IsoLayout,
  seed: number,
): void {
  const origin = interpolateTopPoint(top, 0.2 + (seed % 3) * 0.15, 0.2);
  const uVec = { sx: (top[1].sx - top[0].sx) * 0.2, sy: (top[1].sy - top[0].sy) * 0.2 };
  const vVec = { sx: (top[3].sx - top[0].sx) * 0.15, sy: (top[3].sy - top[0].sy) * 0.15 };

  context.save();
  context.fillStyle = 'rgba(30, 58, 138, 0.8)';
  context.strokeStyle = 'rgba(148, 163, 184, 0.5)';
  context.lineWidth = 0.6;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const px = origin.sx + uVec.sx * c + vVec.sx * r;
      const py = origin.sy + uVec.sy * c + vVec.sy * r;
      context.fillRect(px, py - layout.tileHeight * 0.04, Math.abs(uVec.sx), Math.abs(vVec.sy));
      context.strokeRect(px, py - layout.tileHeight * 0.04, Math.abs(uVec.sx), Math.abs(vVec.sy));
    }
  }
  context.restore();
}

function drawFlagPole(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  accent: string,
  phase: number,
): void {
  const h = layout.tileHeight * 0.5;
  context.save();
  context.strokeStyle = 'rgba(71, 85, 105, 0.9)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy);
  context.lineTo(anchor.sx, anchor.sy - h);
  context.stroke();

  const wave = Math.sin(phase * 0.1) * 3;
  context.fillStyle = withAlpha(accent, 0.85);
  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy - h + 2);
  context.lineTo(anchor.sx + layout.tileWidth * 0.1, anchor.sy - h + 4 + wave);
  context.lineTo(anchor.sx, anchor.sy - h + 10);
  context.closePath();
  context.fill();
  context.restore();
}

function drawClockTower(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  trim: string,
): void {
  context.save();
  context.fillStyle = 'rgba(241, 245, 249, 0.95)';
  context.beginPath();
  context.arc(anchor.sx, anchor.sy - layout.tileHeight * 0.15, layout.tileWidth * 0.04, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = withAlpha(trim, 0.7);
  context.lineWidth = 0.8;
  context.stroke();
  context.beginPath();
  context.moveTo(anchor.sx, anchor.sy - layout.tileHeight * 0.15);
  context.lineTo(anchor.sx, anchor.sy - layout.tileHeight * 0.2);
  context.moveTo(anchor.sx, anchor.sy - layout.tileHeight * 0.15);
  context.lineTo(anchor.sx + 2, anchor.sy - layout.tileHeight * 0.13);
  context.stroke();
  context.restore();
}

function drawBillboard(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  accent: string,
): void {
  const w = layout.tileWidth * 0.15;
  const h = layout.tileHeight * 0.2;
  context.save();
  context.fillStyle = 'rgba(30, 41, 59, 0.9)';
  context.fillRect(anchor.sx - w / 2, anchor.sy - h, w, h);
  context.fillStyle = withAlpha(accent, 0.7);
  context.fillRect(anchor.sx - w / 2 + 2, anchor.sy - h + 2, w - 4, h - 4);
  context.restore();
}

function drawRooftopGarden(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  seed: number,
): void {
  const colors = ['#22c55e', '#16a34a', '#15803d', '#4ade80'];
  context.save();
  for (let i = 0; i < 3; i++) {
    const ox = Math.sin(seed + i * 2) * layout.tileWidth * 0.08;
    const oy = Math.cos(seed + i * 3) * layout.tileHeight * 0.05;
    context.fillStyle = colors[i % colors.length] ?? '#22c55e';
    context.beginPath();
    context.arc(anchor.sx + ox, anchor.sy + oy, 3, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawCoolingUnit(
  context: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  layout: IsoLayout,
  trim: string,
): void {
  const w = layout.tileWidth * 0.12;
  const h = layout.tileHeight * 0.1;
  context.save();
  context.fillStyle = withAlpha(trim, 0.8);
  context.fillRect(anchor.sx - w, anchor.sy - h, w * 2, h);
  context.fillStyle = 'rgba(30, 41, 59, 0.7)';
  context.beginPath();
  context.ellipse(anchor.sx, anchor.sy - h, w * 0.5, h * 0.3, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
