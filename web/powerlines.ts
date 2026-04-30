import type { Entity } from '../src/types';
import { toScreen, type IsoLayout } from './iso';
import type { RoadSegment } from './city-layout';

interface Pole {
  x: number;
  y: number;
  height: number;
  isMajor: boolean;
}

interface Wire {
  from: Pole;
  to: Pole;
  isMain: boolean;
}

// Simple cache so we don't recompute the pole network every frame
let cachedSignature = '';
let cachedPoles: Pole[] = [];
let cachedWires: Wire[] = [];

function hashRoads(roads: RoadSegment[]): string {
  if (roads.length === 0) return 'empty';
  let sum = 0;
  for (let i = 0; i < Math.min(roads.length, 20); i++) {
    const r = roads[i]!;
    sum += r.fromX + r.fromY + r.toX + r.toY + r.width;
  }
  return `${roads.length}-${Math.round(sum * 100)}`;
}

function findPoles(roads: RoadSegment[], structures: Entity[]): { poles: Pole[]; wires: Wire[] } {
  const signature = hashRoads(roads);
  if (signature === cachedSignature && cachedPoles.length > 0) {
    return { poles: cachedPoles, wires: cachedWires };
  }

  const poles: Pole[] = [];
  const seen = new Set<string>();

  // Place poles at endpoints and midpoints of major roads only
  for (const road of roads) {
    if (road.width < 0.55) continue;

    const points = [
      { x: road.fromX, y: road.fromY },
      { x: road.toX, y: road.toY },
      { x: (road.fromX + road.toX) / 2, y: (road.fromY + road.toY) / 2 },
    ];

    for (const pt of points) {
      const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isMajor = road.width >= 0.65;
      poles.push({
        x: pt.x,
        y: pt.y,
        height: isMajor ? 2.8 : 2.4,
        isMajor,
      });
    }
  }

  // Cap pole count to avoid overload on dense cities
  if (poles.length > 20) {
    // Keep every Nth pole to maintain distribution
    const stride = Math.ceil(poles.length / 40);
    const thinned: Pole[] = [];
    for (let i = 0; i < poles.length; i += stride) {
      thinned.push(poles[i]!);
    }
    poles.length = 0;
    poles.push(...thinned);
  }

  // Build wires between nearby poles — limit connections heavily
  const wires: Wire[] = [];
  const maxWiresPerPole = 2;
  const connectionCounts = new Array(poles.length).fill(0);

  for (let i = 0; i < poles.length; i++) {
    if (connectionCounts[i]! >= maxWiresPerPole) continue;

    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (let j = i + 1; j < poles.length; j++) {
      if (connectionCounts[j]! >= maxWiresPerPole) continue;
      const a = poles[i]!;
      const b = poles[j]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < nearestDist && dist <= 8) {
        // Prefer grid-aligned connections
        const aligned = Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5;
        if (aligned || dist <= 4) {
          nearestDist = dist;
          nearestIdx = j;
        }
      }
    }

    if (nearestIdx >= 0) {
      wires.push({
        from: poles[i]!,
        to: poles[nearestIdx]!,
        isMain: poles[i]!.isMajor && poles[nearestIdx]!.isMajor,
      });
      connectionCounts[i]! += 1;
      connectionCounts[nearestIdx]! += 1;
    }
  }

  // Limited service drops to buildings
  let drops = 0;
  const maxDrops = Math.min(4, Math.floor(poles.length / 4));
  for (const pole of poles) {
    if (drops >= maxDrops) break;
    if (!pole.isMajor && Math.random() > 0.4) continue;

    let nearest: Entity | null = null;
    let nearestDist = Infinity;
    for (const entity of structures) {
      if (entity.type !== 'file' && entity.type !== 'directory') continue;
      const d = Math.hypot(entity.x + 0.5 - pole.x, entity.y + 0.5 - pole.y);
      if (d < nearestDist && d < 4) {
        nearestDist = d;
        nearest = entity;
      }
    }
    if (nearest) {
      wires.push({
        from: pole,
        to: {
          x: nearest.x + 0.5,
          y: nearest.y + 0.5,
          height: 1.2 + (nearest.current_height ?? nearest.target_height ?? 12) * 0.04,
          isMajor: false,
        },
        isMain: false,
      });
      drops += 1;
    }
  }

  cachedSignature = signature;
  cachedPoles = poles;
  cachedWires = wires;
  return { poles, wires };
}

