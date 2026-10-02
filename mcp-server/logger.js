import winston from 'winston';
import path from 'path';
import { mkdirSync, accessSync, constants } from 'fs';
import 'winston-daily-rotate-file';
import { LOG_DIR } from './config.js';

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, tool, durationMs, ...meta }) => {
    const parts = [tool && `tool=${tool}`, durationMs && `${durationMs}ms`].filter(Boolean).join(' ');
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}${parts ? ` [${parts}]` : ''}: ${message}${metaStr}`;
  })
);

function buildFileTransports() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    accessSync(LOG_DIR, constants.W_OK);
  } catch {
    // Log dir unavailable (e.g. local dev on macOS) — console only
    return [];
  }
  return [
    new winston.transports.DailyRotateFile({
      filename: path.join(LOG_DIR, 'mcp-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '90d',
      format: jsonFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: path.join(LOG_DIR, 'mcp-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '90d',
      level: 'error',
      format: jsonFormat,
    }),
  ];
}

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'prod' ? 'info' : 'debug',
  transports: [...buildFileTransports(), new winston.transports.Console({ format: consoleFormat })],
});

export default logger;
