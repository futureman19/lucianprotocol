import type { Entity } from '../src/types';
import type { CityLayout } from './city-layout';
import { getDistrictAtTile } from './city-layout';

export interface DistrictGrammar {
  facadeRhythm: 'regular' | 'staggered' | 'uniform' | 'organic';
  signageDensity: number; // 0..1
  propMix: Record<string, number>;
  roofClutterDensity: number; // 0..1
  colorShift: { r: number; g: number; b: number };
  windowStyle: 'grid' | 'ribbon' | 'punched' | 'glass-curtain';
  groundDressing: 'concrete' | 'cobble' | 'asphalt' | 'gravel' | 'brick';
}

function districtTypeToGrammar(type: string): DistrictGrammar {
  switch (type) {
    case 'downtown':
      return {
        facadeRhythm: 'staggered',
        signageDensity: 0.8,
        propMix: { bench: 0.3, bike: 0.2, planter: 0.2, utility: 0.2, parking: 0.1 },
        roofClutterDensity: 0.7,
        colorShift: { r: -10, g: -10, b: 5 },
        windowStyle: 'glass-curtain',
        groundDressing: 'concrete',
      };
    case 'suburb':
      return {
        facadeRhythm: 'uniform',
        signageDensity: 0.2,
        propMix: { fence: 0.4, bush: 0.3, bike: 0.1, mailbox: 0.2 },
        roofClutterDensity: 0.2,
        colorShift: { r: 10, g: 5, b: -10 },
        windowStyle: 'punched',
        groundDressing: 'gravel',
      };
    case 'industrial':
      return {
        facadeRhythm: 'regular',
        signageDensity: 0.4,
        propMix: { pallet: 0.3, dumpster: 0.2, hvac: 0.3, loading: 0.2 },
        roofClutterDensity: 0.5,
        colorShift: { r: 15, g: 0, b: -15 },
        windowStyle: 'ribbon',
        groundDressing: 'asphalt',
      };
    case 'harbor':
      return {
        facadeRhythm: 'organic',
        signageDensity: 0.3,
        propMix: { container: 0.3, crane: 0.2, pallet: 0.3, fence: 0.2 },
        roofClutterDensity: 0.4,
        colorShift: { r: -5, g: 5, b: 15 },
        windowStyle: 'grid',
        groundDressing: 'cobble',
      };
    case 'park':
      return {
        facadeRhythm: 'organic',
        signageDensity: 0.1,
        propMix: { planter: 0.5, bench: 0.3, bike: 0.2 },
        roofClutterDensity: 0.1,
        colorShift: { r: 5, g: 15, b: -5 },
        windowStyle: 'punched',
        groundDressing: 'brick',
      };
    case 'design':
      return {
        facadeRhythm: 'staggered',
        signageDensity: 0.6,
        propMix: { planter: 0.3, bike: 0.3, bench: 0.2, art: 0.2 },
        roofClutterDensity: 0.3,
        colorShift: { r: 10, g: -5, b: 10 },
        windowStyle: 'glass-curtain',
        groundDressing: 'brick',
      };
    default:
      return {
        facadeRhythm: 'regular',
        signageDensity: 0.3,
        propMix: { bench: 0.2, bike: 0.2, planter: 0.2, utility: 0.2, fence: 0.2 },
        roofClutterDensity: 0.3,
        colorShift: { r: 0, g: 0, b: 0 },
        windowStyle: 'grid',
        groundDressing: 'concrete',
      };
  }
}

export function getEntityDistrictGrammar(
  entity: Entity,
  cityLayout: CityLayout,
): DistrictGrammar {
  const district = getDistrictAtTile(cityLayout, entity.x, entity.y);
  return districtTypeToGrammar(district?.type ?? 'default');
}

export function applyDistrictColorShift(hex: string, shift: { r: number; g: number; b: number }): string {
  if (!hex.startsWith('#') || hex.length < 7) return hex;
  const r = Math.max(0, Math.min(255, parseInt(hex.slice(1, 3), 16) + shift.r));
  const g = Math.max(0, Math.min(255, parseInt(hex.slice(3, 5), 16) + shift.g));
  const b = Math.max(0, Math.min(255, parseInt(hex.slice(5, 7), 16) + shift.b));
  return `rgb(${r},${g},${b})`;
}

export function getFacadeRhythmOffset(
  entity: Entity,
  grammar: DistrictGrammar,
  seed: number,
): number {
  switch (grammar.facadeRhythm) {
    case 'staggered':
      return ((entity.x + entity.y + seed) % 3) * 0.08;
    case 'organic':
      return Math.sin((entity.x + seed) * 0.7) * 0.06;
    case 'uniform':
      return 0;
    case 'regular':
    default:
      return ((entity.x + entity.y) % 2) * 0.04;
  }
}
