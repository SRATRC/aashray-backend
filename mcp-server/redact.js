import fs from 'fs';
import { BEARER_TOKEN, DB, ENV_FILE } from './config.js';

// Settings that are safe to show as-is. Everything else in the env file is treated
// as a secret: shown only as a fingerprint, and scrubbed from any log text we return.
export const PLAIN_KEYS = new Set([
  'NODE_ENV', 'PORT', 'DB_PORT', 'DB_NAME', 'LOG_DIR', 'AWS_REGION',
  'AWS_S3_BUCKET_NAME', 'SES_SMTP_HOST', 'SES_SMTP_PORT', 'MCP_PORT', 'DB_HOST', 'SES_SMTP_EMAIL',
]);

const SECRET_NAME_RE = /SECRET|PASSWORD|PASSWD|TOKEN|KEY|AUTH|CREDENTIAL|PRIVATE/i;
const MIN_SECRET_LEN = 8;
const MAX_LINE_LEN = 2000;

// Mirrors how the deploy job loads .env.prod: it exports each `KEY=value` line
// verbatim, so the running value is the raw text after the first `=`, quotes included.
export function readEnvFile(filePath = ENV_FILE) {
  if (!fs.existsSync(filePath)) return null;
  const env = new Map();
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;
    const eq = line.indexOf('=');
    env.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return env;
}

export function stripQuotes(value) {
  const m = value.match(/^(["'])(.*)\1$/s);
  return m ? m[2] : value;
}

// Every secret value this server could see — from the env file, the running
// processes' environments, and its own credentials — longest first, so a value
// that contains another one is replaced whole.
export function collectSecretValues(processes = []) {
  const values = new Map();
  const add = (key, value) => {
    if (PLAIN_KEYS.has(key) || typeof value !== 'string') return;
    for (const v of [value, stripQuotes(value)]) {
      if (v.length < MIN_SECRET_LEN) continue;
      // The same secret also shows up URL-encoded, JSON-escaped or base64 in logs.
      const forms = [
        v,
        encodeURIComponent(v),
        JSON.stringify(v).slice(1, -1),
        Buffer.from(v).toString('base64'),
      ];
      for (const form of forms) {
        if (form.length >= MIN_SECRET_LEN && !values.has(form)) values.set(form, key);
      }
    }
  };

  const fileEnv = readEnvFile();
  for (const [key, value] of fileEnv ?? []) add(key, value);
  for (const proc of processes) {
    for (const [key, value] of Object.entries(proc.env ?? {})) {
      if (fileEnv?.has(key) || SECRET_NAME_RE.test(key)) add(key, value);
    }
  }
  add('MCP_BEARER_TOKEN', BEARER_TOKEN);
  add('MCP_DB_PASSWORD', DB.password);

  return [...values.entries()].sort((a, b) => b[0].length - a[0].length);
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const QR_RUN_RE = /[▀▄█ ]{8,}/g;

// The WhatsApp service prints its login QR to stdout. Anyone holding that QR can
// link a device to the centre's WhatsApp account, so it must never leave the server.
function isQrRow(line) {
  // Full-size terminal QR rows are coloured spaces: many colour escapes.
  if ((line.match(ANSI_RE)?.length ?? 0) >= 10) return true;
  // Half-block rows, possibly after a timestamp prefix (pm2 --time).
  const visible = line.replace(ANSI_RE, '');
  for (const [run] of visible.matchAll(QR_RUN_RE)) {
    if (run.replace(/ /g, '').length >= 4) return true;
  }
  return false;
}

const PATTERNS = [
  // Baileys raw QR payload: "2@<ref>,<noise key>,<identity key>,<adv secret>"
  [/\b\d@[A-Za-z0-9+/=]{10,}(?:,[A-Za-z0-9+/=]{10,}){2,}/g, '[QR payload redacted]'],
  [/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, '[image data redacted]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [
    /(["']?[A-Za-z0-9_-]{0,64}(?:secret|password|passwd|token|api[_-]?key|authorization|cookie)[A-Za-z0-9_-]{0,64}["']?\s{0,8}[:=]\s{0,8})(?!\[redacted)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;}\]]+)/gi,
    '$1[redacted]',
  ],
];

export function redactText(text, secrets) {
  let out = text;
  for (const [value, key] of secrets) {
    if (out.includes(value)) out = out.split(value).join(`[redacted:${key}]`);
  }
  // Cut long lines before the pattern regexes so no regex ever sees more than MAX_LINE_LEN.
  const total = out.length;
  if (total > MAX_LINE_LEN) out = out.slice(0, MAX_LINE_LEN);
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return total > MAX_LINE_LEN ? `${out}… (truncated, ${total} chars)` : out;
}

// Collapses each run of QR rows into one marker, then scrubs every other line.
export function redactLogLines(lines, secrets) {
  const out = [];
  for (const line of lines) {
    if (isQrRow(line)) {
      if (out[out.length - 1] !== '[QR code redacted]') out.push('[QR code redacted]');
      continue;
    }
    out.push(redactText(line.replace(ANSI_RE, ''), secrets));
  }
  return out;
}
