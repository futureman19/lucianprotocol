import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileCode, Folder, GitBranch } from 'lucide-react';

import {
  HIVEMIND_LAWS,
  computeChiralMass,
  countEntityLines,
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
  type Entity,
  type OperatorControl,
  type WorldState,
  type Task,
} from '../src/types';
import { buildActivePathSet, buildGitTree, type GitTreeNode } from './git-tree';
import { CodeSyntaxPreview } from './highlight';
import { createIsoLayout, createPrismProjection, fromScreen, toScreen, traceFace, type IsoLayout } from './iso';

interface Viewport {
  height: number;
  width: number;
}

interface DisplayPoint {
  x: number;
  y: number;
}

type LogKind = 'scan' | 'move' | 'read' | 'state' | 'alert' | 'verify';

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

interface StatusPalette {
  accent: string;
  glow: string;
  left: string;
  right: string;
  top: string;
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

function entityMapFromList(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

function createEntityList(map: Map<string, Entity>): Entity[] {
  return Array.from(map.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function getPrismHeight(entity: Entity): number {
  if (entity.type === 'directory') {
    return 1;
  }

  if (entity.type === 'wall') {
    return 1.2;
  }

  if (entity.type === 'goal') {
    return 0.2;
  }

  if (entity.type === 'file') {
    const lineLift = Math.min(4, Math.floor(countEntityLines(entity) / 24));
    return Math.min(6, Math.max(1, entity.mass + lineLift));
  }

  return 0.7;
}

function getNodePalette(nodeState: HivemindNodeState): StatusPalette {
  if (nodeState === 'task') {
    return {
      accent: '#ec4899',
      glow: 'rgba(236, 72, 153, 0.45)',
      left: '#5d1a4a',
      right: '#7a225f',
      top: '#a93782',
    };
  }

  if (nodeState === 'in-progress') {
    return {
      accent: '#fb923c',
      glow: 'rgba(251, 146, 60, 0.5)',
      left: '#6d3207',
      right: '#92400e',
      top: '#c76716',
    };
  }

  if (nodeState === 'asymmetry') {
    return {
      accent: '#fde047',
      glow: 'rgba(239, 68, 68, 0.58)',
      left: '#6b1b1b',
      right: '#9a3412',
      top: '#d9b423',
    };
  }

  if (nodeState === 'verified') {
    return {
      accent: '#22c55e',
      glow: 'rgba(34, 197, 94, 0.52)',
      left: '#0c4d2d',
      right: '#166534',
      top: '#22a653',
    };
  }

  return {
    accent: '#56d9ff',
    glow: 'rgba(86, 217, 255, 0.46)',
    left: '#103d62',
    right: '#18608b',
    top: '#2489b8',
  };
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

function withAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getFileFootprint(entity: Entity): { depth: number; width: number } {
  if (entity.type === 'directory') {
    return { depth: 1.28, width: 1.28 };
  }

  if (entity.type === 'file') {
    return { depth: 0.58, width: 0.58 };
  }

  if (entity.type === 'wall') {
    return { depth: 1, width: 1 };
  }

  return { depth: 0.7, width: 0.7 };
}

function fillFace(
  context: CanvasRenderingContext2D,
  points: ReturnType<typeof createPrismProjection>['top'],
  color: string,
  stroke: string,
): void {
  traceFace(context, points);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = stroke;
  context.stroke();
}

function drawBackdrop(context: CanvasRenderingContext2D, viewport: Viewport): void {
  const background = context.createLinearGradient(0, 0, 0, viewport.height);
  background.addColorStop(0, '#020409');
  background.addColorStop(0.55, '#05070d');
  background.addColorStop(1, '#010204');
  context.fillStyle = background;
  context.fillRect(0, 0, viewport.width, viewport.height);

  const glow = context.createRadialGradient(
    viewport.width * 0.55,
    viewport.height * 0.08,
    12,
    viewport.width * 0.55,
    viewport.height * 0.08,
    viewport.width * 0.75,
  );
  glow.addColorStop(0, 'rgba(44, 207, 255, 0.12)');
  glow.addColorStop(1, 'rgba(44, 207, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, viewport.width, viewport.height);
}

function drawGrid(context: CanvasRenderingContext2D, layout: IsoLayout): void {
  context.lineWidth = 1;

  for (let x = 0; x <= 50; x += 1) {
    const start = toScreen(x, 0, 0, layout);
    const end = toScreen(x, 50, 0, layout);
    context.beginPath();
    context.moveTo(start.sx, start.sy);
    context.lineTo(end.sx, end.sy);
    context.strokeStyle = x % 5 === 0 ? 'rgba(46, 201, 255, 0.2)' : 'rgba(46, 201, 255, 0.08)';
    context.stroke();
  }

  for (let y = 0; y <= 50; y += 1) {
    const start = toScreen(0, y, 0, layout);
    const end = toScreen(50, y, 0, layout);
    context.beginPath();
    context.moveTo(start.sx, start.sy);
    context.lineTo(end.sx, end.sy);
    context.strokeStyle = y % 5 === 0 ? 'rgba(46, 201, 255, 0.2)' : 'rgba(46, 201, 255, 0.08)';
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

function drawTetherRoute(context: CanvasRenderingContext2D, routeNodes: Entity[], layout: IsoLayout): void {
  if (routeNodes.length < 2) {
    return;
  }

  context.save();
  context.strokeStyle = 'rgba(16, 185, 129, 0.35)';
  context.lineWidth = 2;
  context.shadowBlur = 12;
  context.shadowColor = 'rgba(16, 185, 129, 0.55)';
  context.beginPath();

  routeNodes.forEach((node, index) => {
    const height = getPrismHeight(node);
    const footprint = getFileFootprint(node);
    const screen = toScreen(
      node.x + (footprint.width / 2),
      node.y + (footprint.depth / 2),
      height + 0.08,
      layout,
    );

    if (index === 0) {
      context.moveTo(screen.sx, screen.sy);
    } else {
      context.lineTo(screen.sx, screen.sy);
    }
  });

  context.stroke();
  context.restore();
}

function drawCriticalMassHalo(
  context: CanvasRenderingContext2D,
  projection: ReturnType<typeof createPrismProjection>,
  layout: IsoLayout,
  phase: number,
): void {
  const pulse = 0.7 + ((phase % 10) * 0.05);
  context.save();
  context.beginPath();
  context.ellipse(
    projection.center.sx,
    projection.center.sy,
    layout.tileWidth * 0.28,
    layout.tileHeight * 0.22,
    0,
    0,
    Math.PI * 2,
  );
  context.strokeStyle = `rgba(236, 72, 153, ${pulse})`;
  context.lineWidth = 1.6;
  context.shadowBlur = 16;
  context.shadowColor = 'rgba(236, 72, 153, 0.62)';
  context.stroke();
  context.restore();
}

function drawStructureEntity(
  context: CanvasRenderingContext2D,
  entity: Entity,
  display: DisplayPoint,
  layout: IsoLayout,
  phase: number,
  nodeState: HivemindNodeState,
): void {
  const palette = getNodePalette(nodeState);
  const height = getPrismHeight(entity);
  const footprint = getFileFootprint(entity);
  const projection = createPrismProjection(
    display.x + ((1 - footprint.width) / 2),
    display.y + ((1 - footprint.depth) / 2),
    0,
    footprint.width,
    footprint.depth,
    height,
    layout,
  );
  const pulsing = nodeState === 'in-progress' || nodeState === 'asymmetry';
  const highlighted = pulsing || nodeState === 'task' || nodeState === 'verified' || isCriticalMass(entity);

  context.save();
  context.lineWidth = entity.type === 'directory' ? 1.4 : 1.1;

  if (highlighted) {
    context.shadowBlur = pulsing ? 16 + ((phase % 12) * 0.8) : 14;
    context.shadowColor = palette.glow;
  }

  fillFace(context, projection.left, palette.left, 'rgba(160, 236, 255, 0.18)');
  fillFace(context, projection.right, palette.right, 'rgba(160, 236, 255, 0.22)');
  fillFace(context, projection.top, palette.top, palette.accent);

  if (isCriticalMass(entity)) {
    drawCriticalMassHalo(context, projection, layout, phase);
  }

  context.restore();
}

function drawGoal(context: CanvasRenderingContext2D, entity: Entity, layout: IsoLayout): void {
  const center = toScreen(entity.x + 0.5, entity.y + 0.5, 0.65, layout);
  context.save();
  context.strokeStyle = 'rgba(255, 166, 0, 0.95)';
  context.lineWidth = 2;
  context.shadowBlur = 20;
  context.shadowColor = 'rgba(255, 166, 0, 0.55)';
  context.beginPath();
  context.arc(center.sx, center.sy, layout.tileHeight * 0.55, 0, Math.PI * 2);
  context.stroke();
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
  const center = toScreen(display.x + 0.5, display.y + 0.5, 0.85, layout);
  const radius = layout.tileHeight * 0.6;
  const pulse = 0.72 + ((phase % 10) * 0.04);

  const idleTicks = tick - entity.tick_updated;
  const hasObjective = entity.objective_path != null;
  let opacity = pulse;
  if (!hasObjective && idleTicks > 30) {
    opacity = pulse * Math.max(0, 1 - (idleTicks - 30) / 90);
  }

  if (opacity <= 0.01) {
    return;
  }

  context.save();
  context.beginPath();
  context.moveTo(center.sx, center.sy - radius);
  context.lineTo(center.sx + (radius * 0.9), center.sy);
  context.lineTo(center.sx, center.sy + radius);
  context.lineTo(center.sx - (radius * 0.9), center.sy);
  context.closePath();
  context.fillStyle = withAlpha(palette.fill, opacity);
  context.shadowBlur = 24;
  context.shadowColor = palette.glow;
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = withAlpha(palette.stroke, opacity);
  context.stroke();
  context.restore();
}

function drawEntities(
  context: CanvasRenderingContext2D,
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
    depth: entity.x + entity.y + (getPrismHeight(entity) * 0.1),
    entity,
  }));

  renderables.sort((left, right) => left.depth - right.depth);

  for (const item of renderables) {
    const { entity } = item;
    const display = getInterpolatedPoint(entity, displayPoints);

    if (entity.type === 'agent') {
      drawAgent(context, entity, display, layout, phase, tick);
      continue;
    }

    if (entity.type === 'goal') {
      drawGoal(context, entity, layout);
      continue;
    }

    if (isStructureEntity(entity)) {
      drawStructureEntity(
        context,
        entity,
        display,
        layout,
        phase,
        entity.node_state ?? 'stable',
      );
      continue;
    }

    drawStructureEntity(context, entity, display, layout, phase, 'stable');
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

  const frameRef = useRef<number | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latticeRef = useRef<HTMLDivElement | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabaseClient> | null>(null);
  const entityMapRef = useRef<Map<string, Entity>>(entityMapFromList(PREVIEW_ENTITIES));
  const entityListRef = useRef<Entity[]>(PREVIEW_ENTITIES);
  const displayPointsRef = useRef<Record<string, DisplayPoint>>({});
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

  const agents = entities.filter((entity) => entity.type === 'agent');
  const primaryAgent = agents[0] ?? null;
  const primaryRole = primaryAgent ? (getAgentRole(primaryAgent) ?? 'architect') : 'architect';
  const structureNodes = entities.filter((entity) => isStructureEntity(entity));
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
  const activePathSet = buildActivePathSet((loadedFile ?? activeStructure ?? repositoryRoot)?.path ?? null);
  const gitTree = buildGitTree(structureNodes);
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
  const workforce: WorkforceStatus[] = WORKFORCE_ROLES.map((role) => ({
    agents: agents.filter((entity) => (getAgentRole(entity) ?? 'architect') === role),
    label: getAgentRoleLabel(role),
    role,
  }));
  const codePreview = getCodePreview(loadedFile);
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
          {
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
          },
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
          {
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
          },
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
        .upsert(nextControl, { onConflict: 'id' });

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
          {
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
          },
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
          {
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
          },
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
    routeNodesRef.current = routeNodes;
  }, [routeNodes]);

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

    const handleCanvasClick = (event: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const layout = createIsoLayout(viewport.width, viewport.height);
      const grid = fromScreen(sx, sy, layout);
      const gx = Math.round(grid.x);
      const gy = Math.round(grid.y);

      const candidates = entityListRef.current.filter((entity) =>
        entity.x === gx && entity.y === gy && isStructureEntity(entity),
      );

      if (candidates.length > 0) {
        setSelectedEntity(candidates[0] ?? null);
      } else {
        setSelectedEntity(null);
      }
    };

    canvas.addEventListener('click', handleCanvasClick);
    return () => {
      canvas.removeEventListener('click', handleCanvasClick);
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

      const layout = createIsoLayout(viewport.width, viewport.height);
      drawBackdrop(context, viewport);
      drawGrid(context, layout);
      drawTetherRoute(context, routeNodesRef.current, layout);
      drawEntities(
        context,
        entityListRef.current,
        layout,
        phaseRef.current,
        tickRef.current,
        displayPointsRef.current,
      );

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

    const loadSnapshot = async (): Promise<void> => {
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
    };

    void loadSnapshot().catch((error: unknown) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown Supabase load failure';
      setErrorMessage(message);
      setMode('preview');
    });

    const pollHandle = window.setInterval(() => {
      void loadSnapshot().catch(() => {
        // Realtime remains primary; polling only reconciles missed updates.
      });
    }, 1000);

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
          setMode('live');
        }

        if (status === 'CHANNEL_ERROR') {
          setErrorMessage('Supabase realtime channel failed; showing the last confirmed lattice snapshot.');
        }
      });

    return () => {
      cancelled = true;
      supabaseRef.current = null;
      window.clearInterval(pollHandle);

      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
        flushFrameRef.current = null;
      }

      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <main className="lux-shell">
      <aside className="lux-panel lux-panel-left">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <GitBranch size={14} strokeWidth={1.85} />
            <span className="panel-title">Git Overlay</span>
          </div>
          <span className="panel-subtitle">{structureNodes.length} nodes</span>
        </div>

        <div className="repo-chip">
          <span className="repo-chip-label">Repository</span>
          <span className="repo-chip-value">{activeRepositoryName}</span>
          <span className="repo-chip-path">{activeRepositoryPath ?? 'No repository overlay loaded yet.'}</span>
        </div>

        <form className="control-card" onSubmit={(event) => { void handleControlSubmit(event); }}>
          <div className="control-card-header">
            <div className="protocol-card-title">Operator Control</div>
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

        {worldState.active_tasks && worldState.active_tasks.length > 0 ? (
          <div className="protocol-card">
            <div className="protocol-card-title">Task Pipeline</div>
            <div className="task-stats">
              <span className="task-stat is-pending">{worldState.active_tasks.filter((t) => t.status === 'pending').length} pending</span>
              <span className="task-stat is-active">{worldState.active_tasks.filter((t) => t.status === 'assigned' || t.status === 'in_progress').length} active</span>
              <span className="task-stat is-review">{worldState.active_tasks.filter((t) => t.status === 'awaiting_review').length} review</span>
              <span className="task-stat is-done">{worldState.active_tasks.filter((t) => t.status === 'done').length} done</span>
            </div>
            <div className="task-list">
              {worldState.active_tasks.map((task) => (
                <div className={`task-row status-${task.status}`} key={task.id}>
                  <span className="task-id">{task.id}</span>
                  <span className="task-path">{task.target_path}</span>
                  <span className={`task-badge status-${task.status}`}>{formatTaskStatus(task.status)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="protocol-card">
          <div className="protocol-card-title">Hivemind Workforce</div>
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
                              {
                                id: DEFAULT_OPERATOR_CONTROL.id,
                                repo_path: repoInput.trim(),
                                operator_prompt: directiveInput.trim(),
                                paused: isPaused,
                                automate: isAutomated,
                                visionary_prompt: member.role === 'visionary' ? promptValue.trim() : (worldState.visionary_prompt ?? operatorControl.visionary_prompt ?? ''),
                                architect_prompt: member.role === 'architect' ? promptValue.trim() : (worldState.architect_prompt ?? operatorControl.architect_prompt ?? ''),
                                critic_prompt: member.role === 'critic' ? promptValue.trim() : (worldState.critic_prompt ?? operatorControl.critic_prompt ?? ''),
                              },
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
          </div>
          <div className="protocol-stats">
            <span>Genesis {genesisNodes.length}</span>
            <span>Asymmetry {asymmetryNodes.length}</span>
            <span>Fission {criticalMassNodes.length}</span>
          </div>
        </div>

        <div className="git-tree">
          {gitTree ? (
            <GitTreeItem
              activePathSet={activePathSet}
              depth={0}
              loadedPath={loadedFile?.path ?? null}
              node={gitTree}
              nodeStatesByPath={nodeStatesByPath}
            />
          ) : (
            <p className="panel-placeholder">No Git structure overlay loaded yet.</p>
          )}
        </div>
      </aside>

      <section className="lux-lattice" ref={latticeRef}>
        <canvas className="lux-canvas" ref={canvasRef} />

        <div className="hud-card hud-top-left">
          <div className="hud-label">Global Clock</div>
          <div className="hud-value">{worldState.tick} / {worldState.phase}</div>
          <div className="hud-meta">
            <span>Status: {worldState.status}</span>
            <span>Mode: {mode}</span>
            <span>Agent: {primaryAgent ? `(${primaryAgent.x}, ${primaryAgent.y})` : 'offline'}</span>
          </div>
          <div className="hud-focus">Focus: {buildBreadcrumb(loadedFile ?? activeStructure)}</div>
          <div className="hud-meta">
            <span>Role: {getAgentRoleLabel(primaryRole)}</span>
            <span>Node: {getNodeStateLabel(loadedFileState ?? activeStructureState ?? 'stable')}</span>
          </div>
          <div className="hud-focus">Directive: {activeDirective}</div>
          <div className="hud-meta">
            <span>Control: {formatControlStatus(controlStatus)}</span>
            <span>Target: {operatorTargetPath ?? 'none'}</span>
          </div>
        </div>

        <div className="hud-card hud-bottom-right">
          <div className="hud-label">Hivemind Taxonomy</div>
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
        </div>

        {loadedFile ? (
          <div className="context-window">
            <div className="context-header">
              <div>
                <div className="context-title">Spatial Context Loaded</div>
                <div className="context-path">{loadedFile.path}</div>
              </div>
              <div className="context-badge">{getNodeStateLabel(loadedFileState ?? 'stable')}</div>
            </div>
            <div className="context-meta">
              <span>{loadedFile.descriptor ?? 'Source artifact'}</span>
              <span>Mass {loadedFile.mass}</span>
              <span>Chiral {computeChiralMass(loadedFile)}</span>
              <span>{loadedFile.git_status ?? 'clean'}</span>
            </div>
            <CodeSyntaxPreview code={codePreview} />
          </div>
        ) : null}

        {selectedEntity ? (
          <div className="context-window inspect-panel">
            <div className="context-header">
              <div>
                <div className="context-title">{selectedEntity.name ?? 'Unnamed Node'}</div>
                <div className="context-path">{selectedEntity.path ?? selectedEntity.id}</div>
              </div>
              <button
                className="inspect-close"
                onClick={() => setSelectedEntity(null)}
                type="button"
              >
                ✕
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
        ) : null}

        {errorMessage ? <div className="hud-alert">{errorMessage}</div> : null}
      </section>

      <aside className="lux-panel lux-panel-right">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <GitBranch size={14} strokeWidth={1.85} />
            <span className="panel-title">AI Cognition Log</span>
          </div>
          <span className="panel-subtitle">{mode === 'live' ? 'live feed' : 'preview feed'}</span>
        </div>

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

        <div className="cognition-footer">
          <div>Nearest Node: {activeStructure?.name ?? 'none'}</div>
          <div>Verified: {verifiedNodes.length}</div>
          <div>Critical Mass: {criticalMassNodes.length}</div>
          <div>Tick: {formatDuration(worldState.last_tick_duration_ms)}</div>
          <div>AI: {formatDuration(worldState.last_ai_latency_ms)}</div>
          <div>Queue: {worldState.queue_depth ?? 0}</div>
        </div>
      </aside>
    </main>
  );
}

export default App;
