import type { Entity } from '../src/types';
import {
  getBuildingArchetype as getExplicitArchetype,
  getImportanceTier,
  getLandmarkRole,
  getUpgradeLevel,
  isEntryPoint,
  type BuildingArchetype,
  type LandmarkRole,
} from './shared-contract';
export type { BuildingArchetype } from './shared-contract';

export interface ArchetypeProfile {
  archetype: BuildingArchetype;
  importanceTier: 0 | 1 | 2 | 3;
  upgradeLevel: 0 | 1 | 2 | 3;
  landmarkRole: LandmarkRole;
  seed: number;
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function deriveArchetypeFromEntity(entity: Entity): BuildingArchetype {
  const explicit = getExplicitArchetype(entity);
  if (explicit) return explicit;

  const name = entity.name?.toLowerCase() ?? '';
  const ext = entity.extension?.toLowerCase() ?? '';
  const path = entity.path?.toLowerCase() ?? '';

  // Canonical fallback heuristics based on file metadata
  if (['.tsx', '.jsx'].includes(ext) || name.includes('component') || path.includes('/components/')) {
    return 'shopfront';
  }
  if (['.json', '.yml', '.yaml', '.toml'].includes(ext) || name.includes('config')) {
    return 'substation';
  }
  if (['.md', '.mdx'].includes(ext)) {
    return 'campus';
  }
  if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
    return 'shopfront';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext)) {
    return 'landmark';
  }
  if (['.sh', '.ps1', '.bat', '.cmd'].includes(ext) || name.includes('vite') || name.includes('webpack') || name.includes('rollup') || name.includes('build')) {
    return 'factory';
  }
  if (name.includes('.test.') || name.includes('.spec.')) {
    return 'civic';
  }
  if (isEntryPoint(entity)) {
    return 'landmark';
  }

  return 'warehouse';
}

export function deriveImportanceTierFromEntity(entity: Entity): 0 | 1 | 2 | 3 {
  const explicit = getImportanceTier(entity);
  if (explicit > 0) return explicit;

  const mass = entity.mass ?? 1;
  const name = entity.name?.toLowerCase() ?? '';
  const lines = (entity.content_preview ?? entity.content ?? '').split('\n').length;
  const isBig = lines > 200 || mass > 5;

  if (name === 'app.tsx' || name === 'app.ts' || name === 'app.js' || name === 'app.jsx' ||
      name === 'index.html' || name === 'index.ts' || name === 'index.tsx') return 3;
  if (isEntryPoint(entity) && isBig) return 3;
  if (isEntryPoint(entity)) return 2;
  if (mass >= 4) return 2;
  if (mass >= 2) return 1;
  return 0;
}

export function deriveUpgradeLevelFromEntity(entity: Entity): 0 | 1 | 2 | 3 {
  const explicit = getUpgradeLevel(entity);
  if (explicit > 0) return explicit;

  const mass = entity.mass ?? 1;
  const edits = entity.edit_count ?? 0;
  const score = mass + edits * 0.5;
  if (score >= 6) return 3;
  if (score >= 3) return 2;
  if (score >= 1) return 1;
  return 0;
}

export function deriveLandmarkRoleFromEntity(entity: Entity): LandmarkRole {
  const explicit = getLandmarkRole(entity);
  if (explicit !== 'none') return explicit;

  if (isEntryPoint(entity)) {
    const name = entity.name?.toLowerCase() ?? '';
    if (name.includes('app.') || name.includes('index.')) return 'entry';
    return 'critical';
  }

  return 'none';
}

export function getArchetypeProfile(entity: Entity): ArchetypeProfile {
  return {
    archetype: deriveArchetypeFromEntity(entity),
    importanceTier: deriveImportanceTierFromEntity(entity),
    upgradeLevel: deriveUpgradeLevelFromEntity(entity),
    landmarkRole: deriveLandmarkRoleFromEntity(entity),
    seed: hashString(entity.id),
  };
}

export function getArchetypePalette(archetype: BuildingArchetype): {
  primary: string;
  secondary: string;
  accent: string;
  trim: string;
  windowLit: string;
  windowDark: string;
} {
  // SC2K-style base material colors per archetype
  // Primary is the base wall material; all face tones are derived via hue-shift
  switch (archetype) {
    case 'tower':
      return {
        primary: '#64748b',
        secondary: '#475569',
        accent: '#38bdf8',
        trim: '#94a3b8',
        windowLit: '#fef08a',
        windowDark: '#1e293b',
      };
    case 'warehouse':
      return {
        primary: '#b45309',
        secondary: '#78350f',
        accent: '#f59e0b',
        trim: '#fcd34d',
        windowLit: '#fef3c7',
        windowDark: '#451a03',
      };
    case 'shopfront':
      return {
        primary: '#be185d',
        secondary: '#9d174d',
        accent: '#f472b6',
        trim: '#fbcfe8',
        windowLit: '#fce7f3',
        windowDark: '#831843',
      };
    case 'campus':
      return {
        primary: '#15803d',
        secondary: '#14532d',
        accent: '#4ade80',
        trim: '#bbf7d0',
        windowLit: '#dcfce7',
        windowDark: '#14532d',
      };
    case 'factory':
      return {
        primary: '#1e3a8a',
        secondary: '#1e40af',
        accent: '#60a5fa',
        trim: '#bfdbfe',
        windowLit: '#dbeafe',
        windowDark: '#172554',
      };
    case 'civic':
      return {
        primary: '#cbd5e1',
        secondary: '#94a3b8',
        accent: '#f8fafc',
        trim: '#64748b',
        windowLit: '#ffffff',
        windowDark: '#475569',
      };
    case 'substation':
      return {
        primary: '#52525b',
        secondary: '#27272a',
        accent: '#a1a1aa',
        trim: '#d4d4d8',
        windowLit: '#f4f4f5',
        windowDark: '#18181b',
      };
    case 'landmark':
      return {
        primary: '#7c3aed',
        secondary: '#6d28d9',
        accent: '#c4b5fd',
        trim: '#ddd6fe',
        windowLit: '#ede9fe',
        windowDark: '#4c1d95',
      };
    default:
      return {
        primary: '#64748b',
        secondary: '#475569',
        accent: '#94a3b8',
        trim: '#cbd5e1',
        windowLit: '#e2e8f0',
        windowDark: '#1e293b',
      };
  }
}

