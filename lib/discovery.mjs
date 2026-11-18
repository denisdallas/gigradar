import { randomUUID, createHash } from 'node:crypto';
import { insertOpportunity, listPendingQualification, listSources, opportunityIdForUrl, startRun, finishRun, updateQualification, updateSourceCheck } from './db.mjs';
import { qualify, notifyQualified } from './integrations.mjs';
import { validatePublicWebUrl } from './security.mjs';

const MAX_FEED_BYTES = 4 * 1024 * 1024;
const MAX_FEED_ITEMS = 20;

export async function runDiscovery() {
  const runId = randomUUID();
  startRun(runId);
  const result = { run_id: runId, sources_checked: 0, items_found: 0, items_added: 0,
    qualified_count: 0, review_count: 0, notifications_sent: 0, errors: [], status: 'completed' };
  if (process.env.GROQ_API_KEY) {
    const pending = listPendingQualification(10);
    await processWithLimit(pending, 3, async item => applyQualification(item, result));
  }
  const sources = listSources().filter(source => source.enabled);
  for (const source of sources) {
    result.sources_checked += 1;
    try {
      const entries = await fetchFeed(source.feed_url);
      result.items_found += entries.length;
      const candidates = [];
      for (const entry of entries.slice(0, MAX_FEED_ITEMS)) {
        try {
          const candidate = normalizeEntry(source, entry);
          if (!candidate || opportunityIdForUrl(candidate.url)) continue;
          const item = { ...candidate, score: 0, qualification_status: 'pending', assessment: 'Waiting for Groq qualification.' };
          if (!insertOpportunity(item)) continue;
          result.items_added += 1;
          candidates.push(item);
        } catch (error) {
          result.errors.push(`${source.name}: item skipped (${safeError(error)})`);
        }
      }
      await processWithLimit(candidates, 3, async item => applyQualification(item, result));
      updateSourceCheck(source.id, null);
    } catch (error) {
      const message = safeError(error);
      updateSourceCheck(source.id, message);
      result.errors.push(`${source.name}: ${message}`);
    }
  }
  if (result.errors.length && result.items_added) result.status = 'partial';
  else if (result.errors.length && !result.items_added) result.status = sources.length ? 'failed' : 'completed';
  finishRun(runId, result);
  return result;
}

async function applyQualification(item, result) {
  const ai = await qualify(item);
  updateQualification(item.id, ai);
  if (ai.qualification_status === 'qualified') {
    result.qualified_count += 1;
    try { if (await notifyQualified({ ...item, ...ai })) result.notifications_sent += 1; }
    catch (error) { result.errors.push(`${item.source_name || 'Source'}: notification failed (${safeError(error)})`); }
  } else if (ai.qualification_status === 'review') {
    result.review_count += 1;
  }
}

async function processWithLimit(items, limit, action) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await action(items[index]);
    }
  });
  await Promise.all(workers);
}

function normalizeEntry(source, entry) {
  const title = stripMarkup(entry.title || '').trim().slice(0, 300);
  const url = entry.url?.trim();
  if (!title || !url) return null;
  const parsedUrl = validatePublicWebUrl(url);
  const summary = stripMarkup(entry.summary || '').replace(/\s+/g, ' ').trim().slice(0, 5000);
  const published = entry.date ? new Date(entry.date) : null;
  return {
    id: createHash('sha256').update(`${source.kind}:${parsedUrl.toString()}`).digest('hex'),
    source_id: source.id,
    kind: source.kind,
    country: source.country,
    title,
    organization: stripMarkup(entry.author || source.name).trim().slice(0, 200),
    summary,
    url: parsedUrl.toString(),
    published_at: published && !Number.isNaN(published.valueOf()) ? published.toISOString() : null,
    discovered_at: new Date().toISOString()
  };
}

async function fetchFeed(initialUrl) {
  let url = validatePublicWebUrl(initialUrl);
  let response;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    response = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'GigRadar/1.0 (+https://github.com/denisdallas/gig-radar)' },
      signal: AbortSignal.timeout(15_000)
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || redirects === 3) throw new Error('Feed redirected too many times');
    url = validatePublicWebUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`Feed returned HTTP ${response?.status || 'unknown'}`);
  const text = await limitedText(response, MAX_FEED_BYTES);
  return parseFeed(text).slice(0, MAX_FEED_ITEMS);
}

async function limitedText(response, maxBytes) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('Feed is larger than the 4 MB limit');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('Feed is larger than the 4 MB limit'); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  return blocks.map(block => ({
    title: tagText(block, 'title'),
    url: atomLink(block) || tagText(block, 'link'),
    summary: tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content'),
    date: tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated'),
    author: tagText(block, 'author') || tagText(block, 'creator')
  })).filter(item => item.title);
}

function tagText(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
}

function atomLink(xml) {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  const link = links.find(match => !/rel=["'](?:self|enclosure)["']/i.test(match[1])) || links[0];
  return link?.[1].match(/href=["']([^"']+)["']/i)?.[1] || '';
}

function stripMarkup(value) { return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')); }

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code[0] === '#') {
      const hex = code[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }
    return named[code.toLowerCase()] ?? entity;
  });
}

function safeError(error) {
  return String(error?.message || 'Unknown error').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[remote service]').slice(0, 240);
}
