/**
 * Patrol Rule
 * Tier 1 Automata — Deterministic square orbit; guards structures.
 */
import type { LMMSelf, LMMNeighbor, LMMDecision, PheromoneMap } from '../types.js';
import { TC } from '../types.js';

const ORBIT = ['east', 'south', 'west', 'north'] as const;

export function patrolRule(
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  tick: number,
  phase: number,
  pheromone: PheromoneMap,
): LMMDecision {
  const trailStrength = pheromone.alarm > 128 ? 255 : 60;

  // Deterministic 8-step square orbit using stateRegister as step counter
  const step = self.stateRegister % 8;
  const orbitDir = ORBIT[Math.floor(step / 2)]!;

  // Check if we can move in the orbit direction
  const dirMap: Record<string, { dx: number; dy: number }> = {
    north: { dx: 0, dy: -1 },
    east: { dx: 1, dy: 0 },
    south: { dx: 0, dy: 1 },
    west: { dx: -1, dy: 0 },
  };
  const wanted = dirMap[orbitDir]!;
  const obstacle = neighbors.find((n) => n.dx === wanted.dx && n.dy === wanted.dy && n.typeCode === TC.WALL);

  if (!obstacle) {
    return {
      action: 'move',
      direction: orbitDir as 'north' | 'east' | 'south' | 'west',
      layTrail: { type: 2, strength: trailStrength },
    };
  }

  // Obstacle: try to go around clockwise
  const fallbackOrder: Array<'north' | 'east' | 'south' | 'west'> = ['east', 'south', 'west', 'north'];
  const startIdx = fallbackOrder.indexOf(orbitDir as 'north' | 'east' | 'south' | 'west');
  for (let i = 1; i <= 3; i++) {
    const tryDir = fallbackOrder[(startIdx + i) % 4]!;
    const tryDelta = dirMap[tryDir]!;
    const blocked = neighbors.find((n) => n.dx === tryDelta.dx && n.dy === tryDelta.dy && n.typeCode === TC.WALL);
    if (!blocked) {
      return { action: 'move', direction: tryDir, layTrail: { type: 2, strength: trailStrength } };
    }
  }

  // Completely trapped — guard the spot
  return { action: 'wait', layTrail: { type: 2, strength: pheromone.alarm > 128 ? 255 : 40 } };
}
