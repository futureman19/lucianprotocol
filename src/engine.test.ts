import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LuxEngine, findReadableTargetInEntities, resolvePathWithinRoot } from './engine';
import { createRepositoryOverlay, findOpenPosition } from './git-parser';
import { computeChiralMass, getAgentRole } from './hivemind';
import { buildLMMScan } from './lmm/core';
import { builderRule } from './lmm/rules/builderRule';
import { recyclerRule } from './lmm/rules/recyclerRule';
import { workerRule } from './lmm/rules/workerRule';
import { createLMMEntity } from './lmm/spawn';
import { TC } from './lmm/types';
import { parseOperatorDirective } from './operator-control';
import { createInitialEntities, toIndex } from './seed';
import { applyDelete, applyInsert, applyPatch } from './surgical-edit';
import {
  AgentDecisionSchema,
  type AgentActivity,
  type AgentDecision,
  type Entity,
  type NeighborhoodScan,
  type OperatorControl,
  type Position,
  type Task,
} from './types';

interface EngineHarness {
  applyLMMDecisions(): void;
  computeAgentActivities(): AgentActivity[];
  entities: Map<string, Entity>;
  executeBroadcast(agent: Entity, decision: AgentDecision): void;
  executeRead(agent: Entity, decision: AgentDecision): void;
  expirePheromones(): void;
  getStructureEntities(): Entity[];
  moveEntity(entity: Entity, nextPosition: Position): void;
  patchEntity(entityId: string, patch: Partial<Entity>): Entity | null;
  registerEntity(entity: Entity): void;
  resetWorld(structureEntities?: Entity[]): void;
}

interface ControlHarness {
  architectPrompt: string;
  handleOperatorControl(control: OperatorControl): Promise<void>;
  lastControlSignature: string;
  resetWorld(structureEntities?: Entity[]): void;
}

function createCommittedTempRepo(): string {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'lux-git-overlay-'));

  mkdirSync(path.join(repositoryRoot, 'src', 'components'), { recursive: true });
  writeFileSync(
    path.join(repositoryRoot, 'src', 'components', 'Button.tsx'),
    'export function Button() {\n  return <button>Lux</button>;\n}\n',
    'utf8',
  );
  writeFileSync(
    path.join(repositoryRoot, 'README.md'),
    '# Lux Test Repository\n',
    'utf8',
  );

  execFileSync('git', ['init'], { cwd: repositoryRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'lux@test.local'], { cwd: repositoryRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Lux Test'], { cwd: repositoryRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repositoryRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repositoryRoot, stdio: 'ignore' });

  return repositoryRoot;
}

function findUnusedCell(entities: Iterable<Entity>, startX = 30, startY = 30): Position {
  const occupied = new Set<string>();
  for (const entity of entities) {
    occupied.add(`${entity.x},${entity.y},${entity.z ?? 0}`);
  }

  for (let y = startY; y < 49; y += 1) {
    for (let x = startX; x < 49; x += 1) {
      const key = `${x},${y},0`;
      if (!occupied.has(key)) {
        return { x, y, z: 0 };
      }
    }
  }

  throw new Error('Unable to find an unused test cell.');
}

test('createInitialEntities is deterministic for the same seed', () => {
  const first = createInitialEntities('lux-alpha-001');
  const second = createInitialEntities('lux-alpha-001');

  assert.deepEqual(first, second);
});

test('AgentDecisionSchema accepts read actions with a target', () => {
  const decision = AgentDecisionSchema.parse({ action: 'read', target: 'App.tsx' });

  assert.deepEqual(decision, { action: 'read', target: 'App.tsx' });
});

test('AgentDecisionSchema accepts broadcast actions with a message', () => {
  const decision = AgentDecisionSchema.parse({ action: 'broadcast', message: 'claiming src/engine.ts' });

  assert.deepEqual(decision, { action: 'broadcast', message: 'claiming src/engine.ts' });
});

test('AgentDecisionSchema rejects edit actions without content', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'edit', target: 'App.tsx' });
  });
});

test('AgentDecisionSchema rejects broadcast without a message', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'broadcast' });
  });
});

test('findReadableTargetInEntities returns a nearby file by name', () => {
  const entities: Entity[] = [
    {
      id: 'file:App.tsx',
      type: 'file',
      x: 2,
      y: 1,
      mass: 3,
      tick_updated: 0,
      name: 'App.tsx',
      path: 'web/App.tsx',
    },
    {
      id: 'file:README.md',
      type: 'file',
      x: 10,
      y: 10,
      mass: 1,
      tick_updated: 0,
      name: 'README.md',
      path: 'README.md',
    },
  ];

  const result = findReadableTargetInEntities(entities, { x: 1, y: 1 }, 'App.tsx');

  assert.equal(result?.id, 'file:App.tsx');
});

test('LuxEngine invalidates the structure cache when structure entities change', () => {
  const harness = new LuxEngine('lux-alpha-001', 100, 5, false) as unknown as EngineHarness;
  harness.resetWorld([]);

  const first = harness.getStructureEntities();
  const second = harness.getStructureEntities();
  assert.strictEqual(first, second);

  const fileEntity: Entity = {
    id: 'file:control-target',
    type: 'file',
    x: 3,
    y: 3,
    mass: 3,
    tick_updated: 0,
    name: 'control-target.ts',
    path: 'src/control-target.ts',
  };

  harness.registerEntity(fileEntity);
  const afterRegister = harness.getStructureEntities();
  assert.notStrictEqual(afterRegister, first);
  assert.equal(afterRegister.length, 1);

  harness.patchEntity(fileEntity.id, { descriptor: 'patched structure node' });
  const afterPatch = harness.getStructureEntities();
  assert.notStrictEqual(afterPatch, afterRegister);

  const updatedEntity = harness.entities.get(fileEntity.id);
  assert.ok(updatedEntity);
  harness.moveEntity(updatedEntity, { x: 4, y: 3 });

  const afterMove = harness.getStructureEntities();
  assert.notStrictEqual(afterMove, afterPatch);
  assert.equal(afterMove[0]?.x, 4);
  assert.equal(afterMove[0]?.y, 3);
});

test('executeBroadcast creates a pheromone entity with correct TTL', () => {
  const harness = new LuxEngine('broadcast-create-test', 100, 5, false) as unknown as EngineHarness;
  harness.resetWorld([]);

  const architect = harness.entities.get('agent-architect-01');
  assert.ok(architect);

  harness.executeBroadcast(architect, {
    action: 'broadcast',
    message: 'claiming src/engine.ts',
  });

  const pheromones = Array.from(harness.entities.values()).filter((entity) => entity.type === 'pheromone');
  assert.equal(pheromones.length, 1);

  const pheromone = pheromones[0]!;
  assert.equal(pheromone.author_id, architect.id);
  assert.equal(pheromone.message, 'claiming src/engine.ts');
  assert.equal(pheromone.ttl_ticks, 30);
  assert.equal(pheromone.x, architect.x);
  assert.equal(pheromone.y, architect.y);

  const updatedArchitect = harness.entities.get(architect.id);
  assert.equal(updatedArchitect?.memory?.last_broadcast?.message, 'claiming src/engine.ts');
  assert.equal(updatedArchitect?.memory?.last_broadcast?.tick, 0);
});

