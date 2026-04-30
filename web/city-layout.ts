import type { Entity } from '../src/types';

export type DistrictType = 'downtown' | 'suburb' | 'industrial' | 'harbor' | 'park' | 'design';

export interface District {
  type: DistrictType;
  x: number;
  y: number;
  radius: number;
  name: string;
  color: string;
}

export interface RoadSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  name: string;
  width: number;
  trafficDensity: number;
}

export interface WaterRegion {
  side: 'east' | 'west' | 'north' | 'south';
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  name: string;
}

export interface CityLayout {
  districts: District[];
  roads: RoadSegment[];
  downtownCenter: { x: number; y: number };
  water: WaterRegion | null;
}

const GRID_MIN = 0;
const GRID_MAX = 49;
const MIN_CITY_SPAN = 10;
const MIN_HARBOR_DEPTH = 2;
const ROAD_RUN_GAP = 4;
const DISTRICT_PRIORITY: Record<DistrictType, number> = {
  harbor: 100,
  downtown: 80,
  industrial: 60,
  park: 40,
  design: 30,
  suburb: 20,
};

// Detect entry-point / important files
export function isEntryPoint(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';
  const entryPatterns = [
    'app.', 'index.', 'main.', 'server.', 'entry.',
    'router.', 'routes.', 'controller.', 'handler.',
    'layout.', 'page.', 'api.',
  ];
  return entryPatterns.some(p => name.startsWith(p) || path.includes(p));
}

// Detect config / infrastructure files
function isInfrastructure(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const ext = entity.extension?.toLowerCase() ?? '';
  return ext === '.json' || ext === '.yml' || ext === '.yaml' || ext === '.toml' ||
    ext === '.config' || name.includes('config') || name.includes('vite') ||
    name.includes('webpack') || name.includes('docker') || name.includes('dockerfile') ||
    name.includes('tsconfig') || name.includes('package');
}

// Detect utility / helper files
function _isUtility(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';
  return name.includes('util') || name.includes('helper') || name.includes('lib/') ||
    path.includes('/utils/') || path.includes('/helpers/');
}

function clampTile(value: number): number {
  return Math.max(GRID_MIN, Math.min(GRID_MAX, value));
}

function snapToTileCenter(value: number): number {
  return Math.max(0.5, Math.min(GRID_MAX + 0.5, Math.round(value - 0.5) + 0.5));
}

function snapRadius(value: number): number {
  return Math.max(2.5, Math.round(value * 2) / 2);
}

function getEntityCenter(entity: Entity): { x: number; y: number } {
  return {
    x: entity.x + 0.5,
    y: entity.y + 0.5,
  };
}

function averageCenters(entities: Entity[]): { x: number; y: number } {
  const total = entities.reduce(
    (accumulator, entity) => {
      accumulator.x += entity.x + 0.5;
      accumulator.y += entity.y + 0.5;
      return accumulator;
    },
    { x: 0, y: 0 },
  );

  return {
    x: total.x / entities.length,
    y: total.y / entities.length,
  };
}

function splitIntoRuns(values: number[]): number[][] {
  const unique = [...new Set(values)].sort((left, right) => left - right);
  if (unique.length === 0) {
    return [];
  }

  const runs: number[][] = [];
  let currentRun = [unique[0]!];

  for (let index = 1; index < unique.length; index += 1) {
    const value = unique[index]!;
    const previous = currentRun[currentRun.length - 1]!;
    if (value - previous <= ROAD_RUN_GAP) {
      currentRun.push(value);
      continue;
    }

    runs.push(currentRun);
    currentRun = [value];
  }

  runs.push(currentRun);
  return runs;
}

