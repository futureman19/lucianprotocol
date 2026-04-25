import 'dotenv/config';

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { simpleGit, type FileStatusResult, type StatusResult } from 'simple-git';
import { z } from 'zod';

import { DEFAULT_SEED, GRID_HEIGHT, GRID_WIDTH, createInitialEntities } from './seed';
import { createServiceSupabaseClient, upsertEntitiesWithSchemaFallback } from './supabase';
import { describeStructureNode, getExtension, isBinaryExtension, mapMassToPath } from './mass-mapper';
import { EntitySchema, type Entity, type GitStatus, type Position } from './types';
import { buildTetherMap } from './import-graph';
import { computeGraphLayout } from './graph-layout';

const OVERLAY_DIRECTORY = path.join(process.cwd(), '.lux-state');
const OVERLAY_FILE = path.join(OVERLAY_DIRECTORY, 'repository-overlay.json');
const ROOT_NODE_PATH = '.';
const DEFAULT_PREVIEW_LENGTH = 200;
const DEFAULT_MAX_CONTENT_LENGTH = 16_000;

const RepositoryOverlaySchema = z.object({
  version: z.literal(1),
  repoRoot: z.string().min(1),
  repoName: z.string().min(1),
  headSha: z.string().min(1),
  seed: z.string().min(1),
  importedAt: z.string().min(1),
  entities: z.array(EntitySchema),
});

export interface ImportRepositoryOptions {
  maxContentLength?: number;
  previewLength?: number;
  seed?: string;
}

export interface RepositoryOverlay {
  version: 1;
  repoRoot: string;
  repoName: string;
  headSha: string;
  seed: string;
  importedAt: string;
  entities: Entity[];
}

interface RepositoryNode {
  content: string | null;
  contentHash: string | null;
  contentPreview: string | null;
  fullText: string | null;
  depth: number;
  descriptor: string;
  extension: string | null;
  gitStatus: GitStatus | null;
  isBinary: boolean;
  name: string;
  path: string;
  type: 'directory' | 'file';
  lastCommitSha: string | null;
  lastCommitMessage: string | null;
  lastCommitAuthor: string | null;
  lastCommitDate: string | null;
  gitDiff: string | null;
  tetherTo: string[] | null;
  tetherFrom: string[] | null;
  tetherBroken: boolean | null;
}

function sanitizeForJson(value: string): string {
  let sanitized = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (Number.isNaN(nextCode) || nextCode < 0xdc00 || nextCode > 0xdfff) {
        continue;
      }

      sanitized += value.charAt(index) + value.charAt(index + 1);
      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    sanitized += value.charAt(index);
  }

  return sanitized;
}

function deriveDirectoryPaths(filePaths: string[]): string[] {
  const directories = new Set<string>([ROOT_NODE_PATH]);

  for (const filePath of filePaths) {
    const segments = filePath.split('/').filter((segment) => segment.length > 0);
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }

  return Array.from(directories).sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length;
    if (depth !== 0) {
      return depth;
    }

    return left.localeCompare(right);
  });
}

function inferGitStatus(file: FileStatusResult): GitStatus {
  const combined = `${file.index}${file.working_dir}`;

  if (combined === '??') {
    return 'untracked';
  }

  if (combined.includes('U')) {
    return 'conflicted';
  }

  if (combined.includes('R') || file.from) {
    return 'renamed';
  }

  if (combined.includes('A')) {
    return 'added';
  }

  if (combined.includes('D')) {
    return 'deleted';
  }

  if (combined.includes('C')) {
    return 'copied';
  }

  if (combined.includes('!')) {
    return 'ignored';
  }

  if (combined.includes('M')) {
    return 'modified';
  }

  return 'clean';
}