test('pheromones expire after 30 ticks', () => {
  const harness = new LuxEngine('broadcast-expiry-test', 100, 5, false) as unknown as EngineHarness;
  harness.resetWorld([]);

  const architect = harness.entities.get('agent-architect-01');
  assert.ok(architect);

  harness.executeBroadcast(architect, {
    action: 'broadcast',
    message: 'found parser bug',
  });

  for (let index = 0; index < 29; index += 1) {
    harness.expirePheromones();
  }

  const remainingPheromone = Array.from(harness.entities.values()).find((entity) => entity.type === 'pheromone');
  assert.ok(remainingPheromone);
  assert.equal(remainingPheromone.ttl_ticks, 1);

  harness.expirePheromones();

  const pheromones = Array.from(harness.entities.values()).filter((entity) => entity.type === 'pheromone');
  assert.equal(pheromones.length, 0);
});

test('executeRead records the file in agent memory', () => {
  const harness = new LuxEngine('read-memory-test', 100, 5, false) as unknown as EngineHarness;
  const fileEntity: Entity = {
    id: 'file:src/app.ts',
    type: 'file',
    x: 0,
    y: 0,
    mass: 3,
    tick_updated: 0,
    name: 'app.ts',
    path: 'src/app.ts',
    content_hash: 'abc123',
    content: 'export const app = true;\n',
  };

  harness.resetWorld([fileEntity]);

  const architect = harness.entities.get('agent-architect-01');
  assert.ok(architect);

  harness.executeRead(architect, {
    action: 'read',
    target: 'src/app.ts',
  });

  const updatedArchitect = harness.entities.get(architect.id);
  assert.deepEqual(updatedArchitect?.memory?.files_read['src/app.ts'], {
    content_hash: 'abc123',
    tick_read: 0,
    summary: '',
  });
});

test('parseOperatorDirective extracts action and target query from a prompt', () => {
  const directive = parseOperatorDirective('Navigate to `src/engine.ts` and explain the control flow.');

  assert.equal(directive.action, 'explain');
  assert.equal(directive.targetQuery, 'src/engine.ts');
});

test('parseOperatorDirective keeps repair dispatches targetable', () => {
  const directive = parseOperatorDirective('Navigate to `web/App.tsx` and repair the fault.');

  assert.equal(directive.action, 'navigate');
  assert.equal(directive.targetQuery, 'web/App.tsx');
});

