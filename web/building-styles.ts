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
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const name = entity.name?.toLowerCase() ?? '';

  // Source code files - Industrial/Steel district
  if (['ts', 'tsx', 'mts', 'cts'].includes(ext)) {
    return {
      accent: '#56d9ff',
      glow: 'rgba(86, 217, 255, 0.46)',
      left: '#0a2a3a',
      right: '#103d52',
      top: '#1a5a75',
      trim: '#2ecfff',
      windowColor: 'rgba(86, 217, 255, 0.7)',
      windowGlow: 'rgba(86, 217, 255, 0.3)',
      roofStyle: 'antenna',
      architecture: 'industrial',
    };
  }

  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return {
      accent: '#ffe066',
      glow: 'rgba(255, 224, 102, 0.42)',
      left: '#3a300a',
      right: '#524510',
      top: '#75621a',
      trim: '#ffd43b',
      windowColor: 'rgba(255, 224, 102, 0.7)',
      windowGlow: 'rgba(255, 224, 102, 0.3)',
      roofStyle: 'flat',
      architecture: 'industrial',
    };
  }

  // Config/Data files - Data silos
  if (['json', 'yml', 'yaml', 'toml', 'env', 'config'].includes(ext) || name.includes('config')) {
    return {
      accent: '#a78bfa',
      glow: 'rgba(167, 139, 250, 0.42)',
      left: '#1e1640',
      right: '#2d2060',
      top: '#3f2f85',
      trim: '#c4b5fd',
      windowColor: 'rgba(167, 139, 250, 0.6)',
      windowGlow: 'rgba(167, 139, 250, 0.25)',
      roofStyle: 'dome',
      architecture: 'data',
    };
  }

  // Documentation - Temple/monument style
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) {
    return {
      accent: '#e9ecef',
      glow: 'rgba(233, 236, 239, 0.35)',
      left: '#2a2a2a',
      right: '#3a3a3a',
      top: '#4a4a4a',
      trim: '#f8f9fa',
      windowColor: 'rgba(233, 236, 239, 0.5)',
      windowGlow: 'rgba(233, 236, 239, 0.15)',
      roofStyle: 'peaked',
      architecture: 'temple',
    };
  }

  // Styles - Garden/pavilion style
  if (['css', 'scss', 'sass', 'less', 'styl'].includes(ext)) {
    return {
      accent: '#f783ac',
      glow: 'rgba(247, 131, 172, 0.42)',
      left: '#3a0f22',
      right: '#521731',
      top: '#752244',
      trim: '#fcc2d7',
      windowColor: 'rgba(247, 131, 172, 0.6)',
      windowGlow: 'rgba(247, 131, 172, 0.25)',
      roofStyle: 'peaked',
      architecture: 'garden',
    };
  }

  // Assets/Media - Utility sheds
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return {
      accent: '#8ce99a',
      glow: 'rgba(140, 233, 154, 0.38)',
      left: '#0f3a18',
      right: '#165224',
      top: '#1f7535',
      trim: '#b2f2bb',
      windowColor: 'rgba(140, 233, 154, 0.5)',
      windowGlow: 'rgba(140, 233, 154, 0.2)',
      roofStyle: 'none',
      architecture: 'utility',
    };
  }

  // Test files
  if (name.includes('.test.') || name.includes('.spec.') || ext === 'test') {
    return {
      accent: '#ff922b',
      glow: 'rgba(255, 146, 43, 0.4)',
      left: '#3a200a',
      right: '#522d10',
      top: '#75421a',
      trim: '#ffc078',
      windowColor: 'rgba(255, 146, 43, 0.7)',
      windowGlow: 'rgba(255, 146, 43, 0.3)',
      roofStyle: 'flat',
      architecture: 'modern',
    };
  }

  // Default - Generic modern building
  return {
    accent: '#74c0fc',
    glow: 'rgba(116, 192, 252, 0.4)',
    left: '#0f2a40',
    right: '#163a5a',
    top: '#1f4f75',
    trim: '#a5d8ff',
    windowColor: 'rgba(116, 192, 252, 0.6)',
    windowGlow: 'rgba(116, 192, 252, 0.25)',
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
