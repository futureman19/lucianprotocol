import { isStructureEntity } from './mass-mapper';
import type { Entity, OperatorAction } from './types';

export interface ParsedOperatorDirective {
  action: OperatorAction;
  normalizedPrompt: string | null;
  targetQuery: string | null;
}

export interface ResolvedOperatorDirective extends ParsedOperatorDirective {
  target: Entity | null;
}

function normalizePathLike(value: string): string {
  return value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/[.,;:!?]+$/g, '');
}

function extractTargetQuery(prompt: string): string | null {
  const fencedMatch = prompt.match(/`([^`]+)`/);
  if (fencedMatch?.[1]) {
    const normalized = normalizePathLike(fencedMatch[1]);
    return normalized.length > 0 ? normalized : null;
  }

  const quotedMatch = prompt.match(/["']([^"']+)["']/);
  if (quotedMatch?.[1]) {
    const normalized = normalizePathLike(quotedMatch[1]);
    return normalized.length > 0 ? normalized : null;
  }

  const pathLikeMatch = prompt.match(
    /([A-Za-z]:\\[^\s"'`]+|(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/,
  );
  if (pathLikeMatch?.[1]) {
    const normalized = normalizePathLike(pathLikeMatch[1]);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

export function parseOperatorDirective(prompt: string | null | undefined): ParsedOperatorDirective {
  const normalizedPrompt = prompt?.trim() ?? '';
  if (normalizedPrompt.length === 0) {
    return {
      action: 'maintain',
      normalizedPrompt: null,
      targetQuery: null,
    };
  }

  const lower = normalizedPrompt.toLowerCase();
  let action: OperatorAction = 'maintain';

  if (/\b(explain|describe|summarize|inspect|what does)\b/.test(lower)) {
    action = 'explain';
  } else if (/\b(read|open|load|review)\b/.test(lower)) {
    action = 'read';
  } else if (/\b(navigate|go to|walk to|move to|find|head to)\b/.test(lower)) {
    action = 'navigate';
  }

  return {
    action,
    normalizedPrompt,
    targetQuery: extractTargetQuery(normalizedPrompt),
  };
}

function scoreCandidate(entity: Entity, normalizedQuery: string): number {
  const path = entity.path?.toLowerCase() ?? '';
  const name = entity.name?.toLowerCase() ?? '';

  if (path === normalizedQuery) {
    return 0;
  }

  if (name === normalizedQuery) {
    return 1;
  }

  if (path.endsWith(`/${normalizedQuery}`)) {
    return 2;
  }

  if (path.includes(normalizedQuery)) {
    return 3;
  }

  if (name.includes(normalizedQuery)) {
    return 4;
  }

  return Number.POSITIVE_INFINITY;
}

export function resolveOperatorTarget(
  entities: readonly Entity[],
  targetQuery: string | null,
): Entity | null {
  const normalizedQuery = targetQuery ? normalizePathLike(targetQuery).toLowerCase() : '';
  if (normalizedQuery.length === 0) {
    return null;
  }

  if (normalizedQuery === 'root' || normalizedQuery === 'repository root') {
    return entities.find((entity) => entity.type === 'directory' && entity.path === '.') ?? null;
  }

  const structureEntities = entities.filter((entity) => isStructureEntity(entity));
  const ranked = structureEntities
    .map((entity) => ({
      entity,
      score: scoreCandidate(entity, normalizedQuery),
      path: entity.path ?? entity.name ?? entity.id,
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => {
      const scoreDelta = left.score - right.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const pathLengthDelta = left.path.length - right.path.length;
      if (pathLengthDelta !== 0) {
        return pathLengthDelta;
      }

      return left.path.localeCompare(right.path);
    });

  return ranked[0]?.entity ?? null;
}

export function resolveOperatorDirective(
  prompt: string | null | undefined,
  entities: readonly Entity[],
): ResolvedOperatorDirective {
  const parsed = parseOperatorDirective(prompt);

  return {
    ...parsed,
    target: resolveOperatorTarget(entities, parsed.targetQuery),
  };
}
