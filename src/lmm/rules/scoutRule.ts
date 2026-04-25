/**
 * Scout Rule
 * Tier 1 Automata — deterministic exploration and resource discovery.
 */
import type { LMMNeighbor, LMMSelf, LMMDecision, PheromoneMap } from '../types.js';
import { canDeposit, canRecycle, pickExplorationDirection } from './helpers.js';

export function scoutRule(
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  _tick: number,
  _phase: number,
  pheromone: PheromoneMap,
): LMMDecision {
  if (canDeposit(self, neighbors)) {
    return { action: 'deposit' };
  }

  const exploreDirection = pickExplorationDirection(self, neighbors, _phase, pheromone.alarm > 128 ? 2 : 1);

  if (self.cargo > 0) {
    return {
      action: 'move',
      direction: exploreDirection ?? 'east',
      layTrail: { type: pheromone.alarm > 128 ? 2 : 1, strength: 120 },
    };
  }

  if (pheromone.alarm > 128) {
    if (exploreDirection) {
      return {
        action: 'move',
        direction: exploreDirection,
        layTrail: { type: 2, strength: 255 },
      };
    }

    return { action: 'wait', layTrail: { type: 2, strength: 255 } };
  }

  if (canRecycle(self, neighbors)) {
    return { action: 'recycle' };
  }

  if (exploreDirection) {
    return {
      action: 'move',
      direction: exploreDirection,
      layTrail: { type: pheromone.explore > 128 ? 3 : 1, strength: pheromone.explore > 128 ? 90 : 60 },
    };
  }

  return { action: 'wait', layTrail: { type: 3, strength: 30 } };
}
