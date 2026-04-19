import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { GeminiNavigator } from './ai';
import { computeChiralMass, getAgentRole } from './hivemind';
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
import { loadRepositoryOverlaySync } from './git-parser';
import { isStructureEntity } from './mass-mapper';
import { createServiceSupabaseClient } from './supabase';
import type {
  AgentDecision,
  AgentRole,
  Direction,
  Entity,
  NeighborhoodScan,
  NodeState,
  Position,
  QueuedDecision,
  TileObservation,
  WorldSnapshot,
  WorldState,
  WorldStatus,
} from './types';

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

export class LuxEngine {
  private readonly entities = new Map<string, Entity>();
  private readonly solidGrid: Array<string | null> = Array.from(
    { length: GRID_WIDTH * GRID_HEIGHT },
    () => null,
  );
  private readonly agentIds: string[] = [];
  private readonly decisionQueue = new Map<string, QueuedDecision>();
  private readonly pendingAiAgents = new Map<string, number>();
  private readonly aiNavigator = new GeminiNavigator();
  private readonly supabase = createServiceSupabaseClient();
  private readonly syncPipeline: Promise<void> = Promise.resolve();

  private absoluteTick = 0;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private restartHandle: ReturnType<typeof setTimeout> | null = null;
  private goalId = '';
  private hasLoggedSupabaseDisabled = false;
  private syncQueue = Promise.resolve();
  private currentRunId = 0;

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
    const structureCount = Array.from(this.entities.values()).filter((entity) =>
      isStructureEntity(entity),
    ).length;

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

  private resetWorld(): void {
    this.currentRunId += 1;
    this.absoluteTick = 0;
    this.goalId = '';
    this.entities.clear();
    this.agentIds.length = 0;
    this.decisionQueue.clear();
    this.pendingAiAgents.clear();
    this.solidGrid.fill(null);

    for (const entity of createInitialEntities(this.seed)) {
      this.registerEntity(entity);
    }

    for (const entity of loadRepositoryOverlaySync()) {
      this.registerEntity(entity);
    }

    this.updateHivemindState();

    if (this.goalId.length === 0) {
      throw new Error('Initial world is missing a goal entity.');
    }
  }

  private registerEntity(entity: Entity): void {
    this.entities.set(entity.id, entity);

    if (entity.type === 'agent') {
      this.agentIds.push(entity.id);
    }

    if (entity.type === 'goal') {
      this.goalId = entity.id;
    }

    if (isSolidEntity(entity)) {
      this.solidGrid[toIndex(entity.x, entity.y)] = entity.id;
    }
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
    return updatedEntity;
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
    return Array.from(this.entities.values()).filter((entity) => isStructureEntity(entity));
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
    this.applyQueuedDecisions();
    this.updateHivemindState();
    this.queueAiDecisions();
    this.queueSupabaseSync();
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
  }

