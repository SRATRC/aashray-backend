# Aashray MCP Server

A standalone HTTP server that implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), giving AI agents (Claude Code, Cursor, etc.) structured, read-only access to the application's logs and database.

## What is MCP?

MCP is a protocol that lets AI assistants call tools defined by your server — the same way a browser calls an API. When you or a teammate asks Claude "why did this booking fail?", Claude can call `get_error_logs` and `query_db` directly instead of you copy-pasting log snippets into the chat.

## How it fits into the stack

```
Engineer's Claude Code
       │
       │  POST /mcp  (Bearer token)
       ▼
  MCP Server :4000          (this service, PM2 process: MCPServer)
   ├── tools/logs.js   ──── reads /home/ubuntu/logs/*.log[.gz]
   └── tools/database.js ── connects to MySQL (read-only user)

Main Backend              (PM2 process: BackendAPI)
Cron Job                  (PM2 process: CronJob)
```

The MCP server runs as a third PM2 process on the same Ubuntu server alongside the backend and cron job. It does not share code or process memory with the main app — it's a fully separate Node.js process.

---

## Tools

### Log tools (`tools/logs.js`)

Log files are JSON-lines format (one JSON object per line), stored in `LOG_DIR`. The current day's file is uncompressed; older files are gzipped. The tools handle both transparently.

| Tool | What it does |
|---|---|
| `get_recent_logs` | Returns the last N entries from **today's** `application-YYYY-MM-DD.log`. Optional `level` filter. |
| `search_logs` | Searches a single day's application log. Filters: `keyword`, `level`, `userId`, `correlationId`, `date`. Returns the most-recent matching entries. |
| `get_error_logs` | Returns the last N entries from the `error-YYYY-MM-DD.log` file (errors only, separate file from the main log). |

**Example: trace a crash using `correlationId`**

Every HTTP request in the main app gets a unique `correlationId` (set in `middleware/Logger.js`). If Sentry gives you a request ID, pass it to `search_logs` to get the full lifecycle of that request — what came in, what was called, what failed.

### Database tools (`tools/database.js`)

Connects with a dedicated read-only MySQL user (`mcp_readonly`). Pool is limited to 3 connections with a 5-second query timeout.

| Tool | What it does |
|---|---|
| `get_schema` | Returns all tables and their columns (name, type, nullable). Use this first before writing any query. |
| `query_db` | Executes a `SELECT`, `SHOW`, or `DESCRIBE` statement. Auto-appends `LIMIT 1000` if no `LIMIT` clause is present. Multi-statement queries (`;`) are rejected. |
| `get_table_sample` | Returns up to 50 rows from any table — useful for understanding data shape without writing a query. |

---

## Security

| Concern | How it's handled |
|---|---|
| Authentication | Every request requires `Authorization: Bearer <token>`. Token compared with `crypto.timingSafeEqual` (prevents timing attacks). |
| DB write protection | Dedicated read-only MySQL user — `GRANT SELECT` only. The MCP server never uses the main app's DB credentials. |
| SQL injection | `query_db` allowlists statement type (SELECT/SHOW/DESCRIBE). `get_table_sample` validates table names against `/^[a-zA-Z0-9_]+$/`. Queries use prepared statements via `connection.execute()`. |
| Multi-statement attacks | Any query containing `;` is rejected before execution. |
| Path traversal | `date` parameters are validated against `^\d{4}-\d{2}-\d{2}$` before being used in file paths. |
| Query cost | 5-second query timeout. Automatic `LIMIT 1000` on unbounded `SELECT` queries. |

---

## Configuration

All configuration is via environment variables. These must be present in `.env.prod` (added to the `PROD_ENV_FILE` GitHub secret).

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_BEARER_TOKEN` | **Yes** | — | Static Bearer token. Generate with `openssl rand -hex 32`. Process exits at startup if missing. |
| `MCP_PORT` | No | `4000` | Port the MCP server listens on. |
| `LOG_DIR` | No | `/home/ubuntu/logs` | Directory where log files are stored. Shared with the main app. |
| `MCP_DB_USER` | **Yes** | — | Read-only MySQL username (`mcp_readonly`). |
| `MCP_DB_PASSWORD` | **Yes** | — | Password for the read-only MySQL user. |
| `MCP_DB_HOST` | No | Falls back to `DB_HOST` | MySQL host. |
| `MCP_DB_PORT` | No | Falls back to `DB_PORT` or `3306` | MySQL port. |
| `MCP_DB_NAME` | No | Falls back to `DB_NAME` | Database name. |
| `APP_CWD` | No | `/home/ubuntu/actions-runner-api/_work/aashray-backend/aashray-backend` | Override the PM2 working directory (useful for non-standard deployments). |

---

## File structure

```
mcp-server/
├── index.js          Entry point. Wires Express + MCP SDK + tools. Handles startup validation and graceful shutdown.
├── auth.js           Bearer token middleware. Applied to all routes.
├── config.js         Single source of truth for all env vars.
├── package.json      Separate package — own dependencies, own node_modules.
└── tools/
    ├── logs.js       Log reading tools. Streams files with readline + zlib. Cleans up file descriptors on error.
    └── database.js   Database tools. Lazy connection pool. All connections released in finally blocks.
