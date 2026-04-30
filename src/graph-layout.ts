import seedrandom from 'seedrandom';

import type { Position } from './types';

export type FileRole =
  | 'entry'
  | 'infra'
  | 'logic'
  | 'presentation'
  | 'data'
  | 'test'
  | 'asset'
  | 'unknown';

export interface LayoutNodeInput {
  path: string;
  type: 'file' | 'directory';
  name: string;
  extension: string | null;
  tetherTo: string[] | null;
  tetherFrom: string[] | null;
  depth: number;
}

interface LayoutNode extends LayoutNodeInput {
  role: FileRole;
  centrality: number;
  isEntryPoint: boolean;
}

interface FloatPos {
  x: number;
  y: number;
}

const GRID_SIZE = 50;
const MARGIN = 2;
const CENTER = (GRID_SIZE - 1) / 2; // 24.5

// Force-directed parameters tuned for 50×50 grid
const K_REPULSE = 2.0;
const K_ATTRACT = 0.015;
const K_CENTER = 0.25;
const K_DIRECTORY = 0.06;
const K_GRID_ALIGN = 0.018;
const MAX_ITERATIONS = 160;
const BOUNDARY_MARGIN = 4;
const BOUNDARY_REPULSE = 0.4;

// ─── Role Inference ───

export function inferFileRole(node: { path: string; name: string; extension: string | null }): FileRole {
  const path = node.path.toLowerCase();
  const name = node.name.toLowerCase();
  const ext = node.extension?.toLowerCase() ?? '';

  // Tests
  if (
    name.includes('.test.') ||
    name.includes('.spec.') ||
    path.includes('/test/') ||
    path.includes('/tests/') ||
    path.includes('/__tests__/') ||
    path.includes('/e2e/') ||
    path.includes('/cypress/') ||
    path.includes('/playwright/') ||
    path.includes('/jest/') ||
    path.includes('/vitest/') ||
    path.includes('/mocha/')
  ) {
    return 'test';
  }

  // Static assets
  if (
    [
      'png',
      'jpg',
      'jpeg',
      'svg',
      'gif',
      'webp',
      'ico',
      'woff',
      'woff2',
      'ttf',
      'eot',
      'mp3',
      'mp4',
      'zip',
      'tar',
      'gz',
    ].includes(ext)
  ) {
    return 'asset';
  }

  // Config / data files
  if (
    ['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'sql', 'csv', 'db', 'sqlite'].includes(ext)
  ) {
    return 'data';
  }

  // Entry points
  if (
    name === 'index.ts' ||
    name === 'index.js' ||
    name === 'index.tsx' ||
    name === 'index.jsx' ||
    name === 'main.ts' ||
    name === 'main.js' ||
    name === 'main.tsx' ||
    name === 'app.tsx' ||
    name === 'app.jsx' ||
    name === 'app.ts' ||
    name === 'app.js' ||
    name === 'cli.ts' ||
    name === 'server.ts' ||
    name === 'server.js' ||
    name.endsWith('.config.ts') ||
    name.endsWith('.config.js')
  ) {
    return 'entry';
  }

  // Infrastructure / shared
  if (
    name.includes('config') ||
    name.includes('util') ||
    name.includes('constant') ||
    name.includes('type') ||
    name.includes('schema') ||
    name.includes('helper') ||
    name.includes('interface') ||
    name.includes('mock') ||
    name.includes('fixture') ||
    path.includes('/types/') ||
    path.includes('/utils/') ||
    path.includes('/constants/') ||
    path.includes('/helpers/') ||
    path.includes('/interfaces/') ||
    path.includes('/mocks/') ||
    path.includes('/fixtures/')
  ) {
    return 'infra';
  }

  // Presentation layer
  if (
    ['tsx', 'jsx', 'vue', 'svelte', 'css', 'scss', 'less', 'sass', 'html', 'htm', 'md', 'mdx'].includes(
      ext,
    ) ||
    path.includes('/components/') ||
    path.includes('/pages/') ||
    path.includes('/views/') ||
    path.includes('/layouts/') ||
    path.includes('/styles/') ||
    path.includes('/ui/') ||
    path.includes('/public/') ||
    path.includes('/assets/')
  ) {
    return 'presentation';
  }

  return 'logic';
}

// ─── Helpers ───

function computeCentrality(node: LayoutNodeInput): number {
  const inDegree = (node.tetherFrom ?? []).length;
  const outDegree = (node.tetherTo ?? []).length;
  return Math.sqrt((inDegree + 1) * (outDegree + 1));
}

function isEntryPoint(node: LayoutNodeInput): boolean {
  const inDegree = (node.tetherFrom ?? []).length;
  const outDegree = (node.tetherTo ?? []).length;
  if (inDegree === 0 && outDegree > 0) return true;
  if (node.depth <= 1 && outDegree > 0) return true;
  const name = node.name.toLowerCase();
  if (
    (name.startsWith('index.') || name.startsWith('main.') || name.startsWith('app.')) &&
    outDegree > 0
  ) {
    return true;
  }
  return false;
}

function getDirectoryPath(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '.';
}

function stringHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ─── Initialization ───

function buildLayoutNodes(inputs: LayoutNodeInput[]): LayoutNode[] {
  const centralities = inputs.map(computeCentrality);
  const maxCentrality = Math.max(1, ...centralities);

  return inputs.map((input, index) => ({
    ...input,
    role: inferFileRole(input),
    centrality: centralities[index]! / maxCentrality,
    isEntryPoint: isEntryPoint(input),
  }));
}

function initFilePositions(files: LayoutNode[], rng: () => number): Map<string, FloatPos> {
  const positions = new Map<string, FloatPos>();

  // Entry points distributed in a ring around center
  const entries = files.filter((n) => n.isEntryPoint);
  // Entry points: tight ring near center so tethered files cluster around the middle
  const entryRadius = 3;
  entries.forEach((node, i) => {
    const angle = (i / Math.max(entries.length, 1)) * 2 * Math.PI + rng() * 0.2;
    positions.set(node.path, {
      x: CENTER + Math.cos(angle) * entryRadius,
      y: CENTER + Math.sin(angle) * entryRadius,
    });
  });

  // Others: wider initial spread so the city has room to breathe
  const others = files.filter((n) => !n.isEntryPoint);
  others.forEach((node) => {
    const hash = stringHash(node.path);
    const angle = (hash / 0x7fffffff) * 2 * Math.PI;
    const radius = 10 + (hash % 1000) / 1000 * 14;
    positions.set(node.path, {
      x: CENTER + Math.cos(angle) * radius + (rng() - 0.5) * 4,
      y: CENTER + Math.sin(angle) * radius + (rng() - 0.5) * 4,
    });
  });

  return positions;
}

// ─── Force Simulation ───

function runForceLayout(files: LayoutNode[], positions: Map<string, FloatPos>): void {
  const fileList = files.filter((n) => n.path !== '.');
  const pos = (p: string) => positions.get(p)!;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const cooling = 1 - iter / MAX_ITERATIONS;
    const stepSize = 0.5 * cooling + 0.12;

    // Reset forces
    const forces = new Map<string, { fx: number; fy: number }>();
    for (const f of fileList) {
      forces.set(f.path, { fx: 0, fy: 0 });
    }

    // 1. Pairwise repulsion
    for (let i = 0; i < fileList.length; i++) {
      const a = fileList[i]!;
      const pa = pos(a.path);
      let { fx, fy } = forces.get(a.path)!;

      for (let j = i + 1; j < fileList.length; j++) {
        const b = fileList[j]!;
        const pb = pos(b.path);
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const force = K_REPULSE / dist;

        const fdx = (dx / dist) * force;
        const fdy = (dy / dist) * force;

        fx += fdx;
        fy += fdy;

        const bForce = forces.get(b.path)!;
        bForce.fx -= fdx;
        bForce.fy -= fdy;
      }

      forces.set(a.path, { fx, fy });
    }

    // 2. Tether attraction
    for (const node of fileList) {
      const p = pos(node.path);
      let { fx, fy } = forces.get(node.path)!;

      for (const targetPath of node.tetherTo ?? []) {
        const target = positions.get(targetPath);
        if (!target) continue;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const force = K_ATTRACT * dist;
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      forces.set(node.path, { fx, fy });
    }

    // 3. Center gravity (stronger for high-centrality nodes)
    for (const node of fileList) {
      const p = pos(node.path);
      let { fx, fy } = forces.get(node.path)!;
      const toCenterX = CENTER - p.x;
      const toCenterY = CENTER - p.y;
      const force = K_CENTER * (0.25 + node.centrality * 0.75);
      fx += toCenterX * force;
      fy += toCenterY * force;
      forces.set(node.path, { fx, fy });
    }

    // 3b. Soft boundary repulsion — keep files away from edges so the city doesn't drift
    for (const node of fileList) {
      const p = pos(node.path);
      let { fx, fy } = forces.get(node.path)!;
      if (p.x < BOUNDARY_MARGIN) fx += BOUNDARY_REPULSE * (BOUNDARY_MARGIN - p.x);
      if (p.x > GRID_SIZE - 1 - BOUNDARY_MARGIN) fx -= BOUNDARY_REPULSE * (p.x - (GRID_SIZE - 1 - BOUNDARY_MARGIN));
      if (p.y < BOUNDARY_MARGIN) fy += BOUNDARY_REPULSE * (BOUNDARY_MARGIN - p.y);
      if (p.y > GRID_SIZE - 1 - BOUNDARY_MARGIN) fy -= BOUNDARY_REPULSE * (p.y - (GRID_SIZE - 1 - BOUNDARY_MARGIN));
      forces.set(node.path, { fx, fy });
    }

    // 4. Grid alignment — very soft pull toward integer grid lines
    // This creates the "city block" feeling without destroying the organic layout
    for (const node of fileList) {
      const p = pos(node.path);
      let { fx, fy } = forces.get(node.path)!;
      const nearestX = Math.round(p.x);
      const nearestY = Math.round(p.y);
      fx += (nearestX - p.x) * K_GRID_ALIGN;
      fy += (nearestY - p.y) * K_GRID_ALIGN;
      forces.set(node.path, { fx, fy });
    }

    // 5. Directory cohesion — files in same dir weakly attract
    const dirGroups = new Map<string, LayoutNode[]>();
    for (const node of fileList) {
      if (node.type !== 'file') continue;
      const dir = getDirectoryPath(node.path);
      const group = dirGroups.get(dir) ?? [];
      group.push(node);
      dirGroups.set(dir, group);
    }

    for (const group of dirGroups.values()) {
      if (group.length < 2) continue;
      let avgX = 0;
      let avgY = 0;
      for (const n of group) {
        const p = pos(n.path);
        avgX += p.x;
        avgY += p.y;
      }
      avgX /= group.length;
      avgY /= group.length;

      for (const n of group) {
        const p = pos(n.path);
        let { fx, fy } = forces.get(n.path)!;
        fx += (avgX - p.x) * K_DIRECTORY;
        fy += (avgY - p.y) * K_DIRECTORY;
        forces.set(n.path, { fx, fy });
      }
    }

    // Apply forces
    for (const node of fileList) {
      const p = pos(node.path);
      const f = forces.get(node.path)!;
      p.x += f.fx * stepSize;
      p.y += f.fy * stepSize;

      // Clamp with margin
      p.x = Math.max(MARGIN, Math.min(GRID_SIZE - 1 - MARGIN, p.x));
      p.y = Math.max(MARGIN, Math.min(GRID_SIZE - 1 - MARGIN, p.y));
    }

    // Center-of-mass correction — aggressively prevent the whole cluster from drifting
    if (fileList.length > 0) {
      let avgX = 0;
      let avgY = 0;
      for (const node of fileList) {
        const p = pos(node.path);
        avgX += p.x;
        avgY += p.y;
      }
      avgX /= fileList.length;
      avgY /= fileList.length;
      const shiftX = CENTER - avgX;
      const shiftY = CENTER - avgY;
      for (const node of fileList) {
        const p = pos(node.path);
        p.x += shiftX * 0.5;
        p.y += shiftY * 0.5;
      }
    }
  }
}

export interface GraphPosition extends Position {
  occupancyWidth: number;
  occupancyDepth: number;
}

// ─── Grid Snapping ───

function findOpenGridPosition(
  px: number,
  py: number,
  occupied: Set<string>,
): Position {
  for (let radius = 0; radius < GRID_SIZE * 2; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        const x = Math.max(0, Math.min(GRID_SIZE - 1, px + dx));
        const y = Math.max(0, Math.min(GRID_SIZE - 1, py + dy));
        const key = `${x},${y}`;
        if (!occupied.has(key)) {
          return { x, y, z: 0 };
        }
      }
    }
  }
  return { x: px, y: py, z: 0 };
}