function createRoadSegments(fileStructures: Entity[]): RoadSegment[] {
  const roads: RoadSegment[] = [];
  const yRows = new Map<number, number[]>();
  const xCols = new Map<number, number[]>();

  for (const entity of fileStructures) {
    const xs = yRows.get(entity.y) ?? [];
    xs.push(entity.x);
    yRows.set(entity.y, xs);

    const ys = xCols.get(entity.x) ?? [];
    ys.push(entity.y);
    xCols.set(entity.x, ys);
  }

  for (const [y, xs] of yRows) {
    for (const run of splitIntoRuns(xs)) {
      if (run.length < 2) {
        continue;
      }

      const start = run[0]!;
      const end = run[run.length - 1]!;
      const isMain = run.length >= 4 || end - start >= 10;
      roads.push({
        fromX: start + 0.5,
        fromY: y + 0.5,
        toX: end + 0.5,
        toY: y + 0.5,
        name: isMain ? 'Main Street' : 'Grid Avenue',
        width: isMain ? 0.6 : 0.5,
        trafficDensity: isMain ? 0.6 : 0.3,
      });
    }
  }

  for (const [x, ys] of xCols) {
    for (const run of splitIntoRuns(ys)) {
      if (run.length < 2) {
        continue;
      }

      const start = run[0]!;
      const end = run[run.length - 1]!;
      const isMain = run.length >= 4 || end - start >= 10;
      roads.push({
        fromX: x + 0.5,
        fromY: start + 0.5,
        toX: x + 0.5,
        toY: end + 0.5,
        name: isMain ? 'Main Street' : 'Grid Avenue',
        width: isMain ? 0.6 : 0.5,
        trafficDensity: isMain ? 0.6 : 0.3,
      });
    }
  }

  return roads;
}

// Planned arterial roads give the city an organized backbone
function createPlannedRoads(
  downtownCenter: { x: number; y: number },
  span: number,
  entryPoints: Entity[],
  districts: District[],
): RoadSegment[] {
  const roads: RoadSegment[] = [];
  const gridSpacing = Math.max(5, Math.round(span / 5));
  const halfSpan = Math.ceil(span / 2) + 1;

  // Downtown avenue grid — major east-west and north-south arterials
  const startX = Math.round(downtownCenter.x - halfSpan);
  const endX = Math.round(downtownCenter.x + halfSpan);
  const startY = Math.round(downtownCenter.y - halfSpan);
  const endY = Math.round(downtownCenter.y + halfSpan);

  for (let x = startX; x <= endX; x += gridSpacing) {
    roads.push({
      fromX: clampTile(x) + 0.5,
      fromY: clampTile(startY) + 0.5,
      toX: clampTile(x) + 0.5,
      toY: clampTile(endY) + 0.5,
      name: 'Avenue',
      width: 0.7,
      trafficDensity: 0.5,
    });
  }

  for (let y = startY; y <= endY; y += gridSpacing) {
    roads.push({
      fromX: clampTile(startX) + 0.5,
      fromY: clampTile(y) + 0.5,
      toX: clampTile(endX) + 0.5,
      toY: clampTile(y) + 0.5,
      name: 'Boulevard',
      width: 0.7,
      trafficDensity: 0.5,
    });
  }

  // Radial arterials from downtown to each non-downtown district center
  for (const district of districts) {
    if (district.type === 'downtown' || district.type === 'harbor') continue;
    roads.push({
      fromX: downtownCenter.x,
      fromY: downtownCenter.y,
      toX: district.x,
      toY: district.y,
      name: 'Arterial',
      width: 0.65,
      trafficDensity: 0.45,
    });
  }

  // Ring road around downtown
  const ringRadius = Math.max(3, Math.round(span * 0.22));
  const ringSegments = 8;
  for (let i = 0; i < ringSegments; i++) {
    const angle1 = (i / ringSegments) * Math.PI * 2;
    const angle2 = ((i + 1) / ringSegments) * Math.PI * 2;
    roads.push({
      fromX: downtownCenter.x + Math.cos(angle1) * ringRadius,
      fromY: downtownCenter.y + Math.sin(angle1) * ringRadius,
      toX: downtownCenter.x + Math.cos(angle2) * ringRadius,
      toY: downtownCenter.y + Math.sin(angle2) * ringRadius,
      name: 'Ring Road',
      width: 0.6,
      trafficDensity: 0.4,
    });
  }

  // Connect entry points directly to downtown with prominent roads
  for (const entry of entryPoints.slice(0, 4)) {
    roads.push({
      fromX: entry.x + 0.5,
      fromY: entry.y + 0.5,
      toX: downtownCenter.x,
      toY: downtownCenter.y,
      name: 'Expressway',
      width: 0.75,
      trafficDensity: 0.7,
    });
  }

  return roads;
}

