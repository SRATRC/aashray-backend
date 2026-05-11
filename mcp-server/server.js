import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { logTools } from './tools/logs.js';
import { dbTools } from './tools/database.js';

export const allTools = [...logTools, ...dbTools];
const toolMap = new Map(allTools.map(t => [t.name, t]));

export function createServer() {
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

  return server;
}
