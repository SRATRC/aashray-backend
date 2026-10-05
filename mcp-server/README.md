# Aashray MCP Server

Aashray MCP provides 11 read-only tools for production data, application logs, console logs, processes, server health, and deployment state.

- Read [AGENTS.md](../AGENTS.md) for agent rules and tool choice.
- Use this reference for tool inputs, output limits, permissions, and secret protection.
- Use the [QA skill](../.claude/skills/aashray-qa/SKILL.md) for QA, staging, and pull request previews.
- Keep production and QA tools separate.

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

PM2, the process manager, runs `MCPServer` separately from `BackendAPI`, `CronJob`, and `WhatsAppService` on the production host.

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

- Uses a dedicated read-only MySQL account, `mcp_readonly`. It does not use the backend's database username or password.
- The connection pool has a three-connection limit. Each query has a five-second timeout.

| Tool | What it does |
|---|---|
| `get_schema` | No args: a lightweight index of every table (one-line description + column names only). With `tables: [...]`: full per-column detail (types, nullability, defaults, enums, FKs) merged with business annotations, for just those tables. Prefer the `schema://aashray` resource once at session start for the full database; use this tool for a mid-session lookup instead of re-reading everything. |
| `query_db` | Reads data with `SELECT` or `WITH`. Also supports `SHOW` and `DESCRIBE`. For `SELECT`, `WITH`, and parenthesized queries, adds `LIMIT 1000` or caps a trailing numeric row limit at 1000. Keeps a trailing numeric offset. Returns `{"columns": [...], "rows": [[...], ...]}`. Each row follows the column order. |
| `get_table_sample` | Returns 10 rows by default, with a maximum of 50. Uses the same column-and-row format as `query_db`. Caps text cells at 500 characters, including the cut marker. Replaces binary cells with `<binary N bytes>`. |

- `query_db` also caps text cells at 500 characters. Both tools return empty column and row arrays when no rows match.
- The database account enforces read-only access. `query_db` does not check statement types against an allowed list.
- Send one statement per call. The tool removes trailing semicolons but does not itself reject every internal semicolon.

### Database activity tool (`tools/database.js`)

| Tool | What it does |
|---|---|
| `get_db_activity` | Shows connection counts, active queries, open transactions, idle transactions with locks, blocked queries, and the latest recorded deadlock. `minSeconds` filters active queries and transactions, but not lock waits. Uses a fresh connection for each call. |

- Active queries, transactions, and lock waits each have a 50-row limit. SQL text has a 500-character output limit.
- The latest deadlock report has a 4000-character limit.
- `latestDeadlock: null` means no recorded deadlock only when `latestDeadlockError` is absent.
- If `latestDeadlockError` is present, the tool could not read deadlock status. Other activity data can still be available.

1. If `get_db_activity` reports missing permissions, give its exact `GRANT` statements to a MySQL admin.
2. If the database account is `mcp_readonly` at `%`, the admin applies these permissions once:

```sql
GRANT PROCESS ON *.* TO 'mcp_readonly'@'%';
GRANT SELECT ON performance_schema.* TO 'mcp_readonly'@'%';
```

3. After the admin applies the permissions, call `get_db_activity` again. Its fresh connection uses the new permissions without a restart.

These permissions do not allow data changes.

### Server tools (`tools/processes.js`, `tools/system.js`)

These read the production server's own state. They take no write actions.

| Tool | What it does |
|---|---|
| `get_processes` | Answers "is everything running, and did anything restart?" Lists each PM2 process (`BackendAPI`, `CronJob`, `WhatsAppService`, `MCPServer`) with status, pid, `startedAt`, uptime, `restarts`, `unstableRestarts` (restarts that came too soon after the last start, so a crash loop), last exit code, CPU, memory and Node version. A deploy reloads all processes within seconds of each other. A process that started later than the rest restarted on its own. |
| `get_process_logs` | Answers "what did this process print to its console?" Input: `process` (required), `stream` (`error` = stderr, default; `out` = stdout), `lines` (default 100, max 500), `keyword` (case-insensitive). Covers what the application log misses: crashes before the logger starts, Node fatal errors, and everything the WhatsApp service prints. PM2 does not timestamp these lines, so the result gives the file's last write time. Reads only the last 5 MB. |
| `get_server_health` | Answers "is the box healthy?" Shows disk use per filesystem, memory and swap, CPU count, load, uptime, and the size of the log folders. `warnings` lists anything over a limit: disk 85% full, under 10% memory available, 1-minute load above the CPU count. |
| `get_deploy_info` | Answers "what is deployed, and does the running process use the settings in `.env.prod`?" Shows the checked-out commit, tracked files edited by hand on the server, process start times, and, for every `.env.prod` setting: whether the process has it, whether it matches, and its length (exact for harmless settings, a range of `<8`, `8-15` or `16+` for secrets). Input: `process` (default `BackendAPI`). |