function buildGitStatusMap(status: StatusResult): Map<string, GitStatus> {
  const statusMap = new Map<string, GitStatus>();

  for (const file of status.files) {
    statusMap.set(file.path, inferGitStatus(file));
    if (file.from) {
      statusMap.set(file.from, 'renamed');
    }
  }

  for (const filePath of status.not_added) {
    statusMap.set(filePath, 'untracked');
  }

  for (const filePath of status.conflicted) {
    statusMap.set(filePath, 'conflicted');
  }

  for (const filePath of status.created) {
    statusMap.set(filePath, 'added');
  }

  for (const filePath of status.deleted) {
    statusMap.set(filePath, 'deleted');
  }

  for (const filePath of status.modified) {
    statusMap.set(filePath, 'modified');
  }

  for (const renamed of status.renamed) {
    statusMap.set(renamed.to, 'renamed');
    statusMap.set(renamed.from, 'renamed');
  }

  for (const filePath of status.ignored ?? []) {
    statusMap.set(filePath, 'ignored');
  }

  return statusMap;
}

function findDirectoryGitStatus(directoryPath: string, statusMap: Map<string, GitStatus>): GitStatus | null {
  if (directoryPath === ROOT_NODE_PATH) {
    for (const gitStatus of statusMap.values()) {
      if (gitStatus !== 'clean') {
        return gitStatus;
      }
    }

    return 'clean';
  }

  const prefix = `${directoryPath}/`;
  for (const [filePath, gitStatus] of statusMap.entries()) {
    if (filePath === directoryPath || filePath.startsWith(prefix)) {
      return gitStatus;
    }
  }

  return 'clean';
}

function isProbablyBinary(buffer: Buffer, extension: string | null): boolean {
  if (isBinaryExtension(extension)) {
    return true;
  }

  const sampleLength = Math.min(buffer.length, 512);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }

  return false;
}

async function readFilePayload(
  absoluteFilePath: string,
  relativePath: string,
  maxContentLength: number,
  previewLength: number,
): Promise<{
  content: string | null;
  contentHash: string;
  contentPreview: string | null;
  extension: string | null;
  isBinary: boolean;
  fullText: string | null;
}> {
  const extension = getExtension(relativePath);
  let buffer: Buffer;

  try {
    buffer = await readFile(absoluteFilePath);
  } catch (error: unknown) {
    const message = error as NodeJS.ErrnoException;
    if (message.code === 'ENOENT') {
      return {
        content: null,
        contentHash: createHash('sha1').update(`missing:${relativePath}`).digest('hex'),
        contentPreview: null,
        fullText: null,
        extension,
        isBinary: isBinaryExtension(extension),
      };
    }

    throw error;
  }

  const contentHash = createHash('sha1').update(buffer).digest('hex');
  const binary = isProbablyBinary(buffer, extension);

  if (binary) {
    return {
      content: null,
      contentHash,
      contentPreview: null,
      fullText: null,
      extension,
      isBinary: true,
    };
  }

  const normalizedText = buffer.toString('utf8').replace(/\r\n/g, '\n');
  const sanitizedText = sanitizeForJson(normalizedText);

  return {
    content: sanitizedText.length <= maxContentLength ? sanitizedText : null,
    contentHash,
    contentPreview: sanitizedText.slice(0, previewLength),
    fullText: sanitizedText,
    extension,
    isBinary: false,
  };
}

function collectReservedPositions(seed: string): Set<string> {
  const reserved = new Set<string>();

  for (const entity of createInitialEntities(seed)) {
    reserved.add(`${entity.x},${entity.y},0`);
  }

  return reserved;
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function findOpenPosition(
  preferredX: number,
  preferredY: number,
  z: number,
  occupied: Set<string>,
  reserved: Set<string>,
  bounds?: LayoutBounds,
): Position {
  for (let radius = 0; radius <= GRID_WIDTH + GRID_HEIGHT; radius += 1) {
    const minY = Math.max(bounds?.minY ?? 0, preferredY - radius);
    const maxY = Math.min(bounds?.maxY ?? GRID_HEIGHT - 1, preferredY + radius);
    const minX = Math.max(bounds?.minX ?? 0, preferredX - radius);
    const maxX = Math.min(bounds?.maxX ?? GRID_WIDTH - 1, preferredX + radius);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.abs(x - preferredX) + Math.abs(y - preferredY);
        if (distance !== radius) {
          continue;
        }

        const key = `${x},${y},${z}`;
        if (occupied.has(key) || reserved.has(key)) {
          continue;
        }

        return { x, y, z };
      }
    }
  }

  throw new Error(
    bounds
      ? `Repository lattice exceeds bounds (${bounds.minX}-${bounds.maxX}, ${bounds.minY}-${bounds.maxY}).`
      : `Repository lattice exceeds the available 50x50 grid at layer z=${z}.`,
  );
}

