# Aashray MCP Server

A standalone HTTP server implementing the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), giving AI agents (Claude Code, Cursor, etc.) structured, read-only access to application logs and the MySQL database.

## How it fits into the stack

```
Engineer's Claude Code
       │
       │  POST /mcp  (Bearer token)
       ▼
  MCP Server :4000          (PM2 process: MCPServer)
   ├── tools/logs.js   ──── reads LOG_DIR/*.log[.gz]
   └── tools/database.js ── connects to MySQL (read-only user)

Main Backend              (PM2 process: BackendAPI)
Cron Job                  (PM2 process: CronJob)
```

---

## Tools

### Logs

| Tool | What it does |
|---|---|
| `get_recent_logs` | Last N entries from today's `application-YYYY-MM-DD.log`. Optional `level` filter. |
| `search_logs` | Search a single day's log. Filters: `keyword`, `level`, `userId`, `correlationId`, `date`. |
| `get_error_logs` | Last N entries from `error-YYYY-MM-DD.log`. |

Every HTTP request in the app gets a unique `correlationId` (set in `middleware/Logger.js`). Pass it to `search_logs` to trace the full lifecycle of any request.

### Database

Connects with a dedicated read-only MySQL user. Pool: 3 connections, 5s query timeout.

| Tool | What it does |
|---|---|
| `get_schema` | All tables and columns. Use this before writing queries. |
| `query_db` | Executes `SELECT`, `SHOW`, `DESCRIBE`, or `WITH` statements. Auto-caps at `LIMIT 1000`. |
| `get_table_sample` | Sample rows from any table (max 50). |

---

## Security

| Concern | How it's handled |
|---|---|
| Authentication | `Authorization: Bearer <token>` on every request. Compared with `crypto.timingSafeEqual`. |
| DB writes | Read-only MySQL user — `GRANT SELECT` only. Never uses main app DB credentials. |
| SQL injection | Statement type allowlist + prepared statements + alphanumeric table name validation. |
| Multi-statement | Queries containing `;` are rejected before execution. |
| Path traversal | `date` params validated against `^\d{4}-\d{2}-\d{2}$` before use in file paths. |
| Query cost | 5s timeout. Auto `LIMIT 1000` on unbounded `SELECT` queries. |

---

## Configuration

All vars go in `.env.prod` (via the `PROD_ENV_FILE` GitHub secret).

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_BEARER_TOKEN` | **Yes** | — | Generate: `openssl rand -hex 32`. Server exits at startup if missing. |
| `MCP_PORT` | No | `4000` | Port the MCP server listens on. |
| `LOG_DIR` | No | `/home/ubuntu/logs` | Log directory. Shared with the main app. |
| `MCP_DB_USER` | **Yes** | — | Read-only MySQL user (`mcp_readonly`). |
| `MCP_DB_PASSWORD` | **Yes** | — | Password for the read-only MySQL user. |
| `MCP_DB_HOST` | No | `DB_HOST` | Falls back to main app's value. |
| `MCP_DB_PORT` | No | `DB_PORT` or `3306` | Falls back to main app's value. |
| `MCP_DB_NAME` | No | `DB_NAME` | Falls back to main app's value. |

---

## First-time server setup

These steps run **once** on the production server and are not part of CI/CD.

**1. Create the read-only MySQL user:**

```sql
CREATE USER 'mcp_readonly'@'%' IDENTIFIED BY '<strong-password>';
GRANT SELECT ON aashray.* TO 'mcp_readonly'@'%';
FLUSH PRIVILEGES;
```

**2. Add to `PROD_ENV_FILE` GitHub secret:**

```
MCP_BEARER_TOKEN=<openssl rand -hex 32>
MCP_DB_USER=mcp_readonly
MCP_DB_PASSWORD=<password from step 1>
```

**3. Add nginx location block** (inside the existing 443 server block):

```nginx
location /mcp {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_read_timeout 30s;
}
```

Then: `sudo nginx -t && sudo systemctl reload nginx`

---

## Connecting Claude Code (per engineer)

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "aashray": {
      "type": "http",
      "url": "https://aashray.vitraagvigyaan.org/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_BEARER_TOKEN>"
      }
    }
  }
}
```

Add `"aashray"` to `enabledMcpjsonServers` in `~/.claude/settings.json`:

```json
{
  "enabledMcpjsonServers": ["aashray"]
}
```

Restart Claude Code. Verify:

```bash
curl -s https://aashray.vitraagvigyaan.org/health \
  -H "Authorization: Bearer <token>"
# → {"status":"ok","tools":6}
```

---

## Pairing with Sentry MCP

Use both together for full crash context:

1. **Sentry** → crash details, stack trace, affected `userId` or request ID
2. **`search_logs`** → pass `correlationId` or `userId` to get the full request lifecycle
3. **`query_db`** → look up the booking/user record to understand data state at crash time

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "aashray": {
      "type": "http",
      "url": "https://aashray.vitraagvigyaan.org/mcp",
      "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp"
    }
  }
}
```
