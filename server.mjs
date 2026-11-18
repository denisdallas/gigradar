import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSource, db, getOpportunity, getSummary, listOpportunities, listSources, updateOpportunity } from './lib/db.mjs';
import { runDiscovery } from './lib/discovery.mjs';
import { HttpError, readJson, requireKey, validatePublicWebUrl } from './lib/security.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = resolve(root, 'public');
const countries = [
  'Croatia', 'Slovenia', 'Malta', 'Latvia', 'Lithuania', 'Estonia', 'Slovakia',
  'North Macedonia', 'Cyprus', 'Luxembourg', 'Montenegro', 'Albania', 'Moldova',
  'Bosnia and Herzegovina', 'Czechia', 'Serbia', 'Bulgaria', 'Romania', 'Hungary'
];
let activeRun = null;

const server = createServer(async (request, response) => {
  setHeaders(response);
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else await serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(response, status, { error: status === 500 ? 'Something went wrong. Check the server log.' : error.message });
    if (status === 500) console.error('[server]', safeError(error));
  }
});

async function handleApi(request, response, url) {
  const { pathname, searchParams } = url;
  if (request.method === 'GET' && pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, app: 'GigRadar', version: '1.0.0', integrations: {
      groq: Boolean(process.env.GROQ_API_KEY), ntfy: Boolean(process.env.NTFY_TOPIC),
      admin_key: Boolean(process.env.GIGRADAR_ADMIN_KEY), cron_key: Boolean(process.env.CRON_SECRET)
    } });
  }
  if (request.method === 'GET' && pathname === '/api/meta') {
    return sendJson(response, 200, { countries, categories: ['active_gig', 'business_prospect'] });
  }
  if (request.method === 'GET' && pathname === '/api/summary') {
    return sendJson(response, 200, { ...getSummary(), integrations: {
      groq: Boolean(process.env.GROQ_API_KEY), ntfy: Boolean(process.env.NTFY_TOPIC),
      admin_key: Boolean(process.env.GIGRADAR_ADMIN_KEY), cron_key: Boolean(process.env.CRON_SECRET)
    } });
  }
  if (request.method === 'GET' && pathname === '/api/sources') return sendJson(response, 200, listSources());
  if (request.method === 'GET' && pathname === '/api/opportunities') {
    return sendJson(response, 200, listOpportunities(Object.fromEntries(searchParams.entries())));
  }
  if (request.method === 'PATCH' && pathname.startsWith('/api/opportunities/')) {
    requireKey(request, 'GIGRADAR_ADMIN_KEY');
    const id = decodeURIComponent(pathname.slice('/api/opportunities/'.length));
    const body = await readJson(request);
    if (body.status && !['new', 'shortlisted', 'dismissed'].includes(body.status)) throw new HttpError(400, 'Invalid opportunity status');
    const item = updateOpportunity(id, { ...(body.status ? { status: body.status } : {}),
      ...(typeof body.is_saved === 'boolean' ? { is_saved: body.is_saved } : {}) });
    if (!item) throw new HttpError(404, 'Opportunity not found');
    return sendJson(response, 200, item);
  }
  if (request.method === 'POST' && pathname === '/api/sources') {
    requireKey(request, 'GIGRADAR_ADMIN_KEY');
    const body = await readJson(request);
    if (!['active_gig', 'business_prospect'].includes(body.kind)) throw new HttpError(400, 'Choose an opportunity category');
    if (!countries.includes(body.country) && body.country !== 'Remote / Europe-wide') throw new HttpError(400, 'Choose a country from the list');
    const name = String(body.name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Source name is required');
    const feed = validatePublicWebUrl(String(body.feed_url || ''));
    try {
      const source = createSource({ id: randomUUID(), name, kind: body.kind, country: body.country, feed_url: feed.toString() });
      return sendJson(response, 201, source);
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'That feed URL is already added');
      throw error;
    }
  }
  if (request.method === 'POST' && pathname === '/api/discover') {
    requireKey(request, 'GIGRADAR_ADMIN_KEY');
    return sendJson(response, 200, await startDiscovery());
  }
  if (request.method === 'POST' && pathname === '/api/cron/discover') {
    requireKey(request, 'CRON_SECRET');
    return sendJson(response, 200, await startDiscovery());
  }
  throw new HttpError(404, 'That route was not found');
}

async function startDiscovery() {
  if (activeRun) throw new HttpError(409, 'A discovery run is already in progress');
  activeRun = runDiscovery();
  try { return await activeRun; }
  finally { activeRun = null; }
}

async function serveStatic(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
  const target = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = resolve(publicRoot, target);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) throw new HttpError(403, 'Forbidden');
  const data = await readFile(file).catch(() => null);
  if (!data) throw new HttpError(404, 'Page not found');
  response.statusCode = 200;
  response.setHeader('Content-Type', mimeType(extname(file)));
  response.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
  response.end(request.method === 'HEAD' ? undefined : data);
}

function mimeType(extension) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream';
}

function setHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function safeError(error) { return String(error?.message || error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 500); }

const port = Math.max(1, Math.min(Number(process.env.PORT) || 3000, 65535));
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
server.listen(port, host, () => console.log(`GigRadar ready at http://localhost:${port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(); db.close(); process.exit(0); });
}
