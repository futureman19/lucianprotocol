import type { Entity } from '../src/types';
import { getDistrictAtTile, getRoadTileKeys, isWaterTile, type CityLayout } from './city-layout';
import { createPrismProjection, toScreen, type IsoLayout, type ScreenPoint } from './iso';


export interface Car {
  roadIndex: number;
  progress: number;
  speed: number;
  color: string;
  headlightColor: string;
  width: number;
  length: number;
  direction: number;
  isTruck?: boolean;
  isBus?: boolean;
}

export interface TrafficSystem {
  cars: Car[];
  lastSpawnTick: number;
}

type Road = CityLayout['roads'][number];
type District = CityLayout['districts'][number];

const ROAD_TILE_KEYS_CACHE = new WeakMap<Road[], Set<string>>();
let cachedIntersectionRoads: Road[] | null = null;
let cachedIntersectionStructures: Entity[] | null = null;
let cachedIntersections: Array<{ x: number; y: number }> = [];

const CAR_COLORS = [
  { body: '#ef4444', headlight: '#fff7cc' },
  { body: '#3b82f6', headlight: '#f8fafc' },
  { body: '#f59e0b', headlight: '#fff4d6' },
  { body: '#10b981', headlight: '#ecfeff' },
  { body: '#8b5cf6', headlight: '#f5f3ff' },
  { body: '#f97316', headlight: '#ffedd5' },
  { body: '#e5e7eb', headlight: '#ffffff' },
] as const;

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const normalized = color.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    return color;
  }

  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${alpha})`;
}

function daylightFromPhase(phase: number): number {
  return 0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2));
}

function noise2d(x: number, y: number): number {
  const value = Math.sin((x * 12.9898) + (y * 78.233)) * 43758.5453;
  return value - Math.floor(value);
}

function fillFace(context: CanvasRenderingContext2D, points: ScreenPoint[], fill: string, stroke: string): void {
  const first = points[0];
  if (!first) {
    return;
  }

  context.beginPath();
  context.moveTo(first.sx, first.sy);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point) {
      context.lineTo(point.sx, point.sy);
    }
  }
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 0.6;
  context.stroke();
}

function drawLampPost(
  context: CanvasRenderingContext2D,
  base: ScreenPoint,
  layout: IsoLayout,
  nightFactor: number,
): void {
  context.save();
  context.strokeStyle = 'rgba(82, 89, 101, 0.95)';
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(base.sx, base.sy);
  context.lineTo(base.sx, base.sy - (layout.tileHeight * 0.9));
  context.stroke();

  context.beginPath();
  context.arc(base.sx, base.sy - (layout.tileHeight * 0.95), 2.2, 0, Math.PI * 2);
  context.fillStyle = `rgba(255, 236, 184, ${0.2 + (nightFactor * 0.75)})`;
  context.shadowBlur = 8 + (nightFactor * 10);
  context.shadowColor = `rgba(255, 226, 148, ${0.18 + (nightFactor * 0.45)})`;
  context.fill();

  if (nightFactor > 0.4) {
    const gradient = context.createRadialGradient(
      base.sx, base.sy, 0,
      base.sx, base.sy, layout.tileWidth * 0.6
    );
    gradient.addColorStop(0, `rgba(255, 230, 150, ${nightFactor * 0.25})`);
    gradient.addColorStop(1, 'rgba(255, 230, 150, 0)');
    context.shadowBlur = 0;
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(base.sx, base.sy, layout.tileWidth * 0.6, layout.tileHeight * 0.35, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawTree(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
  crownColor: string,
): void {
  const trunk = toScreen(x + 0.5, y + 0.5, 0.08, layout);
  context.save();
  context.fillStyle = 'rgba(92, 51, 23, 0.95)';
  context.fillRect(trunk.sx - 1.5, trunk.sy - 10, 3, 10);
  context.beginPath();
  context.arc(trunk.sx, trunk.sy - 12, 7, 0, Math.PI * 2);
  context.fillStyle = crownColor;
  context.shadowBlur = 8;
  context.shadowColor = withAlpha(crownColor, 0.3);
  context.fill();
  context.restore();
}

function drawBench(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(120, 86, 56, 0.95)';
  context.fillRect(p.sx - 6, p.sy - 3, 12, 2);
  context.fillRect(p.sx - 5, p.sy - 1, 1.5, 4);
  context.fillRect(p.sx + 3.5, p.sy - 1, 1.5, 4);
  context.restore();
}

function drawContainer(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
  color: string,
): void {
  const projection = createPrismProjection(x + 0.18, y + 0.2, 0.04, 0.64, 0.52, 0.28, layout);
  fillFace(context, projection.left, withAlpha(color, 0.88), withAlpha('#334155', 0.28));
  fillFace(context, projection.right, withAlpha(color, 0.95), withAlpha('#334155', 0.28));
  fillFace(context, projection.top, withAlpha('#cbd5e1', 0.28), withAlpha('#ffffff', 0.08));
}

function drawDockPost(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const base = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(90, 62, 35, 0.95)';
  context.fillRect(base.sx - 2, base.sy - 12, 4, 12);
  context.fillStyle = 'rgba(241, 245, 249, 0.9)';
  context.fillRect(base.sx - 4, base.sy - 12, 8, 2);
  context.restore();
}

function drawParkingLines(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p1 = toScreen(x + 0.2, y + 0.2, 0.03, layout);
  const p2 = toScreen(x + 0.8, y + 0.2, 0.03, layout);
  const p3 = toScreen(x + 0.2, y + 0.5, 0.03, layout);
  const p4 = toScreen(x + 0.8, y + 0.5, 0.03, layout);

  context.save();
  context.strokeStyle = 'rgba(220, 225, 230, 0.7)';
  context.lineWidth = 1.2;
  context.setLineDash([4, 3]);

  context.beginPath();
  context.moveTo(p1.sx, p1.sy);
  context.lineTo(p2.sx, p2.sy);
  context.stroke();

  context.beginPath();
  context.moveTo(p3.sx, p3.sy);
  context.lineTo(p4.sx, p4.sy);
  context.stroke();

  context.setLineDash([]);
  context.restore();
}

function drawPlanter(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(160, 82, 45, 0.9)';
  context.fillRect(p.sx - 4, p.sy - 3, 8, 4);
  context.fillStyle = 'rgba(74, 222, 128, 0.85)';
  context.beginPath();
  context.arc(p.sx - 1.5, p.sy - 4, 2.5, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(p.sx + 1.5, p.sy - 3.5, 2, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(p.sx, p.sy - 5, 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawTrashBin(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(80, 85, 90, 0.92)';
  context.fillRect(p.sx - 2.5, p.sy - 7, 5, 7);
  context.fillStyle = 'rgba(60, 65, 70, 0.95)';
  context.fillRect(p.sx - 2, p.sy - 6, 4, 5);
  context.restore();
}

function drawFireHydrant(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(200, 50, 50, 0.92)';
  context.fillRect(p.sx - 1.5, p.sy - 5, 3, 5);
  context.fillStyle = 'rgba(180, 40, 40, 0.95)';
  context.fillRect(p.sx - 2, p.sy - 3, 4, 1.5);
  context.restore();
}

function drawMailbox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(60, 60, 65, 0.9)';
  context.fillRect(p.sx - 1, p.sy - 8, 2, 8);
  context.fillStyle = 'rgba(50, 50, 55, 0.95)';
  context.fillRect(p.sx - 3, p.sy - 10, 6, 4);
  context.restore();
}

function drawCrosswalk(
  context: CanvasRenderingContext2D,
  pt: { x: number; y: number },
  road: Road,
  layout: IsoLayout,
): void {
  const screenPt = toScreen(pt.x, pt.y, 0.04, layout);
  const isHorizontal = Math.abs(road.fromY - road.toY) < 0.01;
  const stripeCount = 4;
  const stripeLen = layout.tileWidth * 0.12;
  const stripeW = layout.tileHeight * 0.04;

  context.save();
  context.fillStyle = 'rgba(250, 250, 245, 0.75)';
  for (let i = 0; i < stripeCount; i++) {
    const offset = (i - (stripeCount - 1) / 2) * stripeLen * 1.4;
    if (isHorizontal) {
      context.fillRect(screenPt.sx + offset - stripeLen / 2, screenPt.sy - stripeW / 2, stripeLen, stripeW);
    } else {
      context.fillRect(screenPt.sx - stripeW / 2, screenPt.sy + offset - stripeLen / 2, stripeW, stripeLen);
    }
  }
  context.restore();
}

function drawStreetSign(
  context: CanvasRenderingContext2D,
  pt: { x: number; y: number },
  name: string,
  layout: IsoLayout,
): void {
  const base = toScreen(pt.x, pt.y, 0.04, layout);
  context.save();
  context.fillStyle = 'rgba(71, 85, 105, 0.9)';
  context.fillRect(base.sx - 1, base.sy - 14, 2, 14);
  context.fillStyle = 'rgba(248, 250, 252, 0.92)';
  context.fillRect(base.sx - 16, base.sy - 18, 32, 8);
  context.strokeStyle = 'rgba(71, 85, 105, 0.5)';
  context.lineWidth = 0.6;
  context.strokeRect(base.sx - 16, base.sy - 18, 32, 8);
  context.fillStyle = 'rgba(30, 41, 59, 0.85)';
  context.font = `500 ${Math.max(7, layout.tileWidth * 0.07)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name.slice(0, 10), base.sx, base.sy - 14);
  context.restore();
}

