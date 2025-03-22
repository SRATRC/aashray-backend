import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';

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
  return env === 'prod' ? 'warn' : 'debug';
};

// Define custom format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define file transports
const fileTransport = new winston.transports.DailyRotateFile({
  filename: path.join('logs', 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  level: 'debug'
});

// Define error file transport
const errorFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join('logs', 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  level: 'error'
});

// Define console transport
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(winston.format.colorize(), format)
});

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports: [fileTransport, errorFileTransport, consoleTransport]
});

export default logger;
