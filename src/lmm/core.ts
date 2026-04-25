/**
 * LMM Core
 * Synchronous, deterministic decision engine for Tier 1 Automata.
 */
import type { Entity } from '../types.js';
import type { LMMScan, LMMDecision, PheromoneMap, LMMRule, LMMSelf, LMMNeighbor, TypeCode } from './types.js';
import { DIRS, TC, hashId, entityToTypeCode } from './types.js';

export interface LMMEntity extends Entity {
  lmm_rule: string;
  cargo: number;
  birth_tick: number;
  state_register: number;
}

export function isLMMEntity(entity: Entity): entity is LMMEntity {
  return entity.type === 'agent' && typeof entity.lmm_rule === 'string';
}

/** Build a deterministic scan for an agent. Neighbors sorted N/E/S/W. */
function classifyCell(entities: Entity[], looseMass: number): { typeCode: TypeCode; mass: number } {
  if (looseMass > 0) {
    return {
      typeCode: TC.LOOSE_MASS,
      mass: looseMass,
    };
  }

  const byPriority = [
    TC.TASK,
    TC.STRUCTURE_WIP,
    TC.STRUCTURE_DONE,
    TC.WALL,
    TC.GOAL,
    TC.AGENT,
    TC.FILE,
    TC.DIRECTORY,
  ];

  for (const targetType of byPriority) {
    const match = entities.find((entity) => entityToTypeCode(entity) === targetType);
    if (match) {
      return {
        typeCode: targetType,
        mass: match.mass ?? 0,
      };
    }
  }

  return {
    typeCode: TC.EMPTY,
    mass: 0,
  };
}

export function buildLMMScan(
  agent: LMMEntity,
  getCellEntities: (x: number, y: number, z: number, excludeEntityId?: string) => Entity[],
  getLooseMass: (x: number, y: number, z: number) => number,
  getTrail: (x: number, y: number, z: number) => { trail: number; trailType: number },
  tick: number,
): LMMScan {
  const currentZ = agent.z ?? 0;
  const currentCell = classifyCell(
    getCellEntities(agent.x, agent.y, currentZ, agent.id),
    getLooseMass(agent.x, agent.y, currentZ),
  );

  const self: LMMSelf = {
    x: agent.x,
    y: agent.y,
    z: currentZ,
    mass: agent.mass ?? 1,
    cellTypeCode: currentCell.typeCode,
    cellMass: currentCell.mass,
    cargo: agent.cargo ?? 0,
    idHash: hashId(agent.id),
    birthTick: agent.birth_tick ?? tick,
    stateRegister: agent.state_register ?? 0,
  };

  const neighbors: LMMNeighbor[] = [];
  for (const { dx, dy } of DIRS) {
    const nx = agent.x + dx;
    const ny = agent.y + dy;
    const cell = classifyCell(
      getCellEntities(nx, ny, currentZ),
      getLooseMass(nx, ny, currentZ),
    );
    const trail = getTrail(nx, ny, currentZ);

    neighbors.push({
      dx,
      dy,
      mass: cell.mass,
      typeCode: cell.typeCode,
      trail: trail.trail,
      trailType: trail.trailType,
    });
  }

  return { self, neighbors };
}

/** Run all LMM rules and return decisions sorted by entity.id ascending for determinism. */
export function computeLMMDecisions(
  agents: LMMEntity[],
  buildScan: (agent: LMMEntity) => LMMScan,
  tick: number,
  phase: number,
  pheromone: PheromoneMap,
  ruleRegistry: Record<string, LMMRule>,
): Map<string, LMMDecision> {
  const raw = new Map<string, LMMDecision>();
  for (const agent of agents) {
    const rule = ruleRegistry[agent.lmm_rule];
    if (!rule) continue;
    const scan = buildScan(agent);
    const decision = rule(scan.self, scan.neighbors, tick, phase, pheromone);
    raw.set(agent.id, decision);
  }

  // Deterministic ordering: sort by entity.id ascending
  const sortedIds = Array.from(raw.keys()).sort((a, b) => a.localeCompare(b));
  const sorted = new Map<string, LMMDecision>();
  for (const id of sortedIds) {
    sorted.set(id, raw.get(id)!);
  }
  return sorted;
}
