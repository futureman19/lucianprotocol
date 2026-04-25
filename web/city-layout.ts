import type { Entity } from '../src/types';
import { getFileFootprint as getBaseFootprint } from './file-colors';

export type DistrictType = 'downtown' | 'suburb' | 'industrial' | 'harbor' | 'park';

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

export interface CityLayout {
  districts: District[];
  roads: RoadSegment[];
  downtownCenter: { x: number; y: number };
}

// Detect entry-point / important files
function isEntryPoint(entity: Entity): boolean {
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
function isUtility(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';
  return name.includes('util') || name.includes('helper') || name.includes('lib/') ||
    path.includes('/utils/') || path.includes('/helpers/');
}

export function computeCityLayout(entities: Entity[]): CityLayout {
  const structures = entities.filter(e => e.type === 'file' || e.type === 'directory');
  
  if (structures.length === 0) {
    return { districts: [], roads: [], downtownCenter: { x: 25, y: 25 } };
  }

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of structures) {
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x);
    maxY = Math.max(maxY, e.y);
  }
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 10);

  // Find entry points (the "important" buildings)
  const entryPoints = structures.filter(isEntryPoint);
  const downtownCenter = entryPoints.length > 0
    ? {
        x: entryPoints.reduce((s, e) => s + e.x, 0) / entryPoints.length,
        y: entryPoints.reduce((s, e) => s + e.y, 0) / entryPoints.length,
      }
    : { x: centerX, y: centerY };

  const districts: District[] = [];

  // Downtown — the core
  districts.push({
    type: 'downtown',
    x: downtownCenter.x,
    y: downtownCenter.y,
    radius: span * 0.25,
    name: 'Downtown',
    color: 'rgba(80, 80, 90, 0.15)',
  });

  // Industrial ring
  districts.push({
    type: 'industrial',
    x: downtownCenter.x + span * 0.15,
    y: downtownCenter.y - span * 0.1,
    radius: span * 0.2,
    name: 'Industrial District',
    color: 'rgba(100, 80, 60, 0.12)',
  });

  // Harbor (external dependencies area — typically edges)
  districts.push({
    type: 'harbor',
    x: maxX + 2,
    y: centerY,
    radius: span * 0.15,
    name: 'The Harbor',
    color: 'rgba(60, 100, 120, 0.12)',
  });

  // Suburbs ring
  districts.push({
    type: 'suburb',
    x: centerX,
    y: centerY,
    radius: span * 0.6,
    name: 'Suburbs',
    color: 'rgba(60, 100, 60, 0.1)',
  });

  // Park
  districts.push({
    type: 'park',
    x: downtownCenter.x - span * 0.2,
    y: downtownCenter.y + span * 0.15,
    radius: span * 0.12,
    name: 'Central Park',
    color: 'rgba(40, 100, 40, 0.15)',
  });

  // Build a unified street grid from building positions.
  // Horizontal streets run along each row that has buildings;
  // vertical streets run along each column that has buildings.
  // Streets are merged into continuous lines so corners fit cleanly.
  const roads: RoadSegment[] = [];

  const fileStructures = structures.filter((s) => s.type === 'file');
  const positions = fileStructures.map((e) => ({ x: e.x + 0.5, y: e.y + 0.5 }));

  // Group positions by rounded y for horizontal streets
  const yRows = new Map<number, number[]>();
  for (const p of positions) {
    const y = Math.round(p.y);
    const xs = yRows.get(y) ?? [];
    xs.push(p.x);
    yRows.set(y, xs);
  }

  // Group positions by rounded x for vertical streets
  const xCols = new Map<number, number[]>();
  for (const p of positions) {
    const x = Math.round(p.x);
    const ys = xCols.get(x) ?? [];
    ys.push(p.y);
    xCols.set(x, ys);
  }

  // Create merged horizontal streets — half a grid block wide with grass edges
  for (const [y, xs] of yRows) {
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const isMain = xs.length >= 3;
    roads.push({
      fromX: minX,
      fromY: y + 0.5,
      toX: maxX,
      toY: y + 0.5,
      name: isMain ? 'Main Street' : 'Grid Avenue',
      width: 0.5,
      trafficDensity: isMain ? 0.6 : 0.3,
    });
  }

  // Create merged vertical streets
  for (const [x, ys] of xCols) {
    const minY = Math.min(...ys) - 1;
    const maxY = Math.max(...ys) + 1;
    const isMain = ys.length >= 3;
    roads.push({
      fromX: x + 0.5,
      fromY: minY,
      toX: x + 0.5,
      toY: maxY,
      name: isMain ? 'Main Street' : 'Grid Avenue',
      width: 0.5,
      trafficDensity: isMain ? 0.6 : 0.3,
    });
  }

  return { districts, roads, downtownCenter };
}

