export const PORT = parseInt(process.env.MCP_PORT || '4000', 10);

export const BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

export const LOG_DIR = process.env.LOG_DIR || '/home/ubuntu/logs';

export const DB = {
  host: process.env.MCP_DB_HOST || process.env.DB_HOST,
  port: parseInt(process.env.MCP_DB_PORT || process.env.DB_PORT || '3306', 10),
  user: process.env.MCP_DB_USER,
  password: process.env.MCP_DB_PASSWORD,
  database: process.env.MCP_DB_NAME || process.env.DB_NAME,
};
