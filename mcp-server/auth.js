import { timingSafeEqual } from 'crypto';
import { BEARER_TOKEN } from './config.js';
import logger from './logger.js';

export function bearerAuth(req, res, next) {
  if (!BEARER_TOKEN) {
    logger.error('auth_misconfigured', { reason: 'MCP_BEARER_TOKEN is not set' });
    return res.status(500).json({ error: 'server misconfigured' });
  }
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    logger.warn('auth_missing_token', { ip: req.ip });
    return res.status(401).json({ error: 'unauthorized' });
  }
  const a = Buffer.from(token);
  const b = Buffer.from(BEARER_TOKEN);
  const valid = a.length === b.length && timingSafeEqual(a, b);
  if (!valid) {
    logger.warn('auth_invalid_token', { ip: req.ip });
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
