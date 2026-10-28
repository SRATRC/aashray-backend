import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { APP_DIR, ENV_FILE, LOG_DIR, PM2_HOME } from '../config.js';
import { PLAIN_KEYS, readEnvFile, stripQuotes } from '../redact.js';
import { readPm2Processes } from './processes.js';
import { errorResult } from './result.js';

const execFileAsync = promisify(execFile);
const scryptAsync = promisify(crypto.scrypt);

const MYSQL_DATA_DIR = '/var/lib/mysql';
const DISK_WARN_PERCENT = 85;
const FINGERPRINT_SALT = 'aashray-mcp-fingerprint';

// The server may run as root while the deploy checkout belongs to the runner user.
// A repo's own config can make git run commands (filters, hooks, gpg.program), so as root
// we run git AS THE CHECKOUT'S OWNER: any such command then has only the rights the owner
// already has, and the owner needs no safe.directory exception. When we are not switching
// user (local dev, non-root), safe.directory covers the "dubious ownership" check instead.
const SAFE_DIR = (() => { try { return fs.realpathSync(APP_DIR); } catch { return path.resolve(APP_DIR); } })();

function ownerHome(uid) {
  try {
    for (const line of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const f = line.split(':');
      if (f.length >= 6 && Number(f[2]) === uid && f[5]) return f[5];
    }
  } catch { /* fall through */ }
  return APP_DIR;
}

// Looked up on every call, and fails closed: null means no switch is needed (not root, or
// root owns the checkout). If we are root and cannot tell who owns the checkout (e.g. it is
// mid re-clone), statSync throws and git does not run — never fall back to running as root.
function gitRunAs() {
  if (process.getuid?.() !== 0) return null;
  const { uid, gid } = fs.statSync(APP_DIR);
  return uid === 0 ? null : { uid, gid, home: ownerHome(uid) };
}

const gb = (bytes) => Math.round((bytes / 1073741824) * 10) / 10;

// One entry per filesystem, listing which of the paths we care about live on it.
async function diskUsage(paths) {
  const byDevice = new Map();
  for (const p of paths) {
    try {
      const { dev } = await fs.promises.stat(p);
      if (byDevice.has(dev)) {
        byDevice.get(dev).paths.push(p);
        continue;
      }
      const s = await fs.promises.statfs(p);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = (s.blocks - s.bfree) * s.bsize;
      byDevice.set(dev, {
        paths: [p],
        totalGb: gb(total),
        freeGb: gb(free),
        // Same as `df`: root-reserved blocks count as neither used nor available.
        usedPercent: used + free ? Math.ceil((used / (used + free)) * 100) : null, // df rounds up
      });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return [...byDevice.values()];
}

// MemAvailable is what can be handed out without swapping; os.freemem() on Linux
// is MemFree, which ignores reclaimable page cache and always looks alarming.
function memory() {
  try {
    const info = Object.fromEntries(
      fs.readFileSync('/proc/meminfo', 'utf8').split('\n')
        .map((line) => line.match(/^(\w+):\s+(\d+) kB/))
        .filter(Boolean)
        .map(([, key, kb]) => [key, Number(kb) * 1024]),
    );
    return {
      totalGb: gb(info.MemTotal),
      availableGb: gb(info.MemAvailable),
      availablePercent: Math.round((info.MemAvailable / info.MemTotal) * 100),
      swapTotalGb: gb(info.SwapTotal),
      swapUsedGb: gb(info.SwapTotal - info.SwapFree),
    };
  } catch {
    return {
      totalGb: gb(os.totalmem()),
      availableGb: gb(os.freemem()),
      availablePercent: Math.round((os.freemem() / os.totalmem()) * 100),
    };
  }
}

async function dirSize(dir) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let totalBytes = 0;
  let largest = null;
  let files = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    let size;
    try {
      ({ size } = await fs.promises.stat(path.join(dir, entry.name)));
    } catch (err) {
      if (err.code === 'ENOENT') continue; // rotated away between readdir and stat
      throw err;
    }
    files += 1;
    totalBytes += size;
    if (!largest || size > largest.bytes) largest = { name: entry.name, bytes: size };
  }
  return {
    dir,
    files,
    totalMb: Math.round(totalBytes / 1048576),
    largest: largest && { name: largest.name, mb: Math.round(largest.bytes / 1048576) },
  };
}

const getServerHealth = {
  name: 'get_server_health',
  description:
    'Production server health: disk space for the filesystems holding the app, logs, PM2 and MySQL data; memory and swap; CPU count and load averages; uptime; and how much space the application log folder and the PM2 console-log folder take. ' +
    '`warnings` lists anything over a threshold (disk 85% full, under 10% memory available, 1-minute load above the CPU count). Read-only.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => {
    try {
      const disks = await diskUsage(['/', APP_DIR, LOG_DIR, PM2_HOME, MYSQL_DATA_DIR]);
      const mem = memory();
      const cpus = os.cpus().length;
      const [load1, load5, load15] = os.loadavg().map((n) => Math.round(n * 100) / 100);
      const logDirs = (await Promise.all([dirSize(LOG_DIR), dirSize(path.join(PM2_HOME, 'logs'))])).filter(Boolean);

      const warnings = [];
      for (const d of disks) {
        if (d.usedPercent >= DISK_WARN_PERCENT) warnings.push(`Disk holding ${d.paths.join(', ')} is ${d.usedPercent}% full (${d.freeGb} GB free).`);
      }
      if (mem.availablePercent < 10) warnings.push(`Only ${mem.availablePercent}% of memory is available.`);
      if (load1 > cpus) warnings.push(`1-minute load ${load1} is above the CPU count (${cpus}).`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            checkedAt: new Date().toISOString(),
            hostUptimeHours: Math.round(os.uptime() / 360) / 10,
            cpu: { count: cpus, load1, load5, load15 },
            memory: mem,
            disks,
            logDirs,
            warnings,
          }),
        }],
      };
    } catch (err) {
      return errorResult(err);
    }
  },
};