function drawPole(
  context: CanvasRenderingContext2D,
  pole: Pole,
  layout: IsoLayout,
  phase: number,
): void {
  const base = toScreen(pole.x, pole.y, 0.06, layout);
  const top = toScreen(pole.x, pole.y, pole.height, layout);
  const crossY = toScreen(pole.x, pole.y, pole.height * 0.92, layout);

  context.save();

  // Shadow
  context.fillStyle = 'rgba(0, 0, 0, 0.15)';
  context.beginPath();
  context.ellipse(base.sx, base.sy + 2, 3, 1.5, 0, 0, Math.PI * 2);
  context.fill();

  // Pole shaft
  context.strokeStyle = 'rgba(90, 82, 72, 0.92)';
  context.lineWidth = 2.2;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(base.sx, base.sy);
  context.lineTo(top.sx, top.sy);
  context.stroke();

  // Crossarm
  const armLength = layout.tileWidth * 0.18;
  context.strokeStyle = 'rgba(80, 72, 64, 0.9)';
  context.lineWidth = 1.6;
  context.beginPath();
  context.moveTo(crossY.sx - armLength, crossY.sy);
  context.lineTo(crossY.sx + armLength, crossY.sy);
  context.stroke();

  // Insulators
  context.fillStyle = 'rgba(200, 60, 40, 0.85)';
  context.beginPath();
  context.arc(crossY.sx - armLength * 0.65, crossY.sy + 2, 1.8, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(crossY.sx + armLength * 0.65, crossY.sy + 2, 1.8, 0, Math.PI * 2);
  context.fill();

  // Warning light on top — blink every 2 seconds instead of every frame jitter
  const blink = 0.6 + Math.sin(phase * 0.06) * 0.4;
  context.fillStyle = `rgba(255, 60, 40, ${blink})`;
  context.shadowBlur = 10 * blink;
  context.shadowColor = `rgba(255, 60, 40, ${blink * 0.6})`;
  context.beginPath();
  context.arc(top.sx, top.sy, 1.6, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  context.restore();
}

function drawWire(
  context: CanvasRenderingContext2D,
  wire: Wire,
  layout: IsoLayout,
  phase: number,
): void {
  const from = toScreen(wire.from.x, wire.from.y, wire.from.height * 0.92, layout);
  const to = toScreen(wire.to.x, wire.to.y, wire.to.height * 0.92, layout);

  context.save();
  context.lineCap = 'round';

  if (wire.isMain) {
    context.strokeStyle = 'rgba(45, 40, 35, 0.55)';
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();

    context.strokeStyle = 'rgba(180, 220, 255, 0.35)';
    context.lineWidth = 0.7;
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();
  } else {
    context.strokeStyle = 'rgba(55, 50, 45, 0.4)';
    context.lineWidth = 1.0;
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();

    context.strokeStyle = 'rgba(160, 200, 235, 0.22)';
    context.lineWidth = 0.5;
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.stroke();
  }

  // Single energy pulse per wire, slower frequency
  const pulseT = ((phase * 1.5) % 100) / 100;
  const px = from.sx + (to.sx - from.sx) * pulseT;
  const py = from.sy + (to.sy - from.sy) * pulseT;
  const pulseSize = wire.isMain ? 1.8 : 1.2;
  const pulseAlpha = wire.isMain ? 0.6 : 0.35;

  context.fillStyle = `rgba(200, 235, 255, ${pulseAlpha})`;
  context.shadowBlur = 4;
  context.shadowColor = `rgba(120, 200, 255, ${pulseAlpha * 0.5})`;
  context.beginPath();
  context.arc(px, py, pulseSize, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  context.restore();
}

export function drawPowerlines(
  context: CanvasRenderingContext2D,
  entities: Entity[],
  roads: RoadSegment[],
  layout: IsoLayout,
  phase: number,
): void {
  if (layout.tileWidth < 14) return;

  const structures = entities.filter((e) => e.type === 'file' || e.type === 'directory');
  const { poles, wires } = findPoles(roads, structures);

  // Draw wires first so poles appear on top
  for (const wire of wires) {
    drawWire(context, wire, layout, phase);
  }

  for (const pole of poles) {
    drawPole(context, pole, layout, phase);
  }
}
