create extension if not exists pgcrypto;

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('active_gig', 'business_prospect')),
  country_code text check (country_code is null or char_length(country_code) = 2),
  country_name text,
  title text not null,
  organization text,
  summary text,
  category text,
  website_url text,
  source_name text not null,
  source_key text not null,
  source_url text not null,
  source_published_at timestamptz,
  evidence jsonb not null default '[]'::jsonb,
  assessment jsonb,
  assessment_status text not null default 'pending'
    check (assessment_status in ('pending', 'assessed', 'retryable_error', 'rejected')),
  match_score integer check (match_score is null or (match_score between 0 and 100)),
  confidence text check (confidence is null or confidence in ('low', 'medium', 'high')),
  status text not null default 'new' check (status in ('new', 'saved', 'applied', 'ignored')),
  notified_at timestamptz,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_name, source_key)
);

create index if not exists opportunities_kind_country_recent_idx
  on public.opportunities (kind, country_code, discovered_at desc);
create index if not exists opportunities_status_recent_idx
  on public.opportunities (status, discovered_at desc);
create index if not exists opportunities_assessment_pending_idx
  on public.opportunities (assessment_status, kind, discovered_at desc);
create index if not exists opportunities_score_idx
  on public.opportunities (match_score desc nulls last);

create table if not exists public.assessment_history (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  model text not null,
  outcome text not null check (outcome in ('assessed', 'rejected', 'retryable_error')),
  score integer check (score is null or score between 0 and 100),
  assessment jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists assessment_history_opportunity_idx
  on public.assessment_history (opportunity_id, created_at desc);

create table if not exists public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb
);

create index if not exists discovery_runs_started_idx
  on public.discovery_runs (started_at desc);

create table if not exists public.discovery_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists opportunities_set_updated_at on public.opportunities;
create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

drop trigger if exists discovery_state_set_updated_at on public.discovery_state;
create trigger discovery_state_set_updated_at
  before update on public.discovery_state
  for each row execute function public.set_updated_at();

alter table public.opportunities enable row level security;
alter table public.assessment_history enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovery_state enable row level security;

-- GigRadar is a single-user server application. Only the server-side Supabase
-- service role may read or write the database; no browser key is shipped.
revoke all on public.opportunities from anon, authenticated;
revoke all on public.assessment_history from anon, authenticated;
revoke all on public.discovery_runs from anon, authenticated;
revoke all on public.discovery_state from anon, authenticated;
grant all on public.opportunities to service_role;
grant all on public.assessment_history to service_role;
grant all on public.discovery_runs to service_role;
grant all on public.discovery_state to service_role;

create or replace function public.gigradar_dashboard_summary()
returns jsonb
language sql
stable
security invoker
as $$
  with target_countries(code) as (
    values ('HR'), ('SI'), ('MT'), ('LV'), ('LT'), ('EE'), ('SK'), ('MK'),
           ('CY'), ('LU'), ('ME'), ('AL'), ('MD'), ('BA'), ('CZ'), ('RS'),
           ('BG'), ('RO'), ('HU')
  )
  select jsonb_build_object(
    'active_gigs', (select count(*) from public.opportunities where kind = 'active_gig' and assessment_status = 'assessed'),
    'business_prospects', (select count(*) from public.opportunities where kind = 'business_prospect' and assessment_status = 'assessed'),
    'saved', (select count(*) from public.opportunities where status = 'saved' and assessment_status = 'assessed'),
    'applied', (select count(*) from public.opportunities where status = 'applied' and assessment_status = 'assessed'),
    'ignored', (select count(*) from public.opportunities where status = 'ignored' and assessment_status = 'assessed'),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'count', coalesce(p.total, 0)) order by c.code), '[]'::jsonb)
      from target_countries c
      left join (
        select country_code, count(*)::integer as total
        from public.opportunities
        where kind = 'business_prospect' and assessment_status = 'assessed' and country_code is not null
        group by country_code
      ) p on p.country_code = c.code
    ),
    'latest_run', (
      select jsonb_build_object(
        'status', status,
        'started_at', started_at,
        'completed_at', completed_at,
        'metrics', metrics,
        'errors', errors
      )
      from public.discovery_runs
      order by started_at desc
      limit 1
    )
  );
$$;

revoke all on function public.gigradar_dashboard_summary() from public, anon, authenticated;
grant execute on function public.gigradar_dashboard_summary() to service_role;

