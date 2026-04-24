import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import { ChevronLeft, ChevronRight, FileCode, Folder, GitBranch, PanelLeft, PanelRight, X } from 'lucide-react';

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
import { drawTethers } from './tether-render';
import {
  createIsoLayout,
  createPrismProjection,
  DEFAULT_CAMERA,
  fromScreen,
  toScreen,
  traceFace,
  type Camera,
  type IsoLayout,
} from './iso';
import { ParticleSystem } from './particles';
import {
  drawBuilding,
  drawDrone,
  drawGoal,
  drawPheromone,
  drawCommandCenter,
  drawHoverHighlight,
  drawSelectionRing,
} from './city-renderer';
import { getBuildingHeight } from './building-styles';

interface Viewport {
  height: number;
  width: number;
}

interface DisplayPoint {
  x: number;
  y: number;
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

// Demo entities for vibe coder onboarding — shows all building styles
const DEMO_ENTITIES: Entity[] = [
  {
    id: 'demo-cmd',
    type: 'command_center',
    x: 25,
    y: 25,
    z: 0,
    mass: 5,
    tick_updated: 0,
    name: 'Command Center Alpha',
  },
  {
    id: 'demo-api',
    type: 'file',
    x: 22,
    y: 22,
    z: 0,
    mass: 5,
    tick_updated: 0,
    name: 'api.ts',
    path: 'src/api.ts',
    extension: '.ts',
    node_state: 'stable',
    git_status: 'clean',
    content_preview: '// API routes and handlers\nexport async function handleRequest(req: Request) { ... }',
  },
  {
    id: 'demo-components',
    type: 'directory',
    x: 28,
    y: 22,
    z: 0,
    mass: 5,
    tick_updated: 0,
    name: 'components',
    path: 'src/components',
    node_state: 'stable',
    git_status: 'clean',
  },
  {
    id: 'demo-button',
    type: 'file',
    x: 27,
    y: 23,
    z: 0,
    mass: 3,
    tick_updated: 0,
    name: 'Button.tsx',
    path: 'src/components/Button.tsx',
    extension: '.tsx',
    node_state: 'stable',
    git_status: 'clean',
    content_preview: 'export function Button({ children, onClick }) { ... }',
  },
  {
    id: 'demo-styles',
    type: 'file',
    x: 29,
    y: 23,
    z: 0,
    mass: 2,
    tick_updated: 0,
    name: 'styles.css',
    path: 'src/styles.css',
    extension: '.css',
    node_state: 'stable',
    git_status: 'clean',
    content_preview: '.button { background: #56d9ff; }',
  },
  {
    id: 'demo-readme',
    type: 'file',
    x: 25,
    y: 28,
    z: 0,
    mass: 1,
    tick_updated: 0,
    name: 'README.md',
    path: 'README.md',
    extension: '.md',
    node_state: 'stable',
    git_status: 'clean',
    content_preview: '# My Project\n\nA spatial codebase visualization.',
  },
  {
    id: 'demo-config',
    type: 'file',
    x: 23,
    y: 28,
    z: 0,
    mass: 2,
    tick_updated: 0,
    name: 'package.json',
    path: 'package.json',
    extension: '.json',
    node_state: 'stable',
    git_status: 'clean',
    content_preview: '{ "name": "my-project", "version": "1.0.0" }',
  },
  {
    id: 'demo-test',
    type: 'file',
    x: 27,
    y: 28,
    z: 0,
    mass: 3,
    tick_updated: 0,
    name: 'api.test.ts',
    path: 'src/api.test.ts',
    extension: '.test.ts',
    node_state: 'verified',
    git_status: 'clean',
    content_preview: 'test("API handles requests", () => { ... })',
  },
  {
    id: 'demo-bigfile',
    type: 'file',
    x: 20,
    y: 25,
    z: 0,
    mass: 8,
    tick_updated: 0,
    name: 'legacy.ts',
    path: 'src/legacy.ts',
    extension: '.ts',
    node_state: 'asymmetry',
    git_status: 'modified',
    content_preview: '// 5000 lines of messy code\nfunction doEverything() { ... }',
  },
];

const PREVIEW_ENTITIES = [...createInitialEntities(DEFAULT_SEED), ...DEMO_ENTITIES].sort((left, right) =>
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

interface StructureFocus {
  distance: number;
  entity: Entity | null;
}

function getNearestStructure(agent: Entity | null, entities: Entity[]): StructureFocus {
  if (!agent) {
    return { distance: Infinity, entity: null };
  }

  const structures = entities.filter((entity) => isStructureEntity(entity));
  let nearest: StructureFocus = { distance: Infinity, entity: null };

  for (const structure of structures) {
    const distance = manhattanDistance(agent, structure);
    if (distance < nearest.distance) {
      nearest = { distance, entity: structure };
    }
  }

  return nearest;
}

function getLoadedFile(agent: Entity | null, entities: Entity[]): Entity | null {
  if (!agent) {
    return null;
  }

  const files = entities.filter((entity) => entity.type === 'file');
  const match = files.find((file) => file.x === agent.x && file.y === agent.y);
  return match ?? null;
}

function buildRouteNodes(focus: Entity | null, entityByPath: Map<string, Entity>): Entity[] {
  if (!focus || !focus.path) {
    return [];
  }

  const segments = focus.path.split('/');
  const nodes: Entity[] = [];

  for (let index = 1; index <= segments.length; index += 1) {
    const partial = segments.slice(0, index).join('/');
    const match = entityByPath.get(partial);
    if (match) {
      nodes.push(match);
    }
  }

  return nodes;
}

function createLogEntry(kind: LogKind, tick: number, message: string): LogEntry {
  return {
    id: `${tick}-${kind}-${Date.now()}`,
    kind,
    message,
    tick,
    timestamp: formatTimestamp(),
  };
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
  const [controlMessage, setControlMessage] = useState<string>('Drag anywhere on the canvas to drop a prompt. Or import a repository below.');
  const [isSavingControl, setIsSavingControl] = useState(false);
  const [mode, setMode] = useState<'preview' | 'live'>('preview');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ height: 720, width: 1280 });
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [contextTab, setContextTab] = useState<'code' | 'explanation'>('code');
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [camera, setCamera] = useState<Camera>({ panX: 0, panY: 0, zoom: 0.85 });
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);

  // Drag-to-prompt state
  const [isPromptDragging, setIsPromptDragging] = useState(false);
  const [promptDragStart, setPromptDragStart] = useState<{ sx: number; sy: number } | null>(null);
  const [promptDragCurrent, setPromptDragCurrent] = useState<{ sx: number; sy: number } | null>(null);
  const [promptInput, setPromptInput] = useState<string>('');
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [promptWorldPos, setPromptWorldPos] = useState<{ x: number; y: number } | null>(null);

  // Welcome overlay for first-time vibe coders
  const [showWelcome, setShowWelcome] = useState(true);

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
  const particlesRef = useRef<ParticleSystem>(new ParticleSystem());
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
  const inspectPanelRef = useRef<HTMLDivElement | null>(null);

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
    const height = getBuildingHeight(selectedEntity);
    const center = toScreen(
      selectedEntity.x + 0.5,
      selectedEntity.y + 0.5,
      height + 0.8,
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

  // Spawn command center from drag-prompt
  const handlePromptDrop = async (): Promise<void> => {
    if (!promptWorldPos || !promptInput.trim()) return;
    
    const supabase = supabaseRef.current;
    if (!supabase) {
      // Preview mode: just add the command center locally
      const newCmd: Entity = {
        id: `cmd-${Date.now()}`,
        type: 'command_center',
        x: Math.floor(promptWorldPos.x),
        y: Math.floor(promptWorldPos.y),
        z: 0,
        mass: 5,
        tick_updated: tickRef.current,
        name: promptInput.slice(0, 40),
        message: promptInput,
      };
      entityMapRef.current.set(newCmd.id, newCmd);
      entityListRef.current = createEntityList(entityMapRef.current);
      setEntities(entityListRef.current);
      setControlMessage(`Command Center spawned at (${newCmd.x}, ${newCmd.y}): "${promptInput.slice(0, 50)}"`);
      particlesRef.current.spawnCommandCenterDrop(newCmd.x + 0.5, newCmd.y + 0.5);
      return;
    }

    // Live mode: create command center + set operator prompt
    try {
      setIsSavingControl(true);
      
      // Insert command center entity
      const { error: entityError } = await supabase.from('entities').insert({
        id: `cmd-${Date.now()}`,
        type: 'command_center',
        x: Math.floor(promptWorldPos.x),
        y: Math.floor(promptWorldPos.y),
        z: 0,
        mass: 5,
        tick_updated: tickRef.current,
        name: promptInput.slice(0, 40),
        message: promptInput,
      });
      
      if (entityError) throw entityError;

      // Set the operator prompt to activate agents
      const { error: controlError } = await supabase
        .from('operator_controls')
        .upsert(
          {
            id: DEFAULT_OPERATOR_CONTROL.id,
            repo_path: repoInput.trim(),
            operator_prompt: promptInput.trim(),
            paused: false,
            automate: true,
          },
          { onConflict: 'id' },
        );

      if (controlError) throw controlError;

      setControlMessage(`Agents dispatched! Command Center at (${Math.floor(promptWorldPos.x)}, ${Math.floor(promptWorldPos.y)}) processing: "${promptInput.slice(0, 50)}..."`);
      particlesRef.current.spawnCommandCenterDrop(Math.floor(promptWorldPos.x) + 0.5, Math.floor(promptWorldPos.y) + 0.5);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setControlMessage(`Failed to spawn Command Center: ${message}`);
    } finally {
      setIsSavingControl(false);
    }
  };

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
          {
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
          },
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

    setControlMessage('Drag anywhere on the canvas to drop a prompt. Or import a repository below.');
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
    selectedEntityRef.current = selectedEntity;
  }, [selectedEntity]);

  useEffect(() => {
    if (selectedEntity && !leftPanelOpen) {
      setLeftPanelOpen(true);
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
    const PROMPT_DRAG_THRESHOLD = 12;
    const LONG_PRESS_DELAY = 400;
    let isMouseDown = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let isPanning = false;
    let lastPanX = 0;
    let lastPanY = 0;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let didLongPress = false;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      setCamera((prev) => {
        const oldLayout = createIsoLayout(viewport.width, viewport.height, prev);
        const worldBefore = fromScreen(mouseX, mouseY, oldLayout);
        const newZoom = Math.max(0.3, Math.min(4, prev.zoom * (event.deltaY < 0 ? 1.12 : 0.88)));
        const next: Camera = { ...prev, zoom: newZoom };
        const newLayout = createIsoLayout(viewport.width, viewport.height, next);
        const worldAfter = fromScreen(mouseX, mouseY, newLayout);
        return {
          ...next,
          panX: prev.panX + ((worldAfter.x - worldBefore.x) * newLayout.tileWidth * 0.5),
          panY: prev.panY + ((worldAfter.y - worldBefore.y) * newLayout.tileHeight * 0.5),
        };
      });
    };

    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button === 0) {
        isMouseDown = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        isPanning = false;
        didLongPress = false;

        // Check if clicking on empty space (not on an entity)
        const rect = canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const layout = createIsoLayout(viewport.width, viewport.height, camera);
        
        const nearest = entityListRef.current
          .filter((e) => isStructureEntity(e) || e.type === 'command_center')
          .map((entity) => {
            const center = toScreen(entity.x + 0.5, entity.y + 0.5, 0.5, layout);
            const dist = Math.hypot(center.sx - sx, center.sy - sy);
            return { entity, dist };
          })
          .filter((item) => item.dist < layout.tileHeight * 1.4)
          .sort((a, b) => a.dist - b.dist)[0];

        if (!nearest) {
          // Clicked on empty space — start long-press timer for prompt drag
          longPressTimer = setTimeout(() => {
            didLongPress = true;
            setIsPromptDragging(true);
            setPromptDragStart({ sx, sy });
            setPromptDragCurrent({ sx, sy });
            setPromptInput('');
            setShowPromptInput(true);
            const worldPos = fromScreen(sx, sy, layout);
            setPromptWorldPos({ x: worldPos.x, y: worldPos.y });
            canvas.style.cursor = 'crosshair';
          }, LONG_PRESS_DELAY);
        }
      } else if (event.button === 1) {
        isPanning = true;
        lastPanX = event.clientX;
        lastPanY = event.clientY;
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (event: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;

      if (isPromptDragging) {
        setPromptDragCurrent({ sx, sy });
        return;
      }

      if (isMouseDown && !isPanning && !didLongPress) {
        const dx = event.clientX - dragStartX;
        const dy = event.clientY - dragStartY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          // Cancel long press if dragged too far
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          isPanning = true;
          lastPanX = event.clientX;
          lastPanY = event.clientY;
          canvas.style.cursor = 'grabbing';
        }
      }

      if (isPanning) {
        const dx = event.clientX - lastPanX;
        const dy = event.clientY - lastPanY;
        lastPanX = event.clientX;
        lastPanY = event.clientY;
        setCamera((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
        return;
      }

      const layout = createIsoLayout(viewport.width, viewport.height, camera);

      const nearest = entityListRef.current
        .filter((e) => isStructureEntity(e))
        .map((entity) => {
          const center = toScreen(entity.x + 0.5, entity.y + 0.5, 0.5, layout);
          const dist = Math.hypot(center.sx - sx, center.sy - sy);
          return { entity, dist };
        })
        .filter((item) => item.dist < layout.tileHeight * 1.2)
        .sort((a, b) => a.dist - b.dist)[0];

      setHoveredEntityId(nearest?.entity.id ?? null);
      canvas.style.cursor = nearest ? 'pointer' : 'default';
    };

    const handleMouseUp = (event: MouseEvent): void => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (isPromptDragging) {
        // Prompt drag released — keep the input visible for typing
        setIsPromptDragging(false);
        canvas.style.cursor = 'default';
        // Don't clear promptDragCurrent so we know where to position the input
        return;
      }

      if (isPanning) {
        isPanning = false;
        isMouseDown = false;
        canvas.style.cursor = 'default';
        return;
      }

      if (isMouseDown) {
        isMouseDown = false;
        const rect = canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const layout = createIsoLayout(viewport.width, viewport.height, camera);

        const nearest = entityListRef.current
          .filter((e) => isStructureEntity(e))
          .map((entity) => {
            const center = toScreen(entity.x + 0.5, entity.y + 0.5, 0.5, layout);
            const dist = Math.hypot(center.sx - sx, center.sy - sy);
            return { entity, dist };
          })
          .filter((item) => item.dist < layout.tileHeight * 1.4)
          .sort((a, b) => a.dist - b.dist)[0];

        setSelectedEntity(nearest?.entity ?? null);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (longPressTimer) clearTimeout(longPressTimer);
    };
  }, [viewport, camera]);

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
      drawBackdrop(context, viewport);
      drawGrid(context, layout);
      drawTethers(context, entityListRef.current, layout, phaseRef.current);

      // Update particles
      particlesRef.current.update();

      const activeIds = new Set(entityListRef.current.map((e) => e.id));
      for (const id of Object.keys(displayPointsRef.current)) {
        if (!activeIds.has(id)) {
          delete displayPointsRef.current[id];
        }
      }

      // Sort renderables by depth for proper isometric ordering
      const renderables = entityListRef.current.map((entity) => {
        const display = getInterpolatedPoint(entity, displayPointsRef.current);
        const height = entity.type === 'directory' ? 1.2 : entity.type === 'file' ? Math.min(8, Math.max(0.8, (entity.mass ?? 1) * 0.5)) : entity.type === 'wall' ? 1.5 : 0.7;
        return {
          depth: display.x + display.y + (height * 0.1),
          entity,
          display,
        };
      });

      renderables.sort((left, right) => left.depth - right.depth);

      // Draw each entity with new city renderer
      for (const item of renderables) {
        const { entity, display } = item;

        if (entity.type === 'command_center') {
          drawCommandCenter(context, entity, display.x, display.y, layout, phaseRef.current);
          continue;
        }

        if (entity.type === 'pheromone') {
          drawPheromone(context, entity, display.x, display.y, layout, phaseRef.current);
          continue;
        }

        if (entity.type === 'agent') {
          drawDrone(context, entity, display.x, display.y, layout, phaseRef.current, tickRef.current);
          continue;
        }

        if (entity.type === 'goal') {
          drawGoal(context, entity, layout, phaseRef.current);
          continue;
        }

        if (isStructureEntity(entity) || entity.type === 'wall') {
          drawBuilding(context, entity, display.x, display.y, layout, phaseRef.current, entity.node_state ?? 'stable');
          continue;
        }
      }

      // Draw particles on top
      particlesRef.current.draw(context);

      // Draw prompt drag line
      if (isPromptDragging && promptDragStart && promptDragCurrent) {
        context.beginPath();
        context.moveTo(promptDragStart.sx, promptDragStart.sy);
        context.lineTo(promptDragCurrent.sx, promptDragCurrent.sy);
        context.strokeStyle = 'rgba(236, 72, 153, 0.8)';
        context.lineWidth = 2;
        context.setLineDash([5, 5]);
        context.stroke();
        context.setLineDash([]);
        
        // Draw target circle
        context.beginPath();
        context.arc(promptDragCurrent.sx, promptDragCurrent.sy, 8, 0, Math.PI * 2);
        context.fillStyle = 'rgba(236, 72, 153, 0.3)';
        context.fill();
        context.strokeStyle = 'rgba(236, 72, 153, 0.8)';
        context.lineWidth = 2;
        context.stroke();
      }

      // Minimap - StarCraft style
      const mapSize = 140;
      const mapPadding = 16;
      const mapX = mapPadding;
      const mapY = viewport.height - mapSize - mapPadding;
      const mapScale = mapSize / 50;

      context.save();
      // Minimap background
      context.fillStyle = 'rgba(2, 6, 12, 0.92)';
      context.strokeStyle = 'rgba(86, 217, 255, 0.45)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.roundRect(mapX, mapY, mapSize, mapSize, 8);
      context.fill();
      context.stroke();

      // Minimap grid
      context.strokeStyle = 'rgba(46, 201, 255, 0.12)';
      context.lineWidth = 0.5;
      for (let mx = 0; mx <= 50; mx += 5) {
        context.beginPath();
        context.moveTo(mapX + mx * mapScale, mapY);
        context.lineTo(mapX + mx * mapScale, mapY + mapSize);
        context.stroke();
      }
      for (let my = 0; my <= 50; my += 5) {
        context.beginPath();
        context.moveTo(mapX, mapY + my * mapScale);
        context.lineTo(mapX + mapSize, mapY + my * mapScale);
        context.stroke();
      }

      // Draw entities on minimap
      for (const entity of entityListRef.current) {
        const mx = mapX + entity.x * mapScale;
        const my = mapY + entity.y * mapScale;
        if (entity.type === 'agent') {
          context.fillStyle = entity.agent_role === 'visionary' ? '#ec4899' : entity.agent_role === 'critic' ? '#ef4444' : '#10b981';
          context.shadowBlur = 4;
          context.shadowColor = context.fillStyle;
          context.beginPath();
          context.arc(mx, my, 2.5, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
        } else if (entity.type === 'wall') {
          context.fillStyle = 'rgba(255, 255, 255, 0.35)';
          context.fillRect(mx - 1, my - 1, 2, 2);
        } else if (entity.type === 'file' || entity.type === 'directory') {
          const ns = entity.node_state ?? 'stable';
          const colors: Record<string, string> = {
            task: '#ec4899',
            'in-progress': '#fb923c',
            asymmetry: '#fde047',
            verified: '#22c55e',
            stable: '#56d9ff',
          };
          context.fillStyle = colors[ns] ?? '#56d9ff';
          context.fillRect(mx - 1.5, my - 1.5, 3, 3);
        } else if (entity.type === 'command_center') {
          context.fillStyle = '#ec4899';
          context.shadowBlur = 6;
          context.shadowColor = '#ec4899';
          context.beginPath();
          context.arc(mx, my, 3, 0, Math.PI * 2);
          context.fill();
          context.shadowBlur = 0;
        }
      }

      // Viewport rectangle on minimap
      const visibleW = Math.min(mapSize * 0.4, viewport.width / (layout.tileWidth * camera.zoom) * mapScale * 0.5);
      const visibleH = Math.min(mapSize * 0.4, viewport.height / (layout.tileHeight * camera.zoom) * mapScale * 0.5);
      const viewCenterX = mapX + 25 * mapScale - (camera.panX / layout.tileWidth / camera.zoom) * mapScale;
      const viewCenterY = mapY + 25 * mapScale - (camera.panY / layout.tileHeight / camera.zoom) * mapScale;
      context.strokeStyle = 'rgba(86, 217, 255, 0.8)';
      context.lineWidth = 1.5;
      context.strokeRect(
        Math.max(mapX, viewCenterX - visibleW),
        Math.max(mapY, viewCenterY - visibleH),
        Math.min(mapSize - 2, visibleW * 2),
        Math.min(mapSize - 2, visibleH * 2),
      );

      context.restore();

      if (hoveredEntityId) {
        const hovered = entityListRef.current.find((e) => e.id === hoveredEntityId);
        if (hovered) {
          const display = getInterpolatedPoint(hovered, displayPointsRef.current);
          drawHoverHighlight(context, hovered, layout, display.x, display.y);
        }
      }

      const selected = selectedEntityRef.current;
      if (selected) {
        const display = getInterpolatedPoint(selected, displayPointsRef.current);
        drawSelectionRing(context, selected, layout, display.x, display.y, phaseRef.current);
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
  }, [viewport, camera, hoveredEntityId, agents, isPromptDragging, promptDragStart, promptDragCurrent]);

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
      <QueenHUD
        cycle={worldState.queen_cycle ?? 0}
        alarm={worldState.queen_alarm ?? 0}
        urgency={worldState.queen_urgency ?? 0}
      />
      
      {/* Welcome overlay for vibe coders */}
      {showWelcome && mode === 'preview' && (
        <div className="welcome-overlay" onClick={() => setShowWelcome(false)}>
          <div className="welcome-content" onClick={(e) => e.stopPropagation()}>
            <div className="welcome-title">🌆 Repocity</div>
            <div className="welcome-subtitle">Your code is a city. You are the mayor.</div>
            <div className="welcome-instructions">
              <div className="welcome-step">
                <span className="welcome-step-number">1</span>
                <span>Hold click on empty space, drag to draw a line</span>
              </div>
              <div className="welcome-step">
                <span className="welcome-step-number">2</span>
                <span>Type what you want to build</span>
              </div>
              <div className="welcome-step">
                <span className="welcome-step-number">3</span>
                <span>Watch agents construct it in real-time</span>
              </div>
            </div>
            <button className="welcome-button" onClick={() => setShowWelcome(false)}>
              Enter the City
            </button>
          </div>
        </div>
      )}

      {/* Floating prompt input during drag */}
      {showPromptInput && promptDragCurrent && (
        <div
          className="floating-prompt"
          style={{
            left: Math.min(promptDragCurrent.sx + 20, viewport.width - 300),
            top: Math.max(20, promptDragCurrent.sy - 60),
          }}
        >
          <input
            type="text"
            className="floating-prompt-input"
            placeholder="What should the agents build?"
            value={promptInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPromptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && promptInput.trim()) {
                void handlePromptDrop();
                setShowPromptInput(false);
                setPromptInput('');
              }
              if (e.key === 'Escape') {
                setShowPromptInput(false);
                setPromptInput('');
              }
            }}
            autoFocus
          />
          <div className="floating-prompt-hint">
            Press Enter to dispatch agents · Escape to cancel
          </div>
        </div>
      )}
      
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
          <>
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
              placeholder="C:\Users\Futureman\Desktop\lucianprotocol"
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
        ) : null}

        {selectedEntity ? (
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
        ) : null}
          </>
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
            onClick={() => setCamera(DEFAULT_CAMERA)}
            title="Reset view"
            type="button"
          >
            ⌂
          </button>
          <span className="zoom-level">{Math.round(camera.zoom * 100)}%</span>
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
          <>
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

        {worldState.agent_activities && worldState.agent_activities.length > 0 ? (
          <div className="activity-panel">
            <div className="activity-panel-title">Workforce Activity</div>
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
        ) : null}

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

        <div className="panel-card legend-panel">
          <div className="panel-card-title">Hivemind Taxonomy</div>
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
          </>
        ) : null}
      </aside>
    </main>
  );
}

export default App;
