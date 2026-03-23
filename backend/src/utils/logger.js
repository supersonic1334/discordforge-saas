'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure log directory exists
const logDir = path.resolve(config.LOG_DIR);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// ── Custom format ─────────────────────────────────────────────────────────────
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, category, ...meta }) => {
    const cat = category ? `[${category}] ` : '';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${cat}${message}${metaStr}`;
  })
);

// ── Transports ────────────────────────────────────────────────────────────────
const transports = [
  new winston.transports.Console({
    format: consoleFormat,
    silent: config.NODE_ENV === 'test',
  }),

  new DailyRotateFile({
    filename: path.join(logDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    format: logFormat,
    maxFiles: config.LOG_MAX_FILES,
    maxSize: config.LOG_MAX_SIZE,
    zippedArchive: true,
  }),

  new DailyRotateFile({
    filename: path.join(logDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    format: logFormat,
    maxFiles: config.LOG_MAX_FILES,
    maxSize: config.LOG_MAX_SIZE,
    zippedArchive: true,
  }),
];

// ── Logger instance ───────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  transports,
  exitOnError: false,
});

/**
 * Category-scoped logger factory.
 * Usage: const log = createLogger('BotManager')
 */
logger.child = (category) => {
  const child = {
    error: (msg, meta = {}) => logger.error(msg, { category, ...meta }),
    warn:  (msg, meta = {}) => logger.warn(msg, { category, ...meta }),
    info:  (msg, meta = {}) => logger.info(msg, { category, ...meta }),
    http:  (msg, meta = {}) => logger.http(msg, { category, ...meta }),
    debug: (msg, meta = {}) => logger.debug(msg, { category, ...meta }),
  };
  return child;
};

module.exports = logger;
