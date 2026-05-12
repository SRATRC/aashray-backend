import mysql from 'mysql2/promise';
import { DB } from '../config.js';

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
    'Returns the live database schema with column types, nullability, defaults, enum values, primary keys, and FK relationships — also merged with business annotations (table purposes, column meanings, status flows). Prefer reading the schema://aashray MCP Resource at session start instead of calling this tool each time, as the resource avoids a round-trip. Use this tool when you need to refresh the schema mid-session or the resource is unavailable.',
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
    'Executes a read-only SQL query against the database. Only SELECT, SHOW, DESCRIBE, and WITH (CTE) statements are permitted. Use get_schema first to understand the available tables. Returns the result rows as JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'The SQL query to execute. Must start with SELECT, SHOW, DESCRIBE, or WITH.',
      },
    },
    required: ['sql'],
  },
  handler: async ({ sql }) => {
    const normalised = sql.trim().toUpperCase();

    if (normalised.includes(';')) {
      return { content: [{ type: 'text', text: 'Multi-statement queries are not allowed.' }], isError: true };
    }

    const allowed =
      normalised.startsWith('SELECT') ||
      normalised.startsWith('SHOW') ||
      normalised.startsWith('DESCRIBE') ||
      normalised.startsWith('WITH');

    if (!allowed) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Only SELECT, SHOW, DESCRIBE, and WITH statements are permitted. The provided query was rejected without execution.',
          },
        ],
      };
    }

    try {
      let safeSql = sql;
      if (normalised.startsWith('SELECT') && !/\bLIMIT\b/i.test(sql)) {
        safeSql = `${sql}\nLIMIT 1000`;
      }
      safeSql = safeSql.replace(/\bLIMIT\s+(\d+)/i, (_, n) => `LIMIT ${Math.min(parseInt(n, 10), 1000)}`);
      const rows = await executeQuery(safeSql);
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
      };
    } catch (err) {
      process.stderr.write(`query_db error: ${err.message}\n`);

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
    'Returns a sample of rows from the specified table. Useful for understanding the shape and content of data without writing a full query. Limit defaults to 10 and is capped at 50.',
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
