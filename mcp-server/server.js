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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolMap.get(request.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
    }
    return tool.handler(request.params.arguments ?? {});
  });

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: SCHEMA_RESOURCE_URI,
        name: 'Aashray Database Schema',
        description:
          'Live database schema merged with business-level annotations. Includes table purposes, column descriptions, status enums, foreign key relationships, and a domain glossary. Read this once at session start — no need to call get_schema.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== SCHEMA_RESOURCE_URI) {
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
    }
    try {
      const text = await buildSchemaResource(executeQuery);
      return {
        contents: [{ uri: SCHEMA_RESOURCE_URI, mimeType: 'application/json', text }],
      };
    } catch (err) {
      throw new McpError(ErrorCode.InternalError, `Failed to build schema resource: ${err.message}`);
    }
  });

  return server;
}