test('resolvePathWithinRoot rejects traversal outside the repository root', () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'lux-path-root-'));

  try {
    const insidePath = resolvePathWithinRoot(repositoryRoot, 'src/engine.ts');
    const outsidePath = resolvePathWithinRoot(repositoryRoot, '../outside.ts');

    assert.equal(insidePath, path.resolve(repositoryRoot, 'src/engine.ts'));
    assert.equal(outsidePath, null);
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('handleOperatorControl applies per-agent prompt updates when repo and operator prompt are unchanged', async () => {
  const engine = new LuxEngine('control-signature-test', 100, 5, false);
  const harness = engine as unknown as ControlHarness;
  const mutableEngine = engine as unknown as {
    processCommitAndPush(control: OperatorControl): Promise<void>;
    processPendingEdits(control: OperatorControl): Promise<void>;
  };

  harness.resetWorld([]);
  mutableEngine.processPendingEdits = async () => {};
  mutableEngine.processCommitAndPush = async () => {};

  const control: OperatorControl = {
    id: 'lux-control',
    repo_path: '',
    operator_prompt: 'Inspect the current task graph.',
    architect_prompt: 'Focus on deterministic movement.',
  };

  await harness.handleOperatorControl(control);
  const firstSignature = harness.lastControlSignature;

  await harness.handleOperatorControl({
    ...control,
    architect_prompt: 'Focus on deterministic movement and edit safety.',
  });

  assert.equal(harness.architectPrompt, 'Focus on deterministic movement and edit safety.');
  assert.notEqual(harness.lastControlSignature, firstSignature);
});

test('createRepositoryOverlay is deterministic and root avoids reserved spawn positions', async () => {
  const repositoryRoot = createCommittedTempRepo();

  try {
    const first = await createRepositoryOverlay(repositoryRoot, { seed: 'lux-alpha-001' });
    const second = await createRepositoryOverlay(repositoryRoot, { seed: 'lux-alpha-001' });

    const summarize = (entities: Entity[]) =>
      entities
        .map((entity) => ({ id: entity.id, x: entity.x, y: entity.y }))
        .sort((left, right) => left.id.localeCompare(right.id));

    assert.deepEqual(summarize(first.entities), summarize(second.entities));

    const rootDirectory = first.entities.find((entity) => entity.type === 'directory' && entity.path === '.');
    assert.ok(rootDirectory);

    const reservedPositions = new Set(
      createInitialEntities('lux-alpha-001').map((entity) => `${entity.x},${entity.y}`),
    );
    assert.ok(!reservedPositions.has(`${rootDirectory.x},${rootDirectory.y}`));
    assert.notEqual(`${rootDirectory.x},${rootDirectory.y}`, '0,0');
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
  }
});

test('computeChiralMass adds line-based lift for large files', () => {
  const mass = computeChiralMass({
    id: 'file:large-utils',
    type: 'file',
    x: 0,
    y: 0,
    mass: 3,
    tick_updated: 0,
    content: 'a\n'.repeat(240),
  });

  assert.equal(mass, 5);
});

// ---------------------------------------------------------------------------
// createInitialEntities spawn geometry
// ---------------------------------------------------------------------------

test('createInitialEntities places agents at exact spawn positions', () => {
  const entities = createInitialEntities('lux-alpha-001');

  const architect1 = entities.find((e) => e.id === 'agent-architect-01');
  const architect2 = entities.find((e) => e.id === 'agent-architect-02');
  const architect3 = entities.find((e) => e.id === 'agent-architect-03');
  const visionary = entities.find((e) => e.id === 'agent-visionary-01');
  const critic = entities.find((e) => e.id === 'agent-critic-01');

  assert.ok(architect1);
  assert.ok(architect2);
  assert.ok(architect3);
  assert.ok(visionary);
  assert.ok(critic);

  assert.deepEqual({ x: architect1.x, y: architect1.y }, { x: 0, y: 0 });
  assert.deepEqual({ x: architect2.x, y: architect2.y }, { x: 2, y: 0 });
  assert.deepEqual({ x: architect3.x, y: architect3.y }, { x: 0, y: 2 });
  assert.deepEqual({ x: visionary.x, y: visionary.y }, { x: 1, y: 0 });
  assert.deepEqual({ x: critic.x, y: critic.y }, { x: 0, y: 1 });
});

test('createInitialEntities encodes Tier 1 automata with snake_case schema fields', () => {
  const entities = createInitialEntities('lux-alpha-001');
  const lmmAgents = entities.filter((entity) => entity.type === 'agent' && entity.lmm_rule != null);

  assert.ok(lmmAgents.length > 0);

  for (const agent of lmmAgents) {
    assert.equal('lmmRule' in agent, false);
    assert.equal('birthTick' in agent, false);
    assert.equal('stateRegister' in agent, false);
    assert.equal(typeof agent.lmm_rule, 'string');
    assert.equal(typeof agent.cargo, 'number');
    assert.equal(typeof agent.birth_tick, 'number');
    assert.equal(typeof agent.state_register, 'number');
    assert.equal(getAgentRole(agent), null);
  }
});

test('buildLMMScan classifies current cells, loose mass, and ignores pheromones', () => {
  const agent = createLMMEntity('lmm-builder-test', 10, 10, 'builder');
  const cells = new Map<string, Entity[]>([
    ['10,10,0', [{
      id: 'file:current-task',
      type: 'file',
      x: 10,
      y: 10,
      z: 0,
      mass: 5,
      tick_updated: 0,
      node_state: 'task',
      path: 'src/current-task.ts',
    }]],
    ['10,9,0', [
      {
        id: 'agent-neighbor',
        type: 'agent',
        x: 10,
        y: 9,
        z: 0,
        mass: 1,
        tick_updated: 0,
      },
      {
        id: 'file:north-task',
        type: 'file',
        x: 10,
        y: 9,
        z: 0,
        mass: 4,
        tick_updated: 0,
        node_state: 'task',
        path: 'src/north-task.ts',
      },
    ]],
    ['9,10,0', [{
      id: 'pheromone-west',
      type: 'pheromone',
      x: 9,
      y: 10,
      z: 0,
      mass: 1,
      tick_updated: 0,
      ttl_ticks: 10,
    }]],
  ]);
  const looseMass = new Map<string, number>([['11,10,0', 3]]);

  const scan = buildLMMScan(
    agent,
    (x, y, z, excludeEntityId) => (cells.get(`${x},${y},${z}`) ?? []).filter((entity) => entity.id !== excludeEntityId),
    (x, y, z) => looseMass.get(`${x},${y},${z}`) ?? 0,
    () => ({ trail: 0, trailType: 0 }),
    0,
  );

  assert.equal(scan.self.cellTypeCode, TC.TASK);
  assert.equal(scan.self.cellMass, 5);
  assert.equal(scan.neighbors.find((neighbor) => neighbor.dx === 0 && neighbor.dy === -1)?.typeCode, TC.TASK);
  assert.equal(scan.neighbors.find((neighbor) => neighbor.dx === 1 && neighbor.dy === 0)?.typeCode, TC.LOOSE_MASS);
  assert.equal(scan.neighbors.find((neighbor) => neighbor.dx === -1 && neighbor.dy === 0)?.typeCode, TC.EMPTY);
});

test('builder, recycler, and worker rules keep LMMs active when work is reachable or local space is open', () => {
  const pheromone = { alarm: 0, urgency: 0, scarcity: 0, swarm: 0, explore: 0 };
  const emptyNeighbors = [
    { dx: 0, dy: -1, mass: 0, typeCode: TC.EMPTY, trail: 0, trailType: 0 },
    { dx: 1, dy: 0, mass: 0, typeCode: TC.EMPTY, trail: 0, trailType: 0 },
    { dx: 0, dy: 1, mass: 0, typeCode: TC.EMPTY, trail: 0, trailType: 0 },
    { dx: -1, dy: 0, mass: 0, typeCode: TC.EMPTY, trail: 0, trailType: 0 },
  ];

  const baseSelf = {
    x: 0,
    y: 0,
    z: 0,
    mass: 1,
    cellTypeCode: TC.EMPTY,
    cellMass: 0,
    cargo: 0,
    idHash: 7,
    birthTick: 0,
    stateRegister: 0,
  };

  assert.deepEqual(
    builderRule(
      { ...baseSelf, cargo: 1 },
      [{ dx: 1, dy: 0, mass: 4, typeCode: TC.TASK, trail: 0, trailType: 0 }],
      0,
      0,
      pheromone,
    ),
    { action: 'deposit' },
  );

  assert.deepEqual(
    recyclerRule(
      baseSelf,
      [{ dx: 0, dy: -1, mass: 2, typeCode: TC.LOOSE_MASS, trail: 0, trailType: 0 }],
      0,
      0,
    ),
    { action: 'recycle' },
  );

  assert.equal(workerRule(baseSelf, emptyNeighbors, 10, 0, pheromone).action, 'move');
  assert.equal(
    builderRule(
      baseSelf,
      [
        { dx: 0, dy: -1, mass: 2, typeCode: TC.STRUCTURE_DONE, trail: 0, trailType: 0 },
        { dx: 1, dy: 0, mass: 1, typeCode: TC.WALL, trail: 0, trailType: 0 },
        { dx: 0, dy: 1, mass: 1, typeCode: TC.WALL, trail: 0, trailType: 0 },
        { dx: -1, dy: 0, mass: 1, typeCode: TC.WALL, trail: 0, trailType: 0 },
      ],
      0,
      0,
      pheromone,
    ).action,
    'move',
  );
});

test('executeLMMDecision deposits on the current task cell and recycles adjacent loose mass', () => {
  const engine = new LuxEngine('lmm-execution-test', 100, 5, false);
  const harness = engine as unknown as EngineHarness & {
    executeLMMDecision(agent: Entity, decision: { action: 'deposit' } | { action: 'recycle' }): void;
    shatteredMassGrid: Uint8Array;
  };

  harness.resetWorld([]);

  const openCell = findUnusedCell(harness.entities.values());
  const lmm = createLMMEntity('lmm-builder-exec', openCell.x, openCell.y, 'builder');
  const taskEntity: Entity = {
    id: 'file:lmm-task',
    type: 'file',
    x: openCell.x,
    y: openCell.y,
    z: 0,
    mass: 4,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    node_state: 'task',
    path: 'src/lmm-task.ts',
  };

  harness.registerEntity(taskEntity);
  harness.registerEntity(lmm);
  harness.patchEntity(lmm.id, { cargo: 1 });

  let builder = harness.entities.get(lmm.id);
  assert.ok(builder);
  harness.executeLMMDecision(builder, { action: 'deposit' });

  const updatedTask = harness.entities.get(taskEntity.id);
  const afterDeposit = harness.entities.get(lmm.id);
  assert.equal(updatedTask?.mass, 5);
  assert.equal(updatedTask?.construction_mass, 1);
  assert.equal(afterDeposit?.cargo, 0);

  const looseMassIndex = toIndex(openCell.x + 1, openCell.y, 0);
  harness.shatteredMassGrid[looseMassIndex] = 1;

  builder = harness.entities.get(lmm.id);
  assert.ok(builder);
  harness.executeLMMDecision(builder, { action: 'recycle' });

  const afterRecycle = harness.entities.get(lmm.id);
  assert.equal(harness.shatteredMassGrid[looseMassIndex], 0);
  assert.equal(afterRecycle?.cargo, 1);
});

test('executeLMMDecision deposit thresholds promote and submit assigned construction tasks', () => {
  const engine = new LuxEngine('lmm-construction-threshold-test', 100, 5, false);
  const harness = engine as unknown as EngineHarness & {
    activeTasks: Task[];
    agentIds: string[];
    executeLMMDecision(agent: Entity, decision: { action: 'deposit' }): void;
  };

  harness.resetWorld([]);

  const openCell = findUnusedCell(harness.entities.values());
  const lmm = createLMMEntity('lmm-builder-threshold', openCell.x, openCell.y, 'builder');
  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  const taskEntity: Entity = {
    id: 'file:lmm-threshold',
    type: 'file',
    x: openCell.x,
    y: openCell.y,
    z: 0,
    mass: 4,
    construction_mass: 4,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    node_state: 'task',
    path: 'src/lmm-threshold.ts',
    content: 'export const threshold = true;\n',
  };

  harness.registerEntity(taskEntity);
  harness.registerEntity(lmm);
  harness.patchEntity(lmm.id, { cargo: 6 });
  harness.activeTasks = [
    {
      id: 't-threshold',
      description: 'Build threshold file',
      target_path: 'src/lmm-threshold.ts',
      status: 'assigned',
      assigned_agent_id: architectId,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  let builder = harness.entities.get(lmm.id);
  assert.ok(builder);
  harness.executeLMMDecision(builder, { action: 'deposit' });

  let updatedTaskEntity = harness.entities.get(taskEntity.id);
  assert.equal(updatedTaskEntity?.construction_mass, 5);
  assert.equal(updatedTaskEntity?.node_state, 'in-progress');
  assert.equal(harness.activeTasks[0]!.status, 'in_progress');

  for (let i = 0; i < 5; i += 1) {
    builder = harness.entities.get(lmm.id);
    assert.ok(builder);
    harness.executeLMMDecision(builder, { action: 'deposit' });
  }

  updatedTaskEntity = harness.entities.get(taskEntity.id);
  assert.equal(updatedTaskEntity?.construction_mass, 10);
  assert.equal(harness.activeTasks[0]!.status, 'awaiting_review');
  assert.equal(harness.activeTasks[0]!.completed_content, 'export const threshold = true;\n');
});

test('executeLMMDecision creates an awaiting_review task when construction completes without an architect', () => {
  const engine = new LuxEngine('lmm-construction-review-test', 100, 5, false);
  const harness = engine as unknown as EngineHarness & {
    activeTasks: Task[];
    executeLMMDecision(agent: Entity, decision: { action: 'deposit' }): void;
  };

  harness.resetWorld([]);

  const openCell = findUnusedCell(harness.entities.values());
  const lmm = createLMMEntity('lmm-builder-review', openCell.x, openCell.y, 'builder');
  const taskEntity: Entity = {
    id: 'file:lmm-review',
    type: 'file',
    x: openCell.x,
    y: openCell.y,
    z: 0,
    mass: 9,
    construction_mass: 9,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    node_state: 'in-progress',
    path: 'src/lmm-review.ts',
    content: 'export const review = true;\n',
  };

  harness.registerEntity(taskEntity);
  harness.registerEntity(lmm);
  harness.patchEntity(lmm.id, { cargo: 1 });

  const builder = harness.entities.get(lmm.id);
  assert.ok(builder);
  harness.executeLMMDecision(builder, { action: 'deposit' });

  assert.equal(harness.activeTasks.length, 1);
  assert.equal(harness.activeTasks[0]!.target_path, 'src/lmm-review.ts');
  assert.equal(harness.activeTasks[0]!.status, 'awaiting_review');
  assert.equal(harness.activeTasks[0]!.assigned_agent_id, null);
  assert.equal(harness.activeTasks[0]!.origin, 'autonomous');
  assert.equal(harness.activeTasks[0]!.completed_content, 'export const review = true;\n');
});

test('patchEntity resets construction mass when a node leaves construction states', () => {
  const engine = new LuxEngine('construction-mass-reset-test', 100, 5, false);
  const harness = engine as unknown as EngineHarness;

  const taskEntity: Entity = {
    id: 'file:lmm-reset',
    type: 'file',
    x: 8,
    y: 8,
    z: 0,
    mass: 5,
    construction_mass: 7,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    node_state: 'in-progress',
    path: 'src/lmm-reset.ts',
  };
  harness.resetWorld([taskEntity]);

  harness.patchEntity(taskEntity.id, { node_state: 'stable' });

  const updatedTaskEntity = harness.entities.get(taskEntity.id);
  assert.equal(updatedTaskEntity?.node_state, 'stable');
  assert.equal(updatedTaskEntity?.construction_mass, 0);
});

test('applyLMMDecisions keeps the lower-tier swarm moving on a quiet lattice', () => {
  const engine = new LuxEngine('lmm-quiet-lattice-test', 100, 5, false);
  const harness = engine as unknown as EngineHarness;

  harness.resetWorld([]);

  const initialPositions = new Map(
    Array.from(harness.entities.values())
      .filter((entity) => entity.type === 'agent' && entity.lmm_rule != null)
      .map((entity) => [entity.id, `${entity.x},${entity.y}`]),
  );

  let movedOnEveryStep = true;
  for (let index = 0; index < 4; index += 1) {
    const beforeStep = new Map(
      Array.from(harness.entities.values())
        .filter((entity) => entity.type === 'agent' && entity.lmm_rule != null)
        .map((entity) => [entity.id, `${entity.x},${entity.y}`]),
    );

    harness.applyLMMDecisions();

    const stepMoved = Array.from(harness.entities.values())
      .filter((entity) => entity.type === 'agent' && entity.lmm_rule != null)
      .some((entity) => beforeStep.get(entity.id) !== `${entity.x},${entity.y}`);

    movedOnEveryStep &&= stepMoved;
  }

  const finalPositions = Array.from(harness.entities.values())
    .filter((entity) => entity.type === 'agent' && entity.lmm_rule != null);

  const movedAgents = finalPositions.filter((entity) => initialPositions.get(entity.id) !== `${entity.x},${entity.y}`);
  const lmmActivities = harness.computeAgentActivities().filter((activity) => activity.agent_id.startsWith('lmm-'));

  assert.ok(movedOnEveryStep);
  assert.ok(movedAgents.length >= 3);
  assert.ok(lmmActivities.some((activity) => activity.action !== null && activity.status !== 'idle'));
});

test('createInitialEntities places goal and required wall', () => {
  const entities = createInitialEntities('lux-alpha-001');

  const goal = entities.find((e) => e.id === 'goal-primary');
  const requiredWall = entities.find((e) => e.id === 'wall-000');

  assert.ok(goal);
  assert.ok(requiredWall);

  assert.deepEqual({ x: goal.x, y: goal.y }, { x: 25, y: 25 });
  assert.deepEqual({ x: requiredWall.x, y: requiredWall.y }, { x: 10, y: 10 });
});

test('createInitialEntities creates exactly 20 walls', () => {
  const entities = createInitialEntities('lux-alpha-001');
  const walls = entities.filter((e) => e.type === 'wall');

  assert.equal(walls.length, 20);
});

test('createInitialEntities has no overlapping positions', () => {
  const entities = createInitialEntities('lux-alpha-001');
  const positions = new Set<string>();

  for (const entity of entities) {
    const key = `${entity.x},${entity.y}`;
    assert.ok(!positions.has(key), `Overlapping position at ${key} for ${entity.id}`);
    positions.add(key);
  }
});

test('createInitialEntities keeps walls away from start and goal', () => {
  const entities = createInitialEntities('lux-alpha-001');
  const walls = entities.filter((e) => e.type === 'wall');

  for (const wall of walls) {
    const startDist = Math.abs(wall.x - 0) + Math.abs(wall.y - 0);
    const goalDist = Math.abs(wall.x - 25) + Math.abs(wall.y - 25);

    assert.ok(
      startDist > 2,
      `Wall at (${wall.x},${wall.y}) is within 2 tiles of start`,
    );
    assert.ok(
      goalDist > 2,
      `Wall at (${wall.x},${wall.y}) is within 2 tiles of goal`,
    );
  }
});

test('createInitialEntities produces different walls for different seeds', () => {
  const first = createInitialEntities('seed-a');
  const second = createInitialEntities('seed-b');

  const firstWalls = first
    .filter((e) => e.type === 'wall' && e.id !== 'wall-000')
    .map((e) => `${e.x},${e.y}`)
    .sort();
  const secondWalls = second
    .filter((e) => e.type === 'wall' && e.id !== 'wall-000')
    .map((e) => `${e.x},${e.y}`)
    .sort();

  assert.notDeepEqual(firstWalls, secondWalls);
});

// ---------------------------------------------------------------------------
// AgentDecisionSchema validation
// ---------------------------------------------------------------------------

test('AgentDecisionSchema rejects move without direction', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'move' });
  });
});