function chooseWaterRegion(structures: Entity[]): WaterRegion | null {
  const occupiedColumns = new Set(structures.map((entity) => entity.x));
  const occupiedRows = new Set(structures.map((entity) => entity.y));

  const eastDepth = (() => {
    let depth = 0;
    for (let x = GRID_MAX; x >= GRID_MIN; x -= 1) {
      if (occupiedColumns.has(x)) {
        break;
      }
      depth += 1;
    }
    return depth;
  })();

  const westDepth = (() => {
    let depth = 0;
    for (let x = GRID_MIN; x <= GRID_MAX; x += 1) {
      if (occupiedColumns.has(x)) {
        break;
      }
      depth += 1;
    }
    return depth;
  })();

  const northDepth = (() => {
    let depth = 0;
    for (let y = GRID_MIN; y <= GRID_MAX; y += 1) {
      if (occupiedRows.has(y)) {
        break;
      }
      depth += 1;
    }
    return depth;
  })();

  const southDepth = (() => {
    let depth = 0;
    for (let y = GRID_MAX; y >= GRID_MIN; y -= 1) {
      if (occupiedRows.has(y)) {
        break;
      }
      depth += 1;
    }
    return depth;
  })();

  const candidates = [
    { side: 'east' as const, depth: eastDepth },
    { side: 'west' as const, depth: westDepth },
    { side: 'south' as const, depth: southDepth },
    { side: 'north' as const, depth: northDepth },
  ].sort((left, right) => right.depth - left.depth);

  const best = candidates[0];
  if (!best || best.depth < MIN_HARBOR_DEPTH) {
    return null;
  }

  switch (best.side) {
    case 'east':
      return {
        side: 'east',
        minX: GRID_MAX - best.depth + 1,
        maxX: GRID_MAX,
        minY: GRID_MIN,
        maxY: GRID_MAX,
        name: 'The Harbor',
      };
    case 'west':
      return {
        side: 'west',
        minX: GRID_MIN,
        maxX: GRID_MIN + best.depth - 1,
        minY: GRID_MIN,
        maxY: GRID_MAX,
        name: 'The Harbor',
      };
    case 'north':
      return {
        side: 'north',
        minX: GRID_MIN,
        maxX: GRID_MAX,
        minY: GRID_MIN,
        maxY: GRID_MIN + best.depth - 1,
        name: 'The Harbor',
      };
    case 'south':
      return {
        side: 'south',
        minX: GRID_MIN,
        maxX: GRID_MAX,
        minY: GRID_MAX - best.depth + 1,
        maxY: GRID_MAX,
        name: 'The Harbor',
      };
  }
}

export function isWaterTile(cityLayout: CityLayout, x: number, y: number): boolean {
  const water = cityLayout.water;
  if (!water) {
    return false;
  }

  return x >= water.minX && x <= water.maxX && y >= water.minY && y <= water.maxY;
}

export function getDistrictAtTile(cityLayout: CityLayout, x: number, y: number): District | null {
  if (isWaterTile(cityLayout, x, y)) {
    return cityLayout.districts.find((district) => district.type === 'harbor') ?? null;
  }

  const centerX = x + 0.5;
  const centerY = y + 0.5;
  let match: District | null = null;

  for (const district of cityLayout.districts) {
    if (district.type === 'harbor') {
      continue;
    }

    const dx = centerX - district.x;
    const dy = centerY - district.y;
    if (Math.hypot(dx, dy) > district.radius) {
      continue;
    }

    if (
      match === null ||
      DISTRICT_PRIORITY[district.type] > DISTRICT_PRIORITY[match.type] ||
      (
        DISTRICT_PRIORITY[district.type] === DISTRICT_PRIORITY[match.type] &&
        district.radius < match.radius
      )
    ) {
      match = district;
    }
  }

  return match;
}

export function getRoadTileKeys(roads: RoadSegment[]): Set<string> {
  const roadTiles = new Set<string>();

  for (const road of roads) {
    if (Math.abs(road.fromY - road.toY) < 0.01) {
      const y = clampTile(Math.round(road.fromY - 0.5));
      const startX = clampTile(Math.round(Math.min(road.fromX, road.toX) - 0.5));
      const endX = clampTile(Math.round(Math.max(road.fromX, road.toX) - 0.5));

      for (let x = startX; x <= endX; x += 1) {
        roadTiles.add(`${x},${y}`);
      }

      continue;
    }

    const x = clampTile(Math.round(road.fromX - 0.5));
    const startY = clampTile(Math.round(Math.min(road.fromY, road.toY) - 0.5));
    const endY = clampTile(Math.round(Math.max(road.fromY, road.toY) - 0.5));

    for (let y = startY; y <= endY; y += 1) {
      roadTiles.add(`${x},${y}`);
    }
  }

  return roadTiles;
}

