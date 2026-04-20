import 'dotenv/config';

import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { simpleGit } from 'simple-git';

import { GeminiNavigator } from './ai';
import { computeChiralMass, getAgentRole } from './hivemind';
import { resolveOperatorDirective } from './operator-control';
import {
  CLOCK_PERIOD,
  DEFAULT_SEED,
  GOAL_POSITION,
  GRID_HEIGHT,
  GRID_WIDTH,
  MAX_TICKS,
  TICK_INTERVAL_MS,
  WORLD_STATE_ID,
  createInitialEntities,
  isSolidEntity,
  isWithinBounds,
  manhattanDistance,
  step,
  toIndex,
} from './seed';
import {
  createRepositoryOverlay,
  listSavedRepositoryOverlays,
  loadNamedRepositoryOverlaySync,
  loadRepositoryOverlaySync,
  saveRepositoryOverlay,
} from './git-parser';
import { isStructureEntity } from './mass-mapper';
import { createServiceSupabaseClient } from './supabase';
import {
  OperatorControlSchema,
  type AgentDecision,
  type AgentRole,
  type ControlStatus,
  type Direction,
  type Entity,
  type NeighborhoodScan,
  type NodeState,
  type OperatorAction,
  type OperatorControl,
  type Position,
  type QueuedDecision,
  type TileObservation,
  type WorldSnapshot,
  type WorldState,
  type WorldStatus,
  type Task,
} from './types';

interface PendingAiRequest {
  runId: number;
  startedAtMs: number;
}

const CLOCKWISE_SHIFT: Record<Direction, Direction> = {
  north: 'east',
  east: 'south',
  south: 'west',
  west: 'north',
};

const COUNTER_CLOCKWISE_SHIFT: Record<Direction, Direction> = {
  north: 'west',
  east: 'north',
  south: 'east',
  west: 'south',
};

const VERIFICATION_TTL_TICKS = 12;
const ARCHITECT_WORK_TICKS = 4;
const CRITIC_REVIEW_TICKS = 3;
const CONTROL_ROW_ID = 'lux-control';
const CONTROL_POLL_INTERVAL_TICKS = 10;

export function findReadableTargetInEntities(
  entities: readonly Entity[],
  agent: Position,
  targetName: string | undefined,
): Entity | null {
  if (!targetName) {
    return null;
  }

  const positions: Position[] = [
    { x: agent.x, y: agent.y },
    { x: agent.x, y: agent.y - 1 },
    { x: agent.x + 1, y: agent.y },
    { x: agent.x, y: agent.y + 1 },
    { x: agent.x - 1, y: agent.y },
  ];

  for (const position of positions) {
    for (const entity of entities) {
      if (entity.x !== position.x || entity.y !== position.y) {
        continue;
      }

      if (entity.type !== 'file' && entity.type !== 'directory') {
        continue;
      }

      if (entity.name === targetName || entity.path === targetName) {
        return entity;
      }
    }
  }

  return null;
}

export class LuxEngine {
  private readonly entities = new Map<string, Entity>();
  private readonly solidGrid: Array<string | null> = Array.from(
    { length: GRID_WIDTH * GRID_HEIGHT },
    () => null,
  );
  private readonly positionIndex = new Map<string, string[]>();
  private readonly agentIds: string[] = [];
  private readonly decisionQueue = new Map<string, QueuedDecision>();
  private readonly pendingAiAgents = new Map<string, PendingAiRequest>();
  private readonly aiNavigator = new GeminiNavigator();
  private readonly supabase = createServiceSupabaseClient();
  private readonly syncPipeline: Promise<void> = Promise.resolve();

  private absoluteTick = 0;
  private structureEntitiesCache: Entity[] | null = null;
  private activeRepoName: string | null = null;
  private activeRepoPath: string | null = null;
  private controlStatus: ControlStatus = 'idle';
  private controlError: string | null = null;
  private operatorAction: OperatorAction | null = null;
  private operatorTargetQuery: string | null = null;
  private operatorTargetPath: string | null = null;
  private importStartedAt: string | null = null;
  private importFinishedAt: string | null = null;
  private lastImportDurationMs: number | null = null;
  private lastTickDurationMs: number | null = null;
  private lastAiLatencyMs: number | null = null;
  private maxAiLatencyMs: number | null = null;
  private lastControlSignature = '';
  private lastControlPollTick = -CONTROL_POLL_INTERVAL_TICKS;
  private operatorPrompt = '';
  private paused = false;
  private automate = false;
  private visionaryPrompt = '';
  private architectPrompt = '';
  private criticPrompt = '';
  private pendingOverlay:
    | {
      entities: Entity[];
      repoName: string;
      repoPath: string;
    }
    | null = null;
  private pendingStructurePurge = false;
  private repoImportPromise: Promise<void> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private restartHandle: ReturnType<typeof setTimeout> | null = null;
  private goalId = '';
  private hasLoggedSupabaseDisabled = false;
  private syncQueue = Promise.resolve();
  private currentRunId = 0;
  private savedOverlayNames: string[] = [];
  private activeTasks: Task[] = [];
  private lastOperatorPromptForPlanning = '';
  private visionaryPlanningPromise: Promise<void> | null = null;
  private criticReviewPromise: Promise<void> | null = null;
  private visionaryFinalReviewPromise: Promise<void> | null = null;

  public constructor(
    private readonly seed: string,
    private readonly tickIntervalMs = TICK_INTERVAL_MS,
    private readonly maxTicks = MAX_TICKS,
    private readonly loopRuns = false,
    private readonly restartDelayMs = 1500,
  ) {
    this.resetWorld();
    void this.syncPipeline;
  }

  public start(): void {
    this.startRun('boot');
  }

  public stop(reason: string): void {
    this.clearScheduledWork();
    console.log(`[stop] ${reason}`);
  }

  private startRun(mode: 'boot' | 'reset'): void {
    const structureCount = this.getStructureEntities().length;

    console.log(
      `[${mode}] Lux engine seed=${this.seed} interval=${this.tickIntervalMs}ms period=${CLOCK_PERIOD} max_ticks=${this.maxTicks} ai=${this.aiNavigator.isConfigured() ? 'configured' : 'wait-only'} supabase=${this.supabase ? 'configured' : 'disabled'} loop=${this.loopRuns ? 'on' : 'off'} structures=${structureCount}`,
    );

    this.queueSupabaseSync();
    this.intervalHandle = setInterval(() => {
      this.tickLoop();
    }, this.tickIntervalMs);
  }

  private clearScheduledWork(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    if (this.restartHandle !== null) {
      clearTimeout(this.restartHandle);
      this.restartHandle = null;
    }
  }

  private resetWorld(structureEntities?: Entity[]): void {
    this.currentRunId += 1;
    this.absoluteTick = 0;
    this.goalId = '';
    this.lastTickDurationMs = null;
    this.lastAiLatencyMs = null;
    this.maxAiLatencyMs = null;
    this.entities.clear();
    this.invalidateStructureCache();
    this.agentIds.length = 0;
    this.decisionQueue.clear();
    this.pendingAiAgents.clear();
    this.solidGrid.fill(null);
    this.positionIndex.clear();
    this.savedOverlayNames = listSavedRepositoryOverlays();
    this.activeTasks = [];
    this.lastOperatorPromptForPlanning = '';
    this.visionaryPlanningPromise = null;
    this.criticReviewPromise = null;
    this.visionaryFinalReviewPromise = null;

    for (const entity of createInitialEntities(this.seed)) {
      this.registerEntity(entity);
    }

    const repositoryEntities = structureEntities ?? loadRepositoryOverlaySync();

    for (const entity of repositoryEntities) {
      this.registerEntity(entity);
    }

    this.updateActiveRepositoryMetadata(repositoryEntities);
    this.syncOperatorIntent(repositoryEntities);

    this.updateHivemindState();

    if (this.goalId.length === 0) {
      throw new Error('Initial world is missing a goal entity.');
    }
  }

