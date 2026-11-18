export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function requireKey(request, envName) {
  const expected = process.env[envName];
  if (!expected) {
    if (process.env.NODE_ENV !== 'production' && envName === 'GIGRADAR_ADMIN_KEY') return;
    throw new HttpError(503, `${envName} is not configured`);
  }
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, 'The supplied key is not valid');
  }
}

import crypto from 'node:crypto';

export function validatePublicWebUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new HttpError(400, 'Enter a valid feed URL'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new HttpError(400, 'Feed URL must use HTTP or HTTPS');
  const host = url.hostname.toLowerCase();
  const blocked = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' ||
    /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (blocked) throw new HttpError(400, 'Feed URL must point to a public host');
  url.username = '';
  url.password = '';
  return url;
}

export async function readJson(request, maxBytes = 30_000) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new HttpError(413, 'Request body is too large');
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw new HttpError(400, 'Request body must be valid JSON'); }
}
