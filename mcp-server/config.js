const _port = parseInt(process.env.MCP_PORT || '4000', 10);
export const PORT = Number.isNaN(_port) ? 4000 : _port;

export const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

export const LOG_DIR = process.env.LOG_DIR || '/home/ubuntu/logs';

const _dbPort = parseInt(process.env.MCP_DB_PORT || process.env.DB_PORT || '3306', 10);

export const DB = {
  host: process.env.MCP_DB_HOST || process.env.DB_HOST,
  port: Number.isNaN(_dbPort) ? 3306 : _dbPort,
  user: process.env.MCP_DB_USER,
  password: process.env.MCP_DB_PASSWORD,
  database: process.env.MCP_DB_NAME || process.env.DB_NAME,
};
