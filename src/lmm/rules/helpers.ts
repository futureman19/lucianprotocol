import type { LMMNeighbor, LMMSelf } from '../types.js';
import { DIRS, TC, resolveDirection } from '../types.js';

function hasType(neighbors: LMMNeighbor[], ...types: number[]): boolean {
  return neighbors.some((neighbor) => types.includes(neighbor.typeCode));
}

export function canDeposit(self: LMMSelf, neighbors: LMMNeighbor[]): boolean {
  if (self.cargo <= 0) {
    return false;
  }

  if (
    self.cellTypeCode === TC.TASK ||
    self.cellTypeCode === TC.STRUCTURE_WIP ||
    self.cellTypeCode === TC.STRUCTURE_DONE
  ) {
    return true;
  }

  return hasType(neighbors, TC.TASK, TC.STRUCTURE_WIP, TC.STRUCTURE_DONE);
}

export function canRecycle(self: LMMSelf, neighbors: LMMNeighbor[]): boolean {
  return self.cellTypeCode === TC.LOOSE_MASS || hasType(neighbors, TC.LOOSE_MASS);
}

export function canExtract(self: LMMSelf, neighbors: LMMNeighbor[]): boolean {
  return self.cellTypeCode === TC.TASK || hasType(neighbors, TC.TASK);
}

function isTraversableType(typeCode: number): boolean {
  return (
    typeCode !== TC.WALL &&
    typeCode !== TC.AGENT &&
    typeCode !== TC.GOAL
  );
}

export function pickExplorationDirection(
  self: LMMSelf,
  neighbors: LMMNeighbor[],
  phase: number,
  preferredTrailType = 1,
): 'north' | 'east' | 'south' | 'west' | null {
  const candidates = neighbors.filter((neighbor) => isTraversableType(neighbor.typeCode));
  if (candidates.length === 0) {
    return null;
  }

  const preferredIndex = (self.idHash + self.stateRegister + phase) % DIRS.length;
  let bestNeighbor: LMMNeighbor | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const neighbor of candidates) {
    const direction = resolveDirection(neighbor.dx, neighbor.dy, phase);
    const directionIndex = DIRS.findIndex((candidate) => candidate.direction === direction);
    const wrappedDistance = (directionIndex - preferredIndex + DIRS.length) % DIRS.length;

    let score = 0;
    if (neighbor.trailType === preferredTrailType) {
      score += neighbor.trail * 4;
    } else if (neighbor.trailType === 3) {
      score += neighbor.trail * 2;
    } else if (neighbor.trailType === 2) {
      score -= neighbor.trail * 3;
    }

    if (neighbor.typeCode === TC.LOOSE_MASS) {
      score += self.cargo > 0 ? 40 : 120;
    } else if (neighbor.typeCode === TC.TASK) {
      score += self.cargo > 0 ? 90 : 80;
    } else if (neighbor.typeCode === TC.STRUCTURE_WIP) {
      score += self.cargo > 0 ? 70 : 35;
    } else if (neighbor.typeCode === TC.STRUCTURE_DONE) {
      score += self.cargo > 0 ? 55 : 25;
    } else if (neighbor.typeCode === TC.EMPTY) {
      score += 18;
    }

    score += (DIRS.length - wrappedDistance) * 3;
    score += Math.max(0, neighbor.dx) * 2;
    score += Math.max(0, neighbor.dy);

    if (score > bestScore) {
      bestScore = score;
      bestNeighbor = neighbor;
    }
  }

  return bestNeighbor ? resolveDirection(bestNeighbor.dx, bestNeighbor.dy, phase) : null;
}