function findOpenGridBlock(
  px: number,
  py: number,
  width: number,
  depth: number,
  occupied: Set<string>,
): Position {
  const halfW = Math.floor((width - 1) / 2);
  const halfD = Math.floor((depth - 1) / 2);

  for (let radius = 0; radius < GRID_SIZE * 2; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) !== radius) continue;
        const cx = px + dx;
        const cy = py + dy;
        const minX = cx - halfW;
        const maxX = cx + halfW;
        const minY = cy - halfD;
        const maxY = cy + halfD;

        if (minX < 0 || maxX >= GRID_SIZE || minY < 0 || maxY >= GRID_SIZE) {
          continue;
        }

        let free = true;
        for (let by = minY; by <= maxY; by++) {
          for (let bx = minX; bx <= maxX; bx++) {
            if (occupied.has(`${bx},${by}`)) {
              free = false;
              break;
            }
          }
          if (!free) break;
        }

        if (free) {
          return { x: cx, y: cy, z: 0 };
        }
      }
    }
  }

  // Fallback: clamp to nearest valid center
  return {
    x: Math.max(halfW, Math.min(GRID_SIZE - 1 - halfW, px)),
    y: Math.max(halfD, Math.min(GRID_SIZE - 1 - halfD, py)),
    z: 0,
  };
}

