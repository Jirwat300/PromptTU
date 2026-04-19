-- ============================================================================
-- POP TU — faculty leaderboard schema
--
-- Run this once in the Supabase SQL editor (Project → SQL → New query).
-- It is idempotent: safe to re-run if you tweak RLS.
-- ============================================================================

-- 1. Table ------------------------------------------------------------------
create table if not exists public.faculty_scores (
  id         text primary key,             -- matches the FACULTIES id in the frontend
  name       text not null,                -- Thai faculty name (for convenience)
  emoji      text,                         -- emoji shown in the UI
  count      bigint not null default 0,    -- total pops
  updated_at timestamptz not null default now()
);

comment on table public.faculty_scores is 'POP TU per-faculty cumulative pop counts';

create index if not exists faculty_scores_count_idx
  on public.faculty_scores (count desc);

-- 2. Atomic increment RPC ---------------------------------------------------
-- Called from the backend to add N pops for one faculty in a single round-trip.
-- Returns the new count.
create or replace function public.increment_faculty_score (fid text, delta integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d int;
  r bigint;
begin
  -- clamp: backend batches ≤ 50; cap at 100 per RPC call
  if delta is null or delta <= 0 then
    r := (
      select coalesce(fs."count", 0)
      from public.faculty_scores fs
      where fs.id = increment_faculty_score.fid
      limit 1
    );
    return coalesce(r, 0);
  end if;

  d := least(delta, 100);
  update public.faculty_scores fs
  set
    "count" = fs."count" + d,
    updated_at = now()
  where fs.id = increment_faculty_score.fid;

  r := (
    select coalesce(fs."count", 0)
    from public.faculty_scores fs
    where fs.id = increment_faculty_score.fid
    limit 1
  );

  return coalesce(r, 0);
end;
$fn$;

comment on function public.increment_faculty_score is
  'Atomically add `delta` pops to an existing faculty row. Clamped to 100 per call. Backend should use service_role.';

revoke all on function public.increment_faculty_score(text, integer) from public;
grant execute on function public.increment_faculty_score(text, integer) to service_role;

-- 3. Row-Level Security -----------------------------------------------------
alter table public.faculty_scores enable row level security;

-- Allow anyone (including anon key) to read the leaderboard.
drop policy if exists "read faculty_scores" on public.faculty_scores;
create policy "read faculty_scores"
  on public.faculty_scores
  for select
  using (true);

-- Writes go through the RPC only — do NOT add a direct insert/update policy.
-- The RPC is SECURITY DEFINER, so it bypasses RLS while still being scoped.

-- 4. Seed faculties (count = 0) --------------------------------------------
-- Upsert so re-running doesn't reset counts.
insert into public.faculty_scores (id, name, emoji, count) values
  ('team_phromtham', 'ทีมพร้อมธรรม',                    '✨', 0),
  ('team_dao',       'ทีมดาว',                          '⭐', 0),
  ('team_diw',       'ทีมดิว',                          '💫', 0),
  ('team_rangsit',   'ทีมรังสิต',                       '🏢', 0),
  ('team_lampang',   'ทีมลำปาง',                        '🏔️', 0),
  ('team_thaprachan', 'ทีมท่าพระจันทร์',                '🛕', 0),
  ('team_pattaya',   'ทีมพัทยา',                        '🌊', 0),
  ('law',    'คณะนิติศาสตร์',                         '⚖️', 0),
  ('comm',   'คณะพาณิชยศาสตร์และการบัญชี',            '📊', 0),
  ('polsci', 'คณะรัฐศาสตร์',                           '🏛️', 0),
  ('econ',   'คณะเศรษฐศาสตร์',                         '💹', 0),
  ('soc',    'คณะสังคมสงเคราะห์ศาสตร์',                '🤝', 0),
  ('anthro', 'คณะสังคมวิทยาและมานุษยวิทยา',            '👥', 0),
  ('arts',   'คณะศิลปศาสตร์',                          '📚', 0),
  ('journ',  'คณะวารสารศาสตร์และสื่อสารมวลชน',         '📰', 0),
  ('sci',    'คณะวิทยาศาสตร์และเทคโนโลยี',             '🔬', 0),
  ('eng',    'คณะวิศวกรรมศาสตร์',                      '⚙️', 0),
  ('arch',   'คณะสถาปัตยกรรมศาสตร์และการผังเมือง', '🏛️', 0),
  ('fine',   'คณะศิลปกรรมศาสตร์',                      '🎨', 0),
  ('med',    'คณะแพทยศาสตร์',                          '🩺', 0),
  ('allied', 'คณะสหเวชศาสตร์',                         '🧪', 0),
  ('dent',   'คณะทันตแพทยศาสตร์',                      '🦷', 0),
  ('nurse',  'คณะพยาบาลศาสตร์',                        '💉', 0),
  ('pub',    'คณะสาธารณสุขศาสตร์',                    '🏥', 0),
  ('pharm',  'คณะเภสัชศาสตร์',                         '💊', 0),
  ('learn',  'คณะวิทยาการเรียนรู้และศึกษาศาสตร์',      '🎓', 0),
  ('puey',   'วิทยาลัยพัฒนศาสตร์ ป๋วย อึ๊งภากรณ์',      '🌱', 0),
  ('glob',   'วิทยาลัยโลกคดีศึกษา',                    '🌐', 0),
  ('cicm',   'วิทยาลัยแพทยศาสตร์นานาชาติจุฬาภรณ์',    '⚕️', 0),
  ('inter',  'วิทยาลัยนานาชาติปรีดี พนมยงค์',          '🌏', 0),
  ('siit',   'สถาบันเทคโนโลยีนานาชาติสิรินธร',         '🔧', 0)
on conflict (id) do update set
  name  = excluded.name,
  emoji = excluded.emoji;
-- NOTE: `count` intentionally NOT touched in on-conflict so re-running this
-- file won't wipe live scores.

-- 5. Analytics (POST /api/analytics) -----------------------------------------
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
-- No SELECT/INSERT policies: only the service role (backend) touches this table.
