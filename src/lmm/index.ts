export { buildLMMScan, computeLMMDecisions, isLMMEntity, type LMMEntity } from './core.js';
export { createLMMEntity } from './spawn.js';
export {
  scoutRule,
  workerRule,
  builderRule,
  patrolRule,
  recyclerRule,
} from './rules/index.js';
export type {
  LMMScan,
  LMMDecision,
  PheromoneMap,
  LMMRule,
  LMMSelf,
  LMMNeighbor,
  Genome,
} from './types.js';
export { DIRS, TC, hashId, entityToTypeCode, resolveDirection } from './types.js';
