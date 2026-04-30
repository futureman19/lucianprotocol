import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Command,
  GitBranch,
  X,
} from 'lucide-react';

import {
  computeChiralMass,
  getAgentRole,
  getAgentRoleLabel,
  getNodeStateLabel,
  isCriticalMass,
  type HivemindAgentRole,
} from '../src/hivemind';
import { createInitialEntities, DEFAULT_SEED, WORLD_STATE_ID, manhattanDistance } from '../src/seed';
import { isStructureEntity } from '../src/mass-mapper';
import { createBrowserSupabaseClient } from '../src/supabase';
import { heightUnitsToWorldHeight } from '../src/building-lifecycle';
import {
  EntitySchema,
  OperatorControlSchema,
  WorldStateSchema,
  type AgentActivity,
  type Entity,
  type OperatorControl,
  type Weather,
  type WorldState,
} from '../src/types';
import { CodeSyntaxPreview } from './highlight';
import { QueenHUD } from './QueenHUD';
import { drawBuilding } from './simcity-building-render';
import { getEntityFootprint as getFileFootprint, getEntityHeight as getPrismHeight } from './building-geometry';
import { drawTethers } from './tether-render';
import { drawPowerlines } from './powerlines';
import {
  createIsoLayout,
  DEFAULT_CAMERA,
  fromScreen,
  toScreen,
  type Camera,
  type IsoLayout,
} from './iso';
import { createTrafficSystem, drawRoadsAndTraffic, drawGroundPlane, spawnCars, updateCars } from './traffic';
import { computeCityLayout } from './city-layout';
import { AdvisorCouncil } from './AdvisorCouncil';
import { computeCityCouncilState, type AdvisorAction } from './city-systems';

interface Viewport {
  height: number;
  width: number;
}

interface DisplayPoint {
  x: number;
  y: number;
}

type LogKind = 'scan' | 'move' | 'read' | 'state' | 'alert' | 'verify' | 'decision';

interface LogEntry {
  id: string;
  kind: LogKind;
  message: string;
  tick: number;
  timestamp: string;
}

interface StructureFocus {
  distance: number;
  entity: Entity | null;
}

interface AgentPalette {
  fill: string;
  glow: string;
  stroke: string;
}

const PREVIEW_ENTITIES = createInitialEntities(DEFAULT_SEED).sort((left, right) =>
  left.id.localeCompare(right.id),
);

const PREVIEW_WORLD_STATE: WorldState = {
  id: WORLD_STATE_ID,
  seed: DEFAULT_SEED,
  tick: 0,
  phase: 0,
  status: 'booting',
  weather: 'clear',
};

const DEFAULT_OPERATOR_CONTROL: OperatorControl = {
  id: 'lux-control',
  repo_path: '',
  operator_prompt: '',
  weather_override: null,
  updated_at: null,
};

const AUTO_HIDDEN_PATH_PREFIXES = [
  '.venv/',
  '.venv-pdf/',
  'node_modules/',
  'dist/',
  'codex-runlogs/',
  '.codex-runlogs/',
  '.lux-state/',
] as const;

