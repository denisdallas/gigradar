"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { DashboardSummary } from "@/lib/repository";
import type { Opportunity, OpportunityKind, OpportunityStatus } from "@/lib/countries";
import { COUNTRIES } from "@/lib/countries";

type Props = { initialSummary: DashboardSummary; databaseConfigured: boolean; databaseError: string | null; todayLabel: string };
type ScoreStyle = CSSProperties & { "--score": string };
type ListResponse = { opportunities?: Opportunity[]; error?: string };

const moneyLikeStatus = (status: string | null | undefined) => status ? status.replaceAll("_", " ") : "Awaiting review";

function ClockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/></svg>;
}

function RadarMark() {
  return <div className="brand-mark" aria-hidden="true"><span/><span/><span/><i/></div>;
}

export default function Dashboard({ initialSummary, databaseConfigured, databaseError, todayLabel }: Props) {
  const [kind, setKind] = useState<OpportunityKind>("active_gig");
  const [country, setCountry] = useState("all");
  const [status, setStatus] = useState("all");
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!databaseConfigured) return;
    setLoading(true);
    setListError(null);
    const query = new URLSearchParams({ kind, limit: "60" });
    if (country !== "all") query.set("country", country);
    if (status !== "all") query.set("status", status);
    try {
      const response = await fetch(`/api/opportunities?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json() as ListResponse;
      if (!response.ok) throw new Error(payload.error || "Could not load opportunities.");
      setItems(payload.opportunities ?? []);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not load opportunities.");
    } finally {
      setLoading(false);
    }
  }, [databaseConfigured, kind, country, status]);

  useEffect(() => { void refresh(); }, [refresh]);

  const latestLabel = useMemo(() => {
    if (!initialSummary.latestRun) return "No completed scan yet";
    const timestamp = initialSummary.latestRun.completed_at ?? initialSummary.latestRun.started_at;
    const ago = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 3_600_000));
    return ago < 1 ? "Updated less than an hour ago" : `Updated ${ago}h ago`;
  }, [initialSummary.latestRun]);

  async function changeStatus(item: Opportunity, nextStatus: OpportunityStatus) {
    setNotice(null);
    try {
      const response = await fetch(`/api/opportunities/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not update this opportunity.");
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, status: nextStatus } : row));
      setNotice("Saved your update.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update this opportunity.");
    }
  }

  const coverage = new Map(initialSummary.countries.map((row) => [row.code, row.count]));
  const totalCoverage = COUNTRIES.filter((entry) => (coverage.get(entry.code) ?? 0) > 0).length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#top" aria-label="GigRadar home"><RadarMark/><span>gig<span className="brand-light">radar</span></span></a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#opportunities"><span className="nav-symbol">◉</span>Opportunity feed<span className="nav-count">{initialSummary.activeGigs + initialSummary.businessProspects}</span></a>
          <a className="nav-link" href="#markets"><span className="nav-symbol">◎</span>Market coverage</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="auto-card"><div className="auto-indicator"><span/>AUTOMATIC DISCOVERY</div><p>Daily scans across your target markets.</p><span className="schedule"><ClockIcon/> 05:00 EAT</span></div>
          <div className="profile-line"><div className="avatar">G</div><div><strong>Personal workspace</strong><small>Single user · Private data</small></div><span className="dots">···</span></div>
        </div>
      </aside>

      <section className="main-column" id="top">
        <header className="topbar">
          <div className="breadcrumb">GigRadar <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-actions"><span className="scan-status"><i/> {latestLabel}</span><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh opportunities" title="Refresh">↻</button><div className="top-avatar">D</div></div>
        </header>

        <div className="content">
          <div className="welcome-row"><div><div className="eyebrow">{todayLabel} <span>·</span> EAST AFRICA TIME</div><h1>Your radar, at a glance <span className="wave">✳</span></h1><p className="subhead">Technical opportunities, found and assessed automatically.</p></div><div className="scan-chip"><span className="pulse-dot"/> Scanning daily <span className="chip-divider"/> Next scan 05:00</div></div>

          {(databaseError || !databaseConfigured) && <div className="setup-banner"><div className="setup-icon">!</div><div><strong>{databaseConfigured ? "Database connection needs attention" : "Connect the data store to start automatic discovery"}</strong><p>{databaseError || "The app is built, but it needs the Supabase project credentials before it can save discoveries or run its first scan."}</p></div><span className="setup-badge">SETUP REQUIRED</span></div>}

          <div className="section-heading"><div><h2>At a glance</h2><p>Your opportunity pipeline, updated automatically.</p></div><span className="period-pill"><span/> All time</span></div>

          <div className="stat-grid">
            <article className="stat-card"><div className="stat-top"><span className="stat-icon violet">↗</span><span className="trend">AUTOMATED</span></div><span className="stat-label">Paid gigs &amp; tenders</span><div className="stat-value">{initialSummary.activeGigs}</div><span className="stat-foot">Evidence of payment required</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon blue">⌂</span><span className="trend">POTENTIAL</span></div><span className="stat-label">Business prospects</span><div className="stat-value">{initialSummary.businessProspects}</div><span className="stat-foot">Technical need assessed from evidence</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon amber">☆</span><span className="trend neutral">YOUR PIPELINE</span></div><span className="stat-label">Saved opportunities</span><div className="stat-value">{initialSummary.saved}</div><span className="stat-foot">For a closer look later</span></article>
            <article className="stat-card"><div className="stat-top"><span className="stat-icon green">✓</span><span className="trend neutral">YOUR PIPELINE</span></div><span className="stat-label">Applications tracked</span><div className="stat-value">{initialSummary.applied}</div><span className="stat-foot">Marked as applied</span></article>
          </div>

          <section className="feed-section" id="opportunities">
            <div className="section-heading feed-title"><div><h2>Opportunity feed</h2><p>New discoveries, scored against your skills.</p></div><button className="refresh-button" onClick={() => void refresh()} disabled={loading}><span className={loading ? "spin" : ""}>↻</span> Refresh</button></div>
            <div className="feed-toolbar"><div className="tabs" role="tablist" aria-label="Opportunity type"><button className={kind === "active_gig" ? "tab active" : "tab"} onClick={() => setKind("active_gig")} role="tab" aria-selected={kind === "active_gig"}>Active gigs <span>{initialSummary.activeGigs}</span></button><button className={kind === "business_prospect" ? "tab active" : "tab"} onClick={() => setKind("business_prospect")} role="tab" aria-selected={kind === "business_prospect"}>Business prospects <span>{initialSummary.businessProspects}</span></button></div><div className="filters"><select aria-label="Filter by market" value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">All markets</option>{COUNTRIES.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Any status</option><option value="new">New</option><option value="saved">Saved</option><option value="applied">Applied</option><option value="ignored">Ignored</option></select></div></div>

            {notice && <div className="inline-notice">{notice}</div>}
            {listError && <div className="inline-error">{listError}</div>}
            {!databaseConfigured && <div className="empty-state"><div className="empty-orbit"><RadarMark/></div><h3>Your radar is waiting for its data connection</h3><p>Once the connected database is configured, GigRadar will automatically discover and assess opportunities. No feeds or spreadsheets to maintain.</p></div>}
            {databaseConfigured && !listError && items.length === 0 && <div className="empty-state"><div className="empty-orbit"><RadarMark/></div><h3>{loading ? "Checking for opportunities…" : "No qualified opportunities yet"}</h3><p>GigRadar keeps weak matches out of the feed. The next scheduled discovery run is at 05:00 East Africa time.</p></div>}
            {databaseConfigured && items.length > 0 && <div className="opportunity-list">{items.map((item) => <article className="opportunity-card" key={item.id}>
              <div className="opportunity-main"><div className="opportunity-meta"><span className={kind === "active_gig" ? "type-pill gig" : "type-pill prospect"}>{kind === "active_gig" ? "PAID GIG" : "POTENTIAL PROSPECT"}</span><span>{item.country_name || "Remote / not specified"}</span><span className="meta-dot">·</span><span>{item.source_name}</span><span className="meta-dot">·</span><span>{moneyLikeStatus(item.status)}</span></div><h3><a href={item.source_url} target="_blank" rel="noreferrer">{item.title}<span className="external">↗</span></a></h3>{item.organization && item.organization !== item.title && <div className="org-name">{item.organization}</div>}<p className="opportunity-summary">{item.summary || "No source summary available."}</p>{item.assessment && <p className="assessment-reason">{String(item.assessment.reason || item.assessment.technical_need || "")}</p>}<div className="opportunity-footer"><span className="source-link">SOURCE <a href={item.source_url} target="_blank" rel="noreferrer">View original ↗</a></span>{item.website_url && <a className="business-link" href={item.website_url} target="_blank" rel="noreferrer">Business website ↗</a>}</div></div>
              <div className="opportunity-side"><div className="score-ring" style={{ "--score": `${item.match_score ?? 0}%` } as ScoreStyle}><div><strong>{item.match_score ?? "—"}</strong><small>MATCH</small></div></div><span className={`confidence ${item.confidence || "low"}`}>{item.confidence || "awaiting score"} confidence</span><div className="card-actions"><select aria-label={`Update status for ${item.title}`} value={item.status} onChange={(event) => void changeStatus(item, event.target.value as OpportunityStatus)}><option value="new">New</option><option value="saved">Saved</option><option value="applied">Applied</option><option value="ignored">Ignored</option></select></div></div>
            </article>)}</div>}
          </section>

          <section className="markets-section" id="markets"><div className="section-heading"><div><h2>Market coverage</h2><p>{totalCoverage} of 19 target markets have discoveries on record.</p></div><span className="coverage-stat"><strong>{COUNTRIES.length}</strong> markets</span></div><div className="market-grid">{COUNTRIES.map((entry) => <div className="market-cell" key={entry.code}><span className="flag">{flagEmoji(entry.code)}</span><div><strong>{entry.name}</strong><small>{coverage.get(entry.code) ?? 0} prospects</small></div><span className="country-code">{entry.code}</span></div>)}</div></section>
          <footer className="footer"><span>GigRadar <b>·</b> Technical opportunity intelligence</span><span>Sources are linked. Assessments are evidence-based.</span></footer>
        </div>
      </section>
    </main>
  );
}

function flagEmoji(countryCode: string) {
  return String.fromCodePoint(...countryCode.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0)));
}

