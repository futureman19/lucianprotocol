import type { Entity } from '../src/types';

export interface BuildingStyle {
  accent: string;
  glow: string;
  left: string;
  right: string;
  top: string;
  trim: string;
  windowColor: string;
  windowGlow: string;
  roofStyle: 'flat' | 'peaked' | 'dome' | 'antenna' | 'none';
  architecture: 'modern' | 'industrial' | 'data' | 'temple' | 'garden' | 'utility';
}

export interface DroneStyle {
  fill: string;
  glow: string;
  stroke: string;
  core: string;
  shape: 'scout' | 'miner' | 'builder' | 'repairer' | 'hauler' | 'command';
}

// File extension → building district styles
export function getBuildingStyle(entity: Entity): BuildingStyle {
  const path = entity.path ?? '';
  const pathExt = path.split('.').pop()?.toLowerCase() ?? '';
  const ext = pathExt || (entity.extension?.replace(/^\./, '').toLowerCase() ?? '');
  const name = entity.name?.toLowerCase() ?? '';

  if (entity.type === 'directory') {
    return {
      accent: '#CBD5E1',
      glow: 'rgba(203, 213, 225, 0.35)',
      left: '#E2E8F0',
      right: '#CBD5E1',
      top: '#F8FAFC',
      trim: '#94A3B8',
      windowColor: 'rgba(191, 219, 254, 0.48)',
      windowGlow: 'rgba(191, 219, 254, 0.18)',
      roofStyle: 'dome',
      architecture: 'temple',
    };
  }

  // Test files - Research / clinical complexes
  if (name.includes('.test.') || name.includes('.spec.') || ext === 'test') {
    return {
      accent: '#A855F7',
      glow: 'rgba(168, 85, 247, 0.4)',
      left: '#6B21A8',
      right: '#581C87',
      top: '#7E22CE',
      trim: '#D8B4FE',
      windowColor: 'rgba(233, 213, 255, 0.7)',
      windowGlow: 'rgba(233, 213, 255, 0.3)',
      roofStyle: 'dome',
      architecture: 'modern',
    };
  }

  // UI components - expressive retail facades
  if (['tsx', 'jsx', 'vue', 'svelte', 'astro', 'html', 'htm'].includes(ext) || name.includes('component')) {
    return {
      accent: '#38BDF8',
      glow: 'rgba(56, 189, 248, 0.4)',
      left: '#475569',
      right: '#334155',
      top: '#CBD5E1',
      trim: '#F8FAFC',
      windowColor: 'rgba(254, 240, 138, 0.72)',
      windowGlow: 'rgba(254, 240, 138, 0.32)',
      roofStyle: 'peaked',
      architecture: 'modern',
    };
  }

  // Source code files - Commercial towers (Blue/Gray glass)
  if (['ts', 'js', 'mts', 'cts', 'mjs', 'cjs'].includes(ext)) {
    return {
      accent: '#3B82F6',
      glow: 'rgba(59, 130, 246, 0.4)',
      left: '#4B5563',
      right: '#374151',
      top: '#9CA3AF',
      trim: '#D1D5DB',
      windowColor: 'rgba(253, 248, 225, 0.8)',
      windowGlow: 'rgba(253, 248, 225, 0.4)',
      roofStyle: 'antenna',
      architecture: 'modern',
    };
  }

  // Query and schema files - data domes
  if (['sql', 'psql', 'prisma', 'graphql', 'gql'].includes(ext)) {
    return {
      accent: '#38BDF8',
      glow: 'rgba(56, 189, 248, 0.38)',
      left: '#155E75',
      right: '#164E63',
      top: '#0EA5E9',
      trim: '#BAE6FD',
      windowColor: 'rgba(224, 242, 254, 0.7)',
      windowGlow: 'rgba(224, 242, 254, 0.28)',
      roofStyle: 'dome',
      architecture: 'data',
    };
  }

  // Config/Data files - Industrial (Brown/Yellow/Orange)
  if (['json', 'yml', 'yaml', 'toml', 'env', 'ini', 'config'].includes(ext) || name.includes('config')) {
    return {
      accent: '#F59E0B',
      glow: 'rgba(245, 158, 11, 0.4)',
      left: '#92400E',
      right: '#78350F',
      top: '#B45309',
      trim: '#FCD34D',
      windowColor: 'rgba(254, 243, 199, 0.6)',
      windowGlow: 'rgba(254, 243, 199, 0.25)',
      roofStyle: 'flat',
      architecture: 'industrial',
    };
  }

  // Scripts / orchestration files - service yards
  if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat'].includes(ext)) {
    return {
      accent: '#14B8A6',
      glow: 'rgba(20, 184, 166, 0.38)',
      left: '#115E59',
      right: '#134E4A',
      top: '#0F766E',
      trim: '#99F6E4',
      windowColor: 'rgba(204, 251, 241, 0.58)',
      windowGlow: 'rgba(204, 251, 241, 0.22)',
      roofStyle: 'antenna',
      architecture: 'utility',
    };
  }

  // Documentation - Civic / Monument (White/Marble)
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) {
    return {
      accent: '#E5E7EB',
      glow: 'rgba(229, 231, 235, 0.35)',
      left: '#F3F4F6',
      right: '#E5E7EB',
      top: '#FFFFFF',
      trim: '#9CA3AF',
      windowColor: 'rgba(191, 219, 254, 0.5)',
      windowGlow: 'rgba(191, 219, 254, 0.15)',
      roofStyle: 'dome',
      architecture: 'temple',
    };
  }

  // Styles - Residential (Brick/Wood/Greenery)
  if (['css', 'scss', 'sass', 'less', 'styl'].includes(ext)) {
    return {
      accent: '#EF4444',
      glow: 'rgba(239, 68, 68, 0.4)',
      left: '#B91C1C',
      right: '#991B1B',
      top: '#DC2626',
      trim: '#FECACA',
      windowColor: 'rgba(254, 240, 138, 0.7)',
      windowGlow: 'rgba(254, 240, 138, 0.3)',
      roofStyle: 'peaked',
      architecture: 'garden',
    };
  }

  // Assets/Media - Parks / Utility (Green)
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return {
      accent: '#22C55E',
      glow: 'rgba(34, 197, 94, 0.4)',
      left: '#166534',
      right: '#14532D',
      top: '#15803D',
      trim: '#86EFAC',
      windowColor: 'rgba(134, 239, 172, 0.5)',
      windowGlow: 'rgba(134, 239, 172, 0.2)',
      roofStyle: 'none',
      architecture: 'utility',
    };
  }

  // Default - Generic modern building (Light Gray/Concrete)
  return {
    accent: '#9CA3AF',
    glow: 'rgba(156, 163, 175, 0.4)',
    left: '#D1D5DB',
    right: '#9CA3AF',
    top: '#F3F4F6',
    trim: '#6B7280',
    windowColor: 'rgba(253, 248, 225, 0.6)',
    windowGlow: 'rgba(253, 248, 225, 0.25)',
    roofStyle: 'flat',
    architecture: 'modern',
  };
}

