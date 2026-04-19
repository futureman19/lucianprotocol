import type { Entity, GitStatus, NodeState } from './types';

export const HIVEMIND_LAWS = [
  'Read the lattice as the only communication layer. Agents coordinate by observing physical state, not by direct messaging.',
  'Honor the exclusion principle. If a node is occupied or locked, phase shift and wait instead of colliding or overwriting.',
  'Treat critical mass as instability. Structure nodes at chiral mass 8 or higher should be split or simplified when possible.',
  'Remain productive. If no new task is visible, continue maintenance by improving existing structure nodes.',
  'Hunt asymmetry. Bugs, conflicts, or missing verification are structural faults that should be exposed and repaired.',
  'Synthesize overlap. When parallel intent collides, prefer a unified structure instead of discarding one side.',
] as const;

export type HivemindAgentRole = 'visionary' | 'architect' | 'critic';
export type HivemindNodeState = NodeState;

interface HivemindNodeContext {
  occupiedPaths: Set<string>;
  tick: number;
  verifiedTicks: Readonly<Record<string, number>>;
}

const TASK_STATUSES = new Set<GitStatus>(['added', 'untracked']);
const ASYMMETRY_STATUSES = new Set<GitStatus>(['modified', 'deleted', 'conflicted']);

export function getAgentRole(entity: Entity): HivemindAgentRole | null {
  if (entity.type !== 'agent') {
    return null;
  }

  if (entity.agent_role !== null && entity.agent_role !== undefined) {
    return entity.agent_role;
  }

  const label = [
    entity.id,
    entity.name ?? '',
    entity.descriptor ?? '',
    entity.path ?? '',
  ]
    .join(' ')
    .toLowerCase();

  if (label.includes('visionary')) {
    return 'visionary';
  }

  if (label.includes('critic')) {
    return 'critic';
  }

  return 'architect';
}

export function getAgentRoleLabel(role: HivemindAgentRole): string {
  if (role === 'visionary') {
    return 'Visionary';
  }

  if (role === 'critic') {
    return 'Critic';
  }

  return 'Architect';
}

export function countEntityLines(entity: Entity): number {
  const source = entity.content ?? entity.content_preview ?? '';
  return source.length > 0 ? source.split('\n').length : 1;
}

export function computeChiralMass(entity: Entity): number {
  const baseMass = entity.mass;

  if (entity.type !== 'file') {
    return baseMass;
  }

  const lineLift = Math.floor(Math.max(0, countEntityLines(entity) - 1) / 120);
  return baseMass + lineLift;
}

export function isCriticalMass(entity: Entity): boolean {
  return computeChiralMass(entity) >= 8;
}

export function getNodeState(
  entity: Entity,
  context: HivemindNodeContext,
): NodeState {
  if (entity.node_state !== null && entity.node_state !== undefined) {
    return entity.node_state;
  }

  const entityPath = entity.path ?? null;
  const recentlyVerified =
    entityPath !== null &&
    context.verifiedTicks[entityPath] !== undefined &&
    (context.tick - context.verifiedTicks[entityPath]) <= 12;

  if (entityPath !== null && context.occupiedPaths.has(entityPath)) {
    return 'in-progress';
  }

  if (
    entity.git_status !== null &&
    entity.git_status !== undefined &&
    TASK_STATUSES.has(entity.git_status)
  ) {
    return 'task';
  }

  if (
    isCriticalMass(entity) ||
    (
      entity.git_status !== null &&
      entity.git_status !== undefined &&
      ASYMMETRY_STATUSES.has(entity.git_status)
    )
  ) {
    return 'asymmetry';
  }

  if (recentlyVerified) {
    return 'verified';
  }

  return 'stable';
}

export function getNodeStateLabel(state: NodeState): string {
  if (state === 'task') {
    return 'Genesis Task';
  }

  if (state === 'in-progress') {
    return 'Locked Build';
  }

  if (state === 'asymmetry') {
    return 'Asymmetry';
  }

  if (state === 'verified') {
    return 'Verified';
  }

  return 'Stable';
}
