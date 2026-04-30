import { computeChiralMass } from '../src/hivemind';
import { isStructureEntity } from '../src/mass-mapper';
import type { Entity, GitStatus, NodeState, WorldState } from '../src/types';
import {
  getConditionState,
  getNetworkLoad,
  getPowerState,
  getTrafficLoad,
} from './shared-contract';

export type CitySystemKey = 'power' | 'traffic' | 'pollution';
export type CitySystemTone = 'stable' | 'strained' | 'critical';
export type AdvisorMood = 'pleased' | 'concerned' | 'alarmed';
export type AdvisorAction = 'read' | 'explain' | 'repair';

export interface CitySystemReport {
  key: CitySystemKey;
  name: string;
  value: number;
  pressure: number;
  tone: CitySystemTone;
  status: string;
  detail: string;
  targetPath: string | null;
}

export interface AdvisorReport {
  id: 'architect' | 'critic' | 'economy';
  title: string;
  office: string;
  mood: AdvisorMood;
  system: CitySystemKey;
  headline: string;
  counsel: string;
  action: AdvisorAction | null;
  actionLabel: string | null;
  targetPath: string | null;
  priority: number;
}

export interface CityCouncilState {
  integrity: number;
  systems: Record<CitySystemKey, CitySystemReport>;
  advisors: AdvisorReport[];
  counts: {
    asymmetry: number;
    criticalMass: number;
    brokenTethers: number;
    modified: number;
    overloaded: number;
    offline: number;
    queueDepth: number;
    structures: number;
  };
}

const RISK_GIT_STATUSES = new Set<GitStatus>(['deleted', 'conflicted']);
const DIRTY_GIT_STATUSES = new Set<GitStatus>(['added', 'modified', 'renamed', 'untracked']);
const RISK_NODE_STATES = new Set<NodeState>(['asymmetry', 'demolishing']);

