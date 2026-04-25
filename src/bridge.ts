import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.BRIDGE_PORT ?? 3001);
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

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
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

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[bridge] Engine bridge running on http://localhost:${PORT}`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/engine/start  → start engine`);
  console.log(`[bridge] POST http://localhost:${PORT}/api/engine/stop   → stop engine`);
  console.log(`[bridge] GET  http://localhost:${PORT}/api/engine/status → check status`);
});
