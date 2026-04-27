import seedrandom from 'seedrandom';

import type { AgentRole, Direction, Entity, Position } from './types';
import { createLMMEntity } from './lmm/spawn.js';

export const GRID_WIDTH = 50;
export const GRID_HEIGHT = 50;
export const GRID_DEPTH = 8;
export const CLOCK_PERIOD = 60;
export const TICK_INTERVAL_MS = 500;
export const MAX_TICKS = 300;
export const WALL_COUNT = 20;
export const DEFAULT_SEED = 'lux-alpha-001';
export const WORLD_STATE_ID = 'lux-world';
export const DEFAULT_WEATHER = 'clear';
export const WEATHER_CHANGE_INTERVAL_QUEEN_CYCLES = 3;

export const START_POSITION: Position = { x: 0, y: 0, z: 0 };
export const GOAL_POSITION: Position = { x: 25, y: 25, z: 0 };
export const REQUIRED_COLLISION_WALL: Position = { x: 10, y: 10, z: 0 };

export const ARCHITECT_COUNT = 3;

interface AgentSeedSpec {
  descriptor: string;
  id: string;
  name: string;
  position: Position;
  role: AgentRole;
}

const ARCHITECT_POSITIONS: readonly Position[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 0, y: 2, z: 0 },
];

const VISIONARY_SEED: AgentSeedSpec = {
  descriptor: 'Visionary scout drone',
  id: 'agent-visionary-01',
  name: 'Scout-Visionary',
  position: { x: 1, y: 0, z: 0 },
  role: 'visionary',
};

const CRITIC_SEED: AgentSeedSpec = {
  descriptor: 'Critic repair drone',
  id: 'agent-critic-01',
  name: 'Repair-Critic',
  position: { x: 0, y: 1, z: 0 },
  role: 'critic',
};

function buildAgentSeeds(): readonly AgentSeedSpec[] {
  const architects: AgentSeedSpec[] = ARCHITECT_POSITIONS.slice(0, ARCHITECT_COUNT).map(
    (position, index) => ({
      descriptor: index === 0 ? 'Builder drone alpha' : index === 1 ? 'Miner drone beta' : 'Hauler drone gamma',
      id: `agent-architect-${String(index + 1).padStart(2, '0')}`,
      name: index === 0 ? 'Builder-SCV' : index === 1 ? 'Miner-Probe' : 'Hauler-Drone',
      position,
      role: 'architect',
    }),
  );

  return [...architects, VISIONARY_SEED, CRITIC_SEED];
}

const DIRECTION_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

export function toIndex(x: number, y: number, z = 0): number {
  return x + (y * GRID_WIDTH) + (z * GRID_WIDTH * GRID_HEIGHT);
}

export function isWithinBounds(position: Position): boolean {
  const z = position.z ?? 0;

  return (
    position.x >= 0 &&
    position.x < GRID_WIDTH &&
    position.y >= 0 &&
    position.y < GRID_HEIGHT &&
    z >= 0 &&
    z < GRID_DEPTH
  );
}

export function step(position: Position, direction: Direction): Position {
  const vector = DIRECTION_VECTORS[direction];

  return {
    x: position.x + vector.dx,
    y: position.y + vector.dy,
    z: position.z ?? 0,
  };
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isSolidEntity(entity: Entity): boolean {
  return entity.type === 'agent' || entity.type === 'wall';
}

export function createInitialEntities(seed: string): Entity[] {
  const rng = seedrandom(seed);
  const agentSeeds = buildAgentSeeds();
  const entities: Entity[] = [
    ...agentSeeds.map((agent) => ({
      agent_role: agent.role,
      descriptor: agent.descriptor,
      id: agent.id,
      mass: 1,
      name: agent.name,
      tick_updated: 0,
      type: 'agent' as const,
      x: agent.position.x,
      y: agent.position.y,
      z: 0,
    })),
    {
      id: 'goal-primary',
      type: 'goal',
      x: GOAL_POSITION.x,
      y: GOAL_POSITION.y,
      z: 0,
      mass: 1,
      tick_updated: 0,
    },
    {
      id: 'wall-000',
      type: 'wall',
      x: REQUIRED_COLLISION_WALL.x,
      y: REQUIRED_COLLISION_WALL.y,
      z: 0,
      mass: 1,
      tick_updated: 0,
    },
  ];

  const occupied = new Set<string>(
    [
      ...agentSeeds.map((agent) => `${agent.position.x},${agent.position.y}`),
      `${GOAL_POSITION.x},${GOAL_POSITION.y}`,
      `${REQUIRED_COLLISION_WALL.x},${REQUIRED_COLLISION_WALL.y}`,
    ],
  );

  // Spawn Tier 1 Automata (LMM swarm)
  const lmmRoles: Array<'scout' | 'worker' | 'builder' | 'patrol' | 'recycler'> = [
    'scout', 'scout', 'scout',
    'worker', 'worker', 'worker', 'worker',
    'builder', 'builder',
    'patrol', 'patrol',
    'recycler', 'recycler', 'recycler',
  ];
  let lmmIndex = 0;
  for (const role of lmmRoles) {
    // Place in a small deterministic ring around the start
    const angle = (lmmIndex * 2.4) % (2 * Math.PI);
    const radius = 2 + Math.floor((lmmIndex % 3));
    const lx = Math.max(0, Math.min(GRID_WIDTH - 1, Math.round(START_POSITION.x + Math.cos(angle) * radius)));
    const ly = Math.max(0, Math.min(GRID_HEIGHT - 1, Math.round(START_POSITION.y + Math.sin(angle) * radius)));
    const key = `${lx},${ly}`;
    if (!occupied.has(key)) {
      occupied.add(key);
      entities.push(createLMMEntity(
        `lmm-${role}-${String(lmmIndex + 1).padStart(2, '0')}`,
        lx,
        ly,
        role,
        1,
        0,
      ));
    }
    lmmIndex += 1;
  }

  while (entities.filter((entity) => entity.type === 'wall').length < WALL_COUNT) {
    const candidate: Position = {
      x: Math.floor(rng() * GRID_WIDTH),
      y: Math.floor(rng() * GRID_HEIGHT),
      z: 0,
    };

    const key = `${candidate.x},${candidate.y}`;
    if (occupied.has(key)) {
      continue;
    }

    if (manhattanDistance(candidate, START_POSITION) <= 2) {
      continue;
    }

    if (manhattanDistance(candidate, GOAL_POSITION) <= 2) {
      continue;
    }

    if (
      Math.abs(candidate.x - candidate.y) <= 1 &&
      candidate.x <= GOAL_POSITION.x &&
      candidate.y <= GOAL_POSITION.y
    ) {
      continue;
    }

    occupied.add(key);
    entities.push({
      id: `wall-${String(entities.filter((entity) => entity.type === 'wall').length).padStart(3, '0')}`,
      type: 'wall',
      x: candidate.x,
      y: candidate.y,
      z: 0,
      mass: 1,
      tick_updated: 0,
    });
  }

  return entities;
}