test('AgentDecisionSchema accepts wait with no extra fields', () => {
  const decision = AgentDecisionSchema.parse({ action: 'wait' });
  assert.deepEqual(decision, { action: 'wait' });
});

test('AgentDecisionSchema rejects read without target', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'read' });
  });
});

test('AgentDecisionSchema rejects edit without target', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'edit', content: 'foo' });
  });
});

test('AgentDecisionSchema rejects edit without content', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'edit', target: 'foo.ts' });
  });
});

// ---------------------------------------------------------------------------
// findReadableTargetInEntities
// ---------------------------------------------------------------------------

test('findReadableTargetInEntities finds target by path on adjacent tile', () => {
  const entities: Entity[] = [
    {
      id: 'file:main.ts',
      type: 'file',
      x: 5,
      y: 4,
      mass: 2,
      tick_updated: 0,
      name: 'main.ts',
      path: 'src/main.ts',
    },
  ];

  const agent: Position = { x: 5, y: 5 };
  const result = findReadableTargetInEntities(entities, agent, 'src/main.ts');

  assert.equal(result?.id, 'file:main.ts');
});

test('findReadableTargetInEntities returns null when target is distant', () => {
  const entities: Entity[] = [
    {
      id: 'file:far.ts',
      type: 'file',
      x: 20,
      y: 20,
      mass: 2,
      tick_updated: 0,
      name: 'far.ts',
      path: 'src/far.ts',
    },
  ];

  const result = findReadableTargetInEntities(entities, { x: 0, y: 0 }, 'far.ts');
  assert.equal(result, null);
});

