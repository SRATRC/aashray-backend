import { execFile } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { promisify } from 'util';
import { PM2_HOME } from '../config.js';
import { errorResult } from './result.js';
import { QR_MARKER, collectSecretValues, redactLogLine } from '../redact.js';

const execFileAsync = promisify(execFile);

const PM2_TIMEOUT_MS = 10000;
const TAIL_BYTES = 5 * 1024 * 1024;

async function runPm2Jlist(bin) {
  const { stdout } = await execFileAsync(bin, ['jlist'], {
    env: { ...process.env, PM2_HOME },
    timeout: PM2_TIMEOUT_MS,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

function daemonAnswers(sockPath) {
  return new Promise((resolve) => {
    const sock = net.connect(sockPath);
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(1000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// Internal view of every PM2 process. `env` holds that process's full environment,
// secrets included — it feeds redaction and the settings check, and must never be
// returned to a caller.
export async function readPm2Processes() {
  // `pm2 jlist` starts a fresh daemon when none is running, so a wrong PM2_HOME
  // would quietly launch an empty second PM2 as root. Only talk to a live one.
  // The socket file outlives a killed daemon, so connect to it: only an answering daemon counts.
  if (!(await daemonAnswers(path.join(PM2_HOME, 'rpc.sock')))) {
    throw new Error(`No running PM2 daemon at ${PM2_HOME}. Set PM2_HOME for the MCP process if PM2 lives elsewhere.`);
  }

  let stdout;
  try {
    stdout = await runPm2Jlist('pm2');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Not on PATH — global npm installs sit next to the node binary.
    stdout = await runPm2Jlist(path.join(path.dirname(process.execPath), 'pm2'));
  }

  const json = stdout.split('\n').find((line) => line.startsWith('[{') || line.trim() === '[]');
  if (!json) throw new Error('pm2 jlist did not return a process list.');

  return JSON.parse(json).map((p) => {
    const env = p.pm2_env ?? {};
    return {
      name: p.name,
      pid: p.pid,
      status: env.status,
      startedAt: env.pm_uptime,
      restarts: env.restart_time,
      unstableRestarts: env.unstable_restarts,
      exitCode: env.exit_code,
      cpuPercent: p.monit?.cpu,
      memoryBytes: p.monit?.memory,
      nodeVersion: env.node_version,
      errLogPath: env.pm_err_log_path,
      outLogPath: env.pm_out_log_path,
      env: env.env ?? {},
    };
  });
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

async function readTail(filePath, maxBytes) {
  const { size, mtime } = await fs.promises.stat(filePath);
  const start = Math.max(0, size - maxBytes);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buf, 0, buf.length, start);
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line is cut mid-way
    if (lines[lines.length - 1] === '') lines.pop();
    return { lines, size, mtime, partial: start > 0 };
  } finally {
    await handle.close();
  }
}

const getProcesses = {
  name: 'get_processes',
  description:
    'Lists every process PM2 runs on the production server (BackendAPI, CronJob, WhatsAppService, MCPServer) with status, pid, when it last started, uptime, restart counts, last exit code, CPU and memory. ' +
    'A deploy reloads every process within seconds of each other, so a process whose `startedAt` is later than the rest restarted on its own (usually a crash) — check get_process_logs for why. ' +
    '`unstableRestarts` counts restarts that came too soon after the previous start (crash loops). Read-only.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => {
    try {
      const now = Date.now();
      const processes = (await readPm2Processes()).map((p) => ({
        name: p.name,
        status: p.status,
        pid: p.pid,
        startedAt: p.startedAt ? new Date(p.startedAt).toISOString() : null,
        uptime: p.status === 'online' && p.startedAt ? formatDuration(now - p.startedAt) : null,
        restarts: p.restarts,
        unstableRestarts: p.unstableRestarts,
        lastExitCode: p.exitCode ?? null,
        cpuPercent: p.cpuPercent,
        memoryMb: p.memoryBytes != null ? Math.round(p.memoryBytes / 1048576) : null,
        nodeVersion: p.nodeVersion,
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ checkedAt: new Date(now).toISOString(), processes }) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
};

const getProcessLogs = {
  name: 'get_process_logs',
  description:
    "Returns the last N lines a PM2 process wrote to its console — what never reaches the application log: crashes before the logger starts, Node's own fatal errors, and anything printed with console.log/console.error (the WhatsApp service logs only this way). " +
    "`stream: 'error'` is stderr (default), `'out'` is stdout. PM2 does not timestamp these lines; `lastWrittenAt` is the file's last write. Only the last 5 MB of the file is read. " +
    'Secrets, auth headers and WhatsApp login QR codes are redacted before anything is returned. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      process: {
        type: 'string',
        description: 'PM2 process name, e.g. BackendAPI, CronJob, WhatsAppService, MCPServer (see get_processes).',
      },
      stream: { type: 'string', enum: ['error', 'out'], default: 'error', description: 'error = stderr, out = stdout.' },
      lines: { type: 'integer', default: 100, minimum: 1, maximum: 500, description: 'Number of lines to return (default 100, max 500).' },
      keyword: { type: 'string', description: 'Only return lines containing this text (case-insensitive), matched after redaction.' },
    },
    required: ['process'],
    additionalProperties: false,
  },
  handler: async ({ process: name, stream = 'error', lines = 100, keyword } = {}) => {
    try {
      const processes = await readPm2Processes();
      const proc = processes.find((p) => p.name === name);
      if (!proc) {
        return errorResult(new Error(`Unknown process "${name}". Known: ${processes.map((p) => p.name).join(', ')}.`));
      }

      // The path comes from PM2, never from the caller — this server runs as root.
      const filePath = stream === 'out' ? proc.outLogPath : proc.errLogPath;
      if (!filePath || !fs.existsSync(filePath)) {
        return { content: [{ type: 'text', text: `No ${stream} log file for ${name}.` }] };
      }

      const tail = await readTail(filePath, TAIL_BYTES);
      const limit = Math.min(Math.max(1, parseInt(lines, 10) || 100), 500);
      const secrets = collectSecretValues(processes);

      // Walk the raw lines from the end, collapsing QR runs and redacting each line, then
      // filter by keyword after redaction (so a keyword cannot confirm a secret). Stop as
      // soon as `limit` lines are collected. Without a keyword that touches only what it needs.
      const needle = keyword?.toLowerCase();
      const out = [];
      let inQrRun = false;
      for (let i = tail.lines.length - 1; i >= 0 && out.length < limit; i--) {
        const line = redactLogLine(tail.lines[i], secrets);
        const isQr = line === QR_MARKER;
        const repeat = isQr && inQrRun; // rows of one QR drawing collapse to a single marker
        inQrRun = isQr;
        if (repeat || (needle && !line.toLowerCase().includes(needle))) continue;
        out.push(line);
      }
      out.reverse();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            process: name,
            stream,
            file: path.basename(filePath),
            sizeBytes: tail.size,
            lastWrittenAt: tail.mtime.toISOString(),
            ...(tail.partial && { note: 'Only the last 5 MB of the file was read.' }),
            lines: out,
          }),
        }],
      };
    } catch (err) {
      return errorResult(err);
    }
  },
};

export const processTools = [getProcesses, getProcessLogs];