function drawFence(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.strokeStyle = 'rgba(140, 120, 90, 0.7)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(p.sx - 6, p.sy - 2);
  context.lineTo(p.sx - 6, p.sy - 6);
  context.moveTo(p.sx + 6, p.sy - 2);
  context.lineTo(p.sx + 6, p.sy - 6);
  context.stroke();
  context.beginPath();
  context.moveTo(p.sx - 6, p.sy - 4);
  context.lineTo(p.sx + 6, p.sy - 4);
  context.moveTo(p.sx - 6, p.sy - 5.5);
  context.lineTo(p.sx + 6, p.sy - 5.5);
  context.stroke();
  context.restore();
}

function drawHedge(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  layout: IsoLayout,
): void {
  const p = toScreen(x + 0.5, y + 0.5, 0.06, layout);
  context.save();
  context.fillStyle = 'rgba(60, 130, 50, 0.75)';
  context.fillRect(p.sx - 7, p.sy - 5, 14, 5);
  context.fillStyle = 'rgba(80, 160, 65, 0.6)';
  context.fillRect(p.sx - 6, p.sy - 6, 12, 2);
  context.restore();
}

function getTilePalette(
  x: number,
  y: number,
  cityLayout: CityLayout,
  roadTiles: Set<string>,
): { left: string; right: string; top: string } {
  const district = getDistrictAtTile(cityLayout, x, y);
  const roadTile = roadTiles.has(`${x},${y}`);

  if (isWaterTile(cityLayout, x, y)) {
    return {
      left: 'rgba(15, 85, 126, 0.95)',
      right: 'rgba(18, 107, 158, 0.98)',
      top: 'rgba(59, 146, 201, 0.94)',
    };
  }

  if (roadTile) {
    return {
      left: 'rgba(102, 94, 78, 0.95)',
      right: 'rgba(125, 116, 94, 0.96)',
      top: 'rgba(164, 153, 126, 0.94)',
    };
  }

  if (district?.type === 'industrial') {
    return {
      left: 'rgba(92, 79, 58, 0.96)',
      right: 'rgba(118, 100, 74, 0.97)',
      top: 'rgba(160, 136, 101, 0.94)',
    };
  }

  if (district?.type === 'downtown') {
    return {
      left: 'rgba(90, 92, 96, 0.96)',
      right: 'rgba(105, 107, 112, 0.97)',
      top: 'rgba(130, 133, 138, 0.94)',
    };
  }

  if (district?.type === 'park') {
    return {
      left: 'rgba(55, 118, 62, 0.98)',
      right: 'rgba(63, 145, 72, 0.99)',
      top: 'rgba(104, 183, 102, 0.94)',
    };
  }

  const seed = noise2d(x, y);
  if (seed > 0.82) {
    return {
      left: 'rgba(108, 113, 120, 0.96)',
      right: 'rgba(125, 130, 138, 0.97)',
      top: 'rgba(150, 155, 162, 0.94)',
    };
  }

  return {
    left: 'rgba(100, 105, 112, 0.96)',
    right: 'rgba(115, 120, 128, 0.97)',
    top: 'rgba(140, 145, 152, 0.94)',
  };
}