function computeOccupancy(nodes: LayoutNode[]): Map<string, { width: number; depth: number }> {
  const result = new Map<string, { width: number; depth: number }>();
  const sorted = [...nodes].sort((a, b) => b.centrality - a.centrality);
  let largeLotCount = 0;
  const MAX_LARGE_LOTS = 5;

  for (const node of sorted) {
    if (node.isEntryPoint && largeLotCount < MAX_LARGE_LOTS) {
      result.set(node.path, { width: 3, depth: 3 });
      largeLotCount += 1;
    } else {
      result.set(node.path, { width: 1, depth: 1 });
    }
  }

  return result;
}

function snapFilesToGrid(
  positions: Map<string, FloatPos>,
  occupied: Set<string>,
  occupancyMap: Map<string, { width: number; depth: number }>,
): Map<string, GraphPosition> {
  const grid = new Map<string, GraphPosition>();

  // Sort by closeness to center so central/high-centrality nodes claim prime spots
  const sorted = Array.from(positions.entries()).sort((a, b) => {
    const da = Math.abs(a[1].x - CENTER) + Math.abs(a[1].y - CENTER);
    const db = Math.abs(b[1].x - CENTER) + Math.abs(b[1].y - CENTER);
    return da - db;
  });

  for (const [path, floatPos] of sorted) {
    const gx = Math.round(floatPos.x);
    const gy = Math.round(floatPos.y);
    const occ = occupancyMap.get(path) ?? { width: 1, depth: 1 };

    let found: Position;
    if (occ.width > 1 || occ.depth > 1) {
      found = findOpenGridBlock(gx, gy, occ.width, occ.depth, occupied);
    } else {
      found = findOpenGridPosition(gx, gy, occupied);
    }

    grid.set(path, { x: found.x, y: found.y, z: 0, occupancyWidth: occ.width, occupancyDepth: occ.depth });

    // Mark all tiles in the block as occupied
    const halfW = Math.floor((occ.width - 1) / 2);
    const halfD = Math.floor((occ.depth - 1) / 2);
    for (let by = found.y - halfD; by <= found.y + halfD; by++) {
      for (let bx = found.x - halfW; bx <= found.x + halfW; bx++) {
        occupied.add(`${bx},${by}`);
      }
    }
  }

  return grid;
}

