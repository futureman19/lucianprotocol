import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createServiceSupabaseClient } from './supabase';
import type { EnrichedGraph, GraphifyEdge, GraphifyGraph, GraphifyNode } from './types';

const GRAPHIFY_VENV_DIRECTORY = path.join(process.cwd(), '.venv-graphify');
const GRAPHIFY_CACHE_DIRECTORY = path.join(process.cwd(), '.lux-state', 'graphify');
const GRAPHIFY_RUN_DIRECTORY = path.join(GRAPHIFY_CACHE_DIRECTORY, 'runs');
const GRAPHIFY_PACKAGE = 'graphifyy[gemini]';
const GRAPHIFY_OUTPUT_DIRECTORY = 'graphify-out';
const INVALID_CACHE_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface PythonCommand {
  command: string;
  prefixArgs: string[];
}

type GraphifyConfidence = GraphifyEdge['confidence'];

function getVenvPythonExecutable(): string {
  return process.platform === 'win32'
    ? path.join(GRAPHIFY_VENV_DIRECTORY, 'Scripts', 'python.exe')
    : path.join(GRAPHIFY_VENV_DIRECTORY, 'bin', 'python');
}

function sanitizeCacheSegment(value: string): string {
  return Array.from(value, (char) => (
    char.charCodeAt(0) < 32 || INVALID_CACHE_FILENAME_CHARS.has(char) ? '_' : char
  )).join('');
}

function getCacheFilePath(repoName: string, headSha: string): string {
  return path.join(
    GRAPHIFY_CACHE_DIRECTORY,
    `${sanitizeCacheSegment(repoName)}-${sanitizeCacheSegment(headSha)}.json`,
  );
}

function getRunRoot(repoName: string, headSha: string): string {
  return path.join(
    GRAPHIFY_RUN_DIRECTORY,
    `${sanitizeCacheSegment(repoName)}-${sanitizeCacheSegment(headSha)}`,
  );
}

function truncateOutput(value: string): string {
  return value.length > 6_000 ? `${value.slice(0, 6_000)}...` : value;
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    child.once('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}\n${truncateOutput(stderr || stdout)}`,
        ),
      );
    });
  });
}

async function findPythonCommand(): Promise<PythonCommand> {
  const candidates: PythonCommand[] = [
    { command: 'python3', prefixArgs: [] },
    { command: 'python', prefixArgs: [] },
    { command: 'py', prefixArgs: ['-3'] },
  ];

  for (const candidate of candidates) {
    try {
      await runProcess(candidate.command, [...candidate.prefixArgs, '--version']);
      return candidate;
    } catch {
      // Try the next Python launcher.
    }
  }

  throw new Error('Python 3.10+ was not found on PATH.');
}

async function canImportGraphify(): Promise<boolean> {
  const python = getVenvPythonExecutable();
  if (!existsSync(python)) {
    return false;
  }

  try {
    await runProcess(python, ['-c', 'import graphify']);
    return true;
  } catch {
    return false;
  }
}

