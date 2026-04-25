import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FileCode, Folder, GitBranch, PanelLeft, PanelRight, X } from 'lucide-react';

import {
  HIVEMIND_LAWS,
  computeChiralMass,
  getAgentRole,
  getAgentRoleLabel,
  getNodeStateLabel,
  isCriticalMass,
  type HivemindAgentRole,
  type HivemindNodeState,
} from '../src/hivemind';
import { createInitialEntities, DEFAULT_SEED, WORLD_STATE_ID, manhattanDistance } from '../src/seed';
import { isStructureEntity } from '../src/mass-mapper';
import { createBrowserSupabaseClient } from '../src/supabase';
import {
  EntitySchema,
  OperatorControlSchema,
  WorldStateSchema,
  type AgentActivity,
  type Entity,
  type OperatorControl,
  type TaskValidationResult,
  type WorldState,
  type Task,
} from '../src/types';
import { computeLineDiff, type DiffLine } from './diff';
import { buildActivePathSet, buildGitTree, type GitTreeNode } from './git-tree';
import { CodeSyntaxPreview } from './highlight';
import { QueenHUD } from './QueenHUD';
import { drawBuilding } from './simcity-building-render';
import { getUnifiedFootprint as getFileFootprint, getUnifiedHeight as getPrismHeight } from './city-layout';
import { drawTethers } from './tether-render';
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

interface WorkforceStatus {
  agents: Entity[];
  label: string;
  role: HivemindAgentRole;
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
};

const DEFAULT_OPERATOR_CONTROL: OperatorControl = {
  id: 'lux-control',
  repo_path: '',
  operator_prompt: '',
  updated_at: null,
};

const WORKFORCE_ROLES: readonly HivemindAgentRole[] = ['visionary', 'architect', 'critic'];
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

// getFileFootprint now imported from ./file-colors

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

function drawBackdrop(context: CanvasRenderingContext2D, viewport: Viewport, phase: number): void {
  const daylight = 0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2));
  const night = 1 - daylight;
  const background = context.createLinearGradient(0, 0, 0, viewport.height);
  background.addColorStop(0, `rgba(${Math.round(22 + (76 * daylight))}, ${Math.round(34 + (116 * daylight))}, ${Math.round(64 + (129 * daylight))}, 1)`);
  background.addColorStop(0.55, `rgba(${Math.round(18 + (87 * daylight))}, ${Math.round(28 + (112 * daylight))}, ${Math.round(46 + (96 * daylight))}, 1)`);
  background.addColorStop(1, `rgba(${Math.round(10 + (58 * daylight))}, ${Math.round(16 + (73 * daylight))}, ${Math.round(24 + (51 * daylight))}, 1)`);
  context.fillStyle = background;
  context.fillRect(0, 0, viewport.width, viewport.height);

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
    for (let index = 0; index < 24; index += 1) {
      const x = (viewport.width * (((index * 37) % 100) / 100));
      const y = 20 + (((index * 53) % 120));
      context.fillRect(x, y, 1.5, 1.5);
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
): Array<{ sx: number; sy: number }> {
  return [
    toScreen(x, y, z, layout),
    toScreen(x + width, y, z, layout),
    toScreen(x + width, y + depth, z, layout),
    toScreen(x, y + depth, z, layout),
  ];
}