function hasAdjacentRoadTile(x: number, y: number, roadTiles: Set<string>): boolean {
  return (
    roadTiles.has(`${x - 1},${y}`) ||
    roadTiles.has(`${x + 1},${y}`) ||
    roadTiles.has(`${x},${y - 1}`) ||
    roadTiles.has(`${x},${y + 1}`)
  );
}

function hasAdjacentLandTile(x: number, y: number, cityLayout: CityLayout): boolean {
  const neighbors = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ];

  return neighbors.some((neighbor) => {
    if (neighbor.x < 0 || neighbor.x > 49 || neighbor.y < 0 || neighbor.y > 49) {
      return false;
    }

    return !isWaterTile(cityLayout, neighbor.x, neighbor.y);
  });
}

function segmentsIntersect(
  a: Road,
  b: Road,
): { x: number; y: number } | null {
  // For axis-aligned segments, find the actual crossing point.
  const aHoriz = Math.abs(a.fromY - a.toY) < 0.01;
  const bHoriz = Math.abs(b.fromY - b.toY) < 0.01;

  // Parallel segments don't cross (we ignore collinear overlap for intersections)
  if (aHoriz === bHoriz) return null;

  const h = aHoriz ? a : b;
  const v = aHoriz ? b : a;

  const hy = h.fromY;
  const vx = v.fromX;

  const hMin = Math.min(h.fromX, h.toX);
  const hMax = Math.max(h.fromX, h.toX);
  const vMin = Math.min(v.fromY, v.toY);
  const vMax = Math.max(v.fromY, v.toY);

  if (vx >= hMin && vx <= hMax && hy >= vMin && hy <= vMax) {
    return { x: vx, y: hy };
  }

  return null;
}

function findRoadIntersections(roads: Road[], structures: Entity[]): Array<{ x: number; y: number }> {
  const seen = new Set<string>();
  const intersections: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const pt = segmentsIntersect(roads[i]!, roads[j]!);
      if (!pt) continue;

      // Only mark intersections near actual buildings — keeps the visual clean
      const hasBuildingNearby = structures.some((e) => {
        if (e.type !== 'file' && e.type !== 'directory') {
          return false;
        }
        const dx = Math.abs(e.x + 0.5 - pt.x);
        const dy = Math.abs(e.y + 0.5 - pt.y);
        return dx <= 2.5 && dy <= 2.5;
      });
      if (!hasBuildingNearby) continue;

      const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
      if (!seen.has(key)) {
        seen.add(key);
        intersections.push(pt);
      }
    }
  }
  return intersections;
}

function getCachedRoadTileKeys(roads: Road[]): Set<string> {
  const cached = ROAD_TILE_KEYS_CACHE.get(roads);
  if (cached) {
    return cached;
  }

  const roadTiles = getRoadTileKeys(roads);
  ROAD_TILE_KEYS_CACHE.set(roads, roadTiles);
  return roadTiles;
}

