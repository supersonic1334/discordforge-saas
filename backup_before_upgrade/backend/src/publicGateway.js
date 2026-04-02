'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const httpProxy = require('http-proxy');
const helmet = require('helmet');

const app = express();
const frontendDistDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const backendPort = Number(process.env.BACKEND_PORT || 4000);
const publicPort = Number(process.env.PUBLIC_PORT || 4010);
const backendHttpTarget = `http://127.0.0.1:${backendPort}`;
const backendWsTarget = `ws://127.0.0.1:${backendPort}`;
const externalImageSources = [
  "'self'",
  'data:',
  'blob:',
  'https://cdn.discordapp.com',
  'https://media.discordapp.net',
  'https://lh3.googleusercontent.com',
  'https://*.googleusercontent.com',
];

function getGatewayConnectSources() {
  const sources = new Set(["'self'", 'ws:', 'wss:']);
  const frontendOrigin = process.env.FRONTEND_URL;

  if (frontendOrigin) {
    try {
      const parsed = new URL(frontendOrigin);
      sources.add(parsed.origin);
      sources.add(`${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`);
    } catch {
      // Ignore malformed overrides.
    }
  }

  return [...sources];
}

const connectSources = getGatewayConnectSources();

if (!fs.existsSync(path.join(frontendDistDir, 'index.html'))) {
  console.error(`Frontend build missing: ${frontendDistDir}`);
  process.exit(1);
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  ws: true,
  xfwd: true,
  proxyTimeout: 60000,
  timeout: 60000,
  target: backendHttpTarget,
});

proxy.on('error', (error, req, res) => {
  if (!res || res.headersSent) return;
  res.writeHead(502, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Gateway proxy error',
    message: error.message,
    path: req.url,
  }));
});

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'no-referrer' },
  strictTransportSecurity: process.env.NODE_ENV === 'production'
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
      'connect-src': connectSources,
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
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  next();
});
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    gateway: true,
    publicPort,
    backendPort,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', (req, res) => {
  proxy.web(req, res, { target: backendHttpTarget });
});

app.use(express.static(frontendDistDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistDir, 'index.html'));
});

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: backendWsTarget });
});

server.listen(publicPort, () => {
  console.log(`Public gateway running on http://localhost:${publicPort}`);
  console.log(`Frontend dist: ${frontendDistDir}`);
  console.log(`Proxying API/WS to ${backendHttpTarget}`);
});