function assignCoordinates(nodes: RepositoryNode[], seed: string): Map<string, Position> {
  const reserved = collectReservedPositions(seed);
  const layoutInputs = nodes.map((node) => ({
    path: node.path,
    type: node.type,
    name: node.name,
    extension: node.extension,
    tetherTo: node.tetherTo,
    tetherFrom: node.tetherFrom,
    depth: node.depth,
  }));

  const coordinates = computeGraphLayout(layoutInputs, seed);

  // Ensure reserved positions are not overwritten (shouldn't happen due to margins,
  // but guard just in case)
  for (const [path, pos] of coordinates) {
    if (reserved.has(`${pos.x},${pos.y},${pos.z ?? 0}`)) {
      // Re-resolve with occupied set including reserved
      const occupied = new Set<string>();
      for (const [, otherPos] of coordinates) {
        if (otherPos !== pos) {
          occupied.add(`${otherPos.x},${otherPos.y},${otherPos.z ?? 0}`);
        }
      }
      const resolved = findOpenPosition(pos.x, pos.y, pos.z ?? 0, occupied, reserved);
      coordinates.set(path, resolved);
    }
  }

  return coordinates;
}

async function buildRepositoryNodes(
  repoRoot: string,
  statusMap: Map<string, GitStatus>,
  maxContentLength: number,
  previewLength: number,
): Promise<RepositoryNode[]> {
  const git = simpleGit(repoRoot);
  const rawTree = await git.raw(['ls-tree', '-r', '--full-tree', '--name-only', 'HEAD']);
  const filePaths = rawTree
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));

  const directoryPaths = deriveDirectoryPaths(filePaths);
  const directoryNodes: RepositoryNode[] = directoryPaths.map((directoryPath) => ({
    content: null,
    contentHash: null,
    contentPreview: null,
    fullText: null,
    depth: directoryPath === ROOT_NODE_PATH ? 0 : directoryPath.split('/').length,
    descriptor: directoryPath === ROOT_NODE_PATH ? 'Repository root cluster' : describeStructureNode(directoryPath, 'directory'),
    extension: null,
    gitStatus: findDirectoryGitStatus(directoryPath, statusMap),
    isBinary: false,
    name: directoryPath === ROOT_NODE_PATH ? path.basename(repoRoot) : path.basename(directoryPath),
    path: directoryPath,
    type: 'directory',
    lastCommitSha: null,
    lastCommitMessage: null,
    lastCommitAuthor: null,
    lastCommitDate: null,
    gitDiff: null,
    tetherTo: null,
    tetherFrom: null,
    tetherBroken: null,
  }));

  const fileNodes = await Promise.all(
    filePaths.map(async (filePath): Promise<RepositoryNode> => {
      const absoluteFilePath = path.join(repoRoot, filePath);
      const payload = await readFilePayload(
        absoluteFilePath,
        filePath,
        maxContentLength,
        previewLength,
      );

      const gitStatus = statusMap.get(filePath) ?? 'clean';
      let lastCommitSha: string | null = null;
      let lastCommitMessage: string | null = null;
      let lastCommitAuthor: string | null = null;
      let lastCommitDate: string | null = null;
      let gitDiff: string | null = null;

      try {
        const log = await git.log({ file: filePath, n: 1 });
        const latest = log.latest;
        if (latest) {
          lastCommitSha = latest.hash;
          lastCommitMessage = latest.message;
          lastCommitAuthor = latest.author_name;
          lastCommitDate = latest.date;
        }
      } catch {
        // ignore log errors for new files
      }

      if (gitStatus === 'modified' || gitStatus === 'added' || gitStatus === 'deleted' || gitStatus === 'renamed') {
        try {
          gitDiff = await git.diff(['--', filePath]);
          if (gitDiff && gitDiff.length > 2000) {
            gitDiff = gitDiff.slice(0, 2000) + '\n... (truncated)';
          }
        } catch {
          // ignore diff errors
        }
      }

      return {
        content: payload.content,
        contentHash: payload.contentHash,
        contentPreview: payload.contentPreview,
        fullText: payload.fullText,
        depth: filePath.split('/').length,
        descriptor: describeStructureNode(filePath, 'file'),
        extension: payload.extension,
        gitStatus,
        isBinary: payload.isBinary,
        name: path.basename(filePath),
        path: filePath,
        type: 'file',
        lastCommitSha,
        lastCommitMessage,
        lastCommitAuthor,
        lastCommitDate,
        gitDiff: gitDiff ? sanitizeForJson(gitDiff) : null,
        tetherTo: null,
        tetherFrom: null,
        tetherBroken: null,
      };
    }),
  );

  // Resolve import tethers across file nodes
  const allNodes = [...directoryNodes, ...fileNodes];
  const fileNodeMap = new Map(fileNodes.map((n) => [n.path, n]));
  const tetherMap = buildTetherMap(fileNodes.map((n) => ({ path: n.path, content: n.fullText })));

  for (const [path, edges] of tetherMap.entries()) {
    const node = fileNodeMap.get(path);
    if (!node) continue;
    node.tetherTo = edges.map((e) => e.resolvedPath).filter((p): p is string => p !== null);
  }

  for (const node of fileNodes) {
    const edges = tetherMap.get(node.path) ?? [];
    const hasUnresolved = edges.some((e) => e.resolvedPath === null);
    const hasMissing = (node.tetherTo ?? []).some((target) => !fileNodeMap.has(target));
    node.tetherBroken = hasUnresolved || hasMissing;
  }

  for (const node of fileNodes) {
    const incoming = fileNodes
      .filter((other) => (other.tetherTo ?? []).includes(node.path))
      .map((other) => other.path);
    if (incoming.length > 0) {
      node.tetherFrom = incoming;
    }
  }

  return allNodes.sort((left, right) => {
    const typeOrder = left.type.localeCompare(right.type);
    if (typeOrder !== 0) {
      return typeOrder;
    }

    return left.path.localeCompare(right.path);
  });
}