function getCachedRoadIntersections(roads: Road[], structures: Entity[]): Array<{ x: number; y: number }> {
  if (cachedIntersectionRoads === roads && cachedIntersectionStructures === structures) {
    return cachedIntersections;
  }

  cachedIntersectionRoads = roads;
  cachedIntersectionStructures = structures;
  cachedIntersections = findRoadIntersections(roads, structures);
  return cachedIntersections;
}

export function createTrafficSystem(): TrafficSystem {
  return { cars: [], lastSpawnTick: 0 };
}

export function spawnCars(
  traffic: TrafficSystem,
  roadCount: number,
  totalTrafficDensity: number,
  tick: number,
  roads?: Road[],
  entities?: Entity[],
): void {
  const targetCars = Math.floor(totalTrafficDensity * 2);

  if (traffic.cars.length < targetCars && roadCount > 0 && tick - traffic.lastSpawnTick > 20) {
    traffic.lastSpawnTick = tick;
    const roadIndex = Math.floor(Math.random() * roadCount);
    const road = roads?.[roadIndex];
    let destEntity: Entity | null = null;
    if (road && entities) {
      let minD = Infinity;
      for (const e of entities) {
        const d = Math.hypot(e.x - road.toX, e.y - road.toY);
        if (d < minD) {
          minD = d;
          destEntity = e;
        }
      }
    }
    
    const colorSet = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] ?? CAR_COLORS[0];
    let bodyColor: string = colorSet?.body ?? '#fff';
    const headlightColor = colorSet?.headlight ?? '#fff';
    
    if (destEntity && road && Math.hypot(destEntity.x - road.toX, destEntity.y - road.toY) < 10) {
      // Use a consistent hash-based color instead of getFilePalette to avoid circular deps if needed
      // Actually we can just hash the file extension
      const ext = destEntity.extension || '.ts';
      const hash = Array.from(ext).reduce((acc, char) => acc + char.charCodeAt(0), 0);
      bodyColor = `hsl(${hash % 360}, 70%, 50%)`;
    }
    
    const isModifiedRecently = destEntity != null && (tick - (destEntity.tick_updated || 0) < 100);
    const isTruck = isModifiedRecently && Math.random() < 0.5;
    const isBus = !isTruck && Math.random() < 0.1;
    
    traffic.cars.push({
      roadIndex,
      progress: Math.random() * 0.4,
      speed: isTruck || isBus ? (0.001 + (Math.random() * 0.003)) : (0.002 + (Math.random() * 0.006)),
      color: bodyColor,
      headlightColor,
      width: isTruck ? 0.18 : (isBus ? 0.16 : 0.12),
      length: isTruck ? 0.4 : (isBus ? 0.5 : 0.2),
      direction: 0,
      isTruck: Boolean(isTruck),
      isBus: Boolean(isBus),
    });
  }

  traffic.cars = traffic.cars.filter((car) => car.progress < 1);
}

export function updateCars(traffic: TrafficSystem, deltaTime: number): void {
  for (let i = 0; i < traffic.cars.length; i++) {
    const car = traffic.cars[i]!;
    let speedMult = 1;
    for (let j = 0; j < traffic.cars.length; j++) {
      if (i !== j) {
        const other = traffic.cars[j]!;
        if (other.roadIndex === car.roadIndex && other.progress > car.progress && other.progress - car.progress < 0.15) {
          speedMult = 0.2;
          break;
        }
      }
    }
    car.progress += car.speed * speedMult * deltaTime;
  }
}