// Assign a building type based on file characteristics
export type BuildingType = 
  | 'skyscraper'      // Big important files (entry points, large files)
  | 'townhall'        // The main entry point (app.js, index.html)
  | 'office'          // Medium business logic files
  | 'shop'            // Components/UI files
  | 'house'           // Small utility files
  | 'warehouse'       // Config/data files
  | 'factory'         // Build/infrastructure files
  | 'apartment'       // Medium files
  | 'school'          // Documentation
  | 'hospital'        // Error handling / test files
  | 'cafe';           // Style/CSS files

export interface BuildingProfile {
  type: BuildingType;
  floors: number;
  footprint: number;
  ornamentation: number; // 0-1, how decorated
}

export function getBuildingProfile(entity: Entity): BuildingProfile {
  const name = entity.name?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';
  const ext = entity.extension?.toLowerCase() ?? '';
  const mass = entity.mass ?? 1;
  const lines = (entity.content_preview ?? entity.content ?? '').split('\n').length;
  
  const isBig = lines > 200 || mass > 5;
  const isMedium = lines > 50 || mass > 2;

  // Town Hall — the main entry
  if (name === 'app.tsx' || name === 'app.ts' || name === 'app.js' || name === 'app.jsx' ||
      name === 'index.html' || name === 'index.ts' || name === 'index.tsx') {
    return { type: 'townhall', floors: Math.max(6, mass), footprint: 1.0, ornamentation: 0.9 };
  }

  // Skyscrapers — other entry points or massive files
  if (isEntryPoint(entity) && isBig) {
    return { type: 'skyscraper', floors: Math.max(5, mass), footprint: 1.0, ornamentation: 0.8 };
  }

  // Shops — UI components
  if (ext === '.tsx' || ext === '.jsx' || name.includes('component') || path.includes('/components/')) {
    return { type: 'shop', floors: Math.max(1.5, mass * 0.4), footprint: 1.0, ornamentation: 0.7 };
  }

  // Warehouses — config/data
  if (isInfrastructure(entity)) {
    return { type: 'warehouse', floors: Math.max(1, mass * 0.3), footprint: 1.0, ornamentation: 0.2 };
  }

  // Factories — build tools
  if (name.includes('vite') || name.includes('webpack') || name.includes('rollup') || name.includes('build')) {
    return { type: 'factory', floors: Math.max(2, mass * 0.5), footprint: 1.0, ornamentation: 0.3 };
  }

  // Schools — docs
  if (ext === '.md' || ext === '.mdx') {
    return { type: 'school', floors: 1.2, footprint: 1.0, ornamentation: 0.6 };
  }

  // Hospitals — tests
  if (name.includes('.test.') || name.includes('.spec.')) {
    return { type: 'hospital', floors: 1.5, footprint: 1.0, ornamentation: 0.5 };
  }

  // Cafes — styles
  if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') {
    return { type: 'cafe', floors: 1, footprint: 1.0, ornamentation: 0.8 };
  }

  // Houses — small utilities
  if (isUtility(entity) || (!isMedium && !isEntryPoint(entity))) {
    return { type: 'house', floors: Math.max(0.8, mass * 0.3), footprint: 1.0, ornamentation: 0.4 };
  }

  // Offices — medium business logic
  if (isMedium) {
    return { type: 'office', floors: Math.max(2, mass * 0.5), footprint: 1.0, ornamentation: 0.5 };
  }

  // Default — apartment
  return { type: 'apartment', floors: Math.max(1, mass * 0.4), footprint: 1.0, ornamentation: 0.4 };
}

export function getUnifiedFootprint(entity: Entity): { depth: number; width: number } {
  const baseFootprint = getBaseFootprint(entity);
  const profile = getBuildingProfile(entity);
  const isDirectory = entity.type === 'directory';
  
  return {
    width: baseFootprint.width * (isDirectory ? 1.0 : profile.footprint),
    depth: baseFootprint.depth * (isDirectory ? 1.0 : profile.footprint)
  };
}

export function getUnifiedHeight(entity: Entity): number {
  if (entity.type === 'goal') return 0.2;
  if (entity.type === 'wall') return 1.0;
  
  const profile = getBuildingProfile(entity);
  const isDirectory = entity.type === 'directory';
  
  return isDirectory ? 0.6 : profile.floors * 0.8;
}
