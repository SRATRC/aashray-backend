# Aashray Backend agent rules

Aashray Backend defines the business rules for the member app and staff panel.

## Scope and branches

- Work in this repo for backend changes.
- Create feature and bugfix branches from `dev`. Target `dev` in pull requests.
- `main` is the production branch. Promote changes through a merge from `dev`.
- Do not commit or push unless the user explicitly asks.
- Before a feature change, read the [shared business rules](../aashray-docs/docs/business-logic/README.md).
- Use the terms in that guide. If sources differ, the backend code controls the behavior.
- Shared business docs describe code merged to `main`. Check backend code for behavior on an unmerged branch.

## Code rules

- Use ES module imports and exports.
- Keep business rules in `helpers/`. Routes apply middleware. Controllers handle requests. Models define data.
- Use status and price constants from `config/constants.js`. Do not hardcode their values.
- Use `req.log` in request controllers and helpers.
- Call `attachUserContext(req)` immediately after authentication. It reads `req.user` and adds the user to request logs.
- Use `catchAsync()` from `utils/CatchAsync.js` for controller error handling.
- Store a request transaction in `req.transaction`. `catchAsync()` rolls it back on an error.
- Pass `{ transaction: req.transaction }` to Sequelize calls within that transaction.

## Local commands

1. For a new local environment, copy `.env.example` to the required `.env.<environment>` file. See [setup](docs/getting-started/setup.md).
2. For local development, run `npm run dev`.
3. For the production-mode API entry point, run `npm run start:prod`.
4. For the separate scheduled-job entry point, run `npm run start:cron`.
5. After a code change, run `npm run lint:undef` and the tests that cover the change.
6. If the local test environment is ready, run `npm test` for the full Jest suite.
7. If a local development migration is required, run `npx sequelize-cli db:migrate --env dev`.
8. If the user requests a local migration rollback, run `npx sequelize-cli db:migrate:undo --env dev`.
9. If the user requests local log removal, run `npm run logs:clean`. This command deletes log files.

Use [environment configuration](docs/guides/environment-config.md), [test setup](docs/guides/testing.md), and [migration guidance](docs/guides/database-migrations.md) for details.

## Environment access

| Environment | Tool source | Rule |
|---|---|---|
| Production | `aashray` MCP, the read-only Model Context Protocol service | Read production data and server state. Do not change production through these checks. |
| QA, staging, and pull request previews | [aashray-qa skill](.claude/skills/aashray-qa/SKILL.md) | Use its QA database, Render logs, API URLs, and deployment checks. |
| GitHub Actions agent reviews | Diff and checked-out files | The MCP, QA skill, databases, installed dependencies, and test suite are unavailable. Do not call live tools or run tests there. |

- Keep production and QA tools separate.
- Confirm the target environment before a live check.

## Production tool choice

| Task | Tool |
|---|---|
| Read the full database schema before a query | Resource: `schema://aashray` |
| Get a table index or details for selected tables | `get_schema` |
| Read booking, member, or payment data | `query_db` |
| Inspect a small table sample | `get_table_sample` |
| Read recent application logs | `get_recent_logs` |
| Trace a request or member in application logs | `search_logs` with `correlationId` or `userId` |
| Read application errors for one date | `get_error_logs` |
| Check process status, restarts, CPU use, and memory use | `get_processes` |
| Read console errors, startup failures, or WhatsApp output | `get_process_logs` |
| Check disk space, available memory, CPU load, and log sizes | `get_server_health` |
| Check the deployed commit, tracked file edits, and process settings | `get_deploy_info` |
| Check active queries, open transactions, database locks, or deadlocks | `get_db_activity` |

Use the [MCP reference](mcp-server/README.md) for inputs, limits, permissions, secret protection, and checks.

## Check results

- Report the environment, check time, result, and any limit that affects the conclusion.
- An empty database activity result does not prove lock or deadlock handling.
- An empty console log does not prove that the process never failed. The tool reads only the current file tail.
- A restart count alone does not prove a crash. Compare start times and inspect console errors.
- Use dummy values for local secret-protection tests. Do not add test secrets, locks, or deadlocks to production.
- State which behavior remains untested when the matching live state is absent.

## Reference

- [Backend documentation index](README.md): setup, architecture, request flow, API details, and guides.
- [Code conventions](docs/getting-started/conventions.md): names, logs, and code patterns.
- [Project structure](docs/getting-started/project-structure.md): folders and request flow.
