import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { PORT, BEARER_TOKEN } from './config.js';
import { bearerAuth } from './auth.js';
import { closePool } from './tools/database.js';
import { createServer, allTools } from './server.js';

if (!BEARER_TOKEN) {
  process.stderr.write('FATAL: MCP_BEARER_TOKEN env var is required\n');
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
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  process.exit(1);
});

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`MCP server listening on port ${PORT}\n`);
});

const shutdown = () => {
  httpServer.close(async () => {
    await closePool();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
