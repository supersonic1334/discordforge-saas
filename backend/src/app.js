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
const jwt = require('jsonwebtoken');

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
const reviewsRoutes = require('./routes/reviews');

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

function buildConnectSources() {
  const sources = new Set(["'self'"]);
  const originCandidates = [config.FRONTEND_URL, ...config.allowedOrigins];

  for (const candidate of originCandidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      sources.add(parsed.origin);
      sources.add(`${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`);
    } catch {
      // Ignore malformed custom origins from environment overrides.
    }
  }

  if (config.isDev) {
    sources.add('http://localhost:4000');
    sources.add('http://localhost:5173');
    sources.add('ws://localhost:4000');
    sources.add('ws://localhost:5173');
  }

  return [...sources];
}

const cspConnectSources = buildConnectSources();

app.set('trust proxy', true);
app.disable('x-powered-by');

function setNoStoreHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'no-referrer' },
  strictTransportSecurity: config.isProd
    ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      }
    : false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'base-uri': ["'self'"],
      'child-src': ["'none'"],
      'connect-src': cspConnectSources,
      'frame-src': ["'none'"],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'img-src': externalImageSources,
      'manifest-src': ["'self'"],
      'media-src': ["'self'"],
      'object-src': ["'none'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'worker-src': ["'self'", 'blob:'],
    },
  },
}));

app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), midi=(), payment=(), usb=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  next();
});

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
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── HTTP logging ──────────────────────────────────────────────────────────────
if (config.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/health' || req.url.startsWith('/ws'),
  }));
}

// ?? Rate limiting ?????????????????????????????????????????????????????????????
function getAuthenticatedUserId(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  try {
    const payload = jwt.verify(authHeader.slice(7), config.JWT_SECRET);
    return payload?.userId ? String(payload.userId) : null;
  } catch {
    return null;
  }
}

function buildClientRateLimitKey(req, { includeEmail = false } = {}) {
  const deviceId = String(req.headers['x-device-id'] || '').trim();
  const email = includeEmail ? String(req.body?.email || '').trim().toLowerCase() : '';
  const userId = getAuthenticatedUserId(req);

  if (userId) return `${req.ip}:user:${userId}`;
  if (deviceId && email) return `${req.ip}:device:${deviceId}:email:${email}`;
  if (deviceId) return `${req.ip}:device:${deviceId}`;
  if (email) return `${req.ip}:email:${email}`;
  return req.ip;
}

const globalLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: (req) => (getAuthenticatedUserId(req) ? config.AUTHENTICATED_RATE_LIMIT_MAX : config.RATE_LIMIT_MAX),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => buildClientRateLimitKey(req),
  message: { error: 'Too many requests, please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => buildClientRateLimitKey(req, { includeEmail: true }),
  skipSuccessfulRequests: true,
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
const allowedMutationFetchSites = new Set(['same-origin', 'same-site', 'none', '']);
const oauthRoutePrefixes = [
  '/auth/discord',
  '/auth/google',
];

function hasAllowedOrigin(requestUrl) {
  if (!requestUrl) return true;

  try {
    const parsed = new URL(requestUrl);
    return config.allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

app.use(prefix, (req, res, next) => {
  setNoStoreHeaders(res);
  next();
});
app.use(prefix, (req, res, next) => {
  const relativePath = req.path || '';
  const isOauthFlow = oauthRoutePrefixes.some((routePrefix) => relativePath.startsWith(routePrefix));
  if (isOauthFlow) {
    return next();
  }

  const appClient = String(req.headers['x-app-client'] || '').trim();
  const requestedWith = String(req.headers['x-requested-with'] || '').trim();
  if (appClient !== 'discordforger-web' || requestedWith !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Client request rejected.' });
  }

  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  if (!hasAllowedOrigin(origin) || !hasAllowedOrigin(referer)) {
    return res.status(403).json({ error: 'Origin rejected.' });
  }

  return next();
});
app.use(prefix, (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (!allowedMutationFetchSites.has(fetchSite)) {
    return res.status(403).json({ error: 'Cross-site request blocked.' });
  }

  return next();
});
app.use(`${prefix}/auth/login`, authLimiter);
app.use(`${prefix}/auth/register`, authLimiter);
app.use(`${prefix}/auth`,    authRoutes);
app.use(`${prefix}/bot`,     botRoutes);
app.use(`${prefix}/ai`,      aiRouter);
app.use(`${prefix}/admin`,   adminRouter);
app.use(`${prefix}/provider`, providerRoutes);
app.use(`${prefix}/support`, supportRoutes);
app.use(`${prefix}/reviews`, reviewsRoutes);

if (fs.existsSync(frontendDistDir)) {
  app.use(express.static(frontendDistDir, {
    etag: true,
    lastModified: true,
    setHeaders: (res) => {
      setNoStoreHeaders(res);
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path === '/health' || req.path === '/ws' || req.path.startsWith(prefix)) {
      return next();
    }
    setNoStoreHeaders(res);
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
