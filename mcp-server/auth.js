import { timingSafeEqual } from 'crypto';
import { BEARER_TOKEN } from './config.js';

export function bearerAuth(req, res, next) {
  if (!BEARER_TOKEN) {
    process.stderr.write('MCP_BEARER_TOKEN is not set — refusing all requests\n');
    return res.status(500).json({ error: 'server misconfigured' });
  }
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // Timing-safe comparison to prevent token oracle attacks
  const a = Buffer.from(token);
  const b = Buffer.from(BEARER_TOKEN);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  if (!valid) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
