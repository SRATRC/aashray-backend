import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { LOG_DIR } from '../config.js';

function resolveLogFile(prefix, date) {
  const plain = path.join(LOG_DIR, `${prefix}-${date}.log`);
  const gzipped = `${plain}.gz`;
  if (fs.existsSync(plain)) return { filePath: plain, compressed: false };
  if (fs.existsSync(gzipped)) return { filePath: gzipped, compressed: true };
  return null;
}

// Yields raw lines, unparsed. Callers JSON.parse only the lines they actually
// keep, instead of parsing every line in the file up front.
async function* readRawLines(filePath, compressed) {
  const raw = fs.createReadStream(filePath);

  await new Promise((resolve, reject) => {
    raw.once('ready', resolve);
    raw.once('error', reject);
  });

  let source = raw;
  if (compressed) {
    const gunzip = zlib.createGunzip();
    raw.on('error', (err) => gunzip.destroy(err));
    source = raw.pipe(gunzip);
  }
  const rl = readline.createInterface({ input: source, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  } catch (err) {
    throw new Error(`Error reading log file "${filePath}": ${err.message}`);
  } finally {
    rl.close();
    raw.destroy();
  }
}

// Fixed-capacity "keep the last N pushed" buffer, O(1) per push instead of
// the O(n) array-shift this replaced.
function makeRing(capacity) {
  const buf = new Array(capacity);
  let count = 0;
  let idx = 0;
  return {
    push(item) {
      buf[idx] = item;
      idx = (idx + 1) % capacity;
      if (count < capacity) count += 1;
    },
    toArray() {
      if (count < capacity) return buf.slice(0, count);
      return [...buf.slice(idx), ...buf.slice(0, idx)];
    },
  };
}

function parseLines(rawLines) {
  const out = [];
  for (const line of rawLines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed lines silently
    }
  }
  return out;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

// Shared shape behind get_recent_logs/search_logs/get_error_logs: stream raw
// lines, reject on cheap raw text before paying for JSON.parse, keep the last
// `capacity` survivors. With no tests at all, skips parsing entirely except
// for the lines actually kept.
async function collectLogs(filePath, compressed, capacity, { rawTest, parsedTest } = {}) {
  const ring = makeRing(capacity);

  if (!rawTest && !parsedTest) {
    for await (const line of readRawLines(filePath, compressed)) {
      ring.push(line);
    }
    return parseLines(ring.toArray());
  }

  for await (const line of readRawLines(filePath, compressed)) {
    if (rawTest && !rawTest(line)) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsedTest && !parsedTest(entry)) continue;
    ring.push(entry);
  }
  return ring.toArray();
}