export async function ensureGraphifyInstalled(): Promise<void> {
  if (await canImportGraphify()) {
    return;
  }

  await mkdir(path.dirname(GRAPHIFY_VENV_DIRECTORY), { recursive: true });

  const venvPython = getVenvPythonExecutable();
  if (!existsSync(venvPython)) {
    const python = await findPythonCommand();
    await runProcess(python.command, [
      ...python.prefixArgs,
      '-m',
      'venv',
      GRAPHIFY_VENV_DIRECTORY,
    ]);
  }

  await runProcess(venvPython, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--quiet',
    GRAPHIFY_PACKAGE,
  ]);
  await runProcess(venvPython, ['-c', 'import graphify']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readProperty(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeConfidence(value: unknown): GraphifyConfidence {
  return value === 'INFERRED' || value === 'AMBIGUOUS' || value === 'EXTRACTED'
    ? value
    : 'EXTRACTED';
}

function normalizeSourceFile(value: unknown, repoRoot: string): string | undefined {
  const rawValue = asString(value)?.trim();
  if (!rawValue) {
    return undefined;
  }

  const absoluteRepoRoot = path.resolve(repoRoot);
  if (path.isAbsolute(rawValue)) {
    const relativePath = path.relative(absoluteRepoRoot, rawValue);
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath)
    ) {
      return rawValue.replace(/\\/g, '/');
    }
    return relativePath.replace(/\\/g, '/') || '.';
  }

  const normalized = rawValue.replace(/\\/g, '/');
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

function normalizeNode(rawNode: unknown, repoRoot: string): GraphifyNode | null {
  if (!isRecord(rawNode)) {
    return null;
  }

  const id = asString(readProperty(rawNode, ['id', 'node_id']));
  if (!id) {
    return null;
  }

  const node: GraphifyNode = {
    id,
    label: asString(readProperty(rawNode, ['label', 'name'])) ?? id,
    type: asString(readProperty(rawNode, ['type', 'file_type', 'kind'])) ?? 'unknown',
  };
  const sourceFile = normalizeSourceFile(
    readProperty(rawNode, ['source_file', 'sourceFile', 'file', 'path']),
    repoRoot,
  );
  const cluster = asNumber(readProperty(rawNode, ['cluster', 'community', 'community_id']));
  const centrality = asNumber(readProperty(rawNode, ['centrality', 'degree_centrality']));

  if (sourceFile !== undefined) {
    node.source_file = sourceFile;
  }
  if (cluster !== null) {
    node.cluster = cluster;
  }
  if (centrality !== null) {
    node.centrality = centrality;
  }

  return node;
}

function normalizeEdge(rawEdge: unknown): GraphifyEdge | null {
  if (!isRecord(rawEdge)) {
    return null;
  }

  const source = asString(readProperty(rawEdge, ['source', 'from', '_src']));
  const target = asString(readProperty(rawEdge, ['target', 'to', '_tgt']));
  if (!source || !target) {
    return null;
  }

  return {
    source,
    target,
    type: asString(readProperty(rawEdge, ['type', 'relation', 'kind', 'label'])) ?? 'relates_to',
    confidence: normalizeConfidence(readProperty(rawEdge, ['confidence'])),
  };
}

function withComputedCentrality(nodes: GraphifyNode[], edges: GraphifyEdge[]): GraphifyNode[] {
  const degreeByNode = new Map<string, number>();
  for (const edge of edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
  }

  const maxDegree = Math.max(1, ...Array.from(degreeByNode.values()));
  return nodes.map((node) => {
    if (node.centrality !== undefined) {
      return node;
    }

    const degree = degreeByNode.get(node.id);
    if (degree === undefined) {
      return node;
    }

    return {
      ...node,
      centrality: Number((degree / maxDegree).toFixed(4)),
    };
  });
}

function normalizeGodNodes(value: unknown, nodes: GraphifyNode[], edges: GraphifyEdge[]): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const idByLabel = new Map(nodes.map((node) => [node.label, node.id]));
  const result: string[] = [];

  for (const item of asArray(value)) {
    const rawId = isRecord(item)
      ? asString(readProperty(item, ['id', 'node_id', 'node', 'label']))
      : asString(item);
    if (!rawId) {
      continue;
    }

    const id = nodeIds.has(rawId) ? rawId : (idByLabel.get(rawId) ?? rawId);
    if (!result.includes(id)) {
      result.push(id);
    }
  }

  if (result.length > 0) {
    return result;
  }

  const degreeByNode = new Map<string, number>();
  for (const edge of edges) {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
  }

  return [...degreeByNode.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([id]) => id);
}

function normalizeSurprisingConnections(value: unknown): Array<{ from: string; to: string; reason: string }> {
  const connections: Array<{ from: string; to: string; reason: string }> = [];

  for (const item of asArray(value)) {
    if (!isRecord(item)) {
      continue;
    }

    const from = asString(readProperty(item, ['from', 'source', 'source_label']));
    const to = asString(readProperty(item, ['to', 'target', 'target_label']));
    if (!from || !to) {
      continue;
    }

    connections.push({
      from,
      to,
      reason:
        asString(readProperty(item, ['reason', 'why', 'note']))
        ?? asString(readProperty(item, ['relation']))
        ?? 'surprising graph connection',
    });
  }

  return connections;
}

