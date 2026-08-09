import mysql from 'mysql2/promise';
import { DB } from '../config.js';
import logger from '../logger.js';
import { loadAnnotations, fetchSchemaRows, buildSchemaIndex, buildSchemaDetail } from '../resources/schema.js';

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: DB.host,
      port: DB.port,
      user: DB.user,
      password: DB.password,
      database: DB.database,
      connectionLimit: 3,
      connectTimeout: 10000,
      waitForConnections: true,
      queueLimit: 10,
    });
  }
  return pool;
}

export async function executeQuery(sql, params = []) {
  const connection = await getPool().getConnection();
  try {
    const [rows] = await connection.execute({ sql, timeout: 5000 }, params);
    return rows;
  } finally {
    connection.release();
  }
}

const MAX_CELL_LEN = 500;

function sanitizeCell(value) {
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  if (typeof value === 'string' && value.length > MAX_CELL_LEN) {
    return `${value.slice(0, MAX_CELL_LEN)}… (truncated, ${value.length} chars total)`;
  }
  return value;
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
        const allTables = await executeQuery(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
        const names = allTables.map((r) => r.TABLE_NAME);
        warning = missing
          .map((m) => {
            const target = m.toLowerCase();
            const similar = names.filter((n) => n.toLowerCase().includes(target) || target.includes(n.toLowerCase()));
            return similar.length ? `"${m}" not found — did you mean: ${similar.join(', ')}?` : `"${m}" not found.`;
          })
          .join(' ');
      }

      const result = warning ? { tables: detail, warning } : { tables: detail };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
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
          const tables = await executeQuery(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`);
          const names = tables.map((r) => r.TABLE_NAME);
          const target = tableMatch[1].toLowerCase();
          const similar = names.filter((n) => n.toLowerCase().includes(target) || target.includes(n.toLowerCase()));
          if (similar.length) hint = ` Did you mean one of: ${similar.join(', ')}?`;
          else hint = ` Available tables: ${names.join(', ')}.`;
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

    const cap = Math.min(Math.max(1, parseInt(limit, 10) || 10), 50);

    try {
      const rows = await executeQuery(`SELECT * FROM \`${table}\` LIMIT ${cap}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(toColumnar(rows)) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

export async function closePool() {
  if (pool) await pool.end();
}

export const dbTools = [getSchema, queryDb, getTableSample];
