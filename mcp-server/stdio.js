import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closePool } from './tools/database.js';
import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);

process.on('SIGTERM', async () => { await closePool(); process.exit(0); });
process.on('SIGINT', async () => { await closePool(); process.exit(0); });
