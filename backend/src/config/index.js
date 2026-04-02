'use strict';

const path = require('path');
const fs = require('fs');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
});

const { z } = require('zod');

function booleanish(defaultValue = false) {
  return z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
    }
    return value;
  }, z.boolean().default(defaultValue));
}

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
  BACKEND_PUBLIC_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),

  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_CALLBACK_URL: z.string().url().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: booleanish(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().default('DiscordForger Security'),

  AUTH_REQUIRE_EMAIL_VERIFICATION: booleanish(true),
  AUTH_REQUIRE_LOGIN_APPROVAL_NEW_DEVICE: booleanish(false),
  AUTH_REQUIRE_ALLOWED_EMAIL_DOMAIN: booleanish(true),
  AUTH_LOOKUP_LOGIN_LOCATION: booleanish(true),
  AUTH_VERIFICATION_TTL_MINUTES: z.coerce.number().min(5).max(1440).default(30),
  AUTH_LOGIN_APPROVAL_TTL_MINUTES: z.coerce.number().min(5).max(1440).default(20),
  AUTH_ALLOWED_EMAIL_DOMAINS: z.string().default('gmail.com,googlemail.com,outlook.com,hotmail.com,live.com,msn.com,yahoo.com,yahoo.fr,icloud.com,me.com,mac.com,orange.fr,orange.com,wanadoo.fr,free.fr,laposte.net,sfr.fr,bbox.fr,bouyguestelecom.fr,proton.me,protonmail.com'),
  AUTH_BLOCKED_EMAIL_DOMAINS: z.string().default('mailinator.com,maildrop.cc,maildrop.cf,guerrillamail.com,guerrillamailblock.com,10minutemail.com,10minutemail.net,temp-mail.org,temp-mail.io,tempmail.plus,dispostable.com,yopmail.com,trashmail.com,mail.tm,moakt.com,fakemail.net,getnada.com,sharklasers.com'),
  AUTH_GEOLOOKUP_ENDPOINT: z.string().default('https://ipwho.is/{ip}'),

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
config.publicBackendUrl = config.BACKEND_PUBLIC_URL || config.FRONTEND_URL;

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
