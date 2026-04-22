import 'dotenv/config';


import { createHash } from 'node:crypto';
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
  GRID_DEPTH,
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
import { applyDelete, applyInsert, applyPatch } from './surgical-edit';
import { isStructureEntity } from './mass-mapper';
import {
  computeAlarm,
  computeUrgency,
  getDefaultQueenState,
  loadQueenState,
  saveQueenState,
  type QueenState,
} from './queen';
import { createServiceSupabaseClient } from './supabase';
import {
  OperatorControlSchema,
  type AgentActivity,
  type AgentDecision,
  type AgentMemory,
  type AgentRole,
  type ControlStatus,
  type Direction,
  type Entity,
  type ExplainStatus,
  type NeighborhoodScan,
  type NodeState,
  type OperatorAction,
  type OperatorControl,
  type PheromoneSignal,
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

interface ExplanationState {
  status: ExplainStatus;
  targetPath: string | null;
  agentId: string | null;
  contentHash: string | null;
  cacheKey: string | null;
  prompt: string | null;
  text: string | null;
  fullText: string | null;
  error: string | null;
  updatedAtTick: number | null;
}

interface ExplanationCacheEntry {
  text: string;
  updatedAtTick: number;
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
const PHEROMONE_TTL_TICKS = 30;
const CONTROL_ROW_ID = 'lux-control';
const CONTROL_POLL_INTERVAL_TICKS = 10;
const EXPLANATION_STREAM_CHARS_PER_TICK = 220;

function createEmptyExplanationState(): ExplanationState {
  return {
    status: 'idle',
    targetPath: null,
    agentId: null,
    contentHash: null,
    cacheKey: null,
    prompt: null,
    text: null,
    fullText: null,
    error: null,
    updatedAtTick: null,
  };
}

function createDefaultAgentMemory(): AgentMemory {
  return {
    files_read: {},
    lessons: [],
    last_broadcast: null,
  };
}

function getPositionKey(position: { x: number; y: number; z?: number | undefined }): string {
  return `${position.x},${position.y},${position.z ?? 0}`;
}

function getPositionZ(position: { z?: number | undefined }): number {
  return position.z ?? 0;
}

function getContentHashForMemory(entity: Entity): string {
  if (entity.content_hash) {
    return entity.content_hash;
  }

  return createHash('sha1')
    .update(entity.content ?? entity.content_preview ?? entity.path ?? entity.name ?? entity.id)
    .digest('hex');
}

export function findReadableTargetInEntities(
  entities: readonly Entity[],
  agent: Position,
  targetName: string | undefined,
): Entity | null {
  if (!targetName) {
    return null;
  }

  const agentZ = getPositionZ(agent);
  const positions: Position[] = [
    { x: agent.x, y: agent.y, z: agentZ },
    { x: agent.x, y: agent.y - 1, z: agentZ },
    { x: agent.x + 1, y: agent.y, z: agentZ },
    { x: agent.x, y: agent.y + 1, z: agentZ },
    { x: agent.x - 1, y: agent.y, z: agentZ },
  ];

  for (const position of positions) {
    for (const entity of entities) {
      if (
        entity.x !== position.x ||
        entity.y !== position.y ||
        getPositionZ(entity) !== getPositionZ(position)
      ) {
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

export function resolvePathWithinRoot(rootPath: string, relativePath: string): string | null {
  const trimmedPath = relativePath.trim();
  if (trimmedPath.length === 0) {
    return null;
  }

  const absoluteRoot = path.resolve(rootPath);
  const absoluteCandidate = path.resolve(absoluteRoot, trimmedPath);
  const candidateRelativePath = path.relative(absoluteRoot, absoluteCandidate);

  if (
    candidateRelativePath.length === 0 ||
    candidateRelativePath.startsWith('..') ||
    path.isAbsolute(candidateRelativePath)
  ) {
    return null;
  }

  return absoluteCandidate;
}

export class LuxEngine {
  private readonly entities = new Map<string, Entity>();
  private readonly solidGrid: Array<string | null> = Array.from(
    { length: GRID_WIDTH * GRID_HEIGHT * GRID_DEPTH },
    () => null,
  );
  private readonly positionIndex = new Map<string, string[]>();
  private readonly agentIds: string[] = [];
  private readonly decisionQueue = new Map<string, QueuedDecision>();
  private readonly pendingAiAgents = new Map<string, PendingAiRequest>();
  private readonly pendingEditAgents = new Set<string>();
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
  private queenState: QueenState = getDefaultQueenState();
  private lastOperatorPromptForPlanning = '';
  private visionaryPlanningPromise: Promise<void> | null = null;
  private criticReviewPromise: Promise<void> | null = null;
  private visionaryFinalReviewPromise: Promise<void> | null = null;
  private autoCommitPromise: Promise<void> | null = null;
  private explanationPromise: Promise<void> | null = null;
  private explanationRequestId = 0;
  private explanationState: ExplanationState = createEmptyExplanationState();
  private readonly explanationCache = new Map<string, ExplanationCacheEntry>();
  private hasAutoCommittedForCurrentTasks = false;

  public constructor(
    private readonly seed: string,
    private readonly tickIntervalMs = TICK_INTERVAL_MS,
    private readonly maxTicks = MAX_TICKS,
    private readonly loopRuns = false,
    private readonly restartDelayMs = 1500,
  ) {
    this.resetWorld();
    this.queenState = loadQueenState(seed);
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
    this.pendingEditAgents.clear();
    this.solidGrid.fill(null);
    this.positionIndex.clear();
    this.savedOverlayNames = listSavedRepositoryOverlays();
    this.activeTasks = [];
    this.lastOperatorPromptForPlanning = '';
    this.visionaryPlanningPromise = null;
    this.criticReviewPromise = null;
    this.visionaryFinalReviewPromise = null;
    this.explanationPromise = null;
    this.explanationRequestId += 1;
    this.explanationState = createEmptyExplanationState();
    this.explanationCache.clear();

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
    const normalizedPrompt = directive.normalizedPrompt?.trim() ?? '';

    this.operatorAction = directive.normalizedPrompt ? directive.action : null;
    this.operatorTargetQuery = directive.targetQuery;
    this.operatorTargetPath = directive.target?.path ?? null;

    if (directive.normalizedPrompt === null) {
      this.controlStatus = 'idle';
      this.controlError = null;
      this.resetExplanationState();
      return;
    }

    if (directive.targetQuery && directive.target === null) {
      this.controlStatus = 'error';
      this.controlError = `Target "${directive.targetQuery}" was not found in the active repository.`;
      this.resetExplanationState();
      return;
    }

    this.controlStatus = 'active';
    this.controlError = null;

    if (
      this.operatorAction !== 'explain' ||
      this.operatorTargetPath === null ||
      this.explanationState.targetPath !== this.operatorTargetPath ||
      this.explanationState.prompt !== normalizedPrompt
    ) {
      this.resetExplanationState();
    }
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
    const nextVisionaryPrompt = control.visionary_prompt?.trim() ?? '';
    const nextArchitectPrompt = control.architect_prompt?.trim() ?? '';
    const nextCriticPrompt = control.critic_prompt?.trim() ?? '';
    const nextPaused = control.paused ?? false;
    const nextAutomate = control.automate ?? false;
    const signature = JSON.stringify({
      repoPath: normalizedRepoPath,
      operatorPrompt: nextPrompt,
      paused: nextPaused,
      automate: nextAutomate,
      visionaryPrompt: nextVisionaryPrompt,
      architectPrompt: nextArchitectPrompt,
      criticPrompt: nextCriticPrompt,
    });

    if (signature === this.lastControlSignature) {
      await this.processPendingEdits(control);
      await this.processCommitAndPush(control);
      return;
    }

    this.paused = nextPaused;
    this.automate = nextAutomate;
    this.visionaryPrompt = nextVisionaryPrompt;
    this.architectPrompt = nextArchitectPrompt;
    this.criticPrompt = nextCriticPrompt;
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
    let normalizedEntity: Entity =
      entity.z == null
        ? { ...entity, z: 0 }
        : entity;

    if (normalizedEntity.type === 'agent' && normalizedEntity.memory == null) {
      normalizedEntity = { ...normalizedEntity, memory: createDefaultAgentMemory() };
    }

    this.entities.set(normalizedEntity.id, normalizedEntity);
    this.invalidateStructureCache();

    if (normalizedEntity.type === 'agent') {
      this.agentIds.push(normalizedEntity.id);
    }

    if (normalizedEntity.type === 'goal') {
      this.goalId = normalizedEntity.id;
    }

    if (isSolidEntity(normalizedEntity)) {
      this.solidGrid[toIndex(normalizedEntity.x, normalizedEntity.y, getPositionZ(normalizedEntity))] = normalizedEntity.id;
    }

    const key = getPositionKey(normalizedEntity);
    const list = this.positionIndex.get(key) ?? [];
    list.push(normalizedEntity.id);
    this.positionIndex.set(key, list);
  }

  private deleteEntity(entityId: string): void {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return;
    }

    this.entities.delete(entityId);
    this.invalidateStructureCache();

    if (entity.type === 'agent') {
      const nextAgentIds = this.agentIds.filter((id) => id !== entityId);
      this.agentIds.length = 0;
      this.agentIds.push(...nextAgentIds);
      this.pendingAiAgents.delete(entityId);
      this.decisionQueue.delete(entityId);
      this.pendingEditAgents.delete(entityId);
    }

    if (entity.type === 'goal' && this.goalId === entityId) {
      this.goalId = '';
    }

    if (isSolidEntity(entity)) {
      this.solidGrid[toIndex(entity.x, entity.y, getPositionZ(entity))] = null;
    }

    const key = getPositionKey(entity);
    const list = this.positionIndex.get(key);
    if (!list) {
      return;
    }

    const filtered = list.filter((id) => id !== entityId);
    if (filtered.length === 0) {
      this.positionIndex.delete(key);
      return;
    }

    this.positionIndex.set(key, filtered);
  }

  private patchEntity(entityId: string, patch: Partial<Entity>): Entity | null {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return null;
    }

    const updatedEntity: Entity = {
      ...entity,
      ...patch,
      z: patch.z ?? entity.z ?? 0,
    };

    this.entities.set(entityId, updatedEntity);
    this.invalidateStructureCache();

    if (
      (patch.x !== undefined && patch.x !== entity.x) ||
      (patch.y !== undefined && patch.y !== entity.y) ||
      (patch.z !== undefined && patch.z !== getPositionZ(entity))
    ) {
      if (isSolidEntity(entity)) {
        this.solidGrid[toIndex(entity.x, entity.y, getPositionZ(entity))] = null;
      }

      const oldKey = getPositionKey(entity);
      const newKey = getPositionKey(updatedEntity);
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

      if (isSolidEntity(updatedEntity)) {
        this.solidGrid[toIndex(updatedEntity.x, updatedEntity.y, getPositionZ(updatedEntity))] = updatedEntity.id;
      }
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

  private getAgentsByRole(role: AgentRole): Entity[] {
    const result: Entity[] = [];
    for (const agentId of this.agentIds) {
      const agent = this.entities.get(agentId);
      if (!agent || agent.type !== 'agent') {
        continue;
      }

      if (getAgentRole(agent) === role) {
        result.push(agent);
      }
    }
    return result;
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

  private getAgentMemory(agentId: string): AgentMemory {
    const agent = this.entities.get(agentId);
    if (!agent || agent.type !== 'agent') {
      return createDefaultAgentMemory();
    }

    return agent.memory ?? createDefaultAgentMemory();
  }

  private updateAgentMemory(
    agentId: string,
    update: (memory: AgentMemory) => AgentMemory,
  ): void {
    const agent = this.entities.get(agentId);
    if (!agent || agent.type !== 'agent') {
      return;
    }

    this.patchEntity(agentId, {
      memory: update(agent.memory ?? createDefaultAgentMemory()),
      tick_updated: this.absoluteTick,
    });
  }

  private getNeighborhoodPositions(position: Position): Position[] {
    const z = getPositionZ(position);

    return [
      { x: position.x, y: position.y, z },
      { x: position.x, y: position.y - 1, z },
      { x: position.x + 1, y: position.y, z },
      { x: position.x, y: position.y + 1, z },
      { x: position.x - 1, y: position.y, z },
    ].filter(isWithinBounds);
  }

  private getVisiblePheromones(agent: Entity): PheromoneSignal[] {
    const visiblePheromones: PheromoneSignal[] = [];

    for (const position of this.getNeighborhoodPositions(agent)) {
      const ids = this.positionIndex.get(getPositionKey(position)) ?? [];

      for (const id of ids) {
        const entity = this.entities.get(id);
        if (
          !entity ||
          entity.type !== 'pheromone' ||
          !entity.author_id ||
          !entity.message ||
          entity.ttl_ticks == null
        ) {
          continue;
        }

        visiblePheromones.push({
          author_id: entity.author_id,
          message: entity.message,
          ttl_remaining: entity.ttl_ticks,
        });
      }
    }

    return visiblePheromones.sort((left, right) =>
      left.author_id.localeCompare(right.author_id) ||
      left.message.localeCompare(right.message) ||
      left.ttl_remaining - right.ttl_remaining,
    );
  }

  private getStructureAtPosition(position: Position): Entity | null {
    for (const entity of this.getStructureEntities()) {
      if (
        entity.x === position.x &&
        entity.y === position.y &&
        getPositionZ(entity) === getPositionZ(position)
      ) {
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
      entity.git_status === 'deleted' ||
      entity.tether_broken === true
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
      this.advanceExplanationStream();
      this.pollOperatorControlsIfNeeded();
      this.queueSupabaseSync();

      if (this.paused) {
        return;
      }

      this.applyPendingOverlayIfReady();
      if (this.absoluteTick > 0 && this.absoluteTick % CLOCK_PERIOD === 0) {
        this.runQueenCycle();
      }
      this.expirePheromones();
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

  private runQueenCycle(): void {
    this.queenState.cycle += 1;
    this.queenState.pheromoneAlarm = computeAlarm(this.getStructureEntities());
    this.queenState.pheromoneUrgency = computeUrgency(this.activeTasks);
    this.queenState.lastTick = this.absoluteTick;
    this.queenState.updatedAt = new Date().toISOString();
    void saveQueenState(this.queenState);
    console.log(
      `[queen] cycle=${this.queenState.cycle} alarm=${this.queenState.pheromoneAlarm} urgency=${this.queenState.pheromoneUrgency}`,
    );
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

    const architects = this.getAgentsByRole('architect');
    for (const architect of architects) {
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
    this.processAutoCommit();
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
    this.hasAutoCommittedForCurrentTasks = false;
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
      '',
    );

    if (result.approved) {
      task.status = 'approved';
      task.review_feedback = result.feedback;
    } else {
      task.status = 'revision_needed';
      task.review_feedback = result.feedback;

      if (task.assigned_agent_id) {
        this.updateAgentMemory(task.assigned_agent_id, (memory) => ({
          ...memory,
          lessons: [...memory.lessons, result.feedback],
        }));
      }
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

  private processAutoCommit(): void {
    if (this.autoCommitPromise !== null) {
      return;
    }

    if (this.activeTasks.length === 0) {
      return;
    }

    const allDone = this.activeTasks.every((t) => t.status === 'done');
    if (!allDone) {
      return;
    }

    if (this.hasAutoCommittedForCurrentTasks) {
      return;
    }

    this.hasAutoCommittedForCurrentTasks = true;
    this.autoCommitPromise = this.runAutoCommit().finally(() => {
      this.autoCommitPromise = null;
    });
  }

  private async runAutoCommit(): Promise<void> {
    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.error('[auto-commit] No active repository to commit.');
      return;
    }

    let commitMessage = await this.generateCommitMessage();
    if (!commitMessage) {
      commitMessage = 'lux: auto-commit completed tasks';
    }

    try {
      const git = simpleGit(repoRoot);
      await git.commit(commitMessage);
      console.log(`[auto-commit] committed: ${commitMessage}`);

      if (this.automate) {
        await git.push();
        console.log('[auto-commit] pushed to remote');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown auto-commit failure';
      console.error(`[auto-commit] ${message}`);
    }
  }

  private async generateCommitMessage(): Promise<string | null> {
    const descriptions = this.activeTasks
      .map((t) => t.description)
      .filter((d) => d.length > 0);

    if (descriptions.length === 0) {
      return null;
    }

    const aiMessage = await this.aiNavigator.requestCommitMessage(descriptions);
    if (aiMessage) {
      return aiMessage;
    }

    const summary = descriptions.length <= 2
      ? descriptions.join('; ')
      : `${descriptions[0]} and ${descriptions.length - 1} more tasks`;

    const firstLine = `lux: ${summary}`.slice(0, 72);
    const body = this.activeTasks
      .filter((t) => t.description.length > 0)
      .map((t) => `- ${t.id}: ${t.description}`)
      .join('\n');

    return `${firstLine}\n\n${body}`;
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

  private getFullContentForAgent(agent: Entity): string | null {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
    if (
      currentNode &&
      currentNode.type === 'file' &&
      currentNode.lock_owner === agent.id
    ) {
      return currentNode.content ?? currentNode.content_preview ?? null;
    }
    return null;
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

    // Re-evaluate tether breakage in case files were deleted/renamed since import
    for (const entity of this.getStructureEntities()) {
      if (entity.type !== 'file' || !entity.tether_to) {
        continue;
      }
      const hasBroken = entity.tether_to.some((targetPath) => !this.findStructureByPath(targetPath));
      if (hasBroken !== (entity.tether_broken ?? false)) {
        this.patchEntity(entity.id, { tether_broken: hasBroken });
      }
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
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
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
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
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

    // Tether patrol: broken imports are highest-priority asymmetry
    const brokenTethers = structureNodes.filter((entity) =>
      entity.tether_broken === true &&
      entity.lock_owner == null &&
      entity.node_state !== 'in-progress',
    );
    if (brokenTethers.length > 0) {
      return this.selectClosestStructure(agent, brokenTethers);
    }

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

  private expirePheromones(): void {
    const pheromones = Array.from(this.entities.values()).filter((entity) => entity.type === 'pheromone');

    for (const pheromone of pheromones) {
      const nextTtl = (pheromone.ttl_ticks ?? 0) - 1;
      if (nextTtl <= 0) {
        this.deleteEntity(pheromone.id);
        continue;
      }

      this.patchEntity(pheromone.id, {
        ttl_ticks: nextTtl,
        tick_updated: this.absoluteTick,
      });
    }
  }

  private executeDecision(agent: Entity, decision: AgentDecision): void {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
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

    if (decision.action === 'patch') {
      this.executePatch(agent, decision);
      return;
    }

    if (decision.action === 'insert') {
      this.executeInsert(agent, decision);
      return;
    }

    if (decision.action === 'delete') {
      this.executeDelete(agent, decision);
      return;
    }

    if (decision.action === 'broadcast') {
      this.executeBroadcast(agent, decision);
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

    if (target.type === 'file' && target.path) {
      const contentHash = getContentHashForMemory(target);
      this.updateAgentMemory(agent.id, (memory) => ({
        ...memory,
        files_read: {
          ...memory.files_read,
          [target.path!]: {
            content_hash: contentHash,
            tick_read: this.absoluteTick,
            summary: '',
          },
        },
      }));
    }

    this.maybeExplainTarget(agent, target, decision);
  }

  private resetExplanationState(): void {
    this.explanationRequestId += 1;
    this.explanationPromise = null;
    this.explanationState = createEmptyExplanationState();
  }

  private buildExplanationCacheKey(prompt: string, targetPath: string, contentHash: string): string {
    return createHash('sha1')
      .update(`${prompt}\n${targetPath}\n${contentHash}`)
      .digest('hex');
  }

  private getExplainableFileContent(
    target: Entity,
  ): { content: string; contentState: 'complete' | 'partial' } | null {
    if (target.is_binary) {
      return null;
    }

    if (target.content && target.content.length > 0) {
      return {
        content: target.content,
        contentState: 'complete',
      };
    }

    if (target.content_preview && target.content_preview.length > 0) {
      return {
        content: target.content_preview,
        contentState: 'partial',
      };
    }

    return null;
  }

  private updateAgentFileSummary(agentId: string | null, targetPath: string | null, summary: string): void {
    if (!agentId || !targetPath) {
      return;
    }

    this.updateAgentMemory(agentId, (memory) => {
      const existing = memory.files_read[targetPath];
      if (!existing) {
        return memory;
      }

      return {
        ...memory,
        files_read: {
          ...memory.files_read,
          [targetPath]: {
            ...existing,
            summary,
          },
        },
      };
    });
  }

  private applyExplanationResult(
    agentId: string,
    targetPath: string,
    contentHash: string,
    cacheKey: string,
    prompt: string,
    text: string,
    immediate: boolean,
  ): void {
    this.explanationCache.set(cacheKey, {
      text,
      updatedAtTick: this.absoluteTick,
    });

    this.explanationState = {
      status: immediate ? 'complete' : 'streaming',
      targetPath,
      agentId,
      contentHash,
      cacheKey,
      prompt,
      text: immediate ? text : '',
      fullText: text,
      error: null,
      updatedAtTick: this.absoluteTick,
    };

    if (immediate) {
      this.updateAgentFileSummary(agentId, targetPath, text);
    }
  }

  private applyExplanationError(
    agentId: string,
    targetPath: string,
    contentHash: string,
    cacheKey: string,
    prompt: string,
    error: string,
  ): void {
    this.explanationState = {
      status: 'error',
      targetPath,
      agentId,
      contentHash,
      cacheKey,
      prompt,
      text: null,
      fullText: null,
      error,
      updatedAtTick: this.absoluteTick,
    };
  }

  private maybeExplainTarget(agent: Entity, target: Entity, decision: AgentDecision): void {
    if (this.operatorAction !== 'explain' || target.path == null || target.path !== this.operatorTargetPath) {
      return;
    }

    const prompt = this.operatorPrompt.trim();
    if (prompt.length === 0) {
      return;
    }

    if (target.type !== 'file') {
      this.applyExplanationError(
        agent.id,
        target.path,
        getContentHashForMemory(target),
        this.buildExplanationCacheKey(prompt, target.path, getContentHashForMemory(target)),
        prompt,
        'Explanation currently requires a file target.',
      );
      return;
    }

    const contentHash = getContentHashForMemory(target);
    const cacheKey = decision.explanation_cache_key ?? this.buildExplanationCacheKey(prompt, target.path, contentHash);
    const cachedText = decision.explanation_text?.trim() || this.explanationCache.get(cacheKey)?.text || null;
    if (cachedText) {
      this.applyExplanationResult(agent.id, target.path, contentHash, cacheKey, prompt, cachedText, true);
      return;
    }

    if (
      this.explanationState.cacheKey === cacheKey &&
      (
        this.explanationState.status === 'pending' ||
        this.explanationState.status === 'streaming' ||
        this.explanationState.status === 'complete'
      )
    ) {
      return;
    }

    if (
      this.explanationState.cacheKey === cacheKey &&
      this.explanationState.status === 'error' &&
      this.absoluteTick - (this.explanationState.updatedAtTick ?? 0) < CLOCK_PERIOD
    ) {
      return;
    }

    const explainable = this.getExplainableFileContent(target);
    if (!explainable) {
      this.applyExplanationError(
        agent.id,
        target.path,
        contentHash,
        cacheKey,
        prompt,
        target.is_binary
          ? 'Binary files cannot be explained from text content.'
          : 'No readable file content is available for explanation.',
      );
      return;
    }

    const requestId = ++this.explanationRequestId;
    this.explanationState = {
      status: 'pending',
      targetPath: target.path,
      agentId: agent.id,
      contentHash,
      cacheKey,
      prompt,
      text: null,
      fullText: null,
      error: null,
      updatedAtTick: this.absoluteTick,
    };

    this.explanationPromise = this.runExplanationRequest({
      requestId,
      agentId: agent.id,
      targetPath: target.path,
      contentHash,
      cacheKey,
      prompt,
      content: explainable.content,
      contentState: explainable.contentState,
    }).finally(() => {
      if (this.explanationRequestId === requestId) {
        this.explanationPromise = null;
      }
    });
  }

  private async runExplanationRequest(params: {
    requestId: number;
    agentId: string;
    targetPath: string;
    contentHash: string;
    cacheKey: string;
    prompt: string;
    content: string;
    contentState: 'complete' | 'partial';
  }): Promise<void> {
    const explanation = await this.aiNavigator.requestExplanation(
      params.prompt,
      params.targetPath,
      params.content,
      params.contentState,
    );

    if (
      this.explanationRequestId !== params.requestId ||
      this.operatorAction !== 'explain' ||
      this.operatorTargetPath !== params.targetPath
    ) {
      return;
    }

    if (!explanation) {
      this.applyExplanationError(
        params.agentId,
        params.targetPath,
        params.contentHash,
        params.cacheKey,
        params.prompt,
        'Explanation request failed; agent will retry.',
      );
      return;
    }

    this.applyExplanationResult(
      params.agentId,
      params.targetPath,
      params.contentHash,
      params.cacheKey,
      params.prompt,
      explanation,
      false,
    );
    console.log(`[explain] ${params.agentId} generated explanation for ${params.targetPath}`);
  }

  private advanceExplanationStream(): void {
    const fullText = this.explanationState.fullText;
    if (this.explanationState.status !== 'streaming' || !fullText) {
      return;
    }

    const currentLength = this.explanationState.text?.length ?? 0;
    const nextLength = Math.min(
      fullText.length,
      currentLength + EXPLANATION_STREAM_CHARS_PER_TICK,
    );

    if (nextLength <= currentLength) {
      return;
    }

    this.explanationState = {
      ...this.explanationState,
      text: fullText.slice(0, nextLength),
      updatedAtTick: this.absoluteTick,
    };

    if (nextLength >= fullText.length) {
      this.explanationState = {
        ...this.explanationState,
        status: 'complete',
        text: fullText,
        updatedAtTick: this.absoluteTick,
      };
      this.updateAgentFileSummary(
        this.explanationState.agentId,
        this.explanationState.targetPath,
        fullText,
      );
      console.log(`[explain] explanation stream completed for ${this.explanationState.targetPath ?? 'unknown target'}`);
    }
  }

  private executeBroadcast(agent: Entity, decision: AgentDecision): void {
    const message = decision.message?.trim();
    if (!message) {
      console.log(`[broadcast] ${agent.id} attempted an empty broadcast at tick ${this.absoluteTick}`);
      return;
    }

    let sequence = 0;
    let pheromoneId = `pheromone:${agent.id}:${this.absoluteTick}:${sequence}`;
    while (this.entities.has(pheromoneId)) {
      sequence += 1;
      pheromoneId = `pheromone:${agent.id}:${this.absoluteTick}:${sequence}`;
    }

    this.registerEntity({
      id: pheromoneId,
      type: 'pheromone',
      x: agent.x,
      y: agent.y,
      z: getPositionZ(agent),
      mass: 1,
      tick_updated: this.absoluteTick,
      author_id: agent.id,
      message,
      ttl_ticks: PHEROMONE_TTL_TICKS,
    });

    this.updateAgentMemory(agent.id, (memory) => ({
      ...memory,
      last_broadcast: {
        message,
        tick: this.absoluteTick,
      },
    }));

    console.log(`[broadcast] ${agent.id} emitted pheromone "${message}" at tick ${this.absoluteTick}`);
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

    try {
      const { absolutePath, repoRelativePath } = this.resolveWritableRepoFile(repoRoot, editPath);

      await writeFile(absolutePath, editContent, 'utf8');

      const git = simpleGit(repoRoot);
      await git.add(['--', repoRelativePath]);

      const entityId = `file:${repoRelativePath}`;
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

      console.log(`[edit] wrote ${repoRelativePath} and staged changes`);
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
    if (this.pendingEditAgents.has(agent.id)) {
      console.log(`[edit] ${agent.id} already has a pending edit at tick ${this.absoluteTick}`);
      return;
    }

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
    const newContent = decision.content;
    const task = this.activeTasks.find(
      (candidate) =>
        candidate.assigned_agent_id === agent.id &&
        candidate.target_path === filePath &&
        (candidate.status === 'assigned' || candidate.status === 'revision_needed' || candidate.status === 'in_progress'),
    );
    const previousTaskStatus = task?.status;
    if (task) {
      task.status = 'in_progress';
      task.validation = null;
      task.updated_at_tick = this.absoluteTick;
    }

    this.pendingEditAgents.add(agent.id);
    void (async () => {
      try {
        const { absolutePath, repoRelativePath } = this.resolveWritableRepoFile(repoRoot, filePath);
        await writeFile(absolutePath, newContent, 'utf8');
        const git = simpleGit(repoRoot);
        await git.add(['--', repoRelativePath]);

        const preview = newContent.slice(0, 200);
        this.patchEntity(target.id, {
          content: newContent,
          content_preview: preview,
          git_status: 'modified',
          tick_updated: this.absoluteTick,
        });

        console.log(`[edit] ${agent.id} wrote ${filePath} at tick ${this.absoluteTick}`);
      } catch (error) {
        if (task && previousTaskStatus !== undefined) {
          task.status = previousTaskStatus;
          task.updated_at_tick = this.absoluteTick;
        }

        const message = error instanceof Error ? error.message : 'Unknown edit failure';
        console.error(`[edit] ${message}`);
      } finally {
        this.pendingEditAgents.delete(agent.id);
      }
    })();
  }

  private executePatch(agent: Entity, decision: AgentDecision): void {
    if (this.pendingEditAgents.has(agent.id)) {
      console.log(`[patch] ${agent.id} already has a pending edit at tick ${this.absoluteTick}`);
      return;
    }

    const target = this.findReadableTarget(agent, decision.target);
    if (!target || target.type !== 'file') {
      console.log(
        `[patch] ${agent.id} failed to patch "${decision.target ?? ''}" at tick ${this.absoluteTick} (not a writable file)`,
      );
      return;
    }

    if (decision.old_text === undefined || decision.new_text === undefined) {
      console.log(
        `[patch] ${agent.id} attempted to patch "${decision.target ?? ''}" at tick ${this.absoluteTick} (missing old_text or new_text)`,
      );
      return;
    }

    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.log(`[patch] ${agent.id} cannot patch — no active repo`);
      return;
    }

    const filePath = target.path ?? '';
    const currentContent = target.content ?? '';

    let newContent: string;
    try {
      newContent = applyPatch(currentContent, decision.old_text, decision.new_text);
    } catch {
      console.log(`[patch] ${agent.id} failed: old_text not found in ${filePath}`);
      return;
    }
    const task = this.activeTasks.find(
      (candidate) =>
        candidate.assigned_agent_id === agent.id &&
        candidate.target_path === filePath &&
        (candidate.status === 'assigned' || candidate.status === 'revision_needed' || candidate.status === 'in_progress'),
    );
    const previousTaskStatus = task?.status;
    if (task) {
      task.status = 'in_progress';
      task.validation = null;
      task.updated_at_tick = this.absoluteTick;
    }

    this.pendingEditAgents.add(agent.id);
    void (async () => {
      try {
        const { absolutePath, repoRelativePath } = this.resolveWritableRepoFile(repoRoot, filePath);
        await writeFile(absolutePath, newContent, 'utf8');
        const git = simpleGit(repoRoot);
        await git.add(['--', repoRelativePath]);

        const preview = newContent.slice(0, 200);
        this.patchEntity(target.id, {
          content: newContent,
          content_preview: preview,
          git_status: 'modified',
          tick_updated: this.absoluteTick,
        });

        console.log(`[patch] ${agent.id} patched ${filePath} at tick ${this.absoluteTick}`);
      } catch (error) {
        if (task && previousTaskStatus !== undefined) {
          task.status = previousTaskStatus;
          task.updated_at_tick = this.absoluteTick;
        }
        const message = error instanceof Error ? error.message : 'Unknown patch failure';
        console.error(`[patch] ${message}`);
      } finally {
        this.pendingEditAgents.delete(agent.id);
      }
    })();
  }

  private executeInsert(agent: Entity, decision: AgentDecision): void {
    if (this.pendingEditAgents.has(agent.id)) {
      console.log(`[insert] ${agent.id} already has a pending edit at tick ${this.absoluteTick}`);
      return;
    }

    const target = this.findReadableTarget(agent, decision.target);
    if (!target || target.type !== 'file') {
      console.log(
        `[insert] ${agent.id} failed to insert into "${decision.target ?? ''}" at tick ${this.absoluteTick} (not a writable file)`,
      );
      return;
    }

    if (decision.after_line === undefined || decision.text === undefined) {
      console.log(
        `[insert] ${agent.id} attempted to insert into "${decision.target ?? ''}" at tick ${this.absoluteTick} (missing after_line or text)`,
      );
      return;
    }

    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.log(`[insert] ${agent.id} cannot insert — no active repo`);
      return;
    }

    const filePath = target.path ?? '';
    const currentContent = target.content ?? '';
    const newContent = applyInsert(currentContent, decision.after_line, decision.text);

    const task = this.activeTasks.find(
      (candidate) =>
        candidate.assigned_agent_id === agent.id &&
        candidate.target_path === filePath &&
        (candidate.status === 'assigned' || candidate.status === 'revision_needed' || candidate.status === 'in_progress'),
    );
    const previousTaskStatus = task?.status;
    if (task) {
      task.status = 'in_progress';
      task.validation = null;
      task.updated_at_tick = this.absoluteTick;
    }

    this.pendingEditAgents.add(agent.id);
    void (async () => {
      try {
        const { absolutePath, repoRelativePath } = this.resolveWritableRepoFile(repoRoot, filePath);
        await writeFile(absolutePath, newContent, 'utf8');
        const git = simpleGit(repoRoot);
        await git.add(['--', repoRelativePath]);

        const preview = newContent.slice(0, 200);
        this.patchEntity(target.id, {
          content: newContent,
          content_preview: preview,
          git_status: 'modified',
          tick_updated: this.absoluteTick,
        });

        console.log(`[insert] ${agent.id} inserted into ${filePath} at tick ${this.absoluteTick}`);
      } catch (error) {
        if (task && previousTaskStatus !== undefined) {
          task.status = previousTaskStatus;
          task.updated_at_tick = this.absoluteTick;
        }
        const message = error instanceof Error ? error.message : 'Unknown insert failure';
        console.error(`[insert] ${message}`);
      } finally {
        this.pendingEditAgents.delete(agent.id);
      }
    })();
  }

  private executeDelete(agent: Entity, decision: AgentDecision): void {
    if (this.pendingEditAgents.has(agent.id)) {
      console.log(`[delete] ${agent.id} already has a pending edit at tick ${this.absoluteTick}`);
      return;
    }

    const target = this.findReadableTarget(agent, decision.target);
    if (!target || target.type !== 'file') {
      console.log(
        `[delete] ${agent.id} failed to delete from "${decision.target ?? ''}" at tick ${this.absoluteTick} (not a writable file)`,
      );
      return;
    }

    if (decision.start_line === undefined || decision.end_line === undefined) {
      console.log(
        `[delete] ${agent.id} attempted to delete from "${decision.target ?? ''}" at tick ${this.absoluteTick} (missing start_line or end_line)`,
      );
      return;
    }

    const repoRoot = this.activeRepoPath;
    if (!repoRoot) {
      console.log(`[delete] ${agent.id} cannot delete — no active repo`);
      return;
    }

    const filePath = target.path ?? '';
    const currentContent = target.content ?? '';
    let newContent: string;
    try {
      newContent = applyDelete(currentContent, decision.start_line, decision.end_line);
    } catch {
      console.log(`[delete] ${agent.id} failed: invalid line range ${decision.start_line}-${decision.end_line} in ${filePath}`);
      return;
    }

    const task = this.activeTasks.find(
      (candidate) =>
        candidate.assigned_agent_id === agent.id &&
        candidate.target_path === filePath &&
        (candidate.status === 'assigned' || candidate.status === 'revision_needed' || candidate.status === 'in_progress'),
    );
    const previousTaskStatus = task?.status;
    if (task) {
      task.status = 'in_progress';
      task.validation = null;
      task.updated_at_tick = this.absoluteTick;
    }

    this.pendingEditAgents.add(agent.id);
    void (async () => {
      try {
        const { absolutePath, repoRelativePath } = this.resolveWritableRepoFile(repoRoot, filePath);
        await writeFile(absolutePath, newContent, 'utf8');
        const git = simpleGit(repoRoot);
        await git.add(['--', repoRelativePath]);

        const preview = newContent.slice(0, 200);
        this.patchEntity(target.id, {
          content: newContent,
          content_preview: preview,
          git_status: 'modified',
          tick_updated: this.absoluteTick,
        });

        console.log(`[delete] ${agent.id} deleted lines ${decision.start_line}-${decision.end_line} from ${filePath} at tick ${this.absoluteTick}`);
      } catch (error) {
        if (task && previousTaskStatus !== undefined) {
          task.status = previousTaskStatus;
          task.updated_at_tick = this.absoluteTick;
        }
        const message = error instanceof Error ? error.message : 'Unknown delete failure';
        console.error(`[delete] ${message}`);
      } finally {
        this.pendingEditAgents.delete(agent.id);
      }
    })();
  }

  private executeSubmit(agent: Entity): void {
    if (this.pendingEditAgents.has(agent.id)) {
      console.log(`[submit] ${agent.id} cannot submit while an edit is still pending`);
      return;
    }

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
    assignedTask.validation = null;
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

    return { x: agent.x, y: agent.y, z: getPositionZ(agent) };
  }

  private canOccupy(position: Position, actorId: string): boolean {
    if (!isWithinBounds(position)) {
      return false;
    }

    const occupantId = this.solidGrid[toIndex(position.x, position.y, getPositionZ(position))];
    return occupantId === null || occupantId === actorId;
  }

  private moveEntity(entity: Entity, nextPosition: Position): void {
    if (isSolidEntity(entity)) {
      this.solidGrid[toIndex(entity.x, entity.y, getPositionZ(entity))] = null;
    }

    const oldKey = getPositionKey(entity);
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
      z: nextPosition.z ?? entity.z ?? 0,
      tick_updated: this.absoluteTick,
    };

    this.entities.set(entity.id, updatedEntity);
    this.invalidateStructureCache();

    const newKey = getPositionKey(updatedEntity);
    const newList = this.positionIndex.get(newKey) ?? [];
    newList.push(entity.id);
    this.positionIndex.set(newKey, newList);

    if (isSolidEntity(updatedEntity)) {
      this.solidGrid[toIndex(updatedEntity.x, updatedEntity.y, getPositionZ(updatedEntity))] = updatedEntity.id;
    }
  }

  private queueAiDecisions(): void {
    for (const agentId of this.agentIds) {
      const pendingRequest = this.pendingAiAgents.get(agentId);
      if (pendingRequest?.runId === this.currentRunId || this.decisionQueue.has(agentId)) {
        continue;
      }

      if (this.pendingEditAgents.has(agentId)) {
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

  private createExplainReadDecision(target: Entity): AgentDecision {
    const readableTarget = target.path ?? target.name ?? 'current-node';

    if (this.operatorAction !== 'explain' || target.type !== 'file' || !target.path) {
      return {
        action: 'read',
        target: readableTarget,
      };
    }

    const prompt = this.operatorPrompt.trim();
    const contentHash = getContentHashForMemory(target);
    const cacheKey = this.buildExplanationCacheKey(prompt, target.path, contentHash);
    const cached = this.explanationCache.get(cacheKey);

    return {
      action: 'read',
      target: readableTarget,
      explanation_cache_key: cacheKey,
      explanation_text: cached?.text,
    };
  }

  private async requestDecisionForAgent(
    agent: Entity,
    scan: NeighborhoodScan,
  ): Promise<AgentDecision> {
    if (this.pendingEditAgents.has(agent.id)) {
      return { action: 'wait' };
    }

    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
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
      return this.createExplainReadDecision(operatorTarget);
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
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
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

  private resolveWritableRepoFile(
    repoRoot: string,
    relativePath: string,
  ): { absolutePath: string; repoRelativePath: string } {
    const absolutePath = resolvePathWithinRoot(repoRoot, relativePath);
    if (!absolutePath) {
      throw new Error(`Path "${relativePath}" resolves outside the active repository.`);
    }

    return {
      absolutePath,
      repoRelativePath: path.relative(path.resolve(repoRoot), absolutePath).split(path.sep).join('/'),
    };
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
        position: { x: target.x, y: target.y, z: getPositionZ(target) },
      };
    }

    return {
      path: null,
      position: { x: agent.x, y: agent.y, z: getPositionZ(agent) },
    };
  }

  private scanNeighborhood(agent: Entity): NeighborhoodScan {
    const objective = this.getObjectiveForAgent(agent);

    return {
      current_tick: this.getCurrentPhase(),
      absolute_tick: this.absoluteTick,
      agent_role: getAgentRole(agent) ?? 'architect',
      agent: { x: agent.x, y: agent.y, z: getPositionZ(agent) },
      goal: { x: GOAL_POSITION.x, y: GOAL_POSITION.y, z: getPositionZ(GOAL_POSITION) },
      objective: objective.position,
      operator_action: this.operatorAction,
      operator_target_query: this.operatorTargetQuery,
      objective_path: objective.path,
      operator_prompt: this.operatorPrompt.length > 0 ? this.operatorPrompt : null,
      agent_prompt: this.getAgentPrompt(agent).length > 0 ? this.getAgentPrompt(agent) : null,
      task_context: this.getTaskContextForAgent(agent),
      current: this.lookupTile({ x: agent.x, y: agent.y, z: getPositionZ(agent) }, agent.id),
      north: this.lookupTile({ x: agent.x, y: agent.y - 1, z: getPositionZ(agent) }),
      east: this.lookupTile({ x: agent.x + 1, y: agent.y, z: getPositionZ(agent) }),
      south: this.lookupTile({ x: agent.x, y: agent.y + 1, z: getPositionZ(agent) }),
      west: this.lookupTile({ x: agent.x - 1, y: agent.y, z: getPositionZ(agent) }),
      pheromones: this.getVisiblePheromones(agent),
      agent_memory: this.getAgentMemory(agent.id),
      full_content: this.getFullContentForAgent(agent),
    };
  }

  private findEntityAtPosition(position: Position, excludeId?: string): Entity | null {
    const ids = this.positionIndex.get(getPositionKey(position));
    if (!ids) {
      return null;
    }

    // Goal fast path
    if (this.goalId.length > 0) {
      const goal = this.entities.get(this.goalId);
      if (
        goal &&
        goal.id !== excludeId &&
        goal.x === position.x &&
        goal.y === position.y &&
        getPositionZ(goal) === getPositionZ(position)
      ) {
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
      if (entity.type === 'pheromone') {
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
    const occupant = entity.type === 'pheromone' ? 'empty' : entity.type;

    return {
      occupant,
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

    const solidId = this.solidGrid[toIndex(position.x, position.y, getPositionZ(position))];
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
    const syncedEntities = snapshot.entities.filter((entity) => entity.type !== 'pheromone');
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
          .upsert(syncedEntities, { onConflict: 'id' });

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

  private computeAgentActivities(): AgentActivity[] {
    const activities: AgentActivity[] = [];

    for (const agentId of this.agentIds) {
      const agent = this.entities.get(agentId);
      if (!agent || agent.type !== 'agent') {
        continue;
      }

      const role = getAgentRole(agent) ?? 'architect';

      if (this.pendingAiAgents.has(agent.id)) {
        activities.push({
          agent_id: agent.id,
          agent_role: role,
          status: 'thinking',
          target_path: agent.objective_path ?? null,
          tick: this.absoluteTick,
        });
        continue;
      }

      if (this.pendingEditAgents.has(agent.id)) {
        activities.push({
          agent_id: agent.id,
          agent_role: role,
          status: 'editing',
          target_path: agent.objective_path ?? null,
          tick: this.absoluteTick,
        });
        continue;
      }

      const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y, z: getPositionZ(agent) });
      if (currentNode && currentNode.lock_owner === agent.id) {
        activities.push({
          agent_id: agent.id,
          agent_role: role,
          status: 'reading',
          target_path: currentNode.path ?? currentNode.name ?? null,
          tick: this.absoluteTick,
        });
        continue;
      }

      if (agent.objective_path) {
        activities.push({
          agent_id: agent.id,
          agent_role: role,
          status: 'walking',
          target_path: agent.objective_path,
          tick: this.absoluteTick,
        });
        continue;
      }

      activities.push({
        agent_id: agent.id,
        agent_role: role,
        status: 'idle',
        target_path: null,
        tick: this.absoluteTick,
      });
    }

    return activities;
  }

  private createWorldState(): WorldState {
    const agentActivities = this.computeAgentActivities();
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
      explanation_status: this.explanationState.status,
      explanation_target_path: this.explanationState.targetPath,
      explanation_agent_id: this.explanationState.agentId,
      explanation_content_hash: this.explanationState.contentHash,
      explanation_text: this.explanationState.text,
      explanation_error: this.explanationState.error,
      explanation_updated_at_tick: this.explanationState.updatedAtTick,
      queen_cycle: this.queenState.cycle,
      queen_alarm: this.queenState.pheromoneAlarm,
      queen_urgency: this.queenState.pheromoneUrgency,
      active_tasks: this.activeTasks.length > 0 ? this.activeTasks : null,
      agent_activities: agentActivities.length > 0 ? agentActivities : null,
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

    const architects = this.getAgentsByRole('architect');
    const primaryArchitect = architects[0] ?? this.getPrimaryAgent();
    const visionary = this.getAgentByRole('visionary');
    const critic = this.getAgentByRole('critic');
    const distance = manhattanDistance(primaryArchitect, GOAL_POSITION);
    const structureNodes = this.getStructureEntities();
    const taskCount = structureNodes.filter((entity) => entity.node_state === 'task').length;
    const asymmetryCount = structureNodes.filter((entity) => entity.node_state === 'asymmetry').length;
    const pendingTasks = this.activeTasks.filter((t) => t.status === 'pending').length;
    const inProgressTasks = this.activeTasks.filter((t) => t.status === 'in_progress' || t.status === 'assigned').length;
    const reviewTasks = this.activeTasks.filter((t) => t.status === 'awaiting_review').length;
    const doneTasks = this.activeTasks.filter((t) => t.status === 'done').length;

    console.log(
      `[tick ${String(this.absoluteTick).padStart(3, '0')} phase ${this.getCurrentPhase()}] architects=[${architects.map((a) => `(${a.x},${a.y})`).join(', ')}] visionary=${visionary ? `(${visionary.x},${visionary.y})` : 'off'} critic=${critic ? `(${critic.x},${critic.y})` : 'off'} goal_distance=${distance} nodes_task=${taskCount} nodes_asymmetry=${asymmetryCount} tasks_pending=${pendingTasks} tasks_active=${inProgressTasks} tasks_review=${reviewTasks} tasks_done=${doneTasks} queued=${this.decisionQueue.size} pending_ai=${this.pendingAiAgents.size} queue_depth=${this.getQueueDepth()} tick_ms=${this.lastTickDurationMs ?? 0} ai_latency_ms=${this.lastAiLatencyMs ?? 0} control=${this.controlStatus} supabase=${this.supabase ? 'on' : 'off'}`,
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
