import type { Entity } from '../src/types';

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

  // Generate roads from tethers
  const roads: RoadSegment[] = [];
  const entityByPath = new Map<string, Entity>();
  for (const e of entities) {
    if (e.path) entityByPath.set(e.path, e);
  }

  for (const source of structures) {
    if (!source.tether_to || source.tether_to.length === 0) continue;
    
    for (const targetPath of source.tether_to) {
      const target = entityByPath.get(targetPath);
      if (!target) continue;

      // Determine road name based on what it connects
      let roadName = 'Utility Lane';
      const srcName = source.name?.toLowerCase() ?? '';
      const tgtName = target.name?.toLowerCase() ?? '';
      
      if (isEntryPoint(source) || isEntryPoint(target)) {
        roadName = 'Main Street';
      } else if (srcName.includes('auth') || tgtName.includes('auth')) {
        roadName = 'Security Blvd';
      } else if (srcName.includes('api') || tgtName.includes('api')) {
        roadName = 'API Avenue';
      } else if (srcName.includes('db') || tgtName.includes('db') || srcName.includes('model')) {
        roadName = 'Data Drive';
      } else if (isInfrastructure(source) || isInfrastructure(target)) {
        roadName = 'Infrastructure Way';
      } else if (isUtility(source) || isUtility(target)) {
        roadName = 'Helper Lane';
      } else if (srcName.includes('test') || tgtName.includes('test')) {
        roadName = 'Test Track';
      } else if (srcName.includes('style') || tgtName.includes('style') || srcName.includes('css')) {
        roadName = 'Design District';
      }

      // Traffic density = how many files depend on this connection
      const trafficDensity = Math.min(1, ((source.tether_to?.length ?? 0) + (target.tether_to?.length ?? 0)) / 10);

      roads.push({
        fromX: source.x + 0.5,
        fromY: source.y + 0.5,
        toX: target.x + 0.5,
        toY: target.y + 0.5,
        name: roadName,
        width: 0.3 + trafficDensity * 0.4,
        trafficDensity,
      });
    }
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
    return { type: 'townhall', floors: Math.max(6, mass), footprint: 1.8, ornamentation: 0.9 };
  }

  // Skyscrapers — other entry points or massive files
  if (isEntryPoint(entity) && isBig) {
    return { type: 'skyscraper', floors: Math.max(5, mass), footprint: 1.4, ornamentation: 0.8 };
  }

  // Shops — UI components
  if (ext === '.tsx' || ext === '.jsx' || name.includes('component') || path.includes('/components/')) {
    return { type: 'shop', floors: Math.max(1.5, mass * 0.4), footprint: 0.9, ornamentation: 0.7 };
  }

  // Warehouses — config/data
  if (isInfrastructure(entity)) {
    return { type: 'warehouse', floors: Math.max(1, mass * 0.3), footprint: 1.6, ornamentation: 0.2 };
  }

  // Factories — build tools
  if (name.includes('vite') || name.includes('webpack') || name.includes('rollup') || name.includes('build')) {
    return { type: 'factory', floors: Math.max(2, mass * 0.5), footprint: 1.5, ornamentation: 0.3 };
  }

  // Schools — docs
  if (ext === '.md' || ext === '.mdx') {
    return { type: 'school', floors: 1.2, footprint: 1.2, ornamentation: 0.6 };
  }

  // Hospitals — tests
  if (name.includes('.test.') || name.includes('.spec.')) {
    return { type: 'hospital', floors: 1.5, footprint: 1.1, ornamentation: 0.5 };
  }

  // Cafes — styles
  if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') {
    return { type: 'cafe', floors: 1, footprint: 0.8, ornamentation: 0.8 };
  }

  // Houses — small utilities
  if (isUtility(entity) || (!isMedium && !isEntryPoint(entity))) {
    return { type: 'house', floors: Math.max(0.8, mass * 0.3), footprint: 0.7, ornamentation: 0.4 };
  }

  // Offices — medium business logic
  if (isMedium) {
    return { type: 'office', floors: Math.max(2, mass * 0.5), footprint: 1.0, ornamentation: 0.5 };
  }

  // Default — apartment
  return { type: 'apartment', floors: Math.max(1, mass * 0.4), footprint: 0.85, ornamentation: 0.4 };
}
