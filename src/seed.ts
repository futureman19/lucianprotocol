import seedrandom from 'seedrandom';

import type { AgentRole, Direction, Entity, Position } from './types';

export const GRID_WIDTH = 50;
export const GRID_HEIGHT = 50;
export const CLOCK_PERIOD = 60;
export const TICK_INTERVAL_MS = 100;
export const MAX_TICKS = 300;
export const WALL_COUNT = 20;
export const DEFAULT_SEED = 'lux-alpha-001';
export const WORLD_STATE_ID = 'lux-world';

export const START_POSITION: Position = { x: 0, y: 0 };
export const GOAL_POSITION: Position = { x: 25, y: 25 };
export const REQUIRED_COLLISION_WALL: Position = { x: 10, y: 10 };

export const ARCHITECT_COUNT = 3;

interface AgentSeedSpec {
  descriptor: string;
  id: string;
  name: string;
  position: Position;
  role: AgentRole;
}

const ARCHITECT_POSITIONS: readonly Position[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 0, y: 2 },
];

const VISIONARY_SEED: AgentSeedSpec = {
  descriptor: 'Visionary workforce node',
  id: 'agent-visionary-01',
  name: 'Visionary',
  position: { x: 1, y: 0 },
  role: 'visionary',
};

const CRITIC_SEED: AgentSeedSpec = {
  descriptor: 'Critic workforce node',
  id: 'agent-critic-01',
  name: 'Critic',
  position: { x: 0, y: 1 },
  role: 'critic',
};

function buildAgentSeeds(): readonly AgentSeedSpec[] {
  const architects: AgentSeedSpec[] = ARCHITECT_POSITIONS.slice(0, ARCHITECT_COUNT).map(
    (position, index) => ({
      descriptor: 'Architect workforce node',
      id: `agent-architect-${String(index + 1).padStart(2, '0')}`,
      name: 'Architect',
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

export function toIndex(x: number, y: number): number {
  return (y * GRID_WIDTH) + x;
}

export function isWithinBounds(position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x < GRID_WIDTH &&
    position.y >= 0 &&
    position.y < GRID_HEIGHT
  );
}

export function step(position: Position, direction: Direction): Position {
  const vector = DIRECTION_VECTORS[direction];

  return {
    x: position.x + vector.dx,
    y: position.y + vector.dy,
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
    })),
    {
      id: 'goal-primary',
      type: 'goal',
      x: GOAL_POSITION.x,
      y: GOAL_POSITION.y,
      mass: 1,
      tick_updated: 0,
    },
    {
      id: 'wall-000',
      type: 'wall',
      x: REQUIRED_COLLISION_WALL.x,
      y: REQUIRED_COLLISION_WALL.y,
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

  while (entities.filter((entity) => entity.type === 'wall').length < WALL_COUNT) {
    const candidate: Position = {
      x: Math.floor(rng() * GRID_WIDTH),
      y: Math.floor(rng() * GRID_HEIGHT),
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
      mass: 1,
      tick_updated: 0,
    });
  }

  return entities;
}