// ─── Directory Placement ───

function placeDirectories(
  dirInputs: LayoutNodeInput[],
  fileGrid: Map<string, GraphPosition>,
  occupied: Set<string>,
): Map<string, Position> {
  const dirGrid = new Map<string, Position>();

  // Sort by depth descending so leaf dirs are placed before parents
  const sortedDirs = [...dirInputs].sort((a, b) => b.depth - a.depth);

  for (const dir of sortedDirs) {
    if (dir.path === '.') {
      dirGrid.set('.', { x: Math.round(CENTER), y: Math.round(CENTER), z: 0 });
      occupied.add(`${Math.round(CENTER)},${Math.round(CENTER)}`);
      continue;
    }

    // Find all direct children (files + already-placed subdirectories)
    const children: Position[] = [];

    for (const [childPath, childPos] of fileGrid) {
      const parent = getDirectoryPath(childPath);
      if (parent === dir.path) {
        children.push(childPos);
      }
    }

    for (const [childPath, childPos] of dirGrid) {
      const parent = getDirectoryPath(childPath);
      if (parent === dir.path) {
        children.push(childPos);
      }
    }

    if (children.length === 0) {
      // Orphan directory — place near center
      const pos = findOpenGridPosition(Math.round(CENTER), Math.round(CENTER), occupied);
      dirGrid.set(dir.path, pos);
      occupied.add(`${pos.x},${pos.y}`);
      continue;
    }

    let avgX = 0;
    let avgY = 0;
    for (const c of children) {
      avgX += c.x;
      avgY += c.y;
    }
    avgX /= children.length;
    avgY /= children.length;

    const pos = findOpenGridPosition(Math.round(avgX), Math.round(avgY), occupied);
    dirGrid.set(dir.path, pos);
    occupied.add(`${pos.x},${pos.y}`);
  }

  return dirGrid;
}

// ─── Public API ───

export function computeGraphLayout(
  inputs: LayoutNodeInput[],
  seed: string,
): Map<string, GraphPosition> {
  const rng = seedrandom(seed);
  const allNodes = buildLayoutNodes(inputs);

  const fileNodes = allNodes.filter((n) => n.type === 'file');
  const dirNodes = inputs.filter((n) => n.type === 'directory');

  // 1. Run force-directed layout on files
  const floatPositions = initFilePositions(fileNodes, rng);
  runForceLayout(fileNodes, floatPositions);

  // 2. Compute multi-tile occupancy for high-centrality entry points
  const occupancyMap = computeOccupancy(fileNodes);

  // 3. Snap files to integer grid, reserving blocks for large lots
  const occupied = new Set<string>();
  const fileGrid = snapFilesToGrid(floatPositions, occupied, occupancyMap);

  // 4. Place directories at centroids of their children
  const dirGrid = placeDirectories(dirNodes, fileGrid, occupied);

  // Merge
  const result = new Map<string, GraphPosition>(fileGrid);
  for (const [path, pos] of dirGrid) {
    result.set(path, { ...pos, occupancyWidth: 1, occupancyDepth: 1 });
  }

  return result;
}
