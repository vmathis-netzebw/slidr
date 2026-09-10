import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { PollHub } from './pollHub.js';
import { SessionStore, SESSION_TTL_MS } from './sessionStore.js';
import { serveStatic } from './staticFiles.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const PUBLIC_URL = normalizePublicUrl(process.env.PUBLIC_URL);
const TRUST_PROXY = (process.env.TRUST_PROXY ?? 'true').toLowerCase() !== 'false';
const MAX_CONNECTIONS = Number.parseInt(process.env.MAX_CONNECTIONS ?? '5000', 10);

const moduleDir = dirname(fileURLToPath(import.meta.url));
/** dist/node/server -> dist/client */
const CLIENT_DIR = process.env.CLIENT_DIR ?? join(moduleDir, '..', '..', 'client');

/** Prozess-lokales Salt: IPs werden nur als flüchtiger Hash für Rate-Limiting genutzt. */
const IP_SALT = randomBytes(32);

const store = new SessionStore();
const hub = new PollHub(store);

const server = createServer((req, res) => {
  handleHttp(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = safeUrl(req);
  if (!url || url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  if (hub.connectionCount >= MAX_CONNECTIONS) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const state = hub.addConnection(
    {
      send: (data) => ws.send(data),
      close: () => ws.close(),
    },
    clientKeyFor(req),
  );

  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    hub.handleRawMessage(state, data.toString());
  });

  ws.on('error', () => {
    /* Verbindungsfehler werden über 'close' aufgeräumt. */
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.removeConnection(state);
  });
});

setInterval(() => {
  store.pruneExpired(SESSION_TTL_MS);
}, 15 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`live-poll läuft auf http://${HOST}:${PORT} (PUBLIC_URL=${PUBLIC_URL ?? 'auto'})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = safeUrl(req);
  if (!url) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, sessions: store.size, connections: hub.connectionCount }));
    return;
  }

  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ publicUrl: PUBLIC_URL ?? null }));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    const asset = await serveStatic(CLIENT_DIR, url.pathname, req, res, { immutable: true });
    if (asset.served) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  if (url.pathname !== '/') {
    const file = await serveStatic(CLIENT_DIR, url.pathname, req, res);
    if (file.served) return;
  }

  // SPA-Fallback: /presenter und /vote/:id werden clientseitig aufgelöst.
  const index = await serveStatic(CLIENT_DIR, '/index.html', req, res);
  if (index.served) return;

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function safeUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return null;
  }
}

/** Anonymisierter Schlüssel für Rate-Limiting – die IP selbst wird nie gespeichert. */
function clientKeyFor(req: IncomingMessage): string {
  const forwarded = TRUST_PROXY ? req.headers['x-forwarded-for'] : undefined;
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = forwardedValue?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  return createHmac('sha256', IP_SALT).update(ip).digest('base64url').slice(0, 22);
}

function normalizePublicUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
