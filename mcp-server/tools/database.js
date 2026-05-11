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

async function executeQuery(sql, params = []) {
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
    'Returns the full database schema for the connected MySQL database, grouped by table name. Each table lists its columns with their type and nullability. Use this before writing queries to understand the available tables and fields.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async (_args) => {
    try {
      const rows = await executeQuery(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME, ORDINAL_POSITION`
      );

      const schema = {};
      for (const row of rows) {
        const table = row.TABLE_NAME;
        if (!schema[table]) schema[table] = [];
        schema[table].push({
          column: row.COLUMN_NAME,
          type: row.DATA_TYPE,
          nullable: row.IS_NULLABLE === 'YES',
        });
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
      return {
        isError: true,
        content: [{ type: 'text', text: `Database error: ${err.message}` }],
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