```

---

## Local development

**1. Create `mcp-server/.env`** (already gitignored):

```
MCP_PORT=4000
MCP_BEARER_TOKEN=local-dev-token

LOG_DIR=../logs

MCP_DB_HOST=localhost
MCP_DB_PORT=3306
MCP_DB_NAME=aashray
MCP_DB_USER=root
MCP_DB_PASSWORD=<your local root password>
```

`LOG_DIR=../logs` points to the `logs/` folder at the project root, which already has local log files from past dev sessions.

**2. Start the server:**

```bash
cd mcp-server
npm run dev
# MCP server listening on port 4000
```

**3. Verify it's working:**

```bash
# Health check
curl http://localhost:4000/health -H "Authorization: Bearer local-dev-token"
# → {"status":"ok","tools":6}

# Call a tool
curl -X POST http://localhost:4000/mcp \
  -H "Authorization: Bearer local-dev-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_recent_logs","arguments":{"n":5}}}'
```

**4. Connect Claude Code to localhost:**

Add to `~/.mcp.json` (create if it doesn't exist):

```json
{
  "mcpServers": {
    "aashray-local": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/mcp-server/.env",
        "/absolute/path/to/mcp-server/stdio.js"
      ]
    }
  }
}
```

Then add `"aashray-local"` to `enabledMcpjsonServers` in `~/.claude/settings.json`:

```json
{
  "enabledMcpjsonServers": ["aashray-local"]
}
```

Restart Claude Code. You can now ask it things like:
- *"Show me the last 20 error logs"*
- *"Search logs for correlationId abc123"*
- *"What tables are in the database?"*
- *"Show me the last 5 room bookings"*

---

## First-time server setup

These steps run once on the production server. They are not part of the CI/CD pipeline.

**1. Create the read-only MySQL user:**

```sql
CREATE USER 'mcp_readonly'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT SELECT ON your_database_name.* TO 'mcp_readonly'@'localhost';
FLUSH PRIVILEGES;
```

**2. Generate a Bearer token:**

```bash
openssl rand -hex 32
```

**3. Add to `PROD_ENV_FILE` GitHub secret:**

```
MCP_PORT=4000
MCP_BEARER_TOKEN=<token from step 2>
MCP_DB_USER=mcp_readonly
MCP_DB_PASSWORD=<password from step 1>
```

The `MCP_DB_HOST`, `MCP_DB_PORT`, and `MCP_DB_NAME` values will fall back to the main app's `DB_HOST`, `DB_PORT`, and `DB_NAME` automatically, so only add them if they differ.

**4. (Recommended) Proxy through nginx with HTTPS:**

Add to your nginx site config so the Bearer token is encrypted in transit:

```nginx
location /mcp {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_read_timeout 30s;
}
```

---

## Connecting Claude Code (per engineer)

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "aashray": {
      "type": "http",
      "url": "https://your-server-domain.com/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

Then add `"aashray"` to `enabledMcpjsonServers` in `~/.claude/settings.json`:

```json
{
  "enabledMcpjsonServers": ["aashray"]
}
```

Verify it's working:

```bash
curl -s https://your-server-domain.com/health \
  -H "Authorization: Bearer <token>"
# → {"status":"ok","tools":6}
```

---

## Pairing with Sentry MCP

The MCP server is designed to work alongside the [Sentry MCP server](https://docs.sentry.io/product/sentry-mcp/) — not replace it. A typical debugging workflow:

1. **Sentry MCP** → get the crash details, stack trace, and affected `userId` or request ID
2. **`search_logs`** → pass the `correlationId` or `userId` from Sentry to get the full request lifecycle from our structured logs
3. **`query_db`** → look up the booking, room, or user record involved to understand the data state at the time of the crash

Add both to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "aashray": {
      "type": "http",
      "url": "https://your-server-domain.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp",
      "headers": { "Authorization": "Bearer <SENTRY_TOKEN>" }
    }
  }
}
```

Then add both to `enabledMcpjsonServers` in `~/.claude/settings.json`:

```json
{
  "enabledMcpjsonServers": ["aashray", "sentry"]
}
```

---

## Deployment

The MCP server is deployed automatically on every push to `main` via the existing CI/CD pipeline. The workflow:

1. Installs `mcp-server/` dependencies separately (`npm ci` inside `mcp-server/`)
2. Sources `.env.prod` to make MCP env vars available to PM2
3. Runs `pm2 reload MCPServer --update-env --env prod` (zero-downtime reload)
4. Falls back to `pm2 start` on first deploy when the process doesn't exist yet
5. Verifies the process with `pm2 show MCPServer`

No manual intervention is needed after the first-time server setup above.
