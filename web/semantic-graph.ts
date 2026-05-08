import type { EnrichedGraph, GraphifyEdge, GraphifyNode } from '../src/types';

export interface SemanticConnection {
  confidence: GraphifyEdge['confidence'];
  sourcePath: string;
  surprising: boolean;
  targetPath: string;
  type: string;
}

export interface SemanticGraphIndex {
  connections: SemanticConnection[];
  godNodeIds: Set<string>;
  graph: EnrichedGraph;
  nodeById: Map<string, GraphifyNode>;
  nodesByFile: Map<string, GraphifyNode[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEnrichedGraph(value: unknown): value is EnrichedGraph {
  if (!isRecord(value) || !isRecord(value.graph)) {
    return false;
  }

  return (
    typeof value.repoName === 'string' &&
    typeof value.headSha === 'string' &&
    typeof value.generatedAt === 'string' &&
    Array.isArray(value.graph.nodes) &&
    Array.isArray(value.graph.edges)
  );
}

export function normalizeSemanticPath(filePath: string | null | undefined): string | null {
  const rawPath = filePath?.trim();
  if (!rawPath) {
    return null;
  }

  const normalized = rawPath.replace(/\\/g, '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function semanticPair(left: string, right: string): string {
  return [left, right].sort((a, b) => a.localeCompare(b)).join('\u0000');
}

export function createSemanticGraphIndex(graph: EnrichedGraph): SemanticGraphIndex {
  const nodeById = new Map<string, GraphifyNode>();
  const nodesByFile = new Map<string, GraphifyNode[]>();

  for (const node of graph.graph.nodes) {
    nodeById.set(node.id, node);
    const sourceFile = normalizeSemanticPath(node.source_file);
    if (!sourceFile) {
      continue;
    }

    const fileNodes = nodesByFile.get(sourceFile) ?? [];
    fileNodes.push(node);
    nodesByFile.set(sourceFile, fileNodes);
  }

  const godNodeIds = new Set(graph.graph.god_nodes ?? []);
  const surprisingPairs = new Set(
    (graph.graph.surprising_connections ?? []).map((connection) =>
      semanticPair(connection.from, connection.to),
    ),
  );
  const connections: SemanticConnection[] = [];

  for (const edge of graph.graph.edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourcePath = normalizeSemanticPath(sourceNode?.source_file);
    const targetPath = normalizeSemanticPath(targetNode?.source_file);
    if (!sourceNode || !targetNode || !sourcePath || !targetPath || sourcePath === targetPath) {
      continue;
    }

    const edgeType = edge.type.toLowerCase();
    const surprising =
      edgeType.includes('surpris') ||
      surprisingPairs.has(semanticPair(sourceNode.label, targetNode.label)) ||
      surprisingPairs.has(semanticPair(sourceNode.id, targetNode.id));
    if (edge.confidence !== 'INFERRED' && edgeType !== 'relates_to' && !surprising) {
      continue;
    }

    connections.push({
      confidence: edge.confidence,
      sourcePath,
      surprising,
      targetPath,
      type: edge.type,
    });
  }

  return {
    connections,
    godNodeIds,
    graph,
    nodeById,
    nodesByFile,
  };
}

export function getSemanticClusterId(index: SemanticGraphIndex | null, filePath: string | null | undefined): number | null {
  const normalizedPath = normalizeSemanticPath(filePath);
  if (!index || !normalizedPath) {
    return null;
  }

  const nodes = index.nodesByFile.get(normalizedPath) ?? [];
  const clusters = nodes
    .map((node) => node.cluster)
    .filter((cluster): cluster is number => typeof cluster === 'number' && Number.isFinite(cluster));
  if (clusters.length === 0) {
    return null;
  }

  const firstCluster = clusters[0];
  return clusters.every((cluster) => cluster === firstCluster) ? firstCluster ?? null : null;
}

export function hasGodNode(index: SemanticGraphIndex | null, filePath: string | null | undefined): boolean {
  const normalizedPath = normalizeSemanticPath(filePath);
  if (!index || !normalizedPath) {
    return false;
  }

  return (index.nodesByFile.get(normalizedPath) ?? []).some((node) => index.godNodeIds.has(node.id));
}