async function git(args) {
  // Strictly read-only: --no-optional-locks stops `git status` rewriting .git/index. As root we
  // run as the checkout's owner, so commands set in the repo's config never get root; the -c
  // flags are extra cover.
  const base = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false'];
  const opts = { timeout: 10000, cwd: APP_DIR };
  const runAs = gitRunAs();
  if (runAs) {
    // Owner's uid/gid, and an env that does not touch root's HOME/XDG paths.
    opts.uid = runAs.uid;
    opts.gid = runAs.gid;
    opts.env = { PATH: process.env.PATH, HOME: runAs.home, GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };
  } else {
    base.push('-c', `safe.directory=${SAFE_DIR}`);
  }
  const { stdout } = await execFileAsync('git', [...base, '-C', APP_DIR, ...args], opts);
  // Only the trailing newline goes: `git status` lines start with a meaningful space (" M file").
  return stdout.replace(/\n+$/, '');
}

async function gitState() {
  try {
    const [commit, committedAt, author, subject] = (await git(['log', '-1', '--format=%H%x1f%cI%x1f%an%x1f%s'])).split('\x1f');
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const changed = (await git(['status', '--porcelain', '--untracked-files=no'])).split('\n').filter(Boolean);
    return {
      commit,
      committedAt,
      author,
      subject,
      branch: branch === 'HEAD' ? null : branch,
      locallyModifiedFiles: changed.slice(0, 50).map((l) => l.slice(3)),
      ...(changed.length > 50 && { locallyModifiedTotal: changed.length }),
    };
  } catch (err) {
    return { error: err.message.split('\n')[0] };
  }
}

async function fingerprint(value) {
  return (await scryptAsync(value, FINGERPRINT_SALT, 16)).toString('hex').slice(0, 8);
}

async function settingsCheck(fileEnv, proc) {
  return Promise.all([...fileEnv].map(async ([key, fileValue]) => {
    const running = proc?.env?.[key];
    const value = running ?? fileValue;
    const differs = running !== undefined && running !== fileValue;
    const entry = {
      key,
      inProcess: running !== undefined,
      ...(running !== undefined && { matchesFile: !differs }),
    };
    if (PLAIN_KEYS.has(key)) {
      entry.length = value.length;
      entry.value = value;
    } else {
      entry.lengthRange = value.length < 8 ? '<8' : value.length < 16 ? '8-15' : '16+';
      if (value) {
        const [fp, fileFp] = await Promise.all([fingerprint(value), differs ? fingerprint(fileValue) : null]);
        entry.fingerprint = fp;
        if (differs) entry.fileFingerprint = fileFp;
      }
    }
    // A CRLF env file leaves a trailing \r after the closing quote.
    const bare = fileValue.replace(/\r$/, '');
    if (stripQuotes(bare) !== bare) entry.quotedInFile = true;
    return entry;
  }));
}

const getDeployInfo = {
  name: 'get_deploy_info',
  description:
    "What is deployed on the production server and how it is configured: the checked-out commit (hash, date, author, subject), any tracked files edited on the server by hand, when each PM2 process last started, and a check of every setting in .env.prod against the environment a process is actually running with. " +
    'Per setting: whether the process has it, whether it matches the file, and either its exact length and value (only for harmless settings such as PORT or AWS_REGION) or a length range (`lengthRange`: <8, 8-15 or 16+) and an 8-character fingerprint — never a secret itself. ' +
    "To check a secret against a value you hold (e.g. the Razorpay dashboard's webhook secret), compute its fingerprint locally and compare: " +
    `node -e "require('crypto').scrypt(process.argv[1],'${FINGERPRINT_SALT}',16,(e,k)=>console.log(k.toString('hex').slice(0,8)))" 'VALUE' . ` +
    '`quotedInFile` means the deploy exports the line as-is, so the quotes become part of the running value. ' +
    'A setting missing from the process may still reach the app, which also loads .env.prod itself at startup. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      process: {
        type: 'string',
        default: 'BackendAPI',
        description: 'PM2 process whose running settings to compare with .env.prod (default BackendAPI).',
      },
    },
    additionalProperties: false,
  },
  handler: async ({ process: name = 'BackendAPI' } = {}) => {
    try {
      const result = { checkedAt: new Date().toISOString(), git: await gitState() };

      let processes = [];
      try {
        processes = await readPm2Processes();
        result.processesStartedAt = Object.fromEntries(
          processes.map((p) => [p.name, p.startedAt ? new Date(p.startedAt).toISOString() : null]),
        );
      } catch (err) {
        result.processesError = err.message;
      }

      const fileEnv = readEnvFile();
      if (!fileEnv) {
        result.settingsError = `No env file at ${ENV_FILE}.`;
      } else {
        const proc = processes.find((p) => p.name === name);
        if (!proc && processes.length) result.settingsNote = `No PM2 process named "${name}"; showing the file only.`;
        result.settings = await settingsCheck(fileEnv, proc);
      }

      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return errorResult(err);
    }
  },
};

export const systemTools = [getServerHealth, getDeployInfo];
