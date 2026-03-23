'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const passport = require('passport');

const config = require('./config');
const logger = require('./utils/logger');
const { runMigrations } = require('./database');
const { ensureFounder } = require('./services/authService');
const botManager = require('./services/botManager');
const wsServer = require('./websocket');
const jobs = require('./jobs');
const { requireUnblockedClient, errorHandler, notFound } = require('./middleware');

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const botRoutes  = require('./routes/bot');
const { aiRouter, adminRouter } = require('./routes/aiAdmin');
const providerRoutes = require('./routes/providerAI');
const supportRoutes = require('./routes/support');

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
const frontendDistDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const externalImageSources = [
  "'self'",
  'data:',
  'blob:',
  'https://cdn.discordapp.com',
  'https://media.discordapp.net',
  'https://lh3.googleusercontent.com',
  'https://*.googleusercontent.com',
];

app.set('trust proxy', true);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': externalImageSources,
    },
  },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors((req, cb) => {
  const origin = req.header('Origin');
  const requestHost = req.header('X-Forwarded-Host') || req.header('Host');

  let allow = !origin || config.allowedOrigins.includes(origin);
  if (!allow && origin && requestHost) {
    try {
      allow = new URL(origin).host === requestHost;
    } catch {
      allow = false;
    }
  }

  cb(allow ? null : new Error(`CORS: origin ${origin} not allowed`), {
    origin: allow,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID'],
  });
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── HTTP logging ──────────────────────────────────────────────────────────────
if (config.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/health',
  }));
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  message: { error: 'Too many auth attempts, please try again later.' },
});

app.use(config.API_PREFIX, globalLimiter);
app.use(config.API_PREFIX, requireUnblockedClient);

// ── Passport (OAuth) ──────────────────────────────────────────────────────────
app.use(passport.initialize());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: config.NODE_ENV,
    uptime: process.uptime(),
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
const prefix = config.API_PREFIX;

app.use(`${prefix}/auth/login`, authLimiter);
app.use(`${prefix}/auth/register`, authLimiter);
app.use(`${prefix}/auth/discord`, authLimiter);
app.use(`${prefix}/auth/google`, authLimiter);
app.use(`${prefix}/auth`,    authRoutes);
app.use(`${prefix}/bot`,     botRoutes);
app.use(`${prefix}/ai`,      aiRouter);
app.use(`${prefix}/admin`,   adminRouter);
app.use(`${prefix}/provider`, providerRoutes);
app.use(`${prefix}/support`, supportRoutes);

if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir));
  app.get('*', (req, res, next) => {
    if (req.path === '/health' || req.path === '/ws' || req.path.startsWith(prefix)) {
      return next();
    }
    return res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
}

// ── 404 + error ───────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  // 1. Database
  runMigrations();

  // 2. Seed founder account
  await ensureFounder();

  // 3. Create HTTP server
  const server = http.createServer(app);

  // 4. Attach WebSocket
  wsServer.attach(server);
  botManager.setWebSocketServer(wsServer);

  // 5. Start listening
  server.listen(config.PORT, () => {
    logger.info(`🚀 Server running on port ${config.PORT} [${config.NODE_ENV}]`);
    logger.info(`   API prefix: ${config.API_PREFIX}`);
    logger.info(`   WebSocket: ws://localhost:${config.PORT}/ws`);
  });

  // 6. Boot persisted bots (bots that were running before last restart)
  await botManager.bootPersistedBots();

  // 7. Start cron jobs
  jobs.startAll();

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully…`);
    jobs.stopAll();
    await botManager.shutdownAll();
    wsServer.shutdown();
    server.close(() => {
      logger.info('HTTP server closed. Goodbye!');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`, { stack: err.stack });
    // Don't crash the process for recoverable errors
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });

  return server;
}

bootstrap().catch((err) => {
  logger.error(`Fatal bootstrap error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

module.exports = app;
