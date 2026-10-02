import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { PORT, BEARER_TOKEN, DB } from './config.js';
import { bearerAuth } from './auth.js';
import { closePool } from './tools/database.js';
import { createServer, allTools } from './server.js';
import logger from './logger.js';

if (!BEARER_TOKEN) {
  logger.error('startup_failed', { reason: 'MCP_BEARER_TOKEN env var is required' });
  process.exit(1);
}

if (!DB.user || !DB.password) {
  logger.error('startup_failed', { reason: 'MCP_DB_USER and MCP_DB_PASSWORD env vars are required' });
  process.exit(1);
}

const server = createServer();

const app = express();
app.use(express.json());
app.use(bearerAuth);

app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error('mcp_request_exception', { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  } finally {
    await transport.close();
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', tools: allTools.length });
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('uncaught_exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  logger.info('mcp_server_started', { port: PORT, tools: allTools.map(t => t.name) });
});

const shutdown = () => {
  logger.info('mcp_server_shutdown');
  httpServer.close(async () => {
    await closePool();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