function normalizeGraph(
  rawGraph: unknown,
  rawAnalysis: unknown,
  repoName: string,
  headSha: string,
  repoRoot: string,
): EnrichedGraph {
  if (!isRecord(rawGraph)) {
    throw new Error('Graphify output was not a JSON object.');
  }

  const rawNodes = asArray(readProperty(rawGraph, ['nodes']));
  const rawEdges = asArray(readProperty(rawGraph, ['edges', 'links']));
  const edges = rawEdges.map(normalizeEdge).filter((edge): edge is GraphifyEdge => edge !== null);
  const nodes = withComputedCentrality(
    rawNodes.map((node) => normalizeNode(node, repoRoot)).filter((node): node is GraphifyNode => node !== null),
    edges,
  );

  if (nodes.length === 0) {
    throw new Error('Graphify output contained no nodes.');
  }

  const analysisRecord = isRecord(rawAnalysis) ? rawAnalysis : {};
  const godNodes = normalizeGodNodes(
    readProperty(analysisRecord, ['gods', 'god_nodes']) ?? readProperty(rawGraph, ['god_nodes']),
    nodes,
    edges,
  );
  const surprisingConnections = normalizeSurprisingConnections(
    readProperty(analysisRecord, ['surprises', 'surprising_connections'])
      ?? readProperty(rawGraph, ['surprising_connections', 'surprises']),
  );

  const graph: GraphifyGraph = { nodes, edges };
  if (godNodes.length > 0) {
    graph.god_nodes = godNodes;
  }
  if (surprisingConnections.length > 0) {
    graph.surprising_connections = surprisingConnections;
  }

  return {
    graph,
    repoName,
    headSha,
    generatedAt: new Date().toISOString(),
  };
}

function isCachedGraph(value: unknown): value is EnrichedGraph {
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

async function readCachedGraph(cachePath: string): Promise<EnrichedGraph | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8')) as unknown;
    return isCachedGraph(parsed) ? parsed : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown cache parse error';
    console.warn(`[graphify] ignoring invalid cache ${cachePath}: ${message}`);
    return null;
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function upsertKnowledgeGraph(graph: EnrichedGraph): Promise<void> {
  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from('knowledge_graphs')
    .upsert(
      {
        repo_name: graph.repoName,
        head_sha: graph.headSha,
        graph_json: graph,
        generated_at: graph.generatedAt,
      },
      { onConflict: 'repo_name,head_sha' },
    );

  if (error) {
    console.warn(`[graphify] Supabase knowledge_graphs upsert failed: ${error.message}`);
  }
}

function getGeminiEnvironment(): NodeJS.ProcessEnv | null {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!geminiApiKey) {
    return null;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.GEMINI_API_KEY = geminiApiKey;
  env.GOOGLE_API_KEY = env.GOOGLE_API_KEY?.trim() || geminiApiKey;
  return env;
}

export async function extractGraph(
  repoRoot: string,
  repoName: string,
  headSha: string,
): Promise<EnrichedGraph | null> {
  await mkdir(GRAPHIFY_CACHE_DIRECTORY, { recursive: true });
  const cachePath = getCacheFilePath(repoName, headSha);
  const cachedGraph = existsSync(cachePath) ? await readCachedGraph(cachePath) : null;
  if (cachedGraph) {
    await upsertKnowledgeGraph(cachedGraph);
    return cachedGraph;
  }

  const env = getGeminiEnvironment();
  if (!env) {
    console.warn('[graphify] GEMINI_API_KEY is missing; skipping knowledge graph extraction.');
    return null;
  }

  try {
    await ensureGraphifyInstalled();

    const venvPython = getVenvPythonExecutable();
    const runRoot = getRunRoot(repoName, headSha);
    await mkdir(runRoot, { recursive: true });

    await runProcess(
      venvPython,
      ['-m', 'graphify', 'extract', path.resolve(repoRoot), '--backend', 'gemini', '--out', runRoot],
      { cwd: path.resolve(repoRoot), env },
    );

    const graphPath = path.join(runRoot, GRAPHIFY_OUTPUT_DIRECTORY, 'graph.json');
    const analysisPath = path.join(runRoot, GRAPHIFY_OUTPUT_DIRECTORY, '.graphify_analysis.json');
    if (!existsSync(graphPath)) {
      console.warn(`[graphify] Graphify completed but did not write ${graphPath}.`);
      return null;
    }

    const rawGraph = await readOptionalJson(graphPath);
    const rawAnalysis = await readOptionalJson(analysisPath);
    const enrichedGraph = normalizeGraph(rawGraph, rawAnalysis, repoName, headSha, repoRoot);

    await writeFile(cachePath, JSON.stringify(enrichedGraph, null, 2), 'utf8');
    await upsertKnowledgeGraph(enrichedGraph);
    return enrichedGraph;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[graphify] extraction skipped: ${message}`);
    return null;
  }
}
