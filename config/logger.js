import winston from 'winston';
import path from 'path';
import 'winston-daily-rotate-file';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'dev';
  return env === 'prod' ? 'info' : 'debug';
};

// Structured JSON format — New Relic parses each key as a queryable attribute
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Human-readable format for console only
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(
    ({ timestamp, level, message, correlationId, userId, ...meta }) => {
      const ctx = [
        correlationId && `reqId=${correlationId}`,
        userId && `user=${userId}`
      ]
        .filter(Boolean)
        .join(' ');
      const metaStr = Object.keys(meta).length
        ? ` ${JSON.stringify(meta)}`
        : '';
      return `${timestamp} ${level}${ctx ? ` [${ctx}]` : ''}: ${message}${metaStr}`;
    }
  )
);

const LOG_DIR = process.env.LOG_DIR || '/home/ubuntu/logs';

const fileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '90d',
  format: jsonFormat
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '90d',
  level: 'error',
  format: jsonFormat
});

const consoleTransport = new winston.transports.Console({
  format: consoleFormat,
  forceConsole: true
});

const logger = winston.createLogger({
  level: level(),
  levels,
  transports: [fileTransport, errorFileTransport, consoleTransport]
});

export default logger;