## Secret protection and output limits

| Output | Protection and limit |
|---|---|
| Process console logs | Removes known secrets in plain, URL-encoded, JSON-escaped, and base64 forms. Also removes authorization values, named secrets, and WhatsApp QR codes. |
| Console search | Filters after secret removal. Limits each output line to 2000 characters, including the cut marker. Collapses adjacent QR rows into one marker. |
| Database activity SQL | Uses secret values from the environment file and MCP credentials. Does not read secrets from other process environments. Removes secrets before the output cut. |
| Deployment settings | Shows plain values only for the allowed harmless settings. Other values use an eight-character fingerprint and a length range: `<8`, `8-15`, or `16+`. |

- No server tool returns the full PM2 environment.
- [redact.js](redact.js) defines the harmless settings whose values can appear in deployment output.
- Secret removal can miss values below eight characters and secrets split across lines.
- Console file paths come from PM2. Callers select a process and output type, not an arbitrary file path.
- Server tools query PM2 only when its daemon answers. They do not start a daemon.
- Deployment Git commands run as the checkout owner when MCP runs as root and another user owns the checkout.
- If the checkout owner cannot be read in that case, the tool does not run Git as root.

1. If you must compare a secret with a deployment setting, compute its fingerprint locally with this command:

```bash
node -e "require('crypto').scrypt(process.argv[1],'aashray-mcp-fingerprint',16,(e,k)=>console.log(k.toString('hex').slice(0,8)))" 'VALUE'
```

2. If `quotedInFile` is true, include the file's quotes in the value before you compute the fingerprint.
3. Compare the result with `fingerprint`. If values differ, `fileFingerprint` identifies the value in `.env.prod`.

- A setting absent from the process can still reach the backend. The backend also loads `.env.prod` at startup.
- For an unknown deployment process, the tool reports `settingsNote` and shows file settings without a process comparison.
- Git, PM2, or environment-file failures can appear as separate error fields. Check those fields before you claim a full deployment check.

## Read-only checks

1. For a connection check, call `get_processes`. Confirm that the response contains the expected process names and status fields.
2. For a console check, call `get_process_logs` with `process`, `stream`, a small `lines` limit, and a known keyword.
3. For a filter check, change the keyword's case. Confirm that each returned line matches without regard to case.
4. For an error check, request a nonexistent log process. Confirm that the tool returns an explicit error.
5. For a health check, call `get_server_health`. Compare warnings with disk, memory, and CPU values.
6. For a deployment check, call `get_deploy_info` for `BackendAPI` and `MCPServer`. Inspect settings and partial-error fields.
7. For an activity check, call `get_db_activity` with and without `minSeconds`. Check columns, row lengths, and permission errors.
8. For secret protection, test `redact.js` locally with dummy secrets, encoded values, QR data, and values across output cut points.

- Empty live results do not test populated query, lock-wait, or deadlock output.
- Empty filtered logs do not prove that secret removal works. Use local dummy values for that check.
- Do not create production locks, deadlocks, or secret log entries for these checks.
- Record the environment, check time, results, and behavior that remains untested.

---

## Authentication and request checks

| Concern | How it's handled |
|---|---|
| Authentication | Every request requires `Authorization: Bearer <token>`. Token compared with `crypto.timingSafeEqual` (prevents timing attacks). |
| Table names | `get_table_sample` checks table names against `/^[a-zA-Z0-9_]+$/`. Database queries use prepared statements through `connection.execute()`. |
| Path traversal | `date` parameters are validated against `^\d{4}-\d{2}-\d{2}$` before being used in file paths. |

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