test('findReadableTargetInEntities returns null when targetName is undefined', () => {
  const entities: Entity[] = [
    {
      id: 'file:near.ts',
      type: 'file',
      x: 0,
      y: 0,
      mass: 2,
      tick_updated: 0,
      name: 'near.ts',
      path: 'src/near.ts',
    },
  ];

  const result = findReadableTargetInEntities(entities, { x: 0, y: 0 }, undefined);
  assert.equal(result, null);
});

test('findReadableTargetInEntities skips non-structure entities', () => {
  const entities: Entity[] = [
    {
      id: 'agent-architect-01',
      type: 'agent',
      x: 5,
      y: 5,
      mass: 1,
      tick_updated: 0,
      name: 'Architect',
    },
    {
      id: 'wall-001',
      type: 'wall',
      x: 5,
      y: 6,
      mass: 1,
      tick_updated: 0,
      name: 'wall',
    },
    {
      id: 'goal-primary',
      type: 'goal',
      x: 5,
      y: 4,
      mass: 1,
      tick_updated: 0,
      name: 'goal',
    },
    {
      id: 'file:real.ts',
      type: 'file',
      x: 6,
      y: 5,
      mass: 2,
      tick_updated: 0,
      name: 'real.ts',
      path: 'src/real.ts',
    },
  ];

  assert.equal(findReadableTargetInEntities(entities, { x: 5, y: 5 }, 'Architect'), null);
  assert.equal(findReadableTargetInEntities(entities, { x: 5, y: 5 }, 'wall'), null);
  assert.equal(findReadableTargetInEntities(entities, { x: 5, y: 5 }, 'goal'), null);
  assert.equal(findReadableTargetInEntities(entities, { x: 5, y: 5 }, 'real.ts')?.id, 'file:real.ts');
});

// ---------------------------------------------------------------------------
// computeChiralMass
// ---------------------------------------------------------------------------

test('computeChiralMass returns base mass for non-file entities', () => {
  const wall = computeChiralMass({
    id: 'wall-001',
    type: 'wall',
    x: 0,
    y: 0,
    mass: 4,
    tick_updated: 0,
  });
  assert.equal(wall, 4);

  const dir = computeChiralMass({
    id: 'directory:src',
    type: 'directory',
    x: 0,
    y: 0,
    mass: 2,
    tick_updated: 0,
  });
  assert.equal(dir, 2);
});

test('computeChiralMass boundary at 120 lines', () => {
  const baseMass = 3;

  const at119 = computeChiralMass({
    id: 'file:119',
    type: 'file',
    x: 0,
    y: 0,
    mass: baseMass,
    tick_updated: 0,
    content: 'a\n'.repeat(119),
  });
  assert.equal(at119, baseMass);

  const at120 = computeChiralMass({
    id: 'file:120',
    type: 'file',
    x: 0,
    y: 0,
    mass: baseMass,
    tick_updated: 0,
    content: 'a\n'.repeat(120),
  });
  assert.equal(at120, baseMass + 1);
});

test('computeChiralMass falls back to content_preview when content is null', () => {
  const mass = computeChiralMass({
    id: 'file:preview-only',
    type: 'file',
    x: 0,
    y: 0,
    mass: 2,
    tick_updated: 0,
    content: null,
    content_preview: 'a\n'.repeat(240),
  });

  assert.equal(mass, 4);
});

// ---------------------------------------------------------------------------
// findOpenPosition
// ---------------------------------------------------------------------------

test('findOpenPosition returns preferred position when free', () => {
  const result = findOpenPosition(10, 10, 0, new Set(), new Set());
  assert.deepEqual(result, { x: 10, y: 10, z: 0 });
});

test('findOpenPosition spirals outward when preferred is occupied', () => {
  const occupied = new Set(['10,10,0']);
  const result = findOpenPosition(10, 10, 0, occupied, new Set());

  const distance = Math.abs(result.x - 10) + Math.abs(result.y - 10);
  assert.equal(distance, 1);
  assert.ok(!occupied.has(`${result.x},${result.y},0`));
});

test('findOpenPosition respects reserved positions', () => {
  const occupied = new Set<string>();
  const reserved = new Set(['10,10,0', '10,11,0', '11,10,0', '9,10,0', '10,9,0']);

  const result = findOpenPosition(10, 10, 0, occupied, reserved);

  assert.notEqual(`${result.x},${result.y},${result.z}`, '10,10,0');
  assert.notEqual(`${result.x},${result.y},${result.z}`, '10,11,0');
  assert.notEqual(`${result.x},${result.y},${result.z}`, '11,10,0');
  assert.notEqual(`${result.x},${result.y},${result.z}`, '9,10,0');
  assert.notEqual(`${result.x},${result.y},${result.z}`, '10,9,0');
});

