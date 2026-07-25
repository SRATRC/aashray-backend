---
name: aashray-qa
description: Use when the user asks to inspect, query, debug, or test the Aashray QA / staging environment or a PR preview — e.g. "query the QA db", "check QA logs", "look at PR 285's logs", "hit the QA API", "is the QA deploy up". QA runs on Render (dev branch = QA; each PR gets its own preview). Covers the QA MySQL database, Render logs, the QA/PR API URLs, and deploy status.
---

# Aashray QA access

QA (a.k.a. staging) is deployed on **Render** from the `dev` branch. Every PR also gets its own isolated **preview** deploy. This skill is how you reach each QA service. There is a separate prod MCP named `aashray` — **this skill never touches prod.**

Run everything from the `aashray-backend` repo root.

**Dependencies:** the DB and API steps need only Node + a local `.env.qa`. **Logs and deploy status require the [Render MCP](https://render.com/docs/mcp-server) to be installed and connected** — if it isn't, those two steps can't run (see first-run setup below).

## First run — check setup, then guide the user

The first time this skill is used in a repo/machine, verify prerequisites **before** running a task. If one is missing, walk the user through fixing it — don't just let a command fail.

| Prerequisite | Check | If missing, tell the user |
|---|---|---|
| Node 20+ (for `--env-file`) | `node -v` | Install/switch to Node ≥ 20 (e.g. `nvm use 20`). |
| Repo deps (`mysql2`) | `node -e "require.resolve('mysql2')"` from repo root | Run `npm ci` in the repo root. |
| `.env.qa` present | `test -f .env.qa && echo ok` | It's gitignored, so it isn't in a fresh clone. Ask a teammate for the QA env file and save it as `aashray-backend/.env.qa`. |
| DB reachable | run the step-1 command with `SELECT 1` | Read the runner's error — it prints the specific fix (creds, network/VPN, stale cert). |
| Render MCP (**required** for logs/deploys) | call `list_workspaces` | If the `render` MCP tools aren't available, it isn't installed — have the user install & connect the [Render MCP](https://render.com/docs/mcp-server) (needs a Render API key), then retry. If it errors on auth, it's installed but not logged in — add the API key. Once it lists workspaces, **ask the user which one** and `select_workspace` (never pick for them). |

Once each needed prerequisite passes, proceed to the task. You only need the ones a given task touches (a DB query needs the first four; logs need Render MCP).

## Environment map

| Thing | QA base (dev branch) | PR preview #N |
|---|---|---|
| API URL | `https://aashray-backend.onrender.com` | `https://aashray-backend-pr-<N>.onrender.com` |
| Render service name | `aashray-backend` | `aashray-backend-pr-<N>` |
| Database | Aiven MySQL from `aashray-backend/.env.qa` (shared by base + PRs unless told otherwise) | same |

## 1. Query the QA database (read-only)

The QA DB is Aiven MySQL and requires TLS. Use the bundled runner — it loads creds + the CA cert from `.env.qa` and enforces read-only:

```bash
node --env-file=.env.qa .claude/skills/aashray-qa/qa-db.mjs "SELECT id, name FROM users LIMIT 5"
```

- Only `SELECT / SHOW / DESCRIBE / EXPLAIN` run; writes and multi-statement (`;`) queries are refused. Unbounded `SELECT`s are auto-capped at 1000 rows.
- Explore schema with `SHOW TABLES` / `DESCRIBE <table>` first.
- **Writes:** only if the human explicitly asks. Confirm the exact statement, then prepend `QA_DB_ALLOW_WRITE=1`.
- Needs a local `.env.qa` (gitignored — each developer supplies their own) and `node_modules` installed in the repo.

## 2. Logs (QA + PR previews) — via the Render MCP

Do **not** read log files off disk — Render's filesystem is ephemeral. This step **requires the Render MCP** (see Dependencies); if it isn't installed, ask the user to set it up first. Then:

1. If you get "no workspace selected", call `list_workspaces` and **ask the user which one** (never pick yourself), then `select_workspace`.
2. `list_services` (with `includePreviews: true` for PR deploys) → find the service by name from the table above → note its `id`.
3. `list_logs` with `resource: ["<service-id>"]`. Narrow with `text`, `level`, `type` (`app` / `request` / `build`), or a time range.

To trace one request end-to-end, filter logs by its `correlationId` (every backend request sets one), then look up the affected records with the QA DB runner in step 1.

## 3. Hit the QA / PR API

Smoke-test endpoints with `curl` against the URL from the table, e.g. `curl -s https://aashray-backend-pr-285.onrender.com/health`. Use the PR URL when the user names a PR; otherwise the base QA URL.

## 4. Deploy status

Check whether a QA or PR deploy is live/failed with the Render MCP: `list_deploys` (and `get_deploy` for detail) on the service's `id`.

## Guardrails

- **QA only.** Never point these steps at prod. For prod, use the `aashray` MCP instead.
- **DB is read-only by default** — writes require explicit human approval + the opt-in flag.
- **Never print secret values** from `.env.qa` (passwords, cert, Razorpay keys).

## Keep this skill evolving

Whenever a QA task exposes a gap here — a service or step this skill doesn't cover, a setup snag that tripped someone up, a changed URL/service name, a guardrail that should exist — update this SKILL.md (or `qa-db.mjs`) in the same session. Name the gap, make the fix concrete, and prefer turning a real failure into a new row or step so the next person doesn't hit it.
