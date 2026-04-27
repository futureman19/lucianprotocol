import { computeChiralMass } from './hivemind';
import type {
  BuildingArchetype,
  BuildingCondition,
  ConstructionPhase,
  DemolitionPhase,
  Entity,
  LandmarkRole,
  PowerState,
  Weather,
} from './types';

export const HEIGHT_UNIT_SCALE = 100;
export const CONSTRUCTION_MIN_TICKS = 30;
export const CONSTRUCTION_MAX_TICKS = 60;
export const DEMOLITION_MIN_TICKS = 10;
export const DEMOLITION_MAX_TICKS = 20;
export const HEIGHT_ANIMATION_TICKS = 12;
export const RUBBLE_FADE_TICKS = 100;
export const WEATHER_ROTATION_INTERVAL_CYCLES = 3;
export const IVY_SETTLE_TICKS = 500;
export const IVY_FULL_GROWTH_TICKS = 900;
export const RECENT_EDIT_WINDOW_TICKS = 100;
export const RENOVATION_EDIT_THRESHOLD = 10;
export const SIGNAL_RISE_STEP = 0.08;
export const SIGNAL_FALL_STEP = 0.05;
export const WEATHER_RISE_STEP = 0.1;
export const WEATHER_FALL_STEP = 0.04;

const WEATHER_SEQUENCE: readonly Weather[] = ['clear', 'rain', 'fog', 'snow'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashText(text: string): number {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function getLifecycleSeed(entity: Pick<Entity, 'id' | 'name' | 'path'>): string {
  return entity.path ?? entity.name ?? entity.id;
}

function getExtension(entity: Entity): string {
  return entity.extension?.toLowerCase() ?? '';
}

function getPath(entity: Entity): string {
  return entity.path?.toLowerCase() ?? '';
}

function isEntryPoint(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';
  const entryPatterns = [
    'app.',
    'index.',
    'main.',
    'server.',
    'entry.',
    'router.',
    'routes.',
    'controller.',
    'handler.',
    'layout.',
    'page.',
    'api.',
  ];

  return entryPatterns.some((pattern) => name.startsWith(pattern) || path.includes(pattern));
}

function isInfrastructure(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const ext = getExtension(entity);

  return ext === '.json'
    || ext === '.yml'
    || ext === '.yaml'
    || ext === '.toml'
    || ext === '.config'
    || name.includes('config')
    || name.includes('vite')
    || name.includes('webpack')
    || name.includes('docker')
    || name.includes('dockerfile')
    || name.includes('tsconfig')
    || name.includes('package');
}

function isUtility(entity: Entity): boolean {
  const name = entity.name?.toLowerCase() ?? '';
  const path = getPath(entity);

  return name.includes('util')
    || name.includes('helper')
    || name.includes('lib/')
    || path.includes('/utils/')
    || path.includes('/helpers/');
}

function getDependencyCount(entity: Entity): number {
  return (entity.tether_to?.length ?? 0) + (entity.tether_from?.length ?? 0);
}

function getIdleTicks(entity: Entity, tick: number): number {
  if (entity.last_edit_tick == null) {
    return 0;
  }

  return Math.max(0, tick - entity.last_edit_tick);
}

function getRecentEditBoost(entity: Entity, tick: number): number {
  if (entity.last_edit_tick == null) {
    return 0;
  }

  const idleTicks = getIdleTicks(entity, tick);

  if (idleTicks <= 30) {
    return 0.22;
  }

  if (idleTicks <= 90) {
    return 0.12;
  }

  if (idleTicks <= 180) {
    return 0.06;
  }

  return 0;
}

function getRootConfigWeight(entity: Entity): number {
  const name = entity.name?.toLowerCase() ?? '';
  const path = getPath(entity);

  if (
    name === 'package.json'
    || name === 'tsconfig.json'
    || name === 'vite.config.ts'
    || name === 'vite.config.js'
    || name === 'dockerfile'
    || path.endsWith('/package.json')
    || path.endsWith('/tsconfig.json')
  ) {
    return 2;
  }

  if (isInfrastructure(entity)) {
    return 1;
  }

  return 0;
}

function getProfileFloors(entity: Entity): number {
  const name = entity.name?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';
  const ext = getExtension(entity);
  const mass = entity.mass ?? 1;
  const lines = getEntityLineCount(entity);
  const isBig = lines > 200 || mass > 5;
  const isMedium = lines > 50 || mass > 2;

  if (
    name === 'app.tsx'
    || name === 'app.ts'
    || name === 'app.js'
    || name === 'app.jsx'
    || name === 'index.html'
    || name === 'index.ts'
    || name === 'index.tsx'
  ) {
    return Math.max(6, mass);
  }

  if (isEntryPoint(entity) && isBig) {
    return Math.max(5, mass);
  }

  if (ext === '.tsx' || ext === '.jsx' || name.includes('component') || path.includes('/components/')) {
    return Math.max(1.5, mass * 0.4);
  }

  if (isInfrastructure(entity)) {
    return Math.max(1, mass * 0.3);
  }

  if (name.includes('vite') || name.includes('webpack') || name.includes('rollup') || name.includes('build')) {
    return Math.max(2, mass * 0.5);
  }

  if (ext === '.md' || ext === '.mdx') {
    return 1.2;
  }

  if (name.includes('.test.') || name.includes('.spec.')) {
    return 1.5;
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext)) {
    return 0.9;
  }

  if ((ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') && isBig) {
    return Math.max(3, mass * 0.6);
  }

  if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') {
    return 1;
  }

  if (isUtility(entity) || (!isMedium && !isEntryPoint(entity))) {
    return Math.max(0.8, mass * 0.3);
  }

  if (isMedium) {
    return Math.max(2, mass * 0.5);
  }

  return Math.max(1, mass * 0.4);
}

export function getEntityLineCount(entity: Pick<Entity, 'content' | 'content_preview' | 'type'>): number {
  if (entity.type !== 'file') {
    return 1;
  }

  const source = entity.content ?? entity.content_preview ?? '';
  if (source.length === 0) {
    return 1;
  }

  return source.split('\n').length;
}

export function getEntityTargetHeightUnits(entity: Entity): number {
  if (entity.type === 'goal') {
    return 20;
  }

  if (entity.type === 'wall') {
    return 100;
  }

  if (entity.type === 'directory') {
    return 60;
  }

  if (entity.type === 'particle') {
    return entity.target_height ?? 24;
  }

  if (entity.type === 'rubble') {
    return 18;
  }

  if (entity.type !== 'file') {
    return 70;
  }

  return Math.max(20, Math.round(getProfileFloors(entity) * 0.8 * HEIGHT_UNIT_SCALE));
}

export function heightUnitsToWorldHeight(heightUnits: number | null | undefined): number {
  if (typeof heightUnits !== 'number') {
    return 0;
  }

  return heightUnits / HEIGHT_UNIT_SCALE;
}

export function getConstructionDurationTicks(entity: Pick<Entity, 'id' | 'name' | 'path'>): number {
  const seed = hashText(`${getLifecycleSeed(entity)}:construct`);
  const span = CONSTRUCTION_MAX_TICKS - CONSTRUCTION_MIN_TICKS;
  return CONSTRUCTION_MIN_TICKS + (seed % (span + 1));
}

export function getDemolitionDurationTicks(entity: Pick<Entity, 'id' | 'name' | 'path'>): number {
  const seed = hashText(`${getLifecycleSeed(entity)}:demolish`);
  const span = DEMOLITION_MAX_TICKS - DEMOLITION_MIN_TICKS;
  return DEMOLITION_MIN_TICKS + (seed % (span + 1));
}

export function advanceHeightTowardsTarget(
  currentHeight: number,
  targetHeight: number,
  remainingTicks = HEIGHT_ANIMATION_TICKS,
): number {
  if (currentHeight === targetHeight) {
    return targetHeight;
  }

  const delta = targetHeight - currentHeight;
  const safeRemainingTicks = Math.max(1, remainingTicks);
  const step = Math.max(1, Math.ceil(Math.abs(delta) / safeRemainingTicks));
  return currentHeight + (Math.sign(delta) * Math.min(Math.abs(delta), step));
}

export function getWeatherForQueenCycle(cycle: number): Weather {
  const index = Math.floor(cycle / WEATHER_ROTATION_INTERVAL_CYCLES) % WEATHER_SEQUENCE.length;
  return WEATHER_SEQUENCE[index] ?? 'clear';
}

export function isUnderRenovation(entity: Entity, tick: number): boolean {
  if (entity.last_edit_tick == null) {
    return false;
  }

  return (entity.edit_count ?? 0) > RENOVATION_EDIT_THRESHOLD
    && (tick - entity.last_edit_tick) <= RECENT_EDIT_WINDOW_TICKS;
}

export function getIvyTargetCoverage(entity: Entity, tick: number): number {
  if (entity.type !== 'file') {
    return 0;
  }

  if (entity.last_edit_tick == null) {
    return 0;
  }

  const idleTicks = tick - entity.last_edit_tick;
  if (idleTicks < IVY_SETTLE_TICKS) {
    return 0;
  }

  const growthTicks = idleTicks - IVY_SETTLE_TICKS;
  return clamp(growthTicks / IVY_FULL_GROWTH_TICKS, 0, 1);
}

export function advanceNormalizedValue(
  currentValue: number,
  targetValue: number,
  riseStep = SIGNAL_RISE_STEP,
  fallStep = SIGNAL_FALL_STEP,
): number {
  const current = clamp(currentValue, 0, 1);
  const target = clamp(targetValue, 0, 1);

  if (Math.abs(current - target) < 0.001) {
    return Number(target.toFixed(2));
  }

  const delta = target - current;
  const step = delta > 0 ? riseStep : fallStep;
  const nextValue =
    delta > 0
      ? Math.min(target, current + step)
      : Math.max(target, current - step);

  return Number(nextValue.toFixed(2));
}

export function getBuildingArchetype(entity: Entity): BuildingArchetype {
  const ext = getExtension(entity);
  const name = entity.name?.toLowerCase() ?? '';
  const path = getPath(entity);
  const lines = getEntityLineCount(entity);
  const dependencyCount = getDependencyCount(entity);

  if (entity.type === 'directory') {
    if (path.includes('/api') || path.includes('/server') || path.includes('/backend')) {
      return 'civic';
    }

    if (path.includes('/config') || path.includes('/infra') || path.includes('/ops')) {
      return 'substation';
    }

    return 'campus';
  }

  if (getRootConfigWeight(entity) >= 2) {
    return 'landmark';
  }

  if (isInfrastructure(entity)) {
    return 'substation';
  }

  if (name.includes('.test.') || name.includes('.spec.') || path.includes('/test') || path.includes('/spec')) {
    return 'campus';
  }

  if (
    ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.mp4', '.mp3', '.wav'].includes(ext)
    || path.includes('/public/')
    || path.includes('/assets/')
  ) {
    return 'warehouse';
  }

  if (isEntryPoint(entity) && (lines > 140 || dependencyCount >= 5)) {
    return 'tower';
  }

  if (dependencyCount >= 7 || computeChiralMass(entity) >= 9) {
    return 'factory';
  }

  if (ext === '.tsx' || ext === '.jsx' || ext === '.css' || ext === '.scss' || path.includes('/components/')) {
    return 'shopfront';
  }

  if (isEntryPoint(entity)) {
    return 'civic';
  }

  if (isUtility(entity) || path.includes('/lib/') || path.includes('/core/')) {
    return 'campus';
  }

  return 'warehouse';
}

export function getImportanceTier(entity: Entity): 0 | 1 | 2 | 3 {
  let score = 0;
  const dependencyCount = getDependencyCount(entity);
  const lines = getEntityLineCount(entity);

  if (isEntryPoint(entity)) {
    score += 1;
  }

  if (dependencyCount >= 4 || computeChiralMass(entity) >= 7 || lines >= 180) {
    score += 1;
  }

  if (getRootConfigWeight(entity) >= 2 || dependencyCount >= 8 || entity.tether_broken === true) {
    score += 1;
  }

  return clamp(score, 0, 3) as 0 | 1 | 2 | 3;
}

export function getLandmarkRole(entity: Entity): LandmarkRole {
  const dependencyCount = getDependencyCount(entity);

  if (getRootConfigWeight(entity) >= 2) {
    return 'control';
  }

  if (isEntryPoint(entity)) {
    return 'entry';
  }

  if (dependencyCount >= 8) {
    return 'hub';
  }

  if (entity.tether_broken === true || computeChiralMass(entity) >= 9 || entity.git_status === 'conflicted') {
    return 'critical';
  }

  return 'none';
}

export function getConstructionPhase(entity: Entity, tick: number): ConstructionPhase {
  if (entity.node_state !== 'constructing') {
    return 'complete';
  }

  const duration = getConstructionDurationTicks(entity);
  const elapsed = Math.max(0, tick - (entity.state_tick ?? tick));
  const progress = clamp(elapsed / Math.max(1, duration), 0, 1);

  if (progress < 0.18) {
    return 'excavation';
  }

  if (progress < 0.48) {
    return 'frame';
  }

  if (progress < 0.8) {
    return 'facade';
  }

  if (progress < 1) {
    return 'fitout';
  }

  return 'complete';
}

export function getDemolitionPhase(entity: Entity, tick: number): DemolitionPhase | null {
  if (entity.node_state !== 'demolishing') {
    return null;
  }

  const duration = getDemolitionDurationTicks(entity);
  const elapsed = Math.max(0, tick - (entity.state_tick ?? tick));
  const progress = clamp(elapsed / Math.max(1, duration), 0, 1);

  if (progress < 0.2) {
    return 'marked';
  }

  if (progress < 0.55) {
    return 'stripping';
  }

  if (progress < 0.9) {
    return 'collapse';
  }

  return 'cleared';
}

export function getBuildingCondition(entity: Entity, tick: number): BuildingCondition {
  const idleTicks = getIdleTicks(entity, tick);

  if (entity.node_state === 'demolishing' || entity.git_status === 'deleted') {
    return 'condemned';
  }

  if (entity.tether_broken === true || entity.git_status === 'conflicted') {
    return 'decaying';
  }

  if (entity.node_state === 'constructing' || isUnderRenovation(entity, tick)) {
    return 'maintained';
  }

  if (idleTicks >= 1400) {
    return 'decaying';
  }

  if (idleTicks >= 650) {
    return 'worn';
  }

  if ((entity.edit_count ?? 0) <= 2 && idleTicks < 180 && (entity.git_status == null || entity.git_status === 'clean')) {
    return 'pristine';
  }

  return 'maintained';
}

export function getUpgradeLevel(entity: Entity, tick: number): 0 | 1 | 2 | 3 {
  let score = getImportanceTier(entity);

  if ((entity.edit_count ?? 0) >= 10) {
    score += 1;
  }

  if (getLandmarkRole(entity) !== 'none') {
    score += 1;
  }

  if (getBuildingCondition(entity, tick) === 'condemned') {
    score -= 2;
  } else if (getBuildingCondition(entity, tick) === 'decaying') {
    score -= 1;
  }

  return clamp(score, 0, 3) as 0 | 1 | 2 | 3;
}

export function getTargetActivityLevel(entity: Entity, tick: number): number {
  const archetype = getBuildingArchetype(entity);
  const recentEditBoost = getRecentEditBoost(entity, tick);
  const condition = getBuildingCondition(entity, tick);

  if (entity.node_state === 'constructing' || entity.node_state === 'demolishing') {
    return 1;
  }

  const baseActivityByArchetype: Record<BuildingArchetype, number> = {
    tower: 0.68,
    warehouse: 0.34,
    shopfront: 0.64,
    campus: 0.54,
    factory: 0.72,
    civic: 0.62,
    substation: 0.22,
    landmark: 0.78,
  };

  let target = baseActivityByArchetype[archetype] + recentEditBoost;

  if (entity.git_status === 'modified' || entity.git_status === 'added' || entity.git_status === 'renamed') {
    target += 0.08;
  }

  if (condition === 'worn') {
    target -= 0.06;
  } else if (condition === 'decaying') {
    target -= 0.16;
  } else if (condition === 'condemned') {
    target = 0.08;
  }

  return clamp(target, 0, 1);
}

export function getTargetOccupancy(
  entity: Entity,
  tick: number,
  activityLevel = getTargetActivityLevel(entity, tick),
): number {
  const archetype = getBuildingArchetype(entity);
  const condition = getBuildingCondition(entity, tick);

  if (entity.node_state === 'constructing') {
    return 0.18;
  }

  if (entity.node_state === 'demolishing' || condition === 'condemned') {
    return 0.04;
  }

  const baseOccupancyByArchetype: Record<BuildingArchetype, number> = {
    tower: 0.7,
    warehouse: 0.28,
    shopfront: 0.62,
    campus: 0.56,
    factory: 0.6,
    civic: 0.66,
    substation: 0.18,
    landmark: 0.74,
  };

  let target = (baseOccupancyByArchetype[archetype] * 0.75) + (activityLevel * 0.25);

  if (condition === 'worn') {
    target -= 0.08;
  } else if (condition === 'decaying') {
    target -= 0.18;
  }

  return clamp(target, 0, 1);
}

export function getTargetNetworkLoad(
  entity: Entity,
  tick: number,
  activityLevel = getTargetActivityLevel(entity, tick),
): number {
  const dependencyScore = clamp(getDependencyCount(entity) / 10, 0, 1);
  const importanceScore = getImportanceTier(entity) / 3;
  const recentEditBoost = getRecentEditBoost(entity, tick);
  return clamp(0.12 + (dependencyScore * 0.52) + (importanceScore * 0.18) + (activityLevel * 0.12) + recentEditBoost, 0, 1);
}

export function getTargetTrafficLoad(
  entity: Entity,
  tick: number,
  activityLevel = getTargetActivityLevel(entity, tick),
  occupancy = getTargetOccupancy(entity, tick, activityLevel),
): number {
  const archetype = getBuildingArchetype(entity);
  const landmarkRole = getLandmarkRole(entity);

  let target = 0.08 + (occupancy * 0.45) + (activityLevel * 0.2);

  if (archetype === 'shopfront' || archetype === 'civic' || archetype === 'landmark') {
    target += 0.12;
  }

  if (landmarkRole === 'entry' || landmarkRole === 'hub') {
    target += 0.1;
  }

  return clamp(target, 0, 1);
}

export function getPowerState(
  entity: Entity,
  weather: Weather,
  metrics: {
    activityLevel: number;
    occupancy: number;
    networkLoad: number;
    trafficLoad: number;
    condition?: BuildingCondition;
  },
): PowerState {
  const condition = metrics.condition ?? getBuildingCondition(entity, 0);

  if (condition === 'condemned') {
    return 'offline';
  }

  const weatherPenalty = weather === 'rain' || weather === 'snow'
    ? 0.08
    : weather === 'fog'
      ? 0.04
      : 0;
  const strainScore = Math.max(
    metrics.activityLevel,
    metrics.occupancy,
    metrics.networkLoad + weatherPenalty,
    metrics.trafficLoad + (weatherPenalty * 0.5),
  );

  if (condition === 'decaying' && strainScore < 0.2) {
    return 'offline';
  }

  if (strainScore >= 0.9) {
    return 'overloaded';
  }

  if (strainScore >= 0.68 || condition === 'decaying') {
    return 'strained';
  }

  return 'normal';
}

export function getWeatherAccumulationTargets(
  entity: Entity,
  weather: Weather,
): {
  weather_fog_factor: number;
  weather_snow_cover: number;
  weather_wetness: number;
} {
  const archetype = getBuildingArchetype(entity);
  const roofExposureByArchetype: Record<BuildingArchetype, number> = {
    tower: 1,
    warehouse: 0.86,
    shopfront: 0.62,
    campus: 0.76,
    factory: 0.82,
    civic: 0.88,
    substation: 0.7,
    landmark: 1,
  };

  const roofExposure = roofExposureByArchetype[archetype];

  return {
    weather_wetness: weather === 'rain' ? 1 : weather === 'snow' ? 0.3 : weather === 'fog' ? 0.16 : 0,
    weather_snow_cover: weather === 'snow' ? clamp(roofExposure, 0, 1) : 0,
    weather_fog_factor: weather === 'fog' ? 1 : weather === 'snow' ? 0.4 : weather === 'rain' ? 0.24 : 0,
  };
}