export function drawRoadsAndTraffic(
  context: CanvasRenderingContext2D,
  roads: Road[],
  traffic: TrafficSystem,
  layout: IsoLayout,
  phase: number,
  structures: Entity[],
): void {
  const daylight = daylightFromPhase(phase);
  const nightFactor = 1 - daylight;

  // Road corridor = half a grid block wide.
  // The corridor has grass verges on the edges and narrow asphalt in the centre.
  const GRASS_COLOR = `rgba(${Math.round(55 + (30 * daylight))}, ${Math.round(95 + (25 * daylight))}, ${Math.round(55 + (20 * daylight))}, 0.9)`;
  const ASPHALT_COLOR = `rgba(${Math.round(40 + (25 * daylight))}, ${Math.round(42 + (28 * daylight))}, ${Math.round(47 + (32 * daylight))}, 0.98)`;

  // Phase 1: grass corridors (the full half-block width)
  for (const road of roads) {
    const from = toScreen(road.fromX, road.fromY, 0.025, layout);
    const to = toScreen(road.toX, road.toY, 0.025, layout);
    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const nx = -dy / len;
    const ny = dx / len;
    const corridorHalf = road.width * layout.tileWidth * 0.48;

    context.beginPath();
    context.moveTo(from.sx + (nx * corridorHalf), from.sy + (ny * corridorHalf));
    context.lineTo(to.sx + (nx * corridorHalf), to.sy + (ny * corridorHalf));
    context.lineTo(to.sx - (nx * corridorHalf), to.sy - (ny * corridorHalf));
    context.lineTo(from.sx - (nx * corridorHalf), from.sy - (ny * corridorHalf));
    context.closePath();
    context.fillStyle = GRASS_COLOR;
    context.fill();
  }

  // Phase 2: intersection grass patches
  const intersections = getCachedRoadIntersections(roads, structures);
  for (const pt of intersections) {
    const screenPt = toScreen(pt.x, pt.y, 0.03, layout);
    context.save();
    context.beginPath();
    context.ellipse(screenPt.sx, screenPt.sy, layout.tileWidth * 0.42, layout.tileHeight * 0.3, 0, 0, Math.PI * 2);
    context.fillStyle = GRASS_COLOR;
    context.fill();
    context.restore();
  }

  // Phase 3: narrow asphalt strips (about 45 % of the corridor width)
  for (const road of roads) {
    const from = toScreen(road.fromX, road.fromY, 0.025, layout);
    const to = toScreen(road.toX, road.toY, 0.025, layout);
    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const nx = -dy / len;
    const ny = dx / len;
    const corridorHalf = road.width * layout.tileWidth * 0.48;
    const asphaltHalf = corridorHalf * 0.45;

    context.beginPath();
    context.moveTo(from.sx + (nx * asphaltHalf), from.sy + (ny * asphaltHalf));
    context.lineTo(to.sx + (nx * asphaltHalf), to.sy + (ny * asphaltHalf));
    context.lineTo(to.sx - (nx * asphaltHalf), to.sy - (ny * asphaltHalf));
    context.lineTo(from.sx - (nx * asphaltHalf), from.sy - (ny * asphaltHalf));
    context.closePath();
    context.fillStyle = ASPHALT_COLOR;
    context.fill();
  }

  // Phase 4: intersection asphalt patches (smaller, centred)
  for (const pt of intersections) {
    const screenPt = toScreen(pt.x, pt.y, 0.035, layout);
    context.save();
    context.beginPath();
    context.ellipse(screenPt.sx, screenPt.sy, layout.tileWidth * 0.2, layout.tileHeight * 0.14, 0, 0, Math.PI * 2);
    context.fillStyle = ASPHALT_COLOR;
    context.fill();
    context.restore();
  }

  // Phase 4b: crosswalks at intersections
  for (const pt of intersections) {
    for (const road of roads) {
      const rMinX = Math.min(road.fromX, road.toX);
      const rMaxX = Math.max(road.fromX, road.toX);
      const rMinY = Math.min(road.fromY, road.toY);
      const rMaxY = Math.max(road.fromY, road.toY);
      if (pt.x >= rMinX - 0.1 && pt.x <= rMaxX + 0.1 && pt.y >= rMinY - 0.1 && pt.y <= rMaxY + 0.1) {
        drawCrosswalk(context, pt, road, layout);
      }
    }
  }

  // Phase 4c: street name signs at intersections
  if (layout.tileWidth > 16) {
    for (let i = 0; i < intersections.length && i < roads.length; i++) {
      const pt = intersections[i];
      const road = roads[i];
      if (road && pt) {
        drawStreetSign(context, pt, road.name, layout);
      }
    }
  }

  // Phase 5: curbs, centre lines, and lamp posts
  for (const road of roads) {
    const from = toScreen(road.fromX, road.fromY, 0.025, layout);
    const to = toScreen(road.toX, road.toY, 0.025, layout);
    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const nx = -dy / len;
    const ny = dx / len;
    const corridorHalf = road.width * layout.tileWidth * 0.48;
    const asphaltHalf = corridorHalf * 0.45;
    const curbOffset = asphaltHalf + 1.0;

    context.lineCap = 'round';
    context.lineJoin = 'round';

    // Inner curb edges — where grass meets asphalt
    context.beginPath();
    context.moveTo(from.sx + (nx * curbOffset), from.sy + (ny * curbOffset));
    context.lineTo(to.sx + (nx * curbOffset), to.sy + (ny * curbOffset));
    context.strokeStyle = `rgba(${Math.round(120 + (20 * daylight))}, ${Math.round(130 + (15 * daylight))}, ${Math.round(110 + (15 * daylight))}, 0.85)`;
    context.lineWidth = 1.2;
    context.stroke();

    context.beginPath();
    context.moveTo(from.sx - (nx * curbOffset), from.sy - (ny * curbOffset));
    context.lineTo(to.sx - (nx * curbOffset), to.sy - (ny * curbOffset));
    context.strokeStyle = `rgba(${Math.round(110 + (20 * daylight))}, ${Math.round(120 + (15 * daylight))}, ${Math.round(100 + (15 * daylight))}, 0.85)`;
    context.lineWidth = 1.2;
    context.stroke();

    // Centre dashed line
    context.beginPath();
    context.moveTo(from.sx, from.sy);
    context.lineTo(to.sx, to.sy);
    context.strokeStyle = `rgba(252, 211, 77, ${0.55 + (daylight * 0.25)})`;
    context.lineWidth = 1.0;
    context.setLineDash([5, 9]);
    context.stroke();
    context.setLineDash([]);

    // Lamp posts on the grass verges
    if (layout.tileWidth > 24) {
      const lightCount = Math.max(2, Math.floor(len / 220));
      for (let index = 1; index <= lightCount; index += 1) {
        const t = index / (lightCount + 1);
        const px = from.sx + (dx * t);
        const py = from.sy + (dy * t);
        drawLampPost(context, { sx: px + (nx * (corridorHalf - 3)), sy: py + (ny * (corridorHalf - 3)) }, layout, nightFactor);
        drawLampPost(context, { sx: px - (nx * (corridorHalf - 3)), sy: py - (ny * (corridorHalf - 3)) }, layout, nightFactor);
      }
    }
  }

  for (const car of traffic.cars) {
    const road = roads[car.roadIndex];
    if (!road) {
      continue;
    }

    const from = toScreen(road.fromX, road.fromY, 0.055, layout);
    const to = toScreen(road.toX, road.toY, 0.055, layout);
    const dx = to.sx - from.sx;
    const dy = to.sy - from.sy;
    const angle = Math.atan2(dy, dx);
    car.direction = angle;

    const x = from.sx + (dx * car.progress);
    const y = from.sy + (dy * car.progress);
    const laneOffsetX = -Math.sin(angle) * road.width * layout.tileWidth * 0.14;
    const laneOffsetY = Math.cos(angle) * road.width * layout.tileWidth * 0.14;

    const carWidth = car.width * layout.tileWidth;
    const carLength = car.length * layout.tileWidth;
    const isTruck = car.length > 0.055;
    const isBus = car.length > 0.075;

    context.save();
    context.translate(x + laneOffsetX, y + laneOffsetY);
    context.rotate(angle);

    // Drop shadow
    context.fillStyle = 'rgba(0, 0, 0, 0.28)';
    context.beginPath();
    context.roundRect((-carLength / 2) + 2, (-carWidth / 2) + 2, carLength, carWidth, 2);
    context.fill();

    // Body with slight gradient
    const gradient = context.createLinearGradient(-carLength/2, 0, carLength/2, 0);
    gradient.addColorStop(0, withAlpha(car.color, 0.8));
    gradient.addColorStop(0.5, car.color);
    gradient.addColorStop(1, withAlpha(car.color, 0.9));
    context.fillStyle = gradient;
    context.beginPath();
    context.roundRect(-carLength / 2, -carWidth / 2, carLength, carWidth, isTruck ? 1 : 2.5);
    context.fill();
    // Add specular highlight to body
    context.fillStyle = 'rgba(255,255,255,0.15)';
    context.fillRect(-carLength/2 + 1, -carWidth/2 + 1, carLength - 2, carWidth/2);

    // Roof / cabin detail
    if (isBus) {
      // Bus: large windows strip
      context.fillStyle = 'rgba(180, 210, 230, 0.7)';
      context.fillRect(-carLength * 0.42, -carWidth * 0.35, carLength * 0.84, carWidth * 0.7);
      // Bus roof
      context.fillStyle = withAlpha(car.color, 0.7);
      context.fillRect(-carLength * 0.38, -carWidth * 0.3, carLength * 0.76, carWidth * 0.6);
      // AC Unit
      context.fillStyle = 'rgba(200, 200, 200, 0.8)';
      context.fillRect(-carLength * 0.1, -carWidth * 0.15, carLength * 0.15, carWidth * 0.3);
    } else if (isTruck) {
      // Truck: cab + cargo box
      // Cab
      context.fillStyle = 'rgba(180, 210, 230, 0.6)';
      context.fillRect(-carLength * 0.35, -carWidth * 0.35, carLength * 0.25, carWidth * 0.7);
      context.fillStyle = car.color;
      context.fillRect(-carLength * 0.32, -carWidth * 0.3, carLength * 0.18, carWidth * 0.6);
      // Cargo Box
      context.fillStyle = 'rgba(230, 235, 240, 0.95)';
      context.fillRect(carLength * 0.0, -carWidth * 0.45, carLength * 0.48, carWidth * 0.9);
      // Cargo box detailing (lines)
      context.strokeStyle = 'rgba(200, 205, 210, 0.8)';
      context.lineWidth = 0.5;
      for(let i=1; i<4; i++) {
         context.beginPath();
         context.moveTo(carLength * 0.0 + (carLength * 0.48 * (i/4)), -carWidth * 0.45);
         context.lineTo(carLength * 0.0 + (carLength * 0.48 * (i/4)), carWidth * 0.45);
         context.stroke();
      }
    } else {
      // Car: windshield + roof
      context.fillStyle = 'rgba(180, 210, 230, 0.6)';
      context.beginPath();
      context.roundRect(-carLength * 0.15, -carWidth * 0.35, carLength * 0.45, carWidth * 0.7, 1);
      context.fill();
      // Roof
      context.fillStyle = car.color;
      context.beginPath();
      context.roundRect(-carLength * 0.08, -carWidth * 0.3, carLength * 0.25, carWidth * 0.6, 1);
      context.fill();
    }

    // Wheels (more rounded and pronounced)
    const wheelColor = 'rgba(20, 20, 25, 0.9)';
    const wheelRadius = Math.max(1.8, carWidth * 0.2);
    const frontWheelX = carLength * 0.28;
    const backWheelX = -carLength * 0.28;
    const wheelY = carWidth * 0.42;
    context.fillStyle = wheelColor;
    // Front wheels
    context.beginPath(); context.roundRect(frontWheelX - wheelRadius, -wheelY - wheelRadius*0.5, wheelRadius*2, wheelRadius, 1); context.fill();
    context.beginPath(); context.roundRect(frontWheelX - wheelRadius, wheelY - wheelRadius*0.5, wheelRadius*2, wheelRadius, 1); context.fill();
    // Back wheels
    context.beginPath(); context.roundRect(backWheelX - wheelRadius, -wheelY - wheelRadius*0.5, wheelRadius*2, wheelRadius, 1); context.fill();
    context.beginPath(); context.roundRect(backWheelX - wheelRadius, wheelY - wheelRadius*0.5, wheelRadius*2, wheelRadius, 1); context.fill();

    // Grille
    context.fillStyle = 'rgba(40, 40, 45, 0.8)';
    context.fillRect((carLength / 2) - 1.5, -carWidth * 0.2, 1.5, carWidth * 0.4);

    // Headlights
    context.fillStyle = withAlpha(car.headlightColor, 0.6 + (nightFactor * 0.4));
    context.shadowBlur = 10 + (nightFactor * 15);
    context.shadowColor = withAlpha(car.headlightColor, 0.4 + (nightFactor * 0.6));
    context.fillRect((carLength / 2) - 2, -carWidth * 0.35, 2.5, carWidth * 0.15);
    context.fillRect((carLength / 2) - 2, carWidth * 0.2, 2.5, carWidth * 0.15);
    
    // Headlight cones at night
    if (nightFactor > 0.4) {
      context.fillStyle = `rgba(255, 245, 200, ${nightFactor * 0.25})`;
      context.shadowBlur = 0;
      context.beginPath();
      context.moveTo(carLength / 2, -carWidth * 0.25);
      context.lineTo(carLength / 2 + carLength * 1.5, -carWidth * 1.2);
      context.lineTo(carLength / 2 + carLength * 1.5, carWidth * 1.2);
      context.lineTo(carLength / 2, carWidth * 0.25);
      context.closePath();
      context.fill();
    }

    // Taillights
    context.shadowBlur = 4 * nightFactor;
    context.shadowColor = 'rgba(248, 113, 113, 0.6)';
    context.fillStyle = 'rgba(248, 113, 113, 0.9)';
    context.fillRect(-carLength / 2, -carWidth * 0.35, 2, carWidth * 0.15);
    context.fillRect(-carLength / 2, carWidth * 0.2, 2, carWidth * 0.15);
    context.restore();
  }
}

