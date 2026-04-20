import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LuxEngine, findReadableTargetInEntities } from './engine';
import { createRepositoryOverlay, findOpenPosition } from './git-parser';
import { computeChiralMass } from './hivemind';
import { parseOperatorDirective } from './operator-control';
import { createInitialEntities } from './seed';
import { AgentDecisionSchema, type Entity, type Position } from './types';

interface EngineHarness {
  entities: Map<string, Entity>;
  getStructureEntities(): Entity[];
  moveEntity(entity: Entity, nextPosition: Position): void;
  patchEntity(entityId: string, patch: Partial<Entity>): Entity | null;
  registerEntity(entity: Entity): void;
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

test('createInitialEntities is deterministic for the same seed', () => {
  const first = createInitialEntities('lux-alpha-001');
  const second = createInitialEntities('lux-alpha-001');

  assert.deepEqual(first, second);
});

test('AgentDecisionSchema accepts read actions with a target', () => {
  const decision = AgentDecisionSchema.parse({ action: 'read', target: 'App.tsx' });

  assert.deepEqual(decision, { action: 'read', target: 'App.tsx' });
});

test('AgentDecisionSchema rejects edit actions without content', () => {
  assert.throws(() => {
    AgentDecisionSchema.parse({ action: 'edit', target: 'App.tsx' });
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

test('parseOperatorDirective extracts action and target query from a prompt', () => {
  const directive = parseOperatorDirective('Navigate to `src/engine.ts` and explain the control flow.');

  assert.equal(directive.action, 'explain');
  assert.equal(directive.targetQuery, 'src/engine.ts');
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

  const architect = entities.find((e) => e.id === 'agent-architect-01');
  const visionary = entities.find((e) => e.id === 'agent-visionary-01');
  const critic = entities.find((e) => e.id === 'agent-critic-01');

  assert.ok(architect);
  assert.ok(visionary);
  assert.ok(critic);

  assert.deepEqual({ x: architect.x, y: architect.y }, { x: 0, y: 0 });
  assert.deepEqual({ x: visionary.x, y: visionary.y }, { x: 1, y: 0 });
  assert.deepEqual({ x: critic.x, y: critic.y }, { x: 0, y: 1 });
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
  const result = findOpenPosition(10, 10, new Set(), new Set());
  assert.deepEqual(result, { x: 10, y: 10 });
});

test('findOpenPosition spirals outward when preferred is occupied', () => {
  const occupied = new Set(['10,10']);
  const result = findOpenPosition(10, 10, occupied, new Set());

  const distance = Math.abs(result.x - 10) + Math.abs(result.y - 10);
  assert.equal(distance, 1);
  assert.ok(!occupied.has(`${result.x},${result.y}`));
});

test('findOpenPosition respects reserved positions', () => {
  const occupied = new Set<string>();
  const reserved = new Set(['10,10', '10,11', '11,10', '9,10', '10,9']);

  const result = findOpenPosition(10, 10, occupied, reserved);

  assert.notEqual(`${result.x},${result.y}`, '10,10');
  assert.notEqual(`${result.x},${result.y}`, '10,11');
  assert.notEqual(`${result.x},${result.y}`, '11,10');
  assert.notEqual(`${result.x},${result.y}`, '9,10');
  assert.notEqual(`${result.x},${result.y}`, '10,9');
});

test('findOpenPosition throws when grid is exhausted', () => {
  const occupied = new Set<string>();
  const reserved = new Set<string>();

  for (let x = 0; x < 50; x += 1) {
    for (let y = 0; y < 50; y += 1) {
      occupied.add(`${x},${y}`);
    }
  }

  assert.throws(() => {
    findOpenPosition(0, 0, occupied, reserved);
  }, /Repository lattice exceeds the available 50x50 grid./);
});
