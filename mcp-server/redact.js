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
const PATTERN_MARGIN = 256;

// Mirrors how the deploy job loads .env.prod: it exports each `KEY=value` line
// verbatim (`IFS= read -r` splits on \n only, so a trailing \r stays), so the running value
// is the raw text after the first `=`, quotes included.
export function readEnvFile(filePath = ENV_FILE) {
  if (!fs.existsSync(filePath)) return null;
  const env = new Map();
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
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
    // A CRLF env file leaves a trailing \r on the running value; the bare secret must still be redacted.
    const bare = value.endsWith('\r') ? value.slice(0, -1) : value;
    for (const v of new Set([value, stripQuotes(value), bare, stripQuotes(bare)])) {
      if (v.length < MIN_SECRET_LEN) continue;
      // The same secret also shows up URL-encoded, JSON-escaped or base64 in logs.
      const forms = [
        v,
        encodeURIComponent(v),
        JSON.stringify(v).slice(1, -1),
        Buffer.from(v).toString('base64'),
      ];
      for (const form of forms) {
        if (!values.has(form)) values.set(form, key);
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
// `clean` is `line` without ANSI colour codes.
function isQrRow(line, clean) {
  // Full-size terminal QR rows are coloured spaces: many colour escapes.
  if ((line.match(ANSI_RE)?.length ?? 0) >= 10) return true;
  // Half-block rows, possibly after a timestamp prefix (pm2 --time).
  for (const [run] of clean.matchAll(QR_RUN_RE)) {
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

// Cut text to at most `max` characters in total, suffix included. N is the length of the text passed in
// (or `total`, when the caller already shortened it).
export function cap(text, max, total = text.length, cut = text.length > max) {
  if (!cut) return text;
  const suffix = `… (truncated, ${total} chars)`;
  return text.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

// The one redact-then-cap step: exact secret values on the full text, then the pattern
// regexes on a bounded slice, then the visible cut. The slice is `max` plus a margin so a
// token straddling the cut is still seen whole by the patterns before it is cut away.
export function redactText(text, secrets, max = MAX_LINE_LEN) {
  let out = text;
  for (const [value, key] of secrets) {
    if (out.includes(value)) out = out.split(value).join(`[redacted:${key}]`);
  }
  const total = out.length;
  const sliced = total > max + PATTERN_MARGIN;
  out = out.slice(0, max + PATTERN_MARGIN);
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  // The slice already dropped text even if the patterns shrank what is left under `max`.
  return cap(out, max, total, sliced || out.length > max);
}

export const QR_MARKER = '[QR code redacted]';

// One log line: the QR marker for a QR row, otherwise the line scrubbed of secrets.
export function redactLogLine(line, secrets) {
  const clean = line.replace(ANSI_RE, '');
  return isQrRow(line, clean) ? QR_MARKER : redactText(clean, secrets);
}
