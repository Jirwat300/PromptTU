-- Table for POST /api/analytics (matches backend/api/index.js insert shape).

create table if not exists public.analytics_events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  event_type  text not null,
  path        text,
  device      text,
  referrer    text,
  watchtower  text,
  metadata    jsonb,
  user_id     text
);

comment on table public.analytics_events is 'Lightweight client analytics ingested via Express + service_role';

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_event_type_idx
  on public.analytics_events (event_type);

alter table public.analytics_events enable row level security;
