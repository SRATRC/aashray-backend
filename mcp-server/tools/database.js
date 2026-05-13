import mysql from 'mysql2/promise';
import { DB } from '../config.js';
import logger from '../logger.js';

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

const getSchema = {
  name: 'get_schema',
  description:
    'Returns the live database schema with column types, nullability, defaults, enum values, primary keys, and FK relationships — merged with business annotations (table purposes, column meanings, status flows). Read-only introspection via information_schema; cannot modify the schema. Prefer the schema://aashray MCP resource at session start to avoid a round-trip; use this tool only when you need a mid-session schema refresh.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_args) => {
    try {
      const [colRows, fkRows] = await Promise.all([
        executeQuery(
          `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
                  COLUMN_DEFAULT, COLUMN_KEY
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
           ORDER BY TABLE_NAME, ORDINAL_POSITION`
        ),
        executeQuery(
          `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE()
             AND REFERENCED_TABLE_NAME IS NOT NULL`
        ),
      ]);

      // Build FK lookup: "table.column" -> "ref_table.ref_column"
      const fkMap = {};
      for (const fk of fkRows) {
        fkMap[`${fk.TABLE_NAME}.${fk.COLUMN_NAME}`] = `${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`;
      }

      const schema = {};
      for (const row of colRows) {
        const table = row.TABLE_NAME;
        if (!schema[table]) schema[table] = { columns: [], foreignKeys: [] };

        const col = {
          column: row.COLUMN_NAME,
          type: row.DATA_TYPE,
          nullable: row.IS_NULLABLE === 'YES',
        };

        if (row.COLUMN_DEFAULT !== null) col.default = row.COLUMN_DEFAULT;
        if (row.COLUMN_KEY === 'PRI') col.primaryKey = true;

        // Expand enum/set values from COLUMN_TYPE e.g. "enum('a','b')"
        if (row.DATA_TYPE === 'enum' || row.DATA_TYPE === 'set') {
          const match = row.COLUMN_TYPE.match(/^(?:enum|set)\((.+)\)$/i);
          if (match) col.values = match[1].replace(/'/g, '').split(',');
        }

        const fkRef = fkMap[`${table}.${row.COLUMN_NAME}`];
        if (fkRef) col.references = fkRef;

        schema[table].columns.push(col);
      }

      // Attach FK summary per table for quick join lookup
      for (const fk of fkRows) {
        const entry = schema[fk.TABLE_NAME];
        if (entry) {
          entry.foreignKeys.push(`${fk.COLUMN_NAME} → ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
};

const queryDb = {
  name: 'query_db',
  description:
    'Executes a SQL query against the Aashray database. The database user has SELECT-only privileges — the DB server will reject INSERT, UPDATE, DELETE, DROP, TRUNCATE, and any other write or DDL statements. SELECT and WITH (CTE) results are capped at 1000 rows; include your own LIMIT clause for smaller sets. SHOW and DESCRIBE are also supported. Read the schema://aashray resource at session start to discover table structure before querying.',
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
      let safeSql = trimmed;
      const isSelect =
        normalised.startsWith('SELECT') ||
        normalised.startsWith('WITH') ||
        normalised.startsWith('(');
      const hasTopLevelLimit = /\bLIMIT\s+\d+(\s*,\s*\d+|\s+OFFSET\s+\d+)?\s*$/i.test(trimmed);
      if (isSelect && !hasTopLevelLimit) {
        safeSql = `${trimmed}\nLIMIT 1000`;
      }
      safeSql = safeSql.replace(/\bLIMIT\s+(\d+)/gi, (_, n) => `LIMIT ${Math.min(parseInt(n, 10), 1000)}`);
      const rows = await executeQuery(safeSql);
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
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
    'Returns a sample of rows from the specified table (default 10, max 50). Useful for understanding data shape and realistic values before writing a full query. Read-only — the DB user has SELECT-only privileges.',
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
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
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
