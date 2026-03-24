'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
});

const { z } = require('zod');

// ── Schema ────────────────────────────────────────────────────────────────────
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().min(32),
  ENCRYPTION_IV: z.string().min(16),

  DATABASE_PATH: z.string().optional(),

  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),

  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_CALLBACK_URL: z.string().url().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(1800),
  AUTHENTICATED_RATE_LIMIT_MAX: z.coerce.number().default(8000),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(600000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(40),

  BOT_MAX_RESTART_ATTEMPTS: z.coerce.number().default(5),
  BOT_RESTART_DELAY_MS: z.coerce.number().default(5000),
  BOT_RESTART_BACKOFF_MULTIPLIER: z.coerce.number().default(2),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_DIR: z.string().optional(),
  LOG_MAX_FILES: z.string().default('14d'),
  LOG_MAX_SIZE: z.string().default('20m'),

  DEFAULT_AI_PROVIDER: z.string().default('anthropic'),
  DEFAULT_AI_MODEL: z.string().default('claude-sonnet-4-6'),

  REDIS_URL: z.string().optional(),

  FOUNDER_USERNAME: z.string().min(2).default('Founder'),
  FOUNDER_EMAIL: z.string().email().default('founder@example.com'),
  FOUNDER_PASSWORD: z.string().min(8).default('ChangeMe123!'),
});

// ── Parse + Validate ─────────────────────────────────────────────────────────
let config;
try {
  config = envSchema.parse(process.env);
} catch (err) {
  console.error('❌  Invalid environment configuration:');
  err.errors.forEach((e) => console.error(`   ${e.path.join('.')}: ${e.message}`));
  process.exit(1);
}

// ── Derived helpers ───────────────────────────────────────────────────────────
config.isDev = config.NODE_ENV === 'development';
config.isProd = config.NODE_ENV === 'production';
config.allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

const renderPersistentRoot = process.env.RENDER_DISK_ROOT
  || process.env.PERSISTENT_DATA_DIR
  || (fs.existsSync('/var/data') ? '/var/data' : '');

const usingDefaultDatabasePath = !process.env.DATABASE_PATH || config.DATABASE_PATH === './data/discord_saas.db';
const usingDefaultLogDir = !process.env.LOG_DIR || config.LOG_DIR === './logs';

if (config.isProd && renderPersistentRoot) {
  config.DATABASE_PATH = usingDefaultDatabasePath
    ? path.join(renderPersistentRoot, 'discord_saas.db')
    : config.DATABASE_PATH;
  config.LOG_DIR = usingDefaultLogDir
    ? path.join(renderPersistentRoot, 'logs')
    : config.LOG_DIR;
} else {
  config.DATABASE_PATH = config.DATABASE_PATH || './data/discord_saas.db';
  config.LOG_DIR = config.LOG_DIR || './logs';
}

config.hasPersistentStorage = Boolean(
  config.isProd
  && renderPersistentRoot
  && String(config.DATABASE_PATH || '').startsWith(renderPersistentRoot)
);

module.exports = config;