test('findOpenPosition throws when grid is exhausted', () => {
  const occupied = new Set<string>();
  const reserved = new Set<string>();

  for (let x = 0; x < 50; x += 1) {
    for (let y = 0; y < 50; y += 1) {
      occupied.add(`${x},${y},0`);
    }
  }

  assert.throws(() => {
    findOpenPosition(0, 0, 0, occupied, reserved);
  }, /Repository lattice exceeds the available 50x50 grid at layer z=0./);
});

// ---------------------------------------------------------------------------
// Task pipeline harness
// ---------------------------------------------------------------------------

interface TaskPipelineHarness {
  activeTasks: Task[];
  absoluteTick: number;
  agentIds: string[];
  advanceExplanationStream(): void;
  activeRepoPath: string | null;
  automate: boolean;
  assignPendingTasks(): void;
  entities: Map<string, Entity>;
  executeRead(agent: Entity, decision: AgentDecision): void;
  executePatch(agent: Entity, decision: AgentDecision): void;
  executeInsert(agent: Entity, decision: AgentDecision): void;
  executeDelete(agent: Entity, decision: AgentDecision): void;
  executeSubmit(agent: Entity): void;
  explanationPromise: Promise<void> | null;
  explanationState: {
    status: string;
    text: string | null;
  };
  findStructureByPath(path: string): Entity | null;
  lastOperatorPromptForPlanning: string;
  operatorAction: 'navigate' | 'read' | 'explain' | 'maintain' | null;
  operatorPrompt: string;
  operatorTargetPath: string | null;
  patchEntity(entityId: string, patch: Partial<Entity>): Entity | null;
  processCriticReviews(): void;
  processVisionaryFinalReviews(): void;
  registerEntity(entity: Entity): void;
  resetWorld(structureEntities?: Entity[]): void;
  runCriticReview(task: Task, targetEntity: Entity): Promise<void>;
  runVisionaryFinalReview(task: Task): Promise<void>;
  runVisionaryPlanning(prompt: string): Promise<void>;
  triggerAutonomousPlanning(): void;
  visionaryPlanningPromise: Promise<void> | null;
  pendingEditAgents: Set<string>;
  requestDecisionForAgent(agent: Entity, scan: NeighborhoodScan): Promise<AgentDecision>;
  scanNeighborhood(agent: Entity): NeighborhoodScan;
  computeAgentActivities(): AgentActivity[];
}

class MockNavigator {
  visionaryPlanResult: Array<{ id: string; description: string; target_path: string }> = [];
  criticResult: { approved: boolean; feedback: string } = { approved: true, feedback: 'LGTM' };
  criticGrounding = '';
  commitMessageResult: string | null = null;
  decisionResult: AgentDecision = { action: 'wait' };
  explanationResult: string | null = null;
  visionaryPrompts: string[] = [];
  visionaryCodebaseSummaries: string[] = [];

  isConfigured() {
    return true;
  }

  async requestDecision() {
    return this.decisionResult;
  }

  async requestVisionaryPlan(prompt: string, codebaseSummary: string) {
    this.visionaryPrompts.push(prompt);
    this.visionaryCodebaseSummaries.push(codebaseSummary);
    return this.visionaryPlanResult;
  }

  async requestCriticReview(
    _taskDescription: string,
    _originalContent: string,
    _newContent: string,
    groundedValidation: string,
  ) {
    this.criticGrounding = groundedValidation;
    return this.criticResult;
  }

  async requestExplanation() {
    return this.explanationResult;
  }

  async requestCommitMessage() {
    return this.commitMessageResult;
  }
}

function createMockEngine(): { engine: LuxEngine; mock: MockNavigator } {
  const engine = new LuxEngine('task-pipeline-test', 100, 5, false);
  const mock = new MockNavigator();
  (engine as unknown as { aiNavigator: unknown }).aiNavigator = mock;
  return { engine, mock };
}

// ---------------------------------------------------------------------------
// Task pipeline tests
// ---------------------------------------------------------------------------

test('Visionary planning creates tasks with correct statuses', async () => {
  const { engine, mock } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;
  harness.resetWorld([]);

  mock.visionaryPlanResult = [
    { id: 't1', description: 'Add foo', target_path: 'src/foo.ts' },
    { id: 't2', description: 'Update bar', target_path: 'src/bar.ts' },
  ];

  harness.operatorPrompt = 'Implement foo and bar';

  await harness.runVisionaryPlanning('Implement foo and bar');

  assert.equal(harness.activeTasks.length, 2);
  assert.equal(harness.activeTasks[0]!.id, 't1');
  assert.equal(harness.activeTasks[0]!.status, 'pending');
  assert.equal(harness.activeTasks[0]!.assigned_agent_id, null);
  assert.equal(harness.activeTasks[1]!.id, 't2');
  assert.equal(harness.activeTasks[1]!.status, 'pending');
});

test('Autonomous planning discovers broken tethers, asymmetry, and high chiral mass', async () => {
  const { engine, mock } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const brokenImport: Entity = {
    id: 'file:broken-import',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    name: 'broken-import.ts',
    path: 'src/broken-import.ts',
    node_state: 'stable',
    tether_broken: true,
  };
  const asymmetry: Entity = {
    id: 'file:asymmetry',
    type: 'file',
    x: 6,
    y: 5,
    mass: 2,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    name: 'asymmetry.ts',
    path: 'src/asymmetry.ts',
    node_state: 'asymmetry',
  };
  const heavyFile: Entity = {
    id: 'file:heavy',
    type: 'file',
    x: 7,
    y: 5,
    mass: 9,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    name: 'heavy.ts',
    path: 'src/heavy.ts',
    node_state: 'stable',
  };
  harness.resetWorld([brokenImport, asymmetry, heavyFile]);
  harness.automate = true;
  mock.visionaryPlanResult = [
    { id: 'auto-1', description: 'Fix broken import', target_path: 'src/broken-import.ts' },
    { id: 'auto-2', description: 'Resolve asymmetry', target_path: 'src/asymmetry.ts' },
    { id: 'auto-3', description: 'Refactor heavy file', target_path: 'src/heavy.ts' },
  ];

  harness.triggerAutonomousPlanning();
  assert.ok(harness.visionaryPlanningPromise);
  await harness.visionaryPlanningPromise;

  assert.equal(mock.visionaryPrompts.length, 1);
  assert.match(mock.visionaryPrompts[0]!, /fix import: src\/broken-import\.ts/);
  assert.match(mock.visionaryPrompts[0]!, /resolve asymmetry: src\/asymmetry\.ts/);
  assert.match(mock.visionaryPrompts[0]!, /refactor\/split file: src\/heavy\.ts/);
  assert.equal(harness.activeTasks.length, 3);
  assert.equal(harness.activeTasks[0]!.origin, 'autonomous');
});

