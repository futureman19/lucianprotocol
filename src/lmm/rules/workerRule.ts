/**
 * Worker Rule
 * Tier 1 Automata — Age polyethism. Young = Nurse/Recycler, Adult = Builder, Old = Scout.
 */
import type { LMMSelf, LMMNeighbor, LMMDecision, PheromoneMap } from '../types.js';
import { scoutRule } from './scoutRule.js';
import { builderRule } from './builderRule.js';
import { canDeposit, canExtract, canRecycle, pickExplorationDirection } from './helpers.js';

export function workerRule(
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  tick: number,
  phase: number,
  pheromone: PheromoneMap,
): LMMDecision {
  const age = tick - self.birthTick;

  // Phase 1: Nurse/Recycler (0-100 ticks) — gather loose mass and deliver
  if (age < 100) {
    if (canDeposit(self, neighbors)) {
      return { action: 'deposit' };
    }

    if (canRecycle(self, neighbors)) {
      return { action: 'recycle' };
    }

    if (pheromone.scarcity < 128 && canExtract(self, neighbors)) {
      return { action: 'extract' };
    }

    const exploreDirection = pickExplorationDirection(self, neighbors, phase, 1);
    if (exploreDirection) {
      return {
        action: 'move',
        direction: exploreDirection,
        layTrail: { type: self.cargo > 0 ? 1 : 3, strength: self.cargo > 0 ? 120 : 30 },
      };
    }

    return { action: 'wait', layTrail: { type: 3, strength: 30 } };
  }

  // Phase 2: Builder (100-500 ticks)
  if (age < 500) {
    return builderRule(self, neighbors, tick, phase, pheromone);
  }

  // Phase 3: Scout (500+ ticks)
  return scoutRule(self, neighbors, tick, phase, pheromone);
}
