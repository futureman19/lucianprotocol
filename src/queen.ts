import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { Entity, Task } from './types';

const QUEEN_DIRECTORY = path.join(process.cwd(), '.lux-state');

let activeSeed: string | null = null;

const QueenStateSchema = z.object({
  cycle: z.number().int().nonnegative(),
  tasksCompleted: z.number().int().nonnegative(),
  tasksShattered: z.number().int().nonnegative(),
  pheromoneAlarm: z.number().int().min(0).max(255),
  pheromoneUrgency: z.number().int().min(0).max(255),
  lastTick: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});

export interface QueenState {
  cycle: number;
  tasksCompleted: number;
  tasksShattered: number;
  pheromoneAlarm: number;
  pheromoneUrgency: number;
  lastTick: number;
  updatedAt: string;
}

function getQueenStateFile(seed: string): string {
  return path.join(QUEEN_DIRECTORY, `queen-${seed}.json`);
}

export function getDefaultQueenState(): QueenState {
  return {
    cycle: 0,
    tasksCompleted: 0,
    tasksShattered: 0,
    pheromoneAlarm: 0,
    pheromoneUrgency: 0,
    lastTick: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function loadQueenState(seed: string): QueenState {
  activeSeed = seed;

  const filePath = getQueenStateFile(seed);
  if (!existsSync(filePath)) {
    return getDefaultQueenState();
  }

  try {
    const rawState = readFileSync(filePath, 'utf8');
    return QueenStateSchema.parse(JSON.parse(rawState));
  } catch {
    return getDefaultQueenState();
  }
}

export async function saveQueenState(state: QueenState): Promise<void> {
  if (activeSeed === null) {
    throw new Error('Queen state cannot be saved before a seed has been loaded.');
  }

  await mkdir(QUEEN_DIRECTORY, { recursive: true });
  await writeFile(
    getQueenStateFile(activeSeed),
    JSON.stringify(QueenStateSchema.parse(state), null, 2),
    'utf8',
  );
}

export function computeAlarm(structureEntities: Entity[]): number {
  const asymmetryCount = structureEntities.filter((entity) => entity.node_state === 'asymmetry').length;
  return Math.min(255, asymmetryCount * 32);
}

export function computeUrgency(activeTasks: Task[]): number {
  const pendingTaskCount = activeTasks.filter((task) => task.status === 'pending').length;
  return Math.min(255, pendingTaskCount * 51);
}
