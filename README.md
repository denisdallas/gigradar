# GigRadar

GigRadar keeps two kinds of opportunity separate:

- **Active gigs:** explicit paid technical work or a request to hire a technical provider.
- **Business prospects:** real organizations that may be worth approaching, with evidence from their public source.

The dashboard scans configured public RSS or Atom feeds, deduplicates items, optionally qualifies them with Groq, stores them in SQLite, and can send high-fit notifications through ntfy. It starts empty by design; it does not invent or preload opportunities.

## Run locally

Requirements: Node.js 24 or newer.

1. Copy `.env.example` to `.env` and replace both example keys with long random values.
2. Start GigRadar with Node:

   ```sh
   node --env-file-if-exists=.env server.mjs
   ```

3. Open [http://localhost:3000](http://localhost:3000).
4. Add a public RSS or Atom feed, choose its category and market, and select **Scan sources**.

No package installation is required. The server uses Node's built-in HTTP, SQLite, and `fetch` APIs. SQLite data is stored in `data/gig-radar.sqlite` and is excluded from Git.

## Integrations

| Environment variable | Purpose |
| --- | --- |
| `GIGRADAR_ADMIN_KEY` | Protects source management, shortlist updates, and manual scans. Required in production. |
| `CRON_SECRET` | Separate bearer key for the scheduled discovery endpoint. Required in production. |
| `GROQ_API_KEY` | Optional evidence-based qualification. Without it, new records remain marked for review. |
| `GROQ_MODEL` | Optional Groq chat model ID; defaults to `llama-3.3-70b-versatile`. |
| `NTFY_TOPIC` | Optional ntfy topic. Use a hard-to-guess topic name. |
| `NTFY_TOKEN` | Optional ntfy bearer token for protected topics. |
| `NTFY_MIN_SCORE` | Minimum score for a qualified item to trigger a notification; defaults to `75`. |
| `DATABASE_FILE` | Optional path to the SQLite database; defaults to `./data/gig-radar.sqlite`. |

Keys are read only by the server. The dashboard keeps the admin key in browser session storage and sends it only to the GigRadar server. Never commit `.env` or paste keys into issue reports.

## Schedule discovery

The server exposes `POST /api/cron/discover` and checks `Authorization: Bearer <CRON_SECRET>`. The included GitHub Actions workflow runs every 15 minutes and can also be started manually. In the repository settings, add:

- Repository secret `GIGRADAR_BASE_URL`, set to the HTTPS base URL of your running GigRadar server.
- Repository secret `CRON_SECRET`, matching the server's `CRON_SECRET` value.

The workflow stays idle until both secrets are set. GitHub scheduled workflows run from the default branch and can be delayed during busy periods; they are best-effort scheduling, not a guaranteed real-time queue.

Run GigRadar on a host that keeps a persistent filesystem for SQLite. A serverless host with an ephemeral filesystem will lose the local database when instances are replaced. Back up the database file regularly.

## Feed safety and evidence

- Add feeds you are permitted to access. GigRadar does not scrape login-only pages or bypass access controls.
- Feed URLs must use HTTP or HTTPS and cannot target local/private host names or IP ranges.
- Feed downloads have a 15-second timeout, a 4 MB size limit, at most three validated redirects, and at most 20 items per source per scan.
- The source's chosen category remains authoritative. An accommodation provider or company is never silently reclassified as a paid gig.
- Groq receives the item's public title, summary, category, country, and source link for qualification. Source text is treated as untrusted input.
- AI results are evidence-based suggestions. Review the original source before applying or contacting anyone.

## API overview

- `GET /api/health` — server and integration readiness, without exposing keys.
- `GET /api/meta` — supported markets and categories.
- `GET /api/summary` — totals and latest run.
- `GET /api/opportunities` — records; supports `kind`, `country`, `status`, `saved`, `q`, and `limit` filters.
- `GET /api/sources` — configured feeds.
- `POST /api/sources` — add a feed; admin bearer key required in production.
- `DELETE /api/sources/:id` — remove a feed and its records; admin bearer key required in production.
- `PATCH /api/opportunities/:id` — shortlist or dismiss a record; admin bearer key required in production.
- `POST /api/discover` — start a manual scan; admin bearer key required in production.
- `POST /api/cron/discover` — scheduled scan; `CRON_SECRET` bearer key required.

## Project scope

The first market group is Croatia, Slovenia, Malta, Latvia, Lithuania, Estonia, Slovakia, North Macedonia, Cyprus, Luxembourg, Montenegro, Albania, Moldova, and Bosnia and Herzegovina. The second group is Czechia, Serbia, Bulgaria, Romania, and Hungary. The interface can filter all 19 markets. Sources are added explicitly so each one can be reviewed for access rules, usefulness, and country coverage.
