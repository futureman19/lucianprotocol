import type { Entity } from '../src/types';

export type BuildingArchetype =
  | 'plaza'
  | 'skyscraper'
  | 'tower'
  | 'hut'
  | 'billboard'
  | 'pavilion'
  | 'archway'
  | 'datacenter'
  | 'factory'
  | 'pyramid'
  | 'brutalist'
  | 'warehouse'
  | 'monolith';

export interface BuildingPalette {
  accent: string;
  glow: string;
  left: string;
  right: string;
  top: string;
  window: string;
  beacon: string;
}

export interface BuildingSpec {
  archetype: BuildingArchetype;
  palette: BuildingPalette;
  footprint: { depth: number; width: number };
  heightMult: number;
  label: string;
}

const DEFAULT_PALETTE: BuildingPalette = {
  accent: '#56d9ff',
  glow: 'rgba(86, 217, 255, 0.46)',
  left: '#103d62',
  right: '#18608b',
  top: '#2489b8',
  window: '#a0ecff',
  beacon: '#56d9ff',
};

const EXTENSION_REGISTRY: Record<string, BuildingSpec> = {
  // TypeScript / JavaScript — Skyscrapers
  ts: {
    archetype: 'skyscraper',
    palette: {
      accent: '#00f0ff',
      glow: 'rgba(0, 240, 255, 0.55)',
      left: '#004d5c',
      right: '#006b7a',
      top: '#0095a8',
      window: '#b0fdff',
      beacon: '#00f0ff',
    },
    footprint: { depth: 0.55, width: 0.55 },
    heightMult: 1.15,
    label: 'TypeScript',
  },
  tsx: {
    archetype: 'skyscraper',
    palette: {
      accent: '#c084fc',
      glow: 'rgba(192, 132, 252, 0.55)',
      left: '#4c1d95',
      right: '#5b21b6',
      top: '#7c3aed',
      window: '#e9d5ff',
      beacon: '#c084fc',
    },
    footprint: { depth: 0.55, width: 0.55 },
    heightMult: 1.15,
    label: 'TSX',
  },
  js: {
    archetype: 'skyscraper',
    palette: {
      accent: '#f7df1e',
      glow: 'rgba(247, 223, 30, 0.55)',
      left: '#5c5300',
      right: '#7a6f00',
      top: '#a89a00',
      window: '#fff7a0',
      beacon: '#f7df1e',
    },
    footprint: { depth: 0.55, width: 0.55 },
    heightMult: 1.05,
    label: 'JavaScript',
  },
  jsx: {
    archetype: 'skyscraper',
    palette: {
      accent: '#f97316',
      glow: 'rgba(249, 115, 22, 0.55)',
      left: '#7c2d12',
      right: '#9a3412',
      top: '#c2410c',
      window: '#ffdec2',
      beacon: '#f97316',
    },
    footprint: { depth: 0.55, width: 0.55 },
    heightMult: 1.05,
    label: 'JSX',
  },
  mjs: {
    archetype: 'skyscraper',
    palette: {
      accent: '#fde047',
      glow: 'rgba(253, 224, 71, 0.55)',
      left: '#5c5300',
      right: '#7a6f00',
      top: '#a89a00',
      window: '#fff7a0',
      beacon: '#fde047',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 1.0,
    label: 'Module JS',
  },

  // Styles — Art-Deco Towers
  css: {
    archetype: 'tower',
    palette: {
      accent: '#ff6b9d',
      glow: 'rgba(255, 107, 157, 0.55)',
      left: '#7a1e3d',
      right: '#9d234d',
      top: '#cc2b63',
      window: '#ffd6e5',
      beacon: '#ff6b9d',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 1.0,
    label: 'CSS',
  },
  scss: {
    archetype: 'tower',
    palette: {
      accent: '#f472b6',
      glow: 'rgba(244, 114, 182, 0.55)',
      left: '#7a1e5a',
      right: '#9d236e',
      top: '#cc2b88',
      window: '#ffd6ee',
      beacon: '#f472b6',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 1.0,
    label: 'SCSS',
  },
  less: {
    archetype: 'tower',
    palette: {
      accent: '#db2777',
      glow: 'rgba(219, 39, 119, 0.55)',
      left: '#5c0f33',
      right: '#7a1545',
      top: '#a31d5e',
      window: '#ffc2dd',
      beacon: '#db2777',
    },
    footprint: { depth: 0.48, width: 0.48 },
    heightMult: 0.95,
    label: 'Less',
  },
  sass: {
    archetype: 'tower',
    palette: {
      accent: '#ec4899',
      glow: 'rgba(236, 72, 153, 0.55)',
      left: '#6b1540',
      right: '#8b1a52',
      top: '#be2370',
      window: '#ffd0e6',
      beacon: '#ec4899',
    },
    footprint: { depth: 0.48, width: 0.48 },
    heightMult: 0.95,
    label: 'Sass',
  },

  // Config — Utility Huts
  json: {
    archetype: 'hut',
    palette: {
      accent: '#ffb347',
      glow: 'rgba(255, 179, 71, 0.55)',
      left: '#5c3a00',
      right: '#7a4d00',
      top: '#a86b00',
      window: '#ffe4b0',
      beacon: '#ffb347',
    },
    footprint: { depth: 0.45, width: 0.45 },
    heightMult: 0.85,
    label: 'JSON',
  },
  yaml: {
    archetype: 'hut',
    palette: {
      accent: '#fb923c',
      glow: 'rgba(251, 146, 60, 0.55)',
      left: '#5c2e00',
      right: '#7a3d00',
      top: '#a85500',
      window: '#ffdfc2',
      beacon: '#fb923c',
    },
    footprint: { depth: 0.45, width: 0.45 },
    heightMult: 0.85,
    label: 'YAML',
  },
  yml: {
    archetype: 'hut',
    palette: {
      accent: '#fb923c',
      glow: 'rgba(251, 146, 60, 0.55)',
      left: '#5c2e00',
      right: '#7a3d00',
      top: '#a85500',
      window: '#ffdfc2',
      beacon: '#fb923c',
    },
    footprint: { depth: 0.45, width: 0.45 },
    heightMult: 0.85,
    label: 'YAML',
  },
  toml: {
    archetype: 'hut',
    palette: {
      accent: '#d97706',
      glow: 'rgba(217, 119, 6, 0.55)',
      left: '#4a2300',
      right: '#663200',
      top: '#854d0e',
      window: '#ffdfaa',
      beacon: '#d97706',
    },
    footprint: { depth: 0.42, width: 0.42 },
    heightMult: 0.8,
    label: 'TOML',
  },
  ini: {
    archetype: 'hut',
    palette: {
      accent: '#ca8a04',
      glow: 'rgba(202, 138, 4, 0.55)',
      left: '#4a3500',
      right: '#664a00',
      top: '#856404',
      window: '#ffeeaa',
      beacon: '#ca8a04',
    },
    footprint: { depth: 0.42, width: 0.42 },
    heightMult: 0.8,
    label: 'INI',
  },
  env: {
    archetype: 'hut',
    palette: {
      accent: '#a3e635',
      glow: 'rgba(163, 230, 53, 0.55)',
      left: '#365314',
      right: '#4a6e17',
      top: '#65a30d',
      window: '#e5ffb3',
      beacon: '#a3e635',
    },
    footprint: { depth: 0.4, width: 0.4 },
    heightMult: 0.75,
    label: 'Env',
  },

  // Images — Billboards / Galleries
  png: {
    archetype: 'billboard',
    palette: {
      accent: '#ff3366',
      glow: 'rgba(255, 51, 102, 0.6)',
      left: '#5c0018',
      right: '#7a0020',
      top: '#a8002e',
      window: '#ffb3c7',
      beacon: '#ff3366',
    },
    footprint: { depth: 0.35, width: 1.1 },
    heightMult: 0.9,
    label: 'PNG',
  },
  jpg: {
    archetype: 'billboard',
    palette: {
      accent: '#ff5c8a',
      glow: 'rgba(255, 92, 138, 0.6)',
      left: '#5c0018',
      right: '#7a0020',
      top: '#a8002e',
      window: '#ffb3c7',
      beacon: '#ff5c8a',
    },
    footprint: { depth: 0.35, width: 1.1 },
    heightMult: 0.9,
    label: 'JPEG',
  },
  jpeg: {
    archetype: 'billboard',
    palette: {
      accent: '#ff5c8a',
      glow: 'rgba(255, 92, 138, 0.6)',
      left: '#5c0018',
      right: '#7a0020',
      top: '#a8002e',
      window: '#ffb3c7',
      beacon: '#ff5c8a',
    },
    footprint: { depth: 0.35, width: 1.1 },
    heightMult: 0.9,
    label: 'JPEG',
  },
  svg: {
    archetype: 'billboard',
    palette: {
      accent: '#ff99bb',
      glow: 'rgba(255, 153, 187, 0.6)',
      left: '#5c1830',
      right: '#7a2040',
      top: '#a82e55',
      window: '#ffe0eb',
      beacon: '#ff99bb',
    },
    footprint: { depth: 0.35, width: 1.0 },
    heightMult: 0.85,
    label: 'SVG',
  },
  gif: {
    archetype: 'billboard',
    palette: {
      accent: '#ff6699',
      glow: 'rgba(255, 102, 153, 0.6)',
      left: '#5c0018',
      right: '#7a0020',
      top: '#a8002e',
      window: '#ffb3c7',
      beacon: '#ff6699',
    },
    footprint: { depth: 0.35, width: 1.0 },
    heightMult: 0.85,
    label: 'GIF',
  },
  webp: {
    archetype: 'billboard',
    palette: {
      accent: '#ff1a75',
      glow: 'rgba(255, 26, 117, 0.6)',
      left: '#5c0018',
      right: '#7a0020',
      top: '#a8002e',
      window: '#ffb3c7',
      beacon: '#ff1a75',
    },
    footprint: { depth: 0.35, width: 1.0 },
    heightMult: 0.85,
    label: 'WebP',
  },
  ico: {
    archetype: 'hut',
    palette: {
      accent: '#ff99cc',
      glow: 'rgba(255, 153, 204, 0.55)',
      left: '#5c1838',
      right: '#7a204a',
      top: '#a82e66',
      window: '#ffe0f0',
      beacon: '#ff99cc',
    },
    footprint: { depth: 0.35, width: 0.35 },
    heightMult: 0.6,
    label: 'Icon',
  },

  // Markdown / Docs — Libraries / Pavilions
  md: {
    archetype: 'pavilion',
    palette: {
      accent: '#00ff88',
      glow: 'rgba(0, 255, 136, 0.55)',
      left: '#005c2e',
      right: '#007a3d',
      top: '#00a852',
      window: '#b3ffd6',
      beacon: '#00ff88',
    },
    footprint: { depth: 1.05, width: 1.05 },
    heightMult: 0.6,
    label: 'Markdown',
  },
  mdx: {
    archetype: 'pavilion',
    palette: {
      accent: '#00e5a0',
      glow: 'rgba(0, 229, 160, 0.55)',
      left: '#005c3d',
      right: '#007a52',
      top: '#00a870',
      window: '#b3ffe0',
      beacon: '#00e5a0',
    },
    footprint: { depth: 1.05, width: 1.05 },
    heightMult: 0.6,
    label: 'MDX',
  },
  txt: {
    archetype: 'pavilion',
    palette: {
      accent: '#34d399',
      glow: 'rgba(52, 211, 153, 0.55)',
      left: '#064e3b',
      right: '#065f46',
      top: '#059669',
      window: '#a7f3d0',
      beacon: '#34d399',
    },
    footprint: { depth: 0.9, width: 0.9 },
    heightMult: 0.55,
    label: 'Text',
  },
  rst: {
    archetype: 'pavilion',
    palette: {
      accent: '#6ee7b7',
      glow: 'rgba(110, 231, 183, 0.55)',
      left: '#064e3b',
      right: '#065f46',
      top: '#059669',
      window: '#c6f7e0',
      beacon: '#6ee7b7',
    },
    footprint: { depth: 0.9, width: 0.9 },
    heightMult: 0.55,
    label: 'RST',
  },

  // HTML — Archways
  html: {
    archetype: 'archway',
    palette: {
      accent: '#ff7b00',
      glow: 'rgba(255, 123, 0, 0.55)',
      left: '#5c2400',
      right: '#7a3000',
      top: '#a84400',
      window: '#ffd4a8',
      beacon: '#ff7b00',
    },
    footprint: { depth: 0.35, width: 1.0 },
    heightMult: 0.95,
    label: 'HTML',
  },
  htm: {
    archetype: 'archway',
    palette: {
      accent: '#ff7b00',
      glow: 'rgba(255, 123, 0, 0.55)',
      left: '#5c2400',
      right: '#7a3000',
      top: '#a84400',
      window: '#ffd4a8',
      beacon: '#ff7b00',
    },
    footprint: { depth: 0.35, width: 1.0 },
    heightMult: 0.95,
    label: 'HTML',
  },

  // Data — Datacenters
  csv: {
    archetype: 'datacenter',
    palette: {
      accent: '#00e5ff',
      glow: 'rgba(0, 229, 255, 0.55)',
      left: '#004d5c',
      right: '#006b7a',
      top: '#0095a8',
      window: '#b0fdff',
      beacon: '#00e5ff',
    },
    footprint: { depth: 0.8, width: 0.8 },
    heightMult: 0.65,
    label: 'CSV',
  },
  sql: {
    archetype: 'datacenter',
    palette: {
      accent: '#22d3ee',
      glow: 'rgba(34, 211, 238, 0.55)',
      left: '#004d5c',
      right: '#006b7a',
      top: '#0095a8',
      window: '#b0fdff',
      beacon: '#22d3ee',
    },
    footprint: { depth: 0.8, width: 0.8 },
    heightMult: 0.65,
    label: 'SQL',
  },
  sqlite: {
    archetype: 'datacenter',
    palette: {
      accent: '#67e8f9',
      glow: 'rgba(103, 232, 249, 0.55)',
      left: '#004d5c',
      right: '#006b7a',
      top: '#0095a8',
      window: '#d0fdff',
      beacon: '#67e8f9',
    },
    footprint: { depth: 0.75, width: 0.75 },
    heightMult: 0.6,
    label: 'SQLite',
  },
  db: {
    archetype: 'datacenter',
    palette: {
      accent: '#0891b2',
      glow: 'rgba(8, 145, 178, 0.55)',
      left: '#003d4d',
      right: '#005266',
      top: '#006b82',
      window: '#a0ecff',
      beacon: '#0891b2',
    },
    footprint: { depth: 0.75, width: 0.75 },
    heightMult: 0.6,
    label: 'Database',
  },

  // Shell / Scripts — Factories
  sh: {
    archetype: 'factory',
    palette: {
      accent: '#ff3333',
      glow: 'rgba(255, 51, 51, 0.55)',
      left: '#5c0000',
      right: '#7a0000',
      top: '#a80000',
      window: '#ffb3b3',
      beacon: '#ff3333',
    },
    footprint: { depth: 0.65, width: 0.65 },
    heightMult: 0.9,
    label: 'Shell',
  },
  ps1: {
    archetype: 'factory',
    palette: {
      accent: '#ef4444',
      glow: 'rgba(239, 68, 68, 0.55)',
      left: '#5c0000',
      right: '#7a0000',
      top: '#a80000',
      window: '#ffc2c2',
      beacon: '#ef4444',
    },
    footprint: { depth: 0.65, width: 0.65 },
    heightMult: 0.9,
    label: 'PowerShell',
  },
  bat: {
    archetype: 'factory',
    palette: {
      accent: '#dc2626',
      glow: 'rgba(220, 38, 38, 0.55)',
      left: '#5c0000',
      right: '#7a0000',
      top: '#a80000',
      window: '#ffb3b3',
      beacon: '#dc2626',
    },
    footprint: { depth: 0.6, width: 0.6 },
    heightMult: 0.85,
    label: 'Batch',
  },
  cmd: {
    archetype: 'factory',
    palette: {
      accent: '#b91c1c',
      glow: 'rgba(185, 28, 28, 0.55)',
      left: '#450a0a',
      right: '#5c0e0e',
      top: '#7f1d1d',
      window: '#ffb3b3',
      beacon: '#b91c1c',
    },
    footprint: { depth: 0.6, width: 0.6 },
    heightMult: 0.85,
    label: 'CMD',
  },

  // Python — Pyramids
  py: {
    archetype: 'pyramid',
    palette: {
      accent: '#ffd700',
      glow: 'rgba(255, 215, 0, 0.55)',
      left: '#5c4d00',
      right: '#7a6600',
      top: '#a88f00',
      window: '#fff2a0',
      beacon: '#ffd700',
    },
    footprint: { depth: 0.7, width: 0.7 },
    heightMult: 1.0,
    label: 'Python',
  },
  pyc: {
    archetype: 'pyramid',
    palette: {
      accent: '#e6c200',
      glow: 'rgba(230, 194, 0, 0.55)',
      left: '#5c4d00',
      right: '#7a6600',
      top: '#a88f00',
      window: '#fff2a0',
      beacon: '#e6c200',
    },
    footprint: { depth: 0.6, width: 0.6 },
    heightMult: 0.85,
    label: 'Python Bytecode',
  },

  // Rust / Go / C++ — Brutalists
  rs: {
    archetype: 'brutalist',
    palette: {
      accent: '#b967ff',
      glow: 'rgba(185, 103, 255, 0.55)',
      left: '#3b0764',
      right: '#4c1d95',
      top: '#6b21a8',
      window: '#e9d5ff',
      beacon: '#b967ff',
    },
    footprint: { depth: 0.6, width: 0.6 },
    heightMult: 1.05,
    label: 'Rust',
  },
  go: {
    archetype: 'brutalist',
    palette: {
      accent: '#00add8',
      glow: 'rgba(0, 173, 216, 0.55)',
      left: '#003d4d',
      right: '#005266',
      top: '#006b82',
      window: '#b0ecff',
      beacon: '#00add8',
    },
    footprint: { depth: 0.6, width: 0.6 },
    heightMult: 1.0,
    label: 'Go',
  },
  cpp: {
    archetype: 'brutalist',
    palette: {
      accent: '#818cf8',
      glow: 'rgba(129, 140, 248, 0.55)',
      left: '#1e1b4b',
      right: '#312e81',
      top: '#4338ca',
      window: '#d6d3ff',
      beacon: '#818cf8',
    },
    footprint: { depth: 0.6, width: 0.6 },
    heightMult: 1.05,
    label: 'C++',
  },
  c: {
    archetype: 'brutalist',
    palette: {
      accent: '#6366f1',
      glow: 'rgba(99, 102, 241, 0.55)',
      left: '#1e1b4b',
      right: '#312e81',
      top: '#4338ca',
      window: '#d6d3ff',
      beacon: '#6366f1',
    },
    footprint: { depth: 0.55, width: 0.55 },
    heightMult: 1.0,
    label: 'C',
  },
  h: {
    archetype: 'brutalist',
    palette: {
      accent: '#a5b4fc',
      glow: 'rgba(165, 180, 252, 0.55)',
      left: '#1e1b4b',
      right: '#312e81',
      top: '#4338ca',
      window: '#e0e3ff',
      beacon: '#a5b4fc',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 0.9,
    label: 'Header',
  },
  hpp: {
    archetype: 'brutalist',
    palette: {
      accent: '#a5b4fc',
      glow: 'rgba(165, 180, 252, 0.55)',
      left: '#1e1b4b',
      right: '#312e81',
      top: '#4338ca',
      window: '#e0e3ff',
      beacon: '#a5b4fc',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 0.9,
    label: 'C++ Header',
  },

  // Binary / Assets — Warehouses
  woff: {
    archetype: 'warehouse',
    palette: {
      accent: '#8899aa',
      glow: 'rgba(136, 153, 170, 0.5)',
      left: '#1e293b',
      right: '#334155',
      top: '#475569',
      window: '#c8d4e0',
      beacon: '#8899aa',
    },
    footprint: { depth: 0.75, width: 1.15 },
    heightMult: 0.55,
    label: 'Font',
  },
  woff2: {
    archetype: 'warehouse',
    palette: {
      accent: '#94a3b8',
      glow: 'rgba(148, 163, 184, 0.5)',
      left: '#1e293b',
      right: '#334155',
      top: '#475569',
      window: '#d0dce8',
      beacon: '#94a3b8',
    },
    footprint: { depth: 0.75, width: 1.15 },
    heightMult: 0.55,
    label: 'Font',
  },
  ttf: {
    archetype: 'warehouse',
    palette: {
      accent: '#8899aa',
      glow: 'rgba(136, 153, 170, 0.5)',
      left: '#1e293b',
      right: '#334155',
      top: '#475569',
      window: '#c8d4e0',
      beacon: '#8899aa',
    },
    footprint: { depth: 0.75, width: 1.15 },
    heightMult: 0.55,
    label: 'Font',
  },
  eot: {
    archetype: 'warehouse',
    palette: {
      accent: '#8899aa',
      glow: 'rgba(136, 153, 170, 0.5)',
      left: '#1e293b',
      right: '#334155',
      top: '#475569',
      window: '#c8d4e0',
      beacon: '#8899aa',
    },
    footprint: { depth: 0.75, width: 1.15 },
    heightMult: 0.55,
    label: 'Font',
  },
  mp3: {
    archetype: 'warehouse',
    palette: {
      accent: '#64748b',
      glow: 'rgba(100, 116, 139, 0.5)',
      left: '#0f172a',
      right: '#1e293b',
      top: '#334155',
      window: '#b0c0d0',
      beacon: '#64748b',
    },
    footprint: { depth: 0.7, width: 1.0 },
    heightMult: 0.5,
    label: 'Audio',
  },
  mp4: {
    archetype: 'warehouse',
    palette: {
      accent: '#64748b',
      glow: 'rgba(100, 116, 139, 0.5)',
      left: '#0f172a',
      right: '#1e293b',
      top: '#334155',
      window: '#b0c0d0',
      beacon: '#64748b',
    },
    footprint: { depth: 0.7, width: 1.0 },
    heightMult: 0.5,
    label: 'Video',
  },
  zip: {
    archetype: 'warehouse',
    palette: {
      accent: '#94a3b8',
      glow: 'rgba(148, 163, 184, 0.5)',
      left: '#1e293b',
      right: '#334155',
      top: '#475569',
      window: '#d0dce8',
      beacon: '#94a3b8',
    },
    footprint: { depth: 0.8, width: 0.8 },
    heightMult: 0.5,
    label: 'Archive',
  },
  tar: {
    archetype: 'warehouse',
    palette: {
      accent: '#94a3b8',
      glow: 'rgba(148, 163, 184, 0.5)',
      left: '#1e293b',
      right: '#334155',
      top: '#475569',
      window: '#d0dce8',
      beacon: '#94a3b8',
    },
    footprint: { depth: 0.8, width: 0.8 },
    heightMult: 0.5,
    label: 'Archive',
  },

  // React/Vue/Svelte specific
  vue: {
    archetype: 'tower',
    palette: {
      accent: '#42b883',
      glow: 'rgba(66, 184, 131, 0.55)',
      left: '#064e3b',
      right: '#065f46',
      top: '#059669',
      window: '#b3f0d6',
      beacon: '#42b883',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 1.0,
    label: 'Vue',
  },
  svelte: {
    archetype: 'tower',
    palette: {
      accent: '#ff3e00',
      glow: 'rgba(255, 62, 0, 0.55)',
      left: '#5c1400',
      right: '#7a1c00',
      top: '#a82600',
      window: '#ffc2a8',
      beacon: '#ff3e00',
    },
    footprint: { depth: 0.5, width: 0.5 },
    heightMult: 1.0,
    label: 'Svelte',
  },

  // Lockfiles & package manifests
  'lock': {
    archetype: 'hut',
    palette: {
      accent: '#a8a29e',
      glow: 'rgba(168, 162, 158, 0.5)',
      left: '#292524',
      right: '#44403c',
      top: '#57534e',
      window: '#e0dcd8',
      beacon: '#a8a29e',
    },
    footprint: { depth: 0.4, width: 0.4 },
    heightMult: 0.7,
    label: 'Lockfile',
  },
};

const DIRECTORIES: BuildingSpec = {
  archetype: 'plaza',
  palette: {
    accent: '#4d8aff',
    glow: 'rgba(77, 138, 255, 0.45)',
    left: '#0a2463',
    right: '#143d8c',
    top: '#1e5bb5',
    window: '#b8d4ff',
    beacon: '#4d8aff',
  },
  footprint: { depth: 1.45, width: 1.45 },
  heightMult: 0.5,
  label: 'Directory',
};

const WALLS: BuildingSpec = {
  archetype: 'monolith',
  palette: {
    accent: '#64748b',
    glow: 'rgba(100, 116, 139, 0.4)',
    left: '#0f172a',
    right: '#1e293b',
    top: '#334155',
    window: '#94a3b8',
    beacon: '#64748b',
  },
  footprint: { depth: 1.0, width: 1.0 },
  heightMult: 1.1,
  label: 'Wall',
};

const DEFAULT_FILE: BuildingSpec = {
  archetype: 'monolith',
  palette: DEFAULT_PALETTE,
  footprint: { depth: 0.58, width: 0.58 },
  heightMult: 1.0,
  label: 'File',
};

export function getExtension(entity: Entity): string | null {
  if (entity.type === 'directory') return null;
  if (entity.extension) return entity.extension.toLowerCase();
  const path = entity.path ?? entity.name ?? '';
  const dot = path.lastIndexOf('.');
  if (dot > 0 && dot < path.length - 1) {
    return path.slice(dot + 1).toLowerCase();
  }
  return null;
}

export function getBuildingSpec(entity: Entity): BuildingSpec {
  if (entity.type === 'directory') return DIRECTORIES;
  if (entity.type === 'wall') return WALLS;
  const ext = getExtension(entity);
  if (ext && EXTENSION_REGISTRY[ext]) {
    return EXTENSION_REGISTRY[ext];
  }
  return DEFAULT_FILE;
}

export function getFilePalette(entity: Entity): BuildingPalette {
  return getBuildingSpec(entity).palette;
}

export function getFileArchetype(entity: Entity): BuildingArchetype {
  return getBuildingSpec(entity).archetype;
}

export function getFileFootprint(entity: Entity): { depth: number; width: number } {
  return getBuildingSpec(entity).footprint;
}

export function getBuildingLabel(entity: Entity): string {
  return getBuildingSpec(entity).label;
}

export function getBuildingHeight(entity: Entity, baseHeight: number): number {
  const spec = getBuildingSpec(entity);
  return baseHeight * spec.heightMult;
}
