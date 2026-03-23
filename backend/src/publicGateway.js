'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const httpProxy = require('http-proxy');

const app = express();
const frontendDistDir = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const backendPort = Number(process.env.BACKEND_PORT || 4000);
const publicPort = Number(process.env.PUBLIC_PORT || 4010);
const backendHttpTarget = `http://127.0.0.1:${backendPort}`;
const backendWsTarget = `ws://127.0.0.1:${backendPort}`;

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
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
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
