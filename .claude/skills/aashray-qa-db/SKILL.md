---
name: aashray-qa-db
description: Use when the user asks to query the Aashray QA / staging MySQL database ("query the QA db", "what is in QA's users table"), or to refresh QA from a prod snapshot. Covers the read-only QA DB runner and the QA credential guardrails. For QA logs, metrics, and deploy status use the Render MCP and the render-* skills instead.
---

# Aashray QA database access

QA (a.k.a. staging) runs on **Render** from the `dev` branch. Every PR also gets its own preview deploy. All of them share one Aiven MySQL database.

This skill covers only the parts Render tooling cannot do: the QA database, its credential guardrails, and the prod-to-QA snapshot refresh.

- **Logs, metrics, deploy status** — use the Render MCP with the `render-monitor` and `render-debug` skills. Service names and API URLs are in the repo `CLAUDE.md`. Never read log files off disk: the Render filesystem is ephemeral.
- **Render MCP not installed or not authenticated** — use the `render-mcp` skill.
- **Prod** — use the separate `aashray` MCP. **This skill never touches prod**, except to read a snapshot in section 2.

Run everything from the `aashray-backend` repo root.

## 1. Query the QA database (read-only)

The QA DB is Aiven MySQL and requires TLS. Use the bundled runner — it loads the credentials and the CA cert from `.env.qa` and enforces read-only:

```bash
node --env-file=.env.qa .claude/skills/aashray-qa-db/qa-db.mjs "SELECT id, name FROM users LIMIT 5"
```

- Only `SELECT / SHOW / DESCRIBE / EXPLAIN / WITH` run. Writes and multi-statement (`;`) queries are refused. An unbounded `SELECT` is auto-capped at 1000 rows.
- Explore the schema with `SHOW TABLES` and `DESCRIBE <table>` first.
- **Writes:** only if the human explicitly asks. Confirm the exact statement, then prepend `QA_DB_ALLOW_WRITE=1`.
- To trace one request end-to-end, get its `correlationId` from the Render logs (every backend request sets one), then look up the affected rows here.

### Prerequisites

Check these before you run a query. If one fails, tell the user the fix — do not let the command fail silently.

| Prerequisite | Check | If missing |
|---|---|---|
| Node ≥ 20.6 (for `--env-file`) | `node -v` | Install or switch to Node ≥ 20.6 (e.g. `nvm use 20`). |
| Repo deps (`mysql2`) | `node -e "require.resolve('mysql2')"` from repo root | Run `npm ci` in the repo root. |
| `.env.qa` present | `test -f .env.qa && echo ok` | It is gitignored, so a fresh clone does not have it. Ask a teammate for the QA env file and save it as `aashray-backend/.env.qa`. |
| DB reachable | run the command above with `SELECT 1` | Read the runner's error — it prints the specific fix (credentials, network/VPN, stale cert). |

## 2. Refresh QA from a prod snapshot

Only on explicit human request — it destroys QA data and copies real member PII into QA.

Dump prod (a human with `.env.prod` runs this — the `aashray` MCP is SELECT-only and cannot dump):

```bash
mysqldump --defaults-extra-file=<cnf> --single-transaction --quick --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 --hex-blob aashray > prod-aashray.sql
```

`--single-transaction` is mandatory: without it mysqldump defaults to `--lock-tables` and stalls prod. `--set-gtid-purged=OFF` and `--no-tablespaces` are required or Aiven rejects the import. Prod has zero views, triggers, routines, or events, so no `DEFINER` rewriting is needed.

**Prod is high-latency (~4s per table, ~3.5 min for the schema alone). A silent mysqldump is normal — do not assume it hung and kill it.** Verify with `tail -1` showing `-- Dump completed` and `grep -c 'CREATE TABLE'` = 55. Never `tail` the data section: single `INSERT` lines approach 1 MB.

Load into QA:

```bash
# back up QA first — this is the only undo
mysqldump --defaults-extra-file=<qa-cnf> --single-transaction --quick --no-tablespaces \
  --set-gtid-purged=OFF aashray > qa-backup-$(date +%Y%m%d-%H%M%S).sql

mysql --defaults-extra-file=<qa-cnf> -e \
  'DROP DATABASE IF EXISTS `aashray`; CREATE DATABASE `aashray` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;'

{ echo "SET SESSION sql_require_primary_key=0;"; cat prod-aashray.sql; } \
  | mysql --defaults-extra-file=<qa-cnf> --max-allowed-packet=64M -D aashray
```

**The `SET SESSION sql_require_primary_key=0` is required.** Aiven sets `sql_require_primary_key=1`, and prod's `temp_mobile_numbers` and `transactions_adhyayan` have no primary key. Without it the import dies mid-way (`ERROR 3750`) and leaves QA half-loaded. `avnadmin` can set it per-session despite lacking `SESSION_VARIABLES_ADMIN`. It must be in the *same session* as the load, hence the `{ echo; cat; }` pipe.

Verify by exact row counts, not table counts: build one `SELECT '<t>', COUNT(*) FROM <t> UNION ALL …` query over all tables and diff prod against QA in a single round trip each. Expect small drift in `razorpay_webhook` — prod keeps receiving webhooks after the snapshot. Confirm the gap is only rows with `id` above QA's max.

Afterwards QA sits at prod's migration state (49 rows) and **loses any dev/PR-only tables**. Re-run `npx sequelize-cli db:migrate --env qa` to bring it back to the dev branch.

`mysqldump` and `mysql` need a `--defaults-extra-file` (not `qa-db.mjs`, which is single-statement and read-only). Write it with `umask 077`, include `ssl-mode=REQUIRED` for Aiven, and **delete it when done** — it holds a plaintext password. `source .env.qa` also prints a harmless `command not found: private_key:` because `DB_CERT` is backtick-quoted.

## Guardrails

- **QA only.** Never point these steps at prod. For prod, use the `aashray` MCP.
- **The DB is read-only by default.** Writes need explicit human approval and the opt-in flag.
- **Never print secret values** from `.env.qa` (passwords, cert, Razorpay keys).
- **`.env.qa` holds live credentials, not sandboxed ones:** the real SES sender `noreply@vitraagvigyaan.org` and a live `rzp_live_…` Razorpay key. With real member data in QA, any flow you exercise can email a real member or hit live Razorpay. Render runs `node app.js` only, with no cron worker, so nothing fires on a schedule — but manual admin and payment actions do.

## Keep this skill evolving

When a QA database task exposes a gap here — a setup snag, a changed credential, a guardrail that should exist — update this SKILL.md or `qa-db.mjs` in the same session. Name the gap and make the fix concrete. Prefer turning a real failure into a new row or step so the next person does not hit it.