test('Autonomous planning is gated behind automate', () => {
  const { engine, mock } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const asymmetry: Entity = {
    id: 'file:asymmetry-gated',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    current_height: 1,
    target_height: 1,
    name: 'asymmetry-gated.ts',
    path: 'src/asymmetry-gated.ts',
    node_state: 'asymmetry',
  };
  harness.resetWorld([asymmetry]);
  harness.automate = false;

  harness.triggerAutonomousPlanning();

  assert.equal(mock.visionaryPrompts.length, 0);
  assert.equal(harness.visionaryPlanningPromise, null);
});

test('Task assignment picks the first available architect', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;
  harness.resetWorld([]);

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Task one',
      target_path: 'src/a.ts',
      status: 'pending',
      assigned_agent_id: null,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
    {
      id: 't2',
      description: 'Task two',
      target_path: 'src/b.ts',
      status: 'pending',
      assigned_agent_id: null,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  harness.assignPendingTasks();

  assert.equal(harness.activeTasks[0]!.status, 'assigned');
  assert.ok(harness.activeTasks[0]!.assigned_agent_id);
  assert.equal(harness.activeTasks[1]!.status, 'assigned');
  assert.ok(harness.activeTasks[1]!.assigned_agent_id);

  const agentIds = harness.activeTasks.map((t) => t.assigned_agent_id);
  assert.notEqual(agentIds[0], agentIds[1], 'Tasks should be assigned to different architects');
});

test('executeSubmit advances task to awaiting_review', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'original content',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Edit a.ts',
      target_path: 'src/a.ts',
      status: 'in_progress',
      assigned_agent_id: architectId,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.executeSubmit(architect);

  const task = harness.activeTasks[0]!;
  assert.equal(task.status, 'awaiting_review');
  assert.equal(task.completed_content, 'original content');
});

test('requestDecisionForAgent returns wait while an architect edit is still pending', async () => {
  const { engine, mock } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  harness.resetWorld([]);
  harness.operatorPrompt = 'Finish the assigned task.';
  mock.decisionResult = { action: 'submit' };

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.pendingEditAgents.add(architect.id);
  const decision = await harness.requestDecisionForAgent(architect, harness.scanNeighborhood(architect));

  assert.deepEqual(decision, { action: 'wait' });
});

test('executeSubmit does not advance a task while its edit is still pending', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  harness.resetWorld([]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Edit a.ts',
      target_path: 'src/a.ts',
      status: 'assigned',
      assigned_agent_id: architectId,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.pendingEditAgents.add(architect.id);
  harness.executeSubmit(architect);

  assert.equal(harness.activeTasks[0]!.status, 'assigned');
  assert.equal(harness.activeTasks[0]!.completed_content, undefined);
});

test('Critic review transitions tasks to approved or revision_needed', async () => {
  const { engine, mock } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'new content',
  };
  harness.resetWorld([fileEntity]);

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Edit a.ts',
      target_path: 'src/a.ts',
      status: 'awaiting_review',
      assigned_agent_id: 'agent-architect-01',
      original_content: 'original content',
      completed_content: 'new content',
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  mock.criticResult = { approved: true, feedback: 'Looks good' };
  await harness.runCriticReview(harness.activeTasks[0]!, fileEntity);
  assert.equal(harness.activeTasks[0]!.status, 'approved');
  assert.equal(harness.activeTasks[0]!.review_feedback, 'Looks good');

  harness.activeTasks[0]!.status = 'awaiting_review';
  mock.criticResult = { approved: false, feedback: 'Needs more work' };
  await harness.runCriticReview(harness.activeTasks[0]!, fileEntity);
  assert.equal(harness.activeTasks[0]!.status, 'revision_needed');
  assert.equal(harness.activeTasks[0]!.review_feedback, 'Needs more work');

  const architectAfterRejection = harness.entities.get('agent-architect-01');
  assert.deepEqual(architectAfterRejection?.memory?.lessons, ['Needs more work']);
});

test('Explain reads stream and cache explanation text', async () => {
  const { engine, mock } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'export function greet(name: string) {\n  return `hello ${name}`;\n}\n',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);
  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.patchEntity(architect.id, { x: 5, y: 5 });
  const architectMoved = harness.entities.get(architectId)!;
  harness.operatorPrompt = 'Explain what this file does.';
  harness.operatorAction = 'explain';
  harness.operatorTargetPath = 'src/a.ts';
  mock.explanationResult = 'This file exports greet, a small helper that formats a hello string.';

  harness.executeRead(architectMoved, {
    action: 'read',
    target: 'src/a.ts',
  });

  assert.ok(harness.explanationPromise);
  await harness.explanationPromise;
  assert.equal(harness.explanationState.status, 'streaming');

  let explanationStatus: string = harness.explanationState.status;
  while (explanationStatus !== 'complete') {
    harness.advanceExplanationStream();
    explanationStatus = harness.explanationState.status;
  }

  assert.equal(
    harness.explanationState.text,
    'This file exports greet, a small helper that formats a hello string.',
  );

  const cachedDecision = await harness.requestDecisionForAgent(
    architectMoved,
    harness.scanNeighborhood(architectMoved),
  );
  assert.equal(cachedDecision.explanation_text, 'This file exports greet, a small helper that formats a hello string.');
});

test('Visionary final review marks done or sends back for revision', async () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;
  harness.resetWorld([]);

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Edit a.ts',
      target_path: 'src/a.ts',
      status: 'approved',
      assigned_agent_id: 'agent-architect-01',
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  harness.operatorPrompt = 'Implement feature X';
  harness.lastOperatorPromptForPlanning = 'Implement feature X';

  await harness.runVisionaryFinalReview(harness.activeTasks[0]!);
  assert.equal(harness.activeTasks[0]!.status, 'done');

  harness.activeTasks[0]!.status = 'approved';
  harness.operatorPrompt = 'Implement feature Y';

  await harness.runVisionaryFinalReview(harness.activeTasks[0]!);
  assert.equal(harness.activeTasks[0]!.status, 'revision_needed');
  assert.ok(harness.activeTasks[0]!.review_feedback?.includes('intent has changed'));

  harness.activeTasks[0]!.status = 'approved';
  harness.activeTasks[0]!.origin = 'autonomous';
  harness.operatorPrompt = '';

  await harness.runVisionaryFinalReview(harness.activeTasks[0]!);
  assert.equal(harness.activeTasks[0]!.status, 'done');
});


// ---------------------------------------------------------------------------
// Surgical editing — pure functions
// ---------------------------------------------------------------------------

test('applyPatch replaces the first occurrence of old_text', () => {
  const result = applyPatch('hello world', 'world', 'universe');
  assert.equal(result, 'hello universe');
});

test('applyPatch throws when old_text is not found', () => {
  assert.throws(() => {
    applyPatch('hello world', 'missing', 'replacement');
  }, /old_text not found/);
});

test('applyInsert prepends when after_line is 0', () => {
  const result = applyInsert('line1\nline2', 0, 'header');
  assert.equal(result, 'header\nline1\nline2');
});

test('applyInsert appends when after_line exceeds line count', () => {
  const result = applyInsert('line1\nline2', 10, 'footer');
  assert.equal(result, 'line1\nline2\nfooter');
});

test('applyInsert inserts in the middle', () => {
  const result = applyInsert('line1\nline2\nline3', 1, 'mid');
  assert.equal(result, 'line1\nmid\nline2\nline3');
});

