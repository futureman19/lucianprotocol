/**
 * LMM Spawn Factory
 * Creates Tier 1 Automata entities deterministically.
 */
import type { Entity } from '../types.js';
import type { LMMEntity } from './core.js';

export function createLMMEntity(
  id: string,
  x: number,
  y: number,
  role: 'scout' | 'worker' | 'builder' | 'patrol' | 'recycler',
  mass = 1,
  birthTick = 0,
): LMMEntity {
  const base: Entity = {
    id,
    type: 'agent',
    x,
    y,
    z: 0,
    mass,
    node_state: null,
    tick_updated: 0,
    memory: null,
  };

  return {
    ...base,
    lmm_rule: role,
    cargo: 0,
    birth_tick: birthTick,
    state_register: 0,
  };
}
