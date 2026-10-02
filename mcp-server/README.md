# Aashray MCP Server

A standalone HTTP server that implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), giving AI agents (Claude Code, Cursor, etc.) structured, read-only access to the application's logs, database, and the production server itself (processes, health, deploy state).

## How it fits into the stack

```
  Claude Code
       │
       │  POST /mcp  (Bearer token)
       ▼
  MCP Server :4000          (this service, PM2 process: MCPServer)
   ├── tools/logs.js   ──── reads /home/ubuntu/logs/*.log[.gz]
   ├── tools/database.js ── connects to MySQL (read-only user)
   ├── tools/processes.js ─ reads PM2 status and console logs
   └── tools/system.js ──── reads disk, memory, git and .env.prod state

Main Backend              (PM2 process: BackendAPI)
Cron Job                  (PM2 process: CronJob)
```

The MCP server runs as a third PM2 process on the same Ubuntu server alongside the backend and cron job. It does not share code or process memory with the main app — it's a fully separate Node.js process.

---

## Connecting to the MCP server

Get your `MCP_BEARER_TOKEN` from the team, then run the one-command installer:

```bash
# install for every AI agent detected on your machine
curl -fsSL https://raw.githubusercontent.com/SRATRC/aashray-backend/main/mcp-server/install-mcp.sh \
  | bash -s -- <MCP_BEARER_TOKEN>

# or clone the repo and run directly
./mcp-server/install-mcp.sh <MCP_BEARER_TOKEN>
```

The script auto-detects which agents are installed and patches only those.
It is idempotent — safe to re-run after updates.

---

### Manual setup per agent

If you prefer to configure an agent by hand, or the installer doesn't cover your setup:

#### Claude Code

```bash
claude mcp add --transport http aashray https://your-server-domain.com/mcp \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

#### Claude Desktop

Claude Desktop only supports stdio transport — use `mcp-remote` as a bridge.
Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `~/.config/Claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "aashray": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-server-domain.com/mcp",
        "--header",
        "Authorization: Bearer <MCP_BEARER_TOKEN>"
      ]
    }
  }
}
```

Requires Node.js. Restart Claude Desktop after saving.

#### GitHub Copilot (VS Code ≥ 1.99)

GitHub Copilot uses VS Code's native MCP support. Add to VS Code's global `settings.json`
(`Cmd+Shift+P` → "Open User Settings (JSON)"):

```json
{
  "mcp": {
    "servers": {
      "aashray": {
        "type": "http",
        "url": "https://your-server-domain.com/mcp",
        "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
      }
    }
  },
  "github.copilot.chat.mcp.enabled": true
}
```

MCP tools appear in Copilot Chat under the `#` tools menu after reloading VS Code.

#### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "aashray": {
      "url": "https://your-server-domain.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
    }
  }
}
```

#### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "aashray": {
      "url": "https://your-server-domain.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
    }
  }
}
```

#### Gemini CLI

Edit `~/.gemini/settings.json` (note: Gemini uses `httpUrl`, not `url`):

```json
{
  "mcpServers": {
    "aashray": {
      "httpUrl": "https://your-server-domain.com/mcp",
      "headers": { "Authorization": "Bearer <MCP_BEARER_TOKEN>" }
    }
  }
}
```

---

## Pairing with Sentry MCP

