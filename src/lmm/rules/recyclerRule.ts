/**
 * Recycler Rule
 * Tier 1 Automata — Gathers loose mass and delivers to tasks/structures.
 */
import type { LMMSelf, LMMNeighbor, LMMDecision } from '../types.js';
import { canDeposit, canExtract, canRecycle, pickExplorationDirection } from './helpers.js';

export function recyclerRule(
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  _tick: number,
  phase: number,
): LMMDecision {
  if (canDeposit(self, neighbors)) {
    return { action: 'deposit' };
  }

  if (canRecycle(self, neighbors)) {
    return { action: 'recycle' };
  }

  if (canExtract(self, neighbors)) {
    return { action: 'extract' };
  }

  const exploreDirection = pickExplorationDirection(self, neighbors, phase, 1);
  if (exploreDirection) {
    return {
      action: 'move',
      direction: exploreDirection,
      layTrail: { type: 1, strength: self.cargo > 0 ? 180 : 120 },
    };
  }

  if (self.cargo > 0) {
    return { action: 'move', direction: 'east', layTrail: { type: 1, strength: 120 } };
  }

  return { action: 'wait', layTrail: { type: 1, strength: 40 } };
}
