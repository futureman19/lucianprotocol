import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { simpleGit } from 'simple-git';

import type { EnrichedGraph } from './types';

const PORT = Number(process.env.BRIDGE_PORT ?? 3001);
const GRAPHIFY_CACHE_DIRECTORY = path.join(process.cwd(), '.lux-state', 'graphify');
const INVALID_CACHE_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
let engineProcess: ChildProcess | null = null;
const engineLogs: string[] = [];
const MAX_LOGS = 500;

function addLog(line: string): void {
  engineLogs.push(line);
  if (engineLogs.length > MAX_LOGS) {
    engineLogs.shift();
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function sanitizeGraphCacheSegment(value: string): string {
  return Array.from(value, (char) => (
    char.charCodeAt(0) < 32 || INVALID_CACHE_FILENAME_CHARS.has(char) ? '_' : char
  )).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCachedKnowledgeGraph(value: unknown): value is EnrichedGraph {
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

function loadCachedKnowledgeGraph(repoName: string | null, headSha: string | null): EnrichedGraph | null {
  if (!existsSync(GRAPHIFY_CACHE_DIRECTORY)) {
    return null;
  }

  const filePrefix = repoName ? `${sanitizeGraphCacheSegment(repoName)}-` : '';
  const exactFile = repoName && headSha
    ? path.join(
        GRAPHIFY_CACHE_DIRECTORY,
        `${sanitizeGraphCacheSegment(repoName)}-${sanitizeGraphCacheSegment(headSha)}.json`,
      )
    : null;
  const candidates = exactFile && existsSync(exactFile)
    ? [{ filePath: exactFile, modifiedAtMs: statSync(exactFile).mtimeMs }]
    : readdirSync(GRAPHIFY_CACHE_DIRECTORY, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name.startsWith(filePrefix))
        .map((entry) => {
          const filePath = path.join(GRAPHIFY_CACHE_DIRECTORY, entry.name);
          return { filePath, modifiedAtMs: statSync(filePath).mtimeMs };
        })
        .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate.filePath, 'utf8')) as unknown;
      if (isCachedKnowledgeGraph(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore invalid cache files and try the next candidate.
    }
  }

  return null;
}

function startEngine(): boolean {
  if (engineProcess) {
    return false;
  }

  engineLogs.length = 0;

  engineProcess = spawn('node', ['--import', 'tsx', 'src/engine.ts'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  engineProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim().length > 0) {
        addLog(line);
      }
    }
    process.stdout.write(data);
  });

  engineProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim().length > 0) {
        addLog(`[stderr] ${line}`);
      }
    }
    process.stderr.write(data);
  });

  engineProcess.on('exit', (code) => {
    addLog(`[bridge] Engine exited with code ${code ?? 'unknown'}`);
    engineProcess = null;
  });

  engineProcess.on('error', (err) => {
    addLog(`[bridge] Engine spawn error: ${err.message}`);
    engineProcess = null;
  });

  return true;
}

function stopEngine(): boolean {
  if (!engineProcess) {
    return false;
  }

  engineProcess.kill('SIGTERM');
  engineProcess = null;
  return true;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/engine/status' && req.method === 'GET') {
    sendJson(res, 200, {
      running: !!engineProcess,
      pid: engineProcess?.pid ?? null,
    });
    return;
  }

  if (url.pathname === '/api/engine/start' && req.method === 'POST') {
    const started = startEngine();
    sendJson(res, started ? 200 : 409, {
      success: started,
      running: !!engineProcess,
      pid: engineProcess?.pid ?? null,
    });
    return;
  }

  if (url.pathname === '/api/engine/stop' && req.method === 'POST') {
    const stopped = stopEngine();
    sendJson(res, stopped ? 200 : 409, {
      success: stopped,
      running: !!engineProcess,
    });
    return;
  }

  if (url.pathname === '/api/engine/logs' && req.method === 'GET') {
    sendJson(res, 200, { logs: engineLogs });
    return;
  }

  if (url.pathname === '/api/knowledge-graph' && req.method === 'GET') {
    const repoName = url.searchParams.get('repoName');
    const headSha = url.searchParams.get('headSha');
    const graph = loadCachedKnowledgeGraph(repoName, headSha);
    if (!graph) {
      sendJson(res, 404, { graph: null });
      return;
    }

    sendJson(res, 200, { graph });
    return;
  }

  if (url.pathname === '/api/git/status' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const { repoPath } = JSON.parse(raw) as { repoPath?: string };
      if (!repoPath) {
        sendJson(res, 400, { error: 'repoPath is required' });
        return;
      }
      const git = simpleGit(repoPath);
      const status = await git.status();
      sendJson(res, 200, { status });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown git status error';
      sendJson(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === '/api/git/diff' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const { repoPath, filePath } = JSON.parse(raw) as { repoPath?: string; filePath?: string };
      if (!repoPath) {
        sendJson(res, 400, { error: 'repoPath is required' });
        return;
      }
      const git = simpleGit(repoPath);
      const diff = filePath ? await git.diff(['--', filePath]) : await git.diff();
      sendJson(res, 200, { diff: diff ?? '' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown git diff error';
      sendJson(res, 500, { error: message });
    }
    return;
  }

  if (url.pathname === '/api/git/commit' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const { repoPath, message } = JSON.parse(raw) as { repoPath?: string; message?: string };
      if (!repoPath) {
        sendJson(res, 400, { error: 'repoPath is required' });
        return;
      }
      if (!message || message.trim().length === 0) {
        sendJson(res, 400, { error: 'commit message is required' });
        return;
      }
      const git = simpleGit(repoPath);
      const result = await git.commit(message.trim());
      sendJson(res, 200, { result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown git commit error';
      sendJson(res, 500, { error: message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[bridge] Engine bridge running on http://localhost:${PORT}`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/engine/start  → start engine`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/engine/stop   → stop engine`);
  console.log(`[bridge] GET  http://localhost:${PORT}/api/engine/status → check status`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/git/status  → git status`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/git/diff    → git diff`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/git/commit  → git commit`);
});
