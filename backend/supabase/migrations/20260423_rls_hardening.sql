-- ============================================================================
-- RLS hardening for public schema (addresses Supabase Security Advisor email
-- "rls_disabled_in_public" snapshot from 2026-04-19).
--
-- Context:
--   • Frontend never touches Supabase directly. All DB traffic goes through the
--     Express backend (backend/api/index.js) using SUPABASE_SERVICE_ROLE_KEY,
--     which bypasses RLS.
--   • faculty_scores is intentionally readable by the anon key so the public
--     leaderboard stays cache-friendly if the backend ever falls back to a
--     direct supabase-js read. Writes go through SECURITY DEFINER RPC only.
--   • analytics_events should NEVER be exposed to anon/authenticated clients —
--     it holds raw client telemetry. Only service_role writes + reads.
--
-- This file is idempotent: safe to re-run.
-- ============================================================================

-- 1. faculty_scores -----------------------------------------------------------
alter table public.faculty_scores enable row level security;

drop policy if exists "read faculty_scores" on public.faculty_scores;
create policy "read faculty_scores"
  on public.faculty_scores
  for select
  to anon, authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy for anon/authenticated: RLS with zero write
-- policies means those commands are rejected. Backend writes via the
-- SECURITY DEFINER RPC increment_faculty_score(), which is granted to
-- service_role only (see 20260419_increment_rpc_lockdown.sql).

-- Belt-and-suspenders: also revoke direct DML from PostgREST-exposed roles so
-- even a misconfigured policy in the future can't accidentally open writes.
revoke insert, update, delete on public.faculty_scores from anon, authenticated;


-- 2. analytics_events ---------------------------------------------------------
alter table public.analytics_events enable row level security;

-- Explicitly drop any accidental permissive policies from prior experiments.
drop policy if exists "read analytics_events"   on public.analytics_events;
drop policy if exists "insert analytics_events" on public.analytics_events;
drop policy if exists "update analytics_events" on public.analytics_events;
drop policy if exists "delete analytics_events" on public.analytics_events;

-- No policies defined → RLS denies all anon/authenticated access by default.
-- service_role (used by the backend) bypasses RLS, so inserts from
-- POST /api/analytics and reads from GET /api/admin/analytics keep working.

-- Hard revoke at the grant layer too (defense in depth).
revoke select, insert, update, delete on public.analytics_events
  from anon, authenticated;


-- 3. Verify -------------------------------------------------------------------
-- After applying, this should return rls_enabled = true for both tables and
-- zero policies for analytics_events, one SELECT policy for faculty_scores:
--
--   select schemaname, tablename, rowsecurity
--   from pg_tables
--   where schemaname = 'public';
--
--   select schemaname, tablename, policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'public'
--   order by tablename, policyname;