// Drone role → visual style
export function getDroneStyle(entity: Entity): DroneStyle {
  const role = entity.agent_role ?? 'architect';

  if (role === 'visionary') {
    return {
      fill: '#ec4899',
      glow: 'rgba(236, 72, 153, 0.78)',
      stroke: '#ffb0dc',
      core: '#fff0f7',
      shape: 'scout',
    };
  }

  if (role === 'critic') {
    return {
      fill: '#ef4444',
      glow: 'rgba(239, 68, 68, 0.8)',
      stroke: '#ffc0c0',
      core: '#fff0f0',
      shape: 'repairer',
    };
  }

  // Architect variants based on behavior
  const name = entity.name?.toLowerCase() ?? '';
  if (name.includes('builder') || name.includes('scv')) {
    return {
      fill: '#10b981',
      glow: 'rgba(16, 185, 129, 0.78)',
      stroke: '#8cffd3',
      core: '#e0fff0',
      shape: 'builder',
    };
  }

  if (name.includes('miner') || name.includes('harvest')) {
    return {
      fill: '#3b82f6',
      glow: 'rgba(59, 130, 246, 0.78)',
      stroke: '#bfdbfe',
      core: '#eff6ff',
      shape: 'miner',
    };
  }

  if (name.includes('hauler') || name.includes('carry')) {
    return {
      fill: '#f59e0b',
      glow: 'rgba(245, 158, 11, 0.78)',
      stroke: '#fde68a',
      core: '#fffbeb',
      shape: 'hauler',
    };
  }

  // Default architect
  return {
    fill: '#10b981',
    glow: 'rgba(16, 185, 129, 0.78)',
    stroke: '#8cffd3',
    core: '#e0fff0',
    shape: 'builder',
  };
}

