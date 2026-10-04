import mysql from 'mysql2/promise';
import { DB } from '../config.js';
import { collectSecretValues, redactText, cap } from '../redact.js';
import { errorResult } from './result.js';
import logger from '../logger.js';
import { loadAnnotations, fetchSchemaRows, buildSchemaIndex, buildSchemaDetail } from '../resources/schema.js';

// One connection config for the pool and the fresh activity connection, so they cannot drift.
const CONNECTION = {
  host: DB.host,
  port: DB.port,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  connectTimeout: 10000,
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...CONNECTION,
      connectionLimit: 3,
      waitForConnections: true,
      queueLimit: 10,
    });
  }
  return pool;
}

async function queryOn(connection, sql, params = []) {
  const [rows] = await connection.execute({ sql, timeout: 5000 }, params);
  return rows;
}

export async function executeQuery(sql, params = []) {
  const connection = await getPool().getConnection();
  try {
    return await queryOn(connection, sql, params);
  } finally {
    connection.release();
  }
}

const MAX_CELL_LEN = 500;

function sanitizeCell(value) {
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  return typeof value === 'string' ? cap(value, MAX_CELL_LEN) : value;
}

// Row objects repeat every column name per row — columnar form drops that repetition,
// which is most of the payload on wide result sets.
function toColumnar(rows) {
  if (!rows.length) return { columns: [], rows: [] };
  const columns = Object.keys(rows[0]);
  return {
    columns,
    rows: rows.map((row) => columns.map((col) => sanitizeCell(row[col]))),
  };
}