const getRecentLogs = {
  name: 'get_recent_logs',
  description:
    "Returns the last N entries from today's application log (default 50, max 500). Optionally filter by level. Read-only — cannot modify or clear logs. Log entries are JSON objects with fields: timestamp, level, message, correlationId, userId, and any request-scoped context added by the application. For historical dates or keyword search, use search_logs instead.",
  inputSchema: {
    type: 'object',
    properties: {
      n: {
        type: 'integer',
        description: 'Number of log entries to return (default 50, max 500).',
        default: 50,
        minimum: 1,
        maximum: 500,
      },
      level: {
        type: 'string',
        description: 'Filter by log level.',
        enum: ['error', 'warn', 'info', 'http', 'debug'],
      },
    },
    additionalProperties: false,
  },
  handler: async ({ n = 50, level } = {}) => {
    try {
      const limit = Math.min(Math.max(1, n), 500);
      const date = todayDate();
      const resolved = resolveLogFile('application', date);

      if (!resolved) {
        return {
          content: [{ type: 'text', text: `No application log found for ${date} in ${LOG_DIR}.` }],
        };
      }

      const entries = await collectLogs(resolved.filePath, resolved.compressed, limit, level
        ? { rawTest: (line) => line.includes(level), parsedTest: (entry) => entry.level === level }
        : {});

      return {
        content: [{ type: 'text', text: JSON.stringify(entries) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

const searchLogs = {
  name: 'search_logs',
  description:
    "Searches a single day's application log for entries matching the given filters (all ANDed). Supports keyword substring match, level, userId, correlationId, and date (defaults to today). Read-only — cannot modify logs. Returns up to 500 matches; when more entries match, only the last N (most recent) are returned. For bulk tailing without filters, prefer get_recent_logs.",
  inputSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'Substring to match anywhere in the serialised log entry.',
      },
      level: {
        type: 'string',
        description: 'Filter by log level.',
        enum: ['error', 'warn', 'info', 'http', 'debug'],
      },
      userId: {
        type: 'string',
        description: 'Filter by userId field.',
      },
      correlationId: {
        type: 'string',
        description: 'Filter by correlationId field.',
      },
      date: {
        type: 'string',
        description: 'Date to search in YYYY-MM-DD format (defaults to today).',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of matching entries to return (default 100, max 500).',
        default: 100,
        minimum: 1,
        maximum: 500,
      },
    },
    additionalProperties: false,
  },
  handler: async ({ keyword, level, userId, correlationId, date, limit = 100 } = {}) => {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { content: [{ type: 'text', text: 'Invalid date format. Use YYYY-MM-DD.' }], isError: true };
    }
    try {
      const cap = Math.min(Math.max(1, limit), 500);
      const targetDate = date || todayDate();
      const resolved = resolveLogFile('application', targetDate);

      if (!resolved) {
        return {
          content: [{ type: 'text', text: `No application log found for ${targetDate} in ${LOG_DIR}.` }],
        };
      }

      const hasFilter = Boolean(keyword || level || userId || correlationId);
      const userIdStr = userId && String(userId);
      const correlationIdStr = correlationId && String(correlationId);

      const entries = await collectLogs(resolved.filePath, resolved.compressed, cap, hasFilter
        ? {
            // Cheap raw-text rejects first — parsing is the expensive part.
            rawTest: (line) =>
              (!keyword || line.includes(keyword)) &&
              (!level || line.includes(level)) &&
              (!userIdStr || line.includes(userIdStr)) &&
              (!correlationIdStr || line.includes(correlationIdStr)),
            parsedTest: (entry) =>
              (!level || entry.level === level) &&
              (!userId || entry.userId === userId) &&
              (!correlationId || entry.correlationId === correlationId),
          }
        : {});

      return {
        content: [{ type: 'text', text: JSON.stringify(entries) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

const getErrorLogs = {
  name: 'get_error_logs',
  description:
    'Returns the last N entries from the dedicated error log for a given date (defaults to today, max 200). Contains only error-level entries — use get_recent_logs or search_logs for other levels. Read-only — cannot modify or clear logs.',
  inputSchema: {
    type: 'object',
    properties: {
      n: {
        type: 'integer',
        description: 'Number of error log entries to return (default 50, max 200).',
        default: 50,
        minimum: 1,
        maximum: 200,
      },
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format (defaults to today).',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      },
    },
    additionalProperties: false,
  },
  handler: async ({ n = 50, date } = {}) => {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { content: [{ type: 'text', text: 'Invalid date format. Use YYYY-MM-DD.' }], isError: true };
    }
    try {
      const limit = Math.min(Math.max(1, n), 200);
      const targetDate = date || todayDate();
      const resolved = resolveLogFile('error', targetDate);

      if (!resolved) {
        return {
          content: [{ type: 'text', text: `No error log found for ${targetDate} in ${LOG_DIR}.` }],
        };
      }

      const entries = await collectLogs(resolved.filePath, resolved.compressed, limit);

      return {
        content: [{ type: 'text', text: JSON.stringify(entries) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

export const logTools = [getRecentLogs, searchLogs, getErrorLogs];