test('applyInsert handles empty content', () => {
  const result = applyInsert('', 0, 'first');
  assert.equal(result, 'first');
});

test('applyDelete removes the specified lines', () => {
  const result = applyDelete('a\nb\nc\nd', 2, 3);
  assert.equal(result, 'a\nd');
});

test('applyDelete removes from start', () => {
  const result = applyDelete('a\nb\nc', 1, 2);
  assert.equal(result, 'c');
});

test('applyDelete removes to end', () => {
  const result = applyDelete('a\nb\nc', 2, 5);
  assert.equal(result, 'a');
});

test('applyDelete returns empty string when deleting all lines', () => {
  const result = applyDelete('a\nb', 1, 2);
  assert.equal(result, '');
});

test('applyDelete throws on invalid range', () => {
  assert.throws(() => {
    applyDelete('a\nb', 5, 6);
  }, /invalid line range/);
});

// ---------------------------------------------------------------------------
// Surgical editing — engine integration
// ---------------------------------------------------------------------------

test('scanNeighborhood includes full_content when agent is locked on a file', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'export const foo = 1;\nexport const bar = 2;',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  // Move architect onto the file
  const architect = harness.entities.get(architectId);
  assert.ok(architect);
  harness.patchEntity(architect.id, { x: 5, y: 5 });

  // Re-fetch because patchEntity replaces the object in the map
  const architectMoved = harness.entities.get(architectId)!;

  // Without lock, full_content should be null
  const scanUnlocked = harness.scanNeighborhood(architectMoved);
  assert.equal(scanUnlocked.full_content, null);

  // With lock, full_content should be present
  harness.patchEntity(fileEntity.id, { lock_owner: architectId });
  const scanLocked = harness.scanNeighborhood(architectMoved);
  assert.equal(scanLocked.full_content, 'export const foo = 1;\nexport const bar = 2;');
});

test('executePatch rejects when old_text is not found', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'const x = 1;',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);
  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.patchEntity(architect.id, { x: 5, y: 5 });
  const architectMoved = harness.entities.get(architectId)!;

  harness.executePatch(architectMoved, {
    action: 'patch',
    target: 'a.ts',
    old_text: 'not-found',
    new_text: 'replacement',
  });

  assert.ok(!harness.pendingEditAgents.has(architect.id));
});

test('executeDelete rejects when line range is invalid', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'line1\nline2',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);
  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.patchEntity(architect.id, { x: 5, y: 5 });
  const architectMoved = harness.entities.get(architectId)!;

  harness.executeDelete(architectMoved, {
    action: 'delete',
    target: 'a.ts',
    start_line: 5,
    end_line: 10,
  });

  assert.ok(!harness.pendingEditAgents.has(architect.id));
});

test('executeInsert sets pendingEditAgents and updates task status', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'line1\nline2',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);
  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.patchEntity(architect.id, { x: 5, y: 5 });
  const architectMoved = harness.entities.get(architectId)!;

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Add line',
      target_path: 'src/a.ts',
      status: 'assigned',
      assigned_agent_id: architectId,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  // Use a temp directory so the test does not write to the real repo
  const tempDir = mkdtempSync(path.join(tmpdir(), 'lux-test-'));
  (engine as unknown as { activeRepoPath: string | null }).activeRepoPath = tempDir;

  harness.executeInsert(architectMoved, {
    action: 'insert',
    target: 'a.ts',
    after_line: 1,
    text: 'inserted',
  });

  assert.ok(harness.pendingEditAgents.has(architectMoved.id));
  assert.equal(harness.activeTasks[0]!.status, 'in_progress');

  // Clean up temp directory
  rmSync(tempDir, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// Agent activity computation
// ---------------------------------------------------------------------------

test('computeAgentActivities returns idle for agents with no objective', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;
  harness.resetWorld([]);

  const activities = harness.computeAgentActivities();
  assert.ok(activities.length >= 3);

  for (const activity of activities) {
    assert.equal(activity.status, 'idle');
    assert.equal(activity.target_path, null);
  }
});

test('computeAgentActivities returns walking when agent has objective_path', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 10,
    y: 10,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'const x = 1;',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  harness.patchEntity(architectId, { objective_path: 'src/a.ts' });

  const activities = harness.computeAgentActivities();
  const architectActivity = activities.find((a) => a.agent_id === architectId);
  assert.ok(architectActivity);
  assert.equal(architectActivity.status, 'walking');
  assert.equal(architectActivity.target_path, 'src/a.ts');
});

test('computeAgentActivities returns reading when agent is locked on a file', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'export const foo = 1;',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);
  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.patchEntity(architect.id, { x: 5, y: 5 });
  harness.patchEntity(fileEntity.id, { lock_owner: architectId });

  const activities = harness.computeAgentActivities();
  const architectActivity = activities.find((a) => a.agent_id === architectId);
  assert.ok(architectActivity);
  assert.equal(architectActivity.status, 'reading');
  assert.equal(architectActivity.target_path, 'src/a.ts');
});

test('computeAgentActivities returns editing when agent is in pendingEditAgents', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;

  const fileEntity: Entity = {
    id: 'file:a.ts',
    type: 'file',
    x: 5,
    y: 5,
    mass: 2,
    tick_updated: 0,
    name: 'a.ts',
    path: 'src/a.ts',
    content: 'line1\nline2',
  };
  harness.resetWorld([fileEntity]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);
  const architect = harness.entities.get(architectId);
  assert.ok(architect);

  harness.patchEntity(architect.id, { x: 5, y: 5 });
  const architectMoved = harness.entities.get(architectId)!;

  harness.activeTasks = [
    {
      id: 't1',
      description: 'Add line',
      target_path: 'src/a.ts',
      status: 'assigned',
      assigned_agent_id: architectId,
      created_at_tick: 0,
      updated_at_tick: 0,
    },
  ];

  const tempDir = mkdtempSync(path.join(tmpdir(), 'lux-test-'));
  (engine as unknown as { activeRepoPath: string | null }).activeRepoPath = tempDir;

  harness.executeInsert(architectMoved, {
    action: 'insert',
    target: 'a.ts',
    after_line: 1,
    text: 'inserted',
  });

  const activities = harness.computeAgentActivities();
  const architectActivity = activities.find((a) => a.agent_id === architectId);
  assert.ok(architectActivity);
  assert.equal(architectActivity.status, 'editing');

  rmSync(tempDir, { recursive: true, force: true });
});

test('computeAgentActivities returns thinking when agent is in pendingAiAgents', () => {
  const { engine } = createMockEngine();
  const harness = engine as unknown as TaskPipelineHarness;
  harness.resetWorld([]);

  const architectId = harness.agentIds.find((id) => id.startsWith('agent-architect'));
  assert.ok(architectId);

  // Manually inject into pendingAiAgents via the internal map
  (engine as unknown as { pendingAiAgents: Map<string, unknown> }).pendingAiAgents.set(architectId, {
    runId: 1,
    startedAtMs: performance.now(),
  });

  const activities = harness.computeAgentActivities();
  const architectActivity = activities.find((a) => a.agent_id === architectId);
  assert.ok(architectActivity);
  assert.equal(architectActivity.status, 'thinking');
});