async function fetchAllTableNames() {
  const rows = await executeQuery(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
  return rows.map((r) => r.TABLE_NAME);
}

function findSimilarTables(names, target) {
  const needle = target.toLowerCase();
  return names.filter((n) => n.toLowerCase().includes(needle) || needle.includes(n.toLowerCase()));
}

const getSchema = {
  name: 'get_schema',
  description:
    'Returns database schema info via live introspection, merged with business annotations. ' +
    'Call with no arguments for a lightweight index: every table\'s one-line description and column NAMES only (no types/FKs) — use this to decide which tables you need. ' +
    'Call with `tables: ["a","b"]` for full detail on just those tables: column types, nullability, defaults, enum values, primary keys, FK relationships, and per-column annotations. ' +
    'Prefer the schema://aashray resource once at session start for the full database with full detail; use this tool for a mid-session lookup instead of re-reading everything.',
  inputSchema: {
    type: 'object',
    properties: {
      tables: {
        type: 'array',
        items: { type: 'string' },
        description: 'Table names to return full column detail for. Omit for a lightweight whole-database index instead.',
      },
    },
    required: [],
  },
  handler: async ({ tables } = {}) => {
    try {
      const annotations = loadAnnotations();
      const wantsDetail = Boolean(tables && tables.length);
      const { colRows, fkRows } = await fetchSchemaRows(executeQuery, {
        tables: wantsDetail ? tables : undefined,
        includeForeignKeys: wantsDetail, // the index never renders FKs
      });

      if (!wantsDetail) {
        return {
          content: [{ type: 'text', text: JSON.stringify(buildSchemaIndex(colRows, annotations)) }],
        };
      }

      const detail = buildSchemaDetail(colRows, fkRows, annotations);
      const missing = tables.filter((t) => !detail[t]);

      let warning;
      if (missing.length) {
        const names = await fetchAllTableNames();
        warning = missing
          .map((m) => {
            const similar = findSimilarTables(names, m);
            return similar.length ? `"${m}" not found — did you mean: ${similar.join(', ')}?` : `"${m}" not found.`;
          })
          .join(' ');
      }

      const result = warning ? { tables: detail, warning } : { tables: detail };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  },
};

// Matches a trailing top-level LIMIT clause so we only cap the row-count number,
// never a LIMIT living inside a subquery, and never the offset number by mistake.
const TRAILING_LIMIT_RE = /\bLIMIT\s+(\d+)(?:\s*(,)\s*(\d+)|\s+(OFFSET)\s+(\d+))?\s*$/i;

const capNum = (n) => Math.min(parseInt(n, 10), 1000);

function capTrailingLimit(sql) {
  const match = sql.match(TRAILING_LIMIT_RE);
  if (!match) return `${sql}\nLIMIT 1000`;

  const [, n1, comma, n2, offsetKw, n3] = match;
  let replacement;
  if (comma) {
    // LIMIT offset, count — cap count, leave offset alone
    replacement = `LIMIT ${n1}, ${capNum(n2)}`;
  } else if (offsetKw) {
    // LIMIT count OFFSET offset — cap count, leave offset alone
    replacement = `LIMIT ${capNum(n1)} OFFSET ${n3}`;
  } else {
    replacement = `LIMIT ${capNum(n1)}`;
  }
  return sql.slice(0, match.index) + replacement;
}

const queryDb = {
  name: 'query_db',
  description:
    'Executes a SQL query against the Aashray database. The database user has SELECT-only privileges — the DB server will reject INSERT, UPDATE, DELETE, DROP, TRUNCATE, and any other write or DDL statements. SELECT and WITH (CTE) results are capped at 1000 rows; include your own LIMIT clause for smaller sets. SHOW and DESCRIBE are also supported. Read the schema://aashray resource at session start to discover table structure before querying. ' +
    'Results come back columnar as {"columns": [...], "rows": [[...], ...]} — each inner array in `rows` lines up positionally with `columns`, instead of repeating column names per row.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'The SQL query to execute.',
      },
    },
    required: ['sql'],
  },
  handler: async ({ sql }) => {
    const trimmed = sql.trim().replace(/;+$/, '');
    const normalised = trimmed.toUpperCase();

    try {
      const isSelect =
        normalised.startsWith('SELECT') ||
        normalised.startsWith('WITH') ||
        normalised.startsWith('(');
      const safeSql = isSelect ? capTrailingLimit(trimmed) : trimmed;

      const rows = await executeQuery(safeSql);
      return {
        content: [{ type: 'text', text: JSON.stringify(toColumnar(rows)) }],
      };
    } catch (err) {
      logger.error('query_db_error', { error: err.message, sql: sql.slice(0, 300) });

      let hint = '';
      // "Table 'db.foo' doesn't exist" → suggest similar table names
      const tableMatch = err.message.match(/Table '[\w.]*?\.(\w+)' doesn't exist/i);
      if (tableMatch) {
        try {
          const names = await fetchAllTableNames();
          const similar = findSimilarTables(names, tableMatch[1]);
          hint = similar.length ? ` Did you mean one of: ${similar.join(', ')}?` : ` Available tables: ${names.join(', ')}.`;
        } catch (_) { /* ignore */ }
      }

      // "Unknown column 'foo'" → include the table's actual columns if identifiable
      const colMatch = err.message.match(/Unknown column '([^']+)'/i);
      if (colMatch && !hint) {
        const fromMatch = sql.match(/\bFROM\s+`?(\w+)`?/i);
        if (fromMatch) {
          try {
            const cols = await executeQuery(
              `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
              [fromMatch[1]]
            );
            if (cols.length) hint = ` Columns in ${fromMatch[1]}: ${cols.map((c) => c.COLUMN_NAME).join(', ')}.`;
          } catch (_) { /* ignore */ }
        }
      }

      return {
        isError: true,
        content: [{ type: 'text', text: `Database error: ${err.message}${hint}` }],
      };
    }
  },
};

const getTableSample = {
  name: 'get_table_sample',
  description:
    'Returns a sample of rows from the specified table (default 10, max 50). Useful for understanding data shape and realistic values before writing a full query. Read-only — the DB user has SELECT-only privileges. ' +
    'Results come back columnar as {"columns": [...], "rows": [[...], ...]} — each inner array in `rows` lines up positionally with `columns`, instead of repeating column names per row.',
  inputSchema: {
    type: 'object',
    properties: {
      table: {
        type: 'string',
        description: 'The name of the table to sample.',
      },
      limit: {
        type: 'integer',
        description: 'Number of rows to return (default 10, max 50).',
        default: 10,
        minimum: 1,
        maximum: 50,
      },
    },
    required: ['table'],
  },
  handler: async ({ table, limit = 10 }) => {
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Invalid table name. Only alphanumeric characters and underscores are allowed.',
          },
        ],
      };
    }

    const rowLimit = Math.min(Math.max(1, parseInt(limit, 10) || 10), 50);

    try {
      const rows = await executeQuery(`SELECT * FROM \`${table}\` LIMIT ${rowLimit}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(toColumnar(rows)) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  },
};

// Without PROCESS, MySQL quietly shows only this server's own connections, which
// reads as "nothing running" — so detect the missing grants and say so instead.
async function missingActivityGrants(run) {
  const missing = [];
  for (const [privilege, probe] of [
    ['PROCESS ON *.*', 'SELECT 1 FROM information_schema.INNODB_TRX LIMIT 1'],
    ['SELECT ON performance_schema.*', 'SELECT 1 FROM performance_schema.data_lock_waits LIMIT 1'],
  ]) {
    try {
      await run(probe);
    } catch (err) {
      if (!/denied/i.test(err.message)) throw err;
      missing.push(privilege);
    }
  }
  if (!missing.length) return null;
  const [{ me }] = await run('SELECT CURRENT_USER() AS me');
  const at = me.lastIndexOf('@');
  const account = `'${me.slice(0, at)}'@'${me.slice(at + 1)}'`;
  return missing.map((privilege) => `GRANT ${privilege} TO ${account};`);
}

// Other sessions' SQL can contain secrets (tokens in WHERE clauses, passwords in
// INSERTs), so every SQL text goes through the same redaction as the logs.
function redactColumns(rows, columns, secrets) {
  return rows.map((row) => {
    const copy = { ...row };
    for (const col of columns) {
      if (typeof copy[col] === 'string') copy[col] = redactText(copy[col], secrets, MAX_CELL_LEN);
    }
    return copy;
  });
}

// Redact line by line, and cut only after redaction so a secret straddling the cut cannot leave a partial value behind.
function latestDeadlock(innodbStatus, secrets) {
  const match = innodbStatus.match(/LATEST DETECTED DEADLOCK\n-+\n([\s\S]*?)\n-+\nTRANSACTIONS/);
  if (!match) return null;
  return cap(match[1].split('\n').map((line) => redactText(line, secrets, 4000)).join('\n'), 4000);
}

// Deliberately longer than the MAX_CELL_LEN shown: redaction must see whole secrets at the cut.
const ACTIVITY_SQL_LEN = 4000;

const getDbActivity = {
  name: 'get_db_activity',
  description:
    'What the production MySQL server is doing right now: connection counts by user and state, queries currently running (longest first), open transactions with their age — including ones idle while still holding locks — which transaction is blocking which on a row lock, and the most recent deadlock InnoDB recorded. ' +
    'Use it for "the app is hanging", lock-wait timeouts, deadlocks, or two bookings racing for the same row. Needs the PROCESS privilege and SELECT on performance_schema; without them it returns the exact GRANT statements a MySQL admin must run. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      minSeconds: {
        type: 'integer',
        default: 0,
        minimum: 0,
        description: 'Only list queries and transactions that have been running at least this many seconds (default 0).',
      },
    },
    additionalProperties: false,
  },
  handler: async ({ minSeconds = 0 } = {}) => {
    try {
      // A global grant like PROCESS only reaches connections opened after it, and the
      // pool keeps its connections for the life of the process — so use a fresh one, or
      // an admin's GRANT would not show up here until the next deploy.
      const connection = await mysql.createConnection(CONNECTION);
      try {
        const run = (sql, params) => queryOn(connection, sql, params);
        const grants = await missingActivityGrants(run);
        if (grants) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `The MCP database user cannot see other connections. A MySQL admin needs to run:\n${grants.join('\n')}`,
            }],
          };
        }

        const min = Math.max(0, parseInt(minSeconds, 10) || 0);
        const connections = await run(
          `SELECT USER AS user, COMMAND AS command, COUNT(*) AS count
             FROM information_schema.PROCESSLIST
            GROUP BY USER, COMMAND
            ORDER BY count DESC`,
        );
        const running = await run(
          `SELECT ID AS id, USER AS user, DB AS db, TIME AS seconds, STATE AS state, LEFT(INFO, ${ACTIVITY_SQL_LEN}) AS query
             FROM information_schema.PROCESSLIST
            WHERE COMMAND NOT IN ('Sleep', 'Daemon', 'Binlog Dump') AND ID <> CONNECTION_ID() AND TIME >= ?
            ORDER BY TIME DESC
            LIMIT 50`,
          [min],
        );
        const transactions = await run(
          `SELECT t.trx_id AS trxId, t.trx_mysql_thread_id AS connectionId, p.USER AS user,
                  t.trx_state AS state, t.trx_started AS startedAt,
                  TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) AS ageSeconds,
                  p.COMMAND = 'Sleep' AS idleInTransaction,
                  t.trx_rows_locked AS rowsLocked, t.trx_tables_locked AS tablesLocked,
                  LEFT(t.trx_query, ${ACTIVITY_SQL_LEN}) AS query
             FROM information_schema.INNODB_TRX t
             LEFT JOIN information_schema.PROCESSLIST p ON p.ID = t.trx_mysql_thread_id
            WHERE t.trx_mysql_thread_id <> CONNECTION_ID()
              AND TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) >= ?
            ORDER BY t.trx_started
            LIMIT 50`,
          [min],
        );
        const lockWaits = await run(
          `SELECT r.trx_mysql_thread_id AS waitingConnection,
                  TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS waitingSeconds,
                  LEFT(r.trx_query, ${ACTIVITY_SQL_LEN}) AS waitingQuery,
                  b.trx_mysql_thread_id AS blockingConnection,
                  LEFT(b.trx_query, ${ACTIVITY_SQL_LEN}) AS blockingQuery,
                  l.OBJECT_NAME AS tableName, l.INDEX_NAME AS indexName, l.LOCK_MODE AS lockMode
             FROM performance_schema.data_lock_waits w
             JOIN information_schema.INNODB_TRX r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
             JOIN information_schema.INNODB_TRX b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID
             JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID
            ORDER BY waitingSeconds DESC
            LIMIT 50`,
        );
        // Best effort: a failure here must not lose the rest of the result.
        let status = null;
        try { [status] = await run('SHOW ENGINE INNODB STATUS'); } catch { status = null; }
        const secrets = collectSecretValues(); // env file + MCP's own credentials; no pm2 call

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              checkedAt: new Date().toISOString(),
              connections: toColumnar(connections),
              running: toColumnar(redactColumns(running, ['query'], secrets)),
              openTransactions: toColumnar(redactColumns(transactions, ['query'], secrets)),
              lockWaits: toColumnar(redactColumns(lockWaits, ['waitingQuery', 'blockingQuery'], secrets)),
              latestDeadlock: status ? latestDeadlock(status.Status, secrets) : null,
            }),
          }],
        };
      } finally {
        await connection.end().catch(() => connection.destroy());
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Database error: ${err.message}` }],
      };
    }
  },
};

export async function closePool() {
  if (pool) await pool.end();
}

export const dbTools = [getSchema, queryDb, getTableSample, getDbActivity];