export function drawDistricts(
  context: CanvasRenderingContext2D,
  districts: District[],
  layout: IsoLayout,
): void {
  for (const district of districts) {
    const size = district.radius * 2;
    const proj = createPrismProjection(
      district.x - district.radius,
      district.y - district.radius,
      0.005,
      size,
      size,
      0.01,
      layout,
    );
    const top = proj.top;

    context.save();
    context.beginPath();
    context.moveTo(top[0].sx, top[0].sy);
    context.lineTo(top[1].sx, top[1].sy);
    context.lineTo(top[2].sx, top[2].sy);
    context.lineTo(top[3].sx, top[3].sy);
    context.closePath();
    context.fillStyle = district.color;
    context.fill();
    context.strokeStyle = withAlpha('#ffffff', 0.08);
    context.lineWidth = 1;
    context.stroke();

    if (layout.tileWidth > 13) {
      context.fillStyle = 'rgba(241, 245, 249, 0.3)';
      context.font = `600 ${Math.max(9, layout.tileWidth * 0.1)}px 'IBM Plex Sans', sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const center = toScreen(district.x, district.y, 0.01, layout);
      context.fillText(district.name.toUpperCase(), center.sx, center.sy);
    }

    context.restore();
  }
}

export function drawGroundPlane(
  context: CanvasRenderingContext2D,
  _viewport: { width: number; height: number },
  layout: IsoLayout,
  entities: Entity[],
  cityLayout: CityLayout,
  phase: number,
): void {
  const structures = entities.filter((entity) => entity.type === 'file' || entity.type === 'directory');
  // Only render ground around the occupied area + margin — saves huge per-frame cost
  let minX = 0;
  let minY = 0;
  let maxX = 49;
  let maxY = 49;
  if (structures.length > 0) {
    let sMinX = Infinity;
    let sMinY = Infinity;
    let sMaxX = -Infinity;
    let sMaxY = -Infinity;
    for (const s of structures) {
      sMinX = Math.min(sMinX, s.x);
      sMinY = Math.min(sMinY, s.y);
      sMaxX = Math.max(sMaxX, s.x);
      sMaxY = Math.max(sMaxY, s.y);
    }
    const margin = 4;
    minX = Math.max(0, Math.floor(sMinX) - margin);
    minY = Math.max(0, Math.floor(sMinY) - margin);
    maxX = Math.min(49, Math.ceil(sMaxX) + margin);
    maxY = Math.min(49, Math.ceil(sMaxY) + margin);
  }

  const daylight = daylightFromPhase(phase);
  const roadTiles = getCachedRoadTileKeys(cityLayout.roads);
  const occupiedTiles = new Set(
    structures.map((entity) => `${Math.floor(entity.x)},${Math.floor(entity.y)}`),
  );

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const tileKey = `${x},${y}`;
      const palette = getTilePalette(x, y, cityLayout, roadTiles);
      const projection = createPrismProjection(x, y, 0, 1, 1, 0.05, layout);
      fillFace(context, projection.left, palette.left, withAlpha('#0f172a', 0.08));
      fillFace(context, projection.right, palette.right, withAlpha('#0f172a', 0.08));
      fillFace(
        context,
        projection.top,
        withAlpha(palette.top, 0.78 + (daylight * 0.12)),
        withAlpha('#ffffff', 0.03),
      );

      if (occupiedTiles.has(tileKey)) {
        // Sidewalk slab under buildings
        const sidewalk = createPrismProjection(x - 0.06, y - 0.06, 0.01, 1.12, 1.12, 0.02, layout);
        fillFace(context, sidewalk.left, 'rgba(130, 138, 148, 0.85)', 'rgba(100, 108, 118, 0.15)');
        fillFace(context, sidewalk.right, 'rgba(120, 128, 138, 0.88)', 'rgba(100, 108, 118, 0.15)');
        fillFace(context, sidewalk.top, 'rgba(158, 165, 175, 0.9)', 'rgba(120, 128, 140, 0.2)');
        continue;
      }

      const district = getDistrictAtTile(cityLayout, x, y);
      const roadTile = roadTiles.has(tileKey);
      const adjacentRoad = !roadTile && hasAdjacentRoadTile(x, y, roadTiles);
      const waterTile = isWaterTile(cityLayout, x, y);
      const seed = noise2d(x + 0.17, y + 0.31);
      const nightFactor = 1 - daylight;

      if (waterTile) {
        // Water shimmer animation — subtle bright patches that drift
        const shimmerPhase = Math.sin(phase * 0.03 + x * 0.7 + y * 0.5) * 0.5 + 0.5;
        if (shimmerPhase > 0.65) {
          const center = toScreen(x + 0.5, y + 0.5, 0.03, layout);
          const shimmer = context.createRadialGradient(
            center.sx, center.sy, 0,
            center.sx, center.sy, layout.tileWidth * 0.25,
          );
          shimmer.addColorStop(0, `rgba(180, 220, 255, ${(shimmerPhase - 0.65) * 0.35})`);
          shimmer.addColorStop(1, 'rgba(180, 220, 255, 0)');
          context.fillStyle = shimmer;
          context.beginPath();
          context.ellipse(center.sx, center.sy, layout.tileWidth * 0.25, layout.tileHeight * 0.15, 0, 0, Math.PI * 2);
          context.fill();
        }
        if (seed > 0.7 && hasAdjacentLandTile(x, y, cityLayout)) {
          drawDockPost(context, x, y, layout);
        }
        continue;
      }

      if (district?.type === 'park' && !roadTile && !adjacentRoad) {
        if (seed > 0.66) {
          drawTree(context, x, y, layout, 'rgba(74, 222, 128, 0.95)');
        } else if (seed > 0.52) {
          drawBench(context, x, y, layout);
        }
        continue;
      }

      if (adjacentRoad) {
        // Street lamps on sidewalk tiles adjacent to roads
        if (seed > 0.75 && seed < 0.88) {
          const tileCenter = toScreen(x + 0.5, y + 0.5, 0, layout);
          drawLampPost(context, tileCenter, layout, nightFactor);
        }

        // Street trees on ALL sidewalk tiles adjacent to roads
        if (seed > 0.25 && seed < 0.45) {
          const treeColors = [
            'rgba(74, 222, 128, 0.95)',
            'rgba(101, 163, 13, 0.92)',
            'rgba(34, 197, 94, 0.93)',
            'rgba(132, 204, 22, 0.9)',
          ];
          drawTree(context, x + 0.1, y + 0.1, layout, treeColors[Math.floor(seed * 40) % treeColors.length]!);
        }

        // Sidewalk micro-details
        if (seed > 0.45 && seed < 0.52) {
          drawPlanter(context, x, y, layout);
        } else if (seed > 0.52 && seed < 0.57) {
          drawTrashBin(context, x, y, layout);
        } else if (seed > 0.57 && seed < 0.61) {
          drawFireHydrant(context, x, y, layout);
        } else if (seed > 0.61 && seed < 0.65) {
          drawMailbox(context, x, y, layout);
        }

        // Parking stripes in industrial districts
        if (district?.type === 'industrial' && seed > 0.55 && seed < 0.68) {
          drawParkingLines(context, x, y, layout);
        }
      }

      if (district?.type === 'suburb' && !roadTile && !adjacentRoad && seed > 0.82) {
        // Offset tree to sidewalk edge
        drawTree(context, x + 0.15, y + 0.15, layout, 'rgba(101, 163, 13, 0.92)');
        continue;
      }

      // Fences / hedges in suburban yards
      if (district?.type === 'suburb' && !roadTile && !adjacentRoad && seed > 0.45 && seed < 0.6) {
        if ((x + y) % 2 === 0) {
          drawFence(context, x, y, layout);
        } else {
          drawHedge(context, x, y, layout);
        }
        continue;
      }

      if (district?.type === 'industrial' && !roadTile && !adjacentRoad && seed > 0.74) {
        drawContainer(context, x, y, layout, seed > 0.86 ? '#f97316' : '#64748b');
        continue;
      }
    }
  }
}
