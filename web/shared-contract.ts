import type { Entity } from '../src/types';

export type BuildingArchetype =
  | 'tower'
  | 'warehouse'
  | 'shopfront'
  | 'campus'
  | 'factory'
  | 'civic'
  | 'substation'
  | 'landmark';

export type ConditionState = 'pristine' | 'maintained' | 'worn' | 'decaying' | 'condemned';

export type PowerState = 'normal' | 'strained' | 'overloaded' | 'offline';

export type ConstructionPhase = 'excavation' | 'frame' | 'facade' | 'fitout' | 'complete';

export type DemolitionPhase = 'marked' | 'stripping' | 'collapse' | 'cleared';

export type LandmarkRole = 'none' | 'entry' | 'critical' | 'hub' | 'control';

function getField<T>(entity: Entity, key: string, fallback: T): T {
  const value = (entity as Record<string, unknown>)[key];
  if (value === undefined || value === null) return fallback;
  return value as T;
}

export function getBuildingArchetype(entity: Entity): BuildingArchetype | undefined {
  return getField(entity, 'building_archetype', undefined);
}

export function getImportanceTier(entity: Entity): 0 | 1 | 2 | 3 {
  const v = getField(entity, 'importance_tier', 0);
  if (v === 0 || v === 1 || v === 2 || v === 3) return v;
  return 0;
}

export function getActivityLevel(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'activity_level', 0.5)));
}

export function getOccupancy(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'occupancy', 0.5)));
}

export function getConditionState(entity: Entity): ConditionState {
  const v = getField(entity, 'condition', 'maintained');
  const valid: ConditionState[] = ['pristine', 'maintained', 'worn', 'decaying', 'condemned'];
  return valid.includes(v) ? (v as ConditionState) : 'maintained';
}

export function getUpgradeLevel(entity: Entity): 0 | 1 | 2 | 3 {
  const v = getField(entity, 'upgrade_level', 0);
  if (v === 0 || v === 1 || v === 2 || v === 3) return v;
  return 0;
}

export function getPowerState(entity: Entity): PowerState {
  const v = getField(entity, 'power_state', 'normal');
  const valid: PowerState[] = ['normal', 'strained', 'overloaded', 'offline'];
  return valid.includes(v) ? (v as PowerState) : 'normal';
}

export function getNetworkLoad(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'network_load', 0)));
}

export function getTrafficLoad(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'traffic_load', 0)));
}

export function getConstructionPhase(entity: Entity): ConstructionPhase {
  const v = getField(entity, 'construction_phase', 'complete');
  const valid: ConstructionPhase[] = ['excavation', 'frame', 'facade', 'fitout', 'complete'];
  return valid.includes(v) ? (v as ConstructionPhase) : 'complete';
}

export function getDemolitionPhase(entity: Entity): DemolitionPhase | null {
  const v = (entity as Record<string, unknown>)['demolition_phase'];
  if (!v) return null;
  const valid = ['marked', 'stripping', 'collapse', 'cleared'] as const;
  if ((valid as readonly string[]).includes(v as string)) {
    return v as DemolitionPhase;
  }
  return null;
}

export function getWeatherWetness(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'weather_wetness', 0)));
}

export function getWeatherSnowCover(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'weather_snow_cover', 0)));
}

export function getWeatherFogFactor(entity: Entity): number {
  return Math.max(0, Math.min(1, getField(entity, 'weather_fog_factor', 0)));
}

export function getLandmarkRole(entity: Entity): LandmarkRole {
  const v = getField(entity, 'landmark_role', 'none');
  const valid: LandmarkRole[] = ['none', 'entry', 'critical', 'hub', 'control'];
  return valid.includes(v) ? (v as LandmarkRole) : 'none';
}

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
