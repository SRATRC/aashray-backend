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

async function* readLines(filePath, compressed) {
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
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // skip malformed lines silently
      }
    }
  } catch (err) {
    throw new Error(`Error reading log file "${filePath}": ${err.message}`);
  } finally {
    rl.close();
    raw.destroy();
  }
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
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
          content: [
            {
              type: 'text',
              text: `No application log found for ${date} in ${LOG_DIR}.`,
            },
          ],
        };
      }

      const buf = [];
      for await (const entry of readLines(resolved.filePath, resolved.compressed)) {
        if (level && entry.level !== level) continue;
        if (buf.length >= limit) buf.shift();
        buf.push(entry);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(buf, null, 2),
          },
        ],
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
          content: [
            {
              type: 'text',
              text: `No application log found for ${targetDate} in ${LOG_DIR}.`,
            },
          ],
        };
      }

      const buf = [];
      for await (const entry of readLines(resolved.filePath, resolved.compressed)) {
        if (level && entry.level !== level) continue;
        if (userId && entry.userId !== userId) continue;
        if (correlationId && entry.correlationId !== correlationId) continue;
        if (keyword) {
          const serialised = JSON.stringify(entry);
          if (!serialised.includes(keyword)) continue;
        }
        if (buf.length >= cap) buf.shift();
        buf.push(entry);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(buf, null, 2),
          },
        ],
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
          content: [
            {
              type: 'text',
              text: `No error log found for ${targetDate} in ${LOG_DIR}.`,
            },
          ],
        };
      }

      const buf = [];
      for await (const entry of readLines(resolved.filePath, resolved.compressed)) {
        if (buf.length >= limit) buf.shift();
        buf.push(entry);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(buf, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
export const logTools = [getRecentLogs, searchLogs, getErrorLogs];