function tracePolygonPath(
  context: CanvasRenderingContext2D,
  points: Array<{ sx: number; sy: number }>,
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

function drawHoverHighlight(
  context: CanvasRenderingContext2D,
  entity: Entity,
  layout: IsoLayout,
  displayPoints: Record<string, DisplayPoint>,
): void {
  const display = getInterpolatedPoint(entity, displayPoints);
  const footprint = getFileFootprint(entity);
  const z = (entity.z ?? 0) + 0.04;
  const margin = 0.08;
  const parcel = getFootprintPolygon(
    display.x - margin,
    display.y - margin,
    footprint.width + (margin * 2),
    footprint.depth + (margin * 2),
    z,
    layout,
  );
  const plaque = toScreen(display.x + (footprint.width * 0.5), display.y + footprint.depth + 0.14, z, layout);

  context.save();
  tracePolygonPath(context, parcel);
  context.fillStyle = 'rgba(92, 171, 219, 0.12)';
  context.fill();
  context.strokeStyle = 'rgba(186, 236, 255, 0.82)';
  context.lineWidth = 1.5;
  context.setLineDash([7, 4]);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = 'rgba(17, 40, 62, 0.92)';
  context.beginPath();
  context.roundRect(plaque.sx - 14, plaque.sy - 8, 28, 12, 4);
  context.fill();
  context.strokeStyle = 'rgba(180, 231, 255, 0.78)';
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = 'rgba(220, 247, 255, 0.9)';
  context.fillRect(plaque.sx - 8, plaque.sy - 1, 16, 2);
  context.restore();
}

function drawSelectionRing(
  context: CanvasRenderingContext2D,
  entity: Entity,
  layout: IsoLayout,
  displayPoints: Record<string, DisplayPoint>,
  phase: number,
): void {
  const display = getInterpolatedPoint(entity, displayPoints);
  const footprint = getFileFootprint(entity);
  const pulse = 0.7 + ((phase % 12) * 0.04);
  const margin = 0.14;
  const z = (entity.z ?? 0) + 0.05;
  const parcel = getFootprintPolygon(
    display.x - margin,
    display.y - margin,
    footprint.width + (margin * 2),
    footprint.depth + (margin * 2),
    z,
    layout,
  );
  const plaque = toScreen(display.x + (footprint.width * 0.5), display.y + footprint.depth + 0.18, z, layout);

  context.save();
  tracePolygonPath(context, parcel);
  context.fillStyle = `rgba(57, 132, 183, ${pulse * 0.16})`;
  context.fill();
  context.strokeStyle = `rgba(132, 234, 255, ${0.72 + (pulse * 0.12)})`;
  context.lineWidth = 2.2;
  context.shadowBlur = 22;
  context.shadowColor = 'rgba(86, 217, 255, 0.55)';
  context.setLineDash([10, 6]);
  context.lineDashOffset = -(phase * 1.8);
  context.stroke();
  context.setLineDash([]);

  context.shadowBlur = 0;
  context.fillStyle = `rgba(198, 244, 255, ${pulse * 0.85})`;
  for (const point of parcel) {
    context.beginPath();
    context.arc(point.sx, point.sy, 2.4, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = 'rgba(18, 42, 56, 0.94)';
  context.beginPath();
  context.roundRect(plaque.sx - 18, plaque.sy - 9, 36, 14, 5);
  context.fill();
  context.strokeStyle = `rgba(132, 234, 255, ${0.72 + (pulse * 0.12)})`;
  context.lineWidth = 1.1;
  context.stroke();

  context.fillStyle = 'rgba(220, 247, 255, 0.9)';
  context.fillRect(plaque.sx - 10, plaque.sy - 1.5, 20, 3);
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

function drawBuildingShadow(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  phase: number
): void {
  const footprint = getFileFootprint(entity);
  const width = footprint.width;
  const depth = footprint.depth;
  
  const daylight = 0.2 + (0.8 * ((Math.sin(((phase / 60) * Math.PI * 2) - (Math.PI / 2)) + 1) / 2));
  const night = 1 - daylight;
  
  const shadowLength = 0.4 + night * 1.5;
  const shadowOffsetIsoX = -shadowLength * 0.3;
  const shadowOffsetIsoY = -shadowLength * 0.3;
  
  const x = display.x + ((1 - width) / 2) + shadowOffsetIsoX;
  const y = display.y + ((1 - depth) / 2) + shadowOffsetIsoY;
  const z = entity.z ?? 0;
  
  const polygon = getFootprintPolygon(x, y, width, depth, z, layout);

  context.save();
  context.globalAlpha = 0.25;
  context.fillStyle = '#0a1520';
  context.beginPath();
  if (polygon[0] && polygon[1] && polygon[2] && polygon[3]) {
    context.moveTo(polygon[0].sx, polygon[0].sy);
    context.lineTo(polygon[1].sx, polygon[1].sy);
    context.lineTo(polygon[2].sx, polygon[2].sy);
    context.lineTo(polygon[3].sx, polygon[3].sy);
  }
  context.closePath();
  context.fill();
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

    const screenPt = toScreen(display.x, display.y, entity.z ?? 0, layout);
    const dist = Math.hypot(screenPt.sx - viewport.width / 2, screenPt.sy - viewport.height / 2);
    const maxDist = Math.hypot(viewport.width, viewport.height) / 2;
    const haze = Math.min(1, Math.max(0, dist / maxDist));

    context.save();
    context.globalAlpha = 1 - (haze * 0.3);

    if (isStructureEntity(entity)) {
      drawBuildingShadow(context, entity, display, layout, phase);
      drawBuilding({
        context,
        entity,
        display,
        layout,
        phase,
        nodeState: entity.node_state ?? 'stable',
      });
      context.restore();
      continue;
    }

    drawBuildingShadow(context, entity, display, layout, phase);
    drawBuilding({
      context,
      entity,
      display,
      layout,
      phase,
      nodeState: 'stable',
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

function formatDuration(value: number | null | undefined): string {
  return value == null ? 'n/a' : `${value}ms`;
}

function formatControlStatus(value: string | null | undefined): string {
  if (!value) {
    return 'idle';
  }

  return value.replace('-', ' ');
}

function formatTaskStatus(status: Task['status']): string {
  const labels: Record<Task['status'], string> = {
    pending: 'Pending',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    awaiting_review: 'Review',
    revision_needed: 'Revision',
    approved: 'Approved',
    done: 'Done',
  };
  return labels[status] ?? status;
}

function formatValidationStatus(status: TaskValidationResult['status']): string {
  const labels: Record<TaskValidationResult['status'], string> = {
    idle: 'Idle',
    running: 'Running',
    clean: 'Clean',
    warnings: 'Warnings',
    errors: 'Errors',
  };
  return labels[status] ?? status;
}

function formatExplanationStatus(value: string | null | undefined): string {
  if (!value) {
    return 'Idle';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatActivityStatus(status: AgentActivity['status']): string {
  const labels: Record<AgentActivity['status'], string> = {
    thinking: 'Thinking',
    walking: 'Walking',
    reading: 'Reading',
    editing: 'Editing',
    idle: 'Idle',
  };
  return labels[status] ?? status;
}

function getActivitySwatchClass(status: AgentActivity['status']): string {
  switch (status) {
    case 'thinking':
      return 'is-thinking';
    case 'walking':
      return 'is-walking';
    case 'reading':
      return 'is-reading';
    case 'editing':
      return 'is-editing';
    case 'idle':
      return 'is-idle';
    default:
      return '';
  }
}

function shouldShowDiff(task: Task): boolean {
  return (
    (task.status === 'awaiting_review' || task.status === 'done') &&
    task.original_content != null &&
    task.completed_content != null
  );
}

function TaskDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="task-diff">
      {lines.map((line, index) => (
        <div className={`diff-line diff-${line.type}`} key={`${line.type}-${index}`}>
          <span className="diff-prefix">
            {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
          </span>
          <span className="diff-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
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

function getCodePreview(entity: Entity | null): string {
  if (!entity) {
    return '';
  }

  if (entity.content) {
    return entity.content;
  }

  if (entity.content_preview) {
    return entity.content_preview;
  }

  if (entity.is_binary) {
    return '// Binary asset detected\n// Spatial ingest uses hash-only transfer.';
  }

  return '// No content preview available for this node.';
}

interface GitTreeItemProps {
  activePathSet: Set<string>;
  depth: number;
  loadedPath: string | null;
  node: GitTreeNode;
  nodeStatesByPath: Map<string, HivemindNodeState>;
}

interface SidebarSectionProps {
  children: ReactNode;
  meta?: string;
  onToggle: () => void;
  open: boolean;
  title: string;
}

type LeftPanelSection =
  | 'overview'
  | 'operator'
  | 'visibility'
  | 'tasks'
  | 'workforce'
  | 'tree'
  | 'context'
  | 'inspect';

type RightPanelSection = 'status' | 'activity' | 'directive' | 'log' | 'legend';

const DEFAULT_LEFT_PANEL_SECTIONS: Record<LeftPanelSection, boolean> = {
  context: true,
  inspect: true,
  operator: true,
  overview: true,
  tasks: true,
  tree: true,
  visibility: true,
  workforce: true,
};

const DEFAULT_RIGHT_PANEL_SECTIONS: Record<RightPanelSection, boolean> = {
  activity: true,
  directive: true,
  legend: true,
  log: true,
  status: true,
};

function GitTreeItem({ activePathSet, depth, loadedPath, node, nodeStatesByPath }: GitTreeItemProps) {
  const active = activePathSet.has(node.path);
  const loaded = loadedPath === node.path;
  const entity = node.entity;
  const nodeState = nodeStatesByPath.get(node.path) ?? 'stable';
  const Icon = node.type === 'directory' ? Folder : FileCode;

  return (
    <div className="git-tree-node">
      <div
        className={['git-tree-row', active ? 'is-active' : '', loaded ? 'is-loaded' : '', `state-${nodeState}`].join(' ')}
        style={{ paddingLeft: `${12 + (depth * 14)}px` }}
      >
        <Icon className="git-tree-icon" size={14} strokeWidth={1.75} />
        <span className="git-tree-label">{node.name}</span>
        <span className={`git-tree-state state-${nodeState}`} />
        {entity && isCriticalMass(entity) ? <span className="git-tree-critical">F</span> : null}
      </div>
      {node.children.map((child) => (
        <GitTreeItem
          activePathSet={activePathSet}
          depth={depth + 1}
          key={child.path}
          loadedPath={loadedPath}
          node={child}
          nodeStatesByPath={nodeStatesByPath}
        />
      ))}
    </div>
  );
}

function SidebarSection({ children, meta, onToggle, open, title }: SidebarSectionProps) {
  return (
    <section className={`sidebar-section ${open ? 'is-open' : 'is-collapsed'}`}>
      <button
        aria-expanded={open}
        className="sidebar-section-toggle"
        onClick={onToggle}
        type="button"
      >
        <span className="sidebar-section-title-wrap">
          <ChevronRight
            className={`sidebar-section-chevron ${open ? 'is-open' : ''}`}
            size={14}
            strokeWidth={1.9}
          />
          <span className="sidebar-section-title">{title}</span>
        </span>
        {meta ? <span className="sidebar-section-meta">{meta}</span> : null}
      </button>
      {open ? <div className="sidebar-section-body">{children}</div> : null}
    </section>
  );
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
): Pick<OperatorControl, 'id' | 'repo_path' | 'operator_prompt'> {
  return {
    id: String(control.id ?? 'lux-control'),
    repo_path: String(control.repo_path ?? ''),
    operator_prompt: String(control.operator_prompt ?? ''),
  };
}

function App() {
  const [entities, setEntities] = useState<Entity[]>(PREVIEW_ENTITIES);
  const [worldState, setWorldState] = useState<WorldState>(PREVIEW_WORLD_STATE);
  const [operatorControl, setOperatorControl] = useState<OperatorControl>(DEFAULT_OPERATOR_CONTROL);
  const [repoInput, setRepoInput] = useState<string>('');
  const [directiveInput, setDirectiveInput] = useState<string>('');
  const [visionaryPromptInput, setVisionaryPromptInput] = useState<string>('');
  const [architectPromptInput, setArchitectPromptInput] = useState<string>('');
  const [criticPromptInput, setCriticPromptInput] = useState<string>('');
  const [editPathInput, setEditPathInput] = useState<string>('');
  const [editContentInput, setEditContentInput] = useState<string>('');
  const [commitMessageInput, setCommitMessageInput] = useState<string>('');
  const [shouldPushInput, setShouldPushInput] = useState<boolean>(false);
  const [controlMessage, setControlMessage] = useState<string>('Enter a repository path and directive, then commit it into the lattice.');
  const [isSavingControl, setIsSavingControl] = useState(false);
  const [mode, setMode] = useState<'preview' | 'live'>('preview');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ height: 720, width: 1280 });
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [contextTab, setContextTab] = useState<'code' | 'explanation'>('code');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [leftPanelSections, setLeftPanelSections] = useState<Record<LeftPanelSection, boolean>>(
    DEFAULT_LEFT_PANEL_SECTIONS,
  );
  const [rightPanelSections, setRightPanelSections] = useState<Record<RightPanelSection, boolean>>(
    DEFAULT_RIGHT_PANEL_SECTIONS,
  );
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [fileFilterQuery, setFileFilterQuery] = useState('');
  const [hiddenFilePaths, setHiddenFilePaths] = useState<string[]>([]);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [showPlumbing, setShowPlumbing] = useState(false);
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

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
  const selectedEntityRef = useRef<Entity | null>(null);
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const showPlumbingRef = useRef(false);
  const inspectPanelRef = useRef<HTMLDivElement | null>(null);
  const zoomAnimationRef = useRef<{ frame: number | null; target: Camera | null }>({ frame: null, target: null });
  const autoHiddenRepoRef = useRef<string | null>(null);

  const agents = entities.filter((entity) => entity.type === 'agent');
  const primaryAgent = agents[0] ?? null;
  const primaryRole = primaryAgent ? (getAgentRole(primaryAgent) ?? 'architect') : 'architect';
  const structureNodes = entities.filter((entity) => isStructureEntity(entity));
  const fileNodes = structureNodes
    .filter((entity) => entity.type === 'file')
    .sort((left, right) => getEntityPath(left).localeCompare(getEntityPath(right)));
  const hiddenFilePathSet = new Set(hiddenFilePaths);
  const visibleStructurePathSet = buildVisibleStructurePathSet(fileNodes, hiddenFilePathSet);
  const visibleStructureNodes = structureNodes.filter((entity) => {
    if (!entity.path) {
      return false;
    }

    return visibleStructurePathSet.has(entity.path);
  });
  const visibleEntities = entities.filter((entity) => {
    if (!isStructureEntity(entity)) {
      return true;
    }

    return entity.path != null && visibleStructurePathSet.has(entity.path);
  });
  const visibleFileCount = fileNodes.filter((entity) => {
    if (!entity.path) {
      return false;
    }

    return !hiddenFilePathSet.has(entity.path);
  }).length;
  const normalizedFileFilterQuery = fileFilterQuery.trim().toLowerCase();
  const filteredFileNodes = fileNodes.filter((entity) => {
    if (normalizedFileFilterQuery.length === 0) {
      return true;
    }

    const entityPath = getEntityPath(entity).toLowerCase();
    const entityName = (entity.name ?? '').toLowerCase();
    return entityPath.includes(normalizedFileFilterQuery) || entityName.includes(normalizedFileFilterQuery);
  });
  const repositoryRoot =
    structureNodes.find((entity) => entity.type === 'directory' && entity.path === '.') ?? null;
  const focus = getNearestStructure(primaryAgent, structureNodes);
  const activeStructure = focus.entity;
  const loadedFile = getLoadedFile(primaryAgent, structureNodes);
  const entityByPath = new Map(
    structureNodes
      .filter((entity) => entity.path !== null && entity.path !== undefined)
      .map((entity) => [entity.path as string, entity]),
  );
  const routeNodes = buildRouteNodes(loadedFile ?? activeStructure ?? repositoryRoot, entityByPath);
  const visibleRouteNodes = routeNodes.filter(
    (entity) => entity.path != null && visibleStructurePathSet.has(entity.path),
  );
  const activePathSet = buildActivePathSet((loadedFile ?? activeStructure ?? repositoryRoot)?.path ?? null);
  const gitTree = buildGitTree(visibleStructureNodes);
  const nodeStatesByPath = new Map(
    structureNodes
      .filter((entity) => entity.path !== null && entity.path !== undefined)
      .map((entity) => [entity.path as string, entity.node_state ?? 'stable']),
  );
  const activeStructureState = activeStructure
    ? (activeStructure.node_state ?? 'stable')
    : null;
  const loadedFileState = loadedFile
    ? (loadedFile.node_state ?? 'stable')
    : null;
  const criticalMassNodes = structureNodes.filter((entity) => isCriticalMass(entity));
  const asymmetryNodes = structureNodes.filter((entity) => (entity.node_state ?? 'stable') === 'asymmetry');
  const genesisNodes = structureNodes.filter((entity) => (entity.node_state ?? 'stable') === 'task');
  const verifiedNodes = structureNodes.filter((entity) => (entity.node_state ?? 'stable') === 'verified');
  const t2Agents = agents.filter((entity) => entity.lmm_rule == null);
  const lmmAgents = agents.filter((entity) => entity.lmm_rule != null);
  const workforce: WorkforceStatus[] = WORKFORCE_ROLES.map((role) => ({
    agents: t2Agents.filter((entity) => (getAgentRole(entity) ?? 'architect') === role),
    label: getAgentRoleLabel(role),
    role,
  }));
  const explanationTargetPath = worldState.explanation_target_path ?? null;
  const explanationTargetEntity = explanationTargetPath ? entityByPath.get(explanationTargetPath) ?? null : null;
  const explanationStatus = worldState.explanation_status ?? 'idle';
  const explanationText = worldState.explanation_text ?? '';
  const explanationError = worldState.explanation_error ?? null;
  const hasExplanationTab =
    explanationTargetPath !== null ||
    explanationStatus !== 'idle' ||
    explanationText.length > 0 ||
    explanationError !== null;
  const contextEntity = explanationTargetEntity ?? loadedFile;
  const contextNodeState = explanationTargetEntity
    ? (explanationTargetEntity.node_state ?? 'stable')
    : loadedFileState;
  const codePreview = getCodePreview(contextEntity);
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
  const activeDirective = summarizeDirective(worldState.operator_prompt ?? operatorControl.operator_prompt);
  const controlStatus = worldState.control_status ?? 'idle';
  const operatorAction = worldState.operator_action ?? null;
  const operatorTargetPath = worldState.operator_target_path ?? null;
  const operatorTargetQuery = worldState.operator_target_query ?? null;

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

  const handleToggleAutomate = async (): Promise<void> => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setControlMessage('Supabase browser keys are missing, so automate cannot be toggled from this browser.');
      return;
    }

    const nextAutomate = !isAutomated;
    setControlMessage(nextAutomate ? 'Enabling automate mode...' : 'Disabling automate mode...');

    try {
      const { error } = await supabase
        .from('operator_controls')
        .upsert(
          stripUnsafeOperatorControlFields({
            id: DEFAULT_OPERATOR_CONTROL.id,
            repo_path: repoInput.trim(),
            operator_prompt: directiveInput.trim(),
            paused: isPaused,
            automate: nextAutomate,
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

      if (error) {
        throw error;
      }

      setControlMessage(nextAutomate ? 'Automate enabled. The lattice will loop indefinitely.' : 'Automate disabled.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown automate toggle failure';
      setControlMessage(`Automate toggle failed: ${message}`);
    }
  };

  const handleTogglePause = async (): Promise<void> => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setControlMessage('Supabase browser keys are missing, so pause cannot be toggled from this browser.');
      return;
    }

    const nextPaused = !isPaused;
    setControlMessage(nextPaused ? 'Pausing the lattice...' : 'Resuming the lattice...');

    try {
      const { error } = await supabase
        .from('operator_controls')
        .upsert(
          stripUnsafeOperatorControlFields({
            id: DEFAULT_OPERATOR_CONTROL.id,
            repo_path: repoInput.trim(),
            operator_prompt: directiveInput.trim(),
            paused: nextPaused,
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

      if (error) {
        throw error;
      }

      setControlMessage(nextPaused ? 'Lattice paused. Agents will finish their current tick and freeze.' : 'Lattice resumed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown pause toggle failure';
      setControlMessage(`Pause toggle failed: ${message}`);
    }
  };

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
          setControlMessage('Engine stopped.');
        }
      } else {
        const res = await fetch('http://localhost:3001/api/engine/start', { method: 'POST' });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setEngineError(data.error ?? 'Failed to start engine');
        } else {
          setEngineRunning(true);
          setControlMessage('Engine started. Automata are now ticking.');
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
      setControlMessage('Supabase browser keys are missing, so controls cannot be committed from this browser.');
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
    setControlMessage('Committing operator control to the lattice...');

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
      setControlMessage(
        nextControl.repo_path.length > 0
          ? 'Repository import queued. The engine will hot-swap overlays on its next control poll.'
          : 'Directive committed. The current overlay stays loaded and the agents will adopt the new instruction.',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown operator control failure';
      setControlMessage(`Control write failed: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

  const handleStageEdit = async (): Promise<void> => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setControlMessage('Supabase keys missing; cannot stage edit.');
      return;
    }
    if (!editPathInput.trim()) {
      setControlMessage('Provide a file path to stage an edit.');
      return;
    }
    setIsSavingControl(true);
    try {
      const { error } = await supabase
        .from('operator_controls')
        .upsert(
          stripUnsafeOperatorControlFields({
            id: DEFAULT_OPERATOR_CONTROL.id,
            repo_path: repoInput.trim(),
            operator_prompt: directiveInput.trim(),
            paused: isPaused,
            automate: isAutomated,
            visionary_prompt: worldState.visionary_prompt ?? operatorControl.visionary_prompt ?? '',
            architect_prompt: worldState.architect_prompt ?? operatorControl.architect_prompt ?? '',
            critic_prompt: worldState.critic_prompt ?? operatorControl.critic_prompt ?? '',
            pending_edit_path: editPathInput.trim(),
            pending_edit_content: editContentInput,
            commit_message: operatorControl.commit_message,
            should_push: operatorControl.should_push,
          }),
          { onConflict: 'id' },
        );
      if (error) throw error;
      setControlMessage(`Edit staged for ${editPathInput.trim()}. The engine will apply it on the next poll.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setControlMessage(`Stage edit failed: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

  const dispatchFileAction = async (action: 'read' | 'explain' | 'repair', targetPath: string): Promise<void> => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setControlMessage('Supabase keys missing; cannot dispatch file action from browser.');
      return;
    }
    const prompt = `${action} ${targetPath}`;
    setIsSavingControl(true);
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
      setControlMessage(`Dispatched: ${prompt}. An architect will pick it up on the next tick.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setControlMessage(`Dispatch failed: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

  const handleCommit = async (): Promise<void> => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      setControlMessage('Supabase keys missing; cannot commit.');
      return;
    }
    if (!commitMessageInput.trim()) {
      setControlMessage('Provide a commit message.');
      return;
    }
    setIsSavingControl(true);
    try {
      const { error } = await supabase
        .from('operator_controls')
        .upsert(
          stripUnsafeOperatorControlFields({
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
            commit_message: commitMessageInput.trim(),
            should_push: shouldPushInput,
          }),
          { onConflict: 'id' },
        );
      if (error) throw error;
      setControlMessage(`Commit queued: "${commitMessageInput.trim()}"${shouldPushInput ? ' with push' : ''}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setControlMessage(`Commit failed: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

  useEffect(() => {
    entityListRef.current = entities;
  }, [entities]);

  useEffect(() => {
    visibleEntityListRef.current = visibleEntities;
    visibleStructureListRef.current = visibleStructureNodes;
  }, [visibleEntities, visibleStructureNodes]);

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
      setControlMessage(worldState.control_error ?? 'Operator control failed.');
      return;
    }

    if (worldState.control_status === 'importing') {
      setControlMessage(`Importing ${operatorControl.repo_path.trim() || activeRepositoryPath || 'repository'} into the lattice...`);
      return;
    }

    if (worldState.control_status === 'active') {
      if (worldState.operator_target_path) {
        setControlMessage(
          `${formatControlStatus(worldState.control_status).toUpperCase()}: ${worldState.operator_action ?? 'maintain'} -> ${worldState.operator_target_path}`,
        );
      } else {
        setControlMessage('Directive committed. The lattice has accepted the current operator instruction.');
      }
      return;
    }

    setControlMessage('Enter a repository path and directive, then commit it into the lattice.');
  }, [
    activeRepositoryPath,
    isSavingControl,
    mode,
    operatorControl.repo_path,
    worldState.control_error,
    worldState.control_status,
    worldState.operator_action,
    worldState.operator_target_path,
  ]);

  useEffect(() => {
    phaseRef.current = worldState.phase;
    tickRef.current = worldState.tick;
  }, [worldState.phase, worldState.tick]);

  useEffect(() => {
    routeNodesRef.current = visibleRouteNodes;
  }, [visibleRouteNodes]);

  useEffect(() => {
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    showPlumbingRef.current = showPlumbing;
  }, [showPlumbing]);

  useEffect(() => {
    if (selectedEntity && !leftPanelOpen) {
      setLeftPanelOpen(true);
    }
    if (selectedEntity) {
      setLeftPanelSections((prev) => (prev.inspect ? prev : { ...prev, inspect: true }));
    }
  // Only react to selection changes, not leftPanelOpen toggles
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntity]);

  useEffect(() => {
    if (selectedEntity && inspectPanelRef.current) {
      inspectPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedEntity]);

  useEffect(() => {
    if (!hasExplanationTab) {
      if (contextTab === 'explanation') {
        setContextTab('code');
      }
      return;
    }

    if (
      explanationStatus === 'pending' ||
      explanationStatus === 'streaming' ||
      explanationStatus === 'complete' ||
      explanationError !== null
    ) {
      setContextTab('explanation');
    }
  }, [contextTab, explanationError, explanationStatus, explanationTargetPath, hasExplanationTab]);

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
      const nearest = visibleStructureListRef.current
        .map((entity) => {
          const center = toScreen(entity.x + 0.5, entity.y + 0.5, (entity.z ?? 0) + 0.5, layout);
          const dist = Math.hypot(center.sx - sx, center.sy - sy);
          return { entity, dist };
        })
        .filter((item) => item.dist < layout.tileHeight * thresholdMultiplier)
        .sort((left, right) => left.dist - right.dist)[0];

      return nearest?.entity ?? null;
    };

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const { sx: mouseX, sy: mouseY } = resolveCanvasPoint(event);

      setCamera((prev) => {
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
          canvas.style.cursor = 'grabbing';
          return;
        }

        dragMode = 'pending-select';
      } else if (event.button === 1) {
        event.preventDefault();
        dragMode = 'pan';
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
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
        setCamera((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
        return;
      }

      const { sx, sy } = resolveCanvasPoint(event);
      const layout = createIsoLayout(viewport.width, viewport.height, cameraRef.current);
      const nearest = findNearestVisibleStructure(sx, sy, layout, 1.2);
      setHoveredEntityId(nearest?.id ?? null);
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
        // Auto-open left panel and focus on inspect/context when clicking a building
        if (nearest) {
          setLeftPanelOpen(true);
          setLeftPanelSections((prev) => ({ ...prev, inspect: true, context: true }));
        }
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
      
      // Start smooth zoom animation
      const startCamera = { ...cameraRef.current };
      const startTime = performance.now();
      const duration = 600;
      
      const animate = (time: number): void => {
        const elapsed = time - startTime;
        const t = Math.min(1, elapsed / duration);
        // Ease-out cubic
        const ease = 1 - Math.pow(1 - t, 3);
        
        const nextCamera: Camera = {
          panX: startCamera.panX + (targetCamera.panX - startCamera.panX) * ease,
          panY: startCamera.panY + (targetCamera.panY - startCamera.panY) * ease,
          rotation: startCamera.rotation,
          zoom: startCamera.zoom + (targetCamera.zoom - startCamera.zoom) * ease,
        };
        
        setCamera(nextCamera);
        
        if (t < 1) {
          zoomAnimationRef.current.frame = requestAnimationFrame(animate);
        } else {
          zoomAnimationRef.current.frame = null;
          zoomAnimationRef.current.target = null;
        }
      };
      
      // Cancel any existing animation
      if (zoomAnimationRef.current.frame) {
        cancelAnimationFrame(zoomAnimationRef.current.frame);
      }
      zoomAnimationRef.current.target = targetCamera;
      zoomAnimationRef.current.frame = requestAnimationFrame(animate);
      
      // Auto-open left panel and focus on inspect section
      setLeftPanelOpen(true);
      setLeftPanelSections((prev) => ({ ...prev, inspect: true, context: true }));
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    const zoomAnimation = zoomAnimationRef.current;

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      const frame = zoomAnimation.frame;
      if (frame) {
        cancelAnimationFrame(frame);
      }
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

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * devicePixelRatio);
    canvas.height = Math.floor(viewport.height * devicePixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const render = (): void => {
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      const layout = createIsoLayout(viewport.width, viewport.height, camera);
      const currentEntities = visibleEntityListRef.current;
      const phase = phaseRef.current;
      const tick = tickRef.current;
      const layoutData = computeCityLayout(currentEntities);
      cityLayoutRef.current = layoutData;

      drawBackdrop(context, viewport, phase);

      // Underground plumbing — import dependency conduits (toggleable)
      if (showPlumbingRef.current) {
        drawTethers(context, currentEntities, layout, phase);
      }

      drawGroundPlane(context, viewport, layout, currentEntities, layoutData, phase);

      // Render the SimCity-style road network from the computed city layout.
      const roadCount = layoutData.roads.length;
      const totalTraffic = layoutData.roads.reduce((s, r) => s + r.trafficDensity, 0);
      spawnCars(trafficRef.current, roadCount, totalTraffic, tick);
      updateCars(trafficRef.current, 1);
      drawRoadsAndTraffic(context, layoutData.roads, trafficRef.current, layout, phase, currentEntities);

      drawTetherRoute(context, routeNodesRef.current, layout, phase);
      drawAgentTethers(
        context,
        agents,
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
      );

      if (hoveredEntityId) {
        const hovered = currentEntities.find((e) => e.id === hoveredEntityId);
        if (hovered && isStructureEntity(hovered)) {
          drawHoverHighlight(context, hovered, layout, displayPointsRef.current);
        }
      }

      const selected = selectedEntityRef.current;
      if (selected && isStructureEntity(selected)) {
        drawSelectionRing(context, selected, layout, displayPointsRef.current, phase);
      }

      frameRef.current = window.requestAnimationFrame(render);
    };

    frameRef.current = window.requestAnimationFrame(render);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [viewport, camera, hoveredEntityId, agents]);

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
        scheduleSnapshot(channelHealthy ? 30000 : 5000);
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
          scheduleSnapshot(30000);
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
      <aside className={`lux-panel lux-panel-left ${leftPanelOpen ? 'is-open' : 'is-collapsed'}`}>
        <button
          className="panel-toggle"
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          title={leftPanelOpen ? 'Collapse left panel' : 'Expand left panel'}
          type="button"
        >
          {leftPanelOpen ? <ChevronLeft size={16} /> : <PanelLeft size={16} />}
        </button>
        {leftPanelOpen ? (
          <div className="panel-stack">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <GitBranch size={14} strokeWidth={1.85} />
                <span className="panel-title">Git Overlay</span>
              </div>
              <span className="panel-subtitle">
                {visibleStructureNodes.length}/{structureNodes.length} visible nodes
              </span>
            </div>

            <SidebarSection
              meta={activeRepositoryName}
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, overview: !prev.overview }))}
              open={leftPanelSections.overview}
              title="Overlay Overview"
            >
              <div className="repo-chip">
                <span className="repo-chip-label">Repository</span>
                <span className="repo-chip-value">{activeRepositoryName}</span>
                <span className="repo-chip-path">{activeRepositoryPath ?? 'No repository overlay loaded yet.'}</span>
              </div>

              <div className="engine-control">
                <div className="engine-control-header">
                  <span className="protocol-card-title">Engine</span>
                  <span className={`engine-status ${engineRunning ? 'is-running' : 'is-stopped'}`}>
                    {engineRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>
                <button
                  className={`control-button engine-button ${engineRunning ? 'is-stop' : 'is-start'}`}
                  disabled={engineLoading}
                  onClick={() => { void handleToggleEngine(); }}
                  type="button"
                >
                  {engineLoading ? 'Working...' : engineRunning ? 'Stop Engine' : 'Start Engine'}
                </button>
                {engineError ? (
                  <span className="engine-error">{engineError}</span>
                ) : null}
              </div>
            </SidebarSection>

            <SidebarSection
              meta={formatControlStatus(controlStatus)}
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, operator: !prev.operator }))}
              open={leftPanelSections.operator}
              title="Operator Control"
            >
              <form className="control-card" onSubmit={(event) => { void handleControlSubmit(event); }}>
                <div className="control-card-header">
                  <div className="protocol-card-title">Operator Queue</div>
                  <span className={`control-status status-${controlStatus} ${isSavingControl ? 'is-busy' : 'is-ready'}`}>
                    {isSavingControl ? 'writing' : formatControlStatus(controlStatus)}
                  </span>
                </div>

                <label className="control-field">
                  <span className="control-label">Repository Path</span>
                  <input
                    className="control-input"
                    onChange={(event) => {
                      controlDirtyRef.current = true;
                      setRepoInput(event.target.value);
                    }}
                    placeholder="C:\\Users\\Futureman\\Desktop\\lucianprotocol"
                    spellCheck={false}
                    type="text"
                    value={repoInput}
                  />
                  {worldState.saved_overlay_names && worldState.saved_overlay_names.length > 0 && (
                    <select
                      className="control-select"
                      onChange={(event) => {
                        if (event.target.value) {
                          controlDirtyRef.current = true;
                          setRepoInput(event.target.value);
                        }
                      }}
                      value=""
                    >
                      <option value="">— Load saved overlay —</option>
                      {worldState.saved_overlay_names.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                <label className="control-field">
                  <span className="control-label">Directive</span>
                  <textarea
                    className="control-textarea"
                    onChange={(event) => {
                      controlDirtyRef.current = true;
                      setDirectiveInput(event.target.value);
                    }}
                    placeholder="Navigate to src/engine.ts and explain what the Architect is doing."
                    rows={4}
                    spellCheck={false}
                    value={directiveInput}
                  />
                </label>

                <div className="control-actions">
                  <button className="control-button" disabled={isSavingControl} type="submit">
                    {isSavingControl ? 'Committing...' : 'Apply To Lattice'}
                  </button>
                  <button
                    className={`control-button ${isPaused ? 'is-paused' : ''}`}
                    disabled={isSavingControl}
                    onClick={() => { void handleTogglePause(); }}
                    type="button"
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className={`control-button ${isAutomated ? 'is-active' : ''}`}
                    disabled={isSavingControl}
                    onClick={() => { void handleToggleAutomate(); }}
                    type="button"
                  >
                    {isAutomated ? 'Automate On' : 'Automate'}
                  </button>
                </div>

                <details className="control-details">
                  <summary className="control-summary">Edit &amp; Commit</summary>
                  <label className="control-field">
                    <span className="control-label">Edit Path</span>
                    <input
                      className="control-input"
                      onChange={(event) => setEditPathInput(event.target.value)}
                      placeholder="src/engine.ts"
                      spellCheck={false}
                      type="text"
                      value={editPathInput}
                    />
                  </label>
                  <label className="control-field">
                    <span className="control-label">Edit Content</span>
                    <textarea
                      className="control-textarea"
                      onChange={(event) => setEditContentInput(event.target.value)}
                      placeholder="Paste new file content..."
                      rows={4}
                      spellCheck={false}
                      value={editContentInput}
                    />
                  </label>
                  <div className="control-actions">
                    <button
                      className="control-button"
                      disabled={isSavingControl || !editPathInput.trim()}
                      onClick={() => { void handleStageEdit(); }}
                      type="button"
                    >
                      Stage Edit
                    </button>
                  </div>
                  <label className="control-field">
                    <span className="control-label">Commit Message</span>
                    <input
                      className="control-input"
                      onChange={(event) => setCommitMessageInput(event.target.value)}
                      placeholder="feat: update engine logic"
                      spellCheck={false}
                      type="text"
                      value={commitMessageInput}
                    />
                  </label>
                  <label className="control-field checkbox-field">
                    <input
                      checked={shouldPushInput}
                      onChange={(event) => setShouldPushInput(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="control-label">Push to remote after commit</span>
                  </label>
                  <div className="control-actions">
                    <button
                      className="control-button"
                      disabled={isSavingControl || !commitMessageInput.trim()}
                      onClick={() => { void handleCommit(); }}
                      type="button"
                    >
                      Commit{shouldPushInput ? ' & Push' : ''}
                    </button>
                  </div>
                </details>

                <div className="control-note">
                  Leave the repo path unchanged to keep the current overlay and only swap the operator prompt.
                </div>
                <div className="control-feedback">{controlMessage}</div>
                <div className="control-metrics">
                  <span>Action {operatorAction ?? 'maintain'}</span>
                  <span>Target {operatorTargetPath ?? operatorTargetQuery ?? 'none'}</span>
                  <span>Import {formatDuration(worldState.last_import_duration_ms)}</span>
                </div>
              </form>
            </SidebarSection>

            <SidebarSection
              meta={`${visibleFileCount}/${fileNodes.length} visible`}
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, visibility: !prev.visibility }))}
              open={leftPanelSections.visibility}
              title="Visible Files"
            >
              {fileNodes.length > 0 ? (
                <>
                  <div className="file-filter-toolbar">
                    <input
                      className="control-input file-filter-input"
                      onChange={(event) => setFileFilterQuery(event.target.value)}
                      placeholder="Search files..."
                      spellCheck={false}
                      type="text"
                      value={fileFilterQuery}
                    />
                    <div className="file-filter-actions">
                      <button
                        className="file-filter-action"
                        disabled={hiddenFilePaths.length === 0}
                        onClick={() => setHiddenFilePaths([])}
                        type="button"
                      >
                        Show All
                      </button>
                      <button
                        className="file-filter-action"
                        disabled={fileNodes.length === 0 || hiddenFilePaths.length === fileNodes.length}
                        onClick={() =>
                          setHiddenFilePaths(
                            fileNodes
                              .map((entity) => entity.path)
                              .filter((path): path is string => path != null),
                          )
                        }
                        type="button"
                      >
                        Hide All
                      </button>
                    </div>
                    <div className="file-filter-summary">
                      <span>{visibleFileCount} visible</span>
                      <span>{Math.max(0, fileNodes.length - visibleFileCount)} hidden</span>
                    </div>
                  </div>

                  <div className="file-filter-list">
                    {filteredFileNodes.length > 0 ? (
                      filteredFileNodes.map((entity) => {
                        const filePath = entity.path ?? getEntityPath(entity);
                        const isVisible = !hiddenFilePathSet.has(filePath);

                        return (
                          <label
                            className={`file-filter-row ${isVisible ? 'is-visible' : 'is-hidden'}`}
                            key={entity.id}
                          >
                            <input
                              checked={isVisible}
                              onChange={(event) => {
                                const nextVisible = event.target.checked;
                                setHiddenFilePaths((prev) => {
                                  if (nextVisible) {
                                    return prev.filter((path) => path !== filePath);
                                  }

                                  return prev.includes(filePath) ? prev : [...prev, filePath];
                                });
                              }}
                              type="checkbox"
                            />
                            <span className="file-filter-copy">
                              <span className="file-filter-name">{entity.name ?? filePath.split('/').at(-1) ?? filePath}</span>
                              <span className="file-filter-path">{filePath}</span>
                            </span>
                          </label>
                        );
                      })
                    ) : (
                      <p className="panel-placeholder">No files match the current search.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="panel-placeholder">No repository files are loaded yet.</p>
              )}
            </SidebarSection>

            <SidebarSection
              meta={`${worldState.active_tasks?.length ?? 0} tasks`}
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, tasks: !prev.tasks }))}
              open={leftPanelSections.tasks}
              title="Task Pipeline"
            >
              {worldState.active_tasks && worldState.active_tasks.length > 0 ? (
                <div className="protocol-card">
                  <div className="protocol-card-title">Queued Work</div>
                  <div className="task-stats">
                    <span className="task-stat is-pending">{worldState.active_tasks.filter((t) => t.status === 'pending').length} pending</span>
                    <span className="task-stat is-active">{worldState.active_tasks.filter((t) => t.status === 'assigned' || t.status === 'in_progress').length} active</span>
                    <span className="task-stat is-review">{worldState.active_tasks.filter((t) => t.status === 'awaiting_review').length} review</span>
                    <span className="task-stat is-done">{worldState.active_tasks.filter((t) => t.status === 'done').length} done</span>
                  </div>
                  <div className="task-list">
                    {worldState.active_tasks.map((task) => {
                      const diffLines = shouldShowDiff(task)
                        ? computeLineDiff(task.original_content ?? '', task.completed_content ?? '')
                        : null;
                      const validationBadges = [
                        { label: 'Lint', value: task.validation?.lint },
                        { label: 'Types', value: task.validation?.typecheck },
                      ].filter((entry): entry is { label: string; value: TaskValidationResult } => entry.value != null);
                      return (
                        <div className={`task-row status-${task.status}`} key={task.id}>
                          <span className="task-id">{task.id}</span>
                          <span className="task-path">{task.target_path}</span>
                          <span className={`task-badge status-${task.status}`}>{formatTaskStatus(task.status)}</span>
                          {validationBadges.length > 0 ? (
                            <div className="task-validation-strip">
                              {validationBadges.map((entry) => (
                                <span
                                  className={`task-validation-badge status-${entry.value.status}`}
                                  key={`${task.id}-${entry.label}`}
                                  title={entry.value.summary ?? `${entry.label} ${formatValidationStatus(entry.value.status)}`}
                                >
                                  {entry.label} {formatValidationStatus(entry.value.status)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {diffLines && diffLines.length > 0 ? (
                            <TaskDiff lines={diffLines} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="panel-placeholder">No queued tasks are currently visible.</p>
              )}
            </SidebarSection>

            <SidebarSection
              meta={`${t2Agents.length} T2 · ${lmmAgents.length} LMM`}
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, workforce: !prev.workforce }))}
              open={leftPanelSections.workforce}
              title="Hivemind Workforce"
            >
              <div className="protocol-card">
                <div className="protocol-card-title">Active Roles</div>
                <div className="workforce-list">
                  {workforce.map((member) => {
                    const promptValue = member.role === 'visionary'
                      ? visionaryPromptInput
                      : member.role === 'architect'
                        ? architectPromptInput
                        : criticPromptInput;
                    const promptSource = member.role === 'visionary'
                      ? worldState.visionary_prompt ?? operatorControl.visionary_prompt ?? ''
                      : member.role === 'architect'
                        ? worldState.architect_prompt ?? operatorControl.architect_prompt ?? ''
                        : worldState.critic_prompt ?? operatorControl.critic_prompt ?? '';

                    return (
                      <div className={`workforce-row role-${member.role}`} key={member.role}>
                        <span className={`role-swatch role-${member.role}`} />
                        <span className="workforce-label">{member.label}</span>
                        <span className="workforce-value">
                          {member.agents[0]
                            ? `online ${member.agents.map((agent) => `(${agent.x},${agent.y})`).join(', ')}`
                            : 'standby'}
                        </span>
                        <details className="agent-prompt-details">
                          <summary className="agent-prompt-summary">
                            {promptSource.length > 0 ? 'Directive set' : 'Set directive'}
                          </summary>
                          <textarea
                            className="control-textarea agent-prompt-textarea"
                            onChange={(event) => {
                              if (member.role === 'visionary') setVisionaryPromptInput(event.target.value);
                              else if (member.role === 'architect') setArchitectPromptInput(event.target.value);
                              else setCriticPromptInput(event.target.value);
                            }}
                            placeholder={`Specific instruction for the ${member.label}...`}
                            rows={3}
                            spellCheck={false}
                            value={promptValue}
                          />
                          <button
                            className="control-button agent-prompt-button"
                            disabled={isSavingControl}
                            onClick={async () => {
                              const supabase = supabaseRef.current;
                              if (!supabase) {
                                setControlMessage('Supabase keys missing; cannot set agent directive.');
                                return;
                              }
                              try {
                                const { error } = await supabase
                                  .from('operator_controls')
                                  .upsert(
                                    stripUnsafeOperatorControlFields({
                                      id: DEFAULT_OPERATOR_CONTROL.id,
                                      repo_path: repoInput.trim(),
                                      operator_prompt: directiveInput.trim(),
                                      paused: isPaused,
                                      automate: isAutomated,
                                      visionary_prompt: member.role === 'visionary' ? promptValue.trim() : (worldState.visionary_prompt ?? operatorControl.visionary_prompt ?? ''),
                                      architect_prompt: member.role === 'architect' ? promptValue.trim() : (worldState.architect_prompt ?? operatorControl.architect_prompt ?? ''),
                                      critic_prompt: member.role === 'critic' ? promptValue.trim() : (worldState.critic_prompt ?? operatorControl.critic_prompt ?? ''),
                                    }),
                                    { onConflict: 'id' },
                                  );
                                if (error) throw error;
                                setControlMessage(`${member.label} directive committed.`);
                              } catch (error) {
                                const message = error instanceof Error ? error.message : 'Unknown error';
                                setControlMessage(`Directive failed: ${message}`);
                              }
                            }}
                            type="button"
                          >
                            Commit Directive
                          </button>
                        </details>
                      </div>
                    );
                  })}
                  {lmmAgents.length > 0 && (
                    <div className="workforce-row role-swarm">
                      <span className="role-swatch role-swarm" />
                      <span className="workforce-label">Swarm</span>
                      <span className="workforce-value">
                        {lmmAgents.length} automata {lmmAgents.map((agent) => `(${agent.x},${agent.y})`).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
                <div className="protocol-stats">
                  <span>Genesis {genesisNodes.length}</span>
                  <span>Asymmetry {asymmetryNodes.length}</span>
                  <span>Fission {criticalMassNodes.length}</span>
                </div>
              </div>
            </SidebarSection>

            <SidebarSection
              meta={`${visibleFileCount} visible files`}
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, tree: !prev.tree }))}
              open={leftPanelSections.tree}
              title="Overlay Tree"
            >
              <div className="git-tree">
                {gitTree && visibleFileCount > 0 ? (
                  <GitTreeItem
                    activePathSet={activePathSet}
                    depth={0}
                    loadedPath={loadedFile?.path ?? null}
                    node={gitTree}
                    nodeStatesByPath={nodeStatesByPath}
                  />
                ) : (
                  <p className="panel-placeholder">
                    {fileNodes.length > 0
                      ? 'All files are hidden by the current visibility filter.'
                      : 'No Git structure overlay loaded yet.'}
                  </p>
                )}
              </div>
            </SidebarSection>

            <SidebarSection
              meta={
                contextTab === 'explanation' && hasExplanationTab
                  ? formatExplanationStatus(explanationStatus)
                  : getNodeStateLabel(contextNodeState ?? 'stable')
              }
              onToggle={() => setLeftPanelSections((prev) => ({ ...prev, context: !prev.context }))}
              open={leftPanelSections.context}
              title="Spatial Context"
            >
              {contextEntity || hasExplanationTab ? (
                <div className="panel-card context-panel">
                  <div className="panel-card-header">
                    <div className="panel-card-title">Spatial Context</div>
                    <div className="context-badge">
                      {contextTab === 'explanation' && hasExplanationTab
                        ? formatExplanationStatus(explanationStatus)
                        : getNodeStateLabel(contextNodeState ?? 'stable')}
                    </div>
                  </div>
                  <div className="context-meta">
                    <span>{contextEntity?.descriptor ?? 'Source artifact'}</span>
                    {contextEntity ? <span>Mass {contextEntity.mass}</span> : null}
                    {contextEntity ? <span>Chiral {computeChiralMass(contextEntity)}</span> : null}
                    {contextEntity ? <span>{contextEntity.git_status ?? 'clean'}</span> : null}
                    {hasExplanationTab ? <span>Explain {formatExplanationStatus(explanationStatus)}</span> : null}
                  </div>
                  {hasExplanationTab ? (
                    <div className="context-tabs">
                      <button
                        className={`context-tab ${contextTab === 'code' ? 'is-active' : ''}`}
                        onClick={() => setContextTab('code')}
                        type="button"
                      >
                        Code
                      </button>
                      <button
                        className={`context-tab ${contextTab === 'explanation' ? 'is-active' : ''}`}
                        onClick={() => setContextTab('explanation')}
                        type="button"
                      >
                        Explanation
                      </button>
                    </div>
                  ) : null}
                  {contextTab === 'explanation' && hasExplanationTab ? (
                    <div className="explanation-frame">
                      <div className={`explanation-status status-${explanationStatus}`}>
                        {formatExplanationStatus(explanationStatus)}
                      </div>
                      {explanationError ? (
                        <div className="explanation-placeholder is-error">{explanationError}</div>
                      ) : explanationText.trim().length > 0 ? (
                        <div className="explanation-body">{explanationText}</div>
                      ) : (
                        <div className="explanation-placeholder">
                          {explanationStatus === 'pending'
                            ? 'Awaiting Gemini explanation for this file.'
                            : explanationStatus === 'streaming'
                              ? 'Streaming explanation into the lattice.'
                              : 'No explanation captured yet.'}
                        </div>
                      )}
                    </div>
                  ) : contextEntity ? (
                    <CodeSyntaxPreview code={codePreview} />
                  ) : (
                    <div className="explanation-placeholder">No file content is loaded for this target yet.</div>
                  )}
                </div>
              ) : (
                <p className="panel-placeholder">No spatial context is available for the current focus.</p>
              )}
            </SidebarSection>

            {selectedEntity ? (
              <SidebarSection
                meta={selectedEntity.type}
                onToggle={() => setLeftPanelSections((prev) => ({ ...prev, inspect: !prev.inspect }))}
                open={leftPanelSections.inspect}
                title="Inspector"
              >
                <div className="panel-card inspect-panel" ref={inspectPanelRef}>
                  <div className="panel-card-header">
                    <div className="panel-card-title">{selectedEntity.name ?? 'Unnamed Node'}</div>
                    <button
                      className="inspect-close"
                      onClick={() => setSelectedEntity(null)}
                      type="button"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="context-meta">
                    <span>{selectedEntity.type}</span>
                    <span>{selectedEntity.descriptor ?? 'No descriptor'}</span>
                    <span>Mass {selectedEntity.mass}</span>
                    <span>Chiral {computeChiralMass(selectedEntity)}</span>
                    <span>{selectedEntity.git_status ?? 'clean'}</span>
                    <span>{getNodeStateLabel(selectedEntity.node_state ?? 'stable')}</span>
                  </div>
                  {selectedEntity.path ? (
                    <div className="inspect-actions">
                      <button
                        className="inspect-action-btn"
                        onClick={() => { void dispatchFileAction('read', selectedEntity.path ?? ''); }}
                        type="button"
                      >
                        Send Architect
                      </button>
                      <button
                        className="inspect-action-btn is-repair"
                        onClick={() => { void dispatchFileAction('repair', selectedEntity.path ?? ''); }}
                        type="button"
                      >
                        Repair File
                      </button>
                      <button
                        className="inspect-action-btn is-explain"
                        onClick={() => { void dispatchFileAction('explain', selectedEntity.path ?? ''); }}
                        type="button"
                      >
                        Explain
                      </button>
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
              </SidebarSection>
            ) : null}
          </div>
        ) : null}
      </aside>

      <section className="lux-lattice" ref={latticeRef}>
        <canvas className="lux-canvas" ref={canvasRef} />

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

        {selectedEntity && inspectPopupPosition ? (
          <div
            className="canvas-inspect-popup"
            style={{ left: inspectPopupPosition.left, top: inspectPopupPosition.top }}
          >
            <div className="canvas-inspect-popup-header">
              <div className="canvas-inspect-popup-title">
                {selectedEntity.name ?? selectedEntity.path ?? 'Unnamed'}
              </div>
              <button
                className="canvas-inspect-popup-close"
                onClick={() => setSelectedEntity(null)}
                type="button"
              >
                <X size={14} />
              </button>
            </div>
            <div className="canvas-inspect-popup-meta">
              <span>{selectedEntity.type}</span>
              <span>{selectedEntity.descriptor ?? 'No descriptor'}</span>
              <span>Mass {selectedEntity.mass}</span>
              <span>{selectedEntity.git_status ?? 'clean'}</span>
            </div>
            {selectedEntity.path ? (
              <div className="canvas-inspect-popup-actions">
                <button
                  className="inspect-action-btn"
                  onClick={() => { void dispatchFileAction('read', selectedEntity.path ?? ''); }}
                  type="button"
                >
                  Send Architect
                </button>
                <button
                  className="inspect-action-btn is-repair"
                  onClick={() => { void dispatchFileAction('repair', selectedEntity.path ?? ''); }}
                  type="button"
                >
                  Repair File
                </button>
                <button
                  className="inspect-action-btn is-explain"
                  onClick={() => { void dispatchFileAction('explain', selectedEntity.path ?? ''); }}
                  type="button"
                >
                  Explain
                </button>
              </div>
            ) : null}
            <div className="canvas-inspect-popup-body">
              {selectedEntity.content_preview || selectedEntity.content ? (
                <CodeSyntaxPreview code={selectedEntity.content ?? selectedEntity.content_preview ?? ''} />
              ) : (
                <div className="code-frame">
                  <div className="code-line">
                    <span className="code-gutter">—</span>
                    <span className="code-content">
                      {selectedEntity.is_binary
                        ? 'Binary asset — hash-only transfer.'
                        : 'No content preview available.'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {errorMessage ? <div className="hud-alert">{errorMessage}</div> : null}
      </section>

      <aside className={`lux-panel lux-panel-right ${rightPanelOpen ? 'is-open' : 'is-collapsed'}`}>
        <button
          className="panel-toggle"
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          title={rightPanelOpen ? 'Collapse right panel' : 'Expand right panel'}
          type="button"
        >
          {rightPanelOpen ? <ChevronRight size={16} /> : <PanelRight size={16} />}
        </button>
        {rightPanelOpen ? (
          <div className="panel-stack">
            <div className="panel-header">
              <div className="panel-title-wrap">
                <GitBranch size={14} strokeWidth={1.85} />
                <span className="panel-title">AI Cognition Log</span>
              </div>
              <span className="panel-subtitle">{mode === 'live' ? 'live feed' : 'preview feed'}</span>
            </div>

            <SidebarSection
              meta={mode === 'live' ? 'live' : 'preview'}
              onToggle={() => setRightPanelSections((prev) => ({ ...prev, status: !prev.status }))}
              open={rightPanelSections.status}
              title="Live Status"
            >
              <div className={`cognition-status role-${primaryRole}`}>
                <span className={`cursor-pulse role-${primaryRole}`} />
                <span>
                  {loadedFile
                    ? `${getAgentRoleLabel(primaryRole).toLowerCase()} reading ${loadedFile.name ?? loadedFile.path ?? 'node'}`
                    : activeStructure
                      ? `${getAgentRoleLabel(primaryRole).toLowerCase()} traversing ${activeStructure.name ?? activeStructure.path ?? 'lattice'}`
                      : 'awaiting structure lock'}
                </span>
              </div>

              <div className="cognition-footer">
                <div>Nearest Node: {activeStructure?.name ?? 'none'}</div>
                <div>Verified: {verifiedNodes.length}</div>
                <div>Critical Mass: {criticalMassNodes.length}</div>
                <div>Tick: {formatDuration(worldState.last_tick_duration_ms)}</div>
                <div>AI: {formatDuration(worldState.last_ai_latency_ms)}</div>
                <div>Queue: {worldState.queue_depth ?? 0}</div>
              </div>
            </SidebarSection>

            <SidebarSection
              meta={`${worldState.agent_activities?.length ?? 0} agents`}
              onToggle={() => setRightPanelSections((prev) => ({ ...prev, activity: !prev.activity }))}
              open={rightPanelSections.activity}
              title="Workforce Activity"
            >
              {worldState.agent_activities && worldState.agent_activities.length > 0 ? (
                <div className="activity-panel">
                  <div className="activity-list">
                    {worldState.agent_activities.map((activity) => (
                      <div className={`activity-row status-${activity.status}`} key={activity.agent_id}>
                        <span className={`activity-swatch ${getActivitySwatchClass(activity.status)}`} />
                        <span className="activity-id">{activity.agent_id.replace('agent-', '')}</span>
                        <span className="activity-status">{formatActivityStatus(activity.status)}</span>
                        {activity.target_path ? (
                          <span className="activity-target">{activity.target_path}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="panel-placeholder">No activity events are streaming yet.</p>
              )}
            </SidebarSection>

            <SidebarSection
              meta={formatControlStatus(controlStatus)}
              onToggle={() => setRightPanelSections((prev) => ({ ...prev, directive: !prev.directive }))}
              open={rightPanelSections.directive}
              title="Directive & Laws"
            >
              <div className="directive-strip">
                <span className="directive-label">Operator Prompt</span>
                <span className="directive-value">{activeDirective}</span>
              </div>

              <div className="laws-strip">
                {HIVEMIND_LAWS.slice(0, 3).map((law, index) => (
                  <div className="law-chip" key={`law-${index}`}>
                    L{index + 1}: {law}
                  </div>
                ))}
              </div>
            </SidebarSection>

            <SidebarSection
              meta={`${logEntries.length} events`}
              onToggle={() => setRightPanelSections((prev) => ({ ...prev, log: !prev.log }))}
              open={rightPanelSections.log}
              title="Cognition Log"
            >
              <div className="cognition-log">
                {logEntries.length > 0 ? (
                  logEntries.map((entry) => (
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
            </SidebarSection>

            <SidebarSection
              meta={`${verifiedNodes.length} verified`}
              onToggle={() => setRightPanelSections((prev) => ({ ...prev, legend: !prev.legend }))}
              open={rightPanelSections.legend}
              title="Hivemind Taxonomy"
            >
              <div className="legend-section">
                <div className="legend-heading">Agents</div>
                <div className="legend-list">
                  <div className="legend-row">
                    <span className="legend-swatch is-visionary" />
                    <span>Visionary</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch is-architect" />
                    <span>Architect</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch is-critic" />
                    <span>Critic</span>
                  </div>
                </div>
              </div>
              <div className="legend-section">
                <div className="legend-heading">Node States</div>
                <div className="legend-list">
                  <div className="legend-row">
                    <span className="legend-swatch is-task" />
                    <span>Genesis Task</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch is-progress" />
                    <span>Locked Build</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch is-asymmetry" />
                    <span>Asymmetry / Error</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch is-stable" />
                    <span>Stable Code</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch is-verified" />
                    <span>Verified</span>
                  </div>
                </div>
              </div>
            </SidebarSection>
          </div>
        ) : null}
      </aside>
    </main>
  );
}

export default App;