function clampInteger(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function systemTone(pressure: number): CitySystemTone {
  if (pressure >= 70) {
    return 'critical';
  }

  if (pressure >= 38) {
    return 'strained';
  }

  return 'stable';
}

function moodFromPressure(pressure: number): AdvisorMood {
  if (pressure >= 70) {
    return 'alarmed';
  }

  if (pressure >= 38) {
    return 'concerned';
  }

  return 'pleased';
}

function pathOf(entity: Entity | null | undefined): string | null {
  return entity?.path ?? null;
}

function isRiskNode(entity: Entity): boolean {
  const nodeState = entity.node_state ?? 'stable';
  const gitStatus = entity.git_status ?? 'clean';
  return RISK_NODE_STATES.has(nodeState) || RISK_GIT_STATUSES.has(gitStatus) || entity.tether_broken === true;
}

function sortByRisk(left: Entity, right: Entity): number {
  const leftRisk =
    (left.tether_broken === true ? 30 : 0) +
    ((left.node_state ?? 'stable') === 'asymmetry' ? 24 : 0) +
    (computeChiralMass(left) * 3) +
    (getNetworkLoad(left) * 20) +
    (getTrafficLoad(left) * 18);
  const rightRisk =
    (right.tether_broken === true ? 30 : 0) +
    ((right.node_state ?? 'stable') === 'asymmetry' ? 24 : 0) +
    (computeChiralMass(right) * 3) +
    (getNetworkLoad(right) * 20) +
    (getTrafficLoad(right) * 18);

  return rightRisk - leftRisk;
}

function formatSystemStatus(tone: CitySystemTone, stable: string, strained: string, critical: string): string {
  if (tone === 'critical') {
    return critical;
  }

  if (tone === 'strained') {
    return strained;
  }

  return stable;
}

export function computeCityCouncilState(entities: readonly Entity[], worldState: WorldState): CityCouncilState {
  const structures = entities.filter((entity) => isStructureEntity(entity));
  const issueNodes = structures.filter(isRiskNode);
  const criticalMassNodes = structures.filter((entity) => computeChiralMass(entity) >= 8);
  const brokenTetherNodes = structures.filter((entity) => entity.tether_broken === true);
  const modifiedNodes = structures.filter((entity) => DIRTY_GIT_STATUSES.has(entity.git_status ?? 'clean'));
  const strainedPowerNodes = structures.filter((entity) => getPowerState(entity) === 'strained');
  const overloadedPowerNodes = structures.filter((entity) => getPowerState(entity) === 'overloaded');
  const offlinePowerNodes = structures.filter((entity) => getPowerState(entity) === 'offline');
  const decayingNodes = structures.filter((entity) => {
    const condition = getConditionState(entity);
    return condition === 'decaying' || condition === 'condemned';
  });

  const queueDepth = worldState.queue_depth ?? 0;
  const taskCount = worldState.active_tasks?.filter((task) => task.status !== 'done').length ?? 0;
  const averageNetwork = average(structures.map((entity) => getNetworkLoad(entity)));
  const averageTraffic = average(structures.map((entity) => getTrafficLoad(entity)));
  const activeAgents = worldState.agent_activities?.filter((activity) => activity.status !== 'idle').length ?? 0;

  const powerPressure = clampInteger(
    (offlinePowerNodes.length * 18) +
    (overloadedPowerNodes.length * 13) +
    (strainedPowerNodes.length * 6) +
    (queueDepth * 7) +
    (taskCount * 5) +
    (worldState.weather === 'rain' || worldState.weather === 'snow' ? 8 : 0),
  );

  const trafficPressure = clampInteger(
    (averageTraffic * 62) +
    (averageNetwork * 22) +
    (brokenTetherNodes.length * 16) +
    (activeAgents * 3),
  );

  const pollutionPressure = clampInteger(
    (issueNodes.length * 13) +
    (criticalMassNodes.length * 11) +
    (modifiedNodes.length * 4) +
    (decayingNodes.length * 7),
  );

  const powerTone = systemTone(powerPressure);
  const trafficTone = systemTone(trafficPressure);
  const pollutionTone = systemTone(pollutionPressure);

  const powerTarget = [...offlinePowerNodes, ...overloadedPowerNodes, ...strainedPowerNodes]
    .sort(sortByRisk)[0] ?? null;
  const trafficTarget = [...brokenTetherNodes, ...structures]
    .sort(sortByRisk)[0] ?? null;
  const pollutionTarget = [...issueNodes, ...criticalMassNodes, ...decayingNodes]
    .sort(sortByRisk)[0] ?? null;

  const systems: Record<CitySystemKey, CitySystemReport> = {
    power: {
      key: 'power',
      name: 'Power',
      value: 100 - powerPressure,
      pressure: powerPressure,
      tone: powerTone,
      status: formatSystemStatus(powerTone, 'Grid Nominal', 'Grid Strained', 'Rolling Failure'),
      detail: `${offlinePowerNodes.length} offline, ${overloadedPowerNodes.length} overloaded, queue ${queueDepth}`,
      targetPath: pathOf(powerTarget),
    },
    traffic: {
      key: 'traffic',
      name: 'Traffic',
      value: 100 - trafficPressure,
      pressure: trafficPressure,
      tone: trafficTone,
      status: formatSystemStatus(trafficTone, 'Flowing', 'Congested', 'Gridlocked'),
      detail: `${brokenTetherNodes.length} broken bridge(s), ${Math.round(averageTraffic * 100)}% route load`,
      targetPath: pathOf(trafficTarget),
    },
    pollution: {
      key: 'pollution',
      name: 'Pollution',
      value: 100 - pollutionPressure,
      pressure: pollutionPressure,
      tone: pollutionTone,
      status: formatSystemStatus(pollutionTone, 'Clean', 'Noisy', 'Toxic'),
      detail: `${issueNodes.length} fault(s), ${criticalMassNodes.length} critical mass node(s)`,
      targetPath: pathOf(pollutionTarget),
    },
  };

  const integrity = clampInteger(
    100 -
    ((issueNodes.length * 10) +
      (criticalMassNodes.length * 7) +
      (brokenTetherNodes.length * 8) +
      (offlinePowerNodes.length * 12)),
  );

  const advisors: AdvisorReport[] = [
    {
      id: 'architect',
      title: 'Architect',
      office: 'City Planning',
      mood: moodFromPressure(Math.max(trafficPressure, pollutionPressure)),
      system: trafficPressure >= pollutionPressure ? 'traffic' : 'pollution',
      headline:
        trafficPressure >= pollutionPressure
          ? 'The street plan is carrying too much dependency traffic.'
          : 'The skyline is accumulating oversized structures.',
      counsel:
        trafficPressure >= pollutionPressure
          ? 'I recommend rerouting the busiest bridge before authorizing another feature district.'
          : 'I recommend splitting the largest critical building into smaller civic blocks.',
      action: systems.traffic.targetPath || systems.pollution.targetPath ? 'explain' : null,
      actionLabel: systems.traffic.targetPath || systems.pollution.targetPath ? 'Inspect Plan' : null,
      targetPath: systems.traffic.targetPath ?? systems.pollution.targetPath,
      priority: Math.max(trafficPressure, pollutionPressure),
    },
    {
      id: 'critic',
      title: 'Critic',
      office: 'Safety Review',
      mood: moodFromPressure(pollutionPressure),
      system: 'pollution',
      headline:
        pollutionPressure >= 38
          ? 'Verification debt is now visible in the city air.'
          : 'The review board sees no immediate civic hazard.',
      counsel:
        pollutionPressure >= 38
          ? 'Pause expansion and send the Architect to repair the dirtiest node, then let Critic certify it.'
          : 'Keep the current cadence. The next useful move is to certify one stable district.',
      action: systems.pollution.targetPath ? 'repair' : null,
      actionLabel: systems.pollution.targetPath ? 'Repair Fault' : null,
      targetPath: systems.pollution.targetPath,
      priority: pollutionPressure,
    },
    {
      id: 'economy',
      title: 'Economy',
      office: 'Budget Office',
      mood: moodFromPressure(powerPressure),
      system: 'power',
      headline:
        powerPressure >= 38
          ? 'The automation budget is being converted into heat.'
          : 'The operating budget can support controlled expansion.',
      counsel:
        powerPressure >= 38
          ? 'Reduce queue pressure before pushing more construction orders through the grid.'
          : 'Approve one targeted improvement; broad automation can wait until demand rises.',
      action: systems.power.targetPath ? 'read' : null,
      actionLabel: systems.power.targetPath ? 'Audit Load' : null,
      targetPath: systems.power.targetPath,
      priority: powerPressure,
    },
  ];

  advisors.sort((left, right) => right.priority - left.priority);

  return {
    integrity,
    systems,
    advisors,
    counts: {
      asymmetry: structures.filter((entity) => (entity.node_state ?? 'stable') === 'asymmetry').length,
      criticalMass: criticalMassNodes.length,
      brokenTethers: brokenTetherNodes.length,
      modified: modifiedNodes.length,
      overloaded: overloadedPowerNodes.length,
      offline: offlinePowerNodes.length,
      queueDepth,
      structures: structures.length,
    },
  };
}