The MCP server is designed to work alongside the [Sentry MCP server](https://docs.sentry.io/product/sentry-mcp/) — not replace it. A typical debugging workflow:

1. **Sentry MCP** → get the crash details, stack trace, and affected `userId` or request ID
2. **`search_logs`** → pass the `correlationId` or `userId` from Sentry to get the full request lifecycle from our structured logs
3. **`query_db`** → look up the booking, room, or user record involved to understand the data state at the time of the crash

Add both via the Claude Code CLI:

```bash
claude mcp add --transport http aashray https://your-server-domain.com/mcp \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"

npx add-mcp https://mcp.sentry.dev/mcp
```

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
| `get_schema` | No args: a lightweight index of every table (one-line description + column names only). With `tables: [...]`: full per-column detail (types, nullability, defaults, enums, FKs) merged with business annotations, for just those tables. Prefer the `schema://aashray` resource once at session start for the full database; use this tool for a mid-session lookup instead of re-reading everything. |
| `query_db` | Executes a `SELECT`, `SHOW`, or `DESCRIBE` statement. Auto-appends `LIMIT 1000` if no top-level `LIMIT` clause is present; caps only the row-count of an existing top-level `LIMIT`/`LIMIT offset, count`/`LIMIT count OFFSET offset` clause, never a `LIMIT` inside a subquery. Multi-statement queries (`;`) are rejected. Returns rows columnar — `{"columns": [...], "rows": [[...], ...]}` — instead of repeating column names per row. |
| `get_table_sample` | Returns up to 50 rows from any table, columnar like `query_db`. Long text is truncated and binary/BLOB cells are replaced with `<binary N bytes>` rather than dumped as byte arrays. |

### Database activity tool (`tools/database.js`)

| Tool | What it does |
|---|---|
| `get_db_activity` | Answers "what is MySQL doing right now?" Shows connection counts by user and state, running queries (longest first), open transactions with their age (including ones sitting idle while still holding locks), which transaction blocks which on a row lock, and the latest deadlock InnoDB recorded. Optional `minSeconds` hides queries and transactions younger than that. Uses a fresh connection on each call. |

**One-time setup.** The `mcp_readonly` user has only `SELECT` on `aashray.*`. This tool also needs two more grants. Without them it returns an error that lists the exact statements to run. A MySQL admin runs them once:

```sql
GRANT PROCESS ON *.* TO 'mcp_readonly'@'%';
GRANT SELECT ON performance_schema.* TO 'mcp_readonly'@'%';
```

New connections pick the grants up. No restart is needed. The user still cannot change any data.

### Server tools (`tools/processes.js`, `tools/system.js`)

These read the production server's own state. They take no write actions.

| Tool | What it does |
|---|---|
| `get_processes` | Answers "is everything running, and did anything restart?" Lists each PM2 process (`BackendAPI`, `CronJob`, `WhatsAppService`, `MCPServer`) with status, pid, `startedAt`, uptime, `restarts`, `unstableRestarts` (restarts that came too soon after the last start, so a crash loop), last exit code, CPU, memory and Node version. A deploy reloads all processes within seconds of each other. A process that started later than the rest restarted on its own. |
| `get_process_logs` | Answers "what did this process print to its console?" Input: `process` (required), `stream` (`error` = stderr, default; `out` = stdout), `lines` (default 100, max 500), `keyword` (case-insensitive). Covers what the application log misses: crashes before the logger starts, Node fatal errors, and everything the WhatsApp service prints. PM2 does not timestamp these lines, so the result gives the file's last write time. Reads only the last 5 MB. |
| `get_server_health` | Answers "is the box healthy?" Shows disk use per filesystem, memory and swap, CPU count, load, uptime, and the size of the log folders. `warnings` lists anything over a limit: disk 85% full, under 10% memory available, 1-minute load above the CPU count. |
| `get_deploy_info` | Answers "what is deployed, and does the running process use the settings in `.env.prod`?" Shows the checked-out commit, tracked files edited by hand on the server, process start times, and, for every `.env.prod` setting: whether the process has it, whether it matches, and its length. Input: `process` (default `BackendAPI`). |

**Secrets are redacted on a best-effort basis.** None of these tools returns the PM2 environment. Known secret values (from the env file and the running processes) are replaced in their plain, URL-encoded, JSON-escaped and base64 forms. Auth headers, `key=value` secrets and WhatsApp login QR codes are redacted too. Very short secrets (under 8 characters) and secrets split across lines are not caught. `get_db_activity` redacts the SQL it shows in the same way. `get_deploy_info` shows a value only for harmless settings such as `PORT` or `AWS_REGION`. Every other setting gets an 8-character fingerprint (a salted scrypt hash). `get_process_logs` redacts before it filters or returns any line. File paths come from PM2 and config, never from the caller.

**Compare a secret with a value you hold** (for example the webhook secret in the Razorpay dashboard). Compute its fingerprint on your own machine and compare it with the one in `get_deploy_info`:

```bash
node -e "require('crypto').scrypt(process.argv[1],'aashray-mcp-fingerprint',16,(e,k)=>console.log(k.toString('hex').slice(0,8)))" 'VALUE'
```

Notes on the output:
- `quotedInFile` means `.env.prod` has the value in quotes. The deploy exports each line as-is, so the quotes become part of the running value. Include them when you compute the fingerprint.
- A setting missing from the process may still reach the app, because the app also loads `.env.prod` itself at startup.
- The tools read PM2 only if its daemon is already running. They never start one.

---

## Security

| Concern | How it's handled |
|---|---|
| Authentication | Every request requires `Authorization: Bearer <token>`. Token compared with `crypto.timingSafeEqual` (prevents timing attacks). |
| DB write protection | Dedicated read-only MySQL user — `SELECT`, plus `PROCESS` and `SELECT` on `performance_schema` for `get_db_activity`. No write privilege. The MCP server never uses the main app's DB credentials. |
| Secrets on the server | PM2 environment is never returned. `get_deploy_info` returns a fingerprint instead of a secret. `get_process_logs` redacts secrets, auth headers and WhatsApp QR codes before filtering. |
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
| `PM2_HOME` | No | `~/.pm2` | PM2 data folder (process list and console logs). The default works on prod, where PM2 runs as root. |
| `MCP_APP_DIR` | No | Working directory of the MCP process | Deploy checkout that `get_deploy_info` reads git state from. The default works on prod. |
| `MCP_ENV_FILE` | No | `MCP_APP_DIR/.env.prod` | The env file `get_deploy_info` compares with the running process. The default works on prod. |
| `APP_CWD` | No | `/home/ubuntu/actions-runner-api/_work/aashray-backend/aashray-backend` | Override the PM2 working directory (useful for non-standard deployments). |

---

## File structure

```
mcp-server/
├── index.js          Entry point. Wires Express + MCP SDK + tools. Handles startup validation and graceful shutdown.
├── auth.js           Bearer token middleware. Applied to all routes.
├── config.js         Single source of truth for all env vars.
├── redact.js         Secret and WhatsApp QR redaction for log lines and env values.
├── package.json      Separate package — own dependencies, own node_modules.
└── tools/
    ├── logs.js       Log reading tools. Streams files with readline + zlib. Cleans up file descriptors on error.
    ├── database.js   Database tools. Lazy connection pool. All connections released in finally blocks.
    ├── processes.js  PM2 tools (get_processes, get_process_logs). Refuse to run if no PM2 daemon is up.
    └── system.js     Server tools (get_server_health, get_deploy_info).
```