// Node state overrides the building style with condition colors
export function getNodeStatePalette(nodeState: string): {
  accent: string;
  glow: string;
  left: string;
  right: string;
  top: string;
  warning: boolean;
} {
  if (nodeState === 'task') {
    return {
      accent: '#ec4899',
      glow: 'rgba(236, 72, 153, 0.45)',
      left: '#5d1a4a',
      right: '#7a225f',
      top: '#a93782',
      warning: false,
    };
  }

  if (nodeState === 'in-progress') {
    return {
      accent: '#fb923c',
      glow: 'rgba(251, 146, 60, 0.5)',
      left: '#6d3207',
      right: '#92400e',
      top: '#c76716',
      warning: false,
    };
  }

  if (nodeState === 'asymmetry') {
    return {
      accent: '#fde047',
      glow: 'rgba(239, 68, 68, 0.58)',
      left: '#6b1b1b',
      right: '#9a3412',
      top: '#d9b423',
      warning: true,
    };
  }

  if (nodeState === 'verified') {
    return {
      accent: '#22c55e',
      glow: 'rgba(34, 197, 94, 0.52)',
      left: '#0c4d2d',
      right: '#166534',
      top: '#22a653',
      warning: false,
    };
  }

  return {
    accent: '#56d9ff',
    glow: 'rgba(86, 217, 255, 0.46)',
    left: '#103d62',
    right: '#18608b',
    top: '#2489b8',
    warning: false,
  };
}

// File extension → building footprint
export function getFileFootprint(entity: Entity): { depth: number; width: number } {
  if (entity.type === 'directory') {
    return { depth: 1.6, width: 1.6 };
  }

  if (entity.type === 'file') {
    // Size-based footprint
    const content = entity.content ?? entity.content_preview ?? '';
    const lines = content.split('\n').length;
    const mass = entity.mass ?? 1;
    const scale = Math.min(1.5, Math.max(0.5, 0.5 + (lines / 500) + (mass / 10)));
    return { depth: 0.6 * scale, width: 0.6 * scale };
  }

  if (entity.type === 'wall') {
    return { depth: 1, width: 1 };
  }

  return { depth: 0.7, width: 0.7 };
}

// Compute building height based on file complexity
export function getBuildingHeight(entity: Entity): number {
  if (entity.type === 'directory') {
    return 1.2;
  }

  if (entity.type === 'wall') {
    return 1.5;
  }

  if (entity.type === 'goal') {
    return 0.3;
  }

  if (entity.type === 'file') {
    const content = entity.content ?? entity.content_preview ?? '';
    const lines = content.split('\n').length;
    const mass = entity.mass ?? 1;
    // Height grows with file size, capped at skyscraper
    const lineBoost = Math.min(5, Math.floor(lines / 100));
    return Math.min(8, Math.max(0.8, 0.5 + mass * 0.5 + lineBoost));
  }

  return 0.7;
}
