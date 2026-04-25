/**
 * LMM (Automata) Types
 * Pure integer interface. No strings in the hot path. No API calls.
 * No randomness. No floating point.
 */

export const TC = {
  EMPTY: 0,
  BOUNDARY: 0,
  WALL: 1,
  GOAL: 1,
  FILE: 2,
  DIRECTORY: 3,
  AGENT: 4,
  TASK: 5, // Funded work item (formerly Genesis Block)
  STRUCTURE_WIP: 6,
  STRUCTURE_DONE: 7,
  LOOSE_MASS: 8,
} as const;

export type TypeCode = (typeof TC)[keyof typeof TC];

/** Compact neighbor observation. All integers. */
export interface LMMNeighbor {
  dx: number; // -1, 0, 1
  dy: number; // -1, 0, 1
  mass: number;
  typeCode: TypeCode;
  trail: number; // 0-255
  trailType: number; // 0=none, 1=resource, 2=alarm, 3=explore
}

/** Compact self-state. All integers. */
export interface LMMSelf {
  x: number;
  y: number;
  z: number;
  mass: number;
  cellTypeCode: TypeCode;
  cellMass: number;
  cargo: number; // Mass this agent is carrying (0 if empty)
  idHash: number; // Deterministic 32-bit hash from entity.id
  birthTick: number; // Tick when this agent was spawned
  stateRegister: number; // General-purpose integer state (0-255)
}

/** LMM scan result passed to rules. */
export interface LMMScan {
  self: LMMSelf;
  neighbors: LMMNeighbor[];
}

/** LMM Rule: pure function. Same input → same output, always. */
export type LMMRule = (
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  tick: number,
  phase: number,
  pheromone: PheromoneMap,
) => LMMDecision;

/** Global pheromone state emitted by the Queen. */
export interface PheromoneMap {
  alarm: number; // 0-255. High = spawn defense, slow movement.
  urgency: number; // 0-255. High = ignore trails, direct path.
  scarcity: number; // 0-255. High = hibernate LLMs, conserve mass.
  swarm: number; // 0-255. High = prepare for shard fission.
  explore: number; // 0-255. High = Scouts spread to empty quadrants.
}

/** Genome parameters evolved by the Queen. */
export interface Genome {
  workerRatio: number; // 0-255
  alarmThreshold: number; // 0-100 (shatter rate %)
  trailDecay: number; // 1-60 (ticks until trail fades)
  commitmentTicks: number; // 1-20
  recruitmentRadius: number; // 1-10
  trophallaxisRate: number; // 1-5 (mass units per transfer)
}

/** LMM-native actions. */
export type LMMDecision =
  | {
      action: 'move';
      direction: 'north' | 'east' | 'south' | 'west';
      layTrail?: { type: number; strength: number };
    }
  | {
      action: 'wait';
      layTrail?: { type: number; strength: number };
    }
  | { action: 'extract' } // Take 1 mass from adjacent task node
  | { action: 'deposit' } // Give 1 cargo mass to adjacent structure/task
  | { action: 'recycle' }; // Pick up 1 loose mass from current/adjacent cell

/** Cardinal directions with dx/dy. Fixed order for determinism. */
export const DIRS: Array<{ direction: 'north' | 'east' | 'south' | 'west'; dx: number; dy: number }> = [
  { direction: 'north', dx: 0, dy: -1 },
  { direction: 'east', dx: 1, dy: 0 },
  { direction: 'south', dx: 0, dy: 1 },
  { direction: 'west', dx: -1, dy: 0 },
];

/** Deterministic string hash to 32-bit unsigned integer. */
export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Map entity type strings to integer type codes. */
export function entityToTypeCode(entity: { type?: string; node_state?: string | null | undefined } | null | undefined): TypeCode {
  if (!entity) return TC.EMPTY;
  if (entity.type === 'pheromone') return TC.EMPTY;
  if (entity.type === 'wall') return TC.WALL;
  if (entity.type === 'goal') return TC.GOAL;
  if (entity.type === 'agent') return TC.AGENT;
  if (entity.type === 'file') {
    if (entity.node_state === 'task' || entity.node_state === 'in-progress' || entity.node_state === 'in_progress') {
      return TC.TASK;
    }
    if (entity.node_state === 'verified') {
      return TC.STRUCTURE_DONE;
    }
    return TC.STRUCTURE_WIP;
  }
  if (entity.type === 'directory') {
    if (entity.node_state === 'task' || entity.node_state === 'in-progress' || entity.node_state === 'in_progress') {
      return TC.TASK;
    }
    if (entity.node_state === 'verified') {
      return TC.STRUCTURE_DONE;
    }
    return TC.STRUCTURE_WIP;
  }
  return TC.EMPTY;
}

/** Resolve a direction from delta coordinates using deterministic tie-break. */
export function resolveDirection(
  dx: number,
  dy: number,
  phase: number,
): 'north' | 'east' | 'south' | 'west' {
  if (dx === 0 && dy === 0) return 'north';
  const preferHorizontal = Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && phase % 2 === 0);
  if (dx !== 0 && preferHorizontal) return dx > 0 ? 'east' : 'west';
  if (dy !== 0) return dy > 0 ? 'south' : 'north';
  return dx > 0 ? 'east' : 'west';
}
