#!/usr/bin/env node
// Read-only query runner for the Aashray QA database (Aiven MySQL, TLS required).
//
// Usage (run from the aashray-backend repo root so mysql2 + .env.qa resolve):
//   node --env-file=.env.qa .claude/skills/aashray-qa/qa-db.mjs "SELECT * FROM users LIMIT 5"
//
// Reads DB creds + the Aiven CA cert from the environment loaded via --env-file=.env.qa.
// Read-only by default: only SELECT / SHOW / DESCRIBE / EXPLAIN are allowed, and any
// multi-statement query (containing ';') is rejected. A missing LIMIT is auto-capped.
//
// To run a write/DDL statement you must OPT IN explicitly (only when the human asked):
//   QA_DB_ALLOW_WRITE=1 node --env-file=.env.qa .claude/skills/aashray-qa/qa-db.mjs "UPDATE ..."

let mysql;
try {
  mysql = (await import('mysql2/promise')).default;
} catch {
  console.error(
    'Setup needed: mysql2 is not installed.\n' +
      'Fix: run "npm ci" (or "npm install") in the aashray-backend repo root, then retry.',
  );
  process.exit(3);
}

const sql = process.argv.slice(2).join(' ').trim();
if (!sql) {
  console.error('No SQL provided. Pass a statement as an argument.');
  process.exit(2);
}

const allowWrite = process.env.QA_DB_ALLOW_WRITE === '1';

// Read-only = starts with a read verb (WITH included for CTEs) AND none of the
// known ways a "read" statement can still mutate/write:
//   - EXPLAIN ANALYZE <anything containing DML> actually EXECUTES it on MySQL
//     8.0.18+ (the DML need not be adjacent — it can be behind a WITH clause or
//     a comment: `EXPLAIN ANALYZE WITH c AS (...) DELETE ...`)
//   - a CTE (WITH ...) can front an INSERT/UPDATE/DELETE/REPLACE
//   - SELECT ... INTO OUTFILE/DUMPFILE writes a file to the DB server
// Scan for dangerous keywords on a copy with string/identifier literals and
// comments blanked out, so a DML word used as a quoted VALUE (e.g.
// `WHERE status = 'update'`) or in a comment doesn't cause a false refusal.
const sqlNoLiterals = sql
  .replace(/'(?:\\.|''|[^'])*'/g, "''") // single-quoted strings
  .replace(/"(?:\\.|""|[^"])*"/g, '""') // double-quoted strings
  .replace(/`(?:``|[^`])*`/g, '``') // backtick identifiers
  .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* block comments */
  .replace(/(--|#)[^\n]*/g, ' '); // -- and # line comments

const hasDml = /\b(insert|update|delete|replace)\b/i.test(sqlNoLiterals);
const isReadOnly =
  /^(select|show|describe|desc|explain|with)\b/i.test(sql) &&
  !(/^explain\s+analyze\b/i.test(sql) && hasDml) &&
  !(/^with\b/i.test(sql) && hasDml) &&
  !/\binto\s+(outfile|dumpfile)\b/i.test(sqlNoLiterals);

if (sql.includes(';')) {
  console.error('Refused: multi-statement queries (containing ";") are not allowed.');
  process.exit(2);
}
if (!isReadOnly && !allowWrite) {
  console.error(
    'Refused: only read-only statements (SELECT/SHOW/DESCRIBE/EXPLAIN/WITH) are allowed by default.\n' +
      'This is the QA database. Re-run with QA_DB_ALLOW_WRITE=1 ONLY if the human explicitly asked for a write.',
  );
  process.exit(2);
}

// Auto-cap unbounded reads, mirroring the prod MCP behaviour. Append on a NEW
// line so a trailing "-- ..."/"# ..." comment on the last line can't swallow it.
let finalSql = sql;
if (/^(select|with)\b/i.test(sql) && !/\blimit\b/i.test(sql)) {
  finalSql = `${sql}\nLIMIT 1000`;
}

// The Aiven CA cert is stored as JSON in DB_CERT: {"private_key": "-----BEGIN CERTIFICATE----- ..."}
if (!process.env.DB_HOST || !process.env.DB_CERT) {
  console.error(
    'Setup needed: QA credentials not loaded.\n' +
      'Cause: either .env.qa is missing, or you did not pass --env-file=.env.qa.\n' +
      'Fix:\n' +
      '  1. Make sure aashray-backend/.env.qa exists (get it from the team — it is gitignored).\n' +
      '  2. Run from the repo root with: node --env-file=.env.qa .claude/skills/aashray-qa/qa-db.mjs "<SQL>"',
  );
  process.exit(3);
}

let ca;
try {
  ca = JSON.parse(process.env.DB_CERT).private_key;
} catch {
  console.error('Setup needed: DB_CERT in .env.qa is not valid JSON. Re-fetch .env.qa from the team.');
  process.exit(3);
}

let conn;
try {
  conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { ca },
    connectTimeout: 10000,
  });
} catch (err) {
  const hints = {
    ER_ACCESS_DENIED_ERROR: 'Wrong DB username/password in .env.qa — re-fetch it from the team.',
    ENOTFOUND: 'DB host not found — check DB_HOST in .env.qa, and your network/VPN.',
    ETIMEDOUT: 'Connection timed out — check your network/VPN and that the QA DB is up.',
    HANDSHAKE_SSL_ERROR: 'TLS handshake failed — DB_CERT may be stale; re-fetch .env.qa.',
  };
  console.error(`Could not connect to the QA database: ${err.message}`);
  if (hints[err.code]) console.error(`Likely fix: ${hints[err.code]}`);
  process.exit(3);
}

try {
  const [rows] = await conn.query(finalSql);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await conn.end();
}