  private updateHivemindState(): void {
    this.initializeStructureNodes();
    this.resolveNodeLocks();
    this.expireVerifiedNodes();

    const visionary = this.getAgentByRole('visionary');
    if (visionary) {
      const target = this.selectVisionaryTarget(visionary);
      this.patchEntity(visionary.id, { objective_path: target?.path ?? null });

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
      this.patchEntity(architect.id, { objective_path: target?.path ?? null });

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
      this.patchEntity(critic.id, { objective_path: target?.path ?? null });

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

    const maintenanceNodes = structureNodes.filter((entity) => entity.node_state === 'stable');
    return this.selectRotatingStructure(maintenanceNodes, 1);
  }

  private selectArchitectTarget(agent: Entity): Entity | null {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (currentNode && currentNode.lock_owner === agent.id) {
      return currentNode;
    }

    const activeTasks = this.getStructureEntities().filter((entity) =>
      (entity.node_state === 'task' || entity.node_state === 'asymmetry') &&
      (entity.lock_owner == null || entity.lock_owner === agent.id),
    );
    if (activeTasks.length > 0) {
      return this.selectClosestStructure(agent, activeTasks);
    }

    const maintenanceNodes = this.getStructureEntities().filter((entity) =>
      entity.node_state === 'stable' &&
      entity.lock_owner == null,
    );
    return this.selectRotatingStructure(maintenanceNodes, 2);
  }

  private selectCriticTarget(agent: Entity): Entity | null {
    const currentNode = this.getStructureAtPosition({ x: agent.x, y: agent.y });
    if (currentNode && currentNode.lock_owner === agent.id) {
      return currentNode;
    }

    const architectLocks = this.getStructureEntities().filter((entity) => {
      if (!entity.lock_owner) {
        return false;
      }

      const owner = this.entities.get(entity.lock_owner);
      return owner?.type === 'agent' && getAgentRole(owner) === 'architect';
    });
    if (architectLocks.length > 0) {
      return this.selectClosestStructure(agent, architectLocks);
    }

    const reviewTargets = this.getStructureEntities().filter((entity) =>
      entity.node_state === 'stable' &&
      entity.state_tick != null &&
      entity.state_tick > 0 &&
      (this.absoluteTick - entity.state_tick) <= VERIFICATION_TTL_TICKS &&
      entity.lock_owner == null,
    );
    if (reviewTargets.length > 0) {
      return this.selectClosestStructure(agent, reviewTargets);
    }

    const asymmetryTargets = this.getStructureEntities().filter((entity) =>
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

  private executeEdit(agent: Entity, decision: AgentDecision): void {
    console.log(
      `[edit] ${agent.id} attempted to edit "${decision.target ?? ''}" at tick ${this.absoluteTick} (Week 3 feature, ignored)`,
    );
  }

  private findReadableTarget(agent: Entity, targetName: string | undefined): Entity | null {
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
      for (const entity of this.entities.values()) {
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

    const updatedEntity: Entity = {
      ...entity,
      x: nextPosition.x,
      y: nextPosition.y,
      tick_updated: this.absoluteTick,
    };

    this.entities.set(entity.id, updatedEntity);

    if (isSolidEntity(updatedEntity)) {
      this.solidGrid[toIndex(nextPosition.x, nextPosition.y)] = updatedEntity.id;
    }
  }

  private queueAiDecisions(): void {
    for (const agentId of this.agentIds) {
      if (this.pendingAiAgents.get(agentId) === this.currentRunId || this.decisionQueue.has(agentId)) {
        continue;
      }

      const agent = this.entities.get(agentId);
      if (!agent || agent.type !== 'agent' || this.isGoalReached(agent)) {
        continue;
      }

      const issuedAtTick = this.absoluteTick;
      const scan = this.scanNeighborhood(agent);
      const runId = this.currentRunId;

      this.pendingAiAgents.set(agentId, runId);

      void this.requestDecisionForAgent(agent, scan)
        .then((decision) => {
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
          if (this.pendingAiAgents.get(agentId) === runId) {
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

    if (role === 'architect') {
      return this.aiNavigator.requestDecision(scan);
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
      position: { x: GOAL_POSITION.x, y: GOAL_POSITION.y },
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
      objective_path: objective.path,
      current: this.lookupTile({ x: agent.x, y: agent.y }, agent.id),
      north: this.lookupTile({ x: agent.x, y: agent.y - 1 }),
      east: this.lookupTile({ x: agent.x + 1, y: agent.y }),
      south: this.lookupTile({ x: agent.x, y: agent.y + 1 }),
      west: this.lookupTile({ x: agent.x - 1, y: agent.y }),
    };
  }

  private findEntityAtPosition(position: Position, excludeId?: string): Entity | null {
    let fallback: Entity | null = null;

    for (const entity of this.entities.values()) {
      if (entity.id === excludeId || entity.x !== position.x || entity.y !== position.y) {
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
    this.syncQueue = this.syncQueue
      .then(async () => {
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
    const taskCount = this.getStructureEntities().filter((entity) => entity.node_state === 'task').length;
    const asymmetryCount = this.getStructureEntities().filter((entity) => entity.node_state === 'asymmetry').length;

    console.log(
      `[tick ${String(this.absoluteTick).padStart(3, '0')} phase ${this.getCurrentPhase()}] architect=(${architect.x},${architect.y}) visionary=${visionary ? `(${visionary.x},${visionary.y})` : 'off'} critic=${critic ? `(${critic.x},${critic.y})` : 'off'} goal_distance=${distance} tasks=${taskCount} asymmetry=${asymmetryCount} queued=${this.decisionQueue.size} pending_ai=${this.pendingAiAgents.size} supabase=${this.supabase ? 'on' : 'off'}`,
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
