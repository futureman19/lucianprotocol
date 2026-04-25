/**
 * Builder Rule
 * Tier 1 Automata — carries cargo to tasks and builds structures.
 */
import type { LMMNeighbor, LMMSelf, LMMDecision, PheromoneMap } from '../types.js';
import { canDeposit, canExtract, canRecycle, pickExplorationDirection } from './helpers.js';

export function builderRule(
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  _tick: number,
  phase: number,
  pheromone: PheromoneMap,
): LMMDecision {
  if (canDeposit(self, neighbors)) {
    return { action: 'deposit' };
  }

  if (canRecycle(self, neighbors)) {
    return { action: 'recycle' };
  }

  if (pheromone.scarcity < 128 && canExtract(self, neighbors)) {
    return { action: 'extract' };
  }

  const exploreDirection = pickExplorationDirection(
    self,
    neighbors,
    phase,
    pheromone.urgency > 128 ? 1 : 3,
  );

  if (exploreDirection) {
    return {
      action: 'move',
      direction: exploreDirection,
      layTrail: { type: 1, strength: self.cargo > 0 ? 160 : 80 },
    };
  }

  if (self.cargo > 0) {
    if (pheromone.urgency > 128) {
      return { action: 'move', direction: 'east', layTrail: { type: 1, strength: 150 } };
    }
    return { action: 'wait', layTrail: { type: 1, strength: 50 } };
  }

  return { action: 'wait', layTrail: { type: 1, strength: 20 } };
}
