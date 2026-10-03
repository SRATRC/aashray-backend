import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { logTools } from './tools/logs.js';
import { dbTools, executeQuery } from './tools/database.js';
import { SCHEMA_RESOURCE_URI, buildSchemaResource } from './resources/schema.js';
import logger from './logger.js';

export const allTools = [...logTools, ...dbTools];
const toolMap = new Map(allTools.map(t => [t.name, t]));


export function createServer() {
  const server = new Server(
    { name: 'aashray-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: allTools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  const SLOW_TOOL_MS = 3000;

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tool = toolMap.get(name);

    if (!tool) {
      logger.warn('tool_not_found', { tool: name });
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }

    const start = Date.now();
    try {
      const result = await tool.handler(args);
      const durationMs = Date.now() - start;

      if (result?.isError) {
        logger.warn('tool_error', { tool: name, durationMs, message: result?.content?.[0]?.text?.slice(0, 300) });
      } else if (durationMs > SLOW_TOOL_MS) {
        logger.warn('tool_slow', { tool: name, durationMs });
      }

      return result;
    } catch (err) {
      logger.error('tool_exception', { tool: name, durationMs: Date.now() - start, error: err.message, stack: err.stack });
      throw err;
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: SCHEMA_RESOURCE_URI,
        name: 'Aashray Database Schema',
        description:
          'Live database schema merged with business-level annotations — table purposes, column descriptions, status enums, foreign key relationships, and a domain glossary. This MCP has read-only DB access; the schema reflects the live DB structure but cannot be modified through this server. Read this once at session start instead of calling get_schema.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri !== SCHEMA_RESOURCE_URI) {
      logger.warn('resource_not_found', { uri });
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    }

    try {
      const text = await buildSchemaResource(executeQuery);
      return {
        contents: [{ uri, mimeType: 'application/json', text }],
      };
    } catch (err) {
      logger.error('schema_resource_error', { error: err.message });
      throw new McpError(ErrorCode.InternalError, `Failed to build schema resource: ${err.message}`);
    }
  });

  return server;
}