  private updateActiveRepositoryMetadata(structureEntities: Entity[]): void {
    const repositoryRoot =
      structureEntities.find((entity) => entity.type === 'directory' && entity.path === '.')
      ?? structureEntities[0]
      ?? null;

    this.activeRepoPath = repositoryRoot?.repo_root ?? this.activeRepoPath;
    this.activeRepoName = repositoryRoot?.name ?? this.activeRepoName;
  }

  private nowIsoString(): string {
    return new Date().toISOString();
  }

  private normalizeRepositoryPath(value: string): string {
    return value.trim().length === 0
      ? ''
      : path.resolve(value).replace(/\\/g, '/');
  }

  private getQueueDepth(): number {
    return this.decisionQueue.size + this.pendingAiAgents.size;
  }

  private getOperatorTargetEntity(): Entity | null {
    if (!this.operatorTargetPath) {
      return null;
    }

    for (const entity of this.getStructureEntities()) {
      if (entity.path === this.operatorTargetPath) {
        return entity;
      }
    }

    return null;
  }

  private syncOperatorIntent(structureEntities = this.getStructureEntities()): void {
    const directive = resolveOperatorDirective(this.operatorPrompt, structureEntities);

    this.operatorAction = directive.normalizedPrompt ? directive.action : null;
    this.operatorTargetQuery = directive.targetQuery;
    this.operatorTargetPath = directive.target?.path ?? null;

    if (directive.normalizedPrompt === null) {
      this.controlStatus = 'idle';
      this.controlError = null;
      return;
    }

    if (directive.targetQuery && directive.target === null) {
      this.controlStatus = 'error';
      this.controlError = `Target "${directive.targetQuery}" was not found in the active repository.`;
      return;
    }

    this.controlStatus = 'active';
    this.controlError = null;
  }

  private applyPendingOverlayIfReady(): void {
    if (this.pendingOverlay === null) {
      return;
    }

    const overlay = this.pendingOverlay;
    this.pendingOverlay = null;
    this.activeRepoPath = overlay.repoPath;
    this.activeRepoName = overlay.repoName;
    this.pendingStructurePurge = true;
    this.resetWorld(overlay.entities);
    this.syncOperatorIntent(overlay.entities);
    console.log(`[control] activated repository overlay repo=${overlay.repoName} path=${overlay.repoPath}`);
  }

  private pollOperatorControlsIfNeeded(): void {
    if (!this.supabase || this.repoImportPromise !== null) {
      return;
    }

    const supabase = this.supabase;

    if ((this.absoluteTick - this.lastControlPollTick) < CONTROL_POLL_INTERVAL_TICKS) {
      return;
    }

    this.lastControlPollTick = this.absoluteTick;

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('operator_controls')
          .select('*')
          .eq('id', CONTROL_ROW_ID)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!data) {
          return;
        }