function toEntity(node: RepositoryNode, coordinates: Map<string, Position>, repoRoot: string): Entity {
  const position = coordinates.get(node.path);
  if (!position) {
    throw new Error(`Missing coordinate assignment for ${node.path}`);
  }

  return EntitySchema.parse({
    id: `${node.type}:${node.path}`,
    type: node.type,
    x: position.x,
    y: position.y,
    z: position.z ?? 0,
    mass: mapMassToPath(node.path, node.type),
    tick_updated: 0,
    name: sanitizeForJson(node.name),
    path: sanitizeForJson(node.path),
    extension: node.extension === null ? null : sanitizeForJson(node.extension),
    descriptor: sanitizeForJson(node.descriptor),
    content: node.content === null ? null : sanitizeForJson(node.content),
    content_preview: node.contentPreview === null ? null : sanitizeForJson(node.contentPreview),
    content_hash: node.contentHash,
    git_status: node.gitStatus,
    repo_root: sanitizeForJson(repoRoot),
    is_binary: node.isBinary,
    last_commit_sha: node.lastCommitSha,
    last_commit_message: node.lastCommitMessage === null ? null : sanitizeForJson(node.lastCommitMessage),
    last_commit_author: node.lastCommitAuthor,
    last_commit_date: node.lastCommitDate,
    git_diff: node.gitDiff,
    tether_to: node.tetherTo,
    tether_from: node.tetherFrom,
    tether_broken: node.tetherBroken,
  });
}

