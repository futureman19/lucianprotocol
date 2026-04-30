import type { Entity } from '../src/types';
import { heightUnitsToWorldHeight } from '../src/building-lifecycle';
import {
  getArchetypePalette,
  getArchetypeSilhouette,
  deriveArchetypeFromEntity,
  deriveImportanceTierFromEntity,
  deriveUpgradeLevelFromEntity,
  deriveLandmarkRoleFromEntity,
  type BuildingArchetype,
} from './building-archetypes';
import {
  getConditionState,
  getActivityLevel,
  getOccupancy,
  type LandmarkRole,
  type ConditionState,
} from './shared-contract';

export interface BuildingPalette {
  primary: string;
  secondary: string;
  accent: string;
  trim: string;
  windowLit: string;
  windowDark: string;
}

export interface BuildingGeometry {
  archetype: BuildingArchetype;
  importanceTier: 0 | 1 | 2 | 3;
  upgradeLevel: 0 | 1 | 2 | 3;
  landmarkRole: LandmarkRole;
  footprint: { width: number; depth: number };
  height: number;
  palette: BuildingPalette;
  silhouette: ReturnType<typeof getArchetypeSilhouette>;
  seed: number;
  condition: ConditionState;
  conditionFactor: number;
  activityLevel: number;
  occupancy: number;
  ornamentation: number;
}

const BUILDING_GEOMETRY_CACHE = new WeakMap<Entity, BuildingGeometry>();

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getArchetypeBaseFootprint(archetype: BuildingArchetype): number {
  switch (archetype) {
    case 'landmark':
      return 1.5;
    case 'tower':
      return 1.1;
    case 'factory':
      return 1.2;
    case 'warehouse':
      return 1.15;
    case 'civic':
      return 1.05;
    case 'shopfront':
      return 1.0;
    case 'campus':
      return 1.0;
    case 'substation':
      return 0.9;
    default:
      return 1.0;
  }
}

function getArchetypeBaseFloors(archetype: BuildingArchetype): number {
  switch (archetype) {
    case 'landmark':
      return 6;
    case 'tower':
      return 3;
    case 'factory':
      return 2.5;
    case 'warehouse':
      return 1.2;
    case 'civic':
      return 1.5;
    case 'shopfront':
      return 1.2;
    case 'campus':
      return 1.0;
    case 'substation':
      return 0.8;
    default:
      return 1.0;
  }
}

export function getBuildingGeometry(entity: Entity): BuildingGeometry {
  const cached = BUILDING_GEOMETRY_CACHE.get(entity);
  if (cached) {
    return cached;
  }

  const archetype = deriveArchetypeFromEntity(entity);
  const importanceTier = deriveImportanceTierFromEntity(entity);
  const upgradeLevel = deriveUpgradeLevelFromEntity(entity);
  const landmarkRole = deriveLandmarkRoleFromEntity(entity);
  const seed = hashString(entity.id);

  // Footprint: use explicit occupancy if available, otherwise derive from archetype + mass
  const ow = entity.occupancy_width ?? 1;
  const od = entity.occupancy_depth ?? 1;
  let footprintWidth: number;
  let footprintDepth: number;

  if (ow > 1 || od > 1) {
    footprintWidth = ow;
    footprintDepth = od;
  } else {
    const mass = entity.mass ?? 1;
    const base = getArchetypeBaseFootprint(archetype);
    const scale = Math.min(1.5, Math.max(0.8, 0.8 + (mass - 1) * 0.08));
    footprintWidth = base * scale;
    footprintDepth = base * scale;
  }

  // Height: from canonical archetype, mass, and tier
  const mass = entity.mass ?? 1;
  const baseFloors = getArchetypeBaseFloors(archetype);
  const floors = Math.max(baseFloors * 0.5, baseFloors + (mass - 1) * 0.35);
  const tierBoost = 1 + importanceTier * 0.12;
  const height = floors * 0.8 * tierBoost;

  const palette = getArchetypePalette(archetype);
  const silhouette = getArchetypeSilhouette(archetype, importanceTier, upgradeLevel, seed);
  const condition = getConditionState(entity);
  const conditionFactor =
    condition === 'pristine' ? 0 :
    condition === 'maintained' ? 0.2 :
    condition === 'worn' ? 0.5 :
    condition === 'decaying' ? 0.8 : 1.0;

  const geometry: BuildingGeometry = {
    archetype,
    importanceTier,
    upgradeLevel,
    landmarkRole,
    footprint: { width: footprintWidth, depth: footprintDepth },
    height,
    palette,
    silhouette,
    seed,
    condition,
    conditionFactor,
    activityLevel: getActivityLevel(entity),
    occupancy: getOccupancy(entity),
    ornamentation: importanceTier * 0.25 + upgradeLevel * 0.15,
  };

  BUILDING_GEOMETRY_CACHE.set(entity, geometry);
  return geometry;
}

export function getEntityFootprint(entity: Entity): { width: number; depth: number } {
  // Direct occupancy wins
  const ow = entity.occupancy_width ?? 1;
  const od = entity.occupancy_depth ?? 1;
  if (ow > 1 || od > 1) {
    return { width: ow, depth: od };
  }

  // Agents, walls, goals have fixed sizes
  if (entity.type === 'agent') return { width: 0.7, depth: 0.7 };
  if (entity.type === 'wall') return { width: 1, depth: 1 };
  if (entity.type === 'goal') return { width: 0.8, depth: 0.8 };
  if (entity.type === 'directory') return { width: 1.4, depth: 1.4 };

  return getBuildingGeometry(entity).footprint;
}

export function getEntityHeight(entity: Entity): number {
  if (typeof entity.current_height === 'number') {
    return heightUnitsToWorldHeight(entity.current_height);
  }
  if (typeof entity.target_height === 'number') {
    return heightUnitsToWorldHeight(entity.target_height);
  }

  if (entity.type === 'goal') return 0.2;
  if (entity.type === 'wall') return 1.0;
  if (entity.type === 'agent') return 0.6;
  if (entity.type === 'directory') return 0.6;

  return getBuildingGeometry(entity).height;
}

export function getNodeStatePalette(nodeState: string): { accent: string } {
  switch (nodeState) {
    case 'in-progress':
    case 'constructing':
      return { accent: '#f59e0b' };
    case 'asymmetry':
      return { accent: '#ef4444' };
    case 'verified':
      return { accent: '#22c55e' };
    case 'task':
      return { accent: '#3b82f6' };
    case 'demolishing':
      return { accent: '#94a3b8' };
    case 'stable':
    default:
      return { accent: '#64748b' };
  }
}
