-- Grouped counts for admin dashboard (GET /api/admin/analytics). Service role only.

create or replace function public.admin_analytics_event_counts()
returns table (event_type text, cnt bigint)
language sql
stable
security definer
set search_path = public
as $$
  select ae.event_type, count(*)::bigint as cnt
  from public.analytics_events ae
  group by ae.event_type
  order by cnt desc;
$$;

revoke all on function public.admin_analytics_event_counts() from public;
grant execute on function public.admin_analytics_event_counts() to service_role;