export function computeCityLayout(entities: Entity[]): CityLayout {
  const structures = entities.filter(e => e.type === 'file' || e.type === 'directory');
  
  if (structures.length === 0) {
    return {
      districts: [],
      roads: [],
      downtownCenter: { x: 25.5, y: 25.5 },
      water: null,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of structures) {
    const center = getEntityCenter(entity);
    minX = Math.min(minX, center.x);
    minY = Math.min(minY, center.y);
    maxX = Math.max(maxX, center.x);
    maxY = Math.max(maxY, center.y);
  }

  const centerX = snapToTileCenter((minX + maxX) / 2);
  const centerY = snapToTileCenter((minY + maxY) / 2);
  const span = Math.max(maxX - minX, maxY - minY, MIN_CITY_SPAN);

  // Find entry points (the "important" buildings)
  const entryPoints = structures.filter(isEntryPoint);
  const entryCenter = entryPoints.length > 0 ? averageCenters(entryPoints) : { x: centerX, y: centerY };
  const downtownCenter = {
    x: snapToTileCenter(entryCenter.x),
    y: snapToTileCenter(entryCenter.y),
  };

  const infrastructurePoints = structures.filter(isInfrastructure);
  const industrialAnchor = infrastructurePoints.length > 0
    ? averageCenters(infrastructurePoints)
    : {
        x: downtownCenter.x + (span * 0.15),
        y: downtownCenter.y - (span * 0.1),
      };

  const water = chooseWaterRegion(structures);

  const districts: District[] = [];

  const uiPoints = structures.filter(e => {
    const ext = e.extension?.toLowerCase() ?? '';
    const name = e.name?.toLowerCase() ?? '';
    const path = e.path?.toLowerCase() ?? '';
    return ext === '.tsx' || ext === '.jsx' || ext === '.vue' || ext === '.svelte' || name.includes('component') || path.includes('/components/');
  });

  if (uiPoints.length >= 3) {
     const designAnchor = averageCenters(uiPoints);
     districts.push({
        type: 'design',
        x: snapToTileCenter(designAnchor.x),
        y: snapToTileCenter(designAnchor.y),
        radius: snapRadius(span * 0.25),
        name: 'Design District',
        color: 'rgba(255, 105, 180, 0.15)',
     });
  }

  // Downtown — the core
  districts.push({
    type: 'downtown',
    x: downtownCenter.x,
    y: downtownCenter.y,
    radius: snapRadius(span * 0.25),
    name: 'Downtown',
    color: 'rgba(80, 80, 90, 0.15)',
  });

  // Industrial ring
  districts.push({
    type: 'industrial',
    x: snapToTileCenter(industrialAnchor.x),
    y: snapToTileCenter(industrialAnchor.y),
    radius: snapRadius(span * 0.2),
    name: 'Industrial District',
    color: 'rgba(100, 80, 60, 0.12)',
  });

  // Suburbs ring
  districts.push({
    type: 'suburb',
    x: centerX,
    y: centerY,
    radius: snapRadius(span * 0.6),
    name: 'Suburbs',
    color: 'rgba(60, 100, 60, 0.1)',
  });

  // Park
  districts.push({
    type: 'park',
    x: snapToTileCenter(downtownCenter.x - (span * 0.2)),
    y: snapToTileCenter(downtownCenter.y + (span * 0.15)),
    radius: snapRadius(span * 0.12),
    name: 'Central Park',
    color: 'rgba(40, 100, 40, 0.15)',
  });

  const fileStructures = structures.filter((s) => s.type === 'file');
  const organicRoads = createRoadSegments(fileStructures);
  const plannedRoads = createPlannedRoads(downtownCenter, span, entryPoints, districts);

  // Merge, deduplicating near-overlapping segments
  const roadKey = (r: RoadSegment) =>
    `${Math.round(r.fromX)},${Math.round(r.fromY)}-${Math.round(r.toX)},${Math.round(r.toY)}`;
  const seen = new Set<string>();
  const roads: RoadSegment[] = [];
  for (const r of [...organicRoads, ...plannedRoads]) {
    const key = roadKey(r);
    if (!seen.has(key)) {
      seen.add(key);
      roads.push(r);
    }
  }

  if (water) {
    const waterWidth = (water.maxX - water.minX) + 1;
    const waterHeight = (water.maxY - water.minY) + 1;
    districts.push({
      type: 'harbor',
      x: snapToTileCenter((water.minX + water.maxX + 1) / 2),
      y: snapToTileCenter((water.minY + water.maxY + 1) / 2),
      radius: snapRadius(Math.min(waterWidth, waterHeight) * 0.5),
      name: water.name,
      color: 'rgba(60, 100, 120, 0.12)',
    });
  }

  return { districts, roads, downtownCenter, water };
}