export async function createRepositoryOverlay(
  repositoryPath: string,
  options: ImportRepositoryOptions = {},
): Promise<RepositoryOverlay> {
  const absolutePath = path.resolve(repositoryPath);
  const git = simpleGit(absolutePath);
  const isRepository = await git.checkIsRepo();

  if (!isRepository) {
    throw new Error(`${absolutePath} is not a Git repository.`);
  }

  const repoRoot = (await git.revparse(['--show-toplevel'])).trim();
  const headSha = (await git.revparse(['HEAD'])).trim();
  const status = await git.status();
  const statusMap = buildGitStatusMap(status);
  const maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  const previewLength = options.previewLength ?? DEFAULT_PREVIEW_LENGTH;
  const seed = options.seed ?? process.env.LUX_SEED ?? DEFAULT_SEED;
  const repositoryNodes = await buildRepositoryNodes(
    repoRoot,
    statusMap,
    maxContentLength,
    previewLength,
  );
  const coordinates = assignCoordinates(repositoryNodes, seed);
  const entities = repositoryNodes.map((node) => toEntity(node, coordinates, repoRoot));

  return {
    version: 1,
    repoRoot,
    repoName: path.basename(repoRoot),
    headSha,
    seed,
    importedAt: new Date().toISOString(),
    entities,
  };
}

export async function importRepository(
  repositoryPath: string,
  options: ImportRepositoryOptions = {},
): Promise<Entity[]> {
  const overlay = await createRepositoryOverlay(repositoryPath, options);
  return overlay.entities;
}

export function getNamedOverlayFile(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return path.join(OVERLAY_DIRECTORY, `${safeName}.json`);
}

export async function saveRepositoryOverlay(overlay: RepositoryOverlay): Promise<void> {
  await mkdir(OVERLAY_DIRECTORY, { recursive: true });
  await writeFile(OVERLAY_FILE, JSON.stringify(overlay, null, 2), 'utf8');
  await writeFile(getNamedOverlayFile(overlay.repoName), JSON.stringify(overlay, null, 2), 'utf8');
}

export function loadRepositoryOverlaySync(): Entity[] {
  if (!existsSync(OVERLAY_FILE)) {
    return [];
  }

  const rawOverlay = readFileSync(OVERLAY_FILE, 'utf8');
  const parsed = RepositoryOverlaySchema.parse(JSON.parse(rawOverlay));
  return parsed.entities;
}

export function listSavedRepositoryOverlays(): string[] {
  if (!existsSync(OVERLAY_DIRECTORY)) {
    return [];
  }

  const entries = readdirSync(OVERLAY_DIRECTORY, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'repository-overlay.json')
    .map((entry) => entry.name.replace(/\.json$/, ''));
}

export function loadNamedRepositoryOverlaySync(name: string): Entity[] {
  const filePath = getNamedOverlayFile(name);
  if (!existsSync(filePath)) {
    return [];
  }

  const rawOverlay = readFileSync(filePath, 'utf8');
  const parsed = RepositoryOverlaySchema.parse(JSON.parse(rawOverlay));
  return parsed.entities;
}

export async function syncRepositoryEntitiesToSupabase(entities: Entity[]): Promise<void> {
  const supabase = createServiceSupabaseClient();
  if (!supabase) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured to sync Git entities.');
  }

  const { error: deleteError } = await supabase
    .from('entities')
    .delete()
    .in('type', ['file', 'directory']);

  if (deleteError) {
    throw deleteError;
  }

  if (entities.length === 0) {
    return;
  }

  const { usedFallback } = await upsertEntitiesWithSchemaFallback(supabase, entities);
  if (usedFallback) {
    console.warn('[supabase] Repository entity sync retried without optional columns.');
  }
}