export function getArchetypeSilhouette(
  archetype: BuildingArchetype,
  importanceTier: number,
  upgradeLevel: number,
  seed: number,
): {
  baseWidthScale: number;
  baseDepthScale: number;
  baseHeight: number;
  midWidthScale: number;
  midDepthScale: number;
  midHeight: number;
  crownWidthScale: number;
  crownDepthScale: number;
  crownHeight: number;
  hasSpire: boolean;
} {
  const rng = (offset: number) => {
    const x = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  const tierBoost = importanceTier * 0.08 + upgradeLevel * 0.05;

  switch (archetype) {
    case 'tower': {
      const baseW = 0.9 + rng(1) * 0.1;
      const baseD = 0.9 + rng(2) * 0.1;
      const midW = 0.65 + rng(3) * 0.15;
      const midD = 0.65 + rng(4) * 0.15;
      const crownW = 0.4 + rng(5) * 0.2;
      const crownD = 0.4 + rng(6) * 0.2;
      return {
        baseWidthScale: baseW,
        baseDepthScale: baseD,
        baseHeight: 0.15 + tierBoost * 0.3,
        midWidthScale: midW,
        midDepthScale: midD,
        midHeight: 0.55 + tierBoost * 0.4,
        crownWidthScale: crownW,
        crownDepthScale: crownD,
        crownHeight: 0.2 + tierBoost * 0.2,
        hasSpire: importanceTier >= 2,
      };
    }
    case 'warehouse': {
      return {
        baseWidthScale: 1.0,
        baseDepthScale: 1.0,
        baseHeight: 0.85,
        midWidthScale: 0.9,
        midDepthScale: 0.9,
        midHeight: 0.1,
        crownWidthScale: 0.8,
        crownDepthScale: 0.8,
        crownHeight: 0.05,
        hasSpire: false,
      };
    }
    case 'shopfront': {
      return {
        baseWidthScale: 1.0,
        baseDepthScale: 0.85,
        baseHeight: 0.7,
        midWidthScale: 0.9,
        midDepthScale: 0.75,
        midHeight: 0.2,
        crownWidthScale: 0.7,
        crownDepthScale: 0.6,
        crownHeight: 0.1,
        hasSpire: false,
      };
    }
    case 'campus': {
      return {
        baseWidthScale: 1.0,
        baseDepthScale: 1.0,
        baseHeight: 0.5,
        midWidthScale: 0.85,
        midDepthScale: 0.85,
        midHeight: 0.25,
        crownWidthScale: 0.6,
        crownDepthScale: 0.6,
        crownHeight: 0.25,
        hasSpire: importanceTier >= 2,
      };
    }
    case 'factory': {
      return {
        baseWidthScale: 1.0,
        baseDepthScale: 1.0,
        baseHeight: 0.6,
        midWidthScale: 0.9,
        midDepthScale: 0.9,
        midHeight: 0.25,
        crownWidthScale: 0.7,
        crownDepthScale: 0.7,
        crownHeight: 0.15,
        hasSpire: false,
      };
    }
    case 'civic': {
      return {
        baseWidthScale: 1.0,
        baseDepthScale: 1.0,
        baseHeight: 0.45,
        midWidthScale: 0.85,
        midDepthScale: 0.85,
        midHeight: 0.3,
        crownWidthScale: 0.5,
        crownDepthScale: 0.5,
        crownHeight: 0.25,
        hasSpire: true,
      };
    }
    case 'substation': {
      return {
        baseWidthScale: 0.7,
        baseDepthScale: 0.7,
        baseHeight: 0.8,
        midWidthScale: 0.6,
        midDepthScale: 0.6,
        midHeight: 0.1,
        crownWidthScale: 0.5,
        crownDepthScale: 0.5,
        crownHeight: 0.1,
        hasSpire: false,
      };
    }
    case 'landmark': {
      return {
        baseWidthScale: 0.9,
        baseDepthScale: 0.9,
        baseHeight: 0.3,
        midWidthScale: 0.7,
        midDepthScale: 0.7,
        midHeight: 0.4,
        crownWidthScale: 0.5,
        crownDepthScale: 0.5,
        crownHeight: 0.3,
        hasSpire: true,
      };
    }
    default:
      return {
        baseWidthScale: 1.0,
        baseDepthScale: 1.0,
        baseHeight: 0.6,
        midWidthScale: 0.9,
        midDepthScale: 0.9,
        midHeight: 0.3,
        crownWidthScale: 0.7,
        crownDepthScale: 0.7,
        crownHeight: 0.1,
        hasSpire: false,
      };
  }
}
