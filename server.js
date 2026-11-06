import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './src/store.js';
import { Monitor } from './src/monitor.js';
import { normalizeConfig } from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');

const store = new Store(DATA_DIR);
await store.init();
const monitor = new Monitor(store);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function snapshot() {
  return {
    ok: true,
    config: store.config,
    state: { ...store.state, ...monitor.status, nextCheck: monitor.status.nextCheck },
    logs: store.logs.slice(0, 60),
    meta: {
      serverTime: new Date().toISOString(),
      version: '1.0.0',
      source: 'Open-Meteo (no API key)',
      cooldownDefault: 24,
    },
  };
}

async function geocode(query) {
  const params = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    signal: AbortSignal.timeout(12_000),
    headers: { 'User-Agent': 'weather-ntfy/1.0' },
  });
  if (!res.ok) throw new Error(`Geocoding responded ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    shortName: r.name,
    admin1: r.admin1 ?? '',
    country: r.country ?? '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone ?? 'auto',
    population: r.population ?? 0,
  }));
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        running: monitor.running,
        lastCheck: store.state.lastCheck,
        lastError: store.state.lastError,
      });
    }

    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      return sendJson(res, 200, snapshot());
    }

    if (pathname === '/api/config' && req.method === 'PUT') {
      const body = await readBody(req);
      store.config = normalizeConfig(body, store.config);
      await store.saveConfig();
      monitor.restart({ runSoon: store.config.schedule.enabled });
      return sendJson(res, 200, { ok: true, ...snapshot() });
    }

    if (pathname === '/api/geocode' && req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim();
      if (q.length < 2) return sendJson(res, 400, { ok: false, error: 'Type at least 2 characters.' });
      const results = await geocode(q);
      return sendJson(res, 200, { ok: true, results });
    }

    if (pathname === '/api/check' && req.method === 'POST') {
      const result = await monitor.runCheck('manual');
      return sendJson(res, result.ok ? 200 : 500, { ...result, state: snapshot().state });
    }

    if (pathname === '/api/test' && req.method === 'POST') {
      const result = await monitor.sendTest();
      return sendJson(res, 200, { ...result, snapshot: snapshot() });
    }

    if (pathname === '/api/logs' && req.method === 'DELETE') {
      await store.clearLogs();
      return sendJson(res, 200, { ok: true, logs: [] });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'Unknown endpoint' });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return sendJson(res, 500, { ok: false, error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Weather → ntfy  running at http://${HOST}:${PORT}\n`);
  console.log(`  data dir: ${DATA_DIR}`);
  console.log(`  polling every ${monitor.config.schedule.intervalMinutes} min · cooldown ${monitor.config.schedule.cooldownHours}h`);
  console.log(
    store.config.ntfy.dryRun
      ? '  dry run is ON — no notifications will be delivered until you turn it off\n'
      : `  ntfy: ${store.config.ntfy.server}/${store.config.ntfy.topic || '<set a topic>'}\n`,
  );
  monitor.restart();
});

function shutdown() {
  monitor.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