function entityMapFromList(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function createEntityList(map: Map<string, Entity>): Entity[] {
  return Array.from(map.values()).sort((left, right) => left.id.localeCompare(right.id));
}



function getAgentPalette(role: HivemindAgentRole): AgentPalette {
  if (role === 'visionary') {
    return { fill: '#ec4899', glow: 'rgba(236, 72, 153, 0.78)', stroke: '#ffb0dc' };
  }

  if (role === 'critic') {
    return { fill: '#ef4444', glow: 'rgba(239, 68, 68, 0.8)', stroke: '#ffc0c0' };
  }

  return { fill: '#10b981', glow: 'rgba(16, 185, 129, 0.78)', stroke: '#8cffd3' };
}

function _withAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// getFileFootprint and getPrismHeight are imported from ./building-geometry

function shouldAutoHidePath(path: string): boolean {
  return AUTO_HIDDEN_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function drawCityscape(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  phase: number,
  daylight: number,
  night: number,
  weather: Weather,
): void {
  const rainTint = weather === 'rain' ? 0.16 : 0;
  const fogTint = weather === 'fog' ? 0.18 : 0;
  const horizonY = viewport.height * 0.72;

  // Three layers of depth — far, mid, near
  const layers = [
    {
      depth: 1.0,
      count: 28,
      baseHeight: viewport.height * 0.14,
      heightVar: viewport.height * 0.1,
      alpha: 0.35 + (night * 0.15),
      windowDensity: 0,
      colorShift: [8, 12, 22] as const,
    },
    {
      depth: 0.65,
      count: 22,
      baseHeight: viewport.height * 0.18,
      heightVar: viewport.height * 0.14,
      alpha: 0.55 + (night * 0.2),
      windowDensity: 0.15 + (night * 0.35),
      colorShift: [14, 20, 32] as const,
    },
    {
      depth: 0.35,
      count: 16,
      baseHeight: viewport.height * 0.22,
      heightVar: viewport.height * 0.18,
      alpha: 0.75 + (night * 0.15),
      windowDensity: 0.25 + (night * 0.45),
      colorShift: [20, 28, 42] as const,
    },
  ];

  for (const layer of layers) {
    const layerY = horizonY - layer.baseHeight * 0.5;
    const r = Math.round(layer.colorShift[0] + (daylight * 28) - (rainTint * 40) + (fogTint * 20));
    const g = Math.round(layer.colorShift[1] + (daylight * 36) - (rainTint * 30) + (fogTint * 18));
    const b = Math.round(layer.colorShift[2] + (daylight * 48) - (rainTint * 20) + (fogTint * 12));

    context.save();

    // Draw skyline silhouette
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${layer.alpha})`;
    context.beginPath();
    context.moveTo(0, viewport.height);

    let currentX = -viewport.width * 0.05;
    const step = (viewport.width * 1.1) / layer.count;

    // Seed-like pseudo-random based on layer index so buildings are stable per layer
    const seededRandom = (index: number, offset: number): number => {
      const seed = Math.sin(index * 12.9898 + offset * 78.233 + layer.depth * 43.123) * 43758.5453;
      return seed - Math.floor(seed);
    };

    for (let i = 0; i <= layer.count + 1; i++) {
      const buildingWidth = step * (0.6 + seededRandom(i, 1) * 0.8);
      const buildingHeight = layer.baseHeight + seededRandom(i, 2) * layer.heightVar;
      const roofStyle = Math.floor(seededRandom(i, 3) * 4); // 0=flat, 1=peaked, 2=stepped, 3=antenna

      const x = currentX;
      const y = layerY - buildingHeight;

      if (roofStyle === 0) {
        context.lineTo(x, y);
        context.lineTo(x + buildingWidth, y);
      } else if (roofStyle === 1) {
        context.lineTo(x, y + buildingHeight * 0.08);
        context.lineTo(x + buildingWidth * 0.5, y);
        context.lineTo(x + buildingWidth, y + buildingHeight * 0.08);
      } else if (roofStyle === 2) {
        const stepW = buildingWidth * 0.3;
        const stepH = buildingHeight * 0.12;
        context.lineTo(x, y + stepH);
        context.lineTo(x + stepW, y + stepH);
        context.lineTo(x + stepW, y);
        context.lineTo(x + buildingWidth - stepW, y);
        context.lineTo(x + buildingWidth - stepW, y + stepH);
        context.lineTo(x + buildingWidth, y + stepH);
      } else {
        context.lineTo(x, y);
        context.lineTo(x + buildingWidth * 0.45, y);
        context.lineTo(x + buildingWidth * 0.45, y - buildingHeight * 0.08);
        context.lineTo(x + buildingWidth * 0.55, y - buildingHeight * 0.08);
        context.lineTo(x + buildingWidth * 0.55, y);
        context.lineTo(x + buildingWidth, y);
      }

      // Windows
      if (layer.windowDensity > 0.05) {
        const cols = Math.max(2, Math.floor(buildingWidth / 7));
        const rows = Math.max(3, Math.floor(buildingHeight / 10));
        const winW = Math.max(1.5, buildingWidth / cols * 0.35);
        const winH = Math.max(1.5, buildingHeight / rows * 0.35);
        const padX = (buildingWidth - cols * winW) / (cols + 1);
        const padY = (buildingHeight - rows * winH) / (rows + 1);

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            if (seededRandom(i, row * 7 + col * 13 + 50) > layer.windowDensity) continue;

            const wx = x + padX + col * (winW + padX);
            const wy = y + padY + row * (winH + padY);
            const blink = 0.5 + 0.5 * Math.sin(phase * 0.03 + i * 10 + row * 3 + col * 7);
            const winAlpha = (0.25 + (night * 0.55)) * blink;
            const warm = seededRandom(i, row * 3 + col * 5 + 100) > 0.6;
            const wr = warm ? 255 : 180 + (daylight * 40);
            const wg = warm ? 220 + (daylight * 20) : 200 + (daylight * 30);
            const wb = warm ? 140 + (daylight * 40) : 230 + (daylight * 20);

            context.fillStyle = `rgba(${wr}, ${wg}, ${wb}, ${winAlpha})`;
            context.fillRect(wx, wy, winW, winH);
          }
        }
      }

      currentX += buildingWidth + step * 0.05;
    }

    context.lineTo(viewport.width, viewport.height);
    context.closePath();
    context.fillStyle = `rgba(${r}, ${g}, ${b}, ${layer.alpha})`;
    context.fill();

    // Distant searchlights / atmospheric beams at night
    if (night > 0.35 && layer.depth < 0.5) {
      for (let i = 0; i < 3; i++) {
        const sx = viewport.width * (0.2 + i * 0.3 + Math.sin(phase * 0.01 + i * 2.1) * 0.1);
        const sy = horizonY - layer.baseHeight * 0.6;
        const angle = Math.sin(phase * 0.015 + i * 1.7) * 0.4 - 0.8;
        const beamLen = viewport.height * 0.35;
        const ex = sx + Math.cos(angle) * beamLen;
        const ey = sy + Math.sin(angle) * beamLen;

        const grad = context.createLinearGradient(sx, sy, ex, ey);
        grad.addColorStop(0, `rgba(200, 230, 255, ${night * 0.06})`);
        grad.addColorStop(1, 'rgba(200, 230, 255, 0)');

        context.strokeStyle = grad;
        context.lineWidth = 2 + night * 3;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(ex, ey);
        context.stroke();
      }
    }

    context.restore();
  }
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  phase: number,
  weather: Weather,
): void {
  const daylight = 0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2));
  const night = 1 - daylight;
  const rainTint = weather === 'rain' ? 0.16 : 0;
  const snowTint = weather === 'snow' ? 0.12 : 0;
  const fogTint = weather === 'fog' ? 0.18 : 0;
  const background = context.createLinearGradient(0, 0, 0, viewport.height);
  background.addColorStop(0, `rgba(${Math.round(22 + (76 * daylight) - (rainTint * 80) + (snowTint * 35) + (fogTint * 25))}, ${Math.round(34 + (116 * daylight) - (rainTint * 55) + (snowTint * 30) + (fogTint * 20))}, ${Math.round(64 + (129 * daylight) - (rainTint * 35) + (snowTint * 18) + (fogTint * 10))}, 1)`);
  background.addColorStop(0.55, `rgba(${Math.round(18 + (87 * daylight) - (rainTint * 70) + (snowTint * 40) + (fogTint * 35))}, ${Math.round(28 + (112 * daylight) - (rainTint * 50) + (snowTint * 34) + (fogTint * 30))}, ${Math.round(46 + (96 * daylight) - (rainTint * 35) + (snowTint * 25) + (fogTint * 20))}, 1)`);
  background.addColorStop(1, `rgba(${Math.round(10 + (58 * daylight) - (rainTint * 55) + (snowTint * 30) + (fogTint * 30))}, ${Math.round(16 + (73 * daylight) - (rainTint * 40) + (snowTint * 26) + (fogTint * 28))}, ${Math.round(24 + (51 * daylight) - (rainTint * 30) + (snowTint * 18) + (fogTint * 18))}, 1)`);
  context.fillStyle = background;
  context.fillRect(0, 0, viewport.width, viewport.height);

  // Sprawling city landscape behind the sky details
  drawCityscape(context, viewport, phase, daylight, night, weather);

  const sunX = viewport.width * (0.2 + ((phase / 60) * 0.6));
  const sunY = viewport.height * (0.12 + (night * 0.08));
  const glow = context.createRadialGradient(
    sunX,
    sunY,
    12,
    sunX,
    sunY,
    viewport.width * 0.3,
  );
  glow.addColorStop(0, `rgba(255, ${Math.round(220 + (20 * daylight))}, ${Math.round(165 + (70 * daylight))}, ${0.05 + (daylight * 0.18)})`);
  glow.addColorStop(1, 'rgba(255, 214, 170, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, viewport.width, viewport.height);

  if (night > 0.45) {
    context.save();
    context.fillStyle = `rgba(255, 245, 220, ${night * 0.45})`;
    for (let index = 0; index < 6; index += 1) {
      const x = (viewport.width * (((index * 37) % 100) / 100));
      const y = 20 + (((index * 53) % 120));
      context.fillRect(x, y, 1.5, 1.5);
    }
    context.restore();
  }

  // Clouds — soft drifting ellipses
  if (daylight > 0.15 && weather !== 'fog') {
    context.save();
    const cloudAlpha = 0.12 + (daylight * 0.14);
    const cloudSpeed = phase * 0.15;
    const cloudData = [
      { x: 0.12, y: 0.08, w: 0.18, h: 0.04, speed: 0.8 },
      { x: 0.38, y: 0.14, w: 0.22, h: 0.05, speed: 0.5 },
      { x: 0.68, y: 0.06, w: 0.15, h: 0.035, speed: 1.1 },
    ];
    for (const cloud of cloudData) {
      const cx = ((cloud.x + (cloudSpeed * cloud.speed * 0.0005)) % 1.2) - 0.1;
      const cy = viewport.height * cloud.y;
      const cw = viewport.width * cloud.w;
      const ch = viewport.height * cloud.h;

      const grad = context.createRadialGradient(cx * viewport.width, cy, 0, cx * viewport.width, cy, cw);
      grad.addColorStop(0, `rgba(255, 255, 255, ${cloudAlpha})`);
      grad.addColorStop(0.5, `rgba(255, 255, 255, ${cloudAlpha * 0.6})`);
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      context.fillStyle = grad;
      context.beginPath();
      context.ellipse(cx * viewport.width, cy, cw, ch, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  // Birds — small V flocks drifting during day
  if (daylight > 0.3 && weather !== 'rain' && weather !== 'snow' && weather !== 'fog') {
    context.save();
    context.strokeStyle = `rgba(30, 30, 35, ${0.35 + (daylight * 0.25)})`;
    context.lineWidth = 1;
    context.lineCap = 'round';
    for (let flock = 0; flock < 2; flock++) {
      const flockX = ((0.15 + (flock * 0.32) + ((phase * 0.0002) * (1 + flock * 0.3))) % 1.3) - 0.15;
      const flockY = 0.05 + (flock * 0.06) + (Math.sin(phase * 0.01 + flock) * 0.02);
      for (let b = 0; b < 3; b++) {
        const bx = (flockX * viewport.width) + (b * 12) + (Math.sin(phase * 0.05 + b + flock) * 3);
        const by = (flockY * viewport.height) + (Math.cos(phase * 0.03 + b) * 2);
        const wingSpan = 3 + Math.sin(phase * 0.08 + b + flock) * 1.5;
        context.beginPath();
        context.moveTo(bx - wingSpan, by - 1);
        context.lineTo(bx, by + 1);
        context.lineTo(bx + wingSpan, by - 1);
        context.stroke();
      }
    }
    context.restore();
  }
}

function _drawGrid(context: CanvasRenderingContext2D, layout: IsoLayout, z: number, color: string): void {
  context.lineWidth = 1;

  for (let x = 0; x <= 50; x += 1) {
    const start = toScreen(x, 0, z, layout);
    const end = toScreen(x, 50, z, layout);
    context.beginPath();
    context.moveTo(start.sx, start.sy);
    context.lineTo(end.sx, end.sy);
    context.strokeStyle = x % 5 === 0 ? color.replace('0.08', '0.22').replace('0.2', '0.35') : color;
    context.stroke();
  }

  for (let y = 0; y <= 50; y += 1) {
    const start = toScreen(0, y, z, layout);
    const end = toScreen(50, y, z, layout);
    context.beginPath();
    context.moveTo(start.sx, start.sy);
    context.lineTo(end.sx, end.sy);
    context.strokeStyle = y % 5 === 0 ? color.replace('0.08', '0.22').replace('0.2', '0.35') : color;
    context.stroke();
  }
}



function getInterpolatedPoint(
  entity: Entity,
  displayPoints: Record<string, DisplayPoint>,
): DisplayPoint {
  const display = displayPoints[entity.id] ?? { x: entity.x, y: entity.y };
  display.x += (entity.x - display.x) * 0.2;
  display.y += (entity.y - display.y) * 0.2;

  if (Math.abs(display.x - entity.x) < 0.01) {
    display.x = entity.x;
  }

  if (Math.abs(display.y - entity.y) < 0.01) {
    display.y = entity.y;
  }

  displayPoints[entity.id] = display;
  return display;
}

function getFootprintPolygon(
  x: number,
  y: number,
  width: number,
  depth: number,
  z: number,
  layout: IsoLayout,
): [{ sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }] {
  return [
    toScreen(x, y, z, layout),
    toScreen(x + width, y, z, layout),
    toScreen(x + width, y + depth, z, layout),
    toScreen(x, y + depth, z, layout),
  ];
}

function tracePolygonPath(
  context: CanvasRenderingContext2D,
  points: Array<{ sx: number; sy: number }> | [{ sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }, { sx: number; sy: number }],
): void {
  const first = points[0];
  if (!first) {
    return;
  }

  context.beginPath();
  context.moveTo(first.sx, first.sy);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      continue;
    }

    context.lineTo(point.sx, point.sy);
  }
  context.closePath();
}

function drawTetherRoute(
  context: CanvasRenderingContext2D,
  routeNodes: Entity[],
  layout: IsoLayout,
  phase: number,
): void {
  if (routeNodes.length < 2) {
    return;
  }

  const routePoints = routeNodes.map((node) => {
    const height = getPrismHeight(node);
    const footprint = getFileFootprint(node);
    return toScreen(
      node.x + (footprint.width / 2),
      node.y + (footprint.depth / 2),
      (node.z ?? 0) + height + 0.1,
      layout,
    );
  });

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(52, 63, 80, 0.92)';
  context.lineWidth = 5;
  context.beginPath();

  routePoints.forEach((screen, index) => {
    if (index === 0) {
      context.moveTo(screen.sx, screen.sy);
    } else {
      context.lineTo(screen.sx, screen.sy);
    }
  });

  context.stroke();

  context.strokeStyle = 'rgba(255, 205, 96, 0.95)';
  context.lineWidth = 1.4;
  context.setLineDash([9, 7]);
  context.lineDashOffset = -(phase * 1.8);
  context.beginPath();
  routePoints.forEach((screen, index) => {
    if (index === 0) {
      context.moveTo(screen.sx, screen.sy);
    } else {
      context.lineTo(screen.sx, screen.sy);
    }
  });
  context.stroke();
  context.setLineDash([]);

  for (const point of routePoints) {
    context.fillStyle = 'rgba(255, 231, 170, 0.9)';
    context.beginPath();
    context.arc(point.sx, point.sy, 2.3, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

// drawStructureEntity replaced by drawBuilding from ./building-render

function drawGoal(context: CanvasRenderingContext2D, entity: Entity, layout: IsoLayout): void {
  const plaza = getFootprintPolygon(entity.x + 0.16, entity.y + 0.16, 0.68, 0.68, 0.04, layout);
  const center = toScreen(entity.x + 0.5, entity.y + 0.5, 0.1, layout);
  const mastTop = toScreen(entity.x + 0.5, entity.y + 0.5, 1.0, layout);
  const flagTip = toScreen(entity.x + 0.84, entity.y + 0.5, 0.86, layout);
  const flagTail = toScreen(entity.x + 0.72, entity.y + 0.68, 0.74, layout);
  context.save();

  context.fillStyle = 'rgba(110, 66, 26, 0.28)';
  context.beginPath();
  context.ellipse(center.sx, center.sy + (layout.tileHeight * 0.18), layout.tileWidth * 0.24, layout.tileHeight * 0.16, 0, 0, Math.PI * 2);
  context.fill();

  tracePolygonPath(context, plaza);
  context.fillStyle = 'rgba(191, 140, 78, 0.95)';
  context.fill();
  context.strokeStyle = 'rgba(252, 211, 153, 0.88)';
  context.lineWidth = 1.4;
  context.stroke();

  context.strokeStyle = 'rgba(94, 60, 32, 0.95)';
  context.lineWidth = 2.6;
  context.beginPath();
  context.moveTo(center.sx, center.sy);
  context.lineTo(mastTop.sx, mastTop.sy);
  context.stroke();

  context.beginPath();
  context.moveTo(mastTop.sx, mastTop.sy + 1);
  context.lineTo(flagTip.sx, flagTip.sy);
  context.lineTo(flagTail.sx, flagTail.sy);
  context.closePath();
  context.fillStyle = 'rgba(220, 54, 54, 0.96)';
  context.fill();

  context.fillStyle = 'rgba(255, 223, 110, 0.95)';
  context.shadowBlur = 12;
  context.shadowColor = 'rgba(255, 223, 110, 0.75)';
  context.beginPath();
  context.arc(mastTop.sx, mastTop.sy, 3.2, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawAgentTethers(
  context: CanvasRenderingContext2D,
  agents: Entity[],
  entities: Entity[],
  layout: IsoLayout,
  displayPoints: Record<string, DisplayPoint>,
): void {
  for (const agent of agents) {
    if (!agent.objective_path) {
      continue;
    }

    const target = entities.find((e) => e.path === agent.objective_path);
    if (!target) {
      continue;
    }

    const agentDisplay = getInterpolatedPoint(agent, displayPoints);
    const targetFootprint = getFileFootprint(target);
    const agentCenter = toScreen(agentDisplay.x + 0.5, agentDisplay.y + 0.5, 0.2, layout);
    const targetCenter = toScreen(
      target.x + (targetFootprint.width / 2),
      target.y + (targetFootprint.depth / 2),
      0.22,
      layout,
    );
    const controlX = (agentCenter.sx + targetCenter.sx) / 2;
    const controlY = Math.min(agentCenter.sy, targetCenter.sy) - (layout.tileHeight * 0.45);

    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(83, 72, 42, 0.68)';
    context.lineWidth = 2.8;
    context.beginPath();
    context.moveTo(agentCenter.sx, agentCenter.sy);
    context.quadraticCurveTo(controlX, controlY, targetCenter.sx, targetCenter.sy);
    context.stroke();

    context.strokeStyle = 'rgba(255, 205, 105, 0.9)';
    context.lineWidth = 1.1;
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(agentCenter.sx, agentCenter.sy);
    context.quadraticCurveTo(controlX, controlY, targetCenter.sx, targetCenter.sy);
    context.stroke();
    context.setLineDash([]);

    context.fillStyle = 'rgba(255, 216, 140, 0.95)';
    context.beginPath();
    context.moveTo(targetCenter.sx, targetCenter.sy - 5);
    context.lineTo(targetCenter.sx + 4.5, targetCenter.sy);
    context.lineTo(targetCenter.sx, targetCenter.sy + 5);
    context.lineTo(targetCenter.sx - 4.5, targetCenter.sy);
    context.closePath();
    context.fill();
    context.restore();
  }
}

function drawPheromone(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  phase: number,
): void {
  const ttl = entity.ttl_ticks ?? 0;
  const maxTtl = 30;
  const life = ttl / maxTtl;
  if (life <= 0) {
    return;
  }

  const center = toScreen(display.x + 0.5, display.y + 0.5, 0.1, layout);
  const pulse = 0.9 + ((phase % 8) * 0.04);
  const alpha = life * 0.35;
  const coneHeight = layout.tileHeight * (0.7 + (life * 0.35));
  const coneWidth = layout.tileWidth * 0.16;
  const beaconY = center.sy - coneHeight;

  context.save();

  context.fillStyle = 'rgba(94, 66, 28, 0.3)';
  context.beginPath();
  context.ellipse(center.sx, center.sy + 3, layout.tileWidth * 0.12, layout.tileHeight * 0.1, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = `rgba(255, 196, 92, ${alpha * 1.35})`;
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.beginPath();
  context.ellipse(center.sx, center.sy + 1, layout.tileWidth * (0.18 + ((pulse - 0.9) * 0.18)), layout.tileHeight * 0.12, 0, 0, Math.PI * 2);
  context.stroke();
  context.setLineDash([]);

  context.beginPath();
  context.moveTo(center.sx, beaconY);
  context.lineTo(center.sx + coneWidth, center.sy + 1);
  context.lineTo(center.sx - coneWidth, center.sy + 1);
  context.closePath();
  context.fillStyle = `rgba(242, 140, 40, ${0.72 + (life * 0.2)})`;
  context.fill();

  context.strokeStyle = `rgba(255, 240, 220, ${0.42 + (life * 0.18)})`;
  context.lineWidth = 1.1;
  context.beginPath();
  context.moveTo(center.sx - (coneWidth * 0.6), beaconY + (coneHeight * 0.42));
  context.lineTo(center.sx + (coneWidth * 0.6), beaconY + (coneHeight * 0.42));
  context.stroke();

  context.fillStyle = `rgba(255, 224, 120, ${0.4 + (life * 0.3)})`;
  context.shadowBlur = 10 * life;
  context.shadowColor = `rgba(255, 214, 102, ${alpha * 0.8})`;
  context.beginPath();
  context.arc(center.sx, beaconY - 1.5, 2.3, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawLMMGhost(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  phase: number,
  tick: number,
): void {
  const role = getAgentRole(entity) ?? 'architect';
  const palette = getAgentPalette(role);
  const ground = toScreen(display.x + 0.5, display.y + 0.5, 0.18, layout);
  const center = toScreen(display.x + 0.5, display.y + 0.5, 1.02, layout);
  const scale = layout.tileHeight * 0.38;
  const pulse = 0.55 + ((phase % 10) * 0.035);
  const floatY = Math.sin(tick * 0.15) * scale * 0.15;
  const opacity = pulse;

  if (opacity <= 0.01) {
    return;
  }

  const bodyFill = _withAlpha(palette.fill, opacity * 0.8);
  const bodyStroke = _withAlpha(palette.stroke, opacity * 0.95);
  const rotorFill = `rgba(214, 228, 240, ${opacity * 0.92})`;
  const lensFill = `rgba(238, 248, 255, ${opacity * 0.96})`;

  context.save();
  context.fillStyle = 'rgba(0, 0, 0, 0.2)';
  context.beginPath();
  context.ellipse(ground.sx, ground.sy + (layout.tileHeight * 0.18), scale * 0.75, scale * 0.22, 0, 0, Math.PI * 2);
  context.fill();

  context.translate(center.sx, center.sy + floatY);
  context.shadowBlur = 18;
  context.shadowColor = palette.glow;

  context.strokeStyle = bodyStroke;
  context.lineWidth = 1.6;
  context.beginPath();
  context.moveTo(-scale * 0.55, -scale * 0.08);
  context.lineTo(scale * 0.55, scale * 0.08);
  context.moveTo(-scale * 0.12, -scale * 0.45);
  context.lineTo(scale * 0.12, scale * 0.45);
  context.stroke();

  const rotorOffsets = [
    { x: -scale * 0.62, y: -scale * 0.1 },
    { x: scale * 0.62, y: scale * 0.1 },
    { x: -scale * 0.14, y: -scale * 0.5 },
    { x: scale * 0.14, y: scale * 0.5 },
  ];
  context.fillStyle = rotorFill;
  for (const rotor of rotorOffsets) {
    context.beginPath();
    context.arc(rotor.x, rotor.y, scale * 0.12, 0, Math.PI * 2);
    context.fill();
  }

  context.beginPath();
  context.moveTo(0, -scale * 0.28);
  context.lineTo(scale * 0.3, 0);
  context.lineTo(0, scale * 0.28);
  context.lineTo(-scale * 0.3, 0);
  context.closePath();
  context.fillStyle = bodyFill;
  context.fill();
  context.strokeStyle = bodyStroke;
  context.lineWidth = 1.2;
  context.stroke();

  context.shadowBlur = 0;
  context.beginPath();
  context.arc(0, 0, scale * 0.12, 0, Math.PI * 2);
  context.fillStyle = lensFill;
  context.fill();

  context.fillStyle = `rgba(15, 25, 38, ${opacity * 0.85})`;
  context.font = `${Math.max(8, Math.round(scale * 0.35))}px monospace`;
  context.textAlign = 'center';
  context.fillText(entity.lmm_rule?.charAt(0).toUpperCase() ?? '?', 0, scale * 0.07);

  context.restore();
}

function drawAgent(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  phase: number,
  tick: number,
): void {
  const role = getAgentRole(entity) ?? 'architect';
  const palette = getAgentPalette(role);
  const center = toScreen(display.x + 0.5, display.y + 0.5, 0.4, layout);
  const scale = layout.tileHeight * 0.35;
  const pulse = 0.85 + ((phase % 10) * 0.02);

  const idleTicks = tick - entity.tick_updated;
  const hasObjective = entity.objective_path != null;
  let opacity = pulse;
  if (!hasObjective && idleTicks > 30) {
    opacity = pulse * Math.max(0.3, 1 - (idleTicks - 30) / 90);
  }

  if (opacity <= 0.01) {
    return;
  }

  const walkCycle = hasObjective ? Math.sin(tick * 0.8) * scale * 0.08 : 0;

  context.save();
  context.globalAlpha = opacity;

  // Shadow
  context.fillStyle = 'rgba(0, 0, 0, 0.25)';
  context.beginPath();
  context.ellipse(center.sx, center.sy + scale * 0.6, scale * 0.5, scale * 0.15, 0, 0, Math.PI * 2);
  context.fill();

  // Hard hat color based on role
  const hatColor = palette.fill;
  const shirtColor = palette.stroke;
  const pantsColor = '#455a64';
  const skinColor = '#ffe0b2';

  // Legs
  context.strokeStyle = pantsColor;
  context.lineWidth = scale * 0.18;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(center.sx - scale * 0.12, center.sy + scale * 0.1 + walkCycle);
  context.lineTo(center.sx - scale * 0.15, center.sy + scale * 0.55);
  context.stroke();
  context.beginPath();
  context.moveTo(center.sx + scale * 0.12, center.sy + scale * 0.1 - walkCycle);
  context.lineTo(center.sx + scale * 0.15, center.sy + scale * 0.55);
  context.stroke();

  // Body
  context.fillStyle = shirtColor;
  context.beginPath();
  context.roundRect(center.sx - scale * 0.22, center.sy - scale * 0.25, scale * 0.44, scale * 0.4, scale * 0.06);
  context.fill();

  // Hard hat
  context.fillStyle = hatColor;
  context.beginPath();
  context.ellipse(center.sx, center.sy - scale * 0.38, scale * 0.2, scale * 0.12, 0, 0, Math.PI * 2);
  context.fill();
  context.fillRect(center.sx - scale * 0.22, center.sy - scale * 0.4, scale * 0.44, scale * 0.08);

  // Head
  context.fillStyle = skinColor;
  context.beginPath();
  context.arc(center.sx, center.sy - scale * 0.32, scale * 0.14, 0, Math.PI * 2);
  context.fill();

  // Arms
  context.strokeStyle = skinColor;
  context.lineWidth = scale * 0.12;
  context.beginPath();
  context.moveTo(center.sx - scale * 0.2, center.sy - scale * 0.15);
  context.lineTo(center.sx - scale * 0.32, center.sy + scale * 0.1 + walkCycle * 0.5);
  context.stroke();
  context.beginPath();
  context.moveTo(center.sx + scale * 0.2, center.sy - scale * 0.15);
  context.lineTo(center.sx + scale * 0.32, center.sy + scale * 0.1 - walkCycle * 0.5);
  context.stroke();

  // Role glow when active
  if (hasObjective) {
    context.shadowBlur = 12;
    context.shadowColor = palette.glow;
    context.strokeStyle = palette.fill;
    context.lineWidth = 1;
    context.beginPath();
    context.arc(center.sx, center.sy, scale * 0.7, 0, Math.PI * 2);
    context.stroke();
    context.shadowBlur = 0;
  }

  // Role label
  context.fillStyle = `rgba(200, 210, 230, ${opacity * 0.6})`;
  context.font = `${Math.max(7, Math.round(scale * 0.3))}px monospace`;
  context.textAlign = 'center';
  context.fillText(entity.lmm_rule?.charAt(0).toUpperCase() ?? '?', center.sx, center.sy - scale * 0.7);

  context.restore();
}

function drawFireflies(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  phase: number,
): void {
  const night = 1 - (0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2)));
  if (night < 0.4) return;

  context.save();
  const flyCount = 4;
  for (let i = 0; i < flyCount; i++) {
    const baseX = (viewport.width * (((i * 47 + 13) % 100) / 100));
    const baseY = (viewport.height * (0.3 + (((i * 31 + 7) % 50) / 100)));
    const driftX = Math.sin(phase * 0.02 + i * 1.7) * 20;
    const driftY = Math.cos(phase * 0.015 + i * 2.3) * 12;
    const blink = 0.3 + (Math.sin(phase * 0.08 + i * 4.1) * 0.25);

    context.fillStyle = `rgba(180, 255, 120, ${blink * night})`;
    context.shadowBlur = 6 * night;
    context.shadowColor = `rgba(160, 255, 80, ${blink * night * 0.8})`;
    context.beginPath();
    context.arc(baseX + driftX, baseY + driftY, 1.5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawAtmosphericOverlay(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  weather: Weather,
): void {
  // Subtle blue radial haze around screen edges
  const gradient = context.createRadialGradient(
    viewport.width / 2, viewport.height / 2, viewport.height * 0.2,
    viewport.width / 2, viewport.height / 2, viewport.height * 0.85,
  );
  gradient.addColorStop(0, 'rgba(200, 220, 245, 0)');
  gradient.addColorStop(0.65, 'rgba(180, 205, 235, 0)');
  gradient.addColorStop(1, 'rgba(160, 190, 220, 0.22)');

  context.save();
  context.globalAlpha = 1;
  context.fillStyle = gradient;
  context.fillRect(0, 0, viewport.width, viewport.height);

  if (weather === 'fog') {
    context.fillStyle = 'rgba(210, 218, 224, 0.2)';
    context.fillRect(0, 0, viewport.width, viewport.height);
  }

  context.restore();
}

function drawWeatherScreenEffects(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  phase: number,
  weather: Weather,
): void {
  if (weather === 'rain') {
    context.save();
    context.strokeStyle = 'rgba(180, 215, 255, 0.35)';
    context.lineWidth = 1.1;
    for (let index = 0; index < 22; index += 1) {
      const x = ((index * 23) + (phase * 18)) % (viewport.width + 30);
      const y = ((index * 37) + (phase * 48)) % (viewport.height + 40);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - 10, y + 20);
      context.stroke();
    }
    context.restore();
    return;
  }

  if (weather === 'snow') {
    context.save();
    context.fillStyle = 'rgba(245, 248, 255, 0.8)';
    for (let index = 0; index < 18; index += 1) {
      const x = ((index * 31) + (phase * 6)) % viewport.width;
      const y = ((index * 43) + (phase * 12)) % (viewport.height + 20);
      const radius = 1 + ((index % 3) * 0.6);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawParticleEntity(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  tick: number,
): void {
  if (entity.birth_tick == null || entity.ttl_ticks == null) {
    return;
  }

  const age = Math.max(0, tick - entity.birth_tick);
  const progress = Math.min(1, age / entity.ttl_ticks);
  const startHeight = heightUnitsToWorldHeight(entity.current_height ?? entity.target_height ?? 24);
  const endHeight = heightUnitsToWorldHeight(entity.target_height ?? 12);
  const drift = (entity.state_register ?? 0) - 1.5;
  const z = startHeight + ((endHeight - startHeight) * progress);
  const center = toScreen(display.x + 0.5 + (drift * 0.04 * progress), display.y + 0.5, z, layout);
  const alpha = Math.max(0, 0.75 - progress);
  const color =
    entity.descriptor === 'dust'
      ? `rgba(203, 213, 225, ${alpha})`
      : `rgba(148, 163, 184, ${alpha})`;

  context.save();
  context.fillStyle = color;
  context.shadowBlur = 4;
  context.shadowColor = color;
  context.beginPath();
  context.arc(center.sx, center.sy - (progress * 8), 2 + ((entity.state_register ?? 0) % 2), 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawRubbleEntity(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  tick: number,
): void {
  const age = entity.birth_tick == null || entity.ttl_ticks == null ? 0 : Math.max(0, tick - entity.birth_tick);
  const progress = entity.ttl_ticks == null ? 0 : Math.min(1, age / entity.ttl_ticks);
  const center = toScreen(display.x + 0.5, display.y + 0.5, 0, layout);
  const alpha = 0.85 * (1 - progress);

  context.save();
  context.fillStyle = `rgba(71, 85, 105, ${alpha})`;
  context.beginPath();
  context.ellipse(center.sx, center.sy + 4, 16, 6, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = `rgba(148, 163, 184, ${alpha * 0.9})`;
  for (let index = 0; index < 5; index += 1) {
    context.beginPath();
    context.arc(center.sx - 10 + (index * 5), center.sy + 1 + ((index % 2) * 2), 2.2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}



function drawEntities(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  entities: Entity[],
  layout: IsoLayout,
  phase: number,
  tick: number,
  displayPoints: Record<string, DisplayPoint>,
  cityLayout: import('./city-layout').CityLayout,
  selectedEntityId: string | null,
  weather: Weather,
): void {
  const activeIds = new Set(entities.map((entity) => entity.id));
  for (const id of Object.keys(displayPoints)) {
    if (!activeIds.has(id)) {
      delete displayPoints[id];
    }
  }

  const renderables = entities.map((entity) => ({
    depth: entity.x + entity.y + (entity.z ?? 0) * 0.5 + (getPrismHeight(entity) * 0.1),
    entity,
  }));

  renderables.sort((left, right) => left.depth - right.depth);

  for (const item of renderables) {
    const { entity } = item;
    const display = getInterpolatedPoint(entity, displayPoints);

    if (entity.type === 'pheromone') {
      drawPheromone(context, entity, display, layout, phase);
      continue;
    }

    if (entity.type === 'agent') {
      if (entity.lmm_rule != null) {
        drawLMMGhost(context, entity, display, layout, phase, tick);
      } else {
        drawAgent(context, entity, display, layout, phase, tick);
      }
      continue;
    }

    if (entity.type === 'goal') {
      drawGoal(context, entity, layout);
      continue;
    }

    if (entity.type === 'particle') {
      drawParticleEntity(context, entity, display, layout, tick);
      continue;
    }

    if (entity.type === 'rubble') {
      drawRubbleEntity(context, entity, display, layout, tick);
      continue;
    }

    const screenPt = toScreen(display.x, display.y, entity.z ?? 0, layout);
    const dist = Math.hypot(screenPt.sx - viewport.width / 2, screenPt.sy - viewport.height / 2);
    const maxDist = Math.hypot(viewport.width, viewport.height) / 2;
    const haze = Math.min(1, Math.max(0, dist / maxDist));
    const fogMultiplier = weather === 'fog' ? 0.75 : 0.5;

    context.save();
    context.globalAlpha = 1 - (haze * fogMultiplier);

    if (isStructureEntity(entity)) {
      drawBuilding({
        context,
        entity,
        display,
        layout,
        phase,
        cityLayout,
        allEntities: entities,
        isSelected: selectedEntityId === entity.id,
      });
      context.restore();
      continue;
    }

    drawBuilding({
      context,
      entity,
      display,
      layout,
      phase,
      cityLayout,
      allEntities: entities,
      isSelected: selectedEntityId === entity.id,
    });
    context.restore();
  }
}

function formatTimestamp(): string {
  const now = new Date();
  return `${now.toLocaleTimeString('en-US', { hour12: false })}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

function buildBreadcrumb(entity: Entity | null): string {
  if (!entity) {
    return 'root';
  }

  if (!entity.path || entity.path === '.') {
    return entity.name ?? 'repository root';
  }

  return entity.path.split('/').join(' > ');
}

function summarizeDirective(value: string | null | undefined, limit = 96): string {
  const directive = value?.trim();
  if (!directive) {
    return 'No active directive';
  }

  return directive.length > limit ? `${directive.slice(0, limit - 1)}…` : directive;
}

function formatControlStatus(value: string | null | undefined): string {
  if (!value) {
    return 'idle';
  }

  return value.replace('-', ' ');
}

function getNearestStructure(agent: Entity | null, entities: Entity[]): StructureFocus {
  if (!agent) {
    return { distance: Number.POSITIVE_INFINITY, entity: null };
  }

  let nearest: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entity of entities) {
    const distance = manhattanDistance(agent, entity);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = entity;
    }
  }

  return { distance: bestDistance, entity: nearest };
}

function getLoadedFile(agent: Entity | null, entities: Entity[]): Entity | null {
  if (!agent) {
    return null;
  }

  const fileCandidates = entities.filter((entity) => entity.type === 'file');
  const nearest = getNearestStructure(agent, fileCandidates);
  return !nearest.entity || nearest.distance > 1 ? null : nearest.entity;
}

function buildRouteNodes(focus: Entity | null, entityByPath: Map<string, Entity>): Entity[] {
  if (!focus) {
    return [];
  }

  const route: Entity[] = [];
  const root = entityByPath.get('.');
  if (root) {
    route.push(root);
  }

  if (!focus.path || focus.path === '.') {
    return route;
  }

  const segments = focus.path.split('/');
  const prefixes: string[] = [];

  if (focus.type === 'directory') {
    for (let index = 0; index < segments.length; index += 1) {
      prefixes.push(segments.slice(0, index + 1).join('/'));
    }
  } else {
    for (let index = 0; index < segments.length - 1; index += 1) {
      prefixes.push(segments.slice(0, index + 1).join('/'));
    }
    prefixes.push(focus.path);
  }

  for (const prefix of prefixes) {
    const entity = entityByPath.get(prefix);
    if (entity) {
      route.push(entity);
    }
  }

  return route;
}

function createLogEntry(kind: LogKind, tick: number, message: string): LogEntry {
  return {
    id: `${kind}-${tick}-${crypto.randomUUID()}`,
    kind,
    message,
    tick,
    timestamp: formatTimestamp(),
  };
}

function getEntityPath(entity: Entity): string {
  return entity.path ?? entity.name ?? entity.id;
}

function buildVisibleStructurePathSet(
  fileNodes: Entity[],
  hiddenFilePaths: Set<string>,
): Set<string> {
  const visiblePaths = new Set<string>(['.']);

  for (const fileNode of fileNodes) {
    const filePath = fileNode.path;
    if (!filePath || hiddenFilePaths.has(filePath)) {
      continue;
    }

    const segments = filePath.split('/');
    for (let index = 0; index < segments.length; index += 1) {
      visiblePaths.add(segments.slice(0, index + 1).join('/'));
    }
  }

  return visiblePaths;
}



function stripUnsafeOperatorControlFields(
  control: Record<string, unknown>,
): Omit<OperatorControl, 'updated_at'> {
  return {
    id: String(control.id ?? 'lux-control'),
    repo_path: String(control.repo_path ?? ''),
    operator_prompt: String(control.operator_prompt ?? ''),
    weather_override: (control.weather_override as OperatorControl['weather_override']) ?? null,
    paused: Boolean(control.paused),
    automate: Boolean(control.automate),
    visionary_prompt: String(control.visionary_prompt ?? ''),
    architect_prompt: String(control.architect_prompt ?? ''),
    critic_prompt: String(control.critic_prompt ?? ''),
    pending_edit_path: (control.pending_edit_path as OperatorControl['pending_edit_path']) ?? null,
    pending_edit_content: (control.pending_edit_content as OperatorControl['pending_edit_content']) ?? null,
    commit_message: (control.commit_message as OperatorControl['commit_message']) ?? null,
    should_push: Boolean(control.should_push),
  };
}

function App() {
  const [entities, setEntities] = useState<Entity[]>(PREVIEW_ENTITIES);
  const [worldState, setWorldState] = useState<WorldState>(PREVIEW_WORLD_STATE);
  const [operatorControl, setOperatorControl] = useState<OperatorControl>(DEFAULT_OPERATOR_CONTROL);
  const [repoInput, setRepoInput] = useState<string>('');
  const [directiveInput, setDirectiveInput] = useState<string>('');
  // Status feedback is rendered through errorMessage (hud-alert) and the bottom status bar.
  const [isSavingControl, setIsSavingControl] = useState(false);
  const [mode, setMode] = useState<'preview' | 'live'>('preview');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ height: 720, width: 1280 });
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [hiddenFilePaths, setHiddenFilePaths] = useState<string[]>([]);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [showPlumbing, setShowPlumbing] = useState(false);
  const [showAgentThoughts, setShowAgentThoughts] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [, setEngineError] = useState<string | null>(null);

  const frameRef = useRef<number | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latticeRef = useRef<HTMLDivElement | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabaseClient> | null>(null);
  const entityMapRef = useRef<Map<string, Entity>>(entityMapFromList(PREVIEW_ENTITIES));
  const entityListRef = useRef<Entity[]>(PREVIEW_ENTITIES);
  const visibleEntityListRef = useRef<Entity[]>(PREVIEW_ENTITIES);
  const visibleStructureListRef = useRef<Entity[]>(PREVIEW_ENTITIES.filter((entity) => isStructureEntity(entity)));
  const displayPointsRef = useRef<Record<string, DisplayPoint>>({});
  const trafficRef = useRef(createTrafficSystem());
  const cityLayoutRef = useRef(computeCityLayout(PREVIEW_ENTITIES));
  const controlDirtyRef = useRef(false);
  const phaseRef = useRef<number>(worldState.phase);
  const tickRef = useRef<number>(worldState.tick);
  const routeNodesRef = useRef<Entity[]>([]);
  const previousTickRef = useRef<number>(-1);
  const previousStatusRef = useRef<string | null>(null);
  const previousControlStatusRef = useRef<string | null>(null);
  const previousDirectiveRef = useRef<string | null>(null);
  const previousTargetPathRef = useRef<string | null>(null);
  const previousActiveRepoRef = useRef<string | null>(null);
  const previousFocusPathRef = useRef<string | null>(null);
  const previousLoadedPathRef = useRef<string | null>(null);
  const previousAgentPositionRef = useRef<string | null>(null);
  const previousCriticalMassSignatureRef = useRef<string>('');
  const previousAsymmetrySignatureRef = useRef<string>('');
  const previousAgentActivitiesRef = useRef<Record<string, AgentActivity>>({});
  const agentDecisionHistoryRef = useRef<Map<string, AgentActivity[]>>(new Map());
  const selectedEntityRef = useRef<Entity | null>(null);
  const hoveredEntityIdRef = useRef<string | null>(null);
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const cameraCommitFrameRef = useRef<number | null>(null);
  const showPlumbingRef = useRef(false);
  const weatherRef = useRef<Weather>(worldState.weather ?? 'clear');
  const isInteractingRef = useRef(false);
  const interactionSettledTimeoutRef = useRef<number | null>(null);
  const zoomAnimationRef = useRef<{ frame: number | null; target: Camera | null }>({ frame: null, target: null });
  const autoHiddenRepoRef = useRef<string | null>(null);

  // Handle sound events
  useEffect(() => {
    if (worldState?.sound_events) {
      for (const event of worldState.sound_events) {
         console.log(`[sound] Playing sound event: ${event}`);
         // Dev will hook up actual audio files here
      }
    }
  }, [worldState?.sound_events, worldState?.tick]);

  const agents = useMemo(() => entities.filter((entity) => entity.type === 'agent'), [entities]);
  const primaryAgent = agents[0] ?? null;
  const primaryRole = primaryAgent ? (getAgentRole(primaryAgent) ?? 'architect') : 'architect';
  const structureNodes = useMemo(() => entities.filter((entity) => isStructureEntity(entity)), [entities]);
  const fileNodes = useMemo(
    () => structureNodes
      .filter((entity) => entity.type === 'file')
      .sort((left, right) => getEntityPath(left).localeCompare(getEntityPath(right))),
    [structureNodes],
  );
  const hiddenFilePathSet = useMemo(() => new Set(hiddenFilePaths), [hiddenFilePaths]);
  const visibleStructurePathSet = useMemo(
    () => buildVisibleStructurePathSet(fileNodes, hiddenFilePathSet),
    [fileNodes, hiddenFilePathSet],
  );
  const visibleStructureNodes = useMemo(() => structureNodes.filter((entity) => {
    if (!entity.path) {
      return false;
    }

    return visibleStructurePathSet.has(entity.path);
  }), [structureNodes, visibleStructurePathSet]);
  const visibleEntities = useMemo(() => entities.filter((entity) => {
    if (!isStructureEntity(entity)) {
      return true;
    }

    return entity.path != null && visibleStructurePathSet.has(entity.path);
  }), [entities, visibleStructurePathSet]);
  const cityCouncil = useMemo(
    () => computeCityCouncilState(visibleEntities, worldState),
    [visibleEntities, worldState],
  );
  const repositoryRoot = useMemo(
    () => structureNodes.find((entity) => entity.type === 'directory' && entity.path === '.') ?? null,
    [structureNodes],
  );
  const focus = useMemo(() => getNearestStructure(primaryAgent, structureNodes), [primaryAgent, structureNodes]);
  const activeStructure = focus.entity;
  const loadedFile = useMemo(() => getLoadedFile(primaryAgent, structureNodes), [primaryAgent, structureNodes]);
  const entityByPath = useMemo(
    () => new Map(
      structureNodes
        .filter((entity) => entity.path !== null && entity.path !== undefined)
        .map((entity) => [entity.path as string, entity]),
    ),
    [structureNodes],
  );
  const routeNodes = useMemo(
    () => buildRouteNodes(loadedFile ?? activeStructure ?? repositoryRoot, entityByPath),
    [activeStructure, entityByPath, loadedFile, repositoryRoot],
  );
  const visibleRouteNodes = useMemo(
    () => routeNodes.filter((entity) => entity.path != null && visibleStructurePathSet.has(entity.path)),
    [routeNodes, visibleStructurePathSet],
  );
  const activeStructureState = activeStructure
    ? (activeStructure.node_state ?? 'stable')
    : null;
  const loadedFileState = loadedFile
    ? (loadedFile.node_state ?? 'stable')
    : null;
  const criticalMassNodes = useMemo(() => structureNodes.filter((entity) => isCriticalMass(entity)), [structureNodes]);
  const asymmetryNodes = useMemo(
    () => structureNodes.filter((entity) => (entity.node_state ?? 'stable') === 'asymmetry'),
    [structureNodes],
  );
  const activeRepositoryName =
    worldState.active_repo_name ??
    repositoryRoot?.name ??
    operatorControl.repo_path.split(/[\\/]/).filter(Boolean).at(-1) ??
    'Unloaded';
  const activeRepositoryPath =
    worldState.active_repo_path ??
    repositoryRoot?.repo_root ??
    (operatorControl.repo_path.trim().length > 0 ? operatorControl.repo_path : null) ??
    null;
  const controlStatus = worldState.control_status ?? 'idle';
  const operatorAction = worldState.operator_action ?? null;
  const operatorTargetPath = worldState.operator_target_path ?? null;

  const isPaused = worldState.paused ?? operatorControl.paused ?? false;
  const isAutomated = worldState.automate ?? operatorControl.automate ?? false;
  const inspectPopupPosition = ((): { left: number; top: number } | null => {
    if (!selectedEntity) return null;
    const layout = createIsoLayout(viewport.width, viewport.height, camera);
    const center = toScreen(
      selectedEntity.x + 0.5,
      selectedEntity.y + 0.5,
      (selectedEntity.z ?? 0) + getPrismHeight(selectedEntity) + 0.8,
      layout,
    );
    const popupWidth = 320;
    const popupHeight = 280;
    let left = center.sx - popupWidth / 2;
    let top = center.sy - popupHeight - layout.tileHeight * 0.5;
    left = Math.max(12, Math.min(viewport.width - popupWidth - 12, left));
    top = Math.max(12, Math.min(viewport.height - popupHeight - 12, top));
    return { left, top };
  })();

  const handleToggleEngine = async (): Promise<void> => {
    setEngineLoading(true);
    setEngineError(null);

    try {
      if (engineRunning) {
        const res = await fetch('http://localhost:3001/api/engine/stop', { method: 'POST' });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setEngineError(data.error ?? 'Failed to stop engine');
        } else {
          setEngineRunning(false);
          setErrorMessage('Engine stopped.');
        }
      } else {
        const res = await fetch('http://localhost:3001/api/engine/start', { method: 'POST' });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setEngineError(data.error ?? 'Failed to start engine');
        } else {
          setEngineRunning(true);
          setErrorMessage('Engine started. Automata are now ticking.');
        }
      }
    } catch {
      setEngineError('Bridge not running. Start it with: npm run bridge');
    } finally {
      setEngineLoading(false);
    }
  };

  const handleControlSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const supabase = supabaseRef.current;
    if (!supabase) {
      setErrorMessage('Supabase browser keys are missing, so controls cannot be committed from this browser.');
      return;
    }

    const nextControl = {
      id: DEFAULT_OPERATOR_CONTROL.id,
      repo_path: repoInput.trim(),
      operator_prompt: directiveInput.trim(),
      paused: isPaused,
      automate: isAutomated,
      visionary_prompt: worldState.visionary_prompt ?? operatorControl.visionary_prompt ?? '',
      architect_prompt: worldState.architect_prompt ?? operatorControl.architect_prompt ?? '',
      critic_prompt: worldState.critic_prompt ?? operatorControl.critic_prompt ?? '',
      pending_edit_path: operatorControl.pending_edit_path,
      pending_edit_content: operatorControl.pending_edit_content,
      commit_message: operatorControl.commit_message,
      should_push: operatorControl.should_push,
    };

    setIsSavingControl(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('operator_controls')
        .upsert(stripUnsafeOperatorControlFields(nextControl as Record<string, unknown>), { onConflict: 'id' });

      if (error) {
        throw error;
      }

      controlDirtyRef.current = false;
      setOperatorControl({
        ...DEFAULT_OPERATOR_CONTROL,
        ...nextControl,
        updated_at: new Date().toISOString(),
      });
      setCommandPaletteOpen(false);
      setErrorMessage(
        nextControl.repo_path.length > 0
          ? 'Repository import queued. The engine will hot-swap overlays on its next control poll.'
          : 'Directive committed. The lattice has accepted the current operator instruction.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown operator control failure';
      setErrorMessage(`Control write failed: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

  const dispatchFileAction = async (action: 'read' | 'explain' | 'repair', targetPath: string): Promise<void> => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setErrorMessage('Supabase keys missing; cannot dispatch file action from browser.');
      return;
    }
    const prompt = `${action} ${targetPath}`;
    setIsSavingControl(true);
    setErrorMessage(null);
    try {
      const { error } = await supabase
        .from('operator_controls')
        .upsert(
          stripUnsafeOperatorControlFields({
            id: DEFAULT_OPERATOR_CONTROL.id,
            repo_path: repoInput.trim(),
            operator_prompt: prompt,
            paused: isPaused,
            automate: isAutomated,
            visionary_prompt: worldState.visionary_prompt ?? operatorControl.visionary_prompt ?? '',
            architect_prompt: worldState.architect_prompt ?? operatorControl.architect_prompt ?? '',
            critic_prompt: worldState.critic_prompt ?? operatorControl.critic_prompt ?? '',
            pending_edit_path: operatorControl.pending_edit_path,
            pending_edit_content: operatorControl.pending_edit_content,
            commit_message: operatorControl.commit_message,
            should_push: operatorControl.should_push,
          }),
          { onConflict: 'id' },
        );
      if (error) throw error;
      setErrorMessage(`Dispatched: ${prompt}. An architect will pick it up on the next tick.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(`Dispatch failed: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

  const handleAdvisorAction = (action: AdvisorAction, targetPath: string): void => {
    void dispatchFileAction(action, targetPath);
  };

  useEffect(() => {
    entityListRef.current = entities;
  }, [entities]);

  useEffect(() => {
    visibleEntityListRef.current = visibleEntities;
    visibleStructureListRef.current = visibleStructureNodes;
  }, [visibleEntities, visibleStructureNodes]);

  useEffect(() => {
    const layoutData = computeCityLayout(visibleEntities);
    cityLayoutRef.current = layoutData;
    trafficRef.current.cars = trafficRef.current.cars.filter(
      (car) => car.roadIndex < layoutData.roads.length,
    );
  }, [visibleEntities]);

  useEffect(() => {
    const validPaths = new Set(fileNodes.map((entity) => entity.path).filter((path): path is string => path != null));
    setHiddenFilePaths((prev) => {
      const next = prev.filter((path) => validPaths.has(path));
      return next.length === prev.length ? prev : next;
    });
  }, [fileNodes]);

  useEffect(() => {
    const repoKey = `${activeRepositoryPath ?? 'preview'}:${fileNodes.length}`;
    if (autoHiddenRepoRef.current === repoKey || fileNodes.length === 0) {
      return;
    }

    const autoHidden = fileNodes
      .map((entity) => entity.path)
      .filter((path): path is string => path != null && shouldAutoHidePath(path));

    setHiddenFilePaths((prev) => (arraysEqual(prev, autoHidden) ? prev : autoHidden));

    autoHiddenRepoRef.current = repoKey;
  }, [activeRepositoryPath, fileNodes]);

  useEffect(() => {
    if (!hoveredEntityId) {
      return;
    }

    if (!visibleStructureNodes.some((entity) => entity.id === hoveredEntityId)) {
      setHoveredEntityId(null);
    }
  }, [hoveredEntityId, visibleStructureNodes]);

  useEffect(() => {
    if (!selectedEntity || !isStructureEntity(selectedEntity) || !selectedEntity.path) {
      return;
    }

    if (!visibleStructurePathSet.has(selectedEntity.path)) {
      setSelectedEntity(null);
    }
  }, [selectedEntity, visibleStructurePathSet]);

  useEffect(() => {
    let cancelled = false;
    let handle: number | null = null;
    let failureCount = 0;

    const schedule = (delayMs: number): void => {
      if (cancelled) {
        return;
      }

      if (handle !== null) {
        window.clearTimeout(handle);
      }

      handle = window.setTimeout(() => {
        void checkStatus();
      }, delayMs);
    };

    const checkStatus = async (): Promise<void> => {
      try {
        const res = await fetch('http://localhost:3001/api/engine/status');
        if (!res.ok) {
          throw new Error(`Bridge returned ${res.status}`);
        }

        if (!cancelled) {
          const data = await res.json();
          failureCount = 0;
          setEngineRunning(Boolean(data.running));
          setEngineError(null);
          schedule(3000);
        }
      } catch {
        if (!cancelled) {
          failureCount += 1;
          setEngineRunning(false);
          setEngineError((prev) => prev ?? 'Bridge not running. Start it with: npm run bridge');
          schedule(Math.min(30000, 5000 * failureCount));
        }
      }
    };

    void checkStatus();
    return () => {
      cancelled = true;
      if (handle !== null) {
        window.clearTimeout(handle);
      }
    };
  }, []);

  useEffect(() => {
    if (mode !== 'live' || isSavingControl) {
      return;
    }

    if (worldState.control_status === 'error') {
      setErrorMessage(worldState.control_error ?? 'Operator control failed.');
      return;
    }
  }, [
    isSavingControl,
    mode,
    worldState.control_error,
    worldState.control_status,
  ]);

  // Visual phase/tick are now self-driven in the requestAnimationFrame loop
  // (see render() in the canvas useEffect). We only sync entity data from
  // Supabase, not the visual clock, to eliminate DB usage from animations.
  useEffect(() => {
    // Intentionally no-op: phaseRef/tickRef are client-side only now.
  }, [worldState.phase, worldState.tick]);

  useEffect(() => {
    routeNodesRef.current = visibleRouteNodes;
  }, [visibleRouteNodes]);

  useEffect(() => {
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);

  useEffect(() => {
    hoveredEntityIdRef.current = hoveredEntityId;
  }, [hoveredEntityId]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    showPlumbingRef.current = showPlumbing;
  }, [showPlumbing]);

  useEffect(() => {
    weatherRef.current = worldState.weather ?? 'clear';
  }, [worldState.weather]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const nextLogs: LogEntry[] = [];

    if (previousTickRef.current === worldState.tick) {
      return;
    }

    if (previousStatusRef.current !== worldState.status) {
      nextLogs.push(createLogEntry('state', worldState.tick, `STATE -> ${worldState.status.toUpperCase()}`));
      previousStatusRef.current = worldState.status;
    }

    if (controlStatus !== previousControlStatusRef.current) {
      nextLogs.push(
        createLogEntry(
          controlStatus === 'error' ? 'alert' : 'state',
          worldState.tick,
          `CONTROL -> ${formatControlStatus(controlStatus).toUpperCase()}${worldState.control_error ? ` (${worldState.control_error})` : ''}`,
        ),
      );
      previousControlStatusRef.current = controlStatus;
    }

    const activeRepoPath = worldState.active_repo_path ?? null;
    if (activeRepoPath !== previousActiveRepoRef.current && activeRepoPath) {
      nextLogs.push(
        createLogEntry(
          'state',
          worldState.tick,
          `REPO -> ${worldState.active_repo_name ?? activeRepoPath}`,
        ),
      );
      previousActiveRepoRef.current = activeRepoPath;
    }

    const directive = worldState.operator_prompt?.trim() ? worldState.operator_prompt.trim() : null;
    if (directive !== previousDirectiveRef.current) {
      nextLogs.push(
        createLogEntry(
          'state',
          worldState.tick,
          directive
            ? `DIRECTIVE -> ${summarizeDirective(directive, 84)}`
            : 'DIRECTIVE -> cleared',
        ),
      );
      previousDirectiveRef.current = directive;
    }

    if (operatorTargetPath !== previousTargetPathRef.current && operatorTargetPath) {
      nextLogs.push(
        createLogEntry(
          'state',
          worldState.tick,
          `TARGET -> ${(operatorAction ?? 'maintain').toUpperCase()} ${operatorTargetPath}`,
        ),
      );
      previousTargetPathRef.current = operatorTargetPath;
    }

    if (operatorTargetPath === null) {
      previousTargetPathRef.current = null;
    }

    const agentPosition = primaryAgent ? `${primaryAgent.x},${primaryAgent.y}` : null;
    if (agentPosition !== previousAgentPositionRef.current && primaryAgent) {
      nextLogs.push(
        createLogEntry(
          'move',
          worldState.tick,
          `MOVE -> ${getAgentRoleLabel(primaryRole).toLowerCase()} drifted to (${primaryAgent.x},${primaryAgent.y})`,
        ),
      );
      previousAgentPositionRef.current = agentPosition;
    }

    const focusPath = activeStructure?.path ?? null;
    if (focusPath && focusPath !== previousFocusPathRef.current) {
      nextLogs.push(
        createLogEntry(
          'move',
          worldState.tick,
          `ROUTE LOCK -> ${buildBreadcrumb(activeStructure)} [${getNodeStateLabel(activeStructureState ?? 'stable')}]`,
        ),
      );
      previousFocusPathRef.current = focusPath;
    }

    const loadedPath = loadedFile?.path ?? null;
    if (loadedPath && loadedPath !== previousLoadedPathRef.current) {
      nextLogs.push(createLogEntry('read', worldState.tick, `READ -> spatial context loaded for ${loadedPath}`));

      if (loadedFileState !== 'asymmetry') {
        nextLogs.push(createLogEntry('verify', worldState.tick, `VERIFY -> ${loadedPath} entered symmetry phase`));
      }

      previousLoadedPathRef.current = loadedPath;
    }

    const criticalMassSignature = criticalMassNodes.map((entity) => entity.path ?? entity.id).sort().join('|');
    if (criticalMassSignature.length > 0 && criticalMassSignature !== previousCriticalMassSignatureRef.current) {
      nextLogs.push(
        createLogEntry('alert', worldState.tick, `FISSION -> ${criticalMassNodes.length} node(s) exceeded chiral mass 8`),
      );
      previousCriticalMassSignatureRef.current = criticalMassSignature;
    }

    const asymmetrySignature = asymmetryNodes.map((entity) => entity.path ?? entity.id).sort().join('|');
    if (asymmetrySignature.length > 0 && asymmetrySignature !== previousAsymmetrySignatureRef.current) {
      nextLogs.push(
        createLogEntry('alert', worldState.tick, `ASYMMETRY -> critic attention required on ${asymmetryNodes.length} node(s)`),
      );
      previousAsymmetrySignatureRef.current = asymmetrySignature;
    }

    if (asymmetrySignature.length === 0) {
      previousAsymmetrySignatureRef.current = '';
    }

    if (criticalMassSignature.length === 0) {
      previousCriticalMassSignatureRef.current = '';
    }

    const agentActivities = worldState.agent_activities ?? [];
    const previousActivities = previousAgentActivitiesRef.current;
    for (const activity of agentActivities) {
      const previous = previousActivities[activity.agent_id];
      if (!previous || previous.status !== activity.status || previous.target_path !== activity.target_path) {
        const roleLabel = getAgentRoleLabel(activity.agent_role).toLowerCase();
        const target = activity.target_path ?? 'lattice';
        switch (activity.status) {
          case 'thinking':
            nextLogs.push(createLogEntry('decision', worldState.tick, `THINK -> ${roleLabel} requesting decision for ${target}`));
            break;
          case 'walking':
            nextLogs.push(createLogEntry('decision', worldState.tick, `WALK -> ${roleLabel} moving toward ${target}`));
            break;
          case 'reading':
            nextLogs.push(createLogEntry('decision', worldState.tick, `READ -> ${roleLabel} locked on ${target}`));
            break;
          case 'editing':
            nextLogs.push(createLogEntry('decision', worldState.tick, `EDIT -> ${roleLabel} applying changes to ${target}`));
            break;
          case 'idle':
            nextLogs.push(createLogEntry('decision', worldState.tick, `IDLE -> ${roleLabel} dormant`));
            break;
        }
      }
    }
    previousAgentActivitiesRef.current = Object.fromEntries(agentActivities.map((a) => [a.agent_id, a]));

    // Accumulate agent decision history (up to 20 per agent)
    const history = agentDecisionHistoryRef.current;
    for (const activity of agentActivities) {
      const list = history.get(activity.agent_id) ?? [];
      const isDuplicate = list.length > 0 && list[list.length - 1]!.tick === activity.tick && list[list.length - 1]!.status === activity.status;
      if (!isDuplicate) {
        list.push(activity);
        if (list.length > 20) {
          list.shift();
        }
        history.set(activity.agent_id, list);
      }
    }

    if (nextLogs.length > 0) {
      setLogEntries((previous) => [...previous, ...nextLogs].slice(-90));
    }

    previousTickRef.current = worldState.tick;
  }, [
    activeStructure,
    activeStructureState,
    asymmetryNodes,
    controlStatus,
    criticalMassNodes,
    loadedFile,
    loadedFileState,
    operatorAction,
    operatorTargetPath,
    primaryAgent,
    primaryRole,
    worldState.control_error,
    worldState.active_repo_name,
    worldState.active_repo_path,
    worldState.operator_prompt,
    worldState.status,
    worldState.tick,
    worldState.agent_activities,
  ]);

  useEffect(() => {
    const node = latticeRef.current;
    if (!node) {
      return undefined;
    }

    const updateViewport = (): void => {
      const bounds = node.getBoundingClientRect();
      setViewport({
        height: Math.max(480, Math.floor(bounds.height)),
        width: Math.max(480, Math.floor(bounds.width)),
      });
    };

    updateViewport();

    const observer = new ResizeObserver(() => {
      updateViewport();
    });

    observer.observe(node);
    window.addEventListener('resize', updateViewport);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const DRAG_THRESHOLD = 4;
    type DragMode = 'idle' | 'pending-select' | 'pan';

    let dragMode: DragMode = 'idle';
    let dragStartX = 0;
    let dragStartY = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const markInteracting = (): void => {
      isInteractingRef.current = true;

      if (interactionSettledTimeoutRef.current !== null) {
        window.clearTimeout(interactionSettledTimeoutRef.current);
      }

      interactionSettledTimeoutRef.current = window.setTimeout(() => {
        isInteractingRef.current = false;
        interactionSettledTimeoutRef.current = null;
      }, 140);
    };

    const setCameraImmediate = (updater: (previous: Camera) => Camera): void => {
      const nextCamera = updater(cameraRef.current);
      cameraRef.current = nextCamera;

      if (cameraCommitFrameRef.current !== null) {
        return;
      }

      cameraCommitFrameRef.current = window.requestAnimationFrame(() => {
        cameraCommitFrameRef.current = null;
        setCamera(cameraRef.current);
      });
    };

    const resolveCanvasPoint = (event: MouseEvent): { sx: number; sy: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        sx: event.clientX - rect.left,
        sy: event.clientY - rect.top,
      };
    };

    const findNearestVisibleStructure = (
      sx: number,
      sy: number,
      layout: IsoLayout,
      thresholdMultiplier: number,
    ): Entity | null => {
      const threshold = layout.tileHeight * thresholdMultiplier;
      let nearest: Entity | null = null;
      let nearestDistanceSq = threshold * threshold;

      for (const entity of visibleStructureListRef.current) {
        const center = toScreen(entity.x + 0.5, entity.y + 0.5, (entity.z ?? 0) + 0.5, layout);
        const dx = center.sx - sx;
        const dy = center.sy - sy;
        const distanceSq = (dx * dx) + (dy * dy);

        if (distanceSq < nearestDistanceSq) {
          nearest = entity;
          nearestDistanceSq = distanceSq;
        }
      }

      return nearest;
    };

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      markInteracting();
      const { sx: mouseX, sy: mouseY } = resolveCanvasPoint(event);

      setCameraImmediate((prev) => {
        const oldLayout = createIsoLayout(viewport.width, viewport.height, prev);
        const anchor = fromScreen(mouseX, mouseY, oldLayout);
        const newZoom = Math.max(0.3, Math.min(4, prev.zoom * (event.deltaY < 0 ? 1.12 : 0.88)));
        const next: Camera = { ...prev, zoom: newZoom };
        const newLayout = createIsoLayout(viewport.width, viewport.height, next);
        const anchorAfter = toScreen(anchor.x, anchor.y, 0, newLayout);
        return {
          ...next,
          panX: next.panX + (mouseX - anchorAfter.sx),
          panY: next.panY + (mouseY - anchorAfter.sy),
        };
      });
    };

    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button === 0) {
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;

        if (event.shiftKey) {
          dragMode = 'pan';
          markInteracting();
          canvas.style.cursor = 'grabbing';
          return;
        }

        dragMode = 'pending-select';
      } else if (event.button === 1) {
        event.preventDefault();
        dragMode = 'pan';
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        markInteracting();
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent): void => {
      if (dragMode === 'pending-select') {
        const dx = event.clientX - dragStartX;
        const dy = event.clientY - dragStartY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          dragMode = 'pan';
          lastPointerX = event.clientX;
          lastPointerY = event.clientY;
          canvas.style.cursor = 'grabbing';
        }
      }

      if (dragMode === 'pan') {
        const dx = event.clientX - lastPointerX;
        const dy = event.clientY - lastPointerY;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        markInteracting();
        setCameraImmediate((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
        return;
      }

      const { sx, sy } = resolveCanvasPoint(event);
      const layout = createIsoLayout(viewport.width, viewport.height, cameraRef.current);
      const nearest = findNearestVisibleStructure(sx, sy, layout, 1.2);
      const nextHoveredId = nearest?.id ?? null;
      if (hoveredEntityIdRef.current !== nextHoveredId) {
        hoveredEntityIdRef.current = nextHoveredId;
        setHoveredEntityId(nextHoveredId);
      }
      canvas.style.cursor = nearest ? 'pointer' : 'default';
    };

    const handleMouseUp = (event: MouseEvent): void => {
      if (dragMode === 'pan') {
        dragMode = 'idle';
        canvas.style.cursor = 'default';
        return;
      }

      if (dragMode === 'pending-select' && event.button === 0) {
        dragMode = 'idle';
        const { sx, sy } = resolveCanvasPoint(event);
        const layout = createIsoLayout(viewport.width, viewport.height, cameraRef.current);
        const nearest = findNearestVisibleStructure(sx, sy, layout, 1.4);
        setSelectedEntity(nearest);
        canvas.style.cursor = nearest ? 'pointer' : 'default';
        return;
      }

      dragMode = 'idle';
      canvas.style.cursor = 'default';
    };

    const handleDoubleClick = (event: MouseEvent): void => {
      const { sx, sy } = resolveCanvasPoint(event);
      const layout = createIsoLayout(viewport.width, viewport.height, cameraRef.current);
      const nearest = findNearestVisibleStructure(sx, sy, layout, 1.4);
      
      if (!nearest) return;

      // If already zoomed in on this entity, zoom out
      if (cameraRef.current.zoom > 2.0 && selectedEntityRef.current?.id === nearest.id) {
         setSelectedEntity(null);
         startCameraAnimation(DEFAULT_CAMERA, 330); // ~20 frames at 60fps
         return;
      }
      
      // Select the entity
      setSelectedEntity(nearest);
      
      // Calculate target camera to zoom in on the building
      const targetZoom = 2.5;
      const entityScreen = toScreen(nearest.x + 0.5, nearest.y + 0.5, 0, layout);
      
      // Calculate pan to center the building
      const targetPanX = viewport.width / 2 - entityScreen.sx * targetZoom;
      const targetPanY = viewport.height / 2 - entityScreen.sy * targetZoom;
      
      const targetCamera: Camera = {
        panX: targetPanX,
        panY: targetPanY,
        rotation: cameraRef.current.rotation,
        zoom: targetZoom,
      };
      
      startCameraAnimation(targetCamera, 330); // ~20 frames at 60fps
      
    };

    const startCameraAnimation = (targetCamera: Camera, duration: number) => {
      const startCamera = { ...cameraRef.current };
      const startTime = performance.now();
      markInteracting();
      
      const animate = (time: number): void => {
        const elapsed = time - startTime;
        const t = Math.min(1, elapsed / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        
        const nextCamera: Camera = {
          panX: startCamera.panX + (targetCamera.panX - startCamera.panX) * ease,
          panY: startCamera.panY + (targetCamera.panY - startCamera.panY) * ease,
          rotation: startCamera.rotation,
          zoom: startCamera.zoom + (targetCamera.zoom - startCamera.zoom) * ease,
        };
        
        setCameraImmediate(() => nextCamera);
        
        if (t < 1) {
          zoomAnimationRef.current.frame = requestAnimationFrame(animate);
        } else {
          zoomAnimationRef.current.frame = null;
          zoomAnimationRef.current.target = null;
        }
      };
      
      if (zoomAnimationRef.current.frame) cancelAnimationFrame(zoomAnimationRef.current.frame);
      zoomAnimationRef.current.target = targetCamera;
      zoomAnimationRef.current.frame = requestAnimationFrame(animate);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cameraRef.current.zoom > 2.0) {
         setSelectedEntity(null);
         startCameraAnimation(DEFAULT_CAMERA, 330);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    const zoomAnimation = zoomAnimationRef.current;

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      const frame = zoomAnimation.frame;
      if (frame) {
        cancelAnimationFrame(frame);
      }
      if (cameraCommitFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraCommitFrameRef.current);
        cameraCommitFrameRef.current = null;
      }
      if (interactionSettledTimeoutRef.current !== null) {
        window.clearTimeout(interactionSettledTimeoutRef.current);
        interactionSettledTimeoutRef.current = null;
      }
      isInteractingRef.current = false;
    };
  }, [viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    canvas.width = Math.floor(viewport.width * devicePixelRatio);
    canvas.height = Math.floor(viewport.height * devicePixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.imageSmoothingEnabled = false;

    const render = (): void => {
      // Self-drive the visual phase/tick at 60fps independent of Supabase sync rate.
      // Original engine: 10 ticks/sec (100ms interval), phase period = 60 ticks = 6 sec.
      // At 60fps we scale by 10/60 = 1/6 per frame to preserve the same cycle timing.
      phaseRef.current += 2 / 60;
      tickRef.current += 2 / 60;

      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      const layout = createIsoLayout(viewport.width, viewport.height, cameraRef.current);
      const currentEntities = visibleEntityListRef.current;
      const currentAgents = currentEntities.filter((entity) => entity.type === 'agent');
      const phase = phaseRef.current;
      const tick = tickRef.current;
      const weather = weatherRef.current;
      const layoutData = cityLayoutRef.current;
      const isInteracting = isInteractingRef.current;

      drawBackdrop(context, viewport, phase, weather);

      // Underground plumbing — import dependency conduits (toggleable)
      if (showPlumbingRef.current) {
        drawTethers(context, currentEntities, layout, phase);
      }

      drawGroundPlane(context, viewport, layout, currentEntities, layoutData, phase);

      // Roads & traffic
      const roadCount = layoutData.roads.length;
      const totalTraffic = layoutData.roads.reduce((s, r) => s + r.trafficDensity, 0);
      spawnCars(trafficRef.current, roadCount, totalTraffic, tick, layoutData.roads, currentEntities);
      updateCars(trafficRef.current, 2 / 60);
      drawRoadsAndTraffic(context, layoutData.roads, trafficRef.current, layout, phase, currentEntities);

      drawTetherRoute(context, routeNodesRef.current, layout, phase);
      drawAgentTethers(
        context,
        currentAgents,
        currentEntities,
        layout,
        displayPointsRef.current,
      );
      drawEntities(
        context,
        viewport,
        currentEntities,
        layout,
        phase,
        tick,
        displayPointsRef.current,
        layoutData,
        selectedEntityRef.current?.id ?? null,
        weather,
      );

      // Overhead power/utility grid
      if (!isInteracting) {
        drawPowerlines(context, currentEntities, layoutData.roads, layout, phase);
      }

      drawFireflies(context, viewport, phase);
      drawWeatherScreenEffects(context, viewport, phase, weather);
      drawAtmosphericOverlay(context, viewport, weather);

      frameRef.current = window.requestAnimationFrame(render);
    };

    frameRef.current = window.requestAnimationFrame(render);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [viewport]);

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      setErrorMessage(
        'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. Rendering preview lattice until realtime credentials are configured.',
      );
      return undefined;
    }

    const supabase = createBrowserSupabaseClient(url, anonKey);
    supabaseRef.current = supabase;
    let cancelled = false;
    let channelHealthy = false;
    let pollHandle: number | null = null;
    let snapshotInFlight = false;

    const scheduleSnapshot = (delayMs: number): void => {
      if (cancelled) {
        return;
      }

      if (pollHandle !== null) {
        window.clearTimeout(pollHandle);
      }

      pollHandle = window.setTimeout(() => {
        void loadSnapshot(false).catch(() => {
          // A later retry is scheduled in loadSnapshot.
        });
      }, delayMs);
    };

    const flushEntityState = (): void => {
      if (flushFrameRef.current !== null) {
        return;
      }

      flushFrameRef.current = window.requestAnimationFrame(() => {
        flushFrameRef.current = null;
        const nextList = createEntityList(entityMapRef.current);
        entityListRef.current = nextList;
        setEntities(nextList);
      });
    };

    const loadSnapshot = async (allowPreviewFallback = true): Promise<void> => {
      if (snapshotInFlight || cancelled) {
        return;
      }

      snapshotInFlight = true;

      try {
      const [
        { data: entityRows, error: entityError },
        { data: worldRows, error: worldError },
        { data: controlRow, error: controlError },
      ] =
        await Promise.all([
          supabase.from('entities').select('*'),
          supabase.from('world_state').select('*').limit(1),
          supabase.from('operator_controls').select('*').eq('id', DEFAULT_OPERATOR_CONTROL.id).maybeSingle(),
        ]);

      if (entityError) {
        throw entityError;
      }

      if (worldError) {
        throw worldError;
      }

      if (controlError) {
        throw controlError;
      }

      const parsedEntities = (entityRows ?? [])
        .map((row) => EntitySchema.safeParse(row))
        .flatMap((result) => (result.success ? [result.data] : []));

      if (cancelled) {
        return;
      }

      entityMapRef.current = entityMapFromList(parsedEntities);
      entityListRef.current = createEntityList(entityMapRef.current);
      setEntities(entityListRef.current);

      const worldRow = worldRows?.[0];
      if (worldRow) {
        const parsedWorldState = WorldStateSchema.safeParse(worldRow);
        if (parsedWorldState.success) {
          setWorldState(parsedWorldState.data);
        }
      }

      if (controlRow) {
        const parsedControl = OperatorControlSchema.safeParse(controlRow);
        if (parsedControl.success) {
          setOperatorControl(parsedControl.data);

          if (!controlDirtyRef.current) {
            setRepoInput(parsedControl.data.repo_path);
            setDirectiveInput(parsedControl.data.operator_prompt);
          }
        }
      }

      setMode('live');
      setErrorMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Unknown Supabase load failure';
        if (allowPreviewFallback) {
          setErrorMessage(message);
          setMode('preview');
        }
        throw error;
      } finally {
        snapshotInFlight = false;
        if (channelHealthy) {
          if (pollHandle !== null) {
            window.clearTimeout(pollHandle);
            pollHandle = null;
          }
        } else {
          scheduleSnapshot(5000);
        }
      }
    };

    void loadSnapshot().catch((error: unknown) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown Supabase load failure';
      setErrorMessage(message);
      setMode('preview');
    });

    const channel = supabase
      .channel('lux-protocol')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entities' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deleted = EntitySchema.pick({ id: true }).safeParse(payload.old);
          if (deleted.success) {
            entityMapRef.current.delete(deleted.data.id);
          }
        } else {
          const parsedEntity = EntitySchema.safeParse(payload.new);
          if (parsedEntity.success) {
            entityMapRef.current.set(parsedEntity.data.id, parsedEntity.data);
          }
        }

        flushEntityState();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'world_state' }, (payload) => {
        if (payload.eventType !== 'DELETE') {
          const parsedWorldState = WorldStateSchema.safeParse(payload.new);
          if (parsedWorldState.success) {
            setWorldState(parsedWorldState.data);
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'operator_controls' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          return;
        }

        const parsedControl = OperatorControlSchema.safeParse(payload.new);
        if (!parsedControl.success) {
          return;
        }

        setOperatorControl(parsedControl.data);

        if (!controlDirtyRef.current) {
          setRepoInput(parsedControl.data.repo_path);
          setDirectiveInput(parsedControl.data.operator_prompt);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channelHealthy = true;
          setMode('live');
          if (pollHandle !== null) {
            window.clearTimeout(pollHandle);
            pollHandle = null;
          }
        }

        if (status === 'CHANNEL_ERROR') {
          channelHealthy = false;
          setErrorMessage('Supabase realtime channel failed; showing the last confirmed lattice snapshot.');
          scheduleSnapshot(2000);
        }
      });

    return () => {
      cancelled = true;
      supabaseRef.current = null;
      if (pollHandle !== null) {
        window.clearTimeout(pollHandle);
      }

      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <main className="lux-shell">
      <QueenHUD
        cycle={worldState.queen_cycle ?? 0}
        alarm={worldState.queen_alarm ?? 0}
        urgency={worldState.queen_urgency ?? 0}
      />
           {selectedEntity && inspectPopupPosition ? (
        <div className="floating-inspector" style={{ left: inspectPopupPosition.left, top: inspectPopupPosition.top }}>
          <div className="floating-inspector-header">
            <span className="floating-inspector-title">{selectedEntity.name ?? 'Unnamed Node'}</span>
            <button className="floating-inspector-close" onClick={() => setSelectedEntity(null)} type="button">
              <X size={14} />
            </button>
          </div>
          <div className="floating-inspector-body">
            <div className="floating-inspector-meta">
              <span>{selectedEntity.type}</span>
              <span>{selectedEntity.descriptor ?? 'No descriptor'}</span>
              <span>Mass {selectedEntity.mass}</span>
              <span>Chiral {computeChiralMass(selectedEntity)}</span>
              <span>{selectedEntity.git_status ?? 'clean'}</span>
              <span>{getNodeStateLabel(selectedEntity.node_state ?? 'stable')}</span>
            </div>
            {selectedEntity.type === 'agent' ? (
              <div className="floating-inspector-decisions">
                <span className="decisions-title">Recent Decisions</span>
                {(agentDecisionHistoryRef.current.get(selectedEntity.id) ?? []).length > 0 ? (
                  (agentDecisionHistoryRef.current.get(selectedEntity.id) ?? []).slice(-10).map((activity, index) => (
                    <div className="decision-row" key={`${activity.agent_id}-${activity.tick}-${index}`}>
                      <span className="decision-tick">T{activity.tick}</span>
                      <span className={`decision-status decision-${activity.status}`}>{activity.status}</span>
                      <span className="decision-action">{activity.action ?? '—'}</span>
                      <span className="decision-target">{activity.target_path ?? '—'}</span>
                      {activity.latency_ms != null ? <span className="decision-latency">{activity.latency_ms}ms</span> : null}
                    </div>
                  ))
                ) : (
                  <p className="panel-placeholder">No decisions recorded yet.</p>
                )}
              </div>
            ) : null}
            {selectedEntity.path ? (
              <div className="floating-inspector-actions">
                <button onClick={() => { void dispatchFileAction('read', selectedEntity.path ?? ''); }} type="button">Send Architect</button>
                <button onClick={() => { void dispatchFileAction('repair', selectedEntity.path ?? ''); }} type="button">Repair File</button>
                <button onClick={() => { void dispatchFileAction('explain', selectedEntity.path ?? ''); }} type="button">Explain</button>
              </div>
            ) : null}
            {selectedEntity.content_preview || selectedEntity.content ? (
              <CodeSyntaxPreview code={selectedEntity.content ?? selectedEntity.content_preview ?? ''} />
            ) : (
              <div className="code-frame">
                <div className="code-line">
                  <span className="code-gutter">—</span>
                  <span className="code-content">{selectedEntity.is_binary ? 'Binary asset — hash-only transfer.' : 'No content preview available.'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {commandPaletteOpen ? (
        <>
          <div className="command-palette-backdrop" onClick={() => setCommandPaletteOpen(false)} />
          <div className="command-palette">
            <div className="command-palette-header">
              <span className="command-palette-title">Command Palette</span>
              <button className="floating-inspector-close" onClick={() => setCommandPaletteOpen(false)} type="button">
                <X size={14} />
              </button>
            </div>
            <form className="command-palette-body" onSubmit={handleControlSubmit}>
              <div className="command-palette-section">
                <span className="command-palette-label">Repository Path</span>
                <input
                  className="command-palette-input"
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="C:/Users/... or repo URL"
                  type="text"
                  value={repoInput}
                />
              </div>
              <div className="command-palette-section">
                <span className="command-palette-label">Operator Prompt</span>
                <textarea
                  className="command-palette-textarea"
                  onChange={(e) => setDirectiveInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void handleControlSubmit(e as unknown as FormEvent<HTMLFormElement>);
                    }
                  }}
                  placeholder="Enter directive... (Ctrl+Enter to submit)"
                  value={directiveInput}
                />
              </div>
              <div className="command-palette-actions">
                <button disabled={engineLoading} onClick={() => { void handleToggleEngine(); }} type="button">
                  {engineLoading ? 'Working...' : engineRunning ? 'Stop Engine' : 'Start Engine'}
                </button>
                <button disabled={isSavingControl} type="submit">
                  Commit Control
                </button>
                <button onClick={() => setShowPlumbing((prev) => !prev)} type="button">
                  {showPlumbing ? 'Hide Plumbing' : 'Show Plumbing'}
                </button>
                <button onClick={() => setShowAgentThoughts((prev) => !prev)} type="button">
                  {showAgentThoughts ? 'Hide Agent Thoughts' : 'Show Agent Thoughts'}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}

      <button className="fab" onClick={() => setCommandPaletteOpen(true)} title="Command Palette ( / )" type="button">
        <Command size={18} />
      </button>

      <div className="kbd-hint">Press <kbd>/</kbd> for commands</div>


      <section className="lux-lattice" ref={latticeRef}>
        <canvas className="lux-canvas" ref={canvasRef} />

        <AdvisorCouncil city={cityCouncil} onAction={handleAdvisorAction} />

        <div className="hud-minibar">
          <span className="hud-minibar-item">
            T{worldState.tick}:{worldState.phase}
          </span>
          <span className="hud-minibar-item">
            {worldState.status}
          </span>
          <span className="hud-minibar-item">
            {primaryAgent ? `(${primaryAgent.x},${primaryAgent.y})` : 'offline'}
          </span>
          <span className="hud-minibar-item">
            {getAgentRoleLabel(primaryRole).toLowerCase()}
          </span>
          <span className="hud-minibar-item">
            {formatControlStatus(controlStatus)}
          </span>
        </div>

        <div className="zoom-controls">
          <button
            className="zoom-button"
            onClick={() => setCamera((prev) => ({ ...prev, zoom: Math.min(4, prev.zoom * 1.25) }))}
            title="Zoom in"
            type="button"
          >
            +
          </button>
          <button
            className="zoom-button"
            onClick={() => setCamera((prev) => ({ ...prev, zoom: Math.max(0.3, prev.zoom / 1.25) }))}
            title="Zoom out"
            type="button"
          >
            −
          </button>
          <button
            className="zoom-button"
            onClick={() => setCamera({ ...DEFAULT_CAMERA })}
            title="Reset view"
            type="button"
          >
            ⌂
          </button>
          <button
            className={`zoom-button ${showPlumbing ? 'is-active' : ''}`}
            onClick={() => setShowPlumbing((prev) => !prev)}
            title={showPlumbing ? 'Hide plumbing' : 'Show plumbing'}
            type="button"
          >
            <GitBranch size={14} />
          </button>
          <span className="zoom-level">{Math.round(camera.zoom * 100)}%</span>
          <span className="view-hint">Drag pan · Shift drag pan</span>
        </div>

        {errorMessage ? <div className="hud-alert">{errorMessage}</div> : null}
      </section>

           <div className="bottom-status-bar">
        <div className="status-bar-left">
          <span className="status-bar-item">{activeRepositoryName}</span>
          <span className={`status-bar-item ${engineRunning ? 'is-live' : 'is-error'}`}>
            {engineRunning ? 'Engine On' : 'Engine Off'}
          </span>
          <span className="status-bar-item">T{worldState.tick}:{worldState.phase}</span>
        </div>
        <div className="status-bar-right">
          <span className="status-bar-item">Queue {worldState.queue_depth ?? 0}</span>
          <span className="status-bar-item">{worldState.weather ?? 'clear'}</span>
          <span className="status-bar-item">{formatControlStatus(controlStatus)}</span>
          <button className="status-bar-action" onClick={() => setCommandPaletteOpen(true)} type="button">
            Open Console
          </button>
        </div>
      </div>

      <div
        className={`floating-log ${logExpanded ? 'is-expanded' : ''}`}
        onMouseEnter={() => setLogExpanded(true)}
        onMouseLeave={() => setLogExpanded(false)}
      >
        <div className="floating-log-header">
          <span className="floating-log-title">Cognition Log</span>
          <span className="floating-log-count">{logEntries.length}</span>
        </div>
        <div className="floating-log-body">
          {logEntries.length > 0 ? (
            logEntries.slice(-15).map((entry) => (
              <div className={`log-entry log-${entry.kind}`} key={entry.id}>
                <div className="log-meta">
                  <span>{entry.timestamp}</span>
                  <span>T+{entry.tick}</span>
                </div>
                <div className="log-message">{entry.message}</div>
              </div>
            ))
          ) : (
            <p className="panel-placeholder">Awaiting first tick from the lattice.</p>
          )}
        </div>
      </div>

      {showAgentThoughts ? (
        <div className="floating-thoughts">
          <div className="floating-thoughts-header">
            <span className="floating-thoughts-title">Agent Thoughts</span>
            <span className="floating-thoughts-count">
              {Array.from(agentDecisionHistoryRef.current.values()).reduce((sum, list) => sum + list.length, 0)}
            </span>
          </div>
          <div className="floating-thoughts-body">
            {(() => {
              const allDecisions: Array<AgentActivity & { agentName: string }> = [];
              for (const [agentId, list] of agentDecisionHistoryRef.current.entries()) {
                const agent = entityMapRef.current.get(agentId);
                const name = agent?.name ?? agentId;
                for (const d of list) {
                  allDecisions.push({ ...d, agentName: name });
                }
              }
              allDecisions.sort((a, b) => b.tick - a.tick);
              if (allDecisions.length === 0) {
                return <p className="panel-placeholder">No agent decisions yet.</p>;
              }
              return allDecisions.slice(0, 20).map((activity, index) => (
                <div className="thought-row" key={`${activity.agent_id}-${activity.tick}-${index}`}>
                  <span className="thought-agent">{activity.agentName}</span>
                  <span className="thought-tick">T{activity.tick}</span>
                  <span className={`thought-status thought-${activity.status}`}>{activity.status}</span>
                  <span className="thought-action">{activity.action ?? '—'}</span>
                  {activity.latency_ms != null ? <span className="thought-latency">{activity.latency_ms}ms</span> : null}
                </div>
              ));
            })()}
          </div>
        </div>
      ) : null}

    </main>
  );
}

export default App;