        const parsedControl = OperatorControlSchema.parse(data);
        await this.handleOperatorControl(parsedControl);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown control poll error';
        console.error(`[control] ${message}`);
      }
    })();
  }

  private async handleOperatorControl(control: OperatorControl): Promise<void> {
    const nextRepoPath = control.repo_path.trim();
    const normalizedRepoPath = this.normalizeRepositoryPath(nextRepoPath);
    const nextPrompt = control.operator_prompt.trim();
    const signature = `${normalizedRepoPath}\n${nextPrompt}`;

    if (signature === this.lastControlSignature && this.paused === (control.paused ?? false) && this.automate === (control.automate ?? false)) {
      await this.processPendingEdits(control);
      await this.processCommitAndPush(control);
      return;
    }

    this.paused = control.paused ?? false;
    this.automate = control.automate ?? false;
    this.visionaryPrompt = control.visionary_prompt ?? '';
    this.architectPrompt = control.architect_prompt ?? '';
    this.criticPrompt = control.critic_prompt ?? '';
    this.operatorPrompt = nextPrompt;

    await this.processPendingEdits(control);
    await this.processCommitAndPush(control);

    if (normalizedRepoPath.length === 0 || normalizedRepoPath === this.activeRepoPath) {
      this.syncOperatorIntent();
      this.lastControlSignature = signature;
      console.log('[control] updated operator prompt');
      return;
    }

    this.controlStatus = 'importing';
    this.controlError = null;
    this.importStartedAt = this.nowIsoString();
    this.importFinishedAt = null;
    this.lastImportDurationMs = null;

    const importStartedAtMs = performance.now();

    try {
      this.repoImportPromise = this.importRepositoryOverlay(normalizedRepoPath)
        .finally(() => {
          this.repoImportPromise = null;
        });

      await this.repoImportPromise;
      this.importFinishedAt = this.nowIsoString();
      this.lastImportDurationMs = Math.max(0, Math.round(performance.now() - importStartedAtMs));
      this.lastControlSignature = signature;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown repository import failure';
      this.controlStatus = 'error';
      this.controlError = message;
      this.importFinishedAt = this.nowIsoString();
      this.lastImportDurationMs = Math.max(0, Math.round(performance.now() - importStartedAtMs));
      this.lastControlSignature = signature;
      console.error(`[control] ${message}`);
    }
  }

  private async importRepositoryOverlay(repositoryPath: string): Promise<void> {
    const normalizedName = path.basename(repositoryPath).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    if (loadNamedRepositoryOverlaySync(normalizedName).length > 0) {
      console.log(`[control] loading saved overlay name=${normalizedName}`);
      const entities = loadNamedRepositoryOverlaySync(normalizedName);
      this.pendingOverlay = {
        entities,
        repoName: normalizedName,
        repoPath: repositoryPath,
      };
      return;
    }

    console.log(`[control] importing repository path=${repositoryPath}`);
    const overlay = await createRepositoryOverlay(repositoryPath, { seed: this.seed });
    await saveRepositoryOverlay(overlay);

    this.savedOverlayNames = listSavedRepositoryOverlays();

    this.pendingOverlay = {
      entities: overlay.entities,
      repoName: overlay.repoName,
      repoPath: overlay.repoRoot,
    };
  }

  private registerEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);
    this.invalidateStructureCache();

    if (entity.type === 'agent') {
      this.agentIds.push(entity.id);
    }

    if (entity.type === 'goal') {
      this.goalId = entity.id;
    }

    if (isSolidEntity(entity)) {
      this.solidGrid[toIndex(entity.x, entity.y)] = entity.id;
    }

    const key = `${entity.x},${entity.y}`;
    const list = this.positionIndex.get(key) ?? [];
    list.push(entity.id);
    this.positionIndex.set(key, list);
  }

  private patchEntity(entityId: string, patch: Partial<Entity>): Entity | null {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return null;
    }

    const updatedEntity: Entity = {
      ...entity,
      ...patch,
    };

    this.entities.set(entityId, updatedEntity);
    this.invalidateStructureCache();

    if ((patch.x !== undefined && patch.x !== entity.x) || (patch.y !== undefined && patch.y !== entity.y)) {
      const oldKey = `${entity.x},${entity.y}`;
      const newKey = `${updatedEntity.x},${updatedEntity.y}`;
      const oldList = this.positionIndex.get(oldKey);
      if (oldList) {
        const filtered = oldList.filter((id) => id !== entityId);
        if (filtered.length === 0) {
          this.positionIndex.delete(oldKey);
        } else {
          this.positionIndex.set(oldKey, filtered);
        }
      }
      const newList = this.positionIndex.get(newKey) ?? [];
      newList.push(entityId);
      this.positionIndex.set(newKey, newList);
    }

    return updatedEntity;
  }

  private invalidateStructureCache(): void {
    this.structureEntitiesCache = null;
  }

  private getAgentByRole(role: AgentRole): Entity | null {
    for (const agentId of this.agentIds) {
      const agent = this.entities.get(agentId);
      if (!agent || agent.type !== 'agent') {
        continue;
      }

      if (getAgentRole(agent) === role) {
        return agent;
      }
    }

    return null;
  }

  private getStructureEntities(): Entity[] {
    if (this.structureEntitiesCache !== null) {
      return this.structureEntitiesCache;
    }

    this.structureEntitiesCache = Array.from(this.entities.values()).filter((entity) =>
      isStructureEntity(entity),
    );
    return this.structureEntitiesCache;
  }

  private getEntityPath(entity: Entity): string {
    return entity.path ?? entity.name ?? entity.id;
  }

  private getStructureAtPosition(position: Position): Entity | null {
    for (const entity of this.getStructureEntities()) {
      if (entity.x === position.x && entity.y === position.y) {
        return entity;
      }
    }

    return null;
  }

  private selectClosestStructure(agent: Entity, candidates: Entity[]): Entity | null {
    const sorted = [...candidates].sort((left, right) => {
      const distanceDelta = manhattanDistance(agent, left) - manhattanDistance(agent, right);
      if (distanceDelta !== 0) {
        return distanceDelta;
      }

      return this.getEntityPath(left).localeCompare(this.getEntityPath(right));
    });

    return sorted[0] ?? null;
  }

  private selectRotatingStructure(candidates: Entity[], offset = 0): Entity | null {
    if (candidates.length === 0) {
      return null;
    }

    const sorted = [...candidates].sort((left, right) =>
      this.getEntityPath(left).localeCompare(this.getEntityPath(right)),
    );
    const index = (Math.floor(this.absoluteTick / CLOCK_PERIOD) + offset) % sorted.length;
    return sorted[index] ?? null;
  }

  private isAsymmetryCandidate(entity: Entity): boolean {
    return (
      computeChiralMass(entity) >= 8 ||
      entity.git_status === 'conflicted' ||
      entity.git_status === 'deleted'
    );
  }

  private setNodeState(
    entity: Entity,
    nodeState: NodeState,
    lockOwner: string | null,
    lockTick: number | null,
  ): void {
    this.patchEntity(entity.id, {
      lock_owner: lockOwner,
      lock_tick: lockTick,
      node_state: nodeState,
      state_tick: this.absoluteTick,
    });
  }

  private getDefaultNodeState(entity: Entity): NodeState {
    if (this.isAsymmetryCandidate(entity)) {
      return 'asymmetry';
    }

    if (
      entity.git_status === 'added' ||
      entity.git_status === 'untracked' ||
      entity.git_status === 'modified' ||
      entity.git_status === 'renamed'
    ) {
      return 'task';
    }

    return 'stable';
  }

  private tickLoop(): void {
    const tickStartedAtMs = performance.now();

    try {
      this.pollOperatorControlsIfNeeded();
      this.queueSupabaseSync();

      if (this.paused) {
        return;
      }

      this.applyPendingOverlayIfReady();
      this.applyQueuedDecisions();
      this.updateHivemindState();
      this.processTaskPipeline();
      this.queueAiDecisions();
      this.logTickIfNeeded();

      const agent = this.getPrimaryAgent();
      if (this.isGoalReached(agent)) {
        this.finishRun(`goal reached at tick ${this.absoluteTick}`);
        return;
      }

      if (this.absoluteTick >= this.maxTicks) {
        this.finishRun(`tick budget exhausted at tick ${this.absoluteTick}`);
        return;
      }

      this.absoluteTick += 1;
    } finally {
      this.lastTickDurationMs = Math.max(0, Math.round(performance.now() - tickStartedAtMs));
    }
  }

  private updateHivemindState(): void {
    this.initializeStructureNodes();
    this.resolveNodeLocks();
    this.expireVerifiedNodes();

    const visionary = this.getAgentByRole('visionary');
    if (visionary) {
      const target = this.selectVisionaryTarget(visionary);
      this.patchEntity(visionary.id, {
        objective_path: target?.path ?? null,
        descriptor: this.visionaryPrompt.length > 0 ? this.visionaryPrompt : visionary.descriptor,
      });

      if (
        target &&
        visionary.x === target.x &&
        visionary.y === target.y &&
        target.lock_owner == null &&
        target.node_state !== 'in-progress'
      ) {
        this.setNodeState(target, 'task', null, null);
      }
    }

    const architect = this.getAgentByRole('architect');
    if (architect) {
      const target = this.selectArchitectTarget(architect);
      this.patchEntity(architect.id, {
        objective_path: target?.path ?? null,
        descriptor: this.architectPrompt.length > 0 ? this.architectPrompt : architect.descriptor,
      });

      if (
        target &&
        architect.x === target.x &&
        architect.y === target.y &&
        (target.lock_owner == null || target.lock_owner === architect.id)
      ) {
        this.setNodeState(
          target,
          'in-progress',
          architect.id,
          target.lock_owner === architect.id ? (target.lock_tick ?? this.absoluteTick) : this.absoluteTick,
        );
      }
    }

    const critic = this.getAgentByRole('critic');
    if (critic) {
      const target = this.selectCriticTarget(critic);
      this.patchEntity(critic.id, {
        objective_path: target?.path ?? null,
        descriptor: this.criticPrompt.length > 0 ? this.criticPrompt : critic.descriptor,
      });

      if (
        target &&
        critic.x === target.x &&
        critic.y === target.y &&
        (target.lock_owner == null || target.lock_owner === critic.id) &&
        target.node_state !== 'in-progress'
      ) {
        this.setNodeState(
          target,
          target.node_state ?? 'stable',
          critic.id,
          target.lock_owner === critic.id ? (target.lock_tick ?? this.absoluteTick) : this.absoluteTick,
        );
      }
    }
  }

  private processTaskPipeline(): void {
    this.triggerVisionaryPlanningIfNeeded();
    this.assignPendingTasks();
    this.processCriticReviews();
    this.processVisionaryFinalReviews();
  }

  private triggerVisionaryPlanningIfNeeded(): void {
    if (this.visionaryPlanningPromise !== null) {
      return;
    }

    const hasIncompleteTasks = this.activeTasks.some((t) => t.status !== 'done');
    if (hasIncompleteTasks) {
      return;
    }

    const prompt = this.operatorPrompt.trim();
    if (prompt.length === 0) {
      return;
    }

    if (prompt === this.lastOperatorPromptForPlanning && this.activeTasks.length > 0) {
      return;
    }

    this.visionaryPlanningPromise = this.runVisionaryPlanning(prompt).finally(() => {
      this.visionaryPlanningPromise = null;
    });
  }

  private async runVisionaryPlanning(prompt: string): Promise<void> {
    const codebaseSummary = this.getStructureEntities()
      .map((e) => `${e.type}: ${e.path ?? e.name ?? e.id}`)
      .join('\n');

    const tasks = await this.aiNavigator.requestVisionaryPlan(prompt, codebaseSummary);

    if (tasks.length === 0) {
      return;
    }

    this.activeTasks = tasks.map((t) => ({
      id: t.id,
      description: t.description,
      target_path: t.target_path,
      status: 'pending' as const,
      assigned_agent_id: null,
      original_content: null,
      completed_content: null,
      review_feedback: null,
      created_at_tick: this.absoluteTick,
      updated_at_tick: this.absoluteTick,
    }));

    this.lastOperatorPromptForPlanning = prompt;
    console.log(`[visionary] planned ${tasks.length} tasks from operator prompt`);
  }

  private assignPendingTasks(): void {
    const architects = this.agentIds
      .map((id) => this.entities.get(id))
      .filter((agent): agent is Entity => agent?.type === 'agent' && getAgentRole(agent) === 'architect');

    for (const task of this.activeTasks) {
      if (task.status !== 'pending') {
        continue;
      }

      const busyArchitectIds = new Set(
        this.activeTasks
          .filter((t) => t.status !== 'done' && t.status !== 'pending' && t.assigned_agent_id)
          .map((t) => t.assigned_agent_id!),
      );

      const availableArchitect = architects.find((arch) => !busyArchitectIds.has(arch.id));

      if (availableArchitect) {
        task.status = 'assigned';
        task.assigned_agent_id = availableArchitect.id;
        task.updated_at_tick = this.absoluteTick;

        const targetEntity = this.findStructureByPath(task.target_path);
        if (targetEntity) {
          task.original_content = targetEntity.content ?? targetEntity.content_preview ?? '';
        }
      }
    }
  }

  private processCriticReviews(): void {
    if (this.criticReviewPromise !== null) {
      return;
    }

    const critic = this.getAgentByRole('critic');
    if (!critic) {
      return;
    }

    const reviewTask = this.activeTasks.find((t) => t.status === 'awaiting_review');
    if (!reviewTask) {
      return;
    }

    const targetEntity = this.findStructureByPath(reviewTask.target_path);
    if (!targetEntity) {
      return;
    }

    if (critic.x !== targetEntity.x || critic.y !== targetEntity.y) {
      return;
    }

    if (this.absoluteTick - reviewTask.updated_at_tick < 3) {
      return;
    }

    this.criticReviewPromise = this.runCriticReview(reviewTask, targetEntity).finally(() => {
      this.criticReviewPromise = null;
    });
  }

  private async runCriticReview(task: Task, targetEntity: Entity): Promise<void> {
    const original = task.original_content ?? '';
    const current = targetEntity.content ?? targetEntity.content_preview ?? '';

    const result = await this.aiNavigator.requestCriticReview(
      task.description,
      original,
      current,
    );

    if (result.approved) {
      task.status = 'approved';
      task.review_feedback = result.feedback;
    } else {
      task.status = 'revision_needed';
      task.review_feedback = result.feedback;
    }
    task.updated_at_tick = this.absoluteTick;

    console.log(`[critic] task ${task.id} ${result.approved ? 'approved' : 'rejected'}: ${result.feedback}`);
  }

  private processVisionaryFinalReviews(): void {
    if (this.visionaryFinalReviewPromise !== null) {
      return;
    }

    const approvedTask = this.activeTasks.find((t) => t.status === 'approved');
    if (!approvedTask) {
      return;
    }

    this.visionaryFinalReviewPromise = this.runVisionaryFinalReview(approvedTask).finally(() => {
      this.visionaryFinalReviewPromise = null;
    });
  }

  private async runVisionaryFinalReview(task: Task): Promise<void> {
    const prompt = this.operatorPrompt.trim();

    if (prompt !== this.lastOperatorPromptForPlanning) {
      task.status = 'revision_needed';
      task.review_feedback = 'User intent has changed since this task was planned. Please re-evaluate.';
      task.updated_at_tick = this.absoluteTick;
      console.log(`[visionary] task ${task.id} sent back for revision due to changed operator prompt`);
      return;
    }

    task.status = 'done';
    task.updated_at_tick = this.absoluteTick;
    console.log(`[visionary] task ${task.id} finalized`);
  }

  private findStructureByPath(targetPath: string): Entity | null {
    for (const entity of this.getStructureEntities()) {
      if (entity.path === targetPath) {
        return entity;
      }
    }
    return null;
  }

  private getTaskContextForAgent(agent: Entity): string | null {
    const task = this.activeTasks.find(
      (t) =>
        t.assigned_agent_id === agent.id &&
        t.status !== 'done' &&
        t.status !== 'awaiting_review' &&
        t.status !== 'approved',
    );
    if (!task) {
      return null;
    }
    const feedback = task.review_feedback ? ` Feedback: ${task.review_feedback}` : '';
    return `Task: ${task.description}. Target: ${task.target_path}.${feedback}`;
  }

  private initializeStructureNodes(): void {
    for (const entity of this.getStructureEntities()) {
      if (entity.node_state !== null && entity.node_state !== undefined) {
        continue;
      }

      this.patchEntity(entity.id, {
        node_state: this.getDefaultNodeState(entity),
        state_tick: entity.state_tick ?? 0,
      });
    }
  }

  private resolveNodeLocks(): void {
    for (const entity of this.getStructureEntities()) {
      if (!entity.lock_owner) {
        continue;
      }

      const owner = this.entities.get(entity.lock_owner);
      if (!owner || owner.type !== 'agent') {
        this.patchEntity(entity.id, {
          lock_owner: null,
          lock_tick: null,
          node_state: entity.node_state ?? this.getDefaultNodeState(entity),
        });
        continue;
      }

      const ownerRole = getAgentRole(owner);
      const ownerOnNode = owner.x === entity.x && owner.y === entity.y;

      if (!ownerOnNode) {
        this.patchEntity(entity.id, {
          lock_owner: null,
          lock_tick: null,
          node_state: ownerRole === 'critic' ? this.evaluateCriticOutcome(entity) : 'stable',
          state_tick: this.absoluteTick,
        });
        continue;
      }

      const elapsed = this.absoluteTick - (entity.lock_tick ?? this.absoluteTick);
      if (ownerRole === 'architect' && elapsed >= ARCHITECT_WORK_TICKS) {
        this.patchEntity(entity.id, {
          lock_owner: null,
          lock_tick: null,
          node_state: 'stable',
          state_tick: this.absoluteTick,
        });
      }

      if (ownerRole === 'critic' && elapsed >= CRITIC_REVIEW_TICKS) {
        this.patchEntity(entity.id, {
          lock_owner: null,
          lock_tick: null,
          node_state: this.evaluateCriticOutcome(entity),
          state_tick: this.absoluteTick,
        });
      }
    }
  }

  private expireVerifiedNodes(): void {
    for (const entity of this.getStructureEntities()) {
      if (entity.node_state !== 'verified' || entity.state_tick == null) {
        continue;
      }

      if ((this.absoluteTick - entity.state_tick) > VERIFICATION_TTL_TICKS) {
        this.patchEntity(entity.id, {
          node_state: 'stable',
          state_tick: this.absoluteTick,
        });
      }
    }
  }

  private evaluateCriticOutcome(entity: Entity): NodeState {
    return this.isAsymmetryCandidate(entity) ? 'asymmetry' : 'verified';
  }

  private selectVisionaryTarget(agent: Entity): Entity | null {
    // Task pipeline: final review of approved tasks
    const approvedTask = this.activeTasks.find((t) => t.status === 'approved');
    if (approvedTask) {
      const target = this.findStructureByPath(approvedTask.target_path);
      if (target) {
        return target;
      }
    }

    const structureNodes = this.getStructureEntities().filter((entity) => entity.lock_owner == null);
    const criticalMassNodes = structureNodes.filter((entity) => computeChiralMass(entity) >= 8);
    if (criticalMassNodes.length > 0) {
      return this.selectClosestStructure(agent, criticalMassNodes);
    }

    const backlogNodes = structureNodes.filter((entity) =>
      entity.node_state === 'task' ||
      entity.git_status === 'added' ||
      entity.git_status === 'untracked' ||
      entity.git_status === 'modified' ||
      entity.git_status === 'renamed',
    );
    if (backlogNodes.length > 0) {
      return this.selectClosestStructure(agent, backlogNodes);
    }

    return null;
  }

  private selectArchitectTarget(agent: Entity): Entity | null {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (currentNode && currentNode.lock_owner === agent.id) {
      return currentNode;
    }

    // Task pipeline: assigned tasks take priority
    const assignedTask = this.activeTasks.find(
      (t) =>
        t.assigned_agent_id === agent.id &&
        (t.status === 'assigned' || t.status === 'in_progress' || t.status === 'revision_needed'),
    );
    if (assignedTask) {
      const target = this.findStructureByPath(assignedTask.target_path);
      if (target) {
        return target;
      }
    }

    const operatorTarget = this.getOperatorTargetEntity();
    if (operatorTarget) {
      return operatorTarget;
    }

    const structureNodes = this.getStructureEntities();
    const activeTasks = structureNodes.filter((entity) =>
      (entity.node_state === 'task' || entity.node_state === 'asymmetry') &&
      (entity.lock_owner == null || entity.lock_owner === agent.id),
    );
    if (activeTasks.length > 0) {
      return this.selectClosestStructure(agent, activeTasks);
    }

    return null;
  }

  private selectCriticTarget(agent: Entity): Entity | null {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (currentNode && currentNode.lock_owner === agent.id) {
      return currentNode;
    }

    // Task pipeline: review awaiting_review tasks first
    const reviewTask = this.activeTasks.find((t) => t.status === 'awaiting_review');
    if (reviewTask) {
      const target = this.findStructureByPath(reviewTask.target_path);
      if (target) {
        return target;
      }
    }

    const structureNodes = this.getStructureEntities();
    const architectLocks = structureNodes.filter((entity) => {
      if (!entity.lock_owner) {
        return false;
      }

      const owner = this.entities.get(entity.lock_owner);
      return owner?.type === 'agent' && getAgentRole(owner) === 'architect';
    });
    if (architectLocks.length > 0) {
      return this.selectClosestStructure(agent, architectLocks);
    }

    const reviewTargets = structureNodes.filter((entity) =>
      entity.node_state === 'stable' &&
      entity.state_tick != null &&
      entity.state_tick > 0 &&
      (this.absoluteTick - entity.state_tick) <= VERIFICATION_TTL_TICKS &&
      entity.lock_owner == null,
    );
    if (reviewTargets.length > 0) {
      return this.selectClosestStructure(agent, reviewTargets);
    }

    const asymmetryTargets = structureNodes.filter((entity) =>
      entity.node_state === 'asymmetry' &&
      entity.lock_owner == null,
    );
    return this.selectClosestStructure(agent, asymmetryTargets);
  }

  private applyQueuedDecisions(): void {
    const queuedDecisions = Array.from(this.decisionQueue.values());
    this.decisionQueue.clear();

    for (const queued of queuedDecisions) {
      if (queued.runId !== this.currentRunId) {
        continue;
      }

      const agent = this.entities.get(queued.agentId);
      if (!agent || agent.type !== 'agent') {
        continue;
      }

      this.executeDecision(agent, queued.decision);
    }
  }

  private executeDecision(agent: Entity, decision: AgentDecision): void {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (
      currentNode &&
      currentNode.lock_owner === agent.id &&
      decision.action === 'move'
    ) {
      return;
    }

    if (decision.action === 'read') {
      this.executeRead(agent, decision);
      return;
    }

    if (decision.action === 'edit') {
      this.executeEdit(agent, decision);
      return;
    }

    if (decision.action === 'submit') {
      this.executeSubmit(agent);
      return;
    }

    if (decision.action !== 'move' || decision.direction === undefined) {
      return;
    }

    const primaryTarget = step(agent, decision.direction);
    const nextPosition = this.resolveMovement(agent, decision.direction, primaryTarget);

    if (nextPosition.x === agent.x && nextPosition.y === agent.y) {
      return;
    }

    this.moveEntity(agent, nextPosition);
  }

  private executeRead(agent: Entity, decision: AgentDecision): void {
    const target = this.findReadableTarget(agent, decision.target);
    if (!target) {
      console.log(
        `[read] ${agent.id} failed to read "${decision.target ?? ''}" at tick ${this.absoluteTick} (not found nearby)`,
      );
      return;
    }

    console.log(
      `[read] ${agent.id} read ${target.type} "${target.name ?? target.path}" at tick ${this.absoluteTick} (mass=${target.mass})`,
    );
  }

  private async processPendingEdits(control: OperatorControl): Promise<void> {
    const editPath = control.pending_edit_path?.trim();
    const editContent = control.pending_edit_content;

    if (!editPath || editContent === undefined || editContent === null) {
      return;
    }

    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.error('[edit] No active repository to edit.');
      return;
    }

    const absolutePath = path.join(repoRoot, editPath);

    try {
      await writeFile(absolutePath, editContent, 'utf8');

      const git = simpleGit(repoRoot);
      await git.add(['--', editPath]);

      const entityId = `file:${editPath}`;
      const entity = this.entities.get(entityId);
      if (entity) {
        const preview = editContent.slice(0, 200);
        this.patchEntity(entityId, {
          content: editContent,
          content_preview: preview,
          git_status: 'modified',
          tick_updated: this.absoluteTick,
        });
      }

      await this.supabase!
        .from('operator_controls')
        .update({ pending_edit_path: null, pending_edit_content: null })
        .eq('id', CONTROL_ROW_ID);

      console.log(`[edit] wrote ${editPath} and staged changes`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown edit failure';
      console.error(`[edit] ${message}`);
    }
  }

  private async processCommitAndPush(control: OperatorControl): Promise<void> {
    const commitMessage = control.commit_message?.trim();
    const shouldPush = control.should_push ?? false;

    if (!commitMessage) {
      return;
    }

    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.error('[git] No active repository to commit.');
      return;
    }

    try {
      const git = simpleGit(repoRoot);
      await git.commit(commitMessage);
      console.log(`[git] committed: ${commitMessage}`);

      if (shouldPush) {
        await git.push();
        console.log('[git] pushed to remote');
      }

      await this.supabase!
        .from('operator_controls')
        .update({ commit_message: null, should_push: false })
        .eq('id', CONTROL_ROW_ID);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown git failure';
      console.error(`[git] ${message}`);
    }
  }

  private executeEdit(agent: Entity, decision: AgentDecision): void {
    const target = this.findReadableTarget(agent, decision.target);
    if (!target || target.type !== 'file') {
      console.log(
        `[edit] ${agent.id} failed to edit "${decision.target ?? ''}" at tick ${this.absoluteTick} (not a writable file)`,
      );
      return;
    }

    if (decision.content === undefined || decision.content === null) {
      console.log(
        `[edit] ${agent.id} attempted to edit "${decision.target ?? ''}" at tick ${this.absoluteTick} (no content provided)`,
      );
      return;
    }

    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.log(`[edit] ${agent.id} cannot edit — no active repo`);
      return;
    }

    const filePath = target.path ?? '';
    const absolutePath = path.join(repoRoot, filePath);

    const newContent = decision.content;
    void (async () => {
      try {
        await writeFile(absolutePath, newContent, 'utf8');
        const git = simpleGit(repoRoot);
        await git.add(['--', filePath]);

        const preview = newContent.slice(0, 200);
        this.patchEntity(target.id, {
          content: newContent,
          content_preview: preview,
          git_status: 'modified',
          tick_updated: this.absoluteTick,
        });

        // Update in-progress task status
        const task = this.activeTasks.find(
          (t) =>
            t.assigned_agent_id === agent.id &&
            t.target_path === filePath &&
            (t.status === 'assigned' || t.status === 'revision_needed'),
        );
        if (task) {
          task.status = 'in_progress';
          task.updated_at_tick = this.absoluteTick;
        }

        console.log(`[edit] ${agent.id} wrote ${filePath} at tick ${this.absoluteTick}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown edit failure';
        console.error(`[edit] ${message}`);
      }
    })();
  }

  private executeSubmit(agent: Entity): void {
    const assignedTask = this.activeTasks.find(
      (t) =>
        t.assigned_agent_id === agent.id &&
        (t.status === 'assigned' || t.status === 'in_progress' || t.status === 'revision_needed'),
    );

    if (!assignedTask) {
      console.log(`[submit] ${agent.id} has no active task to submit`);
      return;
    }

    const targetEntity = this.findStructureByPath(assignedTask.target_path);
    assignedTask.completed_content = targetEntity?.content ?? targetEntity?.content_preview ?? '';
    assignedTask.status = 'awaiting_review';
    assignedTask.updated_at_tick = this.absoluteTick;

    console.log(
      `[submit] ${agent.id} submitted task ${assignedTask.id} (${assignedTask.target_path}) for review`,
    );
  }

  private findReadableTarget(agent: Entity, targetName: string | undefined): Entity | null {
    return findReadableTargetInEntities(this.getStructureEntities(), agent, targetName);
  }

  private resolveMovement(
    agent: Entity,
    direction: Direction,
    primaryTarget: Position,
  ): Position {
    if (this.canOccupy(primaryTarget, agent.id)) {
      return primaryTarget;
    }

    const phase = this.getCurrentPhase();
    const perpendicularOrder =
      phase % 2 === 0
        ? [CLOCKWISE_SHIFT[direction], COUNTER_CLOCKWISE_SHIFT[direction]]
        : [COUNTER_CLOCKWISE_SHIFT[direction], CLOCKWISE_SHIFT[direction]];

    for (const perpendicularDirection of perpendicularOrder) {
      const shiftedTarget = step(agent, perpendicularDirection);
      if (this.canOccupy(shiftedTarget, agent.id)) {
        return shiftedTarget;
      }
    }

    return { x: agent.x, y: agent.y };
  }

  private canOccupy(position: Position, actorId: string): boolean {
    if (!isWithinBounds(position)) {
      return false;
    }

    const occupantId = this.solidGrid[toIndex(position.x, position.y)];
    return occupantId === null || occupantId === actorId;
  }

  private moveEntity(entity: Entity, nextPosition: Position): void {
    if (isSolidEntity(entity)) {
      this.solidGrid[toIndex(entity.x, entity.y)] = null;
    }

    const oldKey = `${entity.x},${entity.y}`;
    const oldList = this.positionIndex.get(oldKey);
    if (oldList) {
      const filtered = oldList.filter((id) => id !== entity.id);
      if (filtered.length === 0) {
        this.positionIndex.delete(oldKey);
      } else {
        this.positionIndex.set(oldKey, filtered);
      }
    }

    const updatedEntity: Entity = {
      ...entity,
      x: nextPosition.x,
      y: nextPosition.y,
      tick_updated: this.absoluteTick,
    };

    this.entities.set(entity.id, updatedEntity);
    this.invalidateStructureCache();

    const newKey = `${nextPosition.x},${nextPosition.y}`;
    const newList = this.positionIndex.get(newKey) ?? [];
    newList.push(entity.id);
    this.positionIndex.set(newKey, newList);

    if (isSolidEntity(updatedEntity)) {
      this.solidGrid[toIndex(nextPosition.x, nextPosition.y)] = updatedEntity.id;
    }
  }

  private queueAiDecisions(): void {
    for (const agentId of this.agentIds) {
      const pendingRequest = this.pendingAiAgents.get(agentId);
      if (pendingRequest?.runId === this.currentRunId || this.decisionQueue.has(agentId)) {
        continue;
      }

      const agent = this.entities.get(agentId);
      if (!agent || agent.type !== 'agent' || this.isGoalReached(agent)) {
        continue;
      }

      const issuedAtTick = this.absoluteTick;
      const scan = this.scanNeighborhood(agent);
      const runId = this.currentRunId;
      const startedAtMs = performance.now();

      this.pendingAiAgents.set(agentId, {
        runId,
        startedAtMs,
      });

      void this.requestDecisionForAgent(agent, scan)
        .then((decision) => {
          const pending = this.pendingAiAgents.get(agentId);
          if (pending?.runId === runId) {
            const latencyMs = Math.max(0, Math.round(performance.now() - pending.startedAtMs));
            this.lastAiLatencyMs = latencyMs;
            this.maxAiLatencyMs =
              this.maxAiLatencyMs === null
                ? latencyMs
                : Math.max(this.maxAiLatencyMs, latencyMs);
          }

          if (runId !== this.currentRunId) {
            return;
          }

          this.decisionQueue.set(agentId, {
            agentId,
            decision,
            requestedAtTick: issuedAtTick,
            runId,
          });
        })
        .finally(() => {
          if (this.pendingAiAgents.get(agentId)?.runId === runId) {
            this.pendingAiAgents.delete(agentId);
          }
        });
    }
  }

  private async requestDecisionForAgent(
    agent: Entity,
    scan: NeighborhoodScan,
  ): Promise<AgentDecision> {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (currentNode && currentNode.lock_owner === agent.id) {
      return { action: 'wait' };
    }

    const role = getAgentRole(agent) ?? 'architect';
    const operatorTarget = this.getOperatorTargetEntity();

    if (
      role === 'architect' &&
      operatorTarget &&
      currentNode?.id === operatorTarget.id &&
      (this.operatorAction === 'read' || this.operatorAction === 'explain')
    ) {
      return {
        action: 'read',
        target: operatorTarget.path ?? operatorTarget.name ?? 'current-node',
      };
    }

    if (role === 'architect') {
      if (this.operatorPrompt.length > 0 || scan.objective_path != null || scan.task_context != null) {
        return this.aiNavigator.requestDecision(scan);
      }
      return this.requestDeterministicDecision(agent, scan);
    }

    return this.requestDeterministicDecision(agent, scan);
  }

  private requestDeterministicDecision(
    agent: Entity,
    scan: NeighborhoodScan,
  ): AgentDecision {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (currentNode && currentNode.lock_owner === agent.id) {
      return { action: 'wait' };
    }

    const objective = scan.objective;
    if (objective.x === agent.x && objective.y === agent.y) {
      if (scan.current.occupant === 'file' || scan.current.occupant === 'directory') {
        return {
          action: 'read',
          target: scan.current.path ?? scan.current.name ?? 'current-node',
        };
      }

      return { action: 'wait' };
    }

    const dx = objective.x - agent.x;
    const dy = objective.y - agent.y;
    if (dx === 0 && dy === 0) {
      return { action: 'wait' };
    }

    const directions: Direction[] = [];
    const horizontalDirection: Direction = dx >= 0 ? 'east' : 'west';
    const verticalDirection: Direction = dy >= 0 ? 'south' : 'north';
    const preferHorizontal =
      Math.abs(dx) > Math.abs(dy) ||
      (Math.abs(dx) === Math.abs(dy) && this.getCurrentPhase() % 2 === 0);

    if (dx !== 0 && preferHorizontal) {
      directions.push(horizontalDirection);
    }

    if (dy !== 0) {
      directions.push(verticalDirection);
    }

    if (dx !== 0 && !preferHorizontal) {
      directions.push(horizontalDirection);
    }

    const direction = directions[0];
    return direction === undefined
      ? { action: 'wait' }
      : {
        action: 'move',
        direction,
      };
  }

  private getAgentPrompt(agent: Entity): string {
    const role = getAgentRole(agent);
    if (role === 'visionary') return this.visionaryPrompt;
    if (role === 'critic') return this.criticPrompt;
    return this.architectPrompt;
  }

  private getObjectiveForAgent(agent: Entity): { path: string | null; position: Position } {
    const role = getAgentRole(agent) ?? 'architect';
    const target =
      role === 'visionary'
        ? this.selectVisionaryTarget(agent)
        : role === 'critic'
          ? this.selectCriticTarget(agent)
          : this.selectArchitectTarget(agent);

    if (target) {
      return {
        path: target.path ?? null,
        position: { x: target.x, y: target.y },
      };
    }

    return {
      path: null,
      position: { x: agent.x, y: agent.y },
    };
  }

  private scanNeighborhood(agent: Entity): NeighborhoodScan {
    const objective = this.getObjectiveForAgent(agent);

    return {
      current_tick: this.getCurrentPhase(),
      absolute_tick: this.absoluteTick,
      agent_role: getAgentRole(agent) ?? 'architect',
      agent: { x: agent.x, y: agent.y },
      goal: { x: GOAL_POSITION.x, y: GOAL_POSITION.y },
      objective: objective.position,
      operator_action: this.operatorAction,
      operator_target_query: this.operatorTargetQuery,
      objective_path: objective.path,
      operator_prompt: this.operatorPrompt.length > 0 ? this.operatorPrompt : null,
      agent_prompt: this.getAgentPrompt(agent).length > 0 ? this.getAgentPrompt(agent) : null,
      task_context: this.getTaskContextForAgent(agent),
      current: this.lookupTile({ x: agent.x, y: agent.y }, agent.id),
      north: this.lookupTile({ x: agent.x, y: agent.y - 1 }),
      east: this.lookupTile({ x: agent.x + 1, y: agent.y }),
      south: this.lookupTile({ x: agent.x, y: agent.y + 1 }),
      west: this.lookupTile({ x: agent.x - 1, y: agent.y }),
    };
  }

  private findEntityAtPosition(position: Position, excludeId?: string): Entity | null {
    const ids = this.positionIndex.get(`${position.x},${position.y}`);
    if (!ids) {
      return null;
    }

    // Goal fast path
    if (this.goalId.length > 0) {
      const goal = this.entities.get(this.goalId);
      if (goal && goal.id !== excludeId && goal.x === position.x && goal.y === position.y) {
        return goal;
      }
    }

    // Structure entities take precedence
    for (const id of ids) {
      if (id === excludeId) {
        continue;
      }
      const entity = this.entities.get(id);
      if (entity && isStructureEntity(entity)) {
        return entity;
      }
    }

    // General fallback
    let fallback: Entity | null = null;
    for (const id of ids) {
      if (id === excludeId) {
        continue;
      }
      const entity = this.entities.get(id);
      if (!entity) {
        continue;
      }
      if (entity.type === 'agent' || entity.type === 'wall' || entity.type === 'file' || entity.type === 'directory' || entity.type === 'goal') {
        return entity;
      }
      fallback = entity;
    }

    return fallback;
  }

  private toTileObservation(entity: Entity): TileObservation {
    return {
      occupant: entity.type,
      name: entity.name ?? null,
      path: entity.path ?? null,
      mass: entity.mass,
      node_state: entity.node_state ?? null,
      lock_owner: entity.lock_owner ?? null,
      descriptor: entity.descriptor ?? null,
      content_preview: entity.content_preview ?? null,
      git_status: entity.git_status ?? null,
      extension: entity.extension ?? null,
    };
  }

  private lookupTile(position: Position, excludeId?: string): TileObservation {
    if (!isWithinBounds(position)) {
      return { occupant: 'boundary' };
    }

    const solidId = this.solidGrid[toIndex(position.x, position.y)];
    if (solidId != null && solidId !== excludeId) {
      const solidEntity = this.entities.get(solidId);
      if (solidEntity) {
        return this.toTileObservation(solidEntity);
      }
    }

    const entity = this.findEntityAtPosition(position, excludeId);
    if (entity) {
      return this.toTileObservation(entity);
    }

    return { occupant: 'empty' };
  }

  private queueSupabaseSync(): void {
    const supabase = this.supabase;

    if (!supabase) {
      if (!this.hasLoggedSupabaseDisabled) {
        console.warn(
          '[supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY is missing; realtime sync is disabled until credentials are configured.',
        );
        this.hasLoggedSupabaseDisabled = true;
      }

      return;
    }

    const snapshot = this.createSnapshot();
    const shouldPurgeStructures = this.pendingStructurePurge;
    this.pendingStructurePurge = false;
    this.syncQueue = this.syncQueue
      .then(async () => {
        if (shouldPurgeStructures) {
          const { error: deleteError } = await supabase
            .from('entities')
            .delete()
            .in('type', ['file', 'directory']);

          if (deleteError) {
            throw deleteError;
          }
        }

        const { error: entitiesError } = await supabase
          .from('entities')
          .upsert(snapshot.entities, { onConflict: 'id' });

        if (entitiesError) {
          throw entitiesError;
        }

        const { error: worldStateError } = await supabase
          .from('world_state')
          .upsert(snapshot.worldState, { onConflict: 'id' });

        if (worldStateError) {
          throw worldStateError;
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown Supabase error';
        console.error(`[supabase] ${message}`);
      });
  }

  private createSnapshot(): WorldSnapshot {
    const worldState = this.createWorldState();
    const entities = Array.from(this.entities.values()).sort((left, right) =>
      left.id.localeCompare(right.id),
    );

    return {
      entities,
      worldState,
    };
  }

  private createWorldState(): WorldState {
    return {
      id: WORLD_STATE_ID,
      seed: this.seed,
      tick: this.absoluteTick,
      phase: this.getCurrentPhase(),
      status: this.getWorldStatus(),
      active_repo_path: this.activeRepoPath,
      active_repo_name: this.activeRepoName,
      operator_prompt: this.operatorPrompt.length > 0 ? this.operatorPrompt : null,
      control_status: this.controlStatus,
      control_error: this.controlError,
      operator_action: this.operatorAction,
      operator_target_query: this.operatorTargetQuery,
      operator_target_path: this.operatorTargetPath,
      import_started_at: this.importStartedAt,
      import_finished_at: this.importFinishedAt,
      last_import_duration_ms: this.lastImportDurationMs,
      last_tick_duration_ms: this.lastTickDurationMs,
      last_ai_latency_ms: this.lastAiLatencyMs,
      max_ai_latency_ms: this.maxAiLatencyMs,
      queue_depth: this.getQueueDepth(),
      paused: this.paused,
      saved_overlay_names: this.savedOverlayNames,
      automate: this.automate,
      visionary_prompt: this.visionaryPrompt.length > 0 ? this.visionaryPrompt : null,
      architect_prompt: this.architectPrompt.length > 0 ? this.architectPrompt : null,
      critic_prompt: this.criticPrompt.length > 0 ? this.criticPrompt : null,
      pending_edit_path: null,
      pending_edit_content: null,
      commit_message: null,
      should_push: false,
      active_tasks: this.activeTasks.length > 0 ? this.activeTasks : null,
    };
  }

  private getWorldStatus(): WorldStatus {
    const agent = this.getPrimaryAgent();
    if (this.isGoalReached(agent)) {
      return 'goal-reached';
    }

    if (this.absoluteTick >= this.maxTicks) {
      return 'stalled';
    }

    if (this.absoluteTick === 0) {
      return 'booting';
    }

    return 'running';
  }

  private getCurrentPhase(): number {
    return this.absoluteTick % CLOCK_PERIOD;
  }

  private getPrimaryAgent(): Entity {
    const agentId = this.agentIds[0];
    const agent = agentId ? this.entities.get(agentId) : undefined;

    if (!agent || agent.type !== 'agent') {
      throw new Error('Primary agent is missing from the world state.');
    }

    return agent;
  }

  private isGoalReached(agent: Entity): boolean {
    const goal = this.entities.get(this.goalId);
    return goal !== undefined && goal.x === agent.x && goal.y === agent.y;
  }

  private logTickIfNeeded(): void {
    if (this.maxTicks > 10 && this.absoluteTick % 10 !== 0) {
      return;
    }

    const architect = this.getAgentByRole('architect') ?? this.getPrimaryAgent();
    const visionary = this.getAgentByRole('visionary');
    const critic = this.getAgentByRole('critic');
    const distance = manhattanDistance(architect, GOAL_POSITION);
    const structureNodes = this.getStructureEntities();
    const taskCount = structureNodes.filter((entity) => entity.node_state === 'task').length;
    const asymmetryCount = structureNodes.filter((entity) => entity.node_state === 'asymmetry').length;
    const pendingTasks = this.activeTasks.filter((t) => t.status === 'pending').length;
    const inProgressTasks = this.activeTasks.filter((t) => t.status === 'in_progress' || t.status === 'assigned').length;
    const reviewTasks = this.activeTasks.filter((t) => t.status === 'awaiting_review').length;
    const doneTasks = this.activeTasks.filter((t) => t.status === 'done').length;

    console.log(
      `[tick ${String(this.absoluteTick).padStart(3, '0')} phase ${this.getCurrentPhase()}] architect=(${architect.x},${architect.y}) visionary=${visionary ? `(${visionary.x},${visionary.y})` : 'off'} critic=${critic ? `(${critic.x},${critic.y})` : 'off'} goal_distance=${distance} nodes_task=${taskCount} nodes_asymmetry=${asymmetryCount} tasks_pending=${pendingTasks} tasks_active=${inProgressTasks} tasks_review=${reviewTasks} tasks_done=${doneTasks} queued=${this.decisionQueue.size} pending_ai=${this.pendingAiAgents.size} queue_depth=${this.getQueueDepth()} tick_ms=${this.lastTickDurationMs ?? 0} ai_latency_ms=${this.lastAiLatencyMs ?? 0} control=${this.controlStatus} supabase=${this.supabase ? 'on' : 'off'}`,
    );
  }

  private finishRun(reason: string): void {
    if (!this.loopRuns) {
      this.stop(reason);
      return;
    }

    this.clearScheduledWork();
    console.log(`[stop] ${reason}`);
    console.log(`[reset] restarting run in ${this.restartDelayMs}ms`);

    this.restartHandle = setTimeout(() => {
      this.restartHandle = null;
      this.resetWorld();
      this.startRun('reset');
    }, this.restartDelayMs);
  }
}

function parseIntegerOption(flag: string): number | undefined {
  const argument = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (!argument) {
    return undefined;
  }

  const rawValue = argument.slice(flag.length + 1);
  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

function parseBooleanOption(flag: string): boolean | undefined {
  if (process.argv.includes(flag)) {
    return true;
  }

  if (process.argv.includes(`--no-${flag.slice(2)}`)) {
    return false;
  }

  return undefined;
}

function parseRuntimeConfiguration(): {
  loopRuns: boolean;
  maxTicks: number;
  restartDelayMs: number;
  tickIntervalMs: number;
} {
  const maxTicksFromEnv = Number.parseInt(process.env.LUX_MAX_TICKS ?? '', 10);
  const tickIntervalFromEnv = Number.parseInt(process.env.LUX_TICK_INTERVAL_MS ?? '', 10);
  const restartDelayFromEnv = Number.parseInt(process.env.LUX_RESTART_DELAY_MS ?? '', 10);
  const loopFromEnv = process.env.LUX_LOOP?.trim().toLowerCase();

  return {
    loopRuns:
      parseBooleanOption('--loop') ??
      (loopFromEnv === 'true' || loopFromEnv === '1' || loopFromEnv === 'yes'),
    maxTicks:
      parseIntegerOption('--max-ticks') ??
      (Number.isFinite(maxTicksFromEnv) && maxTicksFromEnv > 0 ? maxTicksFromEnv : MAX_TICKS),
    restartDelayMs:
      parseIntegerOption('--restart-delay-ms') ??
      (Number.isFinite(restartDelayFromEnv) && restartDelayFromEnv >= 0
        ? restartDelayFromEnv
        : 1500),
    tickIntervalMs:
      parseIntegerOption('--tick-interval-ms') ??
      (Number.isFinite(tickIntervalFromEnv) && tickIntervalFromEnv > 0
        ? tickIntervalFromEnv
        : TICK_INTERVAL_MS),
  };
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const runtime = parseRuntimeConfiguration();
  const engine = new LuxEngine(
    process.env.LUX_SEED ?? DEFAULT_SEED,
    runtime.tickIntervalMs,
    runtime.maxTicks,
    runtime.loopRuns,
    runtime.restartDelayMs,
  );
  engine.start();

  process.on('SIGINT', () => {
    engine.stop('received SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    engine.stop('received SIGTERM');
    process.exit(0);
  });
}
