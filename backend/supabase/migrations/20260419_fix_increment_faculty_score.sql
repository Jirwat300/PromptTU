-- One-shot fix: run in Supabase → SQL if POP scores stay at 0 after clicks.
-- Fixes: (1) UPDATE-only RPC missing rows  (2) anon role may lack EXECUTE on RPC

create or replace function public.increment_faculty_score (fid text, delta integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count bigint;
begin
  if delta is null or delta <= 0 then
    return coalesce((select count from public.faculty_scores where id = fid), 0);
  end if;
  if delta > 100 then
    delta := 100;
  end if;

  insert into public.faculty_scores (id, name, emoji, count)
  values (fid, '—', '', delta)
  on conflict (id) do update set
    count = faculty_scores.count + excluded.count,
    updated_at = now()
  returning count into new_count;

  return coalesce(new_count, 0);
end;
$$;

grant execute on function public.increment_faculty_score(text, integer) to anon;
grant execute on function public.increment_faculty_score(text, integer) to authenticated;
grant execute on function public.increment_faculty_score(text, integer) to service_role;
