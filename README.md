# GigRadar

GigRadar is a single-user, automatically refreshed workspace for relevant paid technical work and evidence-backed business prospects. It keeps confirmed paid opportunities separate from possible clients and stores the public source material used to assess each result.

## What it does

- Searches current Hacker News discussions for direct technical project requests and rejects records without explicit payment evidence.
- Searches public TED procurement notices for current technical service calls in the 19 target markets. Tender eligibility and an award are never assumed.
- Rotates through OpenStreetMap business listings across all target markets, then checks a small number of publicly listed websites for concrete technical gaps. Website research requires public HTTPS, honors `robots.txt`, does not follow redirects, and is bounded by response size and time limits.
- Uses Groq to assess skill fit, evidence, legitimacy, timing, and payment signals. The business lane only reports potential prospects, never confirmed paid gigs.
- Saves source links, evidence, assessments, run history, and saved/applied/ignored status in Supabase.
- Sends high-scoring findings to an ntfy topic when configured.
- Runs daily at 02:00 UTC (05:00 East Africa Time), with resumable country rotation and bounded assessment batches.

Target markets: Croatia, Slovenia, Malta, Latvia, Lithuania, Estonia, Slovakia, North Macedonia, Cyprus, Luxembourg, Montenegro, Albania, Moldova, Bosnia and Herzegovina, Czechia, Serbia, Bulgaria, Romania, and Hungary.

## Project status

The application and its automated discovery workflow are implemented here. A live scan is not considered operational until a Supabase project has the migration applied and the deployment has valid Supabase, Groq, and Cron credentials. ntfy delivery is optional. The health endpoint reports which credentials are present; a successful scan records source counts and errors in the dashboard.

This is a personal workspace without app sign-in. Keep its deployment private or protected by the hosting platform. The service-role key is server-only and is never returned to the browser.

## Run locally

Requirements: Node.js 22.12+ and pnpm 11.

```sh
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Apply `supabase/migrations/20261118000000_initial_gigradar.sql` to the connected Supabase project before the first scan. Required server variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access; never prefix with `NEXT_PUBLIC_` |
| `GROQ_API_KEY` | Evidence assessment and scoring |
| `CRON_SECRET` | Protects the daily discovery endpoint |

Optional notification variables: `NTFY_TOPIC`, `NTFY_TOKEN`, and `NTFY_SERVER` (defaults to `https://ntfy.sh`). `OSM_COUNTRIES_PER_RUN`, `GROQ_BATCHES_PER_RUN`, and `NTFY_MIN_SCORE` tune the daily run.

The health endpoint is `/api/health`. The scheduled endpoint is `/api/cron/daily-discovery` and accepts authenticated `POST` requests only. Vercel Cron invokes it at the schedule in `vercel.json`.

## Build checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

GitHub Actions runs those checks on pushes and pull requests.

