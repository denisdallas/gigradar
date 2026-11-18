import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = resolve(root, process.env.DATABASE_FILE || './data/gig-radar.sqlite');
mkdirSync(dirname(dbFile), { recursive: true });

export const db = new DatabaseSync(dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('active_gig', 'business_prospect')),
    country TEXT NOT NULL,
    feed_url TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('active_gig', 'business_prospect')),
    country TEXT NOT NULL,
    title TEXT NOT NULL,
    organization TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL UNIQUE,
    published_at TEXT,
    discovered_at TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    qualification_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (qualification_status IN ('pending', 'qualified', 'review', 'not_relevant')),
    assessment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new'
      CHECK (status IN ('new', 'shortlisted', 'dismissed')),
    is_saved INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS opportunities_kind_country
    ON opportunities(kind, country, discovered_at DESC);
  CREATE INDEX IF NOT EXISTS opportunities_status
    ON opportunities(status, qualification_status, score DESC);

  CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    sources_checked INTEGER NOT NULL DEFAULT 0,
    items_found INTEGER NOT NULL DEFAULT 0,
    items_added INTEGER NOT NULL DEFAULT 0,
    errors_json TEXT NOT NULL DEFAULT '[]'
  );
`);

export function asSource(row) {
  if (!row) return null;
  return { ...row, enabled: Boolean(row.enabled) };
}

export function asOpportunity(row) {
  if (!row) return null;
  return { ...row, is_saved: Boolean(row.is_saved) };
}

export function createSource(source) {
  db.prepare(`INSERT INTO sources (id, name, kind, country, feed_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(source.id, source.name, source.kind, source.country,
    source.feed_url, new Date().toISOString());
  return asSource(db.prepare('SELECT * FROM sources WHERE id = ?').get(source.id));
}

export function listSources() {
  return db.prepare('SELECT * FROM sources ORDER BY enabled DESC, name COLLATE NOCASE').all().map(asSource);
}

export function updateSourceCheck(id, error = null) {
  db.prepare('UPDATE sources SET last_checked_at = ?, last_error = ? WHERE id = ?')
    .run(new Date().toISOString(), error, id);
}

export function listOpportunities(filters = {}) {
  const clauses = [];
  const values = [];
  if (filters.kind && ['active_gig', 'business_prospect'].includes(filters.kind)) {
    clauses.push('o.kind = ?'); values.push(filters.kind);
  }
  if (filters.country) { clauses.push('o.country = ?'); values.push(filters.country); }
  if (filters.status && ['new', 'shortlisted', 'dismissed'].includes(filters.status)) {
    clauses.push('o.status = ?'); values.push(filters.status);
  }
  if (filters.saved === 'true') clauses.push('o.is_saved = 1');
  if (filters.q) {
    clauses.push('(o.title LIKE ? OR o.organization LIKE ? OR o.summary LIKE ?)');
    const q = `%${filters.q.slice(0, 120)}%`;
    values.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 250);
  return db.prepare(`SELECT o.*, s.name AS source_name FROM opportunities o
    JOIN sources s ON s.id = o.source_id ${where}
    ORDER BY CASE o.status WHEN 'new' THEN 0 WHEN 'shortlisted' THEN 1 ELSE 2 END,
      o.score DESC, COALESCE(o.published_at, o.discovered_at) DESC LIMIT ?`)
    .all(...values, limit).map(asOpportunity);
}

export function getOpportunity(id) {
  return asOpportunity(db.prepare(`SELECT o.*, s.name AS source_name FROM opportunities o
    JOIN sources s ON s.id = o.source_id WHERE o.id = ?`).get(id));
}

export function listPendingQualification(limit = 10) {
  return db.prepare(`SELECT o.*, s.name AS source_name FROM opportunities o
    JOIN sources s ON s.id = o.source_id
    WHERE o.qualification_status = 'pending' AND o.status = 'new'
    ORDER BY o.discovered_at ASC LIMIT ?`).all(Math.min(Math.max(limit, 1), 25)).map(asOpportunity);
}

export function updateOpportunity(id, patch) {
  const allowed = ['status', 'is_saved'];
  const keys = Object.keys(patch).filter(key => allowed.includes(key));
  if (!keys.length) return getOpportunity(id);
  const values = keys.map(key => key === 'is_saved' ? Number(Boolean(patch[key])) : patch[key]);
  db.prepare(`UPDATE opportunities SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE id = ?`)
    .run(...values, id);
  return getOpportunity(id);
}

export function getSummary() {
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status != 'dismissed' THEN 1 ELSE 0 END), 0) AS total,
      COALESCE(SUM(CASE WHEN kind = 'active_gig' AND status != 'dismissed' THEN 1 ELSE 0 END), 0) AS gigs,
      COALESCE(SUM(CASE WHEN kind = 'business_prospect' AND status != 'dismissed' THEN 1 ELSE 0 END), 0) AS prospects,
      COALESCE(SUM(CASE WHEN qualification_status = 'qualified' AND status = 'new' THEN 1 ELSE 0 END), 0) AS qualified,
      COALESCE(SUM(CASE WHEN qualification_status IN ('pending', 'review') AND status = 'new' THEN 1 ELSE 0 END), 0) AS needs_review,
      COALESCE(SUM(CASE WHEN status = 'shortlisted' THEN 1 ELSE 0 END), 0) AS shortlisted
    FROM opportunities`).get();
  const run = db.prepare('SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1').get() || null;
  return { ...totals, latest_run: run ? { ...run, errors: JSON.parse(run.errors_json || '[]') } : null };
}

export function startRun(id) {
  db.prepare(`INSERT INTO discovery_runs (id, started_at, status)
    VALUES (?, ?, 'running')`).run(id, new Date().toISOString());
}

export function finishRun(id, result) {
  db.prepare(`UPDATE discovery_runs SET finished_at = ?, status = ?, sources_checked = ?,
    items_found = ?, items_added = ?, errors_json = ? WHERE id = ?`)
    .run(new Date().toISOString(), result.status, result.sources_checked, result.items_found,
      result.items_added, JSON.stringify(result.errors), id);
}

export function insertOpportunity(item) {
  const result = db.prepare(`INSERT OR IGNORE INTO opportunities
    (id, source_id, kind, country, title, organization, summary, url, published_at,
     discovered_at, score, qualification_status, assessment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(item.id, item.source_id, item.kind, item.country, item.title, item.organization,
      item.summary, item.url, item.published_at, new Date().toISOString(), item.score,
      item.qualification_status, item.assessment);
  return result.changes > 0;
}

export function updateQualification(id, result) {
  db.prepare(`UPDATE opportunities SET score = ?, qualification_status = ?, assessment = ? WHERE id = ?`)
    .run(result.score, result.qualification_status, result.assessment, id);
}

export function opportunityIdForUrl(url) {
  return db.prepare('SELECT id FROM opportunities WHERE url = ?').get(url)?.id || null;
}
