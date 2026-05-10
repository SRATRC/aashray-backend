import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { PORT, BEARER_TOKEN } from './config.js';
import { bearerAuth } from './auth.js';
import { logTools } from './tools/logs.js';
import { dbTools } from './tools/database.js';

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------
if (!BEARER_TOKEN) {
  process.stderr.write('FATAL: MCP_BEARER_TOKEN env var is required\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build tool registry
// ---------------------------------------------------------------------------
const allTools = [...logTools, ...dbTools];
const toolMap = new Map(allTools.map(t => [t.name, t]));

// ---------------------------------------------------------------------------
// Build MCP server (low-level) with manual tool handlers
// ---------------------------------------------------------------------------
const server = new Server(
  { name: 'aashray-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: allTools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name);
  if (!tool) {
    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
  }
  return tool.handler(request.params.arguments ?? {});
});

// ---------------------------------------------------------------------------
// Express HTTP server
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(bearerAuth);

app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', tools: allTools.length });
});

// ---------------------------------------------------------------------------
// Start listening
// ---------------------------------------------------------------------------
const httpServer = app.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`MCP server listening on port ${PORT}\n`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const shutdown = () => httpServer.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  process.exit(1);
});
